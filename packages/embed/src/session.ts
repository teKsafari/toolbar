// The embed's side of capture (D-158, D-212): a Transport for @toolbar/capture that keeps the last
// 60 seconds of events and DOM replay in memory (a note's context comes from it), and, while a
// trace runs, streams both to the server in gzip NDJSON chunks every two seconds. A trace is a
// capture of kind `trace` (D-117), so the server derives its interaction spans as it does for the
// extension's traces. It survives navigations within the tab: its id, upload token and chunk
// counters live in sessionStorage, and each new page attaches to it with a fresh rrweb full
// snapshot.
import type { Command, Transport } from '@toolbar/capture/transport';
import { createEmitter, type CaptureEvent } from '@toolbar/shared/events';
import { gzipText, ndjson, EmbedHttpError, type EmbedCapture, type EmbedClient, type EmbedReviewer, type PageStream } from './client.ts';

export const RING_MS = 60_000;
export const TRACE_FLUSH_MS = 2_000;
const TRACE_KEY = 'tb:page-trace';
/** Rows a page had not sent when it went away; the next page of the tab sends them first. */
const PENDING_KEY = 'tb:page-trace-pending';
/** Largest stash, in characters of JSON (sessionStorage holds about 5 MB per origin). */
export const STASH_MAX = 2_000_000;
const RRWEB_META = 4;
const RRWEB_FULL = 2;

type Rr = { type?: number; timestamp?: number };
const tsOf = (e: unknown) => (e as Rr).timestamp ?? 0;

export interface TraceState extends EmbedCapture {
  startedAt: number;
  url: string;
  title: string;
  seq: Record<PageStream, number>;
  bytes: Record<PageStream, number>;
}

/** Last-minute buffer: events by time, rrweb in segments that each start at a full snapshot. */
export class Ring {
  events: CaptureEvent[] = [];
  segments: { start: number; items: unknown[] }[] = [];
  private env: CaptureEvent | null = null;
  constructor(readonly windowMs = RING_MS) {}

  addEvents(batch: CaptureEvent[], now = Date.now()) {
    for (const e of batch) {
      if (e.kind === 'env') this.env = e;
      else this.events.push(e);
    }
    this.prune(now);
  }

  addRrweb(batch: unknown[], full: boolean, now = Date.now()) {
    if (!batch.length) return;
    let rest = batch;
    if (full) {
      // the new segment starts at the meta event that precedes the full snapshot
      const fullAt = batch.findIndex((e) => (e as Rr).type === RRWEB_FULL);
      let cut = fullAt;
      if (cut > 0 && (batch[cut - 1] as Rr).type === RRWEB_META) cut--;
      const before = cut > 0 ? batch.slice(0, cut) : [];
      if (before.length && this.segments.length) this.segments[this.segments.length - 1]!.items.push(...before);
      rest = batch.slice(Math.max(0, cut));
      this.segments.push({ start: tsOf(rest[0]) || now, items: [...rest] });
    } else if (this.segments.length) {
      this.segments[this.segments.length - 1]!.items.push(...rest);
    }
    // incremental events with no full snapshot before them cannot be replayed: dropped
    this.prune(now);
  }

  prune(now = Date.now()) {
    const cut = now - this.windowMs;
    let i = 0;
    while (i < this.events.length && this.events[i]!.t < cut) i++;
    if (i) this.events.splice(0, i);
    // keep the newest segment that starts at or before the cut, so the window can be replayed
    while (this.segments.length > 1 && this.segments[1]!.start <= cut) this.segments.shift();
  }

  slice(now = Date.now()): { events: CaptureEvent[]; rrweb: unknown[]; start: number } {
    this.prune(now);
    const rrweb = this.segments.flatMap((s) => s.items);
    const first = Math.min(this.events[0]?.t ?? now, this.segments[0]?.start ?? now);
    const events = this.env ? [{ ...this.env, t: first } as CaptureEvent, ...this.events] : [...this.events];
    return { events, rrweb, start: first };
  }
}

function readTrace(): TraceState | null {
  try {
    const raw = sessionStorage.getItem(TRACE_KEY);
    return raw ? (JSON.parse(raw) as TraceState) : null;
  } catch {
    return null;
  }
}

function writeTrace(s: TraceState | null) {
  try {
    if (s) sessionStorage.setItem(TRACE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(TRACE_KEY);
  } catch {
    /* storage blocked: the trace lasts as long as this page */
  }
}

function readStash(id: string): Record<PageStream, unknown[]> | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { id: string; events: unknown[]; rrweb: unknown[] };
    return s.id === id ? { events: s.events ?? [], rrweb: s.rrweb ?? [] } : null;
  } catch {
    return null;
  }
}

function writeStash(id: string | null, rows?: Record<PageStream, unknown[]>): boolean {
  try {
    if (!id || !rows) {
      sessionStorage.removeItem(PENDING_KEY);
      return true;
    }
    const json = JSON.stringify({ id, events: rows.events, rrweb: rows.rrweb });
    if (json.length > STASH_MAX) return false;
    sessionStorage.setItem(PENDING_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export interface PageSessionOptions {
  client: EmbedClient;
  workspaceId: () => Promise<string>;
  env: () => Promise<unknown>;
  /** who starts a trace; read when it starts */
  reviewer?: () => EmbedReviewer;
  now?: () => number;
}

const make = createEmitter('embed');

export class PageSession implements Transport {
  readonly ring = new Ring();
  trace: TraceState | null = readTrace();
  private handlers: ((c: Command) => void)[] = [];
  private pending: Record<PageStream, unknown[]> = { events: [], rrweb: [] };
  private timer: ReturnType<typeof setInterval> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  lastError: string | null = null;

  constructor(private opts: PageSessionOptions) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  // ---- Transport ----
  send(batch: CaptureEvent[]) {
    this.ring.addEvents(batch, this.now());
    if (this.trace) this.pending.events.push(...batch);
  }
  sendRrweb(batch: unknown[], full: boolean) {
    this.ring.addRrweb(batch, full, this.now());
    if (this.trace) this.pending.rrweb.push(...batch);
  }
  onCommand(fn: (c: Command) => void) {
    this.handlers.push(fn);
  }
  command(c: Command) {
    for (const h of this.handlers) h(c);
  }

  /** A note made during a trace becomes one of its actions (the span engine reads annotation events). */
  annotate(annotationId: string) {
    this.send([make('annotation', { annotationId, op: 'create' })]);
  }

  /** Events of the last `ms` from the ring (the locator's error window). */
  recentEvents(ms: number): CaptureEvent[] {
    const now = this.now();
    return this.ring.slice(now).events.filter((e) => e.t >= now - ms);
  }

  /** Start the ring, and re-attach a trace that an earlier page of this tab started. */
  boot() {
    this.command({ type: 'ring', enabled: true, minutes: 1 });
    if (this.trace) {
      this.unstash();
      this.attach();
    }
    addEventListener('pagehide', () => this.flushTrace(true));
    // back from the back-forward cache: the rows this page stashed as it went are still its own
    addEventListener('pageshow', (e) => {
      if ((e as PageTransitionEvent).persisted && this.trace) this.unstash();
    });
  }

  /** Puts the rows an earlier page of the tab could not send in front of this page's. */
  private unstash() {
    if (!this.trace) return;
    const s = readStash(this.trace.id);
    writeStash(null);
    if (!s) return;
    this.pending.events.unshift(...s.events);
    this.pending.rrweb.unshift(...s.rrweb);
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    for (const fn of this.listeners) fn();
  }

  private attach() {
    if (!this.trace) return;
    this.command({ type: 'attach', recordingId: this.trace.id, t0: this.trace.startedAt });
    this.command({ type: 'checkout' });
    this.timer ??= setInterval(() => this.flushTrace(false), TRACE_FLUSH_MS);
  }

  // ---- trace ----

  async startTrace() {
    if (this.trace) return;
    const workspaceId = await this.opts.workspaceId();
    const startedAt = this.now();
    const created = await this.opts.client.createCapture({
      clientId: uuid(),
      kind: 'trace',
      workspaceId,
      page: { url: location.href, title: document.title },
      startedAt,
      env: await this.opts.env().catch(() => undefined),
      source: 'embed',
      ...(this.opts.reviewer ? { reviewer: this.opts.reviewer() } : {}),
    });
    this.trace = { id: created.id, uploadToken: created.uploadToken, startedAt, url: location.href, title: document.title, seq: { events: 0, rrweb: 0 }, bytes: { events: 0, rrweb: 0 } };
    writeTrace(this.trace);
    this.pending = { events: [], rrweb: [] };
    this.attach();
    this.changed();
  }

  /** Queue the pending rows as chunks. `unloading`: the page is going away; send with keepalive. */
  flushTrace(unloading: boolean): Promise<unknown> {
    const t = this.trace;
    if (!t) return this.chain;
    if (!unloading) this.command({ type: 'flush' });
    // A page that goes away rarely lives long enough to gzip and send: the chunk's number was
    // taken and the chunk never arrived, so the trace could not be completed (stream_incomplete,
    // docs/real-world/second-app.md). Keep the rows for the next page of the tab instead.
    if (unloading && (this.pending.events.length || this.pending.rrweb.length)) {
      const before = readStash(t.id) ?? { events: [], rrweb: [] };
      const rows = { events: [...before.events, ...this.pending.events], rrweb: [...before.rrweb, ...this.pending.rrweb] };
      if (writeStash(t.id, rows)) {
        this.pending = { events: [], rrweb: [] };
        return this.chain;
      }
    }
    for (const stream of ['events', 'rrweb'] as const) {
      const rows = this.pending[stream];
      if (!rows.length) continue;
      this.pending[stream] = [];
      // the seq is taken now and stored, so the next page of the tab never reuses it
      const seq = t.seq[stream]++;
      writeTrace(t);
      const send = async () => {
        const gz = await gzipText(ndjson(rows));
        t.bytes[stream] += gz.size;
        writeTrace(t);
        await this.opts.client.putChunk(t, stream, seq, gz, timeOf(rows[0]) ?? t.startedAt, timeOf(rows[rows.length - 1]) ?? this.now(), unloading && gz.size < 60_000);
      };
      // chunks go one after another; a failed chunk is reported and the next ones still go
      this.chain = this.chain.then(send).catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.changed();
      });
    }
    return this.chain;
  }

  private complete(t: TraceState, stream: PageStream) {
    return completeWithGaps(this.opts.client, t, stream, this.now());
  }

  async stopTrace(note = ''): Promise<{ recordingId: string }> {
    const t = this.trace;
    if (!t) throw new Error('no trace');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.command({ type: 'detach', recordingId: t.id });
    await this.flushTrace(false);
    const { client } = this.opts;
    for (const stream of ['events', 'rrweb'] as const) {
      if (t.seq[stream] > 0) await this.complete(t, stream);
    }
    // the notes made during the trace went up as its feedback items (review.submit)
    await client.finalize(t, {
      title: titleOf(note || `Trace on ${t.title || new URL(t.url).host}`),
      description: note,
      durationMs: Math.max(0, Math.round(this.now() - t.startedAt)),
      annotations: [],
    });
    this.trace = null;
    writeTrace(null);
    writeStash(null);
    this.command({ type: 'ring', enabled: true, minutes: 1 });
    this.changed();
    return { recordingId: t.id };
  }
}

/**
 * A chunk can still go missing (a tab closed mid-upload, a relay error): the server then refuses
 * to complete the stream and the whole trace would be lost. Fill each missing number with an
 * empty chunk and take the server's byte count, so the trace arrives with a short gap instead.
 */
async function completeWithGaps(client: EmbedClient, t: TraceState, stream: PageStream, now: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await client.completeStream(t, stream, t.seq[stream] - 1, t.bytes[stream]);
      return;
    } catch (e) {
      if (attempt >= 3 || !(e instanceof EmbedHttpError) || e.code !== 'stream_incomplete' || !e.body) throw e;
      const issues = (e.body.issues ?? {}) as { missing?: unknown; total?: unknown };
      const missing = (Array.isArray(e.body.missing) && e.body.missing.length ? e.body.missing : Array.isArray(issues.missing) ? issues.missing : []).filter((n): n is number => Number.isInteger(n) && n >= 0);
      if (missing.length) {
        const empty = await gzipText('');
        for (const seq of missing.slice(0, 1000)) {
          await client.putChunk(t, stream, seq, empty, t.startedAt, now);
          t.bytes[stream] += empty.size;
        }
      } else if (typeof issues.total === 'number') t.bytes[stream] = issues.total;
      else throw e;
    }
  }
}

function timeOf(row: unknown): number | undefined {
  const r = row as { t?: number; timestamp?: number };
  return typeof r?.t === 'number' ? r.t : typeof r?.timestamp === 'number' ? r.timestamp : undefined;
}

export function titleOf(text: string): string {
  const line = text.split('\n').find((l) => l.trim()) ?? '';
  const t = line.trim();
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

/** v4 id; crypto.randomUUID needs a secure context, getRandomValues does not. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function' && globalThis.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
