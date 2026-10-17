// Feedback items from the in-page reviewer toolbar (Part 2, "What the reviewer can do"):
// comments on elements, highlighted text, drawings on the live page, element screenshots and
// voice notes. The extension keeps a tab's items until the reviewer submits them; the server
// stores them as `feedback_item` rows on a capture (a running trace, or a capture of kind
// `feedback` made at submit). Import from '@toolbar/shared/areas/reviewer'.
import { z } from 'zod';
import { locatorPacketSchema, rectSchema, targetRefSchema } from '../schemas.ts';

/**
 * What a feedback item points at.
 * - `element`: a comment pinned on one element
 * - `text`: a comment on highlighted text (the quote is kept)
 * - `draw`: a rectangle, arrow or freehand drawing on the page, with a comment
 * - `shot`: a screenshot of one element, with a comment
 * - `voice`: a voice note on the whole trace or session (no element)
 * - `note`: a comment on the page as a whole
 */
export const FEEDBACK_KINDS = ['element', 'text', 'draw', 'shot', 'voice', 'note'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Agent-facing tags from the owner's taste notes (M-17). */
export const FEEDBACK_INTENTS = ['fix', 'change', 'question', 'approve'] as const;
export type FeedbackIntent = (typeof FEEDBACK_INTENTS)[number];
export const FEEDBACK_SEVERITIES = ['blocking', 'important', 'suggestion'] as const;
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number];
export const FEEDBACK_STATUSES = ['pending', 'acknowledged', 'resolved', 'dismissed'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const SHAPE_TYPES = ['rect', 'arrow', 'freehand'] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

/** One drawing on the live page, in document coordinates (CSS px from the page's top left). */
export const feedbackShapeSchema = z.object({
  type: z.enum(SHAPE_TYPES),
  /** rect: two corners; arrow: tail then head; freehand: the pointer samples [x, y, pressure] */
  points: z.array(z.tuple([z.number(), z.number(), z.number().optional()])).min(1).max(4000),
  color: z.string().max(32),
  /** stroke width in CSS px */
  width: z.number().positive().max(64).default(3),
});
export type FeedbackShape = z.infer<typeof feedbackShapeSchema>;

/** A console error or failed request from the 60 s before the item (the ring buffer). */
export const contextEntrySchema = z.object({
  t: z.number(),
  kind: z.enum(['console', 'error', 'network']),
  /** console message, error message, or "METHOD url" */
  text: z.string().max(2000),
  /** HTTP status, 0 for a network failure, absent for console and page errors */
  status: z.number().int().optional(),
  /** failure reason of a request (net::ERR_*, abort, timeout, cors) */
  error: z.string().max(200).optional(),
  /** capture event id, so a viewer can jump to the row */
  ref: z.string().max(200).optional(),
});
export type ContextEntry = z.infer<typeof contextEntrySchema>;

export const feedbackContextSchema = z.object({
  /** window the entries were read from, ending at the item's time */
  windowMs: z.number().int().positive(),
  errors: z.array(contextEntrySchema).max(50),
  failedRequests: z.array(contextEntrySchema).max(50),
});
export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

export const feedbackPageSchema = z.object({
  url: z.string().max(4000),
  title: z.string().max(500).default(''),
  viewport: z.object({ w: z.number(), h: z.number() }),
  scroll: z.object({ x: z.number(), y: z.number() }),
  dpr: z.number().positive(),
});
export type FeedbackPage = z.infer<typeof feedbackPageSchema>;

/**
 * The element a drawing (or a text highlight) is attached to (D-204): found again by its selector,
 * test id or id, and its box when the note was made, in the same document coordinates as the
 * shapes. The page draws the shapes at their offset from the element's box now, so they follow
 * it through document scroll, a scrolling container, a resize or a layout shift. `fit`: the
 * drawing frames this element (a rectangle around a card), so it also stretches with the box.
 */
export const feedbackFrameSchema = z.object({
  selector: z.string().max(2000),
  testId: z.string().max(500).optional(),
  elId: z.string().max(500).optional(),
  box: rectSchema,
  fit: z.boolean().optional(),
});
export type FeedbackFrame = z.infer<typeof feedbackFrameSchema>;

/** Where the pin sits: offset inside the element (0..1), and the document point as a fallback. */
export const feedbackAnchorSchema = z.object({
  fx: z.number().min(0).max(1),
  fy: z.number().min(0).max(1),
  x: z.number(),
  y: z.number(),
  /** the element is position: fixed or sticky; x and y are then viewport coordinates */
  fixed: z.boolean().optional(),
  /** drawings and text highlights: the element their shapes or marks follow (D-204) */
  frame: feedbackFrameSchema.optional(),
});
export type FeedbackAnchor = z.infer<typeof feedbackAnchorSchema>;

/** One item as the extension sends it at submit. Asset ids come from POST /assets. */
export const feedbackItemInputSchema = z.object({
  /** client id (uuid), so a retried submit does not add the item twice */
  clientId: z.string().uuid(),
  /** number shown on the pin, unique within the submit (M-18) */
  n: z.number().int().positive(),
  kind: z.enum(FEEDBACK_KINDS),
  comment: z.string().max(10_000).default(''),
  /** highlighted text (kind `text`) */
  quote: z.string().max(5_000).optional(),
  target: targetRefSchema.optional(),
  /** locator packet (D-128, D-164): route files, Svelte dev source, mapped errors of the last minute */
  locator: locatorPacketSchema.optional().catch(undefined),
  anchor: feedbackAnchorSchema.optional(),
  shapes: z.array(feedbackShapeSchema).max(50).default([]),
  /** crop of the element, selection or drawing at 1x CSS pixels, drawings flattened in */
  cropAssetId: z.string().uuid().optional(),
  /** document rect the crop shows */
  cropRect: rectSchema.optional(),
  voiceAssetId: z.string().uuid().optional(),
  voiceDurationMs: z.number().int().nonnegative().optional(),
  context: feedbackContextSchema.optional(),
  page: feedbackPageSchema,
  intent: z.enum(FEEDBACK_INTENTS).default('fix'),
  severity: z.enum(FEEDBACK_SEVERITIES).default('important'),
  /** epoch ms when the reviewer added the item */
  t: z.number(),
});
export type FeedbackItemInput = z.input<typeof feedbackItemInputSchema>;

export const feedbackAuthorSchema = z.object({
  userId: z.string().nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
});

export const feedbackItemSchema = feedbackItemInputSchema.extend({
  id: z.string(),
  recordingId: z.string(),
  cropUrl: z.string().nullable(),
  voiceUrl: z.string().nullable(),
  transcript: z
    .object({
      status: z.enum(['pending', 'running', 'done', 'failed', 'off']),
      text: z.string().nullable(),
      vtt: z.string().nullable(),
      language: z.string().nullable(),
    })
    .nullable(),
  status: z.enum(FEEDBACK_STATUSES),
  author: feedbackAuthorSchema,
  createdAt: z.string(),
});
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;

/** How far back a comment without a trace looks for errors and failed requests (PLAN). */
export const CONTEXT_WINDOW_MS = 60_000;

/** Single-key shortcuts while the toolbar is awake (never while typing in a field). */
export const REVIEW_KEYS = {
  comment: 'c',
  text: 't',
  rect: 'r',
  arrow: 'a',
  freehand: 'f',
  shot: 's',
  voice: 'v',
  list: 'l',
  hidePins: 'h',
  trace: 'x',
} as const;

/** Colors for drawings on the page; the first is the default. */
export const DRAW_COLORS = ['#e5484d', '#f5a524', '#30a46c', '#0090ff', '#8e4ec6', '#111111'] as const;

// ---------- the 60 s context of a comment ----------

type EventLike = { id: string; t: number; kind: string; data: unknown };

function argText(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    const o = a as { $t?: string; name?: string; message?: string };
    if (o.$t === 'error') return `${o.name ?? 'Error'}: ${o.message ?? ''}`;
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Console errors, page errors and failed requests (status 400 and up, or no response; not the
 * requests a navigation cancelled) among the events of `[now - windowMs, now]`, newest last. A request seen both by the page hooks and by
 * webRequest counts once.
 */
export function contextFromEvents(events: readonly EventLike[], now: number, windowMs = CONTEXT_WINDOW_MS): FeedbackContext {
  const from = now - windowMs;
  const inWindow = events.filter((e) => e.t >= from && e.t <= now + 1000);
  const errors: ContextEntry[] = [];
  const failedRequests: ContextEntry[] = [];
  const reqs = new Map<string, { method: string; url: string }>();
  for (const e of inWindow) if (e.kind === 'net.req') {
    const d = e.data as { rid: string; method: string; url: string };
    reqs.set(d.rid, { method: d.method, url: d.url });
  }
  const seen = new Map<string, number>();
  for (const e of inWindow) {
    if (e.kind === 'console') {
      const d = e.data as { level: string; args: unknown[] };
      if (d.level !== 'error' && d.level !== 'assert') continue;
      errors.push({ t: e.t, kind: 'console', text: clip((d.args ?? []).map(argText).join(' ')), ref: e.id });
    } else if (e.kind === 'error') {
      const d = e.data as { type: string; message: string; name?: string };
      if (d.type === 'csp') continue;
      errors.push({ t: e.t, kind: 'error', text: clip(d.type === 'unhandledrejection' ? `Unhandled rejection: ${d.message}` : d.message), ref: e.id });
    } else if (e.kind === 'net.res' || e.kind === 'net.fail') {
      const d = e.data as { rid: string; status?: number; error?: string };
      if (e.kind === 'net.res' && (d.status ?? 0) < 400) continue;
      // a navigation cancels the old page's requests: that is not a failure of the app
      if (e.kind === 'net.fail' && /^(abort|net::ERR_ABORTED)$/i.test(d.error ?? '')) continue;
      const r = reqs.get(d.rid);
      if (!r) continue;
      // the page hook and webRequest each report a request: one entry per request within 3 s
      const key = `${r.method} ${r.url} ${d.status ?? 0}`;
      const last = seen.get(key);
      if (last !== undefined && Math.abs(e.t - last) < 3000) continue;
      seen.set(key, e.t);
      failedRequests.push({ t: e.t, kind: 'network', text: clip(`${r.method} ${r.url}`), ...(e.kind === 'net.res' ? { status: d.status } : { status: 0, error: clip(d.error ?? 'failed', 200) }), ref: e.id });
    }
  }
  return { windowMs, errors: errors.slice(-50), failedRequests: failedRequests.slice(-50) };
}

/** The events a context names, plus the requests they answer, for a capture's events stream. */
export function contextEventIds(events: readonly EventLike[], ctx: FeedbackContext): Set<string> {
  const ids = new Set<string>();
  const rids = new Set<string>();
  for (const c of [...ctx.errors, ...ctx.failedRequests]) if (c.ref) ids.add(c.ref);
  for (const e of events) if (ids.has(e.id) && (e.kind === 'net.res' || e.kind === 'net.fail')) rids.add((e.data as { rid: string }).rid);
  for (const e of events) if (e.kind === 'net.req' && rids.has((e.data as { rid: string }).rid)) ids.add(e.id);
  return ids;
}
