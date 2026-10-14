// The only exit of the capture code (architecture section 2). The extension implements it
// with chrome.runtime ports; the Part 2 injector implements it with fetch to the server.
import type { CaptureEvent } from '@toolbar/shared';

export type Command =
  | { type: 'start'; recordingId: string; mode: 'video' | 'screen' | 'replay' | 'screenshot' }
  | { type: 'stop'; recordingId: string }
  | { type: 'snapshot' }
  | { type: 'flush' }
  | { type: 'config'; maskingPreset?: 'staging' | 'production' | 'none'; captureUserEvents?: boolean };

export interface Transport {
  /** Fire and forget, ordered. */
  send(batch: CaptureEvent[]): void;
  /** start/stop/snapshot from the host. */
  onCommand(fn: (c: Command) => void): void;
}

/** What a hook installer gets: a typed emitter that stamps the envelope. */
export type Emit = <K extends CaptureEvent['kind']>(kind: K, data: Extract<CaptureEvent, { kind: K }>['data']) => void;

/** Every installer returns a function that restores the original globals. */
export type Uninstall = () => void;
export type HookInstaller = (emit: Emit, win: Window & typeof globalThis) => Uninstall;

/** A Transport that keeps everything in memory. For tests and for the page-side ring. */
export class MemoryTransport implements Transport {
  readonly events: CaptureEvent[] = [];
  private handlers: ((c: Command) => void)[] = [];
  send(batch: CaptureEvent[]): void {
    this.events.push(...batch);
  }
  onCommand(fn: (c: Command) => void): void {
    this.handlers.push(fn);
  }
  command(c: Command): void {
    for (const h of this.handlers) h(c);
  }
}
