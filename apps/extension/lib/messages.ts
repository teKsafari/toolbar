// Messages between extension contexts. One union per direction keeps routing typed.
import type { CaptureEvent } from '@toolbar/shared';

export const CAPTURE_PORT = 'capture';

/** Content script (isolated world) -> service worker, over the "capture" port. */
export type PortMessage = { type: 'events'; batch: CaptureEvent[] } | { type: 'hello'; url: string; top: boolean };

/** Popup or command -> service worker (runtime.sendMessage). */
export type BgRequest =
  | { type: 'capture'; mode: 'screenshot' | 'video' | 'replay' | 'link' }
  | { type: 'status' };

/** Service worker -> offscreen document. */
export type OffscreenRequest =
  | { to: 'offscreen'; type: 'record-tab'; streamId: string; recordingId: string; w: number; h: number }
  | { to: 'offscreen'; type: 'record-screen'; recordingId: string }
  | { to: 'offscreen'; type: 'stop'; recordingId: string }
  | { to: 'offscreen'; type: 'ping' };
