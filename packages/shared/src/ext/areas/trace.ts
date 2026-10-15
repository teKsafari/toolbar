// Extension messages of Part 2 traces ("Start trace" and "Stop trace"). Entries merge into
// BgRequestMap in ../messages.ts.

/** A trace running in one tab. */
export interface TraceState {
  /** Server capture id (kind `trace`). */
  recordingId: string;
  tabId: number;
  startedAt: number;
  url: string;
  title: string;
  /** Spans closed so far, by outcome (live, from the worker's engine). */
  spans: number;
  outcomes: Record<string, number>;
  keyframes: number;
}

export interface TraceResult {
  recordingId: string;
  shareUrl: string;
  spans: number;
  outcomes: Record<string, number>;
  durationMs: number;
}

export interface TraceBgRequests {
  /** Start a trace of a tab (default: the active tab). Needs a signed-in extension. */
  'trace.start': { req: { tabId?: number }; res: { trace: TraceState } };
  /** Stop the running trace: uploads its events and replay, finalizes the capture. */
  'trace.stop': { req: { open?: boolean }; res: { result: TraceResult } };
  /** The running trace, or null. */
  'trace.get': { req: {}; res: { trace: TraceState | null } };
}
