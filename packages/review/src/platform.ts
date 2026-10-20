// The reviewer toolbar's one way out (D-212). The toolbar (state.svelte.ts and the components)
// never calls chrome.* or fetch itself: every request, stored setting and capability goes
// through the ReviewPlatform set before it mounts. The extension supplies one backed by its
// service worker and chrome.storage (apps/extension/lib/review-platform.ts); the embed supplies
// one that does the same work in the page (packages/embed/src/platform.ts).
import type { BgError, BgRequestMap, LocatorBgRequests, ReviewSubmitResult, ReviewerBgRequests } from '@toolbar/shared/ext';

/** A running trace as the toolbar shows it. */
export interface ReviewTrace {
  recordingId: string;
  startedAt: number;
  /** actions closed so far, where the platform counts them live */
  spans?: number;
}

/**
 * Requests the toolbar makes: the reviewer area, the locator packet, the microphone prompt and
 * traces. The extension answers them with its BgRequestMap entries of the same names, whose
 * results are wider than these.
 */
export interface ReviewRequestMap extends ReviewerBgRequests, LocatorBgRequests {
  'mic.request': BgRequestMap['mic.request'];
  'trace.get': { req: {}; res: { trace: ReviewTrace | null } };
  'trace.start': { req: {}; res: { trace: ReviewTrace } };
  /** `spans` absent: the platform does not count actions (the server derives them) */
  'trace.stop': { req: { open?: boolean }; res: { result: { recordingId: string; spans?: number } } };
}
export type ReviewRequestType = keyof ReviewRequestMap;
export type ReviewFailure = { ok: false; error: BgError; message?: string };
export type ReviewResult<K extends ReviewRequestType> = ({ ok: true } & ReviewRequestMap[K]['res']) | ReviewFailure;

/** Small JSON values the toolbar keeps across reloads (dock position, closed sites). */
export interface ReviewStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  /** `key` changed elsewhere (another tab); returns the unsubscribe */
  onChange(key: string, fn: (value: unknown) => void): () => void;
}

/** Who leaves the notes, where the platform asks (the embed: no account, an optional name). */
export interface ReviewerIdentity {
  /** the remembered name, and whether the composer still asks for it */
  load(): Promise<{ name: string; ask: boolean }>;
  /** the name typed in the composer (may be empty); the composer stops asking */
  save(name: string): Promise<void>;
}

export interface ReviewPlatform {
  /** never rejects: a missing handler answers `not_implemented` */
  request<K extends ReviewRequestType>(type: K, req: ReviewRequestMap[K]['req']): Promise<ReviewResult<K>>;
  storage: ReviewStorage;
  /** URL of a bundled file (the OFL fonts) */
  assetUrl(file: string): string;
  /** the success toast's Open; absent where the reviewer cannot open the capture */
  openCapture?: (result: ReviewSubmitResult) => void;
  reviewer?: ReviewerIdentity;
  caps: {
    /** element, text and drawing crops (`review.shot`) */
    canScreenshot: boolean;
  };
}

let current: ReviewPlatform | null = null;

export function setPlatform(p: ReviewPlatform | null): void {
  current = p;
}

export function platform(): ReviewPlatform {
  if (!current) throw new Error('review platform not set');
  return current;
}
