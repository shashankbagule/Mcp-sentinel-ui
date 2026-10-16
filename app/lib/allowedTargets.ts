// Single source of truth for which MCP servers this app will scan.
//
// Previously this list only existed in app/page.tsx as suggestion chips —
// nothing server-side ever checked it. /api/scan/start trusted n8n's
// "Scope Guardrail" node to be the actual enforcement, but a live test
// (submitting http://127.0.0.1:3002/mcp, which was never on this list)
// showed that guardrail does not block unlisted targets: the scan ran to
// completion and actively invoked tools on it. See SECURITY_AUDIT.md,
// finding #2.
//
// Until that n8n-side gap is found and fixed directly, this list is
// enforced here too — server-side, before the webhook is ever called —
// so the UI's suggestion list and the actual authorization check can't
// drift apart again.

export const ALLOWED_TARGETS = [
  "https://vulnerablemcp.onrender.com/mcp",
  "https://shashankbagule.app.n8n.cloud/mcp/7366dacd-9061-42d4-a563-9585c0af932b",
  "http://172.17.0.1:8000/mcp",
  "http://127.0.0.1:8000/mcp",
  "http://192.168.0.103:8000/mcp",
  "https://example-server.modelcontextprotocol.io/mcp",
  "http://127.0.0.1:9000/mcp",
  "http://127.0.0.1:8001/sse",
];

export function isAllowedTarget(url: string): boolean {
  return ALLOWED_TARGETS.includes(url);
}
