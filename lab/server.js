// Production server for the lab app: SvelteKit handler, a WebSocket on /ws,
// and a second origin on PORT+1 that serves a cross-origin image.
//
// Embed pages for e2e/embed (D-211), opt-in so every other use of the lab stays byte for byte
// the same: `?tb-embed=<key>` on any HTML page of either origin puts the embed's script tag first
// in <head> (`&tb-name=` adds data-name); `/__embed/csp?tb-embed=<key>` is a plain page behind a strict CSP (scripts from
// itself and the server only, no inline styles). The server is EMBED_SERVER, else
// http://localhost:3000.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handler } from './build/handler.js';

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';
const embedServer = (process.env.EMBED_SERVER ?? 'http://localhost:3000').replace(/\/+$/, '');

/** The embed tag a request asks for: its key, and `tb-name` as the site's name for the reviewer; or null. */
function embedRequest(req) {
	const q = new URL(req.url ?? '/', 'http://x').searchParams;
	const key = q.get('tb-embed');
	if (!key || !/^[A-Za-z0-9_-]{1,100}$/.test(key)) return null;
	const name = (q.get('tb-name') ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').slice(0, 80);
	return { key, name };
}

const embedTag = ({ key, name }) => `<script src="${embedServer}/embed.js" data-key="${key}"${name ? ` data-name="${name}"` : ''}></script>`;

/** A plain page with the tag, for the second origin and the CSP variant. */
const embedPage = (tag, title) => `<!doctype html>
<html lang="en">
<head>
${embedTag(tag)}
<meta charset="utf-8">
<title>${title}</title>
<link rel="stylesheet" href="/__embed/page.css">
</head>
<body>
<h1>${title}</h1>
<p data-testid="embed-text">Plain text a reviewer can highlight on this page.</p>
<button data-testid="embed-button" type="button">A button</button>
</body>
</html>
`;

const STRICT_CSP = [
	"default-src 'self'",
	`script-src 'self' ${embedServer}`,
	"style-src 'self'",
	`img-src 'self' data: blob: ${embedServer}`,
	`font-src 'self' ${embedServer}`,
	`connect-src 'self' ${embedServer}`,
	"media-src 'self' blob:",
].join('; ');

/** The SvelteKit page with the tag first in <head>: buffers the HTML answer, leaves the rest alone. */
function withEmbed(req, res, tag) {
	const chunks = [];
	const writeHead = res.writeHead.bind(res);
	const write = res.write.bind(res);
	const end = res.end.bind(res);
	let head = null;
	const isHtml = () => /text\/html/.test(String(res.getHeader('content-type') ?? '')) && !res.getHeader('content-encoding');
	res.writeHead = (status, ...rest) => {
		head = [status, ...rest];
		const h = rest.find((x) => x && typeof x === 'object');
		if (h) for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
		return res;
	};
	res.write = (chunk, ...rest) => {
		if (chunk != null) chunks.push(Buffer.from(chunk, typeof rest[0] === 'string' ? rest[0] : undefined));
		return true;
	};
	res.end = (chunk, ...rest) => {
		if (chunk != null && typeof chunk !== 'function') chunks.push(Buffer.from(chunk, typeof rest[0] === 'string' ? rest[0] : undefined));
		let body = Buffer.concat(chunks);
		if (isHtml()) {
			body = Buffer.from(body.toString('utf8').replace(/<head([^>]*)>/i, (m) => `${m}\n${embedTag(tag)}`));
			res.setHeader('content-length', body.length);
			res.setHeader('cache-control', 'no-store');
		}
		if (head) writeHead(head[0]);
		write(body);
		return end();
	};
	return handler(req, res);
}

const PAGE_CSS = 'body { font-family: sans-serif; margin: 40px; }\n';

const server = http.createServer((req, res) => {
	const path = new URL(req.url ?? '/', 'http://x').pathname;
	if (path === '/__embed/page.css') {
		res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' });
		return res.end(PAGE_CSS);
	}
	const tag = embedRequest(req);
	if (!tag) return handler(req, res);
	if (path === '/__embed/csp') {
		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': STRICT_CSP, 'cache-control': 'no-store' });
		return res.end(embedPage(tag, 'Strict CSP'));
	}
	return withEmbed(req, res, tag);
});
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
	if (req.url !== '/ws') return socket.destroy();
	wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
	ws.send(JSON.stringify({ type: 'hello', at: Date.now() }));
	const timer = setInterval(() => ws.send(JSON.stringify({ type: 'tick', at: Date.now() })), 3000);
	ws.on('message', (data) => ws.send(JSON.stringify({ type: 'echo', data: String(data) })));
	ws.on('close', () => clearInterval(timer));
});

server.listen(port, host, () => console.log(`lab on http://localhost:${port}`));

const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80">
<rect width="240" height="80" rx="10" fill="#2b6cb0"/>
<text x="120" y="48" font-family="sans-serif" font-size="20" fill="#fff" text-anchor="middle">other origin</text>
</svg>`;

http
	.createServer((req, res) => {
		if (req.url?.startsWith('/__embed/page.css')) {
			res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' });
			return res.end(PAGE_CSS);
		}
		const tag = embedRequest(req);
		if (tag && new URL(req.url ?? '/', 'http://x').pathname === '/') {
			res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
			return res.end(embedPage(tag, 'Second origin'));
		}
		if (req.url?.startsWith('/badge.svg')) {
			res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
			return res.end(badge);
		}
		res.writeHead(404).end();
	})
	.listen(port + 1, host, () => console.log(`asset origin on http://localhost:${port + 1}`));
