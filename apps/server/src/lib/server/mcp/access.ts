// Who an MCP or CLI caller is, and which captures they may read or change. Applies the same
// rules as the REST routes (share/access.ts): workspace seat, private captures and folders,
// share links. OAuth grants are bound to the workspace picked on the consent page.
import { eq } from 'drizzle-orm';
import { parseCaptureRef, roleAtLeast, type SeatRole } from '@toolbar/shared/api';
import { tokenAllows } from '@toolbar/shared/areas/auth';
import { TOKEN_PREFIX } from '@toolbar/shared';
import type { Db } from '../db/index.ts';
import { recording } from '../db/schema/index.ts';
import { resolveApiToken } from '../tokens.ts';
import { activeWorkspaceId } from '../auth/workspaces.ts';
import { decideAccess, folderPrivacyOf, seatOf, type RecordingRow } from '../share/access.ts';
import { findShare } from '../share/tokens.ts';
import { fail } from '../share/http.ts';
import { resolveMcpAccessToken, type McpPrincipal } from './oauth.ts';

export type BearerResult = { ok: true; principal: McpPrincipal } | { ok: false; reason: 'missing' | 'invalid' | 'scope' };

/** Resolve `Authorization: Bearer` for /mcp: an OAuth access token, or a personal token with an mcp scope. */
export async function principalFrom(db: Db, authorization: string | null): Promise<BearerResult> {
  const m = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!m) return { ok: false, reason: 'missing' };
  const token = m[1]!;
  if (token.startsWith(TOKEN_PREFIX.personal)) {
    const row = await resolveApiToken(db, token);
    if (!row) return { ok: false, reason: 'invalid' };
    const scopes = (row.scopes as string[] | undefined) ?? [];
    if (!tokenAllows(scopes, 'mcp', 'read')) return { ok: false, reason: 'scope' };
    return {
      ok: true,
      principal: { userId: row.user.id, workspaceId: null, canWrite: tokenAllows(scopes, 'mcp', 'write'), via: 'personal', grantId: null, clientName: null },
    };
  }
  const p = await resolveMcpAccessToken(db, token);
  return p ? { ok: true, principal: p } : { ok: false, reason: 'invalid' };
}

export interface ResolvedCapture {
  rec: RecordingRow;
  seat: SeatRole | null;
  via: 'member' | 'share';
  /** may rename, move and delete (admin, or the creator's own capture) */
  canEdit: boolean;
  /** share token, when the reference was a share link */
  shareToken: string | null;
  /** false when reached through a content-only share link (J-118): no console, network or events */
  devtools: boolean;
}

const SHARE_IN_TEXT = /\/s\/([A-Za-z0-9_-]{22})(?:\.md)?(?=$|[/?#\s])/;

/** A capture by id, member URL or share URL, checked against the caller's rights. */
export async function resolveCapture(db: Db, p: Pick<McpPrincipal, 'userId' | 'workspaceId'>, ref: string, need: 'read' | 'comment' | 'edit' = 'read'): Promise<ResolvedCapture> {
  let id = parseCaptureRef(ref);
  let shareToken: string | null = null;
  let shareGrant: string | null = null;
  let shareDevtools = true;
  if (!id) {
    const m = ref.match(SHARE_IN_TEXT) ?? (/^[A-Za-z0-9_-]{22}$/.test(ref.trim()) ? [ref, ref.trim()] : null);
    if (m) {
      const s = await findShare(db, m[1]!);
      if (s) {
        id = s.rec.id;
        shareToken = m[1]!;
        shareGrant = s.rec.id;
        shareDevtools = s.link.devtools;
      }
    }
  }
  if (!id) fail('not_found', 'No capture id or share link found in that text. Pass a capture URL like <server>/c/<id> or a share link.');
  const [rec] = await db.select().from(recording).where(eq(recording.id, id!)).limit(1);
  if (!rec) fail('not_found', 'No such capture.');
  const seat = await seatOf(db, p.userId, rec!.organizationId);
  const folderPrivacy = seat ? await folderPrivacyOf(db, rec!.folderId) : null;
  const d = decideAccess({ mode: 'viewer', rec: rec!, userId: p.userId, seat, folderPrivacy, uploadGrant: null, shareGrant });
  if (!d.ok) fail('not_found', 'No such capture, or it is in a workspace you are not a member of.');
  if (d.via === 'member' && p.workspaceId && rec!.organizationId !== p.workspaceId)
    fail('forbidden', 'This capture is in another workspace than the one this agent was connected to. Reconnect the agent and pick that workspace.');
  const via = d.via === 'share' ? 'share' : 'member';
  const canEdit = via === 'member' && seat !== null && (seat === 'admin' || (seat === 'creator' && rec!.authorUserId === p.userId));
  if (need === 'edit' && !canEdit) fail('forbidden', 'Only the author of this capture or a workspace admin can change it.');
  if (need === 'comment' && via !== 'member') fail('forbidden', 'Commenting needs a seat in the capture\'s workspace.');
  return { rec: rec!, seat, via, canEdit, shareToken, devtools: via === 'member' || shareDevtools };
}

/** The workspace a list or search runs in: the grant's, the one asked for, or the active one. */
export async function workspaceFor(db: Db, p: McpPrincipal, asked?: string | null): Promise<{ id: string; seat: SeatRole }> {
  if (p.workspaceId && asked && asked !== p.workspaceId) fail('forbidden', 'This agent is connected to one workspace only.');
  const id = p.workspaceId ?? asked ?? (await activeWorkspaceId(db, p.userId));
  if (!id) fail('not_found', 'You are not a member of any workspace.');
  const seat = await seatOf(db, p.userId, id!);
  if (!seat) fail('not_found', 'No such workspace, or you are not a member.');
  return { id: id!, seat: seat! };
}

export function requireSeatAtLeast(seat: SeatRole, need: SeatRole, what: string) {
  if (!roleAtLeast(seat, need)) fail('forbidden', `${what} needs the ${need} seat or higher.`);
}
