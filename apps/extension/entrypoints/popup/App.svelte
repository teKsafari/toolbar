<script lang="ts">
  // Capture menu (J-001): one row per mode, header with home and menu buttons.
  // Rows message the service worker; the capture area agent implements each mode.
  import { browser } from 'wxt/browser';
  import { Button, Icon, type IconName } from '@toolbar/ui';
  import { COMMANDS, DEFAULT_SERVER_URL, PRODUCT_NAME } from '@toolbar/shared';
  import type { BgRequest } from '../../lib/messages';
  import AccountCard from '../../lib/auth/AccountCard.svelte';

  type Mode = Extract<BgRequest, { type: 'capture' }>['mode'];
  const rows: { mode: Mode; label: string; icon: IconName; key: string | null }[] = [
    { mode: 'screenshot', label: 'Screenshot', icon: 'screenshot', key: COMMANDS['screenshot-mode'].key },
    { mode: 'video', label: 'Record tab', icon: 'record', key: COMMANDS['record-tab'].key },
    { mode: 'replay', label: 'Instant replay', icon: 'replay', key: COMMANDS['instant-replay'].key },
    { mode: 'link', label: 'Recording link', icon: 'link', key: null },
  ];
  let status = $state('');

  async function start(mode: Mode) {
    const r = (await browser.runtime.sendMessage({ type: 'capture', mode } satisfies BgRequest)) as { ok: boolean; error?: string };
    status = r.ok ? '' : `${mode}: not built yet`;
  }
  const openHome = () => browser.tabs.create({ url: DEFAULT_SERVER_URL });
</script>

<main>
  <header>
    <span class="brand"><Icon name="logo" size={18} /> {PRODUCT_NAME}</span>
    <span class="actions">
      <Button variant="ghost" size="sm" icon="home" iconOnly aria-label="Open dashboard" onclick={openHome} />
      <Button variant="ghost" size="sm" icon="more" iconOnly aria-label="Menu" />
    </span>
  </header>
  <AccountCard />
  <ul>
    {#each rows as r (r.mode)}
      <li>
        <button class="row" onclick={() => start(r.mode)} title={r.key ?? undefined} data-mode={r.mode}>
          <Icon name={r.icon} size={16} />
          <span>{r.label}</span>
          {#if r.key}<kbd>{r.key}</kbd>{/if}
        </button>
      </li>
    {/each}
  </ul>
  {#if status}<p class="status" role="status">{status}</p>{/if}
</main>

<style>
  main { padding: 8px 15px 15px; }
  header { display: flex; align-items: center; justify-content: space-between; height: 40px; }
  .brand { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--nb-accent-text); }
  .actions { display: inline-flex; gap: 2px; }
  ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .row {
    all: unset; box-sizing: border-box; width: 100%; height: 40px; padding: 0 12px;
    display: flex; align-items: center; gap: 10px; cursor: pointer;
    border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md);
  }
  .row:hover { background: var(--nb-surface-sunken); }
  .row:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
  .row span { flex: 1; }
  kbd { font: 11px var(--nb-font-mono); color: var(--nb-text-faint); }
  .status { margin: 8px 0 0; color: var(--nb-text-muted); font-size: 12px; }
</style>
