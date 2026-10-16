// Share tokens (architecture s8, D-012): 16 random bytes in base64url (22 chars) in the URL,
// sha256 of the token for lookup, an AES-GCM copy (D-033) so the dashboard can show the link again.
import { timingSafeEqual } from 'node:crypto';
import { and, asc, eq, isNull, lt } from 'drizzle-orm';
import { LIMITS, randomToken, type ShareAccess } from '@toolbar/shared';
import type { ShareLink } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { recording, shareLink, user } from '../db/schema/index.ts';
import { seal, unseal } from '../crypto.ts';
import { env } from '../env.ts';
import { setting } from '../settings/index.ts';
import { hashToken } from '../tokens.ts';

export type ShareLinkRow = typeof shareLink.$inferSelect;

export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export const newShareToken = () => randomToken(LIMITS.shareTokenBytes);
export const shareUrlOf = (token: string) => `${env.publicUrl}/s/${token}`;

export async function mintShareLink(
  db: Db,
  recordingId: string,
  opts: { access?: ShareAccess; devtools?: boolean; expiresInDays?: number; createdBy?: string | null } = {},
): Promise<{ row: ShareLinkRow; token: string }> {
  const token = newShareToken();
  const [row] = await db
    .insert(shareLink)
    .values({
      recordingId,
      tokenHash: hashToken(token),
      tokenEnc: seal(token, 'share-token'),
      access: opts.access ?? 'anyone',
      devtools: opts.devtools ?? true,
      createdBy: opts.createdBy ?? null,
      expiresAt: expiryOf(opts.expiresInDays),
    })
    .returning();
  return { row: row!, token };
}

/**
 * Expiry of a new link: the days asked for, else the share link lifetime of Settings > Server or SHARE_LINK_DAYS (Part 2 default 14, PLAN "Privacy
 * and prompt injection"); 0 there keeps Part 1's links that never expire.
 */
export function expiryOf(days: number | undefined, now = Date.now()): Date | null {
  const d = days ?? setting('shareLinkDays') ?? 14;
  return d ? new Date(now + d * 86_400_000) : null;
}

/** A link that can serve as the capture's default: any live one when links expire by policy, else one without expiry. */
const defaultCandidate = (r: Pick<ShareLinkRow, 'expiresAt'>) => (setting('shareLinkDays') ? true : !r.expiresAt);

export const tokenOf = (row: Pick<ShareLinkRow, 'tokenEnc'>) => unseal(row.tokenEnc, 'share-token');

export function isLive(row: Pick<ShareLinkRow, 'revokedAt' | 'expiresAt'>, now = new Date()) {
  return !row.revokedAt && (!row.expiresAt || row.expiresAt > now);
}

/**
 * Look a token up by hash. Returns the link and its capture only when the link is live and the
 * capture is finalized and not deleted; every other case is "not found" to the caller.
 */
export async function findShare(db: Db, token: string) {
  if (!SHARE_TOKEN_RE.test(token)) return null;
  const h = hashToken(token);
  const [row] = await db
    .select({ link: shareLink, rec: recording })
    .from(shareLink)
    .innerJoin(recording, eq(recording.id, shareLink.recordingId))
    .where(eq(shareLink.tokenHash, h))
    .limit(1);
  if (!row) return null;
  if (!timingSafeEqual(Buffer.from(row.link.tokenHash), h)) return null;
  if (!isLive(row.link)) return null;
  if (row.rec.deletedAt || row.rec.status === 'uploading') return null;
  void db.update(shareLink).set({ lastUsedAt: new Date() }).where(eq(shareLink.id, row.link.id)).catch(() => {});
  return row;
}

/** The default link (dev tools) and the content-only link (J-118), created on first read. */
export async function ensureDefaultLinks(db: Db, rec: { id: string; access: ShareAccess }, createdBy: string | null) {
  const rows = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.recordingId, rec.id), isNull(shareLink.revokedAt)))
    .orderBy(asc(shareLink.createdAt));
  const live = rows.filter((r) => isLive(r));
  let link = live.find((r) => r.devtools && defaultCandidate(r));
  let contentOnly = live.find((r) => !r.devtools && defaultCandidate(r));
  if (!link) link = (await mintShareLink(db, rec.id, { access: rec.access, devtools: true, createdBy })).row;
  if (!contentOnly) contentOnly = (await mintShareLink(db, rec.id, { access: rec.access, devtools: false, createdBy })).row;
  const all = await db.select().from(shareLink).where(eq(shareLink.recordingId, rec.id)).orderBy(asc(shareLink.createdAt));
  return { link, contentOnly, all };
}

export async function shareLinkDtos(db: Db, rows: ShareLinkRow[]): Promise<Map<string, ShareLink>> {
  const creators = new Map<string, { id: string; name: string; email: string; image: string | null }>();
  for (const r of rows) {
    if (r.createdBy && !creators.has(r.createdBy)) {
      const [u] = await db.select({ id: user.id, name: user.name, email: user.email, image: user.image }).from(user).where(eq(user.id, r.createdBy));
      if (u) creators.set(u.id, u);
    }
  }
  return new Map(rows.map((r) => [r.id, toShareLinkDto(r, r.createdBy ? (creators.get(r.createdBy) ?? null) : null)]));
}

export function toShareLinkDto(r: ShareLinkRow, by: { id: string; name: string; email: string; image: string | null } | null): ShareLink {
  return {
    id: r.id,
    url: shareUrlOf(tokenOf(r)),
    access: r.access,
    devtools: r.devtools,
    createdAt: r.createdAt.toISOString(),
    createdBy: by ? { id: by.id, name: by.name, email: by.email, image: by.image } : null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  };
}

/** The URL handed back at create and finalize: the oldest live dev-tools link, minted if absent. */
export async function primaryShareUrl(db: Db, rec: { id: string; access: ShareAccess }, createdBy: string | null) {
  const rows = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.recordingId, rec.id), eq(shareLink.devtools, true), isNull(shareLink.revokedAt)))
    .orderBy(asc(shareLink.createdAt));
  const live = rows.find((r) => isLive(r) && defaultCandidate(r));
  if (live) return shareUrlOf(tokenOf(live));
  const { token } = await mintShareLink(db, rec.id, { access: rec.access, devtools: true, createdBy });
  return shareUrlOf(token);
}

export async function revokeLinksOf(db: Db, recordingId: string) {
  await db.update(shareLink).set({ revokedAt: new Date() }).where(and(eq(shareLink.recordingId, recordingId), isNull(shareLink.revokedAt)));
}

/** Hourly job: drop links that expired or were revoked more than 30 days ago. */
export async function deleteStaleLinks(db: Db, now = new Date()) {
  const cut = new Date(now.getTime() - 30 * 86_400_000);
  const a = await db.delete(shareLink).where(lt(shareLink.expiresAt, cut)).returning({ id: shareLink.id });
  const b = await db.delete(shareLink).where(lt(shareLink.revokedAt, cut)).returning({ id: shareLink.id });
  return a.length + b.length;
}
