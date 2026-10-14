// Dashboard area server helpers: the caller's workspace and seat, capture cards, folder short
// ids, the audit log, per-user settings. Route files under api/v1 call these.
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DEFAULT_USER_SETTINGS, roleAtLeast, type AUDIT_ACTIONS, type CaptureSummary, type Person, type SeatRole, type UserSettings } from '@toolbar/shared/api';
import { SHORT_ID_ALPHABET } from '@toolbar/shared/areas/dashboard';
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/index.ts';
import { auditLog, comment, folder, linkedIssue, recording, recordingLink, user, userSettings } from '../db/schema/index.ts';
import { activeWorkspaceId } from '../auth/workspaces.ts';
import { seatOf } from '../share/access.ts';
import { fail } from '../share/http.ts';
import { env } from '../env.ts';

export type RecordingRow = typeof recording.$inferSelect;
export type FolderRow = typeof folder.$inferSelect;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUserId(event: RequestEvent): string {
  const id = event.locals.user?.id;
  if (!id) fail('unauthorized', 'Sign in or send a bearer token');
  return id;
}

/** The workspace a call acts in (the given one, else the caller's active one) and the caller's seat. */
export async function workspaceFor(db: Db, event: RequestEvent, workspaceId: string | undefined | null, need: SeatRole = 'viewer') {
  const userId = requireUserId(event);
  const ws = workspaceId ?? (await activeWorkspaceId(db, userId));
  if (!ws) fail('not_found', 'You are not in a workspace yet');
  const seat = await seatOf(db, userId, ws);
  if (!seat) fail('not_found', 'No such workspace');
  if (!roleAtLeast(seat, need)) fail('forbidden', `This needs the ${need} seat or higher`);
  return { userId, workspaceId: ws, seat };
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function personOf(u: { id: string | null; name: string | null; email: string | null; image?: string | null } | null): Person | null {
  if (!u || (!u.id && !u.name && !u.email)) return null;
  return { id: u.id, name: u.name ?? u.email ?? 'Unknown', email: u.email, image: u.image ?? null };
}

export async function peopleById(db: Db, ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await db.select({ id: user.id, name: user.name, email: user.email, image: user.image }).from(user).where(inArray(user.id, list));
  return new Map(rows.map((r) => [r.id, personOf(r)!]));
}

export const captureUrl = (id: string) => `${env.publicUrl}/c/${id}`;
export const mediaUrl = (id: string, name: string) => `${env.publicUrl}/api/v1/recordings/${id}/media/${name}`;

/** Card rows (J-158) for recordings: author, link name, comment counts, linked issues. */
export async function toSummaries(db: Db, recs: RecordingRow[]): Promise<CaptureSummary[]> {
  if (!recs.length) return [];
  const ids = recs.map((r) => r.id);
  const people = await peopleById(db, recs.map((r) => r.authorUserId));
  const linkIds = [...new Set(recs.map((r) => r.recordingLinkId).filter((x): x is string => !!x))];
  const links = linkIds.length
    ? await db.select({ id: recordingLink.id, name: recordingLink.name }).from(recordingLink).where(inArray(recordingLink.id, linkIds))
    : [];
  const linkName = new Map(links.map((l) => [l.id, l.name || 'Recording link']));
  const counts = await db
    .select({ id: comment.recordingId, n: sql<number>`count(*)::int` })
    .from(comment)
    .where(and(inArray(comment.recordingId, ids), isNull(comment.deletedAt)))
    .groupBy(comment.recordingId);
  const commentCount = new Map(counts.map((c) => [c.id, Number(c.n)]));
  const issues = await db.select({ id: linkedIssue.recordingId }).from(linkedIssue).where(inArray(linkedIssue.recordingId, ids));
  const withIssue = new Set(issues.map((i) => i.id));
  return recs.map((r) => {
    const p = r.authorUserId ? people.get(r.authorUserId) : null;
    const author = p ?? personOf({ id: r.authorUserId, name: r.authorName, email: r.authorEmail });
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      title: r.title,
      pageUrl: r.pageUrl,
      createdAt: (r.finalizedAt ?? r.createdAt).toISOString(),
      durationMs: r.durationMs,
      authorName: author?.name ?? null,
      thumbUrl: r.thumbKey ? mediaUrl(r.id, 'thumb') : r.kind === 'screenshot' && r.status === 'ready' ? mediaUrl(r.id, 'screenshot') : null,
      workspaceId: r.organizationId,
      folderId: r.folderId,
      source: r.source,
      author,
      recordingLinkId: r.recordingLinkId,
      recordingLinkName: r.recordingLinkId ? (linkName.get(r.recordingLinkId) ?? null) : null,
      commentCount: commentCount.get(r.id) ?? 0,
      hasLinkedIssue: withIssue.has(r.id),
      url: captureUrl(r.id),
    };
  });
}

// ---------- folder short ids (J-162) ----------

export function newShortId(len = 4): string {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += SHORT_ID_ALPHABET[b[i]! % SHORT_ID_ALPHABET.length];
  return s;
}

/** Give every folder in the list a short id (older rows and the seed have none). */
export async function ensureShortIds(db: Db, rows: FolderRow[]): Promise<FolderRow[]> {
  const out: FolderRow[] = [];
  for (const f of rows) {
    if (f.shortId) {
      out.push(f);
      continue;
    }
    for (let attempt = 0; ; attempt++) {
      const sid = newShortId(attempt < 6 ? 4 : 6);
      try {
        const [u] = await db.update(folder).set({ shortId: sid }).where(and(eq(folder.id, f.id), isNull(folder.shortId))).returning();
        if (u) out.push(u);
        else out.push((await db.select().from(folder).where(eq(folder.id, f.id)))[0]!);
        break;
      } catch (e) {
        if (attempt > 10) throw e;
      }
    }
  }
  return out;
}

/** A folder by uuid or short id. */
export async function findFolder(db: Db, idOrShort: string): Promise<FolderRow | null> {
  const where = UUID.test(idOrShort) ? eq(folder.id, idOrShort) : eq(folder.shortId, idOrShort.toLowerCase());
  const [f] = await db.select().from(folder).where(where).limit(1);
  return f ? (await ensureShortIds(db, [f]))[0]! : null;
}

// ---------- audit log (J-178) ----------

export async function audit(
  db: Db,
  e: {
    workspaceId: string;
    actorId: string | null;
    action: (typeof AUDIT_ACTIONS)[number];
    target?: { type: string; id: string; label?: string | null } | null;
    details?: Record<string, unknown>;
  },
) {
  try {
    await db.insert(auditLog).values({
      organizationId: e.workspaceId,
      actorUserId: e.actorId,
      action: e.action,
      targetType: e.target?.type ?? null,
      targetId: e.target?.id ?? null,
      targetLabel: e.target?.label ?? null,
      details: e.details ?? {},
    });
  } catch (err) {
    console.warn('[dashboard] audit write failed', err);
  }
}

// ---------- per-user settings ----------

type Group = keyof UserSettings;
const GROUPS: Group[] = ['notifications', 'extension', 'editor', 'viewer'];

/** Stored settings over the defaults, group by group and key by key. */
export function mergeSettings(stored: unknown): UserSettings {
  const src = (stored && typeof stored === 'object' ? stored : {}) as Record<string, Record<string, unknown> | undefined>;
  const out = structuredClone(DEFAULT_USER_SETTINGS) as unknown as Record<string, Record<string, unknown>>;
  for (const g of GROUPS) {
    const s = src[g];
    if (!s || typeof s !== 'object') continue;
    for (const k of Object.keys(out[g]!)) if (k in s) out[g]![k] = s[k];
  }
  return out as unknown as UserSettings;
}

export async function settingsRow(db: Db, userId: string) {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  return row ?? null;
}

export async function getUserSettings(db: Db, userId: string): Promise<UserSettings> {
  return mergeSettings((await settingsRow(db, userId))?.settings);
}

/** Merge a patch into the raw stored object (keeps extra keys such as the onboarding flag). */
export async function patchRawSettings(db: Db, userId: string, patch: Record<string, unknown>) {
  const cur = ((await settingsRow(db, userId))?.settings ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object') next[k] = { ...(cur[k] as object), ...v };
    else next[k] = v;
  }
  await db
    .insert(userSettings)
    .values({ userId, settings: next })
    .onConflictDoUpdate({ target: userSettings.userId, set: { settings: next, updatedAt: new Date() } });
  return next;
}

/** May this user receive this kind of email (J-136)? Other areas call this before sending. */
export async function emailAllowed(db: Db, userId: string, kind: 'firstView' | 'sharedWithMe' | 'recordingLinkUsed' | 'domainSignup' | 'mentions'): Promise<boolean> {
  const s = (await getUserSettings(db, userId)).notifications;
  return !s.allOff && s[kind];
}
