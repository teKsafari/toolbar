// Interaction spans for the folder: spans.jsonl, "what did not happen" and the timeline. The span
// engine lives in @toolbar/trace (work package p4/trace); this adapter is the one place the folder
// touches it, so the folder still builds (from events alone) where the engine is absent.
import type { CaptureEvent } from '@toolbar/shared';
import type { HandoffSpan } from '@toolbar/shared/areas/handoff';

export type FolderSpan = HandoffSpan & Record<string, unknown>;

export interface SpansResult {
  spans: FolderSpan[];
  outcomes: Record<string, number>;
}

/** Spans of a capture's events, or null while @toolbar/trace is not part of this build. */
export function deriveSpans(_events: readonly CaptureEvent[], _opts: { startedAt?: number; endedAt?: number }): SpansResult | null {
  return null;
}
