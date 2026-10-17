// How the capture page adapts to what a capture holds (D-206): which dev tools tabs have entries,
// whether the capture is "lean" (nothing for the dev tools pane, so the pane starts collapsed and
// the page facts move into a strip at the top), and the window of one feedback note's context.
// Plain functions, so the unit tests need no component.
import type { CaptureEvent } from '@toolbar/shared';
import type { CaptureDetail } from '@toolbar/shared/api';
import type { FeedbackContext } from '@toolbar/shared/areas/reviewer';

export type DataTab = 'console' | 'network' | 'actions';
export type TabCounts = Record<DataTab, number>;

/** Entries per data tab from the event index, before the events file has loaded. */
export function countsFromIndex(detail: Pick<CaptureDetail, 'index'>): TabCounts {
  const ix = detail.index;
  const consoleEvents = Object.values(ix.console).reduce((a, n) => a + (n ?? 0), 0);
  const user = ix.user.clicks + ix.user.inputs + ix.user.keys;
  return {
    console: consoleEvents + (ix.counts.error ?? 0) + ix.user.navigations + user + ix.network.failed + (ix.counts.media ?? 0),
    network: ix.network.total,
    actions: ix.user.navigations + user,
  };
}

/** A tab shows when it has entries; Info and Agent always show. */
export function tabVisible(tab: string, counts: TabCounts): boolean {
  return tab === 'console' || tab === 'network' || tab === 'actions' ? counts[tab] > 0 : true;
}

/** The tab to show: the chosen one while it is visible, else the first data tab with entries, else Info. */
export function activeTab<T extends string>(chosen: T, counts: TabCounts): T | DataTab | 'info' {
  if (tabVisible(chosen, counts)) return chosen;
  return (['console', 'network', 'actions'] as const).find((t) => counts[t] > 0) ?? 'info';
}

/**
 * A capture with no video, DOM replay or trace and nothing for the console, network or actions
 * tabs: typically a comment-only feedback. Its page starts with the pane collapsed.
 */
export function isLean(detail: Pick<CaptureDetail, 'kind' | 'media'>, counts: TabCounts): boolean {
  if (detail.media.video || detail.media.rrwebUrls.length) return false;
  if (detail.kind === 'trace' || detail.kind === 'replay' || detail.kind === 'video' || detail.kind === 'screen') return false;
  return counts.console + counts.network + counts.actions === 0;
}

/** The facts of the info strip: page URL, browser, OS and viewport, each only when known. */
export function stripFacts(detail: Pick<CaptureDetail, 'pageUrl' | 'env'>): { label: string; value: string; href?: string }[] {
  const env = detail.env;
  const url = detail.pageUrl ?? env?.url ?? null;
  const out: { label: string; value: string; href?: string }[] = [];
  if (url) out.push({ label: 'URL', value: url, ...(/^https?:\/\//.test(url) ? { href: url } : {}) });
  if (env?.browser) out.push({ label: 'Browser', value: `${env.browser.name} ${env.browser.version}`.trim() });
  const os = env?.os ? `${env.os.name}${env.os.version ? ` ${env.os.version}` : ''}` : (env?.platform ?? null);
  if (os) out.push({ label: 'OS', value: os });
  if (env?.viewport) out.push({ label: 'Viewport', value: `${env.viewport.w} x ${env.viewport.h}` });
  return out;
}

/** The window one feedback note's context was read from, and the events it attached. */
export interface NoteWindow {
  /** pin number of the note */
  n: number;
  /** epoch ms, inclusive */
  from: number;
  to: number;
  /** console and error event ids, and net.res or net.fail ids, of the attached entries */
  ids: Set<string>;
  /** request ids of the attached failed requests */
  rids: Set<string>;
  /** which entries the chip named, for the tab to open */
  show: 'errors' | 'requests';
}

/**
 * The note's window (its `windowMs` before the note, plus the second the extension also reads
 * after it) and the entries it attached, matched by event id, else by time and text.
 */
export function noteWindow(item: { n: number; t: number; context?: FeedbackContext | null }, events: readonly CaptureEvent[], show: NoteWindow['show']): NoteWindow {
  const ctx = item.context;
  const windowMs = ctx?.windowMs ?? 60_000;
  const from = item.t - windowMs;
  const to = item.t + 1000;
  const ids = new Set<string>();
  const rids = new Set<string>();
  const entries = ctx ? [...ctx.errors, ...ctx.failedRequests] : [];
  const byId = new Map(events.map((e) => [e.id, e]));
  for (const c of entries) {
    let e = c.ref ? byId.get(c.ref) : undefined;
    // entries without a ref (or one the events do not hold): the event of the same kind at the same time
    if (!e)
      e = events.find(
        (x) =>
          x.t === c.t &&
          (c.kind === 'network' ? x.kind === 'net.res' || x.kind === 'net.fail' : c.kind === 'error' ? x.kind === 'error' : x.kind === 'console'),
      );
    if (!e) continue;
    ids.add(e.id);
    if (e.kind === 'net.res' || e.kind === 'net.fail') rids.add((e.data as { rid: string }).rid);
  }
  return { n: item.n, from, to, ids, rids, show };
}

/** Is a row at wall time `t` inside the note window (or is there none)? */
export const inWindow = (w: NoteWindow | null, t: number) => !w || (t >= w.from && t <= w.to);
