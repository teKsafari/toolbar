// Production server for the lab app: SvelteKit handler, a WebSocket on /ws,
// and a second origin on PORT+1 that serves a cross-origin image.
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handler } from './build/handler.js';

const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? '0.0.0.0';

const server = http.createServer(handler);
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
		if (req.url?.startsWith('/badge.svg')) {
			res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
			return res.end(badge);
		}
		res.writeHead(404).end();
	})
	.listen(port + 1, host, () => console.log(`asset origin on http://localhost:${port + 1}`));
