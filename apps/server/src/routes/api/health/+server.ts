import { json } from '@sveltejs/kit';
import { version } from '$app/env';
import { health } from '#lib/server/health.ts';

export const GET = async () => {
  const h = await health(version);
  return json(h, { status: h.ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
};
