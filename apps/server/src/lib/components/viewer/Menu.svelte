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
    /* the site's dropdown: a surface card, edge border, floating shadow, 6 px inset */
    min-width: 180px; padding: 6px; border-radius: var(--nb-radius-lg); border: 1px solid var(--nb-border);
    background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-lg);
    display: flex; flex-direction: column; gap: 1px; font-size: var(--nb-text-md);
    animation: menu-in var(--nb-dur-med) var(--nb-ease-out); transform-origin: top;
  }
  @keyframes menu-in { from { opacity: 0; transform: scale(0.97); } }
  .row {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%;
    min-height: 30px; padding: 4px 8px; border-radius: var(--nb-radius-sm); cursor: pointer; white-space: nowrap;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .row:hover, .row:focus-visible { background: var(--nb-surface-sunken); }
  .row:disabled { opacity: 0.45; cursor: default; }
  .danger { color: var(--nb-danger); }
  .lbl { flex: 1; }
  .hint { color: var(--nb-text-faint); font: var(--nb-text-xs) var(--nb-font-mono); }
  .subwrap { position: relative; }
  .sub { position: absolute; left: calc(100% + 2px); top: -4px; z-index: 5; }
</style>
