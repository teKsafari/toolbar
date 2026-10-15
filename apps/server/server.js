// Production entry: `node server.js` (wraps adapter-node's build/index.js).
// adapter-node 6 dropped the ORIGIN variable: it builds each request's origin from headers
// and assumes https. Pin the origin to PUBLIC_URL instead, so form CSRF checks and
// absolute URLs match on plain-http localhost and behind a TLS proxy alike.
const pub = new URL(process.env.PUBLIC_URL || 'http://localhost:3000');
process.env.PROTOCOL_HEADER = 'x-toolbar-origin-proto';
process.env.HOST_HEADER = 'x-toolbar-origin-host';

const { server } = await import('./build/index.js');
server.prependListener('request', (req) => {
  req.headers['x-toolbar-origin-proto'] = pub.protocol.slice(0, -1);
  req.headers['x-toolbar-origin-host'] = pub.host;
  // Kit 3's CSRF check refuses POST/PUT/PATCH/DELETE with a form-like or missing Content-Type
  // unless Origin is this server: that blocks the extension's multipart asset uploads
  // (Origin chrome-extension://...) and every curl or CLI DELETE (no Origin). A request that
  // authenticates with a bearer token cannot be forged by another site (browsers never attach one
  // on their own), so it counts as same-origin. Cookie requests keep the check.
  if (/^Bearer\s/i.test(req.headers.authorization ?? '')) req.headers.origin = pub.origin;
  // MCP OAuth token and revoke requests are form posts from agents without an Origin and without
  // cookies (PKCE or client secret only), so CSRF does not apply to them (agent area).
  else if (/^\/mcp\/(token|revoke)(\?|$)/.test(req.url ?? '')) req.headers.origin = pub.origin;
});
