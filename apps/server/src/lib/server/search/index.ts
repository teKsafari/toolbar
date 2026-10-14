// Palette and MCP search (J-161, J-228, J-150, J-241): members, folders and captures of one
// workspace. Captures match on title, description, page URL, author, comments, transcript text,
// linked issue keys and ids; a pasted capture URL or id finds that capture.
import { and, desc, eq, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { parseCaptureRef, seatRoleOf, type SearchResult, type SeatRole, type searchQuerySchema } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { captureView, folder, member, recording, user } from '../db/schema/index.ts';
import { visibleCapturesWhere, visibleFoldersWhere } from '../share/access.ts';
import { personOf, toSummaries } from '../dashboard/core.ts';
import { toFolders } from '../dashboard/folders.ts';
import { captureFilters } from '../dashboard/captures.ts';

type Q = z.output<typeof searchQuerySchema>;

const likeOf = (s: string) => `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;

/** A short window of text around the first hit. */
export function snippet(text: string, q: string, radius = 50): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return flat.slice(0, radius * 2);
  const a = Math.max(0, i - radius);
  const b = Math.min(flat.length, i + q.length + radius);
  return `${a > 0 ? '...' : ''}${flat.slice(a, b)}${b < flat.length ? '...' : ''}`;
}

/** WebVTT to plain text (cue lines only). */
const vttText = (v: string) =>
  v
    .split('\n')
    .filter((l) => l && !/^WEBVTT|^\d+$|-->/.test(l.trim()))
    .join(' ');

export async function search(db: Db, q: Q, ctx: { workspaceId: string; userId: string; seat: SeatRole }): Promise<SearchResult> {
  const text = q.q.trim();
  const filters = captureFilters(
    { kinds: q.kinds, sources: q.sources, authors: q.authors, folderId: q.folderId ?? 'all', hasIssue: q.hasIssue, from: q.from, to: q.to },
    ctx.workspaceId,
    ctx.userId,
    ctx.seat,
  );
  if (!text) {
    const rows = await db.select().from(recording).where(filters).orderBy(desc(recording.createdAt)).limit(q.limit);
    const caps = await toSummaries(db, rows);
    return { members: [], folders: [], captures: caps.map((c) => ({ ...c, match: null })), total: caps.length };
  }
  const like = likeOf(text);

  // members (J-228)
  const mrows = await db
    .select({ u: { id: user.id, name: user.name, email: user.email, image: user.image }, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, ctx.workspaceId), sql`(${user.name} ILIKE ${like} OR ${user.email} ILIKE ${like})`))
    .limit(5);
  const members = mrows.map((m) => ({ userId: m.u.id, person: personOf(m.u)!, role: seatRoleOf(m.role) }));

  // folders
  const frows = await db
    .select()
    .from(folder)
    .where(and(eq(folder.organizationId, ctx.workspaceId), sql`${folder.name} ILIKE ${like}`, visibleFoldersWhere(ctx.userId, ctx.seat)))
    .limit(5);
  const folders = await toFolders(db, frows, ctx);

  // captures: a pasted id or URL first
  const ref = parseCaptureRef(text);
  const fields: { field: SearchResult['captures'][number]['match'] extends infer M ? (M extends { field: infer F } ? F : never) : never; cond: SQL }[] = [
    { field: 'title', cond: sql`${recording.title} ILIKE ${like}` },
    { field: 'description', cond: sql`${recording.description} ILIKE ${like}` },
    { field: 'url', cond: sql`${recording.pageUrl} ILIKE ${like}` },
    { field: 'author', cond: sql`(${recording.authorName} ILIKE ${like} OR EXISTS (SELECT 1 FROM "user" au WHERE au.id = ${recording.authorUserId} AND au.name ILIKE ${like}))` },
    { field: 'comment', cond: sql`EXISTS (SELECT 1 FROM comment c WHERE c.recording_id = ${recording.id} AND c.deleted_at IS NULL AND c.body ILIKE ${like})` },
    { field: 'transcript', cond: sql`EXISTS (SELECT 1 FROM transcript t WHERE t.recording_id = ${recording.id} AND t.vtt ILIKE ${like})` },
    { field: 'issue', cond: sql`EXISTS (SELECT 1 FROM linked_issue li WHERE li.recording_id = ${recording.id} AND (li.key ILIKE ${like} OR li.url ILIKE ${like}))` },
  ];
  const anyField = ref ? sql`(${recording.id} = ${ref} OR ${sql.join(fields.map((f) => f.cond), sql` OR `)})` : sql`(${sql.join(fields.map((f) => f.cond), sql` OR `)})`;
  const where = and(filters, anyField)!;
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(recording).where(where)) as [{ n: number }];
  const rows = await db
    .select()
    .from(recording)
    .where(where)
    .orderBy(ref ? sql`(${recording.id} = ${ref}) DESC` : sql`1`, desc(recording.createdAt))
    .limit(q.limit);
  const summaries = await toSummaries(db, rows);

  // which field matched, with a snippet (description hits are shown highlighted in the preview)
  const captures: SearchResult['captures'] = [];
  for (const [i, r] of rows.entries()) {
    let match: SearchResult['captures'][number]['match'] = null;
    const lower = text.toLowerCase();
    if (ref && r.id === ref) match = { field: 'id', snippet: r.id };
    else if (r.title.toLowerCase().includes(lower)) match = { field: 'title', snippet: snippet(r.title, text) };
    else if (r.description.toLowerCase().includes(lower)) match = { field: 'description', snippet: snippet(r.description, text) };
    else if (r.pageUrl?.toLowerCase().includes(lower)) match = { field: 'url', snippet: r.pageUrl };
    else if ((summaries[i]!.authorName ?? r.authorName)?.toLowerCase().includes(lower)) match = { field: 'author', snippet: summaries[i]!.authorName ?? r.authorName ?? '' };
    else {
      const [c] = (await db.execute(sql`SELECT body FROM comment WHERE recording_id = ${r.id} AND deleted_at IS NULL AND body ILIKE ${like} LIMIT 1`)) as unknown as { body: string }[];
      if (c) match = { field: 'comment', snippet: snippet(c.body, text) };
      else {
        const [t] = (await db.execute(sql`SELECT vtt FROM transcript WHERE recording_id = ${r.id} AND vtt ILIKE ${like} LIMIT 1`)) as unknown as { vtt: string }[];
        if (t) match = { field: 'transcript', snippet: snippet(vttText(t.vtt), text) };
        else {
          const [li] = (await db.execute(sql`SELECT key FROM linked_issue WHERE recording_id = ${r.id} AND (key ILIKE ${like} OR url ILIKE ${like}) LIMIT 1`)) as unknown as { key: string }[];
          if (li) match = { field: 'issue', snippet: li.key };
        }
      }
    }
    captures.push({ ...summaries[i]!, match });
  }
  return { members, folders, captures, total: Number(n) + members.length + folders.length };
}

/** Recently viewed captures (J-161 empty palette); newest captures when nothing was viewed yet. */
export async function recent(db: Db, limit: number, ctx: { workspaceId: string; userId: string; seat: SeatRole }) {
  const vis = and(eq(recording.organizationId, ctx.workspaceId), visibleCapturesWhere(ctx.userId, ctx.seat));
  const viewed = await db
    .select({ r: recording })
    .from(captureView)
    .innerJoin(recording, eq(recording.id, captureView.recordingId))
    .where(and(eq(captureView.userId, ctx.userId), vis))
    .orderBy(desc(captureView.lastAt))
    .limit(limit);
  let rows = viewed.map((v) => v.r);
  if (rows.length < limit) {
    const more = await db
      .select()
      .from(recording)
      .where(and(vis, rows.length ? notInArray(recording.id, rows.map((r) => r.id)) : undefined, isNull(recording.deletedAt)))
      .orderBy(desc(recording.createdAt))
      .limit(limit - rows.length);
    rows = [...rows, ...more];
  }
  return toSummaries(db, rows);
}

