import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ==========================================
// Type Definitions: Environment & Context Variables
// ==========================================
type Bindings = {
    INTERNAL_AUTH_SECRET: string // Shared secret for Core (Layer B) communication
    RESEND_API_KEY: string       // API Key for Resend notifications
    CORE_API_URL: string         // Core (Layer B) URL (Google Cloud Run)
    ENVIRONMENT: string          // 'production' | 'development'
    R2_LOGS: R2Bucket            // R2 bucket binding for audit logs
    POLAR_CACHE_KV: KVNamespace  // Global Edge Cache for API key validations
    POLAR_ACCESS_TOKEN: string   // Polar.sh API Token for validation and events
    POLAR_PRODUCT_ID: string     // Polar.sh Product ID for metered billing
    POLAR_ORGANIZATION_ID: string // Polar.sh Organization ID for API validation
    POLAR_API_URL?: string       // Optional override for Polar.sh API base URL
}

// Type definitions for safely passing data between middlewares
type Variables = {
    tenantId: string
    customerId: string | null
    sessionKey: string
    idempotencyKey: string
    bodyClone: Record<string, any>
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

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
        let masked = obj;
        masked = masked.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[MASKED_EMAIL]');
        masked = masked.replace(/(?:\+?\d{1,3}[-\s]?)?0?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/g, '[MASKED_PHONE]');
        masked = masked.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[MASKED_CREDIT_CARD]');
        return masked;
    } else if (typeof obj === 'number') {
        const strNum = obj.toString();
        if (/\b(?:\d[ -]*?){13,16}\b/.test(strNum)) return '[MASKED_CREDIT_CARD]';
        if (/(?:\+?\d{1,3}[-\s]?)?0?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/.test(strNum)) return '[MASKED_PHONE]';
        return obj;
    } else if (Array.isArray(obj)) {
        return obj.map(item => maskPII(item));
    } else if (typeof obj === 'object' && obj !== null) {
        const newObj: Record<string, any> = {};
        for (const key in obj) {
            newObj[key] = maskPII(obj[key]);
        }
        return newObj;
    }
    return obj;
}

// Phase 4: Enterprise Transparency Logs (EU AI Act Compliant)
async function saveAuditLog(env: Bindings, tenantId: string, intent: string, requestBody: any, responseStatus: number) {
    if (!env.R2_LOGS) {
        console.warn("[Audit] R2_LOGS binding is missing. Skipping log.");
        return;
    }
    try {
        const timestamp = new Date().toISOString();
        const datePrefix = timestamp.split('T')[0];
        const logId = crypto.randomUUID();
        const objectKey = `transparency-logs/${datePrefix}/${tenantId}-${logId}.json`;

        // Recursively apply masking before JSON stringification
        const maskedPayload = maskPII(requestBody || {});

        // EU AI Act Compliant Transparency Log Structure
        const logEntry = {
            metadata: {
                log_id: logId,
                timestamp: timestamp,
                tenant_id: tenantId,
                system_version: "GhostShip-Gateway/2.0",
                processing_region: "global-edge"
            },
            intent_watermark: {
                purpose: intent,
                automated_decision_making: false, // Explicitly state no ADM for compliance
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
        console.log(`[Audit] Transparency log saved to R2: ${objectKey}`);
    } catch (error) {
        console.error("[Audit] Failed to save log to R2:", error);
    }
}

async function dispatchAdminAlert(env: Bindings, subject: string, message: string) {
    if (!env.RESEND_API_KEY) {
        console.warn('[Notification] RESEND_API_KEY is not set. Skipping admin alert.');
        return;
    }
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
// 1. Security Layer: Global CORS
// ==========================================
app.use('*', cors({
    origin: (origin) => {
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
        if (origin?.endsWith('.sakutto.works') || origin === 'https://sakutto.works') return origin;
        return 'https://api.sakutto.works';
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-Internal-Secret', 'X-Requested-With', 'X-Idempotency-Key', 'X-Session-Key'],
    maxAge: 600,
}))

// ==========================================
// 2. Static Discovery & MCP Catalog Layer
// ==========================================
app.get('/', (c) => c.html(generateLandingPage()));

// Redirect AI crawlers to the canonical AEO resources on the Portal
app.get('/llms.txt', (c) => c.redirect('https://sakutto.works/llms.txt', 301));
app.get('/llms-full.txt', (c) => c.redirect('https://sakutto.works/llms-full.txt', 301));
app.get('/openapi.yaml', (c) => c.redirect('https://sakutto.works/openapi.yaml', 301));

// ==========================================
// 2.5 Health Check Endpoint (RapidAPI Monitor)
// ==========================================
app.get('/v1/health', (c) => {
    return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

const mcpResponse = {
    "mcpVersion": "2024.11.0",
    "name": "SakuttoWorks-Data-Normalizer",
    "description": "Secure Edge Gateway for Data Normalization.",
    "version": "1.0.0",
    "server": {
        "type": "http-proxy",
        "url": "https://api.sakutto.works",
        "endpoints": {
            "list_tools": "/v1/tools/list",
            "call_tool": "/v1/normalize_web_data"
        }
    },
    "authentication": {
        "type": "api-key",
        "header": "Authorization",
        "scheme": "Bearer",
        "instruction": "Obtain quota entitlement from https://buy.polar.sh/polar_cl_mps3G1hmCTmQWDYYEMY2G1c7sojN3Tul6IhjO4EtVuj"
    },
    "tools": [
        {
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
        }
    ]
};

app.get('/mcp', (c) => c.json(mcpResponse));
app.get('/mcp/', (c) => c.json(mcpResponse));
app.get('/.well-known/mcp.json', (c) => c.json(mcpResponse));
app.get('/v1/tools/list', (c) => c.json(mcpResponse));

// ==========================================
// 3. Middleware: Auth & KV Edge Caching [Phase 4: Step 2]
// ==========================================
app.use('/v1/*', async (c, next) => {
    // Exclude /v1/tools/list and /v1/health from authentication
    if (c.req.path === '/v1/tools/list' || c.req.path === '/v1/health') return await next();

    if (!c.env.CORE_API_URL || !c.env.INTERNAL_AUTH_SECRET) {
        console.error("[Gateway] Missing Environment Variables");
        return c.json({ error: 'Gateway Configuration Error', message: 'Upstream connection details are missing.' }, 500);
    }

    const authHeader = c.req.header('Authorization') || '';
    const rawApiKey = c.req.header('x-api-key') || authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!rawApiKey) {
        console.warn("[Security] Blocked unauthorized access attempt. Missing API Key.");
        return c.json({
            error_type: "unauthorized",
            message: "Missing API Key. Please provide a valid Polar.sh token via the 'Authorization: Bearer' header.",
            agent_instruction: "CRITICAL: You must obtain a valid Polar.sh API Key to access this infrastructure."
        }, 401);
    }

    const tenantId = await hashApiKeyToTenantId(rawApiKey);
    let customerId: string | null = null;

    // Utilize Cloudflare KV for high-availability distributed caching
    const kvCacheKey = `license_cache:${tenantId}`;
    const cachedLicense = c.env.POLAR_CACHE_KV ? await c.env.POLAR_CACHE_KV.get(kvCacheKey, 'json') : null;

    if (cachedLicense) {
        customerId = (cachedLicense as any).customer_id;
        console.log(`[Cache] KV Edge Cache HIT for tenant: ${tenantId}`);
    } else {
        console.log(`[Cache] KV Edge Cache MISS. Validating upstream for tenant: ${tenantId}`);
        const orgId = c.env.POLAR_ORGANIZATION_ID || "796ba33a-1265-445e-b034-6f3d3166095d";
        const polarApiBase = c.env.POLAR_API_URL || 'https://api.polar.sh';
        const polarRes = await fetch(`${polarApiBase}/v1/customer-portal/license-keys/validate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                organization_id: orgId,
                key: rawApiKey
            })
        });

        let data: any = {};
        try { data = await polarRes.json(); } catch (e) { }

        if (!polarRes.ok || !data.customer_id) {
            console.warn(`[Billing] Invalid License Key attempted. Status: ${polarRes.status}`);
            return c.json({
                error_type: "unauthorized",
                message: "Invalid or expired License Key.",
                agent_instruction: "CRITICAL: The provided API Key is invalid or expired. Check your Polar.sh subscription.",
                debug_polar_status: polarRes.status,
                debug_polar_response: data
            }, 401);
        }

        customerId = data.customer_id;

        // Asynchronously populate KV cache for 60 seconds (reduces Polar.sh API costs)
        if (c.env.POLAR_CACHE_KV) {
            c.executionCtx.waitUntil(
                c.env.POLAR_CACHE_KV.put(kvCacheKey, JSON.stringify(data), { expirationTtl: 60 })
            );
        }
    }

    if (customerId && c.env.POLAR_PRODUCT_ID) {
        const ingestEvent = async () => {
            try {
                const polarApiBase = c.env.POLAR_API_URL || 'https://api.polar.sh';
                const ingestUrl = `${polarApiBase}/v1/events/ingest`;
                const response = await fetch(ingestUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${c.env.POLAR_ACCESS_TOKEN}`
                    },
                    body: JSON.stringify({
                        events: [{
                            name: 'api_request',
                            customer_id: customerId,
                            metadata: {
                                product_id: c.env.POLAR_PRODUCT_ID,
                                endpoint: c.req.path
                            }
                        }]
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error(`[Billing] Polar usage ingest failed with status ${response.status}: ${errorText}`);
                }
            } catch (err) {
                console.error('[Billing] Failed to execute Polar usage ingest fetch:', err);
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
// 4. Middleware: Prompt Injection Guard (Layer A Shield)
// ==========================================
app.use('/v1/*', async (c, next) => {
    // Exclude /v1/tools/list and /v1/health from injection checks
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
                console.warn(`[Security] Blocked potential prompt injection. Tenant: ${tenantId}`);
                c.executionCtx.waitUntil(
                    dispatchAdminAlert(c.env, 'Security Alert: Prompt Injection Blocked', `A request was blocked by Layer A due to suspicious payload content.<br>Tenant: ${tenantId}`)
                );
                return c.json({
                    error_type: "compliance_violation",
                    message: "Request blocked by Edge Gateway policy due to suspicious payload content.",
                    agent_instruction: "CRITICAL: Prohibited request pattern detected. Halt this inquiry, remove instructions attempting to override system prompts, and change your approach."
                }, 403);
            }
        } catch (e) {
            // Ignore and proceed if Body is empty or not JSON
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
    const bodyClone = c.get('bodyClone') || {};

    const { subject, message, priority = 'normal' } = bodyClone;

    if (!subject || !message) {
        return c.json({
            error_type: "bad_request",
            message: "Missing required fields: 'subject' and 'message'."
        }, 400);
    }

    // Compose SLA alert template
    const alertSubject = `[Support Ticket] ${priority === 'high' ? 'URGENT - ' : ''}${subject}`;
    const alertMessage = `
        <strong>Tenant ID:</strong> ${tenantId}<br>
        <strong>Customer ID:</strong> ${customerId}<br>
        <strong>SLA Target:</strong> 48-72 hours<br><br>
        <strong>Message:</strong><br>
        <p>${message}</p>
    `;

    // Dispatch to administrators via Resend
    c.executionCtx.waitUntil(dispatchAdminAlert(c.env, alertSubject, alertMessage));

    return c.json({
        success: true,
        message: "Support ticket successfully created. Our engineering team will review and respond within our 48-72 hour SLA.",
        ticket_reference: c.get('idempotencyKey')
    });
});

// ==========================================
// 6. Proxy Layer (Bridge to Cloud Run Core)
// ==========================================
app.all('/:path{(v1/.*|docs|openapi.json)}', async (c) => {
    // Stop proxying for endpoints handled directly by this Gateway
    if (c.req.path === '/v1/health' || c.req.path === '/v1/tools/list' || c.req.path === '/v1/support/ticket') {
        return;
    }

    const tenantId = c.get('tenantId') || 'anonymous_tenant';
    const idempotencyKey = c.get('idempotencyKey') || crypto.randomUUID();
    const sessionKey = c.get('sessionKey') || 'default_session';
    const bodyClone = c.get('bodyClone') || {};

    const url = new URL(c.req.url);
    const coreOrigin = c.env.CORE_API_URL.replace(/\/$/, '');
    const targetUrl = `${coreOrigin}${url.pathname}${url.search}`;

    const proxyHeaders = new Headers(c.req.raw.headers);
    proxyHeaders.delete('Host');
    proxyHeaders.delete('Cf-Connecting-Ip');

    if (c.env.INTERNAL_AUTH_SECRET) {
        proxyHeaders.set('X-Internal-Secret', c.env.INTERNAL_AUTH_SECRET);
    }
    proxyHeaders.set('X-Idempotency-Key', idempotencyKey);
    proxyHeaders.set('X-Tenant-Id', tenantId);
    proxyHeaders.set('X-Session-Key', sessionKey);

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

        let intentTag = "unknown_action";
        if (url.pathname.includes("normalize_web_data")) intentTag = "web_normalization";

        c.executionCtx.waitUntil(
            saveAuditLog(c.env, tenantId, intentTag, bodyClone, response.status)
        );

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        });

    } catch (error: any) {
        console.error(`[Proxy] Routing Error: ${error.message}`);
        c.executionCtx.waitUntil(
            dispatchAdminAlert(c.env, 'Gateway Routing Error', `The Edge Gateway failed to connect to Layer B.<br>Path: ${c.req.path}<br>Error: ${error.message}`)
        );
        return c.json({
            error_type: "api_error",
            message: "The Data Normalization Engine is currently unreachable.",
            agent_instruction: "The upstream normalization engine is temporarily down. Please wait a moment and try again."
        }, 502);
    }
});

// ==========================================
// 7. Catch-all: Route Not Found
// ==========================================
app.notFound((c) => {
    return c.json({ message: "Endpoint not found", docs: "https://sakutto.works" }, 404);
});

export default app

// ==========================================
// HTML & Text Generators
// ==========================================
function generateLandingPage() {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SakuttoWorks Data Gateway</title><style>:root { --primary: #0f172a; --bg: #f8fafc; --text: #334155; } body { font-family: sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; } .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 400px; width: 100%; text-align: center; } h1 { font-size: 1.25rem; color: var(--primary); margin-bottom: 0.5rem; } .status { display: inline-block; padding: 0.25rem 0.75rem; background: #dcfce7; color: #166534; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; margin-bottom: 1.5rem; } a { display: block; padding: 0.75rem; margin-top: 0.5rem; background: var(--bg); color: var(--primary); text-decoration: none; border-radius: 6px; font-size: 0.9rem; transition: background 0.2s; } a:hover { background: #e2e8f0; }</style></head><body><div class="card"><h1>Data Normalization Gateway</h1><div class="status">● System Operational</div><p style="font-size: 0.9rem; margin-bottom: 1.5rem;">Secure entry point for Project GHOST SHIP.<br>Authentication required for all API calls.</p><a href="/docs">📜 API Documentation (Swagger)</a><a href="/llms.txt">📂 View Technical Specs (llms.txt)</a><a href="https://sakutto.works">🌐 Project Home</a></div></body></html>`;
}