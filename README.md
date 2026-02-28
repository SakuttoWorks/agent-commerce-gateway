# Agent-Commerce-Gateway | The Intelligent Edge
**The high-performance entry point and monetization layer for Agent-Commerce-OS.**

## 🛡️ Role in Ecosystem
**Agent-Commerce-Gateway** is the "Edge Layer" (Layer A) of the Project GHOST SHIP infrastructure. Running on Cloudflare Workers, it acts as the intelligent security guard and protocol translator:

- **Auth & Billing**: Real-time license validation via Polar.sh and Lemon Squeezy.
- **MCP Aggregation**: Providing a unified SSE (Server-Sent Events) endpoint for AI agents.
- **Traffic Control**: Intelligent rate-limiting and audit logging (A2A logging).

## 🛠️ Tech Stack (Edge Specifications)
- **Runtime**: Cloudflare Workers (Python Compatibility).
- **Protocol**: MCP (Model Context Protocol) over SSE.
- **Monetization**: Integrated with **Polar.sh** (Metered Billing) and **Lemon Squeezy**.
- **Data Layer**: Edge caching via Upstash Redis.

## 🤖 Discovery for Agents
- **Discovery Endpoint**: Technical specs are hosted at [sakutto.works/llms.txt](https://sakutto.works/llms.txt).
- **MCP Server**: Definition found at `https://api.sakutto.works/mcp/`.

## 🔗 Architecture Links
- [**agent-commerce-portal**](https://github.com/SakuttoWorks/agent-commerce-portal) - Discovery & Documentation.
- [**agent-commerce-core**](https://github.com/SakuttoWorks/agent-commerce-core) - The Factory (Execution Layer).

---
© 2026 Sakutto Works - Enabling the Autonomy of Tomorrow.
