// Extension messages of the locator work package (D-128). Entries merge into BgRequestMap and
// ContentCommand in ../messages.ts.
import type { Rect } from '../../events.ts';
import type { LocatorKind, LocatorPacket } from '../../locator.ts';

/** What the reviewer pointed at, in viewport CSS px. One of at, selector, rect or selection. */
export interface LocatorTarget {
  kind?: LocatorKind;
  at?: { x: number; y: number };
  selector?: string;
  rect?: Rect;
  selection?: boolean;
}

export interface LocatorCrop {
  /** PNG at 1x CSS pixels */
  dataUrl: string;
  w: number;
  h: number;
}

/** Extra service-worker requests. */
export interface LocatorBgRequests {
  /**
   * A locator packet for an annotation or element comment: the page's part (target, Svelte dev
   * location), route files from the app's SvelteKit route table, the console errors of the last
   * `errorsSinceMs` (default 60 s) with stacks mapped through the app's source maps, and the crop
   * at 1x CSS pixels unless `crop` is false. The caller hides its own UI before asking.
   */
  'locator.capture': {
    req: LocatorTarget & { tabId?: number; crop?: boolean; errorsSinceMs?: number };
    res: { locator: LocatorPacket; crop: LocatorCrop | null };
  };
}

/** Extra sw -> content commands. Reply: PageLocator from @toolbar/capture, or { error }. */
export type LocatorContentCommand = { type: 'locator.describe'; target: LocatorTarget };
