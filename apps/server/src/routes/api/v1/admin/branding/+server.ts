// GET and PUT /api/v1/admin/branding (instance admins, D-112): stored values, locks, defaults;
// set or reset the name and the accent.
import { updateBrandingBodySchema } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { errorResponse } from '#lib/server/auth/http.ts';
import { updateBranding } from '#lib/server/branding/index.ts';
import { asAdmin } from './guard.ts';

export const GET = (event) => asAdmin(event, async () => {});

export const PUT = async (event) => {
  let raw: unknown;
  try {
    raw = await event.request.json();
  } catch {
    return errorResponse('bad_json', 'Body must be JSON');
  }
  const body = updateBrandingBodySchema.safeParse(raw);
  if (!body.success) return errorResponse('invalid_body', body.error.issues[0]?.message ?? 'Invalid body', body.error.issues);
  return asAdmin(event, (userId) => updateBranding(db, userId, body.data));
};
