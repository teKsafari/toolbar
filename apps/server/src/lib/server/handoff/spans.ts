// Interaction spans for the folder: spans.jsonl, "what did not happen" and the timeline. The span
// engine lives in @toolbar/trace; this adapter is the one place the folder touches it.
import type { CaptureEvent } from '@toolbar/shared';
import type { HandoffSpan } from '@toolbar/shared/areas/handoff';
import { deriveTrace, type TraceWindow } from '@toolbar/trace';

export type FolderSpan = HandoffSpan & Record<string, unknown>;

export interface SpansResult {
  spans: FolderSpan[];
  outcomes: Record<string, number>;
}

/** Spans of a capture's events, through the @toolbar/trace engine (D-150); one engine per trace when the capture has traces (D-214). */
export function deriveSpans(
  events: readonly CaptureEvent[],
  opts: { startedAt?: number; endedAt?: number; config?: { maxOpenMs: number }; traces?: readonly TraceWindow[] },
): SpansResult | null {
  const t = deriveTrace(events, opts);
  return { spans: t.spans as unknown as FolderSpan[], outcomes: t.summary.outcomes };
}
