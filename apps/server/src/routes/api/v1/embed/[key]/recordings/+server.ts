import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { embedCreate } from '#lib/server/embed/index.ts';

// D-211: a reviewer on a project origin starts a capture. The upload token authorises this capture's uploads only.
export const POST = apiRoute(ROUTES['embed.createCapture'], async ({ event, params, body }) => {
  const r = await embedCreate(db, event, params.key, body);
  return json({ id: r.id, uploadToken: r.uploadToken }, { status: r.created ? 201 : 200 });
});
