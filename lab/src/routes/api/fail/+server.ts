import { json } from '@sveltejs/kit';

export function POST() {
	return json(
		{ error: 'database_unavailable', detail: 'connection refused to db:5432', requestId: crypto.randomUUID() },
		{ status: 500 }
	);
}
