# Barebones MCP TODOs

Objectives

- Keep the MCP layer transport-focused and inference-free while exposing raw Jira and Perplexity data.
- Ensure the default tool surface remains minimal and predictable for downstream integrations.

Architecture Cleanup

- Extract optional lane/aggregation utilities into separate modules so the base server ships only essential data fetchers.
- Remove any hidden coupling between core tools and bridge-specific logic; treat the bridge as an external consumer.

Transport Separation

- Split HTTP transport setup into `src/transports/http.js` (or similar) and gate it with configuration to slim down stdio-only deployments.
- Document when to enable HTTP and how auth tokens are validated.

Data Contracts

- Introduce shared JSON schemas (e.g., Zod/TypeBox) that describe tool responses without forcing opinionated summaries.
- Publish canonical examples of `fetch_ticket`, `fetch_jira_ticket`, `searchBoardsFull`, and `fetch_perplexity_data` payloads for bridge consumers.

Observability & Operations

- Add structured logging with per-tool timing and upstream status codes; expose recent failures via `/health`.
- Consider exporting Prometheus-style metrics for fetch counts, latency, and error rate.

Perplexity Proxy Enhancements

- Support key rotation or multi-key pools via configuration or auth context.
- Make cache strategy pluggable and allow full upstream JSON passthrough when downstream needs untouched responses.
- Tighten error messaging so clients can distinguish auth, quota, and network failures programmatically.

Developer Workflow

- Provide a quick-start guide covering stdio smoke tests, HTTP calls, and bridge integration loops.
- Add mocked integration tests (recorded Jira/Perplexity responses) so `npm test` runs without live credentials.
- Create a config validation CLI that checks `.env` entries and prints the active tool catalog for deployments.
