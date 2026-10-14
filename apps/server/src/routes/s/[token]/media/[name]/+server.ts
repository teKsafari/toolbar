// STAND-IN for server-core's sharing.media (media proxy for share-link viewers). Replace at merge.
import { error } from '@sveltejs/kit';
import { findShareLink, handle, viewerAccess } from '#lib/server/viewer/access.ts';
import { serveMedia } from '#lib/server/viewer/standin.ts';

export const GET = handle(async (event) => {
  const link = await findShareLink(event.params.token!);
  if (!link) error(404, 'Not found');
  const ctx = await viewerAccess(event, link.recordingId, { token: event.params.token! });
  return serveMedia(ctx.rec, event.params.name!, event.request.headers.get('range'), event.url.searchParams.has('download'));
});
