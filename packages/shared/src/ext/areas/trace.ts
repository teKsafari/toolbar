// Extension messages of Part 2 traces. Entries merge into BgRequestMap in ../messages.ts.
//
// A trace session (D-214) is the tab's unsent trace capture: one or more traces, each from a
// Start trace to its Stop trace, with a note per trace. Stop keeps the trace in the session;
// nothing goes to the reviewer's team until `review.submit` sends the session with the tab's
// notes, a title and the context the reviewer wrote. `review.clear` discards it.

/** One trace of a session. */
export interface TraceTakeState {
  /** 1-based, kept when an earlier trace is removed */
  n: number;
  startedAt: number;
  /** null while it runs */
  endedAt: number | null;
  /** what the reviewer wrote about this trace */
  note: string;
  /** page at the start of the trace */
  url: string;
  title: string;
  /** actions closed so far, by outcome (the worker's live engine) */
  spans: number;
  outcomes: Record<string, number>;
}

/** The tab's trace session. */
export interface TraceState {
  /** Server capture id (kind `trace`), made at the first Start trace. */
  recordingId: string;
  tabId: number;
  /** in order; the last one runs when its endedAt is null */
  takes: TraceTakeState[];
  keyframes: number;
}

export interface TraceBgRequests {
  /** Start a trace in a tab (default: the active tab): the first one opens the session. Needs a signed-in extension. */
  'trace.start': { req: { tabId?: number }; res: { trace: TraceState } };
  /** Stop the running trace: its events and replay are queued, and it stays in the session. */
  'trace.stop': { req: {}; res: { trace: TraceState } };
  /** The session of the sender's tab (a page), or of any tab (the popup); null when there is none. */
  'trace.get': { req: {}; res: { trace: TraceState | null } };
  /** Set a trace's note. */
  'trace.note': { req: { n: number; note: string }; res: { trace: TraceState } };
  /** Bring the session's tab to the front (the popup, from another tab). */
  'trace.focus': { req: {}; res: {} };
  /** Remove a trace (a running one is stopped first). Removing the last one discards the session. */
  'trace.remove': { req: { n: number }; res: { trace: TraceState | null } };
}
