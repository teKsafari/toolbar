// STAND-IN for server-core's captures.media (Range-capable media proxy). Replace at merge.
import { handle, viewerAccess } from '#lib/server/viewer/access.ts';
import { serveMedia } from '#lib/server/viewer/standin.ts';

export const GET = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  return serveMedia(ctx.rec, event.params.name!, event.request.headers.get('range'), event.url.searchParams.has('download'));
});
