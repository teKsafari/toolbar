// Keeps the capture scripts registered for exactly the granted project origins (D-126): on
// worker start, on sign-in and sign-out, when the bootstrap's project list changes, and when the
// person grants or removes a site. Also keeps the project list fresh, and registers the server
// page script for a server set on the options page. background.ts calls registerScope() once.
import { browser } from 'wxt/browser';
import { STORAGE, type StorageValues } from '@toolbar/shared/ext';
import { syncRegistration } from '../registration';
import { TEST_SCOPE_KEY } from '../scope';
import { authClient, readStore, serverUrl } from '../auth/chrome';
import { resolveServerUrl } from '../server-url';

const REFRESH_ALARM = 'tb-projects-refresh';
/** Project changes reach a signed-in extension within this long, or at the next popup open. */
const REFRESH_MIN = 10;
const SERVER_SCRIPT_ID = 'toolbar-web-server';

async function refreshProjects(force = false) {
  const auth = await readStore('auth');
  if (!auth?.token) return;
  const cached = (await readStore('bootstrap')) as StorageValues['bootstrap'];
  if (!force && cached && Date.now() - cached.at < REFRESH_MIN * 60_000) return;
  await authClient.bootstrap().catch(() => undefined); // storage.onChanged then re-syncs
}

/**
 * The static server-page script matches the build's server only. A server chosen on the options
 * page (granted there) gets the same script registered at runtime.
 */
async function syncServerScript() {
  const built = new URL(resolveServerUrl(null)).origin;
  let origin: string | null = null;
  try {
    origin = new URL(await serverUrl()).origin;
  } catch {
    /* keep null */
  }
  const want = origin && origin !== built && (await browser.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false)) ? `${origin}/*` : null;
  const existing = (await browser.scripting.getRegisteredContentScripts({ ids: [SERVER_SCRIPT_ID] }).catch(() => []))[0];
  if (!want) {
    if (existing) await browser.scripting.unregisterContentScripts({ ids: [SERVER_SCRIPT_ID] }).catch(() => undefined);
    return;
  }
  const def = { id: SERVER_SCRIPT_ID, js: ['content-scripts/toolbar-web.js'], matches: [want], runAt: 'document_start' as const, persistAcrossSessions: true };
  if (existing) await browser.scripting.updateContentScripts([def]).catch(() => undefined);
  else await browser.scripting.registerContentScripts([def]).catch(() => undefined);
}

export function registerScope() {
  const sync = () => void syncRegistration().catch((e: unknown) => console.error('[toolbar] content script registration failed', e));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE.auth.key] || changes[STORAGE.bootstrap.key] || changes[TEST_SCOPE_KEY]) sync();
    if (changes[STORAGE.serverUrl.key]) void syncServerScript();
  });
  browser.permissions.onAdded.addListener(() => {
    sync();
    void syncServerScript();
  });
  browser.permissions.onRemoved.addListener(() => {
    sync();
    void syncServerScript();
  });
  browser.alarms?.onAlarm.addListener((a) => {
    if (a.name === REFRESH_ALARM) void refreshProjects();
  });
  try {
    void browser.alarms?.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MIN });
  } catch {
    /* alarms permission */
  }
  void refreshProjects();
  void syncServerScript();
}
