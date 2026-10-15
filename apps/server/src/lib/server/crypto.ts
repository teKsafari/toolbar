// Secrets at rest: share and recording-link tokens (so the dashboard can show a link again,
// architecture s8), integration tokens, webhook signing secrets. AES-256-GCM with a key derived
// by HKDF-SHA256 from BETTER_AUTH_SECRET; one key per purpose. Layout: iv(12) | tag(16) | ciphertext.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from './env.ts';

export type SealPurpose = 'share-token' | 'recording-link-token' | 'integration-secret' | 'webhook-secret' | 'invite-link';

function keyFor(purpose: SealPurpose, secret: string): Buffer {
  // Frozen HKDF info string from the working name (D-018): changing it makes every sealed value unreadable.
  return Buffer.from(hkdfSync('sha256', secret, 'nib-seal-v1', purpose, 32));
}

export function seal(plain: string, purpose: SealPurpose, secret: string = env.authSecret): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyFor(purpose, secret), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function unseal(sealed: Uint8Array, purpose: SealPurpose, secret: string = env.authSecret): string {
  const b = Buffer.from(sealed);
  const d = createDecipheriv('aes-256-gcm', keyFor(purpose, secret), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
