<script lang="ts">
  // Signed-out popup (X-05 sign-in state): one button that starts the extension sign-in on the
  // server; the auth area runs the flow behind auth.signIn.
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { store } from '../lib/store.svelte';
  import { send, errorText } from '../../capture.content/ui/send';
  import { brand } from '../../../lib/brand.svelte';

  let busy = $state(false);
  let error = $state('');
  async function signIn() {
    busy = true;
    error = '';
    const r = await send('auth.signIn', {});
    busy = false;
    if (!r.ok) error = errorText(r);
    else await store.load();
  }
</script>

<div class="out" data-screen="signed-out" data-testid="signed-out">
  <Icon name="logo" size={32} />
  <p><strong class="title">Sign in to start capturing</strong></p>
  <p class="muted">{brand.name} saves your captures to <span class="mono" data-server-url>{store.serverUrl}</span>.</p>
  <Button variant="primary" loading={busy} onclick={signIn} data-sign-in>Sign in</Button>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <button class="change" type="button" onclick={() => browser.runtime.openOptionsPage()}>Use another server</button>
</div>

<style>
  /* empty-state heading in the display face (D-176) */
  strong.title {
    display: block;
    font: var(--nb-weight-medium) var(--nb-text-xl) / 1.3 var(--nb-font-display);
    letter-spacing: var(--nb-tracking-tight);
    text-wrap: balance;
  }
  .out {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px 4px;
    text-align: center;
    color: var(--nb-text);
  }
  .out :global(.nb-icon) {
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
  .mono {
    font-family: var(--nb-font-mono);
    font-size: var(--nb-text-sm);
  }
  .err {
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
  .change {
    all: unset;
    margin-top: 4px;
    color: var(--nb-accent-text);
    font-size: var(--nb-text-md);
    font-weight: var(--nb-weight-medium);
    cursor: pointer;
  }
  .change:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .change:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
</style>
