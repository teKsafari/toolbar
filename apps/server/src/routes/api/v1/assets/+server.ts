// STAND-IN for server-core's captures.uploadAsset, enough for comment images (J-132). Replace at merge.
import { json } from '@sveltejs/kit';
import { uploadAssetFieldsSchema } from '@toolbar/shared/api';
import { fail, handle, memberAccess } from '#lib/server/viewer/access.ts';
import { uploadAssetStandIn } from '#lib/server/viewer/standin.ts';

export const POST = handle(async (event) => {
  if (!event.locals.user) fail(401, 'unauthorized', 'Sign in first');
  const form = await event.request.formData().catch(() => null);
  if (!form) fail(422, 'invalid_body', 'Send multipart form data');
  const fields = Object.fromEntries([...form!.entries()].filter(([, v]) => typeof v === 'string'));
  const parsed = uploadAssetFieldsSchema.safeParse(fields);
  if (!parsed.success) fail(422, 'invalid_body', parsed.error.message);
  const file = form!.get('file');
  if (!(file instanceof File)) fail(422, 'invalid_body', 'Missing file');
  if (!parsed.data!.recordingId) fail(422, 'invalid_body', 'recordingId is required here');
  const ctx = await memberAccess(event, parsed.data!.recordingId!);
  const f = file as File;
  if (!f.type.startsWith('image/')) fail(415, 'unsupported_media_type', 'Images only');
  if (f.size > 20 * 1024 * 1024) fail(413, 'too_large', 'Images up to 20 MB');
  return json(await uploadAssetStandIn(ctx.rec, parsed.data!.kind, f), { status: 201 });
});
