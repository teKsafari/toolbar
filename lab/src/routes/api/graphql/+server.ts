import { json } from '@sveltejs/kit';

// Answers 200 with a GraphQL error on purpose (parity L-1).
export async function POST({ request }) {
	await request.json().catch(() => null);
	return json({ data: null, errors: [{ message: 'Cart not found' }] });
}
