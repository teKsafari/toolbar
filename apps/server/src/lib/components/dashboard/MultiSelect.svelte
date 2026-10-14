<script lang="ts">
  // A filter button that opens a searchable multi-select popover (J-160).
  import { Popover } from '@toolbar/ui';
  import DIcon from './DIcon.svelte';
  import UserAvatar from './UserAvatar.svelte';

  interface Option {
    value: string;
    label: string;
    sub?: string;
    avatar?: { name: string; image: string | null };
  }
  interface Props {
    label: string;
    options: Option[];
    selected: string[];
    onchange: (values: string[]) => void;
    searchable?: boolean;
    testid?: string;
  }
  let { label, options, selected, onchange, searchable = true, testid }: Props = $props();
  let q = $state('');
  const shown = $derived(options.filter((o) => !q.trim() || `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())));

  function toggle(v: string) {
    onchange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }
</script>

<Popover label={label} placement="bottom-start" onclose={() => (q = '')}>
  {#snippet trigger({ toggle: t, open, id })}
    <button class="fb" class:has={selected.length > 0} onclick={t} aria-expanded={open} aria-controls={id} data-testid={testid}>
      {label}{#if selected.length}<span class="n">{selected.length}</span>{/if}<DIcon name="chevron-down" size={12} />
    </button>
  {/snippet}
  {#snippet children()}
    <div class="ms" role="listbox" aria-multiselectable="true" aria-label={label}>
      {#if searchable && options.length > 5}
        <!-- svelte-ignore a11y_autofocus -->
        <input class="q" bind:value={q} placeholder="Search" aria-label="Search {label.toLowerCase()}" autofocus />
      {/if}
      {#each shown as o (o.value)}
        <button role="option" aria-selected={selected.includes(o.value)} class="opt" onclick={() => toggle(o.value)} data-value={o.value}>
          <span class="box">{#if selected.includes(o.value)}<DIcon name="check" size={12} />{/if}</span>
          {#if o.avatar}<UserAvatar name={o.avatar.name} image={o.avatar.image} size={20} />{/if}
          <span class="l">{o.label}</span>
          {#if o.sub}<span class="s">{o.sub}</span>{/if}
        </button>
      {:else}
        <div class="none">No matches</div>
      {/each}
    </div>
  {/snippet}
</Popover>

<style>
  .fb {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px;
    border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text);
    font-size: var(--nb-text-md); cursor: pointer; white-space: nowrap;
  }
  .fb:hover { background: var(--nb-surface-sunken); }
  .fb:focus-visible { outline: 2px solid var(--nb-focus); }
  .fb.has { border-color: var(--nb-accent); }
  .n { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 9px; background: var(--nb-accent); color: var(--nb-on-accent); font-size: var(--nb-text-xs); }
  .ms { display: flex; flex-direction: column; gap: 1px; width: 240px; max-height: 320px; overflow-y: auto; }
  .q { height: 30px; margin-bottom: 4px; font-size: var(--nb-text-md); }
  .opt { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--nb-radius-md); cursor: pointer; }
  .opt:hover, .opt:focus-visible { background: var(--nb-surface-sunken); }
  .box { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 4px; border: 1px solid var(--nb-border-strong); color: var(--nb-on-accent); flex: none; }
  .opt[aria-selected='true'] .box { background: var(--nb-accent); border-color: var(--nb-accent); }
  .l { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s { font-size: var(--nb-text-xs); color: var(--nb-text-faint); }
  .none { padding: 8px; color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
</style>
