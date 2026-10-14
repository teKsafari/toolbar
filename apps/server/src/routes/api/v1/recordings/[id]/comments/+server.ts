// comments.list and comments.create (viewer area).
import { json } from '@sveltejs/kit';
import { ROUTES } from '@toolbar/shared/api';
import { handle, jsonBody, viewerAccess } from '#lib/server/viewer/access.ts';
import { createComment, listThreads } from '#lib/server/viewer/comments.ts';

export const GET = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  const q = ROUTES['comments.list'].query.parse(Object.fromEntries(event.url.searchParams));
  const items = await listThreads(ctx, q.includeResolved);
  return json({ items, total: items.length, returned: items.length, hasMore: false, nextCursor: null });
});

export const POST = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  const body = await jsonBody(event.request, ROUTES['comments.create'].body);
  return json(await createComment(ctx, body), { status: 201 });
});
