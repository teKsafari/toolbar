import { json } from '@sveltejs/kit';
import { requireUser } from '#lib/server/api.ts';

export const GET = (event) => {
  const u = requireUser(event);
  return json({ id: u.id, name: u.name, email: u.email, image: u.image ?? null, via: event.locals.apiToken?.kind ?? 'session' });
};
