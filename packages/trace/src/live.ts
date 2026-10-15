// The engine fed live (the extension worker during a trace). Events reach the worker in
// batches from several producers (MAIN world, isolated world, webRequest), a few hundred ms late
// and slightly out of order, so they wait in a buffer `lagMs` long and go in sorted.
import { compareEvents, type CaptureEvent } from '@toolbar/shared';
import { SpanEngine, type EngineOptions } from './engine.ts';
import type { KeyframeRequest, Span } from './types.ts';

export interface LiveTraceOptions extends EngineOptions {
  /** How long an event waits before it is fed (ms). */
  lagMs?: number;
}

export class LiveTrace {
  readonly engine: SpanEngine;
  private buf: CaptureEvent[] = [];
  private lagMs: number;

  constructor(opts: LiveTraceOptions = {}) {
    this.engine = new SpanEngine(opts);
    this.lagMs = opts.lagMs ?? 1000;
  }

  add(batch: readonly CaptureEvent[]) {
    for (const e of batch) this.buf.push(e);
  }

  /** Feeds what is older than the lag and advances the clock. */
  tick(now: number) {
    const cut = now - this.lagMs;
    if (this.buf.length) {
      this.buf.sort(compareEvents);
      let n = 0;
      while (n < this.buf.length && this.buf[n]!.t <= cut) n++;
      const ready = this.buf.splice(0, n);
      for (const e of ready) this.engine.push(e);
    }
    this.engine.advance(cut);
  }

  /** The trace stopped: feed everything and close the open spans. */
  stop(at: number): Span[] {
    this.buf.sort(compareEvents);
    for (const e of this.buf.splice(0)) this.engine.push(e);
    return this.engine.finish(at);
  }

  get spans(): readonly Span[] {
    return this.engine.closed;
  }

  get keyframes(): readonly KeyframeRequest[] {
    return this.engine.keyframes;
  }
}
