// The bulk feedback export (D-183): every matching capture at once, for an agent that learns from
// many pieces of feedback. One page of captures is picked from the filters (newest first, at most
// `limit`, and no more stored media than EXPORT_MAX_MB), a cheap digest is built per capture (no
// images, no OCR), INDEX.md is rendered from the digests, and the archive streams: INDEX.md first,
// then one folder at a time in the per-capture layout (assemble.ts), so only one folder is in
// memory at once. The REST routes (/api/v1/feedback, /export, /index) and the MCP tools
// (list_feedback, get_feedback_index) share this file.
import { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { EnvInfo, RecordingKind } from '@toolbar/shared';
import type { SeatRole } from '@toolbar/shared/api';
import type { FeedbackFilters, FeedbackList, FeedbackListItem } from '@toolbar/shared/api';
import { prepare } from '@toolbar/shared/derive';
import { redactUrl, scrubText } from '@toolbar/shared/redact';
import { FEEDBACK_DIR, TOKEN_ENV, folderApiPath, folderDir, pullCommand, type MaskingPresetName } from '@toolbar/shared/areas/handoff';
import {
  EXPORT_API_PATH,
  FEEDBACK_INDEX_API_PATH,
  PROBLEM_OUTCOMES,
  indexFileOf,
  renderIndex,
  routeOf,
  summaryOf,
  type CaptureDigest,
} from '@toolbar/shared/areas/feedback-index';
import type { Db } from '../db/index.ts';
import { annotation, comment, feedbackResolution, recording, recordingStream, transcript, user } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { fail } from '../share/http.ts';
import { visibleCapturesWhere, type RecordingRow } from '../share/access.ts';
import { loadEvents, memberUrlOf } from '../mcp/data.ts';
import { parseVtt } from '../transcribe/vtt.ts';
import { traceConfigOf } from '../projects.ts';
import { assembleFolder } from './assemble.ts';
import { collectFolder, serverIo } from './folder.ts';
import { feedbackItemsOf } from './items.ts';
import { deriveSpans } from './spans.ts';
import { tarEnd, tarEntryParts } from './tar.ts';

/** Who asks, in which workspace, with which seat (the routes and MCP tools resolve it). */
export interface ExportScope {
  userId: string;
  workspaceId: string;
  seat: SeatRole;
}

export interface ExportPage {
  recs: RecordingRow[];
  /** captures matching the filters, every page together */
  total: number;
  page: number;
  nextCursor: string | null;
  stoppedBy: 'limit' | 'size' | null;
  /** estimated stored media of this page, bytes */
  bytes: number;
}

// ---------- cursor ----------

interface Cursor {
  /** page number of the page this cursor starts */
  p: number;
  /** created_at of the last capture of the previous page, microseconds, as Postgres prints it */
  t: string;
  id: string;
}

export function encodeExportCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeExportCursor(s: string | undefined): Cursor | null {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.p !== 'number' || typeof c.t !== 'string' || typeof c.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(c.id) || Number.isNaN(Date.parse(c.t))) throw new Error('shape');
    return c;
  } catch {
    return fail('invalid_query', 'cursor is not a cursor this server handed out; pass x-next-cursor or nextCursor unchanged.');
  }
}

// ---------- filters ----------

const dayStart = (s: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);

async function filterWhere(db: Db, scope: ExportScope, f: FeedbackFilters): Promise<SQL> {
  const conds: (SQL | undefined)[] = [eq(recording.organizationId, scope.workspaceId), visibleCapturesWhere(scope.userId, scope.seat)];
  if (f.project) conds.push(eq(recording.projectId, f.project));
  if (f.folder === 'none') conds.push(isNull(recording.folderId));
  else if (f.folder) conds.push(eq(recording.folderId, f.folder));
  const resolved = sql`exists (select 1 from feedback_resolution fr where fr.recording_id = ${recording.id})`;
  if (f.status === 'unresolved') conds.push(sql`not ${resolved}`);
  else if (f.status === 'resolved') conds.push(resolved);
  if (f.since) conds.push(sql`${recording.createdAt} >= ${dayStart(f.since).toISOString()}::timestamptz`);
  if (f.until) conds.push(sql`${recording.createdAt} < ${dayStart(f.until).toISOString()}::timestamptz`);
  if (f.kind?.length) conds.push(inArray(recording.kind, f.kind as RecordingKind[]));
  if (f.creator) {
    const c = f.creator.trim();
    if (c === 'me') conds.push(eq(recording.authorUserId, scope.userId));
    else if (c.includes('@'))
      conds.push(
        sql`(lower(${recording.authorEmail}) = lower(${c}) or exists (select 1 from "user" u where u.id = ${recording.authorUserId} and lower(u.email) = lower(${c})))`,
      );
    else if (/^[0-9a-f-]{36}$/i.test(c)) conds.push(eq(recording.authorUserId, c));
    else fail('invalid_query', 'creator is a user id, an email address or "me".');
  }
  return and(...conds)!;
}

/** Stored media a capture's folder carries (images, rrweb, events, voice), for the size cap. */
const estimateSql = sql<number>`(
  coalesce((select sum(a.bytes) from asset a where a.recording_id = ${recording.id}), 0) +
  coalesce((select sum(s.total_bytes) from recording_stream s where s.recording_id = ${recording.id} and s.name in ('rrweb', 'events', 'voice')), 0)
)::bigint`;
const createdText = sql<string>`to_char(${recording.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** One page: newest first, at most `limit` captures and about EXPORT_MAX_MB of stored media (always one capture at least). */
export async function selectPage(db: Db, scope: ExportScope, f: FeedbackFilters, opts: { maxBytes?: number } = {}): Promise<ExportPage> {
  const maxBytes = opts.maxBytes ?? env.handoff.exportMaxMb * 1024 * 1024;
  const where = await filterWhere(db, scope, f);
  const cur = decodeExportCursor(f.cursor);
  const pageWhere = cur ? and(where, sql`(${recording.createdAt}, ${recording.id}) < (${cur.t}::timestamptz, ${cur.id}::uuid)`)! : where;
  const rows = await db
    .select({ r: recording, bytes: estimateSql, created: createdText })
    .from(recording)
    .where(pageWhere)
    .orderBy(desc(recording.createdAt), desc(recording.id))
    .limit(f.limit + 1);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(recording).where(where);
  const picked: typeof rows = [];
  let bytes = 0;
  let stoppedBy: ExportPage['stoppedBy'] = null;
  for (const row of rows) {
    if (picked.length >= f.limit) {
      stoppedBy = 'limit';
      break;
    }
    const b = Number(row.bytes ?? 0);
    if (picked.length && bytes + b > maxBytes) {
      stoppedBy = 'size';
      break;
    }
    picked.push(row);
    bytes += b;
  }
  const last = picked.at(-1);
  const page = cur?.p ?? 1;
  const nextCursor = stoppedBy && last ? encodeExportCursor({ p: page + 1, t: last.created, id: last.r.id }) : null;
  return { recs: picked.map((x) => x.r), total: Number(n), page, nextCursor, stoppedBy: nextCursor ? stoppedBy : null, bytes };
}

// ---------- digests ----------

/** Titles the extension wrote, not the reviewer: `Trace: <page>`, or the page title itself. */
function humanTitle(rec: RecordingRow): string | null {
  const t = rec.title?.trim();
  if (!t) return null;
  if (/^Trace: /.test(t) || t === rec.pageTitle?.trim()) return null;
  return t;
}

const isHttp = (n: { type: string }) => n.type !== 'websocket' && n.type !== 'eventsource';

/** The INDEX row of one capture: words, outcome counts, console errors and failed requests. */
export async function digestOf(db: Db, rec: RecordingRow): Promise<CaptureDigest> {
  const masking: MaskingPresetName = (rec.maskingPreset ?? (rec.env as EnvInfo | null)?.maskingPreset ?? 'none') as MaskingPresetName;
  const reviewer = rec.authorName || rec.authorEmail || 'reviewer';
  const events = await loadEvents(db, rec);
  const startedAt = rec.startedAt?.getTime();
  const [video] = await db
    .select({ k: recordingStream.finalKey })
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'video')));
  const p = events ? prepare(events, startedAt ?? null, !!video?.k) : null;
  const spans = events
    ? deriveSpans(events, {
        ...(startedAt !== undefined ? { startedAt } : {}),
        ...(startedAt !== undefined && rec.durationMs != null ? { endedAt: startedAt + rec.durationMs } : {}),
        config: await traceConfigOf(db, rec),
      })
    : null;

  const words: CaptureDigest['words'] = [];
  const title = humanTitle(rec);
  if (title) words.push({ source: 'title', author: reviewer, text: title });
  if (rec.description?.trim()) words.push({ source: 'description', author: reviewer, text: rec.description });
  const anns = await db
    .select({ text: annotation.comment, name: user.name })
    .from(annotation)
    .leftJoin(user, eq(user.id, annotation.authorUserId))
    .where(eq(annotation.recordingId, rec.id))
    .orderBy(asc(annotation.createdAt));
  for (const a of anns) if (a.text?.trim()) words.push({ source: 'annotation', author: a.name ?? reviewer, text: a.text });
  for (const it of await feedbackItemsOf(db, rec.id)) {
    const who = it.authorName ?? it.authorEmail ?? reviewer;
    if (it.comment.trim()) words.push({ source: `note ${it.n}`, author: who, text: it.comment });
    if (it.transcriptStatus === 'done' && it.transcriptText?.trim()) words.push({ source: `voice note ${it.n}`, author: who, text: it.transcriptText });
  }
  const comments = await db
    .select({ body: comment.body, name: user.name, authorName: comment.authorName, viaAgent: comment.viaAgent })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorUserId))
    .where(and(eq(comment.recordingId, rec.id), isNull(comment.deletedAt)))
    .orderBy(asc(comment.createdAt));
  // an agent's own comments are not feedback
  for (const c of comments) if (!c.viaAgent && c.body.trim()) words.push({ source: 'comment', author: c.name ?? c.authorName ?? 'Anonymous', text: c.body });
  const trs = await db.select({ vtt: transcript.vtt, status: transcript.status }).from(transcript).where(eq(transcript.recordingId, rec.id));
  for (const t of trs) if (t.status === 'done' && t.vtt) {
    const text = parseVtt(t.vtt).map((c) => c.text).join(' ').trim();
    if (text) words.push({ source: 'voice transcript', author: reviewer, text });
  }
  const [res] = await db.select({ at: feedbackResolution.resolvedAt }).from(feedbackResolution).where(eq(feedbackResolution.recordingId, rec.id));

  return {
    id: rec.id,
    createdAt: rec.createdAt.toISOString(),
    kind: rec.kind,
    title: rec.title,
    reviewer: rec.authorName || rec.authorEmail || null,
    pageUrl: rec.pageUrl ? redactUrl(rec.pageUrl) : null,
    status: res ? 'resolved' : 'open',
    masking,
    outcomes: spans?.outcomes ?? null,
    problemSpans: (spans?.spans ?? [])
      .filter((s) => (PROBLEM_OUTCOMES as readonly string[]).includes(s.outcome))
      .map((s) => ({ url: s.url ? redactUrl(s.url) : null, outcome: s.outcome })),
    consoleErrors: (p?.console ?? [])
      .filter((c) => (c.kind === 'console' || c.kind === 'error') && c.level === 'error')
      .slice(0, 200)
      .map((c) => ({ message: scrubText(c.message, { emails: masking === 'production' }), count: c.count })),
    failedRequests: (p?.network ?? [])
      .filter((n) => isHttp(n) && (n.state !== 'done' || (n.status ?? 0) >= 400))
      .slice(0, 200)
      .map((n) => ({ method: n.method, url: redactUrl(n.url), status: n.status, state: n.state })),
    words,
  };
}

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await fn(xs[k]!);
      }
    }),
  );
  return out;
}

export const digestsOf = (db: Db, recs: RecordingRow[]) => mapLimit(recs, 4, (r) => digestOf(db, r));

// ---------- query strings and commands ----------

/** The filters as a query string, without the cursor and without defaults. */
export function filtersQuery(f: FeedbackFilters): string {
  const q = new URLSearchParams();
  if (f.workspace) q.set('workspace', f.workspace);
  if (f.project) q.set('project', f.project);
  if (f.folder) q.set('folder', f.folder);
  if (f.status && f.status !== 'unresolved') q.set('status', f.status);
  if (f.since) q.set('since', f.since);
  if (f.until) q.set('until', f.until);
  if (f.kind?.length) q.set('kind', f.kind.join(','));
  if (f.creator) q.set('creator', f.creator);
  if (f.limit && f.limit !== 50) q.set('limit', String(f.limit));
  return q.toString();
}

const withQuery = (path: string, q: string, cursor?: string | null) => {
  const all = [q, cursor ? `cursor=${encodeURIComponent(cursor)}` : ''].filter(Boolean).join('&');
  return `${env.publicUrl}${path}${all ? `?${all}` : ''}`;
};

export const exportCommandOf = (f: FeedbackFilters, cursor?: string | null) =>
  `curl -fsSL -H "Authorization: Bearer $${TOKEN_ENV}" "${withQuery(EXPORT_API_PATH, filtersQuery(f), cursor ?? f.cursor)}" | tar xz`;

function filterLabels(f: FeedbackFilters, scope: ExportScope): Record<string, string> {
  return {
    workspace: scope.workspaceId,
    status: f.status,
    ...(f.project ? { project: f.project } : {}),
    ...(f.folder ? { folder: f.folder } : {}),
    ...(f.since ? { since: f.since } : {}),
    ...(f.until ? { until: f.until } : {}),
    ...(f.kind?.length ? { kind: f.kind.join(',') } : {}),
    ...(f.creator ? { creator: f.creator } : {}),
    limit: String(f.limit),
  };
}

// ---------- the three answers ----------

export interface IndexResult {
  page: ExportPage;
  digests: CaptureDigest[];
  /** INDEX.md (or INDEX-<n>.md) text */
  markdown: string;
  file: string;
}

export async function feedbackIndex(db: Db, scope: ExportScope, f: FeedbackFilters, opts: { maxBytes?: number } = {}): Promise<IndexResult> {
  const page = await selectPage(db, scope, f, opts);
  const digests = await digestsOf(db, page.recs);
  const markdown = renderIndex({
    server: env.publicUrl,
    generatedAt: new Date().toISOString(),
    filters: filterLabels(f, scope),
    captures: digests,
    total: page.total,
    page: page.page,
    nextCursor: page.nextCursor,
    stoppedBy: page.stoppedBy,
    maxMb: Math.round((opts.maxBytes ?? env.handoff.exportMaxMb * 1024 * 1024) / 1024 / 1024),
    query: filtersQuery(f),
  });
  return { page, digests, markdown, file: indexFileOf(page.page) };
}

export async function feedbackList(db: Db, scope: ExportScope, f: FeedbackFilters, opts: { maxBytes?: number } = {}): Promise<FeedbackList> {
  const page = await selectPage(db, scope, f, opts);
  const digests = await digestsOf(db, page.recs);
  const items: FeedbackListItem[] = digests.map((d) => ({
    id: d.id,
    url: memberUrlOf(d.id),
    createdAt: d.createdAt,
    kind: d.kind as FeedbackListItem['kind'],
    title: d.title,
    reviewer: d.reviewer,
    pageUrl: d.pageUrl,
    route: routeOf(d.pageUrl),
    status: d.status,
    outcomes: d.outcomes ? { dead: d.outcomes.dead ?? 0, stuck: d.outcomes.stuck ?? 0, silent: d.outcomes.silent ?? 0, error: d.outcomes.error ?? 0 } : null,
    consoleErrors: d.consoleErrors.length,
    failedRequests: d.failedRequests.length,
    summary: summaryOf(d, 160),
    dir: folderDir(d.id),
    folderUrl: `${env.publicUrl}${folderApiPath(d.id)}`,
    pullCommand: pullCommand(env.publicUrl, d.id),
  }));
  const q = filtersQuery(f);
  return {
    items,
    total: page.total,
    returned: items.length,
    hasMore: !!page.nextCursor,
    nextCursor: page.nextCursor,
    stoppedBy: page.stoppedBy,
    exportUrl: withQuery(EXPORT_API_PATH, q, f.cursor),
    indexUrl: withQuery(FEEDBACK_INDEX_API_PATH, q, f.cursor),
    pullCommand: exportCommandOf(f),
  };
}

export interface ExportArchive {
  page: ExportPage;
  index: string;
  /** the gzipped tar, produced while it is read */
  body: ReadableStream<Uint8Array>;
}

/**
 * The archive of one page, streamed: INDEX.md, then each capture's folder, built one at a time
 * and written as soon as it is built
 * (folders are not put in the folder cache, so a long export does not push out the folders of an
 * agent session). A folder that fails to build becomes `.feedback/<id>/ERROR.md`.
 */
export async function feedbackArchive(
  db: Db,
  scope: ExportScope,
  f: FeedbackFilters,
  opts: { maxBytes?: number; beforeFolder?: (id: string, i: number) => void | Promise<void> } = {},
): Promise<ExportArchive> {
  const ix = await feedbackIndex(db, scope, f, opts);
  const mtime = Math.floor(Date.now() / 1000);
  const gz = createGzip({ level: 6 });
  const dirs = new Set<string>();
  // write with backpressure: wait for the reader when the gzip buffer is full; stop when it went away
  const write = async (b: Uint8Array) => {
    if (gz.destroyed) throw new Error('closed');
    if (gz.write(b)) return;
    await new Promise<void>((res) => {
      const done = () => {
        gz.off('drain', done);
        gz.off('close', done);
        res();
      };
      gz.on('drain', done);
      gz.on('close', done);
    });
  };
  const entry = async (path: string, data: Uint8Array | string) => {
    for (const b of tarEntryParts({ path, data }, dirs, mtime)) await write(b);
  };
  // each flush hands what is written so far to the reader, so INDEX.md and every finished folder arrive at once
  const flush = () => new Promise<void>((res) => (gz.destroyed ? res() : gz.flush(() => res())));
  void (async () => {
    try {
      await entry(`${FEEDBACK_DIR}/${ix.file}`, ix.markdown);
      await flush();
      for (const [i, rec] of ix.page.recs.entries()) {
        await opts.beforeFolder?.(rec.id, i);
        let files: { path: string; data: Uint8Array | string }[];
        try {
          const built = await assembleFolder(await collectFolder(db, rec), serverIo(db, rec));
          files = built.files.map((x) => ({ path: `${built.dir}/${x.path}`, data: x.data }));
        } catch (e) {
          console.error(`[export] folder of ${rec.id} failed:`, e);
          files = [
            {
              path: `${folderDir(rec.id)}/ERROR.md`,
              data: `# Folder not built\n\nThe server could not build the feedback folder of ${rec.id} for this export (${(e as Error).message}). Pull it on its own: \`${pullCommand(env.publicUrl, rec.id)}\`\n`,
            },
          ];
        }
        for (const x of files) await entry(x.path, x.data);
        await flush();
      }
      await write(tarEnd());
      gz.end();
    } catch (e) {
      // the reader went away (closed), or the stream failed: end the response with an error, never a short archive that looks whole
      if (!gz.destroyed) {
        console.error('[export] archive stream failed:', e);
        gz.destroy(e as Error);
      }
    }
  })();
  return { page: ix.page, index: ix.markdown, body: Readable.toWeb(gz) as unknown as ReadableStream<Uint8Array> };
}
