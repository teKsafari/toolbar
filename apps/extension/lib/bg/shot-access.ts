// Whether Chrome lets the extension screenshot a tab (D-185). captureVisibleTab needs `<all_urls>`
// or activeTab. Release builds hold `<all_urls>` since D-202, so this matters once the person
// limits the extension's site access in Chrome; a per-site grant is not enough. activeTab comes only
// from the reviewer invoking the extension on the tab: opening its menu (the action or Ctrl+Shift+Y)
// or one of its keyboard commands. It then lasts through same-origin loads of that tab. Waking the
// reviewer toolbar with its in-page keys is a page event, so a reviewer who never opened the menu
// on a tab got no crops, keyframes or card stills there, and nothing said why (real-world run on
// Nuru, docs/real-world/nuru.md). This module remembers per tab what the last capture said, so the
// toolbar can tell the reviewer and the capture's env can tell the agent.

export type ShotAccess = 'ok' | 'blocked' | 'unknown';

/** What the reviewer is told in the toolbar and in a failed element screenshot. */
export const SHOTS_BLOCKED_MESSAGE = 'Chrome blocks screenshots on this tab until you open the open-toolbar menu here once (Ctrl+Shift+Y)';

const state = new Map<number, { access: 'ok' | 'blocked'; at: number }>();

/** Chrome's refusal for want of activeTab or `<all_urls>` (as opposed to the 2-per-second quota). */
export function isShotBlocked(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /activeTab|<all_urls>|all_urls/i.test(msg);
}

export function noteShot(tabId: number, access: 'ok' | 'blocked', now = Date.now()) {
  state.set(tabId, { access, at: now });
}

/** Record the outcome of a failed capture; returns true when it was the permission refusal. */
export function noteShotError(tabId: number, e: unknown, now = Date.now()): boolean {
  if (!isShotBlocked(e)) return false;
  noteShot(tabId, 'blocked', now);
  return true;
}

export function shotAccess(tabId: number): ShotAccess {
  return state.get(tabId)?.access ?? 'unknown';
}

export function forgetShotTab(tabId: number) {
  state.delete(tabId);
}

/**
 * Probe with one capture when the state is unknown, or blocked and older than `retryMs` (the
 * reviewer may have opened the menu since). `capture` runs captureVisibleTab through the shared
 * queue. A quota error leaves the state as it was.
 */
export async function probeShots(tabId: number, capture: () => Promise<unknown>, opts: { now?: number; retryMs?: number } = {}): Promise<ShotAccess> {
  const now = opts.now ?? Date.now();
  const cur = state.get(tabId);
  if (cur?.access === 'ok') return 'ok';
  if (cur?.access === 'blocked' && now - cur.at < (opts.retryMs ?? 5000)) return 'blocked';
  try {
    await capture();
    noteShot(tabId, 'ok', now);
  } catch (e) {
    if (isShotBlocked(e)) noteShot(tabId, 'blocked', now);
  }
  return shotAccess(tabId);
}
