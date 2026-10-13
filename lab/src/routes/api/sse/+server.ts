// Server-sent events: one "tick" event per second, 20 events, then close.
export function GET({ request }) {
	let n = 0;
	let timer: ReturnType<typeof setInterval>;
	const stream = new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			controller.enqueue(enc.encode('retry: 5000\n\n'));
			timer = setInterval(() => {
				n++;
				controller.enqueue(enc.encode(`event: tick\nid: ${n}\ndata: ${JSON.stringify({ n, at: Date.now() })}\n\n`));
				if (n >= 20) {
					clearInterval(timer);
					controller.close();
				}
			}, 1000);
			request.signal.addEventListener('abort', () => clearInterval(timer));
		},
		cancel() {
			clearInterval(timer);
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
	});
}
