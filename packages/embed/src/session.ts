// The embed's side of capture (D-158, D-212): a Transport for @toolbar/capture that keeps the last
// 60 seconds of events and DOM replay in memory (a note's context comes from it), and, while a
// trace runs, streams both to the server in gzip NDJSON chunks every two seconds. The tab's trace
// session (D-214) is one capture of kind `trace` (D-117), made at its first Start trace, holding
// one or more traces with a note each; Stop keeps a trace, and Send (the platform's review.submit)
// completes the streams and finalizes with the traces, so the server derives spans per trace as it
// does for the extension's. The session survives navigations within the tab: its id, upload token,
// chunk counters and traces live in sessionStorage, and each new page attaches to a running trace
// with a fresh rrweb full snapshot.
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

/** One trace of the session: Start trace to Stop trace (endedAt null while it runs). */
export interface TraceTake {
  n: number;
  startedAt: number;
  endedAt: number | null;
  note: string;
}

export interface TraceState extends EmbedCapture {
  url: string;
  title: string;
  takes: TraceTake[];
  nextN: number;
  seq: Record<PageStream, number>;
  bytes: Record<PageStream, number>;
}

/** The trace running now, if any. */
export const runningTake = (t: TraceState | null): TraceTake | null => {
  const last = t?.takes.at(-1);
  return last && last.endedAt === null ? last : null;
};

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

const STREAMS = ['events', 'rrweb'] as const;

/**
 * Moves session `t` on with `change`, against the stored copy: two live pages of one session (one
 * back from the back-forward cache, one it navigated to) share its chunk numbers and byte counts
 * through sessionStorage, so the stored counters are taken first and written back after. A
 * session another page sent or replaced is not written back.
 */
function updateTrace<T>(t: TraceState, change: () => T): T {
  const s = readTrace();
  const same = s?.id === t.id;
  if (same) {
    for (const k of STREAMS) {
      t.seq[k] = Math.max(t.seq[k], s.seq[k] ?? 0);
      t.bytes[k] = Math.max(t.bytes[k], s.bytes[k] ?? 0);
    }
  }
  const out = change();
  if (same) writeTrace(t);
  return out;
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
    if (runningTake(this.trace)) this.pending.events.push(...batch);
  }
  sendRrweb(batch: unknown[], full: boolean) {
    this.ring.addRrweb(batch, full, this.now());
    if (runningTake(this.trace)) this.pending.rrweb.push(...batch);
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
    if (this.trace) this.unstash();
    if (runningTake(this.trace)) this.attach();
    addEventListener('pagehide', () => this.flushTrace(true));
    addEventListener('pageshow', (e) => {
      if ((e as PageTransitionEvent).persisted) this.resume();
    });
  }

  /**
   * Back from the back-forward cache: the pages the tab went to since may have sent chunks of the
   * trace, stopped it or started another, so the stored trace replaces this page's copy. A trace
   * that is still on attaches again with a fresh full snapshot.
   */
  resume() {
    const stored = readTrace();
    const old = this.trace;
    if (old && stored?.id !== old.id) this.release(old);
    if (!stored) {
      if (old) this.changed();
      return;
    }
    if (stored.id !== old?.id) this.pending = { events: [], rrweb: [] };
    this.trace = stored;
    this.unstash();
    if (runningTake(stored)) this.attach();
    else this.detach();
    this.changed();
  }

  /** Lets go of a trace this page streamed into, without completing it. */
  private release(t: TraceState) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.command({ type: 'detach', recordingId: t.id });
    this.trace = null;
    this.pending = { events: [], rrweb: [] };
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
    const run = runningTake(this.trace);
    if (!this.trace || !run) return;
    this.command({ type: 'attach', recordingId: this.trace.id, t0: run.startedAt });
    this.command({ type: 'checkout' });
    this.timer ??= setInterval(() => this.flushTrace(false), TRACE_FLUSH_MS);
  }

  /** The running trace is over on this page: no more streaming; the ring goes on as before. */
  private detach() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.trace) this.command({ type: 'detach', recordingId: this.trace.id });
    this.command({ type: 'ring', enabled: true, minutes: 1 });
  }

  // ---- trace session ----

  /** Start a trace: the first one makes the session's capture. */
  async startTrace() {
    if (runningTake(this.trace)) return;
    const startedAt = this.now();
    if (!this.trace) {
      const workspaceId = await this.opts.workspaceId();
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
      this.trace = { id: created.id, uploadToken: created.uploadToken, url: location.href, title: document.title, takes: [], nextN: 1, seq: { events: 0, rrweb: 0 }, bytes: { events: 0, rrweb: 0 } };
    }
    const t = this.trace;
    updateTrace(t, () => t.takes.push({ n: t.nextN++, startedAt, endedAt: null, note: '' }));
    writeTrace(t);
    this.pending = { events: [], rrweb: [] };
    this.attach();
    this.changed();
  }

  /** Queue the pending rows as chunks. `unloading`: the page is going away; send with keepalive. */
  flushTrace(unloading: boolean): Promise<unknown> {
    const t = this.trace;
    if (!t) return this.chain;
    if (!unloading && runningTake(t)) this.command({ type: 'flush' });
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
    for (const stream of STREAMS) {
      const rows = this.pending[stream];
      if (!rows.length) continue;
      this.pending[stream] = [];
      // the seq is taken now and stored, so no other page of the tab reuses it
      const seq = updateTrace(t, () => t.seq[stream]++);
      const send = async () => {
        const gz = await gzipText(ndjson(rows));
        updateTrace(t, () => (t.bytes[stream] += gz.size));
        await this.opts.client.putChunk(t, stream, seq, gz, timeOf(rows[0]) ?? t.takes[0]?.startedAt ?? this.now(), timeOf(rows[rows.length - 1]) ?? this.now(), unloading && gz.size < 60_000);
      };
      // chunks go one after another; a failed chunk is reported and the next ones still go
      this.chain = this.chain.then(send).catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.changed();
      });
    }
    return this.chain;
  }

  /** Stop the running trace and keep it: what it recorded goes up now, the session waits for Send. */
  async stopTrace(): Promise<void> {
    const t = this.trace;
    const run = runningTake(t);
    if (!t || !run) throw new Error('no trace');
    this.command({ type: 'flush' });
    this.detach();
    await this.flushTrace(false);
    updateTrace(t, () => (run.endedAt = this.now()));
    writeTrace(t);
    this.changed();
  }

  /** Write the note of trace `n`. */
  noteTrace(n: number, note: string) {
    const take = this.trace?.takes.find((k) => k.n === n);
    if (!this.trace || !take) throw new Error('no trace');
    const t = this.trace;
    updateTrace(t, () => (take.note = note.slice(0, 4000)));
    writeTrace(t);
    this.changed();
  }

  /**
   * Remove trace `n` from the session (a running one stops, and what it had not sent yet is
   * dropped; the server drops what it did send). Removing the last one discards the session.
   */
  async removeTrace(n: number): Promise<void> {
    const t = this.trace;
    const take = t?.takes.find((k) => k.n === n);
    if (!t || !take) throw new Error('no trace');
    if (take === runningTake(t)) {
      this.detach();
      this.pending = { events: [], rrweb: [] };
      writeStash(null);
    }
    if (t.takes.length === 1) return this.discardTrace();
    updateTrace(t, () => (t.takes = t.takes.filter((k) => k.n !== n)));
    writeTrace(t);
    this.changed();
  }

  /** Drop the whole session: the server's draft goes too (it would be swept after 7 days anyway). */
  async discardTrace(): Promise<void> {
    const t = this.trace;
    if (!t) return;
    if (runningTake(t)) this.detach();
    this.pending = { events: [], rrweb: [] };
    this.trace = null;
    writeTrace(null);
    writeStash(null);
    this.changed();
    await this.chain;
    await this.opts.client.discard(t).catch(() => undefined);
  }

  /**
   * Send the session (after its notes went up): stop a running trace, complete the streams and
   * finalize with the traces, the title and the reviewer's context.
   */
  async sendTrace(text: { title: string; description: string }): Promise<{ recordingId: string; traces: number }> {
    const t = this.trace;
    if (!t) throw new Error('no trace');
    if (runningTake(t)) await this.stopTrace();
    await this.flushTrace(false);
    // chunks other pages of the tab sent count too
    updateTrace(t, () => undefined);
    const { client } = this.opts;
    for (const stream of STREAMS) {
      if (t.seq[stream] > 0) await this.complete(t, stream);
    }
    // the name the reviewer gave by now, which may be after the trace started (D-213)
    const name = this.opts.reviewer?.().name;
    const first = t.takes[0]!;
    const last = t.takes.at(-1)!;
    await client.finalize(t, {
      title: text.title,
      description: text.description,
      durationMs: Math.max(0, Math.round((last.endedAt ?? this.now()) - first.startedAt)),
      annotations: [],
      traces: t.takes.map((k) => ({ n: k.n, startedAt: Math.round(k.startedAt), endedAt: Math.round(k.endedAt ?? k.startedAt), note: k.note })),
      ...(name ? { reviewer: { name } } : {}),
    });
    this.trace = null;
    writeTrace(null);
    writeStash(null);
    this.changed();
    return { recordingId: t.id, traces: t.takes.length };
  }

  private complete(t: TraceState, stream: PageStream) {
    return completeWithGaps(this.opts.client, t, stream, this.now());
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
          await client.putChunk(t, stream, seq, empty, t.takes[0]?.startedAt ?? now, now);
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

/** v4 id; crypto.randomUUID needs a secure context, getRandomValues does not. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function' && globalThis.isSecureContext) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
