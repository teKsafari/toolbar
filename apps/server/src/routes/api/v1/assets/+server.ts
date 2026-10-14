import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { storeAsset } from '#lib/server/upload/service.ts';

export const POST = apiRoute(ROUTES['captures.uploadAsset'], async ({ event }) => {
  let form: FormData;
  try {
    form = await event.request.formData();
  } catch {
    fail('invalid_body', 'Send multipart/form-data with a file part');
  }
  const file = form.get('file');
  if (!(file instanceof File)) fail('invalid_body', 'The file part is missing');
  const fields: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (k !== 'file' && typeof v === 'string') fields[k] = v;
  let recordingId: string | null = null;
  let userId = event.locals.user?.id ?? null;
  if (typeof fields.recordingId === 'string' && fields.recordingId) {
    const a = await captureAccess(db, event, fields.recordingId, { mode: 'upload', role: 'creator', own: true });
    recordingId = a.rec.id;
    userId = a.userId;
  } else if (!userId) {
    fail('unauthorized', 'Sign in, or send recordingId with an upload token');
  }
  return storeAsset(db, { fields, file, recordingId, userId });
});
