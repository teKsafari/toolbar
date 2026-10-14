<script lang="ts">
  // Signed-out popup (X-05 sign-in state): one button that starts the extension sign-in on the
  // server; the auth area runs the flow behind auth.signIn.
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { PRODUCT_NAME } from '@toolbar/shared/constants';
  import { store } from '../lib/store.svelte';
  import { send, errorText } from '../../capture.content/ui/send';

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

<div class="out" data-screen="signed-out">
  <Icon name="logo" size={32} />
  <p><strong>Sign in to start capturing</strong></p>
  <p class="muted">{PRODUCT_NAME} saves your captures to <span class="mono" data-server-url>{store.serverUrl}</span>.</p>
  <Button variant="primary" loading={busy} onclick={signIn} data-sign-in>Sign in</Button>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <button class="change" type="button" onclick={() => browser.runtime.openOptionsPage()}>Use another server</button>
</div>

<style>
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
    cursor: pointer;
  }
</style>
