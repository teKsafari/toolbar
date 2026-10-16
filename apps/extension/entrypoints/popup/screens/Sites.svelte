<script lang="ts">
  // Instant replay blocked sites (J-012): ships with a default list; add by domain, remove with
  // the trash icon. The ring keeps nothing on these sites.
  import { Icon } from '@toolbar/ui';
  import { normalizeDomain } from '@toolbar/shared/areas/ext-ui';
  import { store } from '../lib/store.svelte';
  import ScreenHead from '../lib/ScreenHead.svelte';

  let input = $state('');
  let error = $state('');
  const sites = $derived(store.settings.replayBlockedSites);

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const d = normalizeDomain(input);
    if (!d) {
      error = 'Type a domain such as example.com';
      return;
    }
    error = '';
    input = '';
    if (!sites.includes(d)) await store.updateSettings({ replayBlockedSites: [d, ...sites] });
  }
  const remove = (d: string) => store.updateSettings({ replayBlockedSites: sites.filter((x) => x !== d) });
</script>

<div data-screen="sites">
  <ScreenHead title="Blocked sites" onback={() => (store.screen = 'settings')} />
  <form class="add" onsubmit={add}>
    <input type="text" placeholder="example.com" aria-label="Domain to block" bind:value={input} data-site-input />
    <button type="submit" data-site-add disabled={!input.trim()}>Add</button>
  </form>
  {#if error}<p class="err" role="alert">{error}</p>{/if}
  <ul class="list" data-site-list>
    {#each sites as d (d)}
      <li data-site={d}>
        <Icon name="globe" size={14} />
        <span>{d}</span>
        <button type="button" aria-label="Remove {d}" data-site-remove={d} onclick={() => remove(d)}><Icon name="trash" size={14} /></button>
      </li>
    {:else}
      <li class="empty">No blocked sites. Replay runs everywhere.</li>
    {/each}
  </ul>
</div>

<style>
  .add {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    height: 34px;
    padding: 0 10px;
    box-sizing: border-box;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    color: var(--nb-text);
    font: var(--nb-text-base) var(--nb-font-sans);
  }
  input {
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
  form button {
    all: unset;
    height: 34px;
    padding: 0 14px;
    border-radius: var(--nb-radius-md);
    background: var(--nb-accent);
    color: var(--nb-on-accent);
    box-shadow: var(--nb-shadow-primary);
    font: var(--nb-weight-medium) var(--nb-text-base) / 34px var(--nb-font-sans);
    cursor: pointer;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  form button:hover:not(:disabled) {
    background: var(--nb-accent-hover);
  }
  form button:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  form button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .err {
    margin: 6px 0 0;
    color: var(--nb-danger);
    font-size: var(--nb-text-md);
  }
  .list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    max-height: 420px;
    overflow-y: auto;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    color: var(--nb-text-muted);
    border-bottom: 1px solid var(--nb-border);
  }
  li span {
    flex: 1;
    color: var(--nb-text);
    font-size: var(--nb-text-md);
  }
  li button {
    all: unset;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: var(--nb-radius-sm);
    cursor: pointer;
    color: var(--nb-text-faint);
  }
  li button:hover {
    color: var(--nb-danger-text);
    background: var(--nb-danger-tint);
  }
  .empty {
    justify-content: center;
    border: 0;
    height: 48px;
  }
</style>
