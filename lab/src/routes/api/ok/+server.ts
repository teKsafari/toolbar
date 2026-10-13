import { json } from '@sveltejs/kit';

export function GET({ url }) {
	return json({ ok: true, at: new Date().toISOString(), echo: url.searchParams.get('q') });
}

export async function POST({ request }) {
	const body = await request.json().catch(() => null);
	return json({ ok: true, received: body }, { status: 201 });
}
