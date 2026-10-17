<script lang="ts">
  // Host access (D-126, D-200, D-202, D-205). In the `projects` mode (the default, D-203) a page
  // outside the projects gets one row: the host, a project picker (the most recently used project
  // first; "New project" makes one named after the host) and Add. Add puts the origin in the
  // project, and the worker registers and injects the capture scripts so the toolbar starts on the
  // tab without a reload (lib/bg/sites.ts). The other states are short: site access turned off in
  // the browser (Allow asks again), and a site on the blocked list (`all` mode).
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import type { SiteAccess } from '@toolbar/shared/ext';
  import { store } from '../lib/store.svelte';
  import { send } from '../../capture.content/ui/send';

  let { site }: { site: SiteAccess } = $props();
  let busy = $state(false);
  let error = $state('');
  const host = $derived(store.context?.host ?? '');
  const add = $derived(site.add);
  const multi = $derived(new Set(add?.projects.map((p) => p.workspaceId) ?? []).size > 1);
  /** '' is "New project" */
  let pick = $state<string | null>(null);
  const chosen = $derived(pick ?? add?.recentProjectId ?? (add?.newProjectWorkspaceId ? '' : (add?.projects[0]?.id ?? '')));

  async function allow() {
    error = '';
    busy = true;
    try {
      // first await of the click: Chrome needs the user gesture for the prompt
      const origins = site.reason === 'needs-all-sites' ? [...site.allSitePatterns] : [...site.missing];
      if (!(await browser.permissions.request({ origins }))) {
        error = 'Not granted';
        return;
      }
      await new Promise((r) => setTimeout(r, 300)); // the worker registers on permissions.onAdded
      await store.load();
    } catch (e) {
      error = (e as Error)?.message ?? 'Could not ask for access';
    } finally {
      busy = false;
    }
  }

  async function addSite(e: Event) {
    e.preventDefault();
    if (busy || store.tabId == null) return;
    error = '';
    busy = true;
    try {
      const r = await send('site.add', { tabId: store.tabId, projectId: chosen || null });
      if (!r.ok) {
        error = r.message ?? 'Could not add the site';
        return;
      }
      await store.load();
    } finally {
      busy = false;
    }
  }
</script>

{#if site.reason === 'needs-all-sites'}
  <div class="card" data-screen="site-access" data-testid="site-access" data-state="needs-all-sites">
    <p class="title">Site access is off</p>
    <Button variant="primary" loading={busy} onclick={allow} data-testid="site-allow-all">Allow</Button>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{:else if site.reason === 'blocked'}
  <div class="card" data-screen="site-access" data-testid="site-access" data-state="blocked">
    <p class="title">Blocked site</p>
    <Button size="sm" onclick={() => (store.screen = 'sites')} data-testid="site-blocked-list">Blocked sites</Button>
  </div>
{:else if site.project}
  <div class="card" data-screen="site-access" data-testid="site-access" data-state="needs-grant">
    <p class="title">Allow on {site.project.name}</p>
    <Button variant="primary" loading={busy} onclick={allow} data-testid="site-allow">Allow</Button>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{:else}
  <div class="add" data-screen="site-access" data-testid="site-access" data-state="not-in-project">
    {#if add && !add.denied}
      <form class="row" onsubmit={addSite} data-testid="site-add-row">
        <Icon name="globe" size={14} />
        <span class="host" title={host} data-testid="site-add-host">{host}</span>
        <select aria-label="Project" value={chosen} onchange={(e) => (pick = (e.currentTarget as HTMLSelectElement).value)} disabled={busy} data-testid="site-add-project">
          {#each add.projects as p (p.id)}
            <option value={p.id}>{multi ? `${p.workspaceName} / ${p.name}` : p.name}</option>
          {/each}
          {#if add.newProjectWorkspaceId}<option value="">New project</option>{/if}
        </select>
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!chosen && !add.newProjectWorkspaceId} data-testid="site-add">Add</Button>
      </form>
    {:else if add}
      <p class="row muted" data-testid="site-add-denied"><Icon name="globe" size={14} /><span class="host">{host}</span><span>Admins add sites</span></p>
    {:else}
      <p class="row muted"><Icon name="globe" size={14} /><span class="host">{host}</span></p>
    {/if}
    {#if error}<p class="err" role="alert" data-testid="site-add-error">{error}</p>{/if}
  </div>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px 8px 4px;
    text-align: center;
    color: var(--nb-text);
  }
  .title {
    margin: 0;
    font: var(--nb-weight-semibold) var(--nb-text-md) / 1.3 var(--nb-font-sans);
  }
  .add {
    padding: 12px 0 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--nb-text);
    font: var(--nb-text-md) / 1.2 var(--nb-font-sans);
  }
  .row :global(.nb-icon) {
    flex: none;
    color: var(--nb-text-muted);
  }
  .host {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--nb-weight-medium);
  }
  select {
    flex: 0 1 150px;
    min-width: 0;
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-sm);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-md) / 1 var(--nb-font-sans);
  }
  select:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 1px;
  }
  .muted {
    color: var(--nb-text-muted);
  }
  .err {
    margin: 8px 0 0;
    color: var(--nb-danger);
    font-size: var(--nb-text-sm);
  }
</style>
