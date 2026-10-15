<script lang="ts">
  // Options page: the server this extension talks to. Everything else lives in the popup's
  // settings screen (J-176).
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
  import { STORAGE } from '@toolbar/shared/ext';
  import BrandLogo from '../../lib/ui/BrandLogo.svelte';
  import { brand } from '../../lib/brand.svelte';

  const fallback = (import.meta.env.WXT_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL;
  let value = $state('');
  let saved = $state('');
  let error = $state('');
  const version = browser.runtime.getManifest().version;

  onMount(async () => {
    const got = await browser.storage.local.get(STORAGE.serverUrl.key);
    value = (got[STORAGE.serverUrl.key] as string | undefined) ?? fallback;
  });

  async function save(e: SubmitEvent) {
    e.preventDefault();
    error = saved = '';
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
      // D-126: the manifest grants the build's server only; another server is asked for here, from the click
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
      <input id="server" type="url" bind:value placeholder={fallback} data-server-input />
      <Button type="submit" variant="primary" data-server-save>Save</Button>
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if saved}<p class="ok" role="status">{saved}</p>{/if}
  </form>
  <p class="foot">Version {version}. Other settings are in the popup: click the toolbar icon, then the three-dot menu.</p>
</main>

<style>
  :global(body) {
    margin: 0;
    background: var(--nb-bg);
    color: var(--nb-text);
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
  }
  main {
    max-width: 640px;
    margin: 48px auto;
    padding: 0 16px;
  }
  h1 {
    display: flex;
    align-items: center;
    gap: 8px;
    font: var(--nb-weight-semibold) var(--nb-text-2xl) / 1.2 var(--nb-font-sans);
    color: var(--nb-accent-text);
  }
  form {
    padding: 20px;
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-lg);
    background: var(--nb-surface);
  }
  label {
    font-weight: var(--nb-weight-semibold);
  }
  .hint,
  .foot {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-base) var(--nb-font-mono);
  }
  .err {
    color: var(--nb-danger);
  }
  .ok {
    color: var(--nb-success);
  }
</style>
