<script lang="ts">
  // Heavy-page guard (J-011): instant replay is held on pages with a large or busy DOM. Continue
  // turns it on for this page load only.
  import { Button } from '@toolbar/ui';
  import { store } from '../lib/store.svelte';
  import { send, errorText } from '../../capture.content/ui/send';
  import ScreenHead from '../lib/ScreenHead.svelte';

  let error = $state('');
  async function go() {
    const tabId = store.context?.tabId ?? undefined;
    const r = await send('replay.set', { enabled: true, tabId, allowHeavy: true });
    if (!r.ok) {
      error = errorText(r);
      return;
    }
    if (store.context) store.context = { ...store.context, heavy: false };
    store.screen = 'main';
  }
</script>

<div data-screen="heavy">
  <ScreenHead title="Heavy page" onback={() => (store.screen = 'main')} />
  <p>This page changes a lot or holds a very large DOM, so instant replay is paused here to keep it fast.</p>
  <p class="muted">Turn it on anyway for this page load. It goes back to paused after a reload.</p>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <div class="actions">
    <Button variant="secondary" onclick={() => (store.screen = 'main')}>Cancel</Button>
    <Button variant="primary" onclick={go} data-heavy-continue>Turn on for this page</Button>
  </div>
</div>

<style>
  p {
    margin: 0 0 8px;
    font-size: var(--nb-text-base);
  }
  .muted {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
  .err {
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
</style>
