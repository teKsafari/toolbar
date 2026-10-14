// CORS for the MCP endpoint and the OAuth endpoints: browser-based MCP clients call them from
// other origins. None of them reads cookies, so allowing any origin exposes nothing.
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version, mcp-session-id',
  'access-control-max-age': '86400',
};

export function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });
