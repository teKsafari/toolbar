<script lang="ts">
  // Options page: the server this extension talks to, and where it records. Everything else lives
  // in the popup's settings screen (J-176). An admin's policy (D-202) sets the server: the field is
  // then read-only.
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { STORAGE } from '@toolbar/shared/ext';
  import BrandLogo from '../../lib/ui/BrandLogo.svelte';
  import { brand } from '../../lib/brand.svelte';
  import { BUILT_SERVER_URL, managedPolicy, NO_POLICY, resolveServerUrl, type ManagedPolicy } from '../../lib/server-url';

  const fallback = resolveServerUrl(null);
  let value = $state('');
  let saved = $state('');
  let error = $state('');
  const version = browser.runtime.getManifest().version;

  // D-200, D-202: the server's site access mode, and whether the browser still grants every site
  // (granted at install; the person can turn it off in the browser's extension details)
  const ALL_SITES = ['http://*/*', 'https://*/*'];
  let mode = $state<'all' | 'projects' | null>(null);
  let allSites = $state(false);
  let accessError = $state('');
  let policy = $state<ManagedPolicy>(NO_POLICY);
  const managed = $derived(!!policy.serverUrl || policy.lockServerUrl);

  async function readAccess() {
    const got = await browser.storage.local.get([STORAGE.bootstrap.key, STORAGE.auth.key]);
    const auth = got[STORAGE.auth.key] as { token?: string } | undefined;
    const boot = got[STORAGE.bootstrap.key] as { data?: { siteAccess?: { mode: 'all' | 'projects' } } } | undefined;
    mode = auth?.token ? (boot?.data?.siteAccess?.mode ?? 'projects') : null;
    allSites = await browser.permissions.contains({ origins: ALL_SITES }).catch(() => false);
  }

  async function allowAll() {
    accessError = '';
    // first await of the click: the browser needs the user gesture for the prompt
    const ok = await browser.permissions.request({ origins: ALL_SITES }).catch(() => false);
    if (!ok) accessError = 'Access was not granted. The extension records nothing until it is.';
    await readAccess();
  }

  onMount(async () => {
    const [got, p] = await Promise.all([browser.storage.local.get(STORAGE.serverUrl.key), managedPolicy()]);
    policy = p;
    value = resolveServerUrl(got[STORAGE.serverUrl.key], BUILT_SERVER_URL, p.serverUrl);
    await readAccess();
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = saved = '';
    if (managed) return; // D-202: the policy's server wins
    let url: URL;
    try {
      url = new URL(value.trim());
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
    } catch {
      error = 'Type a full address such as https://toolbar.example.com';
      return;
    }
    const origin = url.origin;
    if (origin === new URL(fallback).origin) await browser.storage.local.remove(STORAGE.serverUrl.key);
    else {
      // D-202: every site is granted at install, so this answers at once; it asks only if the person turned access off
      const granted = await browser.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
      if (!granted) {
        error = `The extension needs access to ${url.host} to sign in and upload there.`;
        return;
      }
      await browser.storage.local.set({ [STORAGE.serverUrl.key]: origin });
    }
    value = origin;
    saved = 'Saved. Sign in again from the popup if you changed servers.';
  }
</script>

<main>
  <h1><BrandLogo size={22} /> {brand.name} options</h1>
  <form onsubmit={save}>
    <label for="server">Server address</label>
    <p class="hint">Your self-hosted {brand.name} server. Captures, links and sign-in go there.</p>
    <div class="row">
      <input id="server" type="url" bind:value placeholder={fallback} readonly={managed} data-server-input />
      {#if !managed}<Button type="submit" variant="primary" size="lg" data-server-save>Save</Button>{/if}
    </div>
    {#if managed}<p class="hint" data-server-managed>Your organisation sets this address. Ask your admin to change it.</p>{/if}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if saved}<p class="ok" role="status">{saved}</p>{/if}
  </form>
  {#if mode}
    <section class="card" data-site-access={mode} data-all-sites={allSites}>
      <h2>Site access</h2>
      {#if mode === 'all' && allSites}
        <p class="hint" data-site-status>All sites except your server and your blocked sites.</p>
      {:else if mode === 'all'}
        <p class="hint" data-site-status>Site access is off in your browser.</p>
        <Button variant="primary" onclick={allowAll} data-allow-all>Allow access to all sites</Button>
      {:else}
        <p class="hint" data-site-status>Project sites only. Click the extension icon on a site to add it.</p>
      {/if}
      {#if accessError}<p class="err" role="alert">{accessError}</p>{/if}
    </section>
  {/if}
  <p class="foot">Version {version}. Other settings are in the popup: click the toolbar icon, then the three-dot menu.</p>
</main>

<style>
  /* An extension page in the teksafari language (D-176): the canvas, a Nunito page title, one
     surface card with a header rule, a 36 px field with the 3 px focus ring. */
  :global(body) {
    margin: 0;
    background: var(--nb-bg);
    color: var(--nb-text);
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
    letter-spacing: var(--nb-tracking-ui);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  main {
    max-width: 640px;
    margin: 56px auto;
    padding: 0 16px;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 24px;
    font: var(--nb-weight-medium) var(--nb-text-3xl) / 1.2 var(--nb-font-display);
    letter-spacing: var(--nb-tracking-tight);
    color: var(--nb-text);
  }
  form {
    padding: 0 20px 20px;
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-lg);
    background: var(--nb-surface);
  }
  .card {
    margin-top: 16px;
    padding: 0 20px 20px;
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-lg);
    background: var(--nb-surface);
  }
  h2 {
    margin: 0 -20px;
    padding: 14px 20px 12px;
    border-bottom: 1px solid var(--nb-border);
    font: var(--nb-weight-semibold) var(--nb-text-base) / 1.4 var(--nb-font-sans);
  }
  label {
    display: block;
    margin: 0 -20px;
    padding: 14px 20px 12px;
    border-bottom: 1px solid var(--nb-border);
    font: var(--nb-weight-semibold) var(--nb-text-base) / 1.4 var(--nb-font-sans);
  }
  .hint {
    margin: 14px 0 12px;
  }
  .hint,
  .foot {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
  .foot {
    margin: 16px 0 0;
    color: var(--nb-text-faint);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    height: var(--nb-control-lg);
    padding: 0 12px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-base) var(--nb-font-mono);
    letter-spacing: 0;
    transition:
      border-color var(--nb-dur-fast) var(--nb-ease-out),
      box-shadow var(--nb-dur-fast) var(--nb-ease-out);
  }
  input::placeholder {
    color: var(--nb-text-faint);
  }
  input[readonly] {
    background: var(--nb-surface-sunken);
    color: var(--nb-text-muted);
  }
  input:focus {
    outline: none;
    border-color: var(--nb-focus);
    box-shadow: var(--nb-focus-ring);
  }
  .err,
  .ok {
    margin: 12px 0 0;
    font-size: var(--nb-text-md);
  }
  .err {
    color: var(--nb-danger);
  }
  .ok {
    color: var(--nb-success);
  }
</style>
