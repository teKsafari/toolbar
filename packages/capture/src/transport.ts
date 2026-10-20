// The only exit of the capture code (architecture section 2). The extension implements it
// with chrome.runtime ports; the embed (packages/embed) implements it with fetch to the server.
import type { CaptureEvent, MaskingPreset } from '@toolbar/shared';
import type { BodyPolicy } from '@toolbar/shared/projects';

export type Command =
  | { type: 'start'; recordingId: string; mode: 'video' | 'screen' | 'replay' | 'screenshot' }
  | { type: 'stop'; recordingId: string }
  | { type: 'snapshot' }
  | { type: 'flush' }
  /** `bodyPolicy`: which request and response bodies the project's preset keeps (D-123) */
  | { type: 'config'; maskingPreset?: MaskingPreset; captureUserEvents?: boolean; bodyPolicy?: BodyPolicy }
  /** stream into a recording from now on: rrweb starts (with a full snapshot) if it is off */
  | { type: 'attach'; recordingId: string; t0: number }
  | { type: 'detach'; recordingId: string }
  /** instant-replay ring: rrweb runs while this is on */
  | { type: 'ring'; enabled: boolean; minutes: number }
  /** rrweb full snapshot now */
  | { type: 'checkout' };

export interface Transport {
  /** Fire and forget, ordered. */
  send(batch: CaptureEvent[]): void;
  /** rrweb events, kept apart from the event stream (architecture s4). `full` when the batch holds a full snapshot. */
  sendRrweb?(batch: unknown[], full: boolean): void;
  /** Page weight for the heavy-page guard (J-011), top frame only, while the replay ring runs. */
  sendPageWeight?(w: { nodes: number; mutationsPerSec: number }): void;
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
  readonly rrweb: unknown[] = [];
  private handlers: ((c: Command) => void)[] = [];
  send(batch: CaptureEvent[]): void {
    this.events.push(...batch);
  }
  sendRrweb(batch: unknown[]): void {
    this.rrweb.push(...batch);
  }
  onCommand(fn: (c: Command) => void): void {
    this.handlers.push(fn);
  }
  command(c: Command): void {
    for (const h of this.handlers) h(c);
  }
}
