// Never responds. The request stays pending until the client gives up.
export function GET({ request }) {
	return new Promise<Response>((resolve) => {
		request.signal.addEventListener('abort', () => resolve(new Response(null, { status: 499 })));
	});
}
