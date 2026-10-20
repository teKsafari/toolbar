// Who may see or change a capture. One place for the rules every area applies:
// - workspace members by seat role (J-124), with private captures and private folders (J-237);
// - share-token viewers (x-toolbar-share header) when the capture's general access is "anyone" (J-119);
// - recording-link recipients with a per-capture upload token (D-030), and embed reviewers with
//   one that lasts as long as the project's embed key (D-211, D-213);
// - nothing is reachable before finalize except by its uploader (J-189).
// Pure decisions are exported for tests; `captureAccess()` loads the rows and throws ApiErrors.
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { roleAtLeast, seatRoleOf, SHARE_TOKEN_HEADER, type AuthMode, type SeatRole } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { folder, folderAccess, folderMember, member, project, recording } from '../db/schema/index.ts';
import { fail } from './http.ts';
import { findShare, type ShareLinkRow } from './tokens.ts';
import { uploadTokenFrom, verifyUploadToken } from '../upload/token.ts';

export type RecordingRow = typeof recording.$inferSelect;

export interface FolderPrivacy {
  private: boolean;
  createdBy: string | null;
  /** user ids invited to the folder */
  members: string[];
}

/** May this workspace member see the capture? (admins see everything in their workspace) */
export function memberCanSee(
  seat: SeatRole,
  userId: string,
  rec: Pick<RecordingRow, 'private' | 'authorUserId' | 'status'>,
  folderPrivacy: FolderPrivacy | null,
): boolean {
  const own = rec.authorUserId === userId;
  if (rec.status === 'uploading') return own;
  if (seat === 'admin') return true;
  if (rec.private && !own) return false;
  if (folderPrivacy?.private && !own && folderPrivacy.createdBy !== userId && !folderPrivacy.members.includes(userId)) return false;
  return true;
}

export type AccessDecision =
  | { ok: true; via: 'member' | 'share' | 'upload' }
  | { ok: false; code: 'unauthorized' | 'forbidden' | 'not_found' };

/** The whole decision without I/O; captureAccess() feeds it. */
export function decideAccess(input: {
  mode: AuthMode;
  role?: SeatRole;
  rec: Pick<RecordingRow, 'id' | 'private' | 'authorUserId' | 'status' | 'access' | 'deletedAt'>;
  userId: string | null;
  seat: SeatRole | null;
  folderPrivacy: FolderPrivacy | null;
  /** capture id granted by a tb_upl_ token, if one was sent */
  uploadGrant: string | null;
  /** capture id of a live share token sent in x-toolbar-share, if any */
  shareGrant: string | null;
}): AccessDecision {
  const { mode, rec, userId, seat } = input;
  if (rec.deletedAt) return { ok: false, code: 'not_found' };
  if (userId && seat && memberCanSee(seat, userId, rec, input.folderPrivacy)) {
    if (input.role && !roleAtLeast(seat, input.role)) {
      // creators may change only their own captures; admins any
      return { ok: false, code: 'forbidden' };
    }
    return { ok: true, via: 'member' };
  }
  if (mode === 'upload' && input.uploadGrant === rec.id) return { ok: true, via: 'upload' };
  if (mode === 'viewer' && input.shareGrant === rec.id && rec.status !== 'uploading') {
    if (rec.access === 'anyone') return { ok: true, via: 'share' };
    return { ok: false, code: userId ? 'not_found' : 'unauthorized' };
  }
  if (!userId && !input.uploadGrant && !input.shareGrant) return { ok: false, code: 'unauthorized' };
  return { ok: false, code: 'not_found' };
}

export interface CaptureAccess {
  rec: RecordingRow;
  via: 'member' | 'share' | 'upload';
  seat: SeatRole | null;
  userId: string | null;
  /** set when via is "share" */
  share: ShareLinkRow | null;
  /** may edit title, folder, share settings, delete */
  canEdit: boolean;
}

export async function seatOf(db: Db, userId: string, organizationId: string): Promise<SeatRole | null> {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return m ? seatRoleOf(m.role) : null;
}

/**
 * A folder guest (J-122): someone invited to a folder who holds no seat in its workspace. They
 * see that folder and its captures as a viewer, nothing else of the workspace.
 */
export async function folderGuestRole(db: Db, userId: string, folderId: string | null): Promise<'viewer' | 'creator' | null> {
  if (!folderId) return null;
  const [m] = await db
    .select({ role: folderMember.role })
    .from(folderMember)
    .where(and(eq(folderMember.folderId, folderId), eq(folderMember.userId, userId)))
    .limit(1);
  if (m) return m.role === 'creator' ? 'creator' : 'viewer';
  // a folder open to anyone with the link: every signed-in person on this server views it
  const [a] = await db.select({ open: folderAccess.anyoneWithLink }).from(folderAccess).where(eq(folderAccess.folderId, folderId)).limit(1);
  return a?.open ? 'viewer' : null;
}

/**
 * Invites sent to an address before it had an account carry no user id. At sign-in they are
 * tied to the account, and a second invite of the same person collapses into one row (J-122).
 */
export async function claimFolderInvites(db: Db, userId: string, email: string | null | undefined) {
  if (!email) return;
  const pending = await db
    .select({ id: folderMember.id, folderId: folderMember.folderId })
    .from(folderMember)
    .where(and(isNull(folderMember.userId), sql`lower(${folderMember.email}) = ${email.toLowerCase()}`));
  for (const p of pending) {
    const [has] = await db
      .select({ id: folderMember.id })
      .from(folderMember)
      .where(and(eq(folderMember.folderId, p.folderId), eq(folderMember.userId, userId)))
      .limit(1);
    if (has) await db.delete(folderMember).where(eq(folderMember.id, p.id));
    else await db.update(folderMember).set({ userId }).where(eq(folderMember.id, p.id));
  }
}

export async function folderPrivacyOf(db: Db, folderId: string | null): Promise<FolderPrivacy | null> {
  if (!folderId) return null;
  const [f] = await db
    .select({ createdBy: folder.createdBy, private: folderAccess.private })
    .from(folder)
    .leftJoin(folderAccess, eq(folderAccess.folderId, folder.id))
    .where(eq(folder.id, folderId))
    .limit(1);
  if (!f?.private) return null;
  const ms = await db.select({ userId: folderMember.userId }).from(folderMember).where(eq(folderMember.folderId, folderId));
  return { private: true, createdBy: f.createdBy, members: ms.map((m) => m.userId).filter((x): x is string => !!x) };
}

/**
 * Load a capture and check the caller against a route's auth mode and minimum role.
 * Creators pass a `role: 'creator'` check only on their own captures when `own` is set.
 */
export async function captureAccess(
  db: Db,
  event: RequestEvent,
  id: string,
  need: { mode: AuthMode; role?: SeatRole; own?: boolean },
): Promise<CaptureAccess> {
  const [rec] = await db.select().from(recording).where(eq(recording.id, id)).limit(1);
  if (!rec) fail('not_found', 'No such capture');
  const userId = event.locals.user?.id ?? null;
  let seat = userId ? await seatOf(db, userId, rec.organizationId) : null;
  // a folder guest sees the folder's captures as a viewer (J-122)
  if (!seat && userId && !rec.private && (await folderGuestRole(db, userId, rec.folderId))) seat = 'viewer';
  const folderPrivacy = seat ? await folderPrivacyOf(db, rec.folderId) : null;

  const upl = need.mode === 'upload' ? uploadTokenFrom(event.request.headers.get('authorization')) : null;
  const uploadGrant = upl ? verifyUploadToken(upl) : null;
  const shareToken = need.mode === 'viewer' ? event.request.headers.get(SHARE_TOKEN_HEADER) : null;
  const share = shareToken ? await findShare(db, shareToken) : null;
  const shareGrant = share?.rec.id ?? null;

  const d = decideAccess({ mode: need.mode, role: need.role, rec, userId, seat, folderPrivacy, uploadGrant, shareGrant });
  if (!d.ok) fail(d.code, d.code === 'unauthorized' ? 'Sign in, or open the capture from its share link' : undefined);
  if (d.via === 'upload' && rec.source === 'embed') await embedKeyLive(db, rec);
  const canEdit = d.via === 'upload' || (seat !== null && (seat === 'admin' || (seat === 'creator' && rec.authorUserId === userId)));
  if (need.own && !canEdit) fail('forbidden', 'Only the author or a workspace admin can change this capture');
  return { rec, via: d.via, seat, userId, share: d.via === 'share' ? share!.link : null, canEdit };
}

/**
 * The upload token of an embed capture works while the key it was started with does (D-213):
 * rotating or turning off the project's key revokes every token issued before, with no column of
 * their own. Compared in SQL, at the database's own clock and precision.
 */
async function embedKeyLive(db: Db, rec: RecordingRow) {
  const [live] = rec.projectId
    ? await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(
            eq(project.id, rec.projectId),
            sql`${project.embedKey} is not null and ${project.embedKeyCreatedAt} <= (select r.created_at from recording r where r.id = ${rec.id})`,
          ),
        )
        .limit(1)
    : [];
  if (!live) fail('revoked', 'The embed key of this site changed or was turned off; start a new capture');
}

/** Workspace membership check for routes without a capture (create, assets). */
export async function requireSeat(db: Db, event: RequestEvent, organizationId: string, role: SeatRole): Promise<{ userId: string; seat: SeatRole }> {
  const userId = event.locals.user?.id;
  if (!userId) fail('unauthorized', 'Sign in or send a bearer token');
  const seat = await seatOf(db, userId, organizationId);
  if (!seat) fail('forbidden', 'Not a member of this workspace');
  if (!roleAtLeast(seat, role)) fail('forbidden', `Needs the ${role} role in this workspace`);
  return { userId, seat };
}

/**
 * SQL filter for lists and search (dashboard, search, MCP): finalized, not deleted, and visible
 * to this member under the private capture and private folder rules.
 */
export function visibleCapturesWhere(userId: string, seat: SeatRole): SQL {
  const base = and(isNull(recording.deletedAt), inArray(recording.status, ['processing', 'ready', 'failed']))!;
  if (seat === 'admin') return base;
  const own = eq(recording.authorUserId, userId);
  const folderOpen = sql`(${recording.folderId} IS NULL OR NOT EXISTS (
      SELECT 1 FROM folder_access fa JOIN folder f ON f.id = fa.folder_id
      WHERE fa.folder_id = ${recording.folderId} AND fa.private
        AND f.created_by IS DISTINCT FROM ${userId}
        AND NOT EXISTS (SELECT 1 FROM folder_member fm WHERE fm.folder_id = fa.folder_id AND fm.user_id = ${userId})))`;
  return and(base, or(own, and(eq(recording.private, false), folderOpen)))!;
}

/** SQL filter for folder lists: private folders only for their creator, members and admins. */
export function visibleFoldersWhere(userId: string, seat: SeatRole): SQL | undefined {
  if (seat === 'admin') return undefined;
  return sql`NOT EXISTS (
      SELECT 1 FROM folder_access fa WHERE fa.folder_id = ${folder.id} AND fa.private
        AND ${folder.createdBy} IS DISTINCT FROM ${userId}
        AND NOT EXISTS (SELECT 1 FROM folder_member fm WHERE fm.folder_id = fa.folder_id AND fm.user_id = ${userId}))`;
}
