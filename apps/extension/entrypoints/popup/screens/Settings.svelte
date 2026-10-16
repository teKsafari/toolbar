<script lang="ts">
  // Extension settings inside the popup (J-176, J-089, J-190, J-184, J-012, J-215). Toggles
  // apply at once; there is no save button. The screen grows to about 600 px and scrolls.
  import { browser } from 'wxt/browser';
  import { Icon, Switch } from '@toolbar/ui';
  import { SHORTCUTS_URL } from '@toolbar/shared/areas/ext-ui';
  import { store } from '../lib/store.svelte';
  import { send, errorText } from '../../capture.content/ui/send';
  import ScreenHead from '../lib/ScreenHead.svelte';

  let confirmReset = $state(false);
  let note = $state('');

  const openShortcuts = () => browser.tabs.create({ url: SHORTCUTS_URL });
  const openOptions = () => browser.runtime.openOptionsPage();

  async function reset() {
    if (!confirmReset) {
      confirmReset = true;
      return;
    }
    const r = await send('ext.reset', {});
    confirmReset = false;
    note = r.ok ? 'Settings are back to their defaults' : errorText(r);
    if (r.ok) await store.load();
  }
</script>

<div class="settings" data-screen="settings">
  <ScreenHead title="Settings" onback={() => (store.screen = 'main')} />

  <section>
    <label class="item">
      <span class="text"><strong>Open captures in a new tab</strong><small>After you create a capture, open it next to the page.</small></span>
      <Switch label="Open captures in a new tab" checked={store.settings.openInNewTab} onchange={(v) => store.updateSettings({ openInNewTab: v })} id="set-open-new-tab" />
    </label>
    <label class="item">
      <span class="text"><strong>Capture clicks and typing</strong><small>Record user actions with each capture. Password fields are never kept.</small></span>
      <Switch label="Capture clicks and typing" checked={store.settings.captureUserEvents} onchange={(v) => store.updateSettings({ captureUserEvents: v })} id="set-user-events" />
    </label>
    <div class="item">
      <span class="text"><strong>Keyboard shortcuts</strong><small>Change keys, or let them work outside the browser.</small></span>
      <button class="link" type="button" data-open-shortcuts onclick={openShortcuts}>Change <Icon name="external" size={12} /></button>
    </div>
  </section>

  <section>
    <label class="item">
      <span class="text"><strong>Instant replay</strong><small>Keep the last {store.settings.replayMinutes} minutes of each tab on this computer, so you can share a bug after it happened. Nothing leaves the browser until you create a capture.</small></span>
      <Switch label="Instant replay" checked={store.settings.instantReplay} onchange={(v) => store.updateSettings({ instantReplay: v })} id="set-replay" />
    </label>
    {#if store.settings.instantReplay}
      <div class="item sub">
        <span class="text"><strong>Replay length</strong></span>
        <select
          aria-label="Replay length"
          value={store.settings.replayMinutes}
          onchange={(e) => store.updateSettings({ replayMinutes: Number((e.currentTarget as HTMLSelectElement).value) })}
          data-replay-minutes
        >
          {#each [1, 2, 3, 4, 5] as m (m)}<option value={m}>{m} min</option>{/each}
        </select>
      </div>
      <button class="item sub nav" type="button" data-open-sites onclick={() => (store.screen = 'sites')}>
        <span class="text"><strong>Blocked sites</strong><small>No replay is kept on these sites.</small></span>
        <span class="count">{store.settings.replayBlockedSites.length}</span>
        <Icon name="chevron-right" size={16} />
      </button>
    {/if}
  </section>

  <section>
    <label class="item">
      <span class="text"><strong>Send error reports</strong><small>Send extension errors to your server admin.</small></span>
      <Switch label="Send error reports" checked={store.settings.sendErrorLogs} onchange={(v) => store.updateSettings({ sendErrorLogs: v })} id="set-error-logs" />
    </label>
    <div class="item">
      <span class="text"><strong>Server</strong><small data-server-url>{store.serverUrl}</small></span>
      <button class="link" type="button" onclick={openOptions}>Change</button>
    </div>
  </section>

  <section>
    <div class="item">
      <span class="text"><strong>Reset extension</strong><small>Settings go back to their defaults. Drafts and sign-in stay.</small></span>
      <button class="reset" class:confirm={confirmReset} type="button" data-reset onclick={reset} onblur={() => (confirmReset = false)}>
        {confirmReset ? 'Confirm reset' : 'Reset'}
      </button>
    </div>
    {#if note}<p class="note" role="status">{note}</p>{/if}
  </section>
</div>

<style>
  .settings {
    max-height: 560px;
    overflow-x: hidden;
    overflow-y: auto;
    margin: 0 -15px;
    padding: 0 15px 4px;
  }
  section {
    border-top: 1px solid var(--nb-border);
    padding: 4px 0;
  }
  section:first-of-type {
    border-top: 0;
  }
  .item {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
  }
  .item.sub {
    padding-left: 12px;
  }
  .item.nav {
    cursor: pointer;
    border-radius: var(--nb-radius-sm);
  }
  .item.nav:hover {
    background: var(--nb-surface-sunken);
  }
  .text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  strong {
    font: var(--nb-weight-medium) var(--nb-text-base) / 1.3 var(--nb-font-sans);
  }
  small {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-sm);
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  .count {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
  .link {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--nb-accent-text);
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .link:focus-visible,
  .reset:focus-visible {
    outline: 2px solid var(--nb-focus);
  }
  select {
    height: 28px;
    padding: 0 6px;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-sm);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-md) var(--nb-font-sans);
  }
  .reset {
    all: unset;
    height: 28px;
    padding: 0 12px;
    border-radius: var(--nb-radius-md);
    border: 1px solid var(--nb-border-strong);
    background: var(--nb-surface);
    box-shadow: var(--nb-shadow-sm);
    font: var(--nb-weight-medium) var(--nb-text-md) / 26px var(--nb-font-sans);
    cursor: pointer;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .reset:hover:not(.confirm) {
    background: var(--nb-surface-sunken);
  }
  .reset.confirm {
    background: var(--nb-danger);
    border-color: var(--nb-danger);
    color: var(--nb-on-danger);
  }
  .note {
    margin: 0 0 8px;
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
</style>
