// Extension messages of the in-page reviewer toolbar (Part 2). They merge into BgRequestMap in
// ../messages.ts. The worker keeps each tab's unsent items; the page shows them as pins.
import type { Rect, TargetRef } from '../../events.ts';
import type { LocatorPacket } from '../../locator.ts';
import type { FeedbackAnchor, FeedbackContext, FeedbackIntent, FeedbackKind, FeedbackPage, FeedbackSeverity, FeedbackShape } from '../../areas/reviewer.ts';

/** One unsent item as the page sees it (blobs stay in the worker's IndexedDB). */
export interface ReviewItem {
  /** uuid; becomes the server row's clientId */
  id: string;
  n: number;
  kind: FeedbackKind;
  comment: string;
  quote?: string;
  target?: TargetRef;
  /** locator packet from `locator.capture`, taken when the note was made (D-164) */
  locator?: LocatorPacket;
  anchor?: FeedbackAnchor;
  shapes: FeedbackShape[];
  /** highlighted text boxes in document coordinates (kind `text`); drawn on the page only */
  marks?: Rect[];
  /** document rect of the crop */
  cropRect?: Rect;
  cropBlobId?: string;
  voiceBlobId?: string;
  voiceDurationMs?: number;
  context: FeedbackContext;
  page: FeedbackPage;
  intent: FeedbackIntent;
  severity: FeedbackSeverity;
  t: number;
}

/** What the page sends to add an item; the worker numbers it and reads its context. */
export type NewReviewItem = Omit<ReviewItem, 'n' | 'context' | 't' | 'id'> & { id?: string };

export type ReviewPatch = Partial<Pick<ReviewItem, 'comment' | 'intent' | 'severity' | 'voiceBlobId' | 'voiceDurationMs' | 'shapes'>>;

export interface ReviewSubmitResult {
  recordingId: string;
  /** the capture page on the server */
  url: string;
  /** notes sent */
  count: number;
  /** traces sent: the capture is the tab's trace session (kind `trace`), else a new `feedback` capture */
  traces: number;
}

export interface ReviewerBgRequests {
  /** the sender tab's unsent items */
  'review.get': { req: {}; res: { items: ReviewItem[] } };
  /**
   * errors and failed requests of the last 60 s in the sender tab (the composer's count, M-30), and
   * whether the browser lets the extension take screenshots of the tab (D-185)
   */
  'review.context': { req: {}; res: { context: FeedbackContext; shots?: 'ok' | 'blocked' | 'unknown' } };
  /**
   * Screenshot of a viewport rect (CSS px) of the sender tab at 1x CSS pixels. The page hides its
   * own UI first. `preview` is a data URL for the composer.
   */
  'review.shot': { req: { rect: Rect; /** window.innerWidth, for the device-pixel scale */ vw: number }; res: { blobId: string; preview: string; width: number; height: number } };
  /** a note made while a trace runs in the tab also goes into the trace's events as an annotation */
  'review.add': { req: { item: NewReviewItem }; res: { item: ReviewItem } };
  'review.update': { req: { id: string; patch: ReviewPatch }; res: { item: ReviewItem } };
  'review.remove': { req: { id: string }; res: {} };
  /** drop every unsent item of the tab, and discard its trace session */
  'review.clear': { req: {}; res: {} };
  /** voice note through the offscreen document's microphone */
  'review.voice': { req: { op: 'start' | 'stop' | 'cancel' }; res: { recording: boolean; blobId?: string; durationMs?: number } };
  /**
   * Send what the tab holds (D-214). With a trace session: its traces (a running one is stopped
   * first) and the notes, as one capture of kind `trace`. Without: the notes, as a new capture
   * of kind `feedback` with the errors and requests they attached. `description` is the context
   * the reviewer wrote for the whole capture.
   */
  'review.submit': { req: { title?: string; description?: string }; res: { result: ReviewSubmitResult } };
}

/** Worker to page. */
export type ReviewerContentCommand =
  /** the tab's items changed outside this page (another frame, a submit from the list) */
  { type: 'review.changed'; items: ReviewItem[] };
