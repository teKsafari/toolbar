<script lang="ts">
  // Right-hand dev tools panel (J-090, J-091, J-109): info, console, network, actions and agent
  // tabs with red or green dots, the last used tab remembered, and the hide toggle.
  import VIcon from './VIcon.svelte';
  import InfoTab from './InfoTab.svelte';
  import ConsoleTab from './ConsoleTab.svelte';
  import NetworkTab from './NetworkTab.svelte';
  import ActionsTab from './ActionsTab.svelte';
  import AgentSlot from './AgentSlot.svelte';
  import { TABS, useViewer } from './viewer.svelte.ts';

  const v = useViewer();
</script>

<section class="panel" aria-label="Dev tools" data-testid="devtools">
  <div class="tabs" role="tablist">
    {#each TABS as t (t.id)}
      {@const st = v.tabState[t.id]}
      <button type="button" role="tab" aria-selected={v.tab === t.id} class:on={v.tab === t.id} onclick={() => v.setTab(t.id)} data-testid="tab-{t.id}">
        {t.label}{#if st !== 'none' && t.id !== 'info'}<span class="dot {st}" data-testid="dot-{t.id}" data-state={st}></span>{/if}
      </button>
    {/each}
    <span class="grow"></span>
    <button type="button" class="hide" onclick={() => v.toggleDevtools(false)} aria-label="Hide dev tools" title="Hide dev tools" data-testid="hide-devtools"><VIcon name="panel-right" size={16} /></button>
  </div>
  <div class="body" role="tabpanel">
    {#if v.eventsError}<div class="vp-note">Logs could not be loaded: {v.eventsError}</div>{/if}
    {#if v.tab === 'info'}<InfoTab />
    {:else if v.tab === 'console'}<ConsoleTab />
    {:else if v.tab === 'network'}<NetworkTab />
    {:else if v.tab === 'actions'}<ActionsTab />
    {:else}<AgentSlot />{/if}
  </div>
</section>

<style>
  .panel { display: flex; flex-direction: column; height: 100%; min-height: 0; background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); overflow: hidden; }
  .tabs { display: flex; align-items: center; gap: 2px; padding: 0 6px 0 8px; border-bottom: 1px solid var(--nb-border); overflow-x: auto; scrollbar-width: none; flex: none; }
  .tabs button[role='tab'] { all: unset; display: inline-flex; align-items: center; gap: 5px; padding: 10px 8px 8px; font-size: var(--nb-text-base); letter-spacing: var(--nb-tracking-ui); color: var(--nb-text-muted); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; transition: color var(--nb-dur-fast) var(--nb-ease-out), border-color var(--nb-dur-fast) var(--nb-ease-out); }
  .tabs button[role='tab']:hover { color: var(--nb-text); }
  .tabs button.on { color: var(--nb-text); border-bottom-color: var(--nb-text); font-weight: var(--nb-weight-medium); }
  .tabs button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; }
  .dot.error { background: var(--nb-danger); }
  .dot.ok { background: var(--nb-success); }
  .grow { flex: 1; }
  .hide { all: unset; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--nb-radius-sm); color: var(--nb-text-muted); cursor: pointer; flex: none; transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out); }
  .hide:focus-visible { outline: 2px solid var(--nb-focus); }
  .hide:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
</style>
