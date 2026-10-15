// Comments: threads, timestamps, reactions, resolve, mentions, attachments and the live stream
// (J-127 to J-135). Owner: viewer area.
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { REACTION_KEYS, type Comment, type CommentThread, type ReactionKey } from '@toolbar/shared/api';
import { mentionsIn, plainText } from '@toolbar/ui/viewer';
import { db } from '#lib/server/db/index.ts';
import { asset, comment, commentAttachment, commentReaction, member, notification, user } from '#lib/server/db/schema/index.ts';
import { env } from '#lib/server/env.ts';
import { sendMail } from '#lib/server/mail.ts';
import { emailAllowed } from '#lib/server/dashboard/core.ts';
import { fail, type ViewerCtx } from './access.ts';
import { mediaBase } from './detail.ts';
import { authorSnapshot } from '../auth/author.ts';
import { currentBrand } from '../branding/index.ts';

type Row = typeof comment.$inferSelect;
type Person = { id: string; name: string; email: string; image: string | null };

// ---------- live updates (one process; the stream route subscribes here) ----------

export type CommentSignal = { type: 'created' | 'updated'; id: string } | { type: 'deleted'; id: string } | { type: 'reactions'; id: string };
const subscribers = new Map<string, Set<(s: CommentSignal) => void>>();

export function subscribe(recordingId: string, fn: (s: CommentSignal) => void): () => void {
  let set = subscribers.get(recordingId);
  if (!set) subscribers.set(recordingId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) subscribers.delete(recordingId);
  };
}

/** Tell open capture pages about a comment change (the MCP comment tools call it too). */
export function publish(recordingId: string, s: CommentSignal) {
  for (const fn of subscribers.get(recordingId) ?? []) {
    try {
      fn(s);
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}

// ---------- DTOs ----------

async function people(ids: (string | null)[]): Promise<Map<string, Person>> {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map();
  const rows = await db.select({ id: user.id, name: user.name, email: user.email, image: user.image }).from(user).where(inArray(user.id, list));
  return new Map(rows.map((r) => [r.id, r]));
}

async function reactionsOf(ids: string[], actor: string | null) {
  const out = new Map<string, Comment['reactions']>();
  if (!ids.length) return out;
  const rows = await db.select().from(commentReaction).where(inArray(commentReaction.commentId, ids)).orderBy(asc(commentReaction.createdAt));
  for (const id of ids) {
    const mine = rows.filter((r) => r.commentId === id);
    const keys = [...new Set(mine.map((r) => r.key))].filter((k): k is ReactionKey => (REACTION_KEYS as readonly string[]).includes(k));
    out.set(
      id,
      keys.map((key) => ({ key, count: mine.filter((r) => r.key === key).length, mine: !!actor && mine.some((r) => r.key === key && r.actor === actor) })),
    );
  }
  return out;
}

async function attachmentsOf(ids: string[], base: string) {
  const out = new Map<string, Comment['attachments']>();
  if (!ids.length) return out;
  const rows = await db
    .select({ commentId: commentAttachment.commentId, position: commentAttachment.position, a: asset })
    .from(commentAttachment)
    .innerJoin(asset, eq(asset.id, commentAttachment.assetId))
    .where(inArray(commentAttachment.commentId, ids))
    .orderBy(asc(commentAttachment.position));
  for (const r of rows) {
    const list = out.get(r.commentId) ?? [];
    list.push({ id: r.a.id, kind: 'comment', url: `${base}/${r.a.id}`, contentType: r.a.contentType, width: r.a.width, height: r.a.height, bytes: r.a.bytes, name: null });
    out.set(r.commentId, list);
  }
  return out;
}

function toDto(r: Row, ctx: ViewerCtx, who: Map<string, Person>, reactions: Map<string, Comment['reactions']>, atts: Map<string, Comment['attachments']>): Comment {
  const author = r.authorUserId ? who.get(r.authorUserId) : undefined;
  const resolver = r.resolvedBy ? who.get(r.resolvedBy) : undefined;
  // a member's comment keeps its author snapshot (D-114) after the account is deleted
  const anonymous = !r.authorUserId && !r.authorSubject;
  return {
    id: r.id,
    recordingId: r.recordingId,
    parentId: r.parentId,
    author: author ? { id: author.id, name: author.name, email: author.email, image: author.image } : null,
    anonymous,
    displayName: author?.name ?? (anonymous ? (r.authorName ?? 'Anonymous') : 'Deleted user'),
    viaAgent: r.viaAgent ?? null,
    body: r.body,
    tMs: r.tMs,
    attachments: atts.get(r.id) ?? [],
    reactions: reactions.get(r.id) ?? [],
    mentions: mentionsIn(r.body),
    createdAt: r.createdAt.toISOString(),
    editedAt: r.editedAt?.toISOString() ?? null,
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    resolvedBy: resolver ? { id: resolver.id, name: resolver.name, email: resolver.email, image: resolver.image } : null,
    canEdit: !!ctx.user && r.authorUserId === ctx.user.id,
  };
}

async function dtos(rows: Row[], ctx: ViewerCtx): Promise<Comment[]> {
  const ids = rows.map((r) => r.id);
  const who = await people(rows.flatMap((r) => [r.authorUserId, r.resolvedBy]));
  const reactions = await reactionsOf(ids, ctx.actor);
  const atts = await attachmentsOf(ids, mediaBase(ctx.rec, ctx));
  return rows.map((r) => toDto(r, ctx, who, reactions, atts));
}

export async function listThreads(ctx: ViewerCtx, includeResolved = true): Promise<CommentThread[]> {
  const rows = await db
    .select()
    .from(comment)
    .where(and(eq(comment.recordingId, ctx.rec.id), isNull(comment.deletedAt)))
    .orderBy(asc(comment.createdAt));
  const all = await dtos(rows, ctx);
  const top = all.filter((c) => !c.parentId || !all.some((p) => p.id === c.parentId));
  return top
    .filter((c) => includeResolved || !c.resolvedAt)
    .map((c) => ({ ...c, parentId: c.parentId && all.some((p) => p.id === c.parentId) ? c.parentId : null, replies: all.filter((x) => x.parentId === c.id) }));
}

export async function getComment(ctx: ViewerCtx, id: string): Promise<Comment | null> {
  const [r] = await db.select().from(comment).where(and(eq(comment.id, id), isNull(comment.deletedAt))).limit(1);
  if (!r || r.recordingId !== ctx.rec.id) return null;
  return (await dtos([r], ctx))[0]!;
}

/** The capture id of a live comment, or null. */
export async function commentRecording(id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db.select().from(comment).where(and(eq(comment.id, id), isNull(comment.deletedAt))).limit(1);
  return r ?? null;
}

// ---------- writes ----------

export async function createComment(
  ctx: ViewerCtx,
  body: { body: string; parentId?: string; tMs?: number; attachmentAssetIds: string[]; mentions: string[]; anonName?: string },
): Promise<Comment> {
  if (!ctx.user && !ctx.anonKey) fail(400, 'invalid_body', 'Anonymous comments need cookies');
  let parentId: string | null = null;
  if (body.parentId) {
    const p = await commentRecording(body.parentId);
    if (!p || p.recordingId !== ctx.rec.id) fail(404, 'not_found', 'Parent comment not found');
    parentId = p!.parentId ?? p!.id; // one level of replies
  }
  if (body.attachmentAssetIds.length) {
    const owned = await db.select({ id: asset.id, rec: asset.recordingId }).from(asset).where(inArray(asset.id, body.attachmentAssetIds));
    if (owned.length !== body.attachmentAssetIds.length || owned.some((a) => a.rec && a.rec !== ctx.rec.id)) fail(422, 'invalid_body', 'Unknown attachment');
  }
  const who = ctx.user ? await authorSnapshot(db, ctx.user.id) : null;
  const [row] = await db
    .insert(comment)
    .values({
      recordingId: ctx.rec.id,
      parentId,
      authorUserId: ctx.user?.id ?? null,
      authorName: who ? who.name : (body.anonName?.trim() || null),
      authorEmail: who?.email ?? null,
      authorIssuer: who?.issuer ?? null,
      authorSubject: who?.subject ?? null,
      anonKey: ctx.user ? null : ctx.anonKey,
      body: body.body,
      tMs: body.tMs ?? null,
    })
    .returning();
  if (body.attachmentAssetIds.length)
    await db.insert(commentAttachment).values(body.attachmentAssetIds.map((assetId, position) => ({ commentId: row!.id, assetId, position })));
  void notifyMentions(ctx, row!, [...new Set([...body.mentions, ...mentionsIn(body.body)])]).catch((e) => console.error('[viewer] mention mail failed', e));
  publish(ctx.rec.id, { type: 'created', id: row!.id });
  return (await dtos([row!], ctx))[0]!;
}

/** Email each mentioned workspace member (J-135); skips the author and non-members. */
export async function notifyMentions(ctx: ViewerCtx, row: { id: string; body: string; tMs: number | null } | null, ids: string[], where = 'a comment') {
  if (!ids.length) return [];
  const members = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.rec.organizationId), inArray(member.userId, ids)));
  const by = ctx.user?.name ?? 'Someone';
  const sent: string[] = [];
  for (const m of members) {
    if (m.id === ctx.user?.id) continue;
    const link = `${env.publicUrl}/c/${ctx.rec.id}${row ? `?comment=${row.id}` : ''}`;
    const text = `${by} mentioned you in ${where} on "${ctx.rec.title || 'Untitled capture'}".\n\n${row ? plainText(row.body) + '\n\n' : ''}Open it: ${link}\n`;
    // J-136: the mentions email follows the member's notification settings
    if (await emailAllowed(db, m.id, 'mentions')) await sendMail(m.email, `${by} mentioned you on ${currentBrand().name}`, text);
    await db.insert(notification).values({ userId: m.id, type: 'mention', recordingId: ctx.rec.id, payload: { commentId: row?.id ?? null, by } });
    sent.push(m.email);
  }
  return sent;
}

export async function updateComment(ctx: ViewerCtx, row: Row, text: string): Promise<Comment> {
  if (!ctx.user || row.authorUserId !== ctx.user.id) fail(403, 'forbidden', 'You can only edit your own comments');
  const before = new Set(mentionsIn(row.body));
  const [r] = await db.update(comment).set({ body: text, editedAt: new Date() }).where(eq(comment.id, row.id)).returning();
  const added = mentionsIn(text).filter((id) => !before.has(id));
  void notifyMentions(ctx, r!, added).catch(() => {});
  publish(ctx.rec.id, { type: 'updated', id: row.id });
  return (await dtos([r!], ctx))[0]!;
}

export async function deleteComment(ctx: ViewerCtx, row: Row) {
  const own = !!ctx.user && row.authorUserId === ctx.user.id;
  const admin = ctx.role === 'admin' && !!row.authorUserId;
  if (!own && !admin) fail(403, 'forbidden', 'You can only delete your own comments');
  const now = new Date();
  await db.update(comment).set({ deletedAt: now }).where(eq(comment.id, row.id));
  if (!row.parentId) await db.update(comment).set({ deletedAt: now }).where(and(eq(comment.parentId, row.id), isNull(comment.deletedAt)));
  publish(ctx.rec.id, { type: 'deleted', id: row.id });
}

export async function resolveComment(ctx: ViewerCtx, row: Row, resolved: boolean): Promise<Comment> {
  const [r] = await db
    .update(comment)
    .set(resolved ? { resolvedAt: new Date(), resolvedBy: ctx.user!.id } : { resolvedAt: null, resolvedBy: null })
    .where(eq(comment.id, row.parentId ?? row.id))
    .returning();
  publish(ctx.rec.id, { type: 'updated', id: r!.id });
  return (await dtos([r!], ctx))[0]!;
}

export async function react(ctx: ViewerCtx, row: Row, key: ReactionKey, on: boolean) {
  if (!ctx.actor) fail(400, 'invalid_body', 'Reactions need cookies');
  if (on) await db.insert(commentReaction).values({ commentId: row.id, actor: ctx.actor!, key }).onConflictDoNothing();
  else await db.delete(commentReaction).where(and(eq(commentReaction.commentId, row.id), eq(commentReaction.actor, ctx.actor!), eq(commentReaction.key, key)));
  publish(ctx.rec.id, { type: 'reactions', id: row.id });
  return (await reactionsOf([row.id], ctx.actor)).get(row.id) ?? [];
}

export { reactionsOf };
