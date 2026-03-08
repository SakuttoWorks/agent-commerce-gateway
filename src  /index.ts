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
        // Allow local development environment
        if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return origin;
        // Allow production environment (sakutto.works and subdomains)
        if (origin.endsWith('.sakutto.works') || origin === 'https://sakutto.works') return origin;
        // Block others (Return production URL as valid origin to effectively reject browser access)
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
app.get('/', (c) => {
    return c.html(generateLandingPage());
});

// Documentation: Context for AI Agents (Short)
app.get('/llms.txt', (c) => {
    return c.text(generateLLMsTxt());
});

// Documentation: Technical Specifications (Full)
app.get('/llms-full.txt', (c) => {
    return c.text(generateFullSpecs());
});

// ==========================================
// MCP Discovery: Integrated Agent Connection
// ==========================================

// Hardcoded MCP definition data
const mcpResponse = {
    "mcpVersion": "2026.1.0",
    "name": "SakuttoWorks-Agent-Commerce-OS",
    "description": "Secure Edge Gateway for Data Normalization.",
    "version": "1.0.0",
    "server": {
        "type": "http-proxy",
        "url": "https://api.sakutto.works",
        "endpoints": {
            "list_tools": "/api/v1/tools/list",
            "call_tool": "/api/v1/tools/call"
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
            "name": "analyze_intent",
            "description": "[CORE] Parses natural language into structured JSON execution plans for data retrieval.",
            "inputSchema": {
                "type": "object",
                "properties": { "prompt": { "type": "string" } },
                "required": ["prompt"]
            }
        },
        {
            "name": "search_data",
            "description": "High-fidelity autonomous research tool. Performs deep web scraping and returns structured Markdown/JSON.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "depth": { "type": "string", "enum": ["standard", "deep"] }
                },
                "required": ["query"]
            }
        },
        {
            "name": "structured_data_etl",
            "description": "Extracts and normalizes numerical data tables via Agent-Commerce-Core. Provides structured outputs for data science tasks.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dataset_identifier": {
                        "type": "string",
                        "description": "The target identifier (e.g., tech_specs, version_history) for the data set to process."
                    }
                },
                "required": ["dataset_identifier"]
            }
        }
    ]
};

// Route all MCP discovery patterns
app.get('/mcp', (c) => c.json(mcpResponse));
app.get('/mcp/', (c) => c.json(mcpResponse));
app.get('/.well-known/mcp.json', (c) => c.json(mcpResponse));


// ==========================================
// 3. Proxy Layer (Bridge to Cloud Run)
// ==========================================

app.all('/api/*', async (c) => {
    // 1. Safety Guard: Check Environment Variables
    if (!c.env.CORE_API_URL || !c.env.INTERNAL_AUTH_SECRET) {
        console.error("Missing Environment Variables");
        return c.json({
            error: 'Gateway Configuration Error',
            message: 'Upstream connection details are missing.'
        }, 500);
    }

    // 2. Construct Target URL (Prevent double slashes)
    const url = new URL(c.req.url);
    const coreOrigin = c.env.CORE_API_URL.replace(/\/$/, ''); // Remove trailing slash
    // Preserve path and query
    const targetUrl = `${coreOrigin}${url.pathname}${url.search}`;

    // 3. Reconstruct Request Headers
    const proxyHeaders = new Headers(c.req.raw.headers);
    proxyHeaders.delete('Host');
    proxyHeaders.delete('Cf-Connecting-Ip'); // Remove if necessary

    // Attach Internal Auth Secret (Verified by Core)
    proxyHeaders.set('X-Internal-Secret', c.env.INTERNAL_AUTH_SECRET);

    // 4. Create New Request
    const proxyRequest = new Request(targetUrl, {
        method: c.req.method,
        headers: proxyHeaders,
        body: c.req.raw.body,
        redirect: 'manual' // Let client handle redirects
    });

    // 5. Execute Proxy Request to Cloud Run
    try {
        const response = await fetch(proxyRequest);

        // Sanitize Response Headers (Gateway manages CORS, so we can filter others)
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
            message: 'The Core Engine (Layer B) is currently unreachable. Please try again later.'
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
    <title>Project GHOST SHIP | Data Gateway</title>
    <meta name="description" content="Secure Edge Gateway for Agent-Commerce-OS. Handles protocol translation and quota management.">
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
        <h1>Agent-Commerce-Gateway</h1>
        <div class="status">● System Operational</div>
        <p style="font-size: 0.9rem; margin-bottom: 1.5rem;">
            Secure entry point for Project GHOST SHIP.<br>
            Authentication required for all API calls.
        </p>
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
- **Role**: High-performance Data Normalization & Intent Extraction Engine.
- **Operator**: SakuttoWorks (Infrastructure Provider)

## ⚠️ Critical: Authentication Strategy
To access Layer B (Core Engine) functions, you MUST provide a valid **Polar.sh API Key**.
- **Header Format**: \`Authorization: Bearer <YOUR_POLAR_KEY>\`
- **Behavior**: Requests without this header will be rejected by the Edge Gateway (Layer A) with \`401 Unauthorized\`.
- **Get Key**: https://polar.sh/sakuttoworks

## API Endpoints (Hybrid Architecture)
- **Base URL**: \`https://api.sakutto.works\`
- **MCP Discovery**: \`https://api.sakutto.works/.well-known/mcp.json\`
  - Use this for automated tool discovery in Cursor/Claude Desktop.
- **Intent Analysis (Layer B)**: \`POST /api/v1/agent/analyze\`
  - The primary brain. Parses user prompts into actionable plans.

## Available Tools (MCP)
1. **\`analyze_intent\`**:
   - Parses unstructured prompts to identify necessary data formatting steps.
2. **\`search_data\` (Tavily Integrated)**:
   - Performs autonomous deep-web research and returns RAG-optimized markdown.
3. **\`structured_data_etl\`**:
   - Extracts and normalizes numerical data tables using Python/Pandas on Cloud Run.

## Architecture Context (For Debugging)
- **Layer A (Edge)**: Cloudflare Workers. Handles Auth & Routing.
- **Layer B (Core)**: Google Cloud Run (Python 3.12+). Handles Heavy Compute.
- **Compliance**: EU AI Act compliant. Logs are encrypted (A2A Logging).

## Documentation
- **Full Specs**: \`/llms-full.txt\` (Schema definitions)
- **Source Code**: https://github.com/SakuttoWorks/agent-commerce-gateway
`;
}

function generateFullSpecs() {
    return `# Project GHOST SHIP: Full Technical Specification (v2026.1)

> This document defines the I/O schemas and compliance protocols for the Agent-Commerce-OS Core Engine.

## 1. Governance & Security (Zero Trust)
- **Rate Limiting**: Enforced at Edge (Layer A). 
  - Free Tier: 5 requests/min.
  - Pro Tier: 60 requests/min (via Polar.sh entitlement).
- **Header Requirement**: 
  - \`Authorization: Bearer <POLAR_TOKEN>\`
  - \`Content-Type: application/json\`

## 2. Core API Schemas (Layer B)

The Core Engine uses strictly typed Pydantic v3 models. Agents MUST adhere to these JSON structures.

### Endpoint: POST /api/v1/agent/analyze

#### Request Schema (Input)
\`\`\`json
{
  "prompt": "Extract the latest API version and breaking changes from the Next.js documentation.", // (Required) Raw intent
  "model": "gemini-3-flash", // (Optional) Default: gemini-3-flash
  "context": {                // (Optional) Previous conversation state
    "session_id": "uuid-v4",
    "history": [] 
  }
}
\`\`\`

#### Response Schema (Output)
\`\`\`json
{
  "intent_id": "evt_123456789",
  "analysis": {
    "primary_intent": "data_extraction",
    "complexity_score": 0.85,  // 0.0 to 1.0
    "suggested_tools": ["search_data", "structured_data_etl"]
  },
  "plan": [
    {
      "step": 1,
      "tool": "search_data",
      "query": "Next.js 16 breaking changes"
    },
    {
      "step": 2,
      "tool": "generate_report",
      "format": "markdown"
    }
  ],
  "usage": {
    "compute_units": 15,    // Abstracted usage metric
    "tokens": 450,
    "processing_ms": 120
  }
}
\`\`\`

## 3. Error Handling Codes

| Code | Meaning | Agent Action |
| :--- | :--- | :--- |
| **400** | Bad Request | Check JSON schema against the Request Schema above. |
| **401** | Unauthorized | Renew Polar.sh API Key. |
| **402** | Quota Exceeded | Usage limit reached. Check entitlement status. |
| **429** | Too Many Requests | Backoff for 5-10 seconds. |
| **502** | Bridge Error | Layer B (Cloud Run) is cold booting. Retry in 3s. |

## 4. Compliance & Privacy (EU AI Act)
- **Data Residency**: All compute occurs in \`asia-northeast1\` (Tokyo, Japan).
- **Retention**: Input prompts are discarded after processing unless "Memory Mode" is explicitly enabled.
- **A2A Logging**: All tool executions are logged to Supabase for audit trails (encrypted at rest).
- **No Training**: User data is NEVER used to train the underlying Gemini models.
`;
}
