import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ==========================================
// Type Definitions: Environment & Context Variables
// ==========================================
type Bindings = {
    INTERNAL_AUTH_SECRET: string
    RESEND_API_KEY: string
    CORE_API_URL: string
    ENVIRONMENT: string
    R2_LOGS: R2Bucket
    POLAR_CACHE_KV: KVNamespace
    POLAR_ACCESS_TOKEN: string
    POLAR_PRODUCT_ID: string
    POLAR_ORGANIZATION_ID: string
    POLAR_API_URL?: string
    POLAR_BOT_API_KEY?: string

    // Keep-alive & Health Check configurations
    KEEPALIVE_TARGET_URL?: string
    CUSTOM_PROXY_HOST?: string
    CUSTOM_PROXY_API_KEY?: string

    RATE_LIMITER: { limit: (options: { key: string }) => Promise<{ success: boolean }> }
}

type Variables = {
    tenantId: string
    customerId: string | null
    sessionKey: string
    idempotencyKey: string
    traceId: string
    bodyClone: Record<string, any>
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

// ==========================================
// Constants: Regex Patterns for PII Masking
// ==========================================
const PII_PATTERNS = {
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    PHONE_GLOBAL: /(?:\+?\d{1,3}[-\s]?)?0?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/g,
    CC_GLOBAL: /\b(?:\d[ -]*?){13,16}\b/g
};

const PII_PATTERNS_SINGLE = {
    PHONE: /(?:\+?\d{1,3}[-\s]?)?0?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/,
    CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/
};

// ==========================================
// Helpers: Core Utility Functions
// ==========================================
async function hashApiKeyToTenantId(apiKey: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

function maskPII(obj: any): any {
    if (typeof obj === 'string') {
        return obj
            .replace(PII_PATTERNS.EMAIL, '[MASKED_EMAIL]')
            .replace(PII_PATTERNS.PHONE_GLOBAL, '[MASKED_PHONE]')
            .replace(PII_PATTERNS.CC_GLOBAL, '[MASKED_CREDIT_CARD]');
    }

    if (typeof obj === 'number') {
        const strNum = obj.toString();
        if (PII_PATTERNS_SINGLE.CREDIT_CARD.test(strNum)) return '[MASKED_CREDIT_CARD]';
        if (PII_PATTERNS_SINGLE.PHONE.test(strNum)) return '[MASKED_PHONE]';
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map(maskPII);
    }

    if (typeof obj === 'object' && obj !== null) {
        const newObj: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            newObj[key] = maskPII(value);
        }
        return newObj;
    }

    return obj;
}

async function saveAuditLog(env: Bindings, tenantId: string, traceId: string, intent: string, requestBody: any, responseStatus: number) {
    if (!env.R2_LOGS) return;
    try {
        const timestamp = new Date().toISOString();
        const datePrefix = timestamp.split('T')[0];
        const logId = crypto.randomUUID();
        const objectKey = `transparency-logs/${datePrefix}/${tenantId}-${logId}.json`;
        const maskedPayload = maskPII(requestBody || {});

        const logEntry = {
            metadata: {
                log_id: logId,
                trace_id: traceId,
                timestamp: timestamp,
                tenant_id: tenantId,
                system_version: "GhostShip-Gateway/2.0",
                processing_region: "global-edge"
            },
            intent_watermark: {
                purpose: intent,
                automated_decision_making: false,
                human_oversight_required: false
            },
            execution: {
                upstream_status: responseStatus,
                masked_payload: maskedPayload
            },
            compliance: {
                data_retention_policy: "30_days",
                pii_masked: true
            }
        };

        await env.R2_LOGS.put(objectKey, JSON.stringify(logEntry, null, 2));
    } catch (error) {
        console.error("[Audit] Failed to save log to R2:", error);
    }
}

async function dispatchAdminAlert(env: Bindings, subject: string, message: string, traceId: string = "N/A") {
    if (!env.RESEND_API_KEY) return;
    try {
        await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: 'Ghost Ship Gateway <system@api.sakutto.works>',
                to: 'admin@sakutto.works',
                subject: `[GHOST SHIP] ${subject}`,
                html: `
                    <div style="font-family: sans-serif; color: #333;">
                        <h2 style="color: #d97706;">System Alert</h2>
                        <p><strong>Message:</strong> ${message}</p>
                        <p><strong>Trace ID:</strong> ${traceId}</p>
                        <hr />
                        <p style="font-size: 0.8rem; color: #666;">
                            Generated by Agent-Commerce-Gateway (Layer A)<br>
                            Timestamp: ${new Date().toISOString()}
                        </p>
                    </div>
                `,
            }),
        });
    } catch (error) {
        console.error('[Notification] Failed to dispatch Resend alert:', error);
    }
}

// ==========================================
// 1. Security Layer: Global CORS & Trace ID
// ==========================================
app.use('*', async (c, next) => {
    const traceId = c.req.header('X-Trace-Id') || crypto.randomUUID();
    c.set('traceId', traceId);
    await next();
});

app.use('*', cors({
    origin: (origin) => {
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
        if (origin?.endsWith('.sakutto.works') || origin === 'https://sakutto.works') return origin;
        return 'https://api.sakutto.works';
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Internal-Secret', 'X-Requested-With', 'X-Idempotency-Key', 'X-Session-Key', 'X-Trace-Id'],
    maxAge: 600,
}))

// ==========================================
// 1.5. Security Layer: Strict Rate Limiting [Phase 4: Step 3]
// ==========================================
app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/tools/list' || c.req.path === '/v1/health') return await next();

    if (c.env.RATE_LIMITER) {
        const clientIp = c.req.header('cf-connecting-ip') || 'unknown_ip';
        const rawApiKey = c.req.header('x-api-key') || c.req.header('Authorization')?.replace(/^Bearer\s+/i, '').trim();
        const limitKey = rawApiKey ? await hashApiKeyToTenantId(rawApiKey) : clientIp;

        const { success } = await c.env.RATE_LIMITER.limit({ key: limitKey });

        if (!success) {
            console.warn(`[Security] Rate limit exceeded for key/IP: ${limitKey}`);
            c.executionCtx.waitUntil(
                dispatchAdminAlert(c.env, 'Security Alert: Rate Limit Exceeded', `System protection engaged. Rate limit breached.<br>Target: ${limitKey}`, c.get('traceId'))
            );
            return c.json({
                error_type: "too_many_requests",
                message: "Rate limit exceeded. System protection engaged to prevent resource exploitation.",
                agent_instruction: "CRITICAL: You are executing operations too rapidly or are caught in an infinite loop. Halt immediately and back off.",
                trace_id: c.get('traceId')
            }, 429);
        }
    }
    await next();
});

// ==========================================
// 2. Static Discovery & MCP Catalog Layer
// ==========================================
app.get('/', (c) => c.html(generateLandingPage()));
app.get('/llms.txt', (c) => c.redirect('https://sakutto.works/llms.txt', 301));
app.get('/llms-full.txt', (c) => c.redirect('https://sakutto.works/llms-full.txt', 301));
app.get('/openapi.yaml', (c) => c.redirect('https://sakutto.works/openapi.yaml', 301));

app.get('/v1/health', (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const mcpResponse = {
    "mcpVersion": "2024.11.0",
    "name": "SakuttoWorks-Data-Normalizer",
    "description": "Secure Edge Gateway for Data Normalization.",
    "version": "1.0.0",
    "server": {
        "type": "http-proxy",
        "url": "https://api.sakutto.works",
        "endpoints": { "list_tools": "/v1/tools/list", "call_tool": "/v1/normalize_web_data" }
    },
    "authentication": {
        "type": "api-key",
        "header": "Authorization",
        "scheme": "Bearer",
        "instruction": "Obtain quota entitlement from https://buy.polar.sh/polar_cl_mps3G1hmCTmQWDYYEMY2G1c7sojN3Tul6IhjO4EtVuj"
    },
    "tools": [{
        "name": "normalize_web_data",
        "description": "Extracts and normalizes unstructured web data into structured Markdown/JSON.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "The target public URL to normalize." },
                "format_type": { "type": "string", "enum": ["markdown", "json"], "default": "markdown" }
            },
            "required": ["url"]
        }
    }]
};

app.get('/mcp', (c) => c.json(mcpResponse));
app.get('/mcp/', (c) => c.json(mcpResponse));
app.get('/.well-known/mcp.json', (c) => c.json(mcpResponse));
app.get('/v1/tools/list', (c) => c.json(mcpResponse));

// ==========================================
// 3. Middleware: Auth & KV Edge Caching
// ==========================================
app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/tools/list' || c.req.path === '/v1/health') return await next();

    if (!c.env.CORE_API_URL || !c.env.INTERNAL_AUTH_SECRET) {
        return c.json({ error: 'Gateway Configuration Error', message: 'Upstream connection details are missing.', trace_id: c.get('traceId') }, 500);
    }

    const authHeader = c.req.header('Authorization') || '';
    const rawApiKey = c.req.header('x-api-key') || authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!rawApiKey) {
        return c.json({
            error_type: "unauthorized",
            message: "Missing API Key. Please provide a valid Polar.sh token.",
            agent_instruction: "CRITICAL: You must obtain a valid Polar.sh API Key to access this infrastructure.",
            trace_id: c.get('traceId')
        }, 401);
    }

    const tenantId = await hashApiKeyToTenantId(rawApiKey);
    let customerId: string | null = null;
    const kvCacheKey = `license_cache:${tenantId}`;
    const cachedLicense = c.env.POLAR_CACHE_KV ? await c.env.POLAR_CACHE_KV.get(kvCacheKey, 'json') : null;

    if (cachedLicense) {
        customerId = (cachedLicense as any).customer_id;
    } else {
        const orgId = c.env.POLAR_ORGANIZATION_ID || "796ba33a-1265-445e-b034-6f3d3166095d";
        const polarApiBase = c.env.POLAR_API_URL || 'https://api.polar.sh';
        const polarRes = await fetch(`${polarApiBase}/v1/customer-portal/license-keys/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organization_id: orgId, key: rawApiKey })
        });

        let data: any = {};
        try {
            data = await polarRes.json();
        } catch (e) {
            // Ignore parse error; fallback to empty object
        }

        if (!polarRes.ok || !data.customer_id) {
            if (polarRes.status === 402 || data.error === 'PaymentRequired' || data.error?.toLowerCase().includes('quota')) {
                return c.json({
                    error_type: "payment_required",
                    message: "Quota exceeded or subscription inactive. Payment required.",
                    agent_instruction: "CRITICAL: Budget deficit. To continue, you must resolve the payment issue by visiting the top-up URL.",
                    top_up_url: "https://buy.polar.sh/polar_cl_mps3G1hmCTmQWDYYEMY2G1c7sojN3Tul6IhjO4EtVuj",
                    trace_id: c.get('traceId')
                }, 402);
            }

            return c.json({
                error_type: "unauthorized",
                message: "Invalid or expired License Key.",
                agent_instruction: "CRITICAL: The provided API Key is invalid or expired. Check your Polar.sh subscription.",
                trace_id: c.get('traceId')
            }, 401);
        }

        customerId = data.customer_id;
        if (c.env.POLAR_CACHE_KV) {
            c.executionCtx.waitUntil(c.env.POLAR_CACHE_KV.put(kvCacheKey, JSON.stringify(data), { expirationTtl: 60 }));
        }
    }

    if (customerId && c.env.POLAR_PRODUCT_ID) {
        const ingestEvent = async () => {
            try {
                const polarApiBase = c.env.POLAR_API_URL || 'https://api.polar.sh';
                await fetch(`${polarApiBase}/v1/events/ingest`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${c.env.POLAR_ACCESS_TOKEN}`
                    },
                    body: JSON.stringify({
                        events: [{
                            name: 'api_request',
                            customer_id: customerId,
                            metadata: { product_id: c.env.POLAR_PRODUCT_ID, endpoint: c.req.path, trace_id: c.get('traceId') }
                        }]
                    })
                });
            } catch (err) {
                // Silently ignore telemetry failure to ensure agent uptime
            }
        };
        c.executionCtx.waitUntil(ingestEvent());
    }

    c.set('tenantId', tenantId);
    c.set('customerId', customerId);
    c.set('idempotencyKey', c.req.header('X-Idempotency-Key') || crypto.randomUUID());
    c.set('sessionKey', c.req.header('X-Session-Key') || 'default_session');

    await next();
});

// ==========================================
// 4. Middleware: Prompt Injection Guard
// ==========================================
app.use('/v1/*', async (c, next) => {
    if (c.req.path === '/v1/tools/list' || c.req.path === '/v1/health') return await next();

    let bodyClone: Record<string, any> = {};
    if (c.req.method === 'POST' || c.req.method === 'PUT') {
        try {
            bodyClone = await c.req.raw.clone().json() as Record<string, any>;
            const contentString = JSON.stringify(bodyClone).toLowerCase();
            const forbiddenKeywords = ['system prompt', 'ignore previous', 'ignore instructions', 'override instructions'];
            const isInjectionAttempt = forbiddenKeywords.some(keyword => contentString.includes(keyword));

            if (isInjectionAttempt) {
                const tenantId = c.get('tenantId') || 'anonymous_tenant';
                c.executionCtx.waitUntil(
                    dispatchAdminAlert(c.env, 'Security Alert: Prompt Injection Blocked', `A request was blocked by Layer A.<br>Tenant: ${tenantId}`, c.get('traceId'))
                );
                return c.json({
                    error_type: "compliance_violation",
                    message: "Request blocked by Edge Gateway policy due to suspicious payload content.",
                    agent_instruction: "CRITICAL: Prohibited request pattern detected. Halt this inquiry and change your approach.",
                    trace_id: c.get('traceId')
                }, 403);
            }
        } catch (e) {
            // Ignore parsing error for non-JSON bodies
        }
    }

    c.set('bodyClone', bodyClone);
    await next();
});

// ==========================================
// 5. Endpoint: Asynchronous Support Ticket
// ==========================================
app.post('/v1/support/ticket', async (c) => {
    const tenantId = c.get('tenantId') || 'anonymous_tenant';
    const customerId = c.get('customerId') || 'unknown_customer';
    const traceId = c.get('traceId');
    const bodyClone = c.get('bodyClone') || {};
    const { subject, message, priority = 'normal' } = bodyClone;

    if (!subject || !message) {
        return c.json({ error_type: "bad_request", message: "Missing required fields.", trace_id: traceId }, 400);
    }

    const alertSubject = `[Support Ticket] ${priority === 'high' ? 'URGENT - ' : ''}${subject}`;
    const alertMessage = `<strong>Tenant ID:</strong> ${tenantId}<br><strong>Customer ID:</strong> ${customerId}<br><br><p>${message}</p>`;

    c.executionCtx.waitUntil(dispatchAdminAlert(c.env, alertSubject, alertMessage, traceId));

    return c.json({
        success: true,
        message: "Support ticket successfully created.",
        ticket_reference: c.get('idempotencyKey'),
        trace_id: traceId
    });
});

// ==========================================
// 6. Proxy Layer (Bridge to Cloud Run Core)
// ==========================================
app.all('/:path{(v1/.*|docs|openapi.json)}', async (c) => {
    if (['/v1/health', '/v1/tools/list', '/v1/support/ticket'].includes(c.req.path)) return;

    const tenantId = c.get('tenantId') || 'anonymous_tenant';
    const traceId = c.get('traceId');
    const idempotencyKey = c.get('idempotencyKey') || crypto.randomUUID();
    const sessionKey = c.get('sessionKey') || 'default_session';
    const bodyClone = c.get('bodyClone') || {};

    const url = new URL(c.req.url);
    const coreOrigin = c.env.CORE_API_URL.replace(/\/$/, '');
    const targetUrl = `${coreOrigin}${url.pathname}${url.search}`;

    const proxyHeaders = new Headers(c.req.raw.headers);
    proxyHeaders.delete('Host');
    proxyHeaders.delete('Cf-Connecting-Ip');

    if (c.env.INTERNAL_AUTH_SECRET) proxyHeaders.set('X-Internal-Secret', c.env.INTERNAL_AUTH_SECRET);
    proxyHeaders.set('X-Idempotency-Key', idempotencyKey);
    proxyHeaders.set('X-Tenant-Id', tenantId);
    proxyHeaders.set('X-Session-Key', sessionKey);
    proxyHeaders.set('X-Trace-Id', traceId);

    const isBodyAllowed = !['GET', 'HEAD'].includes(c.req.method);

    const proxyRequest = new Request(targetUrl, {
        method: c.req.method,
        headers: proxyHeaders,
        body: isBodyAllowed ? c.req.raw.body : undefined,
        redirect: 'manual'
    });

    try {
        const response = await fetch(proxyRequest);
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('X-Served-By', 'Agent-Commerce-Gateway');

        let intentTag = url.pathname.includes("normalize_web_data") ? "web_normalization" : "unknown_action";

        c.executionCtx.waitUntil(saveAuditLog(c.env, tenantId, traceId, intentTag, bodyClone, response.status));

        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
    } catch (error: any) {
        c.executionCtx.waitUntil(
            dispatchAdminAlert(c.env, 'Gateway Routing Error', `Path: ${c.req.path}<br>Error: ${error.message}`, traceId)
        );
        return c.json({
            error_type: "api_error",
            message: "The Data Normalization Engine is currently unreachable.",
            agent_instruction: "The upstream normalization engine is temporarily down. Please wait a moment and try again.",
            trace_id: traceId
        }, 502);
    }
});

app.notFound((c) => c.json({ message: "Endpoint not found", docs: "https://sakutto.works" }, 404));

function generateLandingPage() {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SakuttoWorks Data Gateway</title><style>:root { --primary: #0f172a; --bg: #f8fafc; --text: #334155; } body { font-family: sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; } .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 400px; width: 100%; text-align: center; } h1 { font-size: 1.25rem; color: var(--primary); margin-bottom: 0.5rem; } .status { display: inline-block; padding: 0.25rem 0.75rem; background: #dcfce7; color: #166534; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; margin-bottom: 1.5rem; } a { display: block; padding: 0.75rem; margin-top: 0.5rem; background: var(--bg); color: var(--primary); text-decoration: none; border-radius: 6px; font-size: 0.9rem; transition: background 0.2s; } a:hover { background: #e2e8f0; }</style></head><body><div class="card"><h1>Data Normalization Gateway</h1><div class="status">● System Operational</div><p style="font-size: 0.9rem; margin-bottom: 1.5rem;">Secure entry point for Project GHOST SHIP.<br>Authentication required for all API calls.</p><a href="/docs">📜 API Documentation (Swagger)</a><a href="/llms.txt">📂 View Technical Specs (llms.txt)</a><a href="https://sakutto.works">🌐 Project Home</a></div></body></html>`;
}

// ==========================================
// Application Export (Fetch & Scheduled Events)
// ==========================================
export default {
    fetch: app.fetch,

    // Scheduled event to prevent cold starts and verify upstream health
    async scheduled(event: any, env: Bindings, ctx: any) {
        if (!env.POLAR_BOT_API_KEY) {
            console.error("[Keep-Alive] ABORT: Internal Bot API Key is not configured.");
            return;
        }

        const targetUrl = env.KEEPALIVE_TARGET_URL || 'https://api.sakutto.works/v1/normalize_web_data';
        const isExternalProxy = new URL(targetUrl).hostname !== 'api.sakutto.works';

        console.log(`[Keep-Alive] Initiating scheduled health check against: ${targetUrl}`);

        const requestHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.POLAR_BOT_API_KEY}`
        };

        // Inject custom proxy headers if configured (e.g., for routing through external API gateways)
        if (env.CUSTOM_PROXY_API_KEY) requestHeaders['X-RapidAPI-Key'] = env.CUSTOM_PROXY_API_KEY;
        if (env.CUSTOM_PROXY_HOST) requestHeaders['X-RapidAPI-Host'] = env.CUSTOM_PROXY_HOST;

        try {
            let res: Response;

            if (!isExternalProxy) {
                // Internal routing: Bypass Cloudflare network loop limits (prevent 522 error)
                const internalRequest = new Request(targetUrl, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify({ url: 'https://example.com', format_type: 'markdown' })
                });
                res = await app.fetch(internalRequest, env, ctx);
            } else {
                // External routing: Verifying public ingress via configured proxy
                res = await fetch(targetUrl, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify({ url: 'https://example.com', format_type: 'markdown' })
                });
            }

            if (res.ok) {
                console.log(`[Keep-Alive] SUCCESS: Health check passed. Status: ${res.status}`);
            } else {
                console.error(`[Keep-Alive] FAILED: Target returned status ${res.status}`);
                const errorText = await res.text();
                console.error(`[Keep-Alive] Error Details: ${errorText}`);
            }
        } catch (error) {
            console.error("[Keep-Alive] CRITICAL FAILURE: Execution exception occurred.", error);
        }
    }
};