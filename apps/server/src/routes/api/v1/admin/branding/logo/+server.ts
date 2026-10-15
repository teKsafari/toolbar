// PUT and DELETE /api/v1/admin/branding/logo?variant=light|dark (instance admins, D-112).
// PUT takes multipart `file`: SVG (sanitised) or PNG, at most 512 KB.
import { BRAND_LOGO_MAX_BYTES, logoVariantQuerySchema } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { errorResponse } from '#lib/server/auth/http.ts';
import { setLogo } from '#lib/server/branding/index.ts';
import { asAdmin } from '../guard.ts';

const variantOf = (url: URL) => logoVariantQuerySchema.safeParse(Object.fromEntries(url.searchParams));

export const PUT = async (event) => {
  const q = variantOf(event.url);
  if (!q.success) return errorResponse('invalid_query', 'variant is light or dark');
  if (Number(event.request.headers.get('content-length') ?? 0) > BRAND_LOGO_MAX_BYTES + 64 * 1024) return errorResponse('too_large', 'The logo is larger than 512 KB.');
  let file: File | null = null;
  try {
    const f = (await event.request.formData()).get('file');
    file = f instanceof File ? f : null;
  } catch {
    /* not multipart */
  }
  if (!file) return errorResponse('invalid_body', 'Send the logo as multipart field "file".');
  if (file.size > BRAND_LOGO_MAX_BYTES) return errorResponse('too_large', 'The logo is larger than 512 KB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return asAdmin(event, (userId) => setLogo(db, userId, q.data.variant, bytes, file.type));
};

export const DELETE = async (event) => {
  const q = variantOf(event.url);
  if (!q.success) return errorResponse('invalid_query', 'variant is light or dark');
  return asAdmin(event, (userId) => setLogo(db, userId, q.data.variant, null));
};
