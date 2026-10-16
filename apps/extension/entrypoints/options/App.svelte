<script lang="ts">
  // Options page: the server this extension talks to. Everything else lives in the popup's
  // settings screen (J-176).
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { STORAGE } from '@toolbar/shared/ext';
  import BrandLogo from '../../lib/ui/BrandLogo.svelte';
  import { brand } from '../../lib/brand.svelte';
  import { resolveServerUrl } from '../../lib/server-url';

  const fallback = resolveServerUrl(null);
  let value = $state('');
  let saved = $state('');
  let error = $state('');
  const version = browser.runtime.getManifest().version;

  onMount(async () => {
    const got = await browser.storage.local.get(STORAGE.serverUrl.key);
    value = resolveServerUrl(got[STORAGE.serverUrl.key]);
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
      <Button type="submit" variant="primary" size="lg" data-server-save>Save</Button>
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if saved}<p class="ok" role="status">{saved}</p>{/if}
  </form>
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
