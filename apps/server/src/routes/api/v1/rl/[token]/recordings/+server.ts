import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { rateLimited, recorderCreate } from '#lib/server/dashboard/links.ts';

// J-017: a recipient starts a capture. The upload token authorises this capture's uploads only.
export const POST = apiRoute(ROUTES['recordingLinks.createCapture'], async ({ event, params, body }) => {
  let ip = 'unknown';
  try {
    ip = event.getClientAddress();
  } catch {
    /* adapter without an address */
  }
  if (rateLimited(`${ip}:${params.token}`)) fail('rate_limited', 'Too many recordings from here; try again in a few minutes');
  return json(await recorderCreate(db, params.token, body), { status: 201 });
});
