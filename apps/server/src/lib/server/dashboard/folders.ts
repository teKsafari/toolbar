// Folders (J-162 to J-166) and folder sharing (J-122, writes the J-237 tables server-core reads).
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { PRODUCT_NAME } from '@toolbar/shared';
import type { z } from 'zod';
import { roleAtLeast, type Folder, type SeatRole, type folderShareSchema } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { folder, folderAccess, folderMember, member, recording, user } from '../db/schema/index.ts';
import { folderGuestRole, visibleCapturesWhere, visibleFoldersWhere, seatOf } from '../share/access.ts';
import { fail } from '../share/http.ts';
import { sendMail } from '../mail.ts';
import { env } from '../env.ts';
import { audit, emailAllowed, ensureShortIds, findFolder, newShortId, peopleById, type FolderRow } from './core.ts';
import { bulkDelete } from './captures.ts';
import { folderInviteMail } from '../mail-templates/index.ts';

export const folderUrl = (f: { shortId: string | null; id: string }) => `${env.publicUrl}/f/${f.shortId ?? f.id}`;

async function privateSet(db: Db, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: folderAccess.folderId }).from(folderAccess).where(and(inArray(folderAccess.folderId, ids), eq(folderAccess.private, true)));
  return new Set(rows.map((r) => r.id));
}

export async function toFolders(db: Db, rows: FolderRow[], ctx: { userId: string; seat: SeatRole }): Promise<Folder[]> {
  rows = await ensureShortIds(db, rows);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const counts = await db
    .select({ id: recording.folderId, n: sql<number>`count(*)::int` })
    .from(recording)
    .where(and(inArray(recording.folderId, ids), visibleCapturesWhere(ctx.userId, ctx.seat)))
    .groupBy(recording.folderId);
  const byId = new Map(counts.map((c) => [c.id, Number(c.n)]));
  const priv = await privateSet(db, ids);
  const people = await peopleById(db, rows.map((r) => r.createdBy));
  return rows.map((r) => ({
    id: r.id,
    shortId: r.shortId!,
    workspaceId: r.organizationId,
    name: r.name,
    parentId: r.parentId,
    private: priv.has(r.id),
    captureCount: byId.get(r.id) ?? 0,
    createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listFolders(db: Db, workspaceId: string, ctx: { userId: string; seat: SeatRole }) {
  const vis = visibleFoldersWhere(ctx.userId, ctx.seat);
  const rows = await db
    .select()
    .from(folder)
    .where(and(eq(folder.organizationId, workspaceId), vis))
    .orderBy(asc(sql`lower(${folder.name})`), asc(folder.createdAt));
  return toFolders(db, rows, ctx);
}

export async function createFolder(db: Db, workspaceId: string, userId: string, body: { name: string; parentId?: string; private: boolean }) {
  if (body.parentId) {
    const [p] = await db.select({ id: folder.id }).from(folder).where(and(eq(folder.id, body.parentId), eq(folder.organizationId, workspaceId)));
    if (!p) fail('invalid_body', 'Parent folder not found');
  }
  let row: FolderRow | undefined;
  for (let attempt = 0; !row; attempt++) {
    try {
      [row] = await db
        .insert(folder)
        .values({ organizationId: workspaceId, name: body.name, parentId: body.parentId ?? null, createdBy: userId, shortId: newShortId(attempt < 6 ? 4 : 6) })
        .returning();
    } catch (e) {
      if (attempt > 10) throw e;
    }
  }
  if (body.private) await db.insert(folderAccess).values({ folderId: row.id, private: true });
  return row;
}

/** Load a folder the caller can see, with the caller's seat in its workspace. */
export async function folderFor(db: Db, idOrShort: string, userId: string, need: SeatRole = 'viewer') {
  const f = await findFolder(db, idOrShort);
  if (!f) fail('not_found', 'No such folder');
  let seat = await seatOf(db, userId, f.organizationId);
  if (!seat) {
    // folder guests (J-122): a viewer of this folder only
    if (!(await folderGuestRole(db, userId, f.id))) fail('not_found', 'No such folder');
    if (!roleAtLeast('viewer', need)) fail('forbidden', `This needs the ${need} seat or higher`);
    return { f, seat: 'viewer' as SeatRole, guest: true };
  }
  const vis = visibleFoldersWhere(userId, seat);
  if (vis) {
    const [ok] = await db.select({ id: folder.id }).from(folder).where(and(eq(folder.id, f.id), vis));
    if (!ok) fail('not_found', 'No such folder');
  }
  if (!roleAtLeast(seat, need)) fail('forbidden', `This needs the ${need} seat or higher`);
  return { f, seat, guest: false };
}

export async function updateFolder(db: Db, f: FolderRow, body: { name?: string; private?: boolean; parentId?: string | null }) {
  if (body.parentId === f.id) fail('invalid_body', 'A folder cannot be its own parent');
  const set: Partial<FolderRow> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.parentId !== undefined) set.parentId = body.parentId;
  if (Object.keys(set).length) await db.update(folder).set(set).where(eq(folder.id, f.id));
  if (body.private !== undefined)
    await db
      .insert(folderAccess)
      .values({ folderId: f.id, private: body.private })
      .onConflictDoUpdate({ target: folderAccess.folderId, set: { private: body.private, updatedAt: new Date() } });
  const [u] = await db.select().from(folder).where(eq(folder.id, f.id));
  return u!;
}

/** J-164: the folder and every capture in it go (captures are archived and purged as in J-191). */
export async function deleteFolder(db: Db, f: FolderRow, actorId: string) {
  const recs = await db.select().from(recording).where(and(eq(recording.folderId, f.id), isNull(recording.deletedAt)));
  const n = await bulkDelete(db, recs, actorId);
  await db.update(folder).set({ parentId: null }).where(eq(folder.parentId, f.id));
  await db.delete(folder).where(eq(folder.id, f.id));
  return n;
}

// ---------- J-122 folder sharing ----------

type FolderShare = z.infer<typeof folderShareSchema>;

export async function folderShare(db: Db, f: FolderRow): Promise<FolderShare> {
  const [acc] = await db.select().from(folderAccess).where(eq(folderAccess.folderId, f.id));
  const invited = await db.select().from(folderMember).where(eq(folderMember.folderId, f.id)).orderBy(asc(folderMember.createdAt));
  const ws = await db
    .select({ userId: member.userId, role: member.role })
    .from(member)
    .where(eq(member.organizationId, f.organizationId));
  const admins = ws.filter((m) => m.role === 'owner' || m.role === 'admin').map((m) => m.userId);
  const ids = [f.createdBy, ...admins, ...invited.map((i) => i.userId)];
  const people = await peopleById(db, ids);
  const out: FolderShare['people'] = [];
  const seen = new Set<string>();
  const add = (uid: string | null, role: 'viewer' | 'creator' | 'admin', pending: boolean, email?: string | null) => {
    const key = uid ?? `email:${email}`;
    if (seen.has(key)) return;
    seen.add(key);
    const p = uid ? people.get(uid) : null;
    out.push({ person: p ?? { id: uid, name: email ?? 'Unknown', email: email ?? null, image: null }, role, pending });
  };
  if (f.createdBy) add(f.createdBy, 'admin', false);
  for (const a of admins) add(a, 'admin', false);
  for (const i of invited) add(i.userId, i.role, i.userId === null, i.email);
  return { url: folderUrl(f), access: acc?.private ? 'private' : 'workspace', people: out };
}

export async function updateFolderShare(
  db: Db,
  f: FolderRow,
  actor: { id: string; name: string },
  body: { access?: 'workspace' | 'private'; invite?: { email: string; role: 'viewer' | 'creator' }[]; remove?: string[] },
) {
  if (body.access)
    await db
      .insert(folderAccess)
      .values({ folderId: f.id, private: body.access === 'private' })
      .onConflictDoUpdate({ target: folderAccess.folderId, set: { private: body.access === 'private', updatedAt: new Date() } });
  for (const inv of body.invite ?? []) {
    const email = inv.email.toLowerCase();
    const [u] = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
    // one row per person: an earlier invite to the address, made before the account existed, is the same person (J-122)
    const existing = await db
      .select({ id: folderMember.id, userId: folderMember.userId })
      .from(folderMember)
      .where(and(eq(folderMember.folderId, f.id), u ? or(eq(folderMember.userId, u.id), sql`lower(${folderMember.email}) = ${email}`) : sql`lower(${folderMember.email}) = ${email}`));
    if (!existing.length) await db.insert(folderMember).values({ folderId: f.id, userId: u?.id ?? null, email, role: inv.role, invitedBy: actor.id });
    else if (u && !existing.some((x) => x.userId === u.id)) await db.update(folderMember).set({ userId: u.id }).where(eq(folderMember.id, existing[0]!.id));
    // address-only rows left from before the account existed go once the account has its row
    if (u && existing.length > 1) {
      const keep = existing.find((x) => x.userId === u.id) ?? existing[0]!;
      const extra = existing.filter((x) => x.id !== keep.id).map((x) => x.id);
      if (extra.length) await db.delete(folderMember).where(inArray(folderMember.id, extra));
    }
    // J-136: an existing account that turned off "shared with me" gets no email; new addresses always do.
    if (u && !(await emailAllowed(db, u.id, 'sharedWithMe'))) continue;
    const mail = folderInviteMail({ inviter: actor.name, folder: f.name, url: folderUrl(f), product: PRODUCT_NAME });
    await sendMail(email, mail.subject, mail.text, mail.html).catch((e) => console.warn('[dashboard] folder invite mail failed', e));
  }
  if (body.remove?.length) await db.delete(folderMember).where(and(eq(folderMember.folderId, f.id), inArray(folderMember.userId, body.remove)));
  if (body.invite?.length)
    await audit(db, {
      workspaceId: f.organizationId,
      actorId: actor.id,
      action: 'capture.shared',
      target: { type: 'folder', id: f.id, label: f.name },
      details: { invited: body.invite.map((i) => i.email) },
    });
  return folderShare(db, f);
}

