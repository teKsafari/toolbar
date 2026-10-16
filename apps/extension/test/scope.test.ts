// lib/scope.ts (D-126, D-200): what each site access mode registers, excludes and allows, and
// the preset a page with no project yet is masked under.
import { afterEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { STORAGE } from '@toolbar/shared/ext';
import { ALL_SITE_PATTERNS, excludesOf, inScope, outOfScope, patternsOf, presetFor, scope, type Scope } from '../lib/scope';

const base: Scope = {
  mode: 'all',
  signedIn: true,
  projects: [{ id: 'p1', workspaceId: 'w1', name: 'Nuru', origins: ['https://*.nuru.test'], maskingPreset: 'staging', bodyAllowlist: [], traceOpenMs: 10_000 }],
  granted: [],
  missing: [],
  allSites: true,
  serverOrigin: 'https://toolbar.example.com',
  blocked: ['paypal.com'],
  defaults: [
    { workspaceId: 'w1', maskingPreset: 'staging', traceOpenMs: 10_000 },
    { workspaceId: 'w2', maskingPreset: 'production', traceOpenMs: 10_000 },
  ],
  activeWorkspaceId: 'w2',
};

describe('all mode', () => {
  it('registers every http(s) site once granted, less the server and the blocked sites', () => {
    expect(patternsOf(base)).toEqual(ALL_SITE_PATTERNS);
    expect(excludesOf(base)).toEqual(['https://toolbar.example.com/*', '*://paypal.com/*', '*://*.paypal.com/*']);
    expect(patternsOf({ ...base, allSites: false })).toEqual([]);
    expect(patternsOf({ ...base, signedIn: false })).toEqual([]);
  });
  it('says why a page is out of scope', () => {
    expect(outOfScope(base, 'http://localhost:5173/')).toBeNull();
    expect(outOfScope(base, 'https://toolbar.example.com/c/1')).toBe('server');
    expect(outOfScope(base, 'https://www.paypal.com/x')).toBe('blocked');
    expect(outOfScope({ ...base, allSites: false }, 'http://localhost:5173/')).toBe('needs-all-sites');
    expect(outOfScope(base, 'chrome://extensions')).toBe('restricted');
    expect(inScope(base, 'http://127.0.0.1:5173/')).toBe(true);
  });
  it('masks a page with no project under its workspace’s default, a project page under the project’s', () => {
    expect(presetFor(base, 'http://localhost:5173/')).toMatchObject({ maskingPreset: 'production', project: null });
    expect(presetFor(base, 'https://staging.nuru.test/')).toMatchObject({ maskingPreset: 'staging', project: { id: 'p1' } });
  });
});

describe('strict mode', () => {
  const strict: Scope = { ...base, mode: 'projects', granted: ['http://localhost:5173'], missing: ['https://*.nuru.test'], allSites: false, serverOrigin: null, blocked: [] };
  it('registers the granted project origins only', () => {
    expect(patternsOf(strict)).toEqual(['http://localhost:5173/*']);
    expect(excludesOf(strict)).toEqual([]);
    expect(outOfScope(strict, 'http://localhost:5173/x')).toBeNull();
    expect(outOfScope(strict, 'http://127.0.0.1:5173/')).toBe('not-in-project');
    expect(presetFor(strict, 'http://127.0.0.1:5173/').maskingPreset).toBe('none');
  });
});

describe('test builds', () => {
  it('run everywhere', () => {
    const t: Scope = { ...base, mode: 'test' };
    expect(patternsOf(t)).toEqual(['<all_urls>']);
    expect(outOfScope(t, 'https://www.paypal.com/')).toBeNull();
  });
});

describe('every site granted at install (D-202)', () => {
  const contains = fakeBrowser.permissions.contains;
  afterEach(() => {
    fakeBrowser.permissions.contains = contains;
    fakeBrowser.reset();
  });
  async function signedIn(mode: 'all' | 'projects') {
    // the manifest holds <all_urls>: the browser reports every origin as granted
    fakeBrowser.permissions.contains = (() => Promise.resolve(true)) as typeof contains;
    await fakeBrowser.storage.local.set({
      [STORAGE.auth.key]: { token: 't', serverUrl: 'https://toolbar.example.com' },
      [STORAGE.bootstrap.key]: { at: Date.now(), data: { projects: base.projects, siteAccess: { mode, defaults: base.defaults } } },
    });
  }

  it('the strict mode still registers the project origins only, and refuses the rest', async () => {
    await signedIn('projects');
    const s = await scope();
    expect(s.mode).toBe('projects');
    expect(s.missing).toEqual([]);
    expect(patternsOf(s)).toEqual(['https://*.nuru.test/*']);
    expect(inScope(s, 'https://staging.nuru.test/x')).toBe(true);
    expect(outOfScope(s, 'http://localhost:5173/')).toBe('not-in-project');
    expect(outOfScope(s, 'https://www.example.org/')).toBe('not-in-project');
  });

  it('all mode needs no grant: every site but the server and the blocked ones', async () => {
    await signedIn('all');
    const s = await scope();
    expect(s.allSites).toBe(true);
    expect(patternsOf(s)).toEqual(ALL_SITE_PATTERNS);
    expect(outOfScope(s, 'http://localhost:5173/')).toBeNull();
    expect(outOfScope(s, 'https://toolbar.example.com/')).toBe('server');
  });
});
