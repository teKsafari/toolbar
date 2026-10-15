// The MCP tool set (J-149 reads, J-150 search and lists, J-151 writes), modelled on what an
// agent gets from Jam (docs/jam/agent-output.md) with open-toolbar's own names and descriptions, plus the
// gaps fixed: request and response headers, WebSocket and SSE messages, and errors that say why.
// Every tool takes an optional `intent` and every capture tool takes an id or a capture URL.
import { and, asc, count, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CONSOLE_ROW_KINDS, NETWORK_TYPES, STATUS_CLASSES, type SeatRole } from '@toolbar/shared/api';
import {
  computeEventIndex,
  decodeCursor,
  encodeCursor,
  investigationGuide,
  queryActions,
  queryConsole,
  queryEvents,
  queryNetwork,
  querySocketFrames,
  signalsOf,
  type Prepared,
} from '@toolbar/shared/derive';
import { PRODUCT_NAME, RECORDING_KINDS } from '@toolbar/shared/constants';
import type { Db } from '../db/index.ts';
import { comment, folder, member, organization, recording, recordingLink, user } from '../db/schema/index.ts';
import { getBytes } from '../s3.ts';
import { env } from '../env.ts';
import { ApiError, fail } from '../share/http.ts';
import { visibleCapturesWhere, visibleFoldersWhere } from '../share/access.ts';
import { deleteCapture } from '../upload/service.ts';
import { primaryShareUrl } from '../share/tokens.ts';
import { seal, unseal } from '../crypto.ts';
import { hashToken } from '../tokens.ts';
import { randomBytes } from 'node:crypto';
import { resolveCapture, workspaceFor, requireSeatAtLeast, type ResolvedCapture } from './access.ts';
import { briefOf, commentRows, memberUrlOf, preparedOf, screenshotAssets, threadsOf, transcriptOf } from './data.ts';
import { frameAt, overview, spread, type FrameSize } from './frames.ts';
import { REACTION_KEYS, setReaction } from './reactions.ts';
import { publish } from '../viewer/comments.ts';
import type { McpPrincipal } from './oauth.ts';
import { authorSnapshot } from '../auth/author.ts';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export interface ToolCtx {
  db: Db;
  principal: McpPrincipal;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  write?: boolean;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: false };
  run(ctx: ToolCtx, args: z.output<S>): Promise<ToolResult>;
}

const define = <S extends z.ZodObject>(t: ToolDef<S>) => t as unknown as ToolDef;

const text = (s: string): Content => ({ type: 'text', text: s });
const json = (v: unknown): ToolResult => ({ content: [text(JSON.stringify(v))] });

// ---------- common inputs ----------

const intent = z.string().max(500).optional().describe('One sentence on why you are calling this tool, for the audit trail.');
const capture = z.string().min(1).describe('Capture id, member URL (<server>/c/<id>) or share link (<server>/s/<token>). Paste the link the user gave you.');
const limit = (d: number, max = 200) => z.number().int().min(1).max(max).default(d).describe(`Items per page (default ${d}, at most ${max}).`);
const cursor = z.string().optional().describe('nextCursor from the previous page.');
const fromMs = z.number().optional().describe('Only items at or after this time, in ms from the capture start.');
const toMs = z.number().optional().describe('Only items at or before this time, in ms from the capture start.');
const q = z.string().max(500).optional().describe('Case-insensitive text match.');

const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

async function eventsOrExplain(db: Db, c: ResolvedCapture): Promise<Prepared> {
  if (!c.devtools) fail('forbidden', 'This share link is content-only: it carries the media without console, network or events. Ask for the full link or a workspace seat.');
  const p = await preparedOf(db, c.rec);
  if (!p) fail('conflict', `The capture's events are not ready yet (status ${c.rec.status}). Try again in a few seconds.`);
  return p!;
}

function captureUrl(c: ResolvedCapture) {
  return c.via === 'share' && c.shareToken ? `${env.publicUrl}/s/${c.shareToken}` : memberUrlOf(c.rec.id);
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

// ---------- summaries for lists ----------

async function captureRows(db: Db, where: SQL, opts: { limit: number; offset: number; sort?: 'newest' | 'oldest' }) {
  const rows = await db
    .select({
      r: recording,
      folderName: folder.name,
      comments: sql<number>`(select count(*)::int from comment c where c.recording_id = ${recording.id} and c.deleted_at is null)`,
    })
    .from(recording)
    .leftJoin(folder, eq(folder.id, recording.folderId))
    .where(where)
    .orderBy(opts.sort === 'oldest' ? asc(recording.createdAt) : desc(recording.createdAt))
    .limit(opts.limit + 1)
    .offset(opts.offset);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(recording).where(where);
  const items = rows.slice(0, opts.limit).map(({ r, folderName, comments }) => ({
    id: r.id,
    url: memberUrlOf(r.id),
    title: r.title || null,
    kind: r.kind,
    status: r.status,
    source: r.source,
    pageUrl: r.pageUrl,
    createdAt: iso(r.createdAt),
    durationMs: r.durationMs,
    author: r.authorName ?? r.authorEmail,
    folder: r.folderId ? { id: r.folderId, name: folderName } : null,
    commentCount: Number(comments),
  }));
  const hasMore = rows.length > opts.limit;
  return { items, total: Number(n), returned: items.length, hasMore, nextCursor: hasMore ? encodeCursor(opts.offset + items.length) : null };
}

/** Full-text-ish match over title, description, page URL, comments and transcripts (J-150). */
function textMatch(words: string): SQL | undefined {
  const w = words.trim();
  if (!w) return undefined;
  const like = `%${w.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  return or(
    ilike(recording.title, like),
    ilike(recording.description, like),
    ilike(recording.pageUrl, like),
    sql`exists (select 1 from comment c where c.recording_id = ${recording.id} and c.deleted_at is null and c.body ilike ${like})`,
    sql`exists (select 1 from transcript t where t.recording_id = ${recording.id} and t.vtt ilike ${like})`,
  );
}

// ---------- read tools ----------

const getCapture = define({
  name: 'get_capture',
  title: 'Get capture details',
  description: `Start here. Returns one ${PRODUCT_NAME} capture: title, description, page, author, environment (browser, OS, viewport, connection), signal counts (console errors, failed requests by status class, clicks and typing), comments, transcript and chapter status, followed by a guide that ranks the next tool calls with filters filled in. Accepts a capture id or any capture or share URL.`,
  input: z.object({ capture, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const p = c.devtools ? await preparedOf(db, c.rec) : null;
    const url = captureUrl(c);
    const brief = await briefOf(db, c.rec, { url });
    const s = p ? signalsOf(p) : null;
    const index = p ? computeEventIndex(p.events, p.map) : null;
    const shots = await screenshotAssets(db, c.rec.id);
    const [ws] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, c.rec.organizationId));
    const detail = {
      id: c.rec.id,
      url,
      memberUrl: memberUrlOf(c.rec.id),
      title: c.rec.title || null,
      description: c.rec.description || null,
      kind: c.rec.kind,
      status: c.rec.status,
      source: c.rec.source,
      workspace: { id: c.rec.organizationId, name: ws?.name ?? null },
      folder: brief.folder,
      author: brief.author,
      createdAt: brief.createdAt,
      startedAt: iso(c.rec.startedAt),
      durationMs: c.rec.durationMs,
      page: { url: c.rec.pageUrl, title: c.rec.pageTitle },
      environment: brief.env
        ? {
            browser: brief.env.browser ?? null,
            os: brief.env.os ?? brief.env.platform ?? null,
            viewport: brief.env.viewport,
            screen: brief.env.screen ?? null,
            devicePixelRatio: brief.env.dpr,
            locale: brief.env.locale ?? null,
            timeZone: brief.env.tz ?? null,
            connection: brief.env.connection ?? null,
            incognito: brief.env.incognito ?? null,
            extensionVersion: brief.env.extVersion ?? null,
            userAgent: brief.env.ua,
          }
        : null,
      hasCustomMetadata: !!c.rec.metadata && Object.keys(c.rec.metadata as object).length > 0,
      signals: s,
      counts: index
        ? { console: index.console, network: index.network, user: index.user, errors: index.errors }
        : null,
      media: {
        video: c.rec.kind === 'video' || c.rec.kind === 'screen' ? { durationMs: c.rec.durationMs, width: c.rec.videoWidth, height: c.rec.videoHeight } : null,
        screenshot: shots.main ? { width: shots.main.width, height: shots.main.height, fullViewportKept: !!shots.full } : null,
      },
      comments: brief.comments.length,
      transcript: brief.transcript?.status ?? 'none',
      chapters: Array.isArray(c.rec.chapters) ? (c.rec.chapters as unknown[]).length : 0,
      devtools: c.devtools,
      canEdit: c.canEdit,
      timeNote: 'Times: offsetMs counts from the capture start; videoMs is the position in the video (use it for get_frames and create_comment).',
    };
    return { content: [text(JSON.stringify(detail)), text(investigationGuide(brief, p, s))] };
  },
});

const getConsole = define({
  name: 'get_console_logs',
  title: 'Get console logs',
  description:
    'Console output merged with uncaught errors, failed requests, navigations and user actions, in time order (the console tab). Error rows carry the stack and the parsed source location. Filter by level (debug, info, log, warn, error), row kind and time window. Returns a page: { items, total, returned, hasMore, nextCursor }.',
  input: z.object({
    capture,
    levels: z.array(z.enum(['debug', 'info', 'log', 'warn', 'error'])).optional().describe('Levels to keep, e.g. ["error","warn"].'),
    kinds: z.array(z.enum(CONSOLE_ROW_KINDS)).optional().describe('Row kinds to keep: console, error (uncaught), network (failed request), navigation, click, input, media.'),
    fromMs,
    toMs,
    q,
    limit: limit(50),
    cursor,
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    return json(queryConsole(await eventsOrExplain(db, c), a));
  },
});

const getNetwork = define({
  name: 'get_network_requests',
  title: 'Get network requests',
  description:
    'HTTP requests with the response or failure merged in: method, URL split into host and path, status and class, timing, size, content type, initiator, frame, GraphQL operation, and the error message parsed from a failed JSON body. Request and response headers are included (secrets show as [redacted]); bodies come for failed requests by default (bodies: "all" for every row, "none" to drop them). WebSocket and EventSource streams are one row each; read their messages with get_stream_messages. Requests that never answered have state "pending".',
  input: z.object({
    capture,
    status: z.array(z.enum(STATUS_CLASSES)).optional().describe('Status classes: 1xx..5xx, failed (network error or status >= 400), pending (never answered).'),
    types: z.array(z.enum(NETWORK_TYPES)).optional(),
    methods: z.array(z.string()).optional().describe('HTTP methods, e.g. ["POST"].'),
    hosts: z.array(z.string()).optional().describe('Hosts, e.g. ["api.example.com"]; subdomains match.'),
    bodies: z.enum(['none', 'errors', 'all']).default('errors'),
    headers: z.boolean().default(true).describe('Include request and response headers (default true).'),
    errorsOnly: z.boolean().optional(),
    fromMs,
    toMs,
    q,
    limit: limit(30),
    cursor,
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    return json(queryNetwork(await eventsOrExplain(db, c), a));
  },
});

const getStream = define({
  name: 'get_stream_messages',
  title: 'Get WebSocket or SSE messages',
  description: 'Messages of one WebSocket or server-sent events stream: sent and received frames with time and data. Pass the rid of a websocket or eventsource row from get_network_requests.',
  input: z.object({ capture, rid: z.string().min(1).describe('rid of the stream row, e.g. "ws:top:ws-0".'), direction: z.enum(['send', 'recv']).optional(), q, limit: limit(100, 500), cursor, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const page = querySocketFrames(await eventsOrExplain(db, c), a.rid, a);
    if (!page) fail('not_found', `No WebSocket or EventSource row with rid ${a.rid}. List them with get_network_requests and types ["websocket","eventsource"].`);
    return json(page);
  },
});

const getUserEvents = define({
  name: 'get_user_events',
  title: 'Get user events',
  description:
    'What the person did: clicks (with the element: tag, role, accessible name, visible text, test id, a CSS selector and xpath), committed text input (passwords and masked fields show masked: true and no value), key presses, navigations with their cause, and tab visibility changes.',
  input: z.object({
    capture,
    types: z.array(z.enum(['click', 'dblclick', 'contextmenu', 'input', 'key', 'navigation', 'visibility', 'scroll', 'select'])).optional(),
    fromMs,
    toMs,
    q,
    limit: limit(50),
    cursor,
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    return json(queryActions(await eventsOrExplain(db, c), a));
  },
});

const getEvents = define({
  name: 'get_events',
  title: 'Get raw events',
  description: 'The raw captured event envelopes ({ id, ctx, seq, t, kind, data }) in time order, for anything the other tools leave out (DOM change summaries, markers, media events). Filter by kind and frame context.',
  input: z.object({
    capture,
    kinds: z.array(z.enum(['env', 'nav', 'console', 'error', 'net.req', 'net.res', 'net.fail', 'ws', 'sse', 'user', 'dom', 'rrweb', 'media', 'shot', 'annotation', 'marker', 'stackmap'])).optional(),
    ctx: z.string().optional().describe('Frame context: "top", "f1", "sw".'),
    fromMs,
    toMs,
    q,
    limit: limit(50),
    cursor,
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    return json(queryEvents(await eventsOrExplain(db, c), a));
  },
});

const getMetadata = define({
  name: 'get_metadata',
  title: 'Get metadata',
  description: 'Custom metadata the page attached to the capture (for example user id, plan or build), plus the captured environment. Says plainly when the page attached none.',
  input: z.object({ capture, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const meta = (c.rec.metadata as Record<string, unknown> | null) ?? null;
    const has = !!meta && Object.keys(meta).length > 0;
    return json({
      metadata: has ? meta : null,
      note: has ? null : 'The page attached no custom metadata to this capture.',
      environment: c.rec.env ?? null,
    });
  },
});

const getScreenshots = define({
  name: 'get_screenshots',
  title: 'Get screenshots',
  description: 'The image of a screenshot capture, with the marks drawn in; for an area shot also the full viewport when it was kept. For videos use get_frames.',
  input: z.object({ capture, full: z.boolean().default(false).describe('Also return the full-viewport image of an area shot.'), intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const s = await screenshotAssets(db, c.rec.id);
    if (!s.main) {
      const why = c.rec.kind === 'video' || c.rec.kind === 'screen' ? 'This capture is a video: use get_frames for stills.' : 'This capture has no screenshot image.';
      fail('conflict', why);
    }
    const out: Content[] = [];
    const pics = a.full && s.full ? [s.main!, s.full] : [s.main!];
    for (const p of pics) {
      const bytes = await getBytes(p.s3Key);
      out.push(text(`${p.kind === 'crop' ? 'Area shot' : 'Screenshot'} ${p.width ?? '?'}x${p.height ?? '?'}`));
      out.push({ type: 'image', data: Buffer.from(bytes).toString('base64'), mimeType: p.contentType });
    }
    return { content: out };
  },
});

const getFrames = define({
  name: 'get_frames',
  title: 'Get video frames',
  description:
    'Still JPEG frames from a video capture. With no times: one 4x3 overview grid of evenly spaced frames. With `at`: one frame per listed time (videoMs, at most 6). With `from`, `to` and `count`: count frames spread across that range. Size is the frame height: 360, 720 (default) or 1080.',
  input: z.object({
    capture,
    at: z.array(z.number().nonnegative()).max(6).optional().describe('Video times in ms, e.g. [5200].'),
    from: z.number().nonnegative().optional(),
    to: z.number().nonnegative().optional(),
    count: z.number().int().min(1).max(6).optional(),
    size: z.enum(['360', '720', '1080']).default('720'),
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    if (c.rec.kind !== 'video' && c.rec.kind !== 'screen') fail('conflict', `This capture is a ${c.rec.kind}, not a video.${c.rec.kind === 'screenshot' ? ' Use get_screenshots.' : ''}`);
    let times = a.at ?? null;
    if (!times && a.from !== undefined && a.to !== undefined) times = spread(a.from, a.to, a.count ?? 3);
    if (!times) {
      const o = await overview(db, c.rec, a.size as FrameSize);
      return {
        content: [text(`Overview grid, 4 columns by 3 rows, left to right then top to bottom. Cell times (videoMs): ${o.times.join(', ')}`), { type: 'image', data: o.jpeg.toString('base64'), mimeType: 'image/jpeg' }],
      };
    }
    const out: Content[] = [];
    for (const t of times.slice(0, 6)) {
      const f = await frameAt(db, c.rec, t, a.size as FrameSize);
      out.push(text(`Frame at videoMs ${f.atMs}`), { type: 'image', data: f.jpeg.toString('base64'), mimeType: 'image/jpeg' });
    }
    return { content: out };
  },
});

const getTranscript = define({
  name: 'get_transcript',
  title: 'Get transcript',
  description: 'What the person said while recording, as timed cues (startMs, endMs in video time). When there is none, says why: no microphone, transcription off on the server, still running, or failed.',
  input: z.object({ capture, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const t = await transcriptOf(db, c.rec.id);
    if (!t) {
      const why = c.rec.kind === 'screenshot' ? 'Screenshots have no audio.' : 'No transcript: the microphone was off for this capture, or the server has no transcription provider.';
      return json({ status: 'none', reason: why, cues: [] });
    }
    const reason =
      t.status === 'done' ? null : t.status === 'failed' ? `Transcription failed: ${t.error ?? 'unknown error'}` : 'Transcription is still running; try again shortly.';
    return json({ status: t.status, language: t.language, reason, cues: t.cues, text: t.text });
  },
});

const getChapters = define({
  name: 'get_chapters',
  title: 'Get video chapters',
  description: 'Chapters of a video capture: a title with start and end times each. Empty with a reason when the server has none.',
  input: z.object({ capture, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const ch = Array.isArray(c.rec.chapters) ? (c.rec.chapters as unknown[]) : [];
    return json({ chapters: ch, reason: ch.length ? null : c.rec.kind === 'video' || c.rec.kind === 'screen' ? 'No chapters: they need a transcript and an AI provider on the server.' : 'Only videos have chapters.' });
  },
});

const listComments = define({
  name: 'list_comments',
  title: 'List comments',
  description: 'Comments on a capture, oldest first, each with its replies. videoMs is the playback time a comment points at, or null.',
  input: z.object({ capture, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    const threads = threadsOf(await commentRows(db, c.rec.id)).map(({ tMs, replies, ...t }) => ({
      ...t,
      videoMs: tMs,
      replies: replies.map(({ tMs: r, ...x }) => ({ ...x, videoMs: r })),
    }));
    return json({ items: threads, total: threads.length, returned: threads.length, hasMore: false, nextCursor: null });
  },
});

// ---------- search and lists ----------

const search = define({
  name: 'search',
  title: 'Find a capture',
  description: 'Find captures from free text: a pasted capture or share URL (or a bare id) resolves to that capture; any other text matches titles, descriptions, page URLs, comments and transcripts in the workspace. Returns at most 10 results.',
  input: z.object({ query: z.string().min(1).max(500), intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    try {
      const c = await resolveCapture(db, principal, a.query);
      return json({
        items: [{ id: c.rec.id, url: captureUrl(c), title: c.rec.title || null, kind: c.rec.kind, createdAt: iso(c.rec.createdAt), match: 'id' }],
        total: 1,
        returned: 1,
        hasMore: false,
        nextCursor: null,
      });
    } catch (e) {
      if (!(e instanceof ApiError) || (e.code !== 'not_found' && e.code !== 'forbidden')) throw e;
      if (/\/(c|s)\/|^[0-9a-f-]{36}$/i.test(a.query.trim())) throw e;
    }
    const ws = await workspaceFor(db, principal);
    const where = and(eq(recording.organizationId, ws.id), visibleCapturesWhere(principal.userId, ws.seat), textMatch(a.query))!;
    return json(await captureRows(db, where, { limit: 10, offset: 0 }));
  },
});

const searchCaptures = define({
  name: 'search_captures',
  title: 'Search captures',
  description:
    'Structured search in the workspace: text (titles, descriptions, page URLs, comments, transcripts), capture kinds, folder, author email, a created-at window, newest or oldest first, with paging.',
  input: z.object({
    text: z.string().max(500).optional(),
    kinds: z.array(z.enum(RECORDING_KINDS)).optional(),
    folderId: z.string().uuid().optional().describe('Only this folder.'),
    authorEmail: z.string().optional(),
    createdAfter: z.string().optional().describe('ISO date or datetime.'),
    createdBefore: z.string().optional().describe('ISO date or datetime.'),
    sort: z.enum(['newest', 'oldest']).default('newest'),
    workspaceId: z.string().uuid().optional(),
    limit: limit(20, 100),
    cursor,
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    const conds: (SQL | undefined)[] = [eq(recording.organizationId, ws.id), visibleCapturesWhere(principal.userId, ws.seat)];
    if (a.text) conds.push(textMatch(a.text));
    if (a.kinds?.length) conds.push(inArray(recording.kind, a.kinds));
    if (a.folderId) conds.push(eq(recording.folderId, a.folderId));
    if (a.authorEmail) conds.push(ilike(recording.authorEmail, a.authorEmail));
    if (a.createdAfter) conds.push(sql`${recording.createdAt} >= ${new Date(a.createdAfter).toISOString()}`);
    if (a.createdBefore) conds.push(lt(recording.createdAt, new Date(a.createdBefore)));
    return json(await captureRows(db, and(...conds)!, { limit: a.limit, offset: decodeCursor(a.cursor), sort: a.sort }));
  },
});

const listCaptures = define({
  name: 'list_captures',
  title: 'List captures',
  description: 'Captures in the workspace, newest first. folderId "none" lists unfiled captures; a folder id lists that folder.',
  input: z.object({
    folderId: z.union([z.string().uuid(), z.literal('none')]).optional(),
    kinds: z.array(z.enum(RECORDING_KINDS)).optional(),
    workspaceId: z.string().uuid().optional(),
    limit: limit(20, 100),
    cursor,
    intent,
  }),
  annotations: READ,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    const conds: (SQL | undefined)[] = [eq(recording.organizationId, ws.id), visibleCapturesWhere(principal.userId, ws.seat)];
    if (a.folderId === 'none') conds.push(isNull(recording.folderId));
    else if (a.folderId) conds.push(eq(recording.folderId, a.folderId));
    if (a.kinds?.length) conds.push(inArray(recording.kind, a.kinds));
    return json(await captureRows(db, and(...conds)!, { limit: a.limit, offset: decodeCursor(a.cursor) }));
  },
});

const listFolders = define({
  name: 'list_folders',
  title: 'List folders',
  description: 'Folders in the workspace with the number of captures in each.',
  input: z.object({ workspaceId: z.string().uuid().optional(), intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    const rows = await db
      .select({
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
        captures: sql<number>`(select count(*)::int from recording r where r.folder_id = "folder"."id" and r.deleted_at is null and r.status <> 'uploading')`,
      })
      .from(folder)
      .where(and(eq(folder.organizationId, ws.id), visibleFoldersWhere(principal.userId, ws.seat)))
      .orderBy(asc(folder.name));
    const items = rows.map((r) => ({ id: r.id, name: r.name, captures: Number(r.captures), createdAt: iso(r.createdAt), url: `${env.publicUrl}/f/${r.id}` }));
    return json({ items, total: items.length, returned: items.length, hasMore: false, nextCursor: null });
  },
});

const listMembers = define({
  name: 'list_members',
  title: 'List members',
  description: 'Members of the workspace with their seat (viewer, creator, admin). Use a member id to mention someone in a comment as @[Name](user:<id>).',
  input: z.object({ workspaceId: z.string().uuid().optional(), intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    const rows = await db
      .select({ id: user.id, name: user.name, email: user.email, role: member.role, joinedAt: member.createdAt })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ws.id))
      .orderBy(asc(user.name));
    const seat = (r: string): SeatRole => (r === 'owner' || r === 'admin' ? 'admin' : r === 'viewer' ? 'viewer' : 'creator');
    const items = rows.map((r) => ({ id: r.id, name: r.name, email: r.email, seat: seat(r.role), joinedAt: iso(r.joinedAt) }));
    return json({ items, total: items.length, returned: items.length, hasMore: false, nextCursor: null });
  },
});

const listLinks = define({
  name: 'list_recording_links',
  title: 'List recording links',
  description: 'Recording links of the workspace (links that let anyone record a capture into it), with how many captures each produced.',
  input: z.object({ workspaceId: z.string().uuid().optional(), intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    const rows = await db
      .select({
        id: recordingLink.id,
        name: recordingLink.name,
        folderId: recordingLink.folderId,
        domain: recordingLink.recorderDomain,
        tokenEnc: recordingLink.tokenEnc,
        createdAt: recordingLink.createdAt,
        revokedAt: recordingLink.revokedAt,
        captures: sql<number>`(select count(*)::int from recording r where r.recording_link_id = "recording_link"."id" and r.deleted_at is null and r.status <> 'uploading')`,
      })
      .from(recordingLink)
      .where(eq(recordingLink.organizationId, ws.id))
      .orderBy(desc(recordingLink.createdAt));
    const items = rows.map(({ tokenEnc, ...r }) => ({ ...r, url: linkUrl(tokenEnc), captures: Number(r.captures), active: !r.revokedAt, createdAt: iso(r.createdAt), revokedAt: iso(r.revokedAt) }));
    return json({ items, total: items.length, returned: items.length, hasMore: false, nextCursor: null });
  },
});

const listLinkCaptures = define({
  name: 'list_recording_link_captures',
  title: 'List captures from a recording link',
  description: 'Captures recorded through one recording link, newest first.',
  input: z.object({ linkId: z.string().uuid(), limit: limit(20, 100), cursor, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const [l] = await db.select({ org: recordingLink.organizationId }).from(recordingLink).where(eq(recordingLink.id, a.linkId)).limit(1);
    if (!l) fail('not_found', 'No such recording link.');
    const ws = await workspaceFor(db, principal, l!.org);
    const where = and(eq(recording.recordingLinkId, a.linkId), visibleCapturesWhere(principal.userId, ws.seat))!;
    return json(await captureRows(db, where, { limit: a.limit, offset: decodeCursor(a.cursor) }));
  },
});

const linkUrl = (enc: Buffer) => {
  try {
    return `${env.publicUrl}/rl/${unseal(enc, 'recording-link-token')}`;
  } catch {
    return null;
  }
};

// ---------- write tools ----------

const createComment = define({
  name: 'create_comment',
  title: 'Comment on a capture',
  description:
    'Add a comment to a capture as the signed-in user, for example the root cause and the fix once you have one. Markdown, up to 2000 characters. Pass videoMs to pin it to a moment in the video (it shows with a time chip). Mention a member as @[Name](user:<id>) (ids from list_members). Pass parentId to reply in a thread.',
  input: z.object({
    capture,
    body: z.string().trim().min(1).max(2000),
    videoMs: z.number().int().nonnegative().optional(),
    parentId: z.string().uuid().optional(),
    intent,
  }),
  write: true,
  annotations: WRITE,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture, 'comment');
    let parentId: string | null = null;
    if (a.parentId) {
      const [p] = await db
        .select({ id: comment.id, parentId: comment.parentId })
        .from(comment)
        .where(and(eq(comment.id, a.parentId), eq(comment.recordingId, c.rec.id), isNull(comment.deletedAt)))
        .limit(1);
      if (!p) fail('not_found', 'No such comment on this capture to reply to.');
      parentId = p!.parentId ?? p!.id;
    }
    const u = await authorSnapshot(db, principal.userId);
    const [row] = await db
      .insert(comment)
      .values({ recordingId: c.rec.id, parentId, authorUserId: principal.userId, authorName: u.name, authorEmail: u.email, authorIssuer: u.issuer, authorSubject: u.subject, body: a.body, tMs: a.videoMs ?? null, viaAgent: principal.clientName ?? (principal.via === 'personal' ? 'an agent' : null) })
      .returning();
    publish(c.rec.id, { type: 'created', id: row!.id });
    return json({
      id: row!.id,
      captureId: c.rec.id,
      parentId,
      body: row!.body,
      videoMs: row!.tMs,
      createdAt: iso(row!.createdAt),
      url: `${memberUrlOf(c.rec.id)}?comment=${row!.id}`,
    });
  },
});

async function ownComment(db: Db, principal: McpPrincipal, id: string) {
  const [row] = await db.select().from(comment).where(and(eq(comment.id, id), isNull(comment.deletedAt))).limit(1);
  if (!row) fail('not_found', 'No such comment.');
  await resolveCapture(db, principal, row!.recordingId, 'comment');
  if (row!.authorUserId !== principal.userId) fail('forbidden', 'You can only change your own comments.');
  return row!;
}

const editComment = define({
  name: 'edit_comment',
  title: 'Edit a comment',
  description: 'Replace the text of one of your own comments.',
  input: z.object({ commentId: z.string().uuid(), body: z.string().trim().min(1).max(2000), intent }),
  write: true,
  annotations: { ...WRITE, idempotentHint: true },
  async run({ db, principal }, a) {
    const own = await ownComment(db, principal, a.commentId);
    const [row] = await db.update(comment).set({ body: a.body, editedAt: new Date() }).where(eq(comment.id, a.commentId)).returning();
    publish(own.recordingId, { type: 'updated', id: row!.id });
    return json({ id: row!.id, body: row!.body, editedAt: iso(row!.editedAt) });
  },
});

const deleteComment = define({
  name: 'delete_comment',
  title: 'Delete a comment',
  description: 'Delete one of your own comments. Ask the user before deleting.',
  input: z.object({ commentId: z.string().uuid(), intent }),
  write: true,
  annotations: DESTROY,
  async run({ db, principal }, a) {
    const own = await ownComment(db, principal, a.commentId);
    await db.update(comment).set({ deletedAt: new Date() }).where(eq(comment.id, a.commentId));
    publish(own.recordingId, { type: 'deleted', id: a.commentId });
    return json({ ok: true, deleted: a.commentId });
  },
});

async function visibleComment(db: Db, principal: McpPrincipal, id: string) {
  const [row] = await db.select().from(comment).where(and(eq(comment.id, id), isNull(comment.deletedAt))).limit(1);
  if (!row) fail('not_found', 'No such comment.');
  await resolveCapture(db, principal, row!.recordingId, 'comment');
  return row!;
}

const reactionInput = z.object({
  commentId: z.string().uuid().describe('Comment id, from list_comments.'),
  reaction: z.enum(REACTION_KEYS).describe(`One of: ${REACTION_KEYS.join(', ')}.`),
  intent,
});

const addReaction = define({
  name: 'add_reaction',
  title: 'React to a comment',
  description: 'Add your reaction to a comment on a capture, for example check once a reported bug is fixed. Adding the same reaction twice changes nothing. Returns the comment\'s reaction counts.',
  input: reactionInput,
  write: true,
  annotations: { ...WRITE, idempotentHint: true },
  async run({ db, principal }, a) {
    const row = await visibleComment(db, principal, a.commentId);
    const reactions = await setReaction(db, row.id, principal.userId, a.reaction, true);
    publish(row.recordingId, { type: 'reactions', id: row.id });
    return json({ commentId: row.id, reactions });
  },
});

const removeReaction = define({
  name: 'remove_reaction',
  title: 'Remove a reaction',
  description: 'Take back one of your own reactions on a comment. Returns the comment\'s reaction counts.',
  input: reactionInput,
  write: true,
  annotations: { ...WRITE, idempotentHint: true },
  async run({ db, principal }, a) {
    const row = await visibleComment(db, principal, a.commentId);
    const reactions = await setReaction(db, row.id, principal.userId, a.reaction, false);
    publish(row.recordingId, { type: 'reactions', id: row.id });
    return json({ commentId: row.id, reactions });
  },
});

async function folderInWorkspace(db: Db, folderId: string, organizationId: string) {
  const [f] = await db.select().from(folder).where(and(eq(folder.id, folderId), eq(folder.organizationId, organizationId))).limit(1);
  if (!f) fail('not_found', 'No such folder in the capture\'s workspace.');
  return f!;
}

const updateCapture = define({
  name: 'update_capture',
  title: 'Update a capture',
  description: 'Change the title, the description (markdown), or the folder of a capture (folderId null takes it out of its folder). Needs to be the author or a workspace admin.',
  input: z.object({
    capture,
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().max(100_000).optional(),
    folderId: z.string().uuid().nullable().optional(),
    intent,
  }),
  write: true,
  annotations: { ...WRITE, idempotentHint: true },
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture, 'edit');
    const patch: Partial<typeof recording.$inferInsert> = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.description !== undefined) patch.description = a.description;
    if (a.folderId !== undefined) {
      if (a.folderId) await folderInWorkspace(db, a.folderId, c.rec.organizationId);
      patch.folderId = a.folderId;
    }
    if (!Object.keys(patch).length) fail('invalid_body', 'Pass a title, a description or a folderId.');
    const [r] = await db.update(recording).set(patch).where(eq(recording.id, c.rec.id)).returning();
    return json({ id: r!.id, url: memberUrlOf(r!.id), title: r!.title, description: r!.description, folderId: r!.folderId });
  },
});

const deleteCaptureTool = define({
  name: 'delete_capture',
  title: 'Delete a capture',
  description: 'Delete a capture: it disappears from lists, search and its links stop working. Ask the user to confirm first; this cannot be undone from the agent.',
  input: z.object({ capture, intent }),
  write: true,
  annotations: DESTROY,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture, 'edit');
    await deleteCapture(db, c.rec);
    return json({ ok: true, deleted: c.rec.id });
  },
});

const createFolder = define({
  name: 'create_folder',
  title: 'Create a folder',
  description: 'Create a folder in the workspace.',
  input: z.object({ name: z.string().trim().min(1).max(200), workspaceId: z.string().uuid().optional(), intent }),
  write: true,
  annotations: WRITE,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    requireSeatAtLeast(ws.seat, 'creator', 'Creating a folder');
    const [f] = await db.insert(folder).values({ organizationId: ws.id, name: a.name, createdBy: principal.userId }).returning();
    return json({ id: f!.id, name: f!.name, workspaceId: ws.id });
  },
});

const renameFolder = define({
  name: 'rename_folder',
  title: 'Rename a folder',
  description: 'Rename a folder.',
  input: z.object({ folderId: z.string().uuid(), name: z.string().trim().min(1).max(200), intent }),
  write: true,
  annotations: { ...WRITE, idempotentHint: true },
  async run({ db, principal }, a) {
    const [f] = await db.select().from(folder).where(eq(folder.id, a.folderId)).limit(1);
    if (!f) fail('not_found', 'No such folder.');
    const ws = await workspaceFor(db, principal, f!.organizationId);
    if (ws.seat !== 'admin' && f!.createdBy !== principal.userId) requireSeatAtLeast(ws.seat, 'creator', 'Renaming a folder');
    await db.update(folder).set({ name: a.name }).where(eq(folder.id, a.folderId));
    return json({ id: a.folderId, name: a.name });
  },
});

const deleteFolder = define({
  name: 'delete_folder',
  title: 'Delete a folder',
  description: 'Delete a folder and every capture in it. Ask the user to confirm first and say how many captures will go (list_folders gives the count).',
  input: z.object({ folderId: z.string().uuid(), intent }),
  write: true,
  annotations: DESTROY,
  async run({ db, principal }, a) {
    const [f] = await db.select().from(folder).where(eq(folder.id, a.folderId)).limit(1);
    if (!f) fail('not_found', 'No such folder.');
    const ws = await workspaceFor(db, principal, f!.organizationId);
    if (ws.seat !== 'admin' && f!.createdBy !== principal.userId) fail('forbidden', 'Only the folder\'s creator or a workspace admin can delete it.');
    const recs = await db
      .select()
      .from(recording)
      .where(and(eq(recording.folderId, a.folderId), isNull(recording.deletedAt)));
    for (const r of recs) await deleteCapture(db, r);
    await db.delete(folder).where(eq(folder.id, a.folderId));
    return json({ ok: true, deleted: a.folderId, capturesDeleted: recs.length });
  },
});

const shareLinkTool = define({
  name: 'get_share_link',
  title: 'Get the share link',
  description: 'The share link of a capture, to paste into a pull request or an issue. Link holders see it without signing in when its access is "anyone".',
  input: z.object({ capture, intent }),
  annotations: READ,
  async run({ db, principal }, a) {
    const c = await resolveCapture(db, principal, a.capture);
    if (c.via !== 'member') return json({ url: captureUrl(c), access: c.rec.access });
    const url = await primaryShareUrl(db, { id: c.rec.id, access: c.rec.access }, principal.userId);
    return json({ url, access: c.rec.access, markdownUrl: `${url}.md` });
  },
});

async function linkForEdit(db: Db, principal: McpPrincipal, linkId: string) {
  const [l] = await db.select().from(recordingLink).where(eq(recordingLink.id, linkId)).limit(1);
  if (!l) fail('not_found', 'No such recording link.');
  const ws = await workspaceFor(db, principal, l!.organizationId);
  if (ws.seat !== 'admin' && l!.createdBy !== principal.userId) fail('forbidden', 'Only the link\'s creator or a workspace admin can change it.');
  return l!;
}

const linkOut = (l: typeof recordingLink.$inferSelect) => ({
  id: l.id,
  name: l.name,
  url: linkUrl(l.tokenEnc),
  folderId: l.folderId,
  active: !l.revokedAt,
  createdAt: iso(l.createdAt),
});

const createLink = define({
  name: 'create_recording_link',
  title: 'Create a recording link',
  description: 'Create a recording link: anyone who opens it can record a capture into this workspace (optionally into a folder) without an account. Returns the link to hand out.',
  input: z.object({ name: z.string().trim().max(200).default(''), folderId: z.string().uuid().optional(), workspaceId: z.string().uuid().optional(), intent }),
  write: true,
  annotations: WRITE,
  async run({ db, principal }, a) {
    const ws = await workspaceFor(db, principal, a.workspaceId);
    requireSeatAtLeast(ws.seat, 'creator', 'Creating a recording link');
    if (a.folderId) await folderInWorkspace(db, a.folderId, ws.id);
    const token = randomBytes(16).toString('base64url');
    const [l] = await db
      .insert(recordingLink)
      .values({ organizationId: ws.id, folderId: a.folderId ?? null, name: a.name, tokenHash: hashToken(token), tokenEnc: seal(token, 'recording-link-token'), createdBy: principal.userId })
      .returning();
    return json(linkOut(l!));
  },
});

const updateLink = define({
  name: 'update_recording_link',
  title: 'Update a recording link',
  description: 'Rename a recording link, point it at another folder (null for none), or turn it off (revoked: true) or on again.',
  input: z.object({ linkId: z.string().uuid(), name: z.string().trim().max(200).optional(), folderId: z.string().uuid().nullable().optional(), revoked: z.boolean().optional(), intent }),
  write: true,
  annotations: { ...WRITE, idempotentHint: true },
  async run({ db, principal }, a) {
    const l = await linkForEdit(db, principal, a.linkId);
    const patch: Partial<typeof recordingLink.$inferInsert> = {};
    if (a.name !== undefined) patch.name = a.name;
    if (a.folderId !== undefined) {
      if (a.folderId) await folderInWorkspace(db, a.folderId, l.organizationId);
      patch.folderId = a.folderId;
    }
    if (a.revoked !== undefined) patch.revokedAt = a.revoked ? new Date() : null;
    if (!Object.keys(patch).length) fail('invalid_body', 'Pass a name, a folderId or revoked.');
    const [u] = await db.update(recordingLink).set(patch).where(eq(recordingLink.id, l.id)).returning();
    return json(linkOut(u!));
  },
});

const deleteLink = define({
  name: 'delete_recording_link',
  title: 'Delete a recording link',
  description: 'Delete a recording link; it stops working at once. Captures already made through it stay. Ask the user first.',
  input: z.object({ linkId: z.string().uuid(), intent }),
  write: true,
  annotations: DESTROY,
  async run({ db, principal }, a) {
    const l = await linkForEdit(db, principal, a.linkId);
    await db.delete(recordingLink).where(eq(recordingLink.id, l.id));
    return json({ ok: true, deleted: l.id });
  },
});

export const TOOLS: ToolDef[] = [
  getCapture,
  getConsole,
  getNetwork,
  getStream,
  getUserEvents,
  getEvents,
  getMetadata,
  getScreenshots,
  getFrames,
  getTranscript,
  getChapters,
  listComments,
  search,
  searchCaptures,
  listCaptures,
  listFolders,
  listMembers,
  listLinks,
  listLinkCaptures,
  shareLinkTool,
  createComment,
  editComment,
  deleteComment,
  addReaction,
  removeReaction,
  updateCapture,
  deleteCaptureTool,
  createFolder,
  renameFolder,
  deleteFolder,
  createLink,
  updateLink,
  deleteLink,
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

/** tools/list entries: JSON Schema of the input (as the caller writes it), annotations, title. */
export function toolList(canWrite: boolean) {
  return TOOLS.filter((t) => canWrite || !t.write).map((t) => {
    const schema = z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete schema.$schema;
    return { name: t.name, title: t.title, description: t.description, inputSchema: schema, annotations: { title: t.title, ...t.annotations } };
  });
}

export async function callTool(ctx: ToolCtx, name: string, args: unknown): Promise<ToolResult> {
  const t = toolByName.get(name);
  if (!t) return { isError: true, content: [text(`Unknown tool ${name}.`)] };
  if (t.write && !ctx.principal.canWrite)
    return { isError: true, content: [text('This connection is read-only. Reconnect the agent with the "comment and organise" permission, or use a token with an MCP write scope.')] };
  const parsed = t.input.safeParse(args ?? {});
  if (!parsed.success) return { isError: true, content: [text(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`)] };
  try {
    return await t.run(ctx, parsed.data);
  } catch (e) {
    if (e instanceof ApiError) return { isError: true, content: [text(`${e.code}: ${e.message === e.code ? 'request refused' : e.message}`)] };
    console.error(`[mcp] ${name} failed:`, e);
    return { isError: true, content: [text(`The server hit an error running ${name}: ${(e as Error).message}`)] };
  }
}

