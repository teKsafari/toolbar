// Per-viewer preferences (playback speed, time zone, last tab, panel open). Kept in localStorage
// so they also work signed out, and mirrored to /api/v1/me/settings (viewer group) when signed in.
import { DEFAULT_USER_SETTINGS, type UserSettings } from '@toolbar/shared/api';
import { call } from './api.ts';

export type ViewerPrefs = UserSettings['viewer'];
const KEY = 'tb.viewer.prefs';

export function loadPrefs(): ViewerPrefs {
  const base = { ...DEFAULT_USER_SETTINGS.viewer };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(base, JSON.parse(raw) as Partial<ViewerPrefs>);
  } catch {
    /* private mode */
  }
  return base;
}

let pending: Partial<ViewerPrefs> = {};
let timer: ReturnType<typeof setTimeout> | undefined;

export function savePrefs(patch: Partial<ViewerPrefs>, signedIn: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* private mode */
  }
  if (!signedIn) return;
  pending = { ...pending, ...patch };
  clearTimeout(timer);
  timer = setTimeout(() => {
    const viewer = pending;
    pending = {};
    void call('account.updateSettings', {}, { viewer }).catch(() => {});
  }, 500);
}
