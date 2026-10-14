// Production entry: `node server.js` (wraps adapter-node's build/index.js).
// adapter-node 6 dropped the ORIGIN variable: it builds each request's origin from headers
// and assumes https. Pin the origin to PUBLIC_URL instead, so form CSRF checks and
// absolute URLs match on plain-http localhost and behind a TLS proxy alike.
const pub = new URL(process.env.PUBLIC_URL || 'http://localhost:3000');
process.env.PROTOCOL_HEADER = 'x-nib-origin-proto';
process.env.HOST_HEADER = 'x-nib-origin-host';

const { server } = await import('./build/index.js');
server.prependListener('request', (req) => {
  req.headers['x-nib-origin-proto'] = pub.protocol.slice(0, -1);
  req.headers['x-nib-origin-host'] = pub.host;
});
