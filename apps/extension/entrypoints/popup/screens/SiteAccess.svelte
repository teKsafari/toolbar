<script lang="ts">
  // Host access (D-126). The extension holds no site at install. On a page of one of the user's
  // projects it asks, from this click, for the origins of all their projects at once; on any
  // other page it says so and records nothing. The worker registers the capture scripts when
  // Chrome reports the grant (lib/bg/scope.ts), so this screen only has to ask.
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import type { SiteAccess } from '@toolbar/shared/ext';
  import { store } from '../lib/store.svelte';

  let { site }: { site: SiteAccess } = $props();
  let busy = $state(false);
  let error = $state('');
  const host = $derived(store.context?.host ?? 'this site');
  const sites = $derived(site.missing.length === 1 ? '1 site' : `${site.missing.length} sites`);

  async function allow() {
    error = '';
    busy = true;
    try {
      // first await of the click: Chrome needs the user gesture for the prompt
      const granted = await browser.permissions.request({ origins: [...site.missing] });
      if (!granted) {
        error = 'Access was not granted. Nothing is recorded on this site.';
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

  function manage() {
    void browser.tabs.create({ url: `${store.serverUrl}/settings/projects` });
    window.close();
  }
</script>

{#if site.project}
  <div class="card" data-screen="site-access" data-testid="site-access" data-state="needs-grant">
    <Icon name="globe" size={28} />
    <p><strong class="title">Allow on {site.project.name}</strong></p>
    <p class="muted">
      {host} belongs to your project <strong>{site.project.name}</strong>. The extension needs access to record console, network and the page here.
      {#if site.missing.length > 1}This grants all {sites} of your projects.{/if}
    </p>
    <Button variant="primary" loading={busy} onclick={allow} data-testid="site-allow">Allow</Button>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{:else}
  <div class="card" data-screen="site-access" data-testid="site-access" data-state="not-in-project">
    <Icon name="globe" size={28} />
    <p><strong class="title">Not part of a project</strong></p>
    <p class="muted">
      {#if site.projectCount}
        {host} is not an origin of your projects, so nothing is recorded here.
      {:else}
        You have no projects yet. A workspace admin adds the apps your team reviews, and the extension records on those only.
      {/if}
    </p>
    <div class="row">
      <Button size="sm" onclick={manage} data-testid="site-manage">Projects</Button>
      {#if site.missing.length}
        <Button size="sm" variant="primary" loading={busy} onclick={allow} data-testid="site-allow">Allow on {sites}</Button>
      {/if}
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </div>
{/if}

<style>
  /* empty-state heading in the display face (D-176) */
  strong.title {
    display: block;
    font: var(--nb-weight-medium) var(--nb-text-xl) / 1.3 var(--nb-font-display);
    letter-spacing: var(--nb-tracking-tight);
    text-wrap: balance;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px 4px;
    text-align: center;
    color: var(--nb-text);
  }
  .card :global(.nb-icon) {
    color: var(--nb-accent);
  }
  p {
    margin: 0;
  }
  .muted {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
    margin-bottom: 8px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .err {
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
</style>
