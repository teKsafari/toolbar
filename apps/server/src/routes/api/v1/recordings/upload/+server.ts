import { ROUTES } from '@toolbar/shared/api';
import { MAX_UPLOAD_VIDEO_BYTES } from '@toolbar/shared/areas/dashboard';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { UUID, workspaceFor } from '#lib/server/dashboard/core.ts';
import { uploadVideo } from '#lib/server/dashboard/captures.ts';
import { json } from '@sveltejs/kit';

// J-020: drop an existing video on the grid. Multipart: file, workspaceId?, folderId?, title?
export const POST = apiRoute(ROUTES['captures.uploadVideo'], async ({ event }) => {
  const len = Number(event.request.headers.get('content-length') ?? 0);
  if (len > MAX_UPLOAD_VIDEO_BYTES + 64 * 1024) fail('too_large', 'Videos are limited to 200 MB');
  let form: FormData;
  try {
    form = await event.request.formData();
  } catch {
    fail('invalid_body', 'Send the video as multipart form data with a "file" part');
  }
  const file = form.get('file');
  if (!(file instanceof File)) fail('invalid_body', 'The "file" part is missing');
  const ws = form.get('workspaceId');
  const folderId = form.get('folderId');
  if (folderId && (typeof folderId !== 'string' || !UUID.test(folderId))) fail('invalid_body', 'folderId is not an id');
  const ctx = await workspaceFor(db, event, typeof ws === 'string' && UUID.test(ws) ? ws : null, 'creator');
  const title = form.get('title');
  const r = await uploadVideo(db, event, { file, workspaceId: ctx.workspaceId, folderId: (folderId as string) || null, title: typeof title === 'string' ? title : null, userId: ctx.userId });
  return json(r, { status: 201 });
});
