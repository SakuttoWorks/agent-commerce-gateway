# 🏴‍☠️ Agent-Commerce-Gateway (Layer A: Edge Gateway)

![Status](https://img.shields.io/badge/Status-Active-success)
![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange)
![License](https://img.shields.io/badge/License-MIT-blue)
![Compliance](https://img.shields.io/badge/Compliance-EU%20AI%20Act-green)
[![Get API Key](https://img.shields.io/badge/Get_API_Key-Polar.sh-blue?style=flat)](https://buy.polar.sh/polar_cl_mps3G1hmCTmQWDYYEMY2G1c7sojN3Tul6IhjO4EtVuj)
[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?style=flat&logo=github)](https://github.com/sponsors/SakuttoWorks)

> **High-performance HTTP Proxy and Defense-in-Depth Edge Layer for Project GHOST SHIP.**

**Architecture Scope:** Project GHOST SHIP is built on a unified three-tier architecture: **Layer A** (Edge Gateway), **Layer B** (Core Engine), and **Layer C** (MCP Server). This repository contains **Layer A**. It performs zero data processing; instead, it serves exclusively as the perimeter defense, authentication verifier, and billing interceptor before routing secure traffic to the internal normalization engine.

---

## ✨ Core Features
* **AI Agent Ready:** Native support for Model Context Protocol (MCP) tool discovery and API key authentication.
* **Zero-Trust Edge Security:** Actively blocks Prompt Injection attempts (e.g., `ignore previous instructions`) before they hit the core engine.
* **Metered Billing Integration:** Seamless integration with Polar.sh for latency-free, asynchronous usage tracking.
* **Global Edge Caching:** Utilizes Cloudflare KV to cache Polar.sh API validations, dramatically reducing upstream latency and redundant external API calls.
* **EU AI Act Compliant Transparency Logging:** Automatically generates enterprise-grade audit trails with "Intent Watermarks" and native PII masking, securely stored in Cloudflare R2.
* **High Availability:** Built on Cloudflare Workers with Smart Placement for minimal latency routing to Google Cloud Run.
* **Asynchronous SLA Routing:** Intelligent routing capabilities at the Edge Layer designed to support and manage long-running tasks requiring asynchronous fulfillment (48-72 hour SLA).
* **Dynamic Rate Limiting:** Built-in protection against infinite loop resource exploitation via Cloudflare Workers Rate Limiting (429 Too Many Requests).
* **Autonomous Error Resolution:** Native 402 Payment Required handling with embedded top-up URLs, allowing AI agents to guide users through budget deficits without human support intervention.

---

## 🛡️ Role in Infrastructure (Defense in Depth)

We employ a **Zero-Trust Hybrid Architecture** to ensure speed, security, and scalability. The Edge Gateway (Layer A) enforces a strict perimeter defense by actively authenticating requests and rejecting unauthorized traffic. Only fully validated requests are enriched with `X-Internal-Secret` and `X-Tenant-Id` headers before being securely proxied to the Core Engine (Layer B), which drops any direct traffic lacking these internal signatures.

```mermaid
graph TD
    A[🤖 AI Agent / Client] -->|HTTP POST| B(Layer A: Edge Gateway)
    B -->|1. Auth Validate| Cache[(CF Cache)]
    B -->|2. Rate Limiter| Rate{Limit Exceeded?}
    Rate -->|Yes| 429[Drop: 429 Too Many Requests]
    Rate -->|No| Shield{Prompt Injection?}
    Shield -->|Yes| 403[Drop: 403 Forbidden]
    Shield -->|No| C[3. Inject X-Internal-Secret]
    C -->|Proxy Request| D(Layer B: Core Engine)
    C -.->|4. executionCtx.waitUntil| P[Polar.sh Metered Billing]
```

---

## 💸 Asynchronous Metered Billing
Billing is handled natively at the edge, ensuring zero latency overhead for AI agent requests.

* **Validation:** Extracts the API key from the `Authorization: Bearer` header and verifies it via a highly available **Cloudflare KV Edge Cache** (falling back to Polar.sh on cache misses) for ultra-low latency authentication..
* **Proxy Routing:** Securely forwards the validated request to Layer B.
* **Event Ingestion:** Leverages Cloudflare's `executionCtx.waitUntil()` to asynchronously dispatch an `api_request` event to the Polar.sh Metering API. Uses the latest Polar.sh SDK standards to ensure highly reliable and accurate per-call usage tracking without blocking the user response.
* **Resilience:** In the event of a billing telemetry failure, the agent still receives the normalized data, guaranteeing 100% user-facing uptime.

---

## 🧪 End-to-End Observability & Audit Logs
The infrastructure maintains strict privacy-safe logging to R2 buckets, ensuring full observability while adhering to data protection standards. It has undergone rigorous manual security and functional validation.

### ✅ Normal Traffic (200 OK)
Successfully validates the Polar.sh key, appends Zero-Trust headers, proxies to Layer B, and logs the execution.

```json
{
  "metadata": {
    "log_id": "beebdda9-2526-42c9-828f-e2ef7f3b9699",
    "timestamp": "2026-04-11T10:00:00.000Z",
    "tenant_id": "89286fb3507612f3c7fd1b96b311977c",
    "system_version": "GhostShip-Gateway/2.0",
    "processing_region": "global-edge"
  },
  "intent_watermark": {
    "purpose": "web_normalization",
    "automated_decision_making": false,
    "human_oversight_required": false
  },
  "execution": {
    "upstream_status": 200,
    "masked_payload": {
      "url": "https://example.com",
      "format_type": "json"
    }
  },
  "compliance": {
    "data_retention_policy": "30_days",
    "pii_masked": true
  }
}
```

---

## 🚫 Prompt Injection Guard (403 Forbidden)
Successfully intercepts and drops malicious payloads (e.g., "ignore previous instructions") at the edge. This ensures zero compute cost and zero load on Layer B for non-compliant requests.

## 🚦 Autonomous Rate Limiting & Billing (429 & 402)
Designed specifically for AI Agent integration, the Gateway returns explicit instructions and recovery URLs inside the payload. This allows LLMs to self-correct or prompt the human user for billing resolution automatically.

### 💸 Budget Deficit (402 Payment Required)
```json
{
  "error_type": "payment_required",
  "message": "Quota exceeded or subscription inactive. Payment required.",
  "agent_instruction": "CRITICAL: Budget deficit. To continue, you must resolve the payment issue by visiting the top-up URL.",
  "top_up_url": "https://buy.polar.sh/..."
}
```

### 🛑 Rate Limit Breached (429 Too Many Requests)
```json
{
  "error_type": "too_many_requests",
  "message": "Rate limit exceeded. System protection engaged to prevent resource exploitation.",
  "agent_instruction": "CRITICAL: You are executing operations too rapidly or are caught in an infinite loop. Halt immediately and back off."
}
```

### 🛑 Blocked Traffic (403 Forbidden)
```json
{
  "timestamp": "2026-03-XXT10:05:12Z",
  "level": "WARN",
  "event": "security_violation",
  "reason": "Prompt Injection Attempt Blocked",
  "tenant_id": "anonymous_tenant",
  "status": 403
}
```

---

## 💻 API Usage Example
Once deployed, or when using the official managed endpoint, you must pass your Polar.sh API key as a Bearer token to bypass the Edge Gateway defense.

```bash
curl -X POST "https://api.sakutto.works/v1/normalize_web_data" \
     -H "Authorization: Bearer <YOUR_POLAR_API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://sakutto.works", "format_type": "markdown"}'
```

---

## 🛠️ Tech Stack (Edge Specifications)
* **Runtime:** Cloudflare Workers (TypeScript)
* **Framework:** Hono
* **Protocol:** HTTP Proxy (MCP Compatible)
* **Security:** Prompt Injection Shield, R2 Privacy-Safe Audit Logging, Strict CORS.

---

## 📑 Table of Contents
- [Core Features](#-core-features)
- [Role in Infrastructure (Defense in Depth)](#️-role-in-infrastructure-defense-in-depth)
- [Asynchronous Metered Billing](#-asynchronous-metered-billing)
- [End-to-End Observability & Audit Logs](#-end-to-end-observability--audit-logs)
- [Prompt Injection Guard (403 Forbidden)](#-prompt-injection-guard-403-forbidden)
- [Tech Stack (Edge Specifications)](#️-tech-stack-edge-specifications)

---

## ⚡ Quick Start

### Prerequisites
- **Node.js**: >= 18.0.0
- **Wrangler CLI**: Installed globally (`npm install -g wrangler`)

### 1. Install Dependencies
```bash
npm install
```

### Environment Variables & Secrets

Configuration is split between public environment variables (configured directly in `wrangler.toml`) and secure secrets (managed via `.dev.vars` for local development or Cloudflare Secrets for production).

**1. Public Variables (`wrangler.toml`)**
| Variable | Description |
| :--- | :--- |
| `CORE_API_URL` | The target base URL for the Layer B Core Engine (e.g., Google Cloud Run). |
| `ENVIRONMENT` | The execution environment context (e.g., `production`). |
| `POLAR_ORGANIZATION_ID` | Your Polar.sh Organization ID. |
| `POLAR_PRODUCT_ID` | Your Polar.sh Product ID for metered billing integration. |

**2. Secure Secrets (`.dev.vars` / Cloudflare Secrets)**
| Variable | Description |
| :--- | :--- |
| `INTERNAL_AUTH_SECRET` | Shared secret for securely authenticating Edge (Layer A) to Core (Layer B). |
| `RESEND_API_KEY` | API key for dispatching asynchronous admin security alerts via Resend. |
| `POLAR_ACCESS_TOKEN` | Polar.sh API Token for validating licenses and ingesting billing events. |
| `POLAR_WEBHOOK_SECRET` | Secret for verifying incoming webhooks from Polar.sh (e.g., subscription updates or metering validation). |

### 2. Local Development & Infrastructure Setup

**Step 2a: Create Infrastructure Bindings (R2 & KV)**
Before running or deploying, you must create the required R2 bucket for audit logs and the KV namespace for edge caching.

1. Create the R2 Bucket:
```bash
npx wrangler r2 bucket create ghost-ship-logs
```

2. Create the KV Namespace:
```bash
npx wrangler kv namespace create POLAR_CACHE_KV
```
*(Note: After creating the KV namespace, copy the generated `id` and update the `[[kv_namespaces]]` section in your `wrangler.toml`).*

**Step 2b: Configure Secrets**
Create a `.dev.vars` file in the root directory. You must supply the following required secrets to mirror the production environment:
```ini
INTERNAL_AUTH_SECRET="your_core_auth_secret"
RESEND_API_KEY="your_resend_key"
POLAR_ACCESS_TOKEN="your_polar_token"
POLAR_WEBHOOK_SECRET="your_polar_webhook_secret"
```

**Start the local development server:**
```bash
npm run dev
```

### 3. Deploy to Production
Ensure your Cloudflare Workers secrets are securely set via the Cloudflare Dashboard or by using `npx wrangler secret put <KEY>`, then deploy using the predefined npm script:
```bash
npm run deploy
```

---

## 🤝 Contributing
We welcome contributions from the global open-source community! 

### How to Contribute
1. **Fork the Repository:** Create your own branch (`feature/your-feature` or `fix/your-fix`).
2. **Local Testing:** Ensure you have tested your changes locally using the Cloudflare Workers Edge environment (`npm run dev`).
3. **Commit Standards:** Write clear, concise commit messages.
4. **Submit a PR:** Open a Pull Request against the `main` branch with a detailed description of your changes.

For major architectural changes, please open an Issue first to discuss your proposal with the core maintainers.

---

## 🤖 Discovery for Agents

* **Interactive Docs (Swagger)**: Human-readable API specs at [https://api.sakutto.works/docs](https://api.sakutto.works/docs).
* **Discovery Endpoint**: Canonical technical specs are hosted at the portal [https://sakutto.works/llms.txt](https://sakutto.works/llms.txt) and [https://sakutto.works/openapi.yaml](https://sakutto.works/openapi.yaml). (Edge Gateway redirects automatically).
* **MCP Server Definition**: Automated discovery at [https://api.sakutto.works/.well-known/mcp.json](https://api.sakutto.works/.well-known/mcp.json).

---

## ⚖️ Legal & Compliance
This service is a pure data processing infrastructure, **NOT** an advisory service.  
Please read our [LEGAL.md](LEGAL.md) carefully.

* We do **NOT** provide analytical predictions, automated decision-making, or specialized advisory.
* We do **NOT** maintain proprietary databases or closed-source intelligence feeds.
* The "Commerce" in our name refers strictly to our API Metered Billing Infrastructure for developers.

---

## 🔗 Ecosystem & Architecture Links
* [Official Portal](https://sakutto.works) - Documentation & Discovery Hub.
* [SakuttoWorks GitHub Profile](https://github.com/SakuttoWorks/SakuttoWorks) - Maintainer Profile & Organization Info.
* [agent-commerce-portal](https://github.com/SakuttoWorks/agent-commerce-portal) - Portal Source Code.
* [agent-commerce-gateway](https://github.com/SakuttoWorks/agent-commerce-gateway) - This Repository (Layer A: Edge Gateway).
* [agent-commerce-core](https://github.com/SakuttoWorks/agent-commerce-core) - Data Normalization Engine (Layer B).
* [ghost-ship-mcp-server](https://github.com/SakuttoWorks/ghost-ship-mcp-server) - Official MCP Server (Layer C).
* [Get API Key (Polar.sh)](https://buy.polar.sh/polar_cl_mps3G1hmCTmQWDYYEMY2G1c7sojN3Tul6IhjO4EtVuj) - Quota Purchase & API Key Generation.

---

## 💖 Support the Project

If Agent-Commerce-OS has saved you engineering hours or helped scale your AI workflows, please consider becoming a sponsor or leaving a one-time tip. Your contributions directly fund our server costs, ensure high-availability of the Edge Gateway, and fuel continuous open-source development.

[![Support via Polar.sh](https://img.shields.io/badge/Support_via-Polar.sh-blue?style=for-the-badge)](https://buy.polar.sh/polar_cl_ZI9H5fL8dQqcormOadiGDFDpS2Sxd1jT05jTX1vStWi)
[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub-ea4aaa?style=for-the-badge&logo=github)](https://github.com/sponsors/SakuttoWorks)


© 2026 Sakutto Works - *Standardizing the Semantic Web for Agents.*

---

## 📄 License

This project is open-source and licensed under the [MIT License](LICENSE).