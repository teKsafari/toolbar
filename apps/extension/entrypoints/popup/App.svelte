<script lang="ts">
  // The extension popup (J-001 and the screens that replace its body in place: settings,
  // blocked sites, drafts, recording link, link help, heavy-page warning). About 400 px wide,
  // a 40 px header with the wordmark, the unfinished-draft pill, home and the three-dot menu.
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { store } from './lib/store.svelte';
  import Menu from './lib/Menu.svelte';
  import Main from './screens/Main.svelte';
  import Settings from './screens/Settings.svelte';
  import Sites from './screens/Sites.svelte';
  import Drafts from './screens/Drafts.svelte';
  import LinkForm from './screens/LinkForm.svelte';
  import LinkHelp from './screens/LinkHelp.svelte';
  import Heavy from './screens/Heavy.svelte';
  import Restricted from './screens/Restricted.svelte';
  import SignedOut from './screens/SignedOut.svelte';
  import SiteAccess from './screens/SiteAccess.svelte';
  import AccountCard from '../../lib/auth/AccountCard.svelte';
  import BrandLogo from '../../lib/ui/BrandLogo.svelte';
  import { brand } from '../../lib/brand.svelte';

  onMount(() => {
    store.listen();
    void store.load();
  });

  // J-035: the pill counts drafts and becomes a button once no draft is open or processing
  const busy = $derived(['draft', 'stopping', 'uploading'].includes(store.session.state));
  const draftCount = $derived(store.drafts.length);
  const openHome = () => {
    void browser.tabs.create({ url: store.serverUrl });
    window.close();
  };
  const restricted = $derived(!!store.context?.restricted);
  // D-126, D-200: outside the scope the page cannot be captured (our own server's pages offer the
  // desktop); in `all` mode with site access turned off in the browser, every page asks for it
  // (D-202: granted at install, so only after the person turned it off)
  const site = $derived(store.context?.site);
  const blocked = $derived(!!site && !site.allowed && (site.reason === 'needs-all-sites' || !store.context?.isServerPage));
</script>

<main data-popup data-loading={store.loading}>
  <header>
    <span class="brand" data-brand-name><BrandLogo size={18} /> {brand.name}</span>
    <span class="actions">
      {#if draftCount > 0 && !restricted}
        <button
          class="drafts-pill"
          type="button"
          disabled={busy}
          aria-label="{draftCount} unfinished {draftCount === 1 ? 'draft' : 'drafts'}"
          title={busy ? 'Finish the open draft first' : 'Open drafts'}
          data-drafts-pill={draftCount}
          onclick={() => (store.screen = 'drafts')}
        >
          <Icon name="clock" size={13} />
          {draftCount}
        </button>
      {/if}
      <button class="icon-btn" type="button" aria-label="Open dashboard" data-home onclick={openHome}><Icon name="home" size={16} /></button>
      <Menu />
    </span>
  </header>
  {#if !store.loading && store.signedIn}<AccountCard onchange={() => void store.load()} />{/if}

  {#if store.loading}
    <div class="loading" data-popup-loading><Icon name="spinner" size={18} /></div>
  {:else if store.loadError}
    <div class="load-error" role="alert" data-popup-error>
      <p>{store.loadError}</p>
      <span class="load-actions">
        <Button variant="secondary" onclick={() => void store.retry()} data-retry>Try again</Button>
        {#if store.workerDown}
          <Button variant="secondary" onclick={() => void store.restartExtension()} data-restart-extension>Restart extension</Button>
        {/if}
      </span>
    </div>
  {:else if !store.signedIn && (store.screen === 'main' || store.screen === 'link' || store.screen === 'drafts')}
    <!-- signed out, sign-in comes first on any page (X-05); a restricted page says so once signed in -->
    <SignedOut />
  {:else if restricted && store.screen === 'main'}
    <Restricted />
  {:else if blocked && site && store.screen === 'main'}
    <SiteAccess {site} />
  {:else if store.screen === 'settings'}
    <Settings />
  {:else if store.screen === 'sites'}
    <Sites />
  {:else if store.screen === 'drafts'}
    <Drafts />
  {:else if store.screen === 'link'}
    <LinkForm />
  {:else if store.screen === 'link-help'}
    <LinkHelp />
  {:else if store.screen === 'heavy'}
    <Heavy />
  {:else}
    <Main />
    {#if site?.project && site.allowed}
      <p class="project" data-testid="site-project" data-preset={site.project.maskingPreset}>
        {site.project.name} · {site.project.maskingPreset === 'production' ? 'Production masking' : 'Staging masking'}
      </p>
    {/if}
    <!-- D-202, D-203: `all` mode records everywhere; say so in one line -->
    {#if site?.mode === 'all' && site.allSites}
      <p class="project" data-testid="site-all-sites">All sites</p>
    {/if}
  {/if}
</main>

<style>
  main {
    padding: 0 15px 15px;
  }
  .project {
    margin: 10px 0 0;
    color: var(--nb-text-faint);
    font: var(--nb-text-sm) / 1.3 var(--nb-font-sans);
    text-align: center;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 44px;
  }
  /* the product name in the display face beside the logo, in the text colour (D-176) */
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font: var(--nb-weight-semibold) var(--nb-text-lg) / 1 var(--nb-font-display);
    letter-spacing: var(--nb-tracking-tight);
    color: var(--nb-text);
  }
  .actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .drafts-pill {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    margin-right: 4px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-info-tint);
    color: var(--nb-info-text);
    font: var(--nb-weight-semibold) var(--nb-text-sm) / 1 var(--nb-font-sans);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .drafts-pill:hover:not(:disabled) {
    background: color-mix(in srgb, var(--nb-info) 18%, transparent);
  }
  .drafts-pill:disabled {
    cursor: default;
  }
  .drafts-pill:focus-visible {
    outline: 2px solid var(--nb-focus);
  }
  :global(.icon-btn) {
    all: unset;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--nb-radius-sm);
    color: var(--nb-text-muted);
    cursor: pointer;
    transition:
      background-color var(--nb-dur-fast) var(--nb-ease-out),
      color var(--nb-dur-fast) var(--nb-ease-out);
  }
  :global(.icon-btn:hover),
  :global(.icon-btn[aria-expanded='true']) {
    background: var(--nb-surface-sunken);
    color: var(--nb-text);
  }
  :global(.icon-btn:focus-visible) {
    outline: 2px solid var(--nb-focus);
  }
  .load-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 16px 8px 4px;
    text-align: center;
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
  .load-error p {
    margin: 0;
  }
  .load-actions {
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }
  .loading {
    height: 120px;
    display: grid;
    place-items: center;
    color: var(--nb-text-faint);
  }
</style>
