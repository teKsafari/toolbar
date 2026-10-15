// ISOLATED world entry, run at document_start in every frame. Receives page events over the
// bridge, records user events, DOM summaries, env info and (on demand) rrweb, applies redaction
// before anything leaves the page, and hands batches to a Transport.
import { createEmitter, documentToken, type CaptureEvent, type EventKind, type EventDataMap, type MaskingPreset } from '@toolbar/shared/events';
import { createRedactor } from '@toolbar/shared/redact';
import { OPEN_BODY_POLICY, type BodyPolicy } from '@toolbar/shared/projects';
import { acceptMainBridge, isMainReply, type MainReply } from './bridge.ts';
import { observeDom } from './dom-summary.ts';
import { collectEnv } from './env.ts';
import { createRrwebRecorder } from './rrweb.ts';
import type { Command, Transport } from './transport.ts';
import { recordUserEvents } from './user-events.ts';
import { watchPageWeight } from './page-weight.ts';
import { watchCanvases } from './canvas-sample.ts';

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
  /** Timing of page-weight reports (J-011); tests shorten it. */
  pageWeight?: { firstMs?: number; everyMs?: number };
  /**
   * Hold every event until the first `config` command names the masking preset and body policy
   * (D-125), so nothing leaves the page under the wrong preset. The extension sets it; the queue
   * keeps the newest `heldMax` events.
   */
  awaitConfig?: boolean;
  heldMax?: number;
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

export function startIsolatedWorld({ transport, win = window as Window & typeof globalThis, batchMs = 50, dom = true, env, extVersion, pageWeight, awaitConfig = false, heldMax = 2000 }: StartIsolatedOptions): IsolatedHandle {
  const top = (() => {
    try {
      return win.top === win;
    } catch {
      return false;
    }
  })();
  const ctx = top ? 'top-i' : `f${Math.random().toString(36).slice(2, 7)}-i`;
  const make = createEmitter(ctx, undefined, documentToken());
  // Until the preset is known, describe targets under the strictest one: an early click must not
  // carry page text that the project's preset would mask.
  let preset: MaskingPreset = awaitConfig ? 'production' : 'staging';
  let bodyPolicy: BodyPolicy = OPEN_BODY_POLICY;
  let configured = !awaitConfig;
  let held: CaptureEvent[] = [];
  const redact = createRedactor(
    () => bodyPolicy,
    () => {
      try {
        return win.location.href;
      } catch {
        return undefined;
      }
    },
  );
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
    if (!configured) {
      held.push(e);
      if (held.length > heldMax) held.splice(0, held.length - heldMax);
      return;
    }
    let out: CaptureEvent;
    try {
      out = redact(e);
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
  if (awaitConfig) users.setPreset(preset);
  if (dom) observeDom((d) => emit('dom', d), win, 100, { texts: () => preset !== 'production' });
  // canvas pixels around actions, only while a recording or trace is attached (packages/trace)
  const canvases = watchCanvases((s) => emit('canvas.sample', s), win);
  const rrweb = createRrwebRecorder((batch, full) => {
    flush(); // keep events and rrweb roughly in order across the two streams
    transport.sendRrweb?.(batch, full);
  });
  let ringOn = false;
  const attached = new Set<string>();
  // J-011: while the ring runs, the top frame reports its weight so the worker can pause it
  let weight: ReturnType<typeof watchPageWeight> | null = null;
  const syncWeight = () => {
    if (!top || !transport.sendPageWeight) return;
    if (ringOn && !weight) weight = watchPageWeight((w) => transport.sendPageWeight?.(w), win, pageWeight);
    else if (!ringOn && weight) {
      weight.stop();
      weight = null;
    }
  };
  const syncRrweb = () => {
    if (!top) return; // rrweb in the top frame records same-origin iframes itself
    if (ringOn || attached.size) rrweb.start(preset);
    else rrweb.stop();
  };

  const envOnce = (): Promise<EventDataMap['env']> =>
    collectEnv(win, { maskingPreset: preset }).then((e) => (extVersion ? { ...e, extVersion } : e));
  const emitEnv = () => void envOnce().then((e) => emit('env', e)).catch(() => {});
  // with awaitConfig the env event waits for the preset, since it records which one applied
  if ((env ?? top) && !awaitConfig) emitEnv();

  transport.onCommand((c: Command) => {
    switch (c.type) {
      case 'flush':
        users.flushInputs();
        rrweb.flush();
        flush();
        break;
      case 'config': {
        const before = preset;
        if (c.maskingPreset) {
          preset = c.maskingPreset;
          users.setPreset(c.maskingPreset);
        }
        if (c.bodyPolicy) bodyPolicy = c.bodyPolicy;
        if (c.captureUserEvents !== undefined) users.setEnabled(c.captureUserEvents);
        // rrweb takes its mask options at start: a new preset restarts it with a full snapshot
        if (preset !== before && rrweb.running) {
          rrweb.stop();
          syncRrweb();
        }
        if (!configured) {
          configured = true;
          if (env ?? top) emitEnv();
          const queued = held;
          held = [];
          for (const e of queued) push(e);
        }
        break;
      }
      case 'ring':
        ringOn = c.enabled;
        syncRrweb();
        syncWeight();
        break;
      case 'attach':
        attached.add(c.recordingId);
        if (rrweb.running) rrweb.checkout();
        syncRrweb();
        canvases.start();
        break;
      case 'detach':
        users.flushInputs();
        attached.delete(c.recordingId);
        rrweb.flush();
        flush();
        syncRrweb();
        if (!attached.size) canvases.stop();
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
