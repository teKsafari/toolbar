// Per-capture upload token for recording-link recipients (D-030): `tb_upl_<id>.<mac>`, where id
// is the capture id as 16 bytes base64url and mac is HMAC-SHA256 under a key derived from
// BETTER_AUTH_SECRET, cut to 16 bytes. Stateless: it authorises upload, finalize and discard of
// that one capture, and stops working for new chunks once the capture is finalized.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { base64url, fromBase64url } from '@toolbar/shared';
import { UPLOAD_TOKEN_PREFIX } from '@toolbar/shared/api';
import { env } from '../env.ts';

// Frozen HKDF info string from the working name (D-018): changing it invalidates issued upload tokens.
const key = (secret: string) => Buffer.from(hkdfSync('sha256', secret, 'nib-upload-v1', 'upload-token', 32));
const idBytes = (id: string) => Buffer.from(id.replace(/-/g, ''), 'hex');
const idFrom = (b: Uint8Array) => {
  const h = Buffer.from(b).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const mac = (id: Buffer, secret: string) => createHmac('sha256', key(secret)).update(id).digest().subarray(0, 16);

export function mintUploadToken(recordingId: string, secret = env.authSecret): string {
  const id = idBytes(recordingId);
  return `${UPLOAD_TOKEN_PREFIX}${base64url(id)}.${base64url(mac(id, secret))}`;
}

/** The capture id the token grants, or null. */
export function verifyUploadToken(token: string, secret = env.authSecret): string | null {
  if (!token.startsWith(UPLOAD_TOKEN_PREFIX)) return null;
  const [a, b] = token.slice(UPLOAD_TOKEN_PREFIX.length).split('.');
  if (!a || !b) return null;
  try {
    const id = Buffer.from(fromBase64url(a));
    const got = Buffer.from(fromBase64url(b));
    if (id.length !== 16 || got.length !== 16) return null;
    return timingSafeEqual(got, mac(id, secret)) ? idFrom(id) : null;
  } catch {
    return null;
  }
}

export function uploadTokenFrom(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m?.[1]?.startsWith(UPLOAD_TOKEN_PREFIX) ? m[1] : null;
}
