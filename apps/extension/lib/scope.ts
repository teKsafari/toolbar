// Where the extension runs (PLAN "Zero integration", D-123, D-126, D-200, D-202). The manifest
// holds every site as a required host permission (D-202), so Chrome grants it at install and an
// admin's force-install needs no prompt. That access is not where the extension runs: the server's
// bootstrap names the site access mode, and this module decides.
//
// - `projects` (default, D-126, D-203): the scripts are registered for the project origins only,
//   and the worker records no webRequest metadata for a tab on any other page
//   (lib/capture/service.ts). The popup adds a site to a project (lib/bg/sites.ts, D-205).
// - `all` (an admin's opt-in, D-200): the capture scripts are registered everywhere but the server
//   itself and the domains on the blocked-sites list (J-012). A page with no project yet uses its
//   workspace's new-project defaults; the server makes the project at the first capture.
//
// The person can still turn site access off in the browser (Chrome's Site access, Firefox's
// Permissions tab). Then `allSites` is false, the popup asks again from a click, and in the strict
// mode only the project origins still granted count.
//
// Test builds (WXT_TEST_HOOKS=1) register the capture scripts everywhere, as Part 1 did, unless
// storage key `tb:test-scope` says otherwise: 'projects' forces the strict mode (the
// zero-integration specs), 'release' follows the server's mode as a release build does.
import { browser } from 'wxt/browser';
import { STORAGE, type AuthState, type StorageValues } from '@toolbar/shared/ext';
import { allOrigins, bodyPolicyOf, matchPatternOf, OPEN_BODY_POLICY, originMatches, pageOrigin, projectForUrl, type BodyPolicy, type ProjectPreset, type ProjectScope } from '@toolbar/shared/projects';
import { DEFAULT_REPLAY_BLOCKED_SITES, isReplayBlocked } from '@toolbar/shared/areas/ext-ui';
import type { MaskingPreset } from '@toolbar/shared/events';
import { TEST_HOOKS } from './flags';
import { accountServerUrl } from './server-url';

export const TEST_SCOPE_KEY = 'tb:test-scope';
export const ALL_SITES = ['<all_urls>'];
/** Every http(s) site: where `all` mode registers, and what the popup asks for again if the person turned access off (D-200, D-202). */
export const ALL_SITE_PATTERNS = ['http://*/*', 'https://*/*'];

/**
 * 'test': a test build in Part 1 mode, every site; 'all': all sites with a project per origin
 * (D-200); 'projects': the strict mode, project origins only (D-126).
 */
export type ScopeMode = 'test' | 'all' | 'projects';

export interface Scope {
  mode: ScopeMode;
  signedIn: boolean;
  projects: ProjectScope[];
  /** strict mode: project origins with host permission */
  granted: string[];
  /** strict mode: project origins still without host permission */
  missing: string[];
  /** `all` mode: Chrome granted every site */
  allSites: boolean;
  /** `all` mode: the server's own origin, never captured */
  serverOrigin: string | null;
  /** `all` mode: domains of the blocked-sites list (J-012), where no capture script runs */
  blocked: string[];
  /** masking preset and step window a new project of each workspace starts with */
  defaults: { workspaceId: string; maskingPreset: ProjectPreset; traceOpenMs: number }[];
  /** where a capture outside every project goes, so its preset is that workspace's default */
  activeWorkspaceId: string | null;
}

async function local<K extends 'auth' | 'bootstrap' | 'settings'>(k: K): Promise<StorageValues[K] | null> {
  const { key } = STORAGE[k];
  try {
    return ((await browser.storage.local.get(key))[key] as StorageValues[K] | undefined) ?? null;
  } catch {
    return null;
  }
}

async function testScope(): Promise<'test' | 'projects' | 'release'> {
  if (!TEST_HOOKS) return 'release';
  try {
    const v = (await browser.storage.local.get(TEST_SCOPE_KEY))[TEST_SCOPE_KEY];
    return v === 'projects' || v === 'release' ? v : 'test';
  } catch {
    return 'test';
  }
}

/** The signed-in user's projects, from the cached bootstrap; none when signed out. */
export async function projects(): Promise<ProjectScope[]> {
  const auth = (await local('auth')) as AuthState | null;
  if (!auth?.token) return [];
  return (await local('bootstrap'))?.data.projects ?? [];
}

async function has(patterns: string[]): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: patterns });
  } catch {
    return false;
  }
}

export async function scope(): Promise<Scope> {
  const [test, auth, boot, settings] = await Promise.all([testScope(), local('auth'), local('bootstrap'), local('settings')]);
  const signedIn = !!(auth as AuthState | null)?.token;
  const list = signedIn ? (boot?.data.projects ?? []) : [];
  const site = signedIn ? boot?.data.siteAccess : undefined;
  const mode: ScopeMode = test === 'test' ? 'test' : test === 'projects' ? 'projects' : (site?.mode ?? 'projects');
  const activeWorkspaceId = (auth as AuthState | null)?.activeWorkspaceId ?? boot?.data.activeWorkspaceId ?? null;
  const base = { mode, signedIn, projects: list, defaults: site?.defaults ?? [], activeWorkspaceId, granted: [] as string[], missing: [] as string[], allSites: false, serverOrigin: null as string | null, blocked: [] as string[] };
  if (mode === 'test') return base;
  if (mode === 'all') {
    const replayBlocked = (settings as { replayBlockedSites?: string[] } | null)?.replayBlockedSites;
    return {
      ...base,
      allSites: await has(ALL_SITE_PATTERNS),
      serverOrigin: pageOrigin(await accountServerUrl(auth as AuthState | null)),
      // the list as stored, or the shipped defaults before the person changed it (lib/bg/ui.ts)
      blocked: replayBlocked ?? [...DEFAULT_REPLAY_BLOCKED_SITES],
    };
  }
  const origins = allOrigins(list);
  const ok = await Promise.all(origins.map((o) => has([matchPatternOf(o)])));
  return { ...base, granted: origins.filter((_, i) => ok[i]), missing: origins.filter((_, i) => !ok[i]) };
}

/** Match patterns the capture scripts are registered for under this scope. */
export function patternsOf(s: Scope): string[] {
  if (s.mode === 'test') return ALL_SITES;
  if (s.mode === 'all') return s.signedIn && s.allSites ? ALL_SITE_PATTERNS : [];
  return s.granted.map(matchPatternOf);
}

/** Match patterns no capture script runs on (`all` mode): the server, and the blocked sites with their subdomains. */
export function excludesOf(s: Scope): string[] {
  if (s.mode !== 'all') return [];
  const out = s.serverOrigin ? [matchPatternOf(s.serverOrigin)] : [];
  for (const d of s.blocked) out.push(`*://${d}/*`, `*://*.${d}/*`);
  return out;
}

/** Why the extension does not run on `url`, or null when it may. */
export function outOfScope(s: Scope, url: string | null | undefined): 'restricted' | 'signed-out' | 'needs-all-sites' | 'server' | 'blocked' | 'not-in-project' | null {
  if (!url || !/^https?:/i.test(url)) return 'restricted';
  if (s.mode === 'test') return null;
  if (s.mode === 'all') {
    if (!s.signedIn) return 'signed-out';
    if (s.serverOrigin && pageOrigin(url) === s.serverOrigin) return 'server';
    if (isReplayBlocked(url, s.blocked)) return 'blocked';
    return s.allSites ? null : 'needs-all-sites';
  }
  return s.granted.some((o) => originMatches(o, url)) ? null : 'not-in-project';
}

/** Whether the extension may run on `url`. */
export function inScope(s: Scope, url: string | null | undefined): boolean {
  return outOfScope(s, url) === null;
}

/**
 * Masking preset and body policy for a page (D-125): the project's; in `all` mode a page with no
 * project yet takes its workspace's new-project preset, which the project the server makes at the
 * first capture starts with; none outside a project in strict mode.
 */
export function presetFor(s: Scope, url: string | null | undefined): { maskingPreset: MaskingPreset; bodyPolicy: BodyPolicy; project: ProjectScope | null } {
  const p = projectForUrl(s.projects, url);
  if (p) return { maskingPreset: p.maskingPreset, bodyPolicy: bodyPolicyOf(p), project: p };
  if (s.mode === 'test') return { maskingPreset: 'staging', bodyPolicy: OPEN_BODY_POLICY, project: null };
  if (s.mode === 'all') {
    const d = s.defaults.find((x) => x.workspaceId === s.activeWorkspaceId) ?? s.defaults[0];
    const preset = d?.maskingPreset ?? 'staging';
    const origin = pageOrigin(url);
    return { maskingPreset: preset, bodyPolicy: bodyPolicyOf({ maskingPreset: preset, origins: origin ? [origin] : [], bodyAllowlist: [] }), project: null };
  }
  return { maskingPreset: 'none', bodyPolicy: OPEN_BODY_POLICY, project: null };
}

/** The project's workspace for a page, so its capture lands where the origin check passes. */
export async function workspaceForUrl(url: string | null | undefined): Promise<string | null> {
  return projectForUrl(await projects(), url)?.workspaceId ?? null;
}
