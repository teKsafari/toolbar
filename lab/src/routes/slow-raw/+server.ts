// Streams a plain HTML page in chunks over about 4 seconds.
export function GET() {
	const enc = new TextEncoder();
	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const stream = new ReadableStream({
		async start(controller) {
			controller.enqueue(
				enc.encode(
					'<!doctype html><html><head><meta charset="utf-8"><title>Lab: streamed HTML</title></head><body><h1>Streamed HTML</h1><a href="/">Back</a><ol>'
				)
			);
			for (let i = 1; i <= 8; i++) {
				await sleep(500);
				controller.enqueue(enc.encode(`<li>chunk ${i} at ${new Date().toISOString()}</li>`));
			}
			controller.enqueue(enc.encode('</ol><p id="done">done</p></body></html>'));
			controller.close();
		}
	});
	return new Response(stream, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
