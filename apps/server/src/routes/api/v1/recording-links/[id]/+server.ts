import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { deleteLink, linkFor, toLinks, updateLink } from '#lib/server/dashboard/links.ts';

// J-223: rename in place, retarget the folder, set the ticket URL, or turn off.
export const PATCH = apiRoute(ROUTES['recordingLinks.update'], async ({ event, params, body }) => {
  const userId = requireUserId(event);
  const { l, seat } = await linkFor(db, params.id, userId, true);
  const u = await updateLink(db, l, body);
  return (await toLinks(db, [u], { userId, seat }))[0]!;
});

export const DELETE = apiRoute(ROUTES['recordingLinks.delete'], async ({ event, params }) => {
  const { l } = await linkFor(db, params.id, requireUserId(event), true);
  await deleteLink(db, l);
  return { ok: true as const };
});
