// Extension sign-in (X-05, architecture s9): /ext/connect issues a 60 s single-use code bound to
// a PKCE challenge; POST /api/v1/ext/token trades code + verifier for a device token. Owner: auth area.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { EXT_CODE_TTL_MS, parseExtRedirect } from '@toolbar/shared/areas/auth';
import type { Db } from '../db/index.ts';
import { extAuthCode } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { createApiToken, hashToken } from '../tokens.ts';

/** Extension ids allowed to sign in. Defaults to the Chrome Web Store item's id, which the manifest key pins. */
export const PINNED_EXTENSION_ID = 'laobpjhffglefallhhojihfdbdkoendk';
export const allowedExtensionIds = () => (env.extensionIds.length ? env.extensionIds : [PINNED_EXTENSION_ID]);

/** The Firefox build's add-on id (WXT_GECKO_ID's default), allowed unless EXTENSION_GECKO_IDS lists others. */
export const DEFAULT_GECKO_ID = 'open-toolbar@self-hosted';
export const allowedGeckoIds = () => (env.extensionGeckoIds.length ? env.extensionGeckoIds : [DEFAULT_GECKO_ID]);

/** Firefox's redirect host label for an add-on id: hex SHA-1 of the id (identity.getRedirectURL). */
export const geckoRedirectHash = (geckoId: string) => createHash('sha1').update(geckoId, 'utf8').digest('hex');

/**
 * True for https://<allowed Chrome id>.chromiumapp.org/cb and for
 * https://<sha1 of an allowed gecko id>.extensions.allizom.org/cb.
 */
export function isAllowedRedirect(uri: string, ids: readonly string[] = allowedExtensionIds(), geckoIds: readonly string[] = allowedGeckoIds()): boolean {
  const r = parseExtRedirect(uri);
  if (!r) return false;
  if (r.browser === 'chrome') return ids.includes(r.id);
  return geckoIds.some((g) => geckoRedirectHash(g) === r.hash);
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
