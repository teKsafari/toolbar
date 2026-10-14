// SPA navigations: pushState, replaceState, popstate, hashchange and bfcache restores (J-069).
// Full loads are the `nav` `load` event that startMainWorld emits first, with a cause.
import type { NavCause } from '@toolbar/shared';
import type { HookInstaller } from '../transport.ts';
import { quiet, replaceProp, wrapFn } from './util.ts';

/** Why this document loaded: reload, back/forward, link click, form post or typed address. */
export function navCause(win: Window & typeof globalThis): NavCause {
  try {
    const entry = win.performance?.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined;
    const type = entry?.type;
    if (type === 'reload') return 'reload';
    if (type === 'back_forward') return 'back_forward';
    const ref = win.document.referrer;
    if (ref) {
      try {
        if (new URL(ref).origin === win.location.origin) return 'link';
      } catch {
        /* ignore */
      }
      return 'link';
    }
    return type === 'navigate' ? 'typed' : 'other';
  } catch {
    return 'other';
  }
}

export const installHistoryHook: HookInstaller = (emit, win) => {
  const h = win.history;
  if (!h) return () => {};
  let last = win.location.href;
  const report = (type: 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'bfcache') =>
    quiet(() => {
      const url = win.location.href;
      if (type === 'replaceState' && url === last) return; // same-URL state writes are noise
      emit('nav', { type, url, from: last, ...(win.document.title ? { title: win.document.title } : {}) });
      last = url;
    });
  const restore: (() => void)[] = [];
  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = h[m];
    if (typeof orig !== 'function') continue;
    const wrapped = wrapFn(orig, (target, thisArg, args) => {
      const r = Reflect.apply(target, thisArg, args) as void;
      report(m);
      return r;
    });
    // pushState lives on History.prototype; shadowing it there keeps `history.pushState` own-less.
    restore.push(replaceProp(Object.getPrototypeOf(h) as History, m, wrapped));
  }
  const onPop = () => report('popstate');
  const onHash = () => {
    if (win.location.href !== last) report('hashchange');
  };
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) report('bfcache');
  };
  win.addEventListener('popstate', onPop);
  win.addEventListener('hashchange', onHash);
  win.addEventListener('pageshow', onShow);
  return () => {
    win.removeEventListener('popstate', onPop);
    win.removeEventListener('hashchange', onHash);
    win.removeEventListener('pageshow', onShow);
    for (const r of restore.reverse()) r();
  };
};
