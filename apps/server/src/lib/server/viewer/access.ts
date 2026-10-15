// Who may see a capture, and with what rights. Members of the capture's workspace see it with
// their seat role; anyone else needs a share token (x-toolbar-share header on API calls, the URL on
// /s/:token pages; D-030). Owner: viewer area. Share-token rules follow architecture s8; the
// server-core area owns minting and revoking tokens.
import { json, type Cookies, type RequestEvent } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { SHARE_TOKEN_HEADER, roleAtLeast, seatRoleOf, type ErrorCode, type SeatRole } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { member, recording, shareLink } from '#lib/server/db/schema/index.ts';
import { hashToken } from '#lib/server/tokens.ts';
import { folderGuestRole } from '#lib/server/share/access.ts';

export type RecordingRow = typeof recording.$inferSelect;
export type ShareLinkRow = typeof shareLink.$inferSelect;
export type ViewerUser = NonNullable<App.Locals['user']>;

export interface ViewerCtx {
  rec: RecordingRow;
  user: ViewerUser | null;
  /** Seat role in the capture's workspace; null for share-token viewers who are not members. */
  role: SeatRole | null;
  /** Set when access came through a share token. */
  share: { link: ShareLinkRow; token: string; devtools: boolean } | null;
  /** Per-browser id for anonymous comments and reactions. */
  anonKey: string | null;
  canEdit: boolean;
  canComment: boolean;
  /** `u:<id>` or `a:<anonKey>`, for reactions and views. */
  actor: string | null;
}

/** Thrown inside handlers; `handle()` turns it into a contract error body. */
export class ApiFail extends Error {
  constructor(
    public status: number,
    public code: ErrorCode | string,
    message?: string,
    public issues?: unknown,
  ) {
    super(message ?? code);
  }
}

export const fail = (status: number, code: ErrorCode | string, message?: string): never => {
  throw new ApiFail(status, code, message);
};

/** Wrap a +server.ts handler so ApiFail and zod failures become `{ error, message, issues }`. */
export function handle<E extends RequestEvent>(fn: (event: E) => Promise<Response> | Response) {
  return async (event: E): Promise<Response> => {
    try {
      return await fn(event);
    } catch (e) {
      if (e instanceof ApiFail) return json({ error: e.code, message: e.message, issues: e.issues }, { status: e.status });
      throw e;
    }
  };
}

const ANON_COOKIE = 'tb_anon';

/** Read (and with `create`, set) the anonymous visitor id cookie. */
export function anonKeyOf(cookies: Cookies, create = false): string | null {
  const v = cookies.get(ANON_COOKIE);
  if (v && /^[A-Za-z0-9_-]{16,64}$/.test(v)) return v;
  if (!create) return null;
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
  cookies.set(ANON_COOKIE, key, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365, secure: false });
  return key;
}

export async function loadRecording(id: string): Promise<RecordingRow | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const [r] = await db.select().from(recording).where(and(eq(recording.id, id), isNull(recording.deletedAt))).limit(1);
  return r ?? null;
}

/** Role of a user in a workspace, or null when not a member. */
export async function roleIn(userId: string, organizationId: string): Promise<SeatRole | null> {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);
  return m ? seatRoleOf(m.role) : null;
}

/**
 * A live share link for a token: not revoked, not expired. The content-only flag (J-118) is read
 * from a `devtools` column when server-core adds one; until then every token shows dev tools and
 * the content-only link is the same token with ?devtools=0.
 */
export async function findShareLink(token: string): Promise<ShareLinkRow | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const [l] = await db.select().from(shareLink).where(eq(shareLink.tokenHash, hashToken(token))).limit(1);
  if (!l || l.revokedAt || (l.expiresAt && l.expiresAt.getTime() < Date.now())) return null;
  return l;
}

export const linkDevtools = (l: ShareLinkRow) => (l as ShareLinkRow & { devtools?: boolean | null }).devtools !== false;

/**
 * Resolve access to a capture. `token` comes from the page URL or the x-toolbar-share header.
 * Unknown, deleted or unshared captures are 404; a workspace-only link while signed out is 401.
 */
export async function viewerAccess(
  event: Pick<RequestEvent, 'locals' | 'request' | 'cookies'>,
  id: string,
  opts: { token?: string | null } = {},
): Promise<ViewerCtx> {
  const rec = await loadRecording(id);
  if (!rec) fail(404, 'not_found', 'Capture not found');
  const r = rec!;
  const user = event.locals.user;
  let role = user ? await roleIn(user.id, r.organizationId) : null;
  // a folder guest sees the folder's captures as a viewer (J-122)
  if (!role && user && !r.private && (await folderGuestRole(db, user.id, r.folderId))) role = 'viewer';
  const token = opts.token ?? event.request.headers.get(SHARE_TOKEN_HEADER);
  let share: ViewerCtx['share'] = null;
  if (token) {
    const link = await findShareLink(token);
    if (link && link.recordingId === r.id) {
      if (link.access === 'workspace' && !role) fail(user ? 403 : 401, user ? 'forbidden' : 'unauthorized', 'Members of the workspace only');
      share = { link, token, devtools: linkDevtools(link) };
      void db.update(shareLink).set({ lastUsedAt: new Date() }).where(eq(shareLink.id, link.id)).catch(() => {});
    } else if (!role) fail(404, 'not_found', 'Capture not found');
  }
  if (!role && !share) {
    if (!user) fail(401, 'unauthorized', 'Sign in or open a share link');
    fail(404, 'not_found', 'Capture not found');
  }
  const anonKey = user ? null : anonKeyOf(event.cookies);
  return {
    rec: r,
    user,
    role,
    share,
    anonKey,
    canEdit: !!role && roleAtLeast(role, 'creator'),
    canComment: true,
    actor: user ? `u:${user.id}` : anonKey ? `a:${anonKey}` : null,
  };
}

/** Members only (PATCH, comment edits): a share token is not enough. */
export async function memberAccess(event: Pick<RequestEvent, 'locals' | 'request' | 'cookies'>, id: string, need: SeatRole = 'viewer') {
  if (!event.locals.user) fail(401, 'unauthorized', 'Sign in first');
  const ctx = await viewerAccess(event, id, { token: null });
  if (!ctx.role) fail(404, 'not_found', 'Capture not found');
  if (!roleAtLeast(ctx.role!, need)) fail(403, 'forbidden', `Needs the ${need} role`);
  return ctx;
}

/** Parse a JSON body with a route's zod schema; failures become 400 bad_json or 422 invalid_body. */
export async function jsonBody<T>(request: Request, schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: unknown; message: string } } }): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    fail(400, 'bad_json', 'Body must be JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiFail(422, 'invalid_body', 'Invalid body', r.error.issues);
  return r.data;
}
