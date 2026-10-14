// comments.resolve: resolve or reopen a thread.
import { json } from '@sveltejs/kit';
import { ROUTES } from '@toolbar/shared/api';
import { fail, handle, jsonBody, memberAccess } from '#lib/server/viewer/access.ts';
import { commentRecording, resolveComment } from '#lib/server/viewer/comments.ts';

export const POST = handle(async (event) => {
  const row = await commentRecording(event.params.id!);
  if (!row) fail(404, 'not_found', 'Comment not found');
  const ctx = await memberAccess(event, row!.recordingId);
  const body = await jsonBody(event.request, ROUTES['comments.resolve'].body);
  return json(await resolveComment(ctx, row!, body.resolved));
});
