// Extension sign-in (X-05, architecture s9): /ext/connect issues a 60 s single-use code bound to
// a PKCE challenge; POST /api/v1/ext/token trades code + verifier for a device token. Owner: auth area.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { EXT_CODE_TTL_MS, extensionIdOfRedirect } from '@toolbar/shared/areas/auth';
import type { Db } from '../db/index.ts';
import { extAuthCode } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { createApiToken, hashToken } from '../tokens.ts';

/** Extension ids allowed to sign in. Defaults to the id pinned by the manifest key (D-022). */
export const PINNED_EXTENSION_ID = 'fmongfmimgdafigcahdpofnmmhljpnei';
export const allowedExtensionIds = () => (env.extensionIds.length ? env.extensionIds : [PINNED_EXTENSION_ID]);

/** True for https://<id>.chromiumapp.org/cb with an allowed id. */
export function isAllowedRedirect(uri: string, ids: readonly string[] = allowedExtensionIds()): boolean {
  const id = extensionIdOfRedirect(uri);
  return id !== null && ids.includes(id);
}

const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export async function issueCode(db: Db, opts: { userId: string; codeChallenge: string; redirectUri: string }): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await db.insert(extAuthCode).values({
    codeHash: hashToken(code),
    userId: opts.userId,
    codeChallenge: opts.codeChallenge,
    redirectUri: opts.redirectUri,
    expiresAt: new Date(Date.now() + EXT_CODE_TTL_MS),
  });
  return code;
}

export function redirectWithCode(redirectUri: string, code: string, state: string): string {
  const u = new URL(redirectUri);
  u.searchParams.set('code', code);
  u.searchParams.set('state', state);
  return u.toString();
}

export type ExchangeResult =
  | { ok: true; token: string; tokenId: string; userId: string }
  | { ok: false; code: 'invalid_code' | 'expired' | 'invalid_redirect_uri' };

/** Single use: the code row is deleted whatever the outcome. */
export async function exchangeCode(
  db: Db,
  body: { code: string; code_verifier: string; redirect_uri: string; device_name?: string },
): Promise<ExchangeResult> {
  const [row] = await db.delete(extAuthCode).where(eq(extAuthCode.codeHash, hashToken(body.code))).returning();
  if (!row) return { ok: false, code: 'invalid_code' };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, code: 'expired' };
  if (row.redirectUri !== body.redirect_uri) return { ok: false, code: 'invalid_redirect_uri' };
  const got = Buffer.from(s256(body.code_verifier));
  const want = Buffer.from(row.codeChallenge);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, code: 'invalid_code' };
  const { secret, row: tok } = await createApiToken(db, {
    userId: row.userId,
    kind: 'device',
    name: (body.device_name ?? '').trim() || 'Browser extension',
  });
  return { ok: true, token: secret, tokenId: tok.id, userId: row.userId };
}
