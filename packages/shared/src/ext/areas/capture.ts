// Extension messages the capture area adds. Only the capture area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.
import type { EnvInfo } from '../../events.ts';
import type { CaptureSession } from '../state.ts';

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface CaptureBgRequests {
  /** debug and e2e: ring contents of a tab in a time window (counts only unless `full`) */
  /** dismiss an error session (stop timeout, media or upload failure) back to idle; a new capture also dismisses it */
  'session.dismiss': { req: {}; res: { session: CaptureSession } };
  'capture.ring': { req: { tabId?: number; sinceMs?: number; full?: boolean }; res: { events: number; rrweb: number; kinds: Record<string, number>; slice?: { events: unknown[]; rrweb: unknown[] } } };
}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type CaptureContentCommand =
  /** ask the page for window.toolbar.setMetadata output (J-073); reply { value?, error? } */
  | { type: 'capture.metadata' }
  /** page env info (viewport, connection, battery) at capture time; reply { env } */
  | { type: 'capture.env' }
  /** commit typed values and flush batches now (before a slice is read); reply { ok } */
  | { type: 'capture.flush' };

export type CaptureEnvReply = { env: EnvInfo | null };
