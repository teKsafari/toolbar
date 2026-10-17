// Sites from the extension icon (D-205). In the `projects` mode (the default, D-203) the popup on
// a page outside the projects offers one row: the host, a project picker and Add. Add asks the
// server to put the page's origin in that project (or a new one named after the host), refreshes
// the project list, registers the capture scripts for the origin and injects them into the tab, so
// the toolbar appears without a reload. "Remove this site" takes the origin out again (workspace
// admins, or whoever added it). The pill's X closes the toolbar on an origin (TOOLBAR_CLOSED_KEY);
// a click on the extension icon there shows it again (`toolbar.show`, sent by the popup).
import { browser } from 'wxt/browser';
import { API_PREFIX } from '@toolbar/shared/constants';
import { isRestrictedUrl, RECENT_PROJECT_KEY, TOOLBAR_CLOSED_KEY, toolbarClosedOn } from '@toolbar/shared/areas/ext-ui';
import type { BgError, SiteAdd } from '@toolbar/shared/ext';
import { pageOrigin, projectForUrl } from '@toolbar/shared/projects';
import { authClient, readStore, serverUrl } from '../auth/chrome';
import { captureCreatedHooks } from '../upload/client';
import { ensureContent, syncRegistration } from '../registration';
import { projects as projectList, type Scope } from '../scope';

class SiteFailure extends Error {
  constructor(
    readonly code: BgError,
    message: string,
  ) {
    super(message);
  }
}

async function local<T>(key: string): Promise<T | null> {
  try {
    return ((await browser.storage.local.get(key))[key] as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Remember the project a site was last added to or captured in. */
async function setRecent(projectId: string) {
  await browser.storage.local.set({ [RECENT_PROJECT_KEY]: projectId }).catch(() => undefined);
}

/** Show (or hide) the toolbar on an origin. Every tab on it follows through storage.onChanged. */
export async function setToolbarClosed(origin: string, closed: boolean) {
  const map = { ...((await local<Record<string, number>>(TOOLBAR_CLOSED_KEY)) ?? {}) };
  if (closed === !!map[origin]) return;
  if (closed) map[origin] = Date.now();
  else delete map[origin];
  await browser.storage.local.set({ [TOOLBAR_CLOSED_KEY]: map });
}

async function isServerOrigin(origin: string | null): Promise<boolean> {
  if (!origin) return false;
  try {
    return new URL(await serverUrl()).origin === origin;
  } catch {
    return false;
  }
}

/**
 * The popup's facts about a page (D-205): the add row on a page outside the projects in the
 * `projects` mode, whether the person may remove its origin, and whether the toolbar is closed there.
 */
export async function siteFacts(sc: Scope, url: string | null): Promise<{ origin: string | null; add: SiteAdd | null; removable: boolean; closed: boolean }> {
  const origin = url && !isRestrictedUrl(url) ? pageOrigin(url) : null;
  const closed = toolbarClosedOn(await local(TOOLBAR_CLOSED_KEY), origin);
  if (!origin || !sc.signedIn || sc.mode === 'test' || (await isServerOrigin(origin))) return { origin, add: null, removable: false, closed };
  const boot = await readStore('bootstrap');
  const workspaces = boot?.data.workspaces ?? [];
  const canAdd = new Set(boot?.data.siteAccess?.canAdd ?? []);
  const project = projectForUrl(sc.projects, url);
  if (project) {
    const admin = workspaces.find((w) => w.id === project.workspaceId)?.role === 'admin';
    const exact = project.origins.includes(origin);
    return { origin, add: null, removable: exact && (admin || !!project.mine?.includes(origin)), closed };
  }
  // no project list yet (just signed in): the popup shows the host until it arrives
  if (sc.mode !== 'projects' || !boot) return { origin, add: null, removable: false, closed };
  const recent = await local<string>(RECENT_PROJECT_KEY);
  const nameOf = new Map(workspaces.map((w) => [w.id, w.name]));
  const list = sc.projects
    .filter((p) => canAdd.has(p.workspaceId))
    .map((p) => ({ id: p.id, name: p.name, workspaceId: p.workspaceId, workspaceName: nameOf.get(p.workspaceId) ?? '' }))
    .sort((a, b) => Number(b.id === recent) - Number(a.id === recent));
  const active = sc.activeWorkspaceId && canAdd.has(sc.activeWorkspaceId) ? sc.activeWorkspaceId : (workspaces.find((w) => canAdd.has(w.id))?.id ?? null);
  return {
    origin,
    add: { projects: list, recentProjectId: list.some((p) => p.id === recent) ? recent : null, newProjectWorkspaceId: active, denied: !canAdd.size },
    removable: false,
    closed,
  };
}

async function errorOf(res: Response, fallback: string): Promise<SiteFailure> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  const code: BgError = res.status === 403 ? 'permission_denied' : res.status === 404 ? 'not_found' : res.status === 422 || res.status === 400 ? 'invalid' : 'server';
  return new SiteFailure(code, body?.message ?? fallback);
}

async function tabOrigin(tabId: number): Promise<{ url: string; origin: string }> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const url = tab?.url ?? '';
  const origin = !isRestrictedUrl(url) ? pageOrigin(url) : null;
  if (!origin) throw new SiteFailure('restricted_page', 'Open a web page first');
  if (await isServerOrigin(origin)) throw new SiteFailure('invalid', 'This is your server');
  return { url, origin };
}

async function addSite(tabId: number, projectId: string | null) {
  const { url, origin } = await tabOrigin(tabId);
  const boot = await readStore('bootstrap');
  const auth = await readStore('auth');
  if (!auth?.token || !boot) throw new SiteFailure('not_signed_in', 'Sign in first');
  const project = projectId ? (boot.data.projects ?? []).find((p) => p.id === projectId) : null;
  if (projectId && !project) throw new SiteFailure('not_found', 'That project is gone');
  const canAdd = boot.data.siteAccess?.canAdd ?? [];
  const active = auth.activeWorkspaceId ?? boot.data.activeWorkspaceId;
  const workspaceId = project?.workspaceId ?? (active && canAdd.includes(active) ? active : canAdd[0]);
  if (!workspaceId) throw new SiteFailure('permission_denied', 'Only workspace admins add sites');
  const res = await authClient.authFetch(`${API_PREFIX}/workspaces/${workspaceId}/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(projectId ? { origin, projectId } : { origin }),
  });
  if (!res.ok) throw await errorOf(res, 'Could not add the site');
  const out = (await res.json()) as { project: { id: string; name: string } };
  await setRecent(out.project.id);
  await setToolbarClosed(origin, false);
  // the new project list registers the scripts for the origin; then the open tab gets them now
  await authClient.bootstrap().catch(() => undefined);
  await syncRegistration().catch(() => undefined);
  if (!(await ensureContent(tabId))) console.warn('[toolbar] the toolbar did not start on', url);
  return { projectId: out.project.id, projectName: out.project.name };
}

async function removeSite(tabId: number) {
  const { url, origin } = await tabOrigin(tabId);
  const project = projectForUrl(await projectList(), url);
  if (!project) throw new SiteFailure('not_found', 'This site is in no project');
  const res = await authClient.authFetch(`${API_PREFIX}/projects/${project.id}/sites?origin=${encodeURIComponent(origin)}`, { method: 'DELETE' });
  if (!res.ok) throw await errorOf(res, 'Could not remove the site');
  await authClient.bootstrap().catch(() => undefined);
  await syncRegistration().catch(() => undefined);
  // the scripts already running in open tabs of the origin stay until those tabs reload
  return {};
}

async function showToolbar(tabId: number) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const origin = tab?.url ? pageOrigin(tab.url) : null;
  if (origin) await setToolbarClosed(origin, false);
  return {};
}

type Handler = (req: Record<string, unknown>) => Promise<object>;
const handlers: Record<string, Handler> = {
  'site.add': (req) => addSite(Number(req.tabId), (req.projectId as string | null) ?? null),
  'site.remove': (req) => removeSite(Number(req.tabId)),
  'toolbar.show': (req) => showToolbar(Number(req.tabId)),
};

export function registerSites() {
  browser.runtime.onMessage.addListener(((msg: { type?: string } & Record<string, unknown>, _sender: unknown, reply: (r: unknown) => void) => {
    const h = msg?.type ? handlers[msg.type] : undefined;
    if (!h) return false;
    h(msg).then(
      (res) => reply({ ok: true, ...res }),
      (e: unknown) => {
        const code = e instanceof SiteFailure ? e.code : (e as { code?: string })?.code === 'not_signed_in' ? 'not_signed_in' : 'server';
        reply({ ok: false, error: code, message: e instanceof Error ? e.message : String(e) });
      },
    );
    return true;
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

  // the most recently used project: the one a capture just went to
  captureCreatedHooks.add((pageUrl) => {
    void projectList().then((list) => {
      const p = projectForUrl(list, pageUrl);
      if (p) void setRecent(p.id);
    });
  });
}
