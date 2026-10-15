// Recording links (J-015, J-017, J-126, J-167, J-223) and the public recorder endpoints.
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { randomToken } from '@toolbar/shared';
import type { RecordingLink, SeatRole } from '@toolbar/shared/api';
import { refOfUrl } from '@toolbar/shared/areas/dashboard';
import type { Db } from '../db/index.ts';
import { folder, member as memberTable, organization, recording, recordingLink, user } from '../db/schema/index.ts';
import { seal, unseal } from '../crypto.ts';
import { hashToken } from '../tokens.ts';
import { fail } from '../share/http.ts';
import { env } from '../env.ts';
import { createCaptureRecord } from '../upload/service.ts';
import { seatOf, visibleCapturesWhere } from '../share/access.ts';
import { iso, mediaUrl, peopleById, UUID } from './core.ts';
import { firstAccountId } from '../auth/instance.ts';

export type LinkRow = typeof recordingLink.$inferSelect;

export const linkUrl = (token: string) => `${env.publicUrl}/rl/${token}`;

export async function toLinks(db: Db, rows: LinkRow[], viewer?: { userId: string; seat: SeatRole }): Promise<RecordingLink[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const folderIds = [...new Set(rows.map((r) => r.folderId).filter((x): x is string => !!x))];
  const folders = folderIds.length ? await db.select({ id: folder.id, name: folder.name }).from(folder).where(inArray(folder.id, folderIds)) : [];
  const fById = new Map(folders.map((f) => [f.id, f]));
  const uses = await db
    .select({ id: recording.recordingLinkId, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${recording.createdAt})` })
    .from(recording)
    .where(and(inArray(recording.recordingLinkId, ids), isNull(recording.deletedAt), isNotNull(recording.finalizedAt)))
    .groupBy(recording.recordingLinkId);
  const useById = new Map(uses.map((u) => [u.id, u]));
  const thumbRows = await db
    .select({ id: recording.id, linkId: recording.recordingLinkId, thumbKey: recording.thumbKey })
    .from(recording)
    .where(
      and(
        inArray(recording.recordingLinkId, ids),
        isNotNull(recording.thumbKey),
        viewer ? visibleCapturesWhere(viewer.userId, viewer.seat) : isNull(recording.deletedAt),
      ),
    )
    .orderBy(desc(recording.createdAt));
  const thumbs = new Map<string, string[]>();
  for (const t of thumbRows) {
    const l = thumbs.get(t.linkId!) ?? [];
    if (l.length < 4) l.push(mediaUrl(t.id, 'thumb'));
    thumbs.set(t.linkId!, l);
  }
  const people = await peopleById(db, rows.map((r) => r.createdBy));
  return rows.map((r) => {
    const u = useById.get(r.id);
    const last = u?.last ? new Date(u.last) : null;
    return {
      id: r.id,
      workspaceId: r.organizationId,
      name: r.name,
      url: linkUrl(unseal(r.tokenEnc, 'recording-link-token')),
      folder: r.folderId && fById.get(r.folderId) ? { id: r.folderId, name: fById.get(r.folderId)!.name } : null,
      recorderDomain: r.recorderDomain,
      ref: r.refUrl ? refOfUrl(r.refUrl) : null,
      createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      uses: Number(u?.n ?? 0),
      lastUsedAt: iso(last),
      status: r.revokedAt ? 'revoked' : 'active',
      thumbs: thumbs.get(r.id) ?? [],
    };
  });
}

export async function listLinks(
  db: Db,
  workspaceId: string,
  q: { status: 'active' | 'revoked' | 'all'; sort: 'newest' | 'oldest' | 'most-used' | 'name'; creators?: string[]; limit: number; cursor?: string },
  viewer: { userId: string; seat: SeatRole },
) {
  const where = and(
    eq(recordingLink.organizationId, workspaceId),
    q.status === 'active' ? isNull(recordingLink.revokedAt) : q.status === 'revoked' ? isNotNull(recordingLink.revokedAt) : undefined,
    q.creators?.length ? inArray(recordingLink.createdBy, q.creators) : undefined,
  );
  const uses = sql<number>`(SELECT count(*)::int FROM recording r WHERE r.recording_link_id = ${recordingLink.id} AND r.deleted_at IS NULL AND r.finalized_at IS NOT NULL)`;
  const order =
    q.sort === 'oldest'
      ? [asc(recordingLink.createdAt)]
      : q.sort === 'name'
        ? [asc(sql`lower(${recordingLink.name})`), desc(recordingLink.createdAt)]
        : q.sort === 'most-used'
          ? [desc(uses), desc(recordingLink.createdAt)]
          : [desc(recordingLink.createdAt)];
  const offset = q.cursor ? Math.max(0, Number.parseInt(q.cursor, 10) || 0) : 0;
  const rows = await db.select().from(recordingLink).where(where).orderBy(...order).limit(q.limit + 1).offset(offset);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(recordingLink).where(where)) as [{ n: number }];
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return { items: await toLinks(db, page, viewer), total: Number(n), returned: page.length, hasMore, nextCursor: hasMore ? String(offset + q.limit) : null };
}

async function checkFolder(db: Db, workspaceId: string, folderId: string | null | undefined) {
  if (!folderId) return null;
  const [f] = await db.select({ id: folder.id }).from(folder).where(and(eq(folder.id, folderId), eq(folder.organizationId, workspaceId)));
  if (!f) fail('invalid_body', 'Folder not found in this workspace');
  return f.id;
}

export async function createLink(
  db: Db,
  workspaceId: string,
  userId: string,
  body: { name: string; folderId?: string | null; recorderDomain?: string | null; refUrl?: string },
) {
  const token = randomToken(16);
  const [row] = await db
    .insert(recordingLink)
    .values({
      organizationId: workspaceId,
      folderId: await checkFolder(db, workspaceId, body.folderId),
      name: body.name.trim(),
      tokenHash: hashToken(token),
      tokenEnc: seal(token, 'recording-link-token'),
      recorderDomain: body.recorderDomain ?? null,
      refUrl: body.refUrl ?? null,
      createdBy: userId,
    })
    .returning();
  return row!;
}

/** A link and the caller's seat; creators change only their own links, admins any. */
export async function linkFor(db: Db, id: string, userId: string, change: boolean) {
  const [l] = await db.select().from(recordingLink).where(eq(recordingLink.id, id));
  if (!l) fail('not_found', 'No such recording link');
  const seat = await seatOf(db, userId, l.organizationId);
  if (!seat) fail('not_found', 'No such recording link');
  if (change && !(seat === 'admin' || (seat === 'creator' && l.createdBy === userId))) fail('forbidden', 'Only its creator or an admin can change this link');
  return { l, seat };
}

export async function updateLink(db: Db, l: LinkRow, body: { name?: string; folderId?: string | null; refUrl?: string | null; revoked?: boolean }) {
  const set: Partial<LinkRow> = {};
  if (body.name !== undefined) set.name = body.name.trim();
  if (body.folderId !== undefined) set.folderId = await checkFolder(db, l.organizationId, body.folderId);
  if (body.refUrl !== undefined) set.refUrl = body.refUrl;
  if (body.revoked !== undefined) set.revokedAt = body.revoked ? (l.revokedAt ?? new Date()) : null;
  if (Object.keys(set).length) await db.update(recordingLink).set(set).where(eq(recordingLink.id, l.id));
  const [u] = await db.select().from(recordingLink).where(eq(recordingLink.id, l.id));
  return u!;
}

export async function deleteLink(db: Db, l: LinkRow) {
  // Captures made through it stay (J-167); they keep the id for the "via link" chip only while it exists.
  await db.delete(recordingLink).where(eq(recordingLink.id, l.id));
}

// ---------- public recorder (J-017, J-126) ----------

export async function linkByToken(db: Db, token: string) {
  const [l] = await db.select().from(recordingLink).where(eq(recordingLink.tokenHash, hashToken(token)));
  if (!l) fail('not_found', 'This recording link does not exist');
  if (l.revokedAt) fail('revoked', 'This recording link was turned off by its owner');
  return l;
}

export async function recorderInfo(db: Db, token: string, q: { title?: string; mic?: '0' | '1' }) {
  const l = await linkByToken(db, token);
  const [o] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, l.organizationId));
  const [u] = l.createdBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, l.createdBy)) : [];
  return {
    name: l.name || 'Recording link',
    workspaceName: o?.name ?? '',
    ownerName: u?.name ?? null,
    title: q.title?.slice(0, 200) || null,
    mic: q.mic === '1',
    ref: l.refUrl ? refOfUrl(l.refUrl) : null,
  };
}

/** Simple in-memory limiter for the public create call: 10 captures per IP per 10 minutes. */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max = 10, windowMs = 10 * 60_000) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

export async function recorderCreate(
  db: Db,
  token: string,
  body: { clientId: string; kind: 'screenshot' | 'video' | 'replay' | 'screen' | 'link' | 'trace'; startedAt: number; env?: unknown; note?: string; folder?: string; ref?: string },
) {
  const l = await linkByToken(db, token);
  let folderId = l.folderId;
  if (body.folder) {
    const key = body.folder.trim();
    const [f] = await db
      .select({ id: folder.id })
      .from(folder)
      .where(
        and(
          eq(folder.organizationId, l.organizationId),
          UUID.test(key) ? eq(folder.id, key) : sql`(${folder.shortId} = ${key.toLowerCase()} OR lower(${folder.name}) = ${key.toLowerCase()})`,
        ),
      )
      .limit(1);
    if (f) folderId = f.id;
  }
  const r = await createCaptureRecord(db, {
    organizationId: l.organizationId,
    clientId: body.clientId,
    kind: body.kind,
    folderId,
    page: { url: '', title: '' },
    startedAt: body.startedAt,
    env: body.env,
    source: 'recording-link',
    author: null,
    recordingLinkId: l.id,
  });
  const meta: Record<string, unknown> = {};
  if (body.note) meta.note = body.note;
  if (body.ref) meta.ref = body.ref;
  if (Object.keys(meta).length && r.created) await db.update(recording).set({ metadata: meta }).where(eq(recording.id, r.id));
  return { id: r.id, shareUrl: r.shareUrl, uploadToken: r.uploadToken };
}

/** Name of the recording link the extension menu's "Report a problem" opens (J-177). */
export const SUPPORT_LINK_NAME = 'Problem reports';

/**
 * J-177: the recording link for bug reports about open-toolbar itself, owned by the server admin (the
 * first account on this server) in their first own workspace. SUPPORT_RECORDING_LINK overrides
 * it with any URL, or turns it off with `off`. A link the admin turned off is left off.
 */
export async function supportLinkUrl(db: Db, envValue = process.env.SUPPORT_RECORDING_LINK): Promise<string | null> {
  if (envValue === 'off') return null;
  if (envValue) return envValue;
  const adminId = await firstAccountId(db);
  if (!adminId) return null;
  const admin = { id: adminId };
  const [ws] = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(memberTable, eq(memberTable.organizationId, organization.id))
    .where(and(eq(memberTable.userId, admin.id), eq(memberTable.role, 'owner')))
    .orderBy(asc(organization.createdAt))
    .limit(1);
  if (!ws) return null;
  const [found] = await db
    .select()
    .from(recordingLink)
    .where(and(eq(recordingLink.organizationId, ws.id), eq(recordingLink.createdBy, admin.id), eq(recordingLink.name, SUPPORT_LINK_NAME)))
    .orderBy(asc(recordingLink.createdAt))
    .limit(1);
  if (found) return found.revokedAt ? null : linkUrl(unseal(found.tokenEnc, 'recording-link-token'));
  const row = await createLink(db, ws.id, admin.id, { name: SUPPORT_LINK_NAME });
  return linkUrl(unseal(row.tokenEnc, 'recording-link-token'));
}
