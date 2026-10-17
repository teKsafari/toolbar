// lib/bg/sites.ts (D-205): what the popup offers on a page. Outside the projects in the
// `projects` mode, one add row with the projects the person may add to, the most recently used
// first; nothing to add on the server's own pages, restricted pages or in `all` mode; "Remove
// this site" for admins and for the person who added the origin; the closed state per origin.
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { STORAGE } from '@toolbar/shared/ext';
import { RECENT_PROJECT_KEY, TOOLBAR_CLOSED_KEY, toolbarClosedOn } from '@toolbar/shared/areas/ext-ui';
import { siteFacts } from '../lib/bg/sites';
import type { Scope } from '../lib/scope';

const p = (id: string, workspaceId: string, origins: string[], mine?: string[]) => ({ id, workspaceId, name: id, origins, maskingPreset: 'staging' as const, bodyAllowlist: [], traceOpenMs: 10_000, ...(mine ? { mine } : {}) });
const projects = [p('Lab', 'w1', ['http://localhost:5173'], ['http://localhost:5173']), p('Nuru', 'w1', ['https://*.nuru.test', 'https://nuru.test']), p('Other', 'w2', ['https://other.test'])];
const sc: Scope = { mode: 'projects', signedIn: true, projects, granted: [], missing: [], allSites: true, serverOrigin: null, blocked: [], defaults: [], activeWorkspaceId: 'w1' };

async function boot(canAdd: string[], roles: Record<string, 'admin' | 'creator'> = { w1: 'creator', w2: 'admin' }) {
  const workspaces = Object.entries(roles).map(([id, role]) => ({ id, name: id === 'w1' ? 'Team' : 'Side', slug: id, logoUrl: null, role, isOwner: false, memberCount: 2, createdAt: '2026-10-17T00:00:00.000Z' }));
  await fakeBrowser.storage.local.set({
    [STORAGE.serverUrl.key]: 'http://localhost:3000',
    [STORAGE.bootstrap.key]: { at: Date.now(), data: { workspaces, activeWorkspaceId: 'w1', projects, siteAccess: { mode: 'projects', defaults: [], canAdd } } },
  });
}

beforeEach(() => fakeBrowser.reset());

describe('siteFacts (D-205)', () => {
  it('offers the add row outside the projects, the most recently used project first, New project in the active workspace', async () => {
    await boot(['w1', 'w2']);
    await fakeBrowser.storage.local.set({ [RECENT_PROJECT_KEY]: 'Other' });
    const f = await siteFacts(sc, 'https://new.example.test/path');
    expect(f.origin).toBe('https://new.example.test');
    expect(f.add?.projects.map((x) => x.id)).toEqual(['Other', 'Lab', 'Nuru']);
    expect(f.add).toMatchObject({ recentProjectId: 'Other', newProjectWorkspaceId: 'w1', denied: false });
    expect(f.add?.projects[0]).toMatchObject({ workspaceName: 'Side' });
  });

  it('lists only the workspaces where the person may add; denied when none', async () => {
    await boot(['w2']);
    const f = await siteFacts(sc, 'https://new.example.test/');
    expect(f.add?.projects.map((x) => x.id)).toEqual(['Other']);
    expect(f.add).toMatchObject({ recentProjectId: null, newProjectWorkspaceId: 'w2' });
    await boot([]);
    expect((await siteFacts(sc, 'https://new.example.test/')).add).toMatchObject({ denied: true, newProjectWorkspaceId: null, projects: [] });
  });

  it('nothing to add on the server, on restricted pages, signed out, in all mode or on a project page', async () => {
    await boot(['w1']);
    expect((await siteFacts(sc, 'http://localhost:3000/c/1')).add).toBeNull();
    expect((await siteFacts(sc, 'chrome://extensions/')).add).toBeNull();
    expect((await siteFacts(sc, 'https://chromewebstore.google.com/detail/x')).add).toBeNull();
    expect((await siteFacts({ ...sc, signedIn: false }, 'https://new.example.test/')).add).toBeNull();
    expect((await siteFacts({ ...sc, mode: 'all' }, 'https://new.example.test/')).add).toBeNull();
    expect((await siteFacts(sc, 'http://localhost:5173/x')).add).toBeNull();
  });

  it('remove: the person who added the exact origin, or an admin; never a wildcard match', async () => {
    await boot(['w1', 'w2']);
    expect((await siteFacts(sc, 'http://localhost:5173/x')).removable).toBe(true); // theirs
    expect((await siteFacts(sc, 'https://nuru.test/')).removable).toBe(false); // a creator, not theirs
    expect((await siteFacts(sc, 'https://staging.nuru.test/')).removable).toBe(false); // wildcard only
    expect((await siteFacts(sc, 'https://other.test/')).removable).toBe(true); // admin of w2
  });

  it('the closed state per origin', async () => {
    await boot(['w1']);
    await fakeBrowser.storage.local.set({ [TOOLBAR_CLOSED_KEY]: { 'http://localhost:5173': 1 } });
    expect((await siteFacts(sc, 'http://localhost:5173/a')).closed).toBe(true);
    expect((await siteFacts(sc, 'http://localhost:5174/a')).closed).toBe(false);
    expect(toolbarClosedOn({ 'http://a.test': 1 }, 'http://a.test')).toBe(true);
    expect(toolbarClosedOn(null, 'http://a.test')).toBe(false);
    expect(toolbarClosedOn({ 'http://a.test': 1 }, null)).toBe(false);
  });
});
