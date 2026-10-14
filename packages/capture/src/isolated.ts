// ISOLATED world entry, run at document_start in every frame. Receives page events over the
// bridge, records user events, DOM summaries, env info and (on demand) rrweb, applies redaction
// before anything leaves the page, and hands batches to a Transport.
import { createEmitter, type CaptureEvent, type EventKind, type EventDataMap, type MaskingPreset } from '@toolbar/shared';
import { redactEvent } from '@toolbar/shared/redact';
import { acceptMainBridge, isMainReply, type MainReply } from './bridge.ts';
import { observeDom } from './dom-summary.ts';
import { collectEnv } from './env.ts';
import { createRrwebRecorder } from './rrweb.ts';
import type { Command, Transport } from './transport.ts';
import { recordUserEvents } from './user-events.ts';

export interface StartIsolatedOptions {
  transport: Transport;
  win?: Window & typeof globalThis;
  /** Batch window in ms. Events within it go out in one send(). */
  batchMs?: number;
  /** Record DOM summaries (default on). */
  dom?: boolean;
  /** Collect and emit env info at start (default: top frame only). */
  env?: boolean;
  /** Extension version for env.extVersion. */
  extVersion?: string;
}

export interface IsolatedHandle {
  flush(): void;
  readonly connected: boolean;
  readonly received: number;
  /** Ask the MAIN world for window.toolbar.setMetadata output (J-073). */
  metadata(timeoutMs?: number): Promise<{ value?: Record<string, unknown> | null; error?: string }>;
  /** Current env info for this document. */
  env(): Promise<EventDataMap['env']>;
  readonly ctx: string;
}

export function startIsolatedWorld({ transport, win = window as Window & typeof globalThis, batchMs = 50, dom = true, env, extVersion }: StartIsolatedOptions): IsolatedHandle {
  const top = (() => {
    try {
      return win.top === win;
    } catch {
      return false;
    }
  })();
  const ctx = top ? 'top-i' : `f${Math.random().toString(36).slice(2, 7)}-i`;
  const make = createEmitter(ctx);
  let preset: MaskingPreset = 'staging';
  let pending: CaptureEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let received = 0;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    try {
      transport.send(batch);
    } catch {
      /* transport down; the next send reconnects */
    }
  };
  const push = (e: CaptureEvent) => {
    let out: CaptureEvent;
    try {
      out = redactEvent(e);
    } catch {
      return; // never let an unredacted event through
    }
    pending.push(out);
    if (pending.length >= 200) flush();
    else timer ??= setTimeout(flush, batchMs);
  };
  const emit = <K extends EventKind>(kind: K, data: EventDataMap[K]) => push(make(kind, data) as CaptureEvent);

  // MAIN -> here: events and replies.
  let replyId = 0;
  const waiting = new Map<number, (r: MainReply) => void>();
  const bridge = acceptMainBridge((data) => {
    if (isMainReply(data)) {
      waiting.get(data.id)?.(data);
      waiting.delete(data.id);
      return;
    }
    received++;
    push(data as CaptureEvent);
  }, win);

  const users = recordUserEvents({ emit: (u) => emit('user', u), onHide: flush, frame: top ? 'top' : ctx.replace(/-i$/, ''), win });
  if (dom) observeDom((d) => emit('dom', d), win);
  const rrweb = createRrwebRecorder((batch, full) => {
    flush(); // keep events and rrweb roughly in order across the two streams
    transport.sendRrweb?.(batch, full);
  });
  let ringOn = false;
  const attached = new Set<string>();
  const syncRrweb = () => {
    if (!top) return; // rrweb in the top frame records same-origin iframes itself
    if (ringOn || attached.size) rrweb.start(preset);
    else rrweb.stop();
  };

  const envOnce = (): Promise<EventDataMap['env']> =>
    collectEnv(win, { maskingPreset: preset }).then((e) => (extVersion ? { ...e, extVersion } : e));
  if (env ?? top) void envOnce().then((e) => emit('env', e)).catch(() => {});

  transport.onCommand((c: Command) => {
    switch (c.type) {
      case 'flush':
        users.flushInputs();
        rrweb.flush();
        flush();
        break;
      case 'config':
        if (c.maskingPreset) {
          preset = c.maskingPreset;
          users.setPreset(c.maskingPreset);
        }
        if (c.captureUserEvents !== undefined) users.setEnabled(c.captureUserEvents);
        break;
      case 'ring':
        ringOn = c.enabled;
        syncRrweb();
        break;
      case 'attach':
        attached.add(c.recordingId);
        if (rrweb.running) rrweb.checkout();
        syncRrweb();
        break;
      case 'detach':
        users.flushInputs();
        attached.delete(c.recordingId);
        rrweb.flush();
        flush();
        syncRrweb();
        break;
      case 'checkout':
      case 'snapshot':
        rrweb.checkout();
        break;
    }
  });

  return {
    flush,
    get connected() {
      return bridge.connected;
    },
    get received() {
      return received;
    },
    get ctx() {
      return ctx;
    },
    metadata(timeoutMs = 500) {
      return new Promise((resolve) => {
        const id = ++replyId;
        if (!bridge.command({ cmd: 'metadata', id })) return resolve({ error: 'bridge_down' });
        const t = setTimeout(() => {
          waiting.delete(id);
          resolve({ error: 'timeout' });
        }, timeoutMs);
        waiting.set(id, (r) => {
          clearTimeout(t);
          resolve({ value: r.value, error: r.error });
        });
      });
    },
    env: envOnce,
  };
}
