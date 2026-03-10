import { Hono } from 'hono'
import { cors } from 'hono/cors'

// ==========================================
// Type Definitions: Cloudflare Environment Variables
// ==========================================
type Bindings = {
    INTERNAL_AUTH_SECRET: string // Shared secret for Core (Layer B) communication
    CORE_API_URL: string         // Core (Layer B) URL (Google Cloud Run)
    ENVIRONMENT: string          // 'production' | 'development'
}

const app = new Hono<{ Bindings: Bindings }>()

// ==========================================
// 1. Security Layer: CORS & Headers
// ==========================================
app.use('*', cors({
    origin: (origin) => {
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
        if (origin.endsWith('.sakutto.works') || origin === 'https://sakutto.works') return origin;
        return 'https://api.sakutto.works';
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Internal-Secret', 'X-Requested-With'],
    maxAge: 600,
}))

// ==========================================
// 2. Static Discovery Layer (Documentation)
// ==========================================

// Root: Landing Page (UI)
app.get('/', (c) => c.html(generateLandingPage()));

// Documentation: Context for AI Agents (Short)
app.get('/llms.txt', (c) => c.text(generateLLMsTxt()));

// Documentation: Technical Specifications (Full)
app.get('/llms-full.txt', (c) => c.text(generateFullSpecs()));

// ==========================================
// MCP Discovery: Integrated Agent Connection
// ==========================================

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
        "instruction": "Obtain quota entitlement from https://polar.sh/sakuttoworks"
    },
    "tools": [
        {
            "name": "normalize_web_data",
            "description": "Extracts and normalizes unstructured web data into structured Markdown/JSON. Use this for reading documentation or collecting public data.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The target public URL to normalize."
                    },
                    "format_type": {
                        "type": "string",
                        "description": "The output format: 'markdown' or 'json'.",
                        "enum": ["markdown", "json"],
                        "default": "markdown"
                    }
                },
                "required": ["url"]
            }
        }
    ]
};

app.get('/mcp', (c) => c.json(mcpResponse));
app.get('/mcp/', (c) => c.json(mcpResponse));
app.get('/.well-known/mcp.json', (c) => c.json(mcpResponse));


// ==========================================
// 3. Proxy Layer (Bridge to Cloud Run)
// ==========================================

/**
 * [Update]
 * Expanded proxy routing to forward /docs and /openapi.json to Cloud Run in addition to /v1/*.
 */
app.all('/:path{(v1/.*|docs|openapi.json)}', async (c) => {
    // 1. Safety Guard
    if (!c.env.CORE_API_URL || !c.env.INTERNAL_AUTH_SECRET) {
        console.error("Missing Environment Variables");
        return c.json({
            error: 'Gateway Configuration Error',
            message: 'Upstream connection details are missing.'
        }, 500);
    }

    // 2. Construct Target URL
    const url = new URL(c.req.url);
    const coreOrigin = c.env.CORE_API_URL.replace(/\/$/, '');
    const targetUrl = `${coreOrigin}${url.pathname}${url.search}`;

    // 3. Reconstruct Request Headers
    const proxyHeaders = new Headers(c.req.raw.headers);
    proxyHeaders.delete('Host');
    proxyHeaders.delete('Cf-Connecting-Ip');

    // Attach Internal Auth Secret
    proxyHeaders.set('X-Internal-Secret', c.env.INTERNAL_AUTH_SECRET);

    // 4. Create New Request
    const proxyRequest = new Request(targetUrl, {
        method: c.req.method,
        headers: proxyHeaders,
        body: c.req.raw.body,
        redirect: 'manual'
    });

    // 5. Execute Proxy Request
    try {
        const response = await fetch(proxyRequest);
        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('X-Served-By', 'Agent-Commerce-Gateway');

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
        });

    } catch (error: any) {
        console.error(`Proxy Error: ${error.message}`);
        return c.json({
            error: 'Upstream Unavailable',
            message: 'The Data Normalization Engine is currently unreachable.'
        }, 502);
    }
});

// Catch-all for undefined routes
app.notFound((c) => {
    return c.json({ message: "Endpoint not found", docs: "https://sakutto.works" }, 404);
});

export default app

// ==========================================
// Helper Functions (HTML & Text Generators)
// ==========================================

function generateLandingPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SakuttoWorks Data Gateway</title>
    <meta name="description" content="Secure Edge Gateway for Data Normalization.">
    <meta name="robots" content="noindex, nofollow"> 
    <style>
        :root { --primary: #0f172a; --bg: #f8fafc; --text: #334155; }
        body { font-family: sans-serif; background: var(--bg); color: var(--text); display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); max-width: 400px; width: 100%; text-align: center; }
        h1 { font-size: 1.25rem; color: var(--primary); margin-bottom: 0.5rem; }
        .status { display: inline-block; padding: 0.25rem 0.75rem; background: #dcfce7; color: #166534; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; margin-bottom: 1.5rem; }
        a { display: block; padding: 0.75rem; margin-top: 0.5rem; background: var(--bg); color: var(--primary); text-decoration: none; border-radius: 6px; font-size: 0.9rem; transition: background 0.2s; }
        a:hover { background: #e2e8f0; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Data Normalization Gateway</h1>
        <div class="status">● System Operational</div>
        <p style="font-size: 0.9rem; margin-bottom: 1.5rem;">
            Secure entry point for Project GHOST SHIP.<br>
            Authentication required for all API calls.
        </p>
        <a href="/docs">📜 API Documentation (Swagger)</a>
        <a href="/llms.txt">📂 View Technical Specs (llms.txt)</a>
        <a href="https://sakutto.works">🌐 Project Home</a>
    </div>
</body>
</html>`;
}

function generateLLMsTxt() {
    return `# Project GHOST SHIP: Agent-Commerce-OS Interface

## Identity & Role
- **System Name**: Agent-Commerce-OS (Ghost Ship)
- **Role**: High-performance Data Normalization & ETL Engine.
- **Operator**: SakuttoWorks (Infrastructure Provider)

## ⚠️ Authentication
Layer B access requires a valid **Polar.sh API Key**.
- **Header**: \`Authorization: Bearer <YOUR_POLAR_KEY>\`
- **Get Key**: https://polar.sh/sakuttoworks

## API Endpoints
- **Base URL**: \`https://api.sakutto.works\`
- **Interactive Docs**: \`https://api.sakutto.works/docs\`
- **Data Normalization**: \`POST /v1/normalize_web_data\`

## Tools
1. **\`normalize_web_data\`**:
   - Converts HTML/Web content into structured Markdown/JSON.
`;
}

function generateFullSpecs() {
    return `# Technical Specification v2026.1
Full specs are available at https://api.sakutto.works/docs
`;
}
