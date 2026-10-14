import { redirect } from '@sveltejs/kit';
import { auth } from '#lib/server/auth.ts';

export const POST = async ({ request }) => {
  await auth.api.signOut({ headers: request.headers });
  redirect(303, '/login');
};
