// The page bundle's side of capture (D-129): a Transport for @toolbar/capture that keeps the last
// 60 seconds of events and DOM replay in memory (comments without a trace attach them), and,
// while a trace runs, streams both to the server in gzip NDJSON chunks every two seconds. A trace
// is a capture of kind `trace` (D-117), so the server derives its interaction spans as it does
// for the extension's traces. It survives navigations within the tab: its id and chunk counters
// live in sessionStorage, and each new page attaches to it with a fresh rrweb full snapshot.
import type { Command, Transport } from '@toolbar/capture/transport';
import type { CaptureEvent, TargetRef } from '@toolbar/shared';
import { gzipText, ndjson, type PageClient, type PageStream } from './upload.ts';

export const RING_MS = 60_000;
export const TRACE_FLUSH_MS = 2_000;
const TRACE_KEY = 'tb:page-trace';
const RRWEB_META = 4;
const RRWEB_FULL = 2;

type Rr = { type?: number; timestamp?: number };
const tsOf = (e: unknown) => (e as Rr).timestamp ?? 0;

export interface PageComment {
  comment: string;
  target?: TargetRef;
  t: number;
  url: string;
}

export interface TraceState {
  id: string;
  shareUrl: string;
  startedAt: number;
  url: string;
  title: string;
  seq: Record<PageStream, number>;
  bytes: Record<PageStream, number>;
  comments: PageComment[];
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

export interface PageSessionOptions {
  client: PageClient;
  workspaceId: () => Promise<string>;
  env: () => Promise<unknown>;
  now?: () => number;
}

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

  /** Start the ring, and re-attach a trace that an earlier page of this tab started. */
  boot() {
    this.command({ type: 'ring', enabled: true, minutes: 1 });
    if (this.trace) this.attach();
    addEventListener('pagehide', () => this.flushTrace(true));
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

  // ---- comments ----

  /** A comment: kept for the trace while one runs, else sent at once with the last minute. */
  async comment(c: PageComment): Promise<{ shareUrl: string } | { queued: true }> {
    if (this.trace) {
      this.trace.comments.push(c);
      writeTrace(this.trace);
      this.changed();
      return { queued: true };
    }
    // the workspace comes with the page's preset; events held until then are released first
    const workspaceId = await this.opts.workspaceId();
    this.command({ type: 'flush' });
    const s = this.ring.slice(this.now());
    const { client } = this.opts;
    const created = await client.createCapture({
      clientId: uuid(),
      kind: 'replay',
      workspaceId,
      page: { url: location.href, title: document.title },
      startedAt: s.start,
      env: await this.opts.env().catch(() => undefined),
      source: 'injector',
      durationMs: Math.max(0, Math.round(this.now() - s.start)),
    });
    for (const [stream, rows] of [
      ['events', s.events],
      ['rrweb', s.rrweb],
    ] as const) {
      if (!rows.length) continue;
      const gz = await gzipText(ndjson(rows));
      await client.putChunk(created.id, stream, 0, gz, timeOf(rows[0]) ?? s.start, timeOf(rows[rows.length - 1]) ?? this.now());
      await client.completeStream(created.id, stream, 0, gz.size);
    }
    const fin = await client.finalize(created.id, {
      title: titleOf(c.comment),
      description: c.comment,
      annotations: [{ t: Math.max(0, Math.round(c.t - s.start)), shapes: [], comment: c.comment, ...(c.target ? { target: c.target } : {}) }],
    });
    return { shareUrl: fin.shareUrl || created.shareUrl };
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
      source: 'injector',
    });
    this.trace = { id: created.id, shareUrl: created.shareUrl, startedAt, url: location.href, title: document.title, seq: { events: 0, rrweb: 0 }, bytes: { events: 0, rrweb: 0 }, comments: [] };
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
        await this.opts.client.putChunk(t.id, stream, seq, gz, timeOf(rows[0]) ?? t.startedAt, timeOf(rows[rows.length - 1]) ?? this.now(), unloading && gz.size < 60_000);
      };
      // chunks go one after another; a failed chunk is reported and the next ones still go
      this.chain = this.chain.then(send).catch((e: unknown) => {
        this.lastError = e instanceof Error ? e.message : String(e);
        this.changed();
      });
    }
    return this.chain;
  }

  async stopTrace(note: string): Promise<{ shareUrl: string }> {
    const t = this.trace;
    if (!t) throw new Error('no trace');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.command({ type: 'detach', recordingId: t.id });
    await this.flushTrace(false);
    const { client } = this.opts;
    for (const stream of ['events', 'rrweb'] as const) {
      if (t.seq[stream] > 0) await client.completeStream(t.id, stream, t.seq[stream] - 1, t.bytes[stream]);
    }
    const lines = t.comments.map((c) => c.comment);
    const description = [note, ...lines].filter(Boolean).join('\n\n');
    const fin = await client.finalize(t.id, {
      title: titleOf(note || lines[0] || `Trace on ${t.title || new URL(t.url).host}`),
      description,
      durationMs: Math.max(0, Math.round(this.now() - t.startedAt)),
      annotations: t.comments.map((c) => ({ t: Math.max(0, Math.round(c.t - t.startedAt)), shapes: [], comment: c.comment, ...(c.target ? { target: c.target } : {}) })),
    });
    this.trace = null;
    writeTrace(null);
    this.command({ type: 'ring', enabled: true, minutes: 1 });
    this.changed();
    return { shareUrl: fin.shareUrl || t.shareUrl };
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
