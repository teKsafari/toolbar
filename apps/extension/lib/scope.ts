// Where the extension runs (PLAN "Zero integration", D-123, D-126). The manifest asks for no
// site at install: `optional_host_permissions` only, plus the server's own origin. After sign-in
// the bootstrap names the user's projects; the popup asks for their origins from a click
// (chrome.permissions.request), and this module registers the capture scripts for the origins
// that are both a project's and granted. Nothing else gets a content script.
//
// Test builds (WXT_TEST_HOOKS=1) keep <all_urls> in the manifest so the area suites can run
// without a permission prompt, and register the capture scripts everywhere, as Part 1 did, unless
// storage key `tb:test-scope` is 'projects' (the zero-integration specs set it).
import { browser } from 'wxt/browser';
import { STORAGE, type AuthState, type StorageValues } from '@toolbar/shared/ext';
import { allOrigins, bodyPolicyOf, matchPatternOf, OPEN_BODY_POLICY, originMatches, projectForUrl, type BodyPolicy, type ProjectScope } from '@toolbar/shared/projects';
import type { MaskingPreset } from '@toolbar/shared/events';
import { TEST_HOOKS } from './flags';

export const TEST_SCOPE_KEY = 'tb:test-scope';
export const ALL_SITES = ['<all_urls>'];

export interface Scope {
  /** 'all': a test build in Part 1 mode; 'projects': the release behavior */
  mode: 'all' | 'projects';
  signedIn: boolean;
  projects: ProjectScope[];
  /** project origins with host permission */
  granted: string[];
  /** project origins still without host permission */
  missing: string[];
}

async function local<K extends 'auth' | 'bootstrap'>(k: K): Promise<StorageValues[K] | null> {
  const { key } = STORAGE[k];
  try {
    return ((await browser.storage.local.get(key))[key] as StorageValues[K] | undefined) ?? null;
  } catch {
    return null;
  }
}

async function testMode(): Promise<'all' | 'projects'> {
  if (!TEST_HOOKS) return 'projects';
  try {
    return (await browser.storage.local.get(TEST_SCOPE_KEY))[TEST_SCOPE_KEY] === 'projects' ? 'projects' : 'all';
  } catch {
    return 'all';
  }
}

/** The signed-in user's projects, from the cached bootstrap; none when signed out. */
export async function projects(): Promise<ProjectScope[]> {
  const auth = (await local('auth')) as AuthState | null;
  if (!auth?.token) return [];
  return (await local('bootstrap'))?.data.projects ?? [];
}

async function hasOrigin(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [matchPatternOf(origin)] });
  } catch {
    return false;
  }
}

export async function scope(): Promise<Scope> {
  const [mode, list, auth] = await Promise.all([testMode(), projects(), local('auth')]);
  const origins = allOrigins(list);
  const has = await Promise.all(origins.map(hasOrigin));
  return {
    mode,
    signedIn: !!(auth as AuthState | null)?.token,
    projects: list,
    granted: origins.filter((_, i) => has[i]),
    missing: origins.filter((_, i) => !has[i]),
  };
}

/** Match patterns the capture scripts are registered for under this scope. */
export function patternsOf(s: Scope): string[] {
  return s.mode === 'all' ? ALL_SITES : s.granted.map(matchPatternOf);
}

/** Whether the extension may run on `url`. */
export function inScope(s: Scope, url: string | null | undefined): boolean {
  if (!url || !/^https?:/i.test(url)) return false;
  if (s.mode === 'all') return true;
  return s.granted.some((o) => originMatches(o, url));
}

/** Masking preset and body policy for a page (D-125): the project's, or none outside one. */
export function presetFor(s: Scope, url: string | null | undefined): { maskingPreset: MaskingPreset; bodyPolicy: BodyPolicy; project: ProjectScope | null } {
  const p = projectForUrl(s.projects, url);
  if (!p) return { maskingPreset: s.mode === 'all' ? 'staging' : 'none', bodyPolicy: OPEN_BODY_POLICY, project: null };
  return { maskingPreset: p.maskingPreset, bodyPolicy: bodyPolicyOf(p), project: p };
}

/** The project's workspace for a page, so its capture lands where the origin check passes. */
export async function workspaceForUrl(url: string | null | undefined): Promise<string | null> {
  return projectForUrl(await projects(), url)?.workspaceId ?? null;
}
