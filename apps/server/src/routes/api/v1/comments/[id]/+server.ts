// comments.update and comments.delete (own comments; admins may delete members' comments).
import { json } from '@sveltejs/kit';
import { ROUTES } from '@toolbar/shared/api';
import { fail, handle, jsonBody, memberAccess } from '#lib/server/viewer/access.ts';
import { commentRecording, deleteComment, updateComment } from '#lib/server/viewer/comments.ts';

async function load(event: Parameters<Parameters<typeof handle>[0]>[0]) {
  const row = await commentRecording(event.params.id!);
  if (!row) fail(404, 'not_found', 'Comment not found');
  const ctx = await memberAccess(event, row!.recordingId);
  return { row: row!, ctx };
}

export const PATCH = handle(async (event) => {
  const { row, ctx } = await load(event);
  const body = await jsonBody(event.request, ROUTES['comments.update'].body);
  return json(await updateComment(ctx, row, body.body));
});

export const DELETE = handle(async (event) => {
  const { row, ctx } = await load(event);
  await deleteComment(ctx, row);
  return json({ ok: true });
});
