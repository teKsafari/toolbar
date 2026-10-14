// Page weight for the instant-replay heavy-page guard (J-011): element count and DOM mutation
// records per second, measured in the top frame while the replay ring runs. The worker compares
// them with its thresholds and pauses the ring on a heavy page until the person continues.
import { UI_HOST_TAG } from '@toolbar/shared/constants';

export interface PageWeight {
  nodes: number;
  mutationsPerSec: number;
}

export interface PageWeightOptions {
  /** first report this long after start, so a page that is still loading settles a little */
  firstMs?: number;
  /** later reports at this interval */
  everyMs?: number;
}

/** Element count of a document, without our own UI host. */
export function countNodes(doc: Document): number {
  const all = doc.getElementsByTagName('*').length;
  const host = doc.querySelector(UI_HOST_TAG);
  return host ? all - 1 - host.getElementsByTagName('*').length : all;
}

/**
 * Reports `{ nodes, mutationsPerSec }` once after `firstMs` and then every `everyMs` until stopped.
 * Mutations inside the toolbar host do not count.
 */
export function watchPageWeight(report: (w: PageWeight) => void, win: Window & typeof globalThis = window, opts: PageWeightOptions = {}) {
  const firstMs = opts.firstMs ?? 1500;
  const everyMs = opts.everyMs ?? 5000;
  let records = 0;
  let since = Date.now();
  const mo = new win.MutationObserver((list) => {
    for (const r of list) {
      const el = (r.target.nodeType === 1 ? r.target : r.target.parentElement) as Element | null;
      if (el && (el.tagName?.toLowerCase() === UI_HOST_TAG || el.closest?.(UI_HOST_TAG))) continue;
      records++;
    }
  });
  const root = win.document.documentElement ?? win.document;
  mo.observe(root, { childList: true, subtree: true, attributes: true, characterData: true });
  const send = () => {
    const now = Date.now();
    const secs = Math.max(0.001, (now - since) / 1000);
    report({ nodes: countNodes(win.document), mutationsPerSec: Math.round(records / secs) });
    records = 0;
    since = now;
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    send();
    interval = setInterval(send, everyMs);
  }, firstMs);
  return {
    /** report now (tests, and the worker asking again) */
    now: send,
    stop() {
      clearTimeout(first);
      if (interval) clearInterval(interval);
      mo.disconnect();
    },
  };
}
