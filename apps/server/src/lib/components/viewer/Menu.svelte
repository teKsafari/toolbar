<script lang="ts" module>
  export interface MenuItem {
    id: string;
    label: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    hint?: string;
    /** nested items open as a submenu */
    items?: MenuItem[];
    run?: () => void;
  }
</script>

<script lang="ts">
  // Dark menu with 24 px rows and leading line icons (ergonomics: "Menus are dark").
  import VIcon from './VIcon.svelte';
  import Self from './Menu.svelte';

  interface Props {
    items: MenuItem[];
    onpick?: () => void;
    label?: string;
  }
  let { items, onpick, label = 'Menu' }: Props = $props();
  let sub: string | null = $state(null);
</script>

<div class="menu" role="menu" aria-label={label}>
  {#each items as it (it.id)}
    {#if it.items}
      <div class="subwrap" role="none" onmouseenter={() => (sub = it.id)} onmouseleave={() => (sub = null)}>
        <button type="button" role="menuitem" class="row" aria-haspopup="menu" aria-expanded={sub === it.id} onclick={() => (sub = it.id)}>
          {#if it.icon}<VIcon name={it.icon as never} size={14} />{/if}
          <span class="lbl">{it.label}</span>
          <VIcon name="chevron-right" size={12} />
        </button>
        {#if sub === it.id}
          <div class="sub"><Self items={it.items} {onpick} label={it.label} /></div>
        {/if}
      </div>
    {:else}
      <button type="button" role="menuitem" class="row" class:danger={it.danger} disabled={it.disabled} onclick={() => { it.run?.(); onpick?.(); }}>
        {#if it.icon}<VIcon name={it.icon as never} size={14} />{/if}
        <span class="lbl">{it.label}</span>
        {#if it.hint}<span class="hint">{it.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .menu {
    min-width: 180px; padding: 4px; border-radius: var(--nb-radius-md);
    background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: var(--nb-shadow-lg);
    display: flex; flex-direction: column; font-size: var(--nb-text-md);
  }
  .row {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
    min-height: 24px; padding: 2px 8px; border-radius: var(--nb-radius-sm); cursor: pointer; white-space: nowrap;
  }
  .row:hover, .row:focus-visible { background: var(--nb-chrome-2); }
  .row:disabled { opacity: 0.45; cursor: default; }
  .danger { color: #ff8a7d; }
  .lbl { flex: 1; }
  .hint { color: var(--nb-on-chrome-muted); font-size: var(--nb-text-xs); }
  .subwrap { position: relative; }
  .sub { position: absolute; left: calc(100% + 2px); top: -4px; z-index: 5; }
</style>
