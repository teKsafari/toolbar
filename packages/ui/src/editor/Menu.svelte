<script lang="ts" module>
  import type { EditorIconName } from './icons.ts';

  export interface MenuItem<V> {
    value: V;
    label: string;
    icon?: EditorIconName;
    hint?: string;
    disabled?: boolean;
    checked?: boolean;
    testid?: string;
  }
</script>

<script lang="ts" generics="T">
  // Small dark dropdown menu (ergonomics.md: menus are dark with 24 px rows and leading icons).
  import type { Snippet } from 'svelte';
  import EdIcon from './EdIcon.svelte';
  interface Props {
    items: MenuItem<T>[];
    onpick: (v: T) => void;
    trigger: Snippet<[{ toggle: () => void; open: boolean }]>;
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
    label: string;
    open?: boolean;
  }
  let { items, onpick, trigger, placement = 'bottom-start', label, open = $bindable(false) }: Props = $props();
  let root: HTMLDivElement | undefined = $state();
  let menu: HTMLDivElement | undefined = $state();

  function toggle() {
    open = !open;
  }

  $effect(() => {
    if (!open || !root) return;
    const doc = root.ownerDocument;
    const onDown = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root)) open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        open = false;
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const btns = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const i = btns.indexOf(doc.activeElement as HTMLButtonElement);
        const next = btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length];
        next?.focus();
      }
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<div class="nb-menu-wrap" bind:this={root}>
  {@render trigger({ toggle, open })}
  {#if open}
    <div class="nb-menu nb-{placement}" role="menu" aria-label={label} bind:this={menu}>
      {#each items as it, i (i)}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={!!it.checked}
          class="nb-mi"
          disabled={it.disabled}
          data-testid={it.testid}
          onclick={() => {
            open = false;
            onpick(it.value);
          }}
        >
          <span class="nb-mi-icon">{#if it.icon}<EdIcon name={it.icon} size={15} />{/if}</span>
          <span class="nb-mi-label">{it.label}</span>
          {#if it.hint}<span class="nb-mi-hint">{it.hint}</span>{/if}
          {#if it.checked}<EdIcon name="check" size={14} />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .nb-menu-wrap {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  .nb-menu {
    position: absolute;
    z-index: 40;
    min-width: 200px;
    max-height: 320px;
    overflow: auto;
    padding: 6px;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-raised);
    color: var(--nb-text);
    box-shadow: var(--nb-shadow-lg);
    animation: nb-menu-in var(--nb-dur-med) var(--nb-ease-out);
  }
  @keyframes nb-menu-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .nb-menu {
      animation: none;
    }
  }
  .nb-bottom-start { top: calc(100% + 4px); left: 0; }
  .nb-bottom-end { top: calc(100% + 4px); right: 0; }
  .nb-top-start { bottom: calc(100% + 4px); left: 0; }
  .nb-top-end { bottom: calc(100% + 4px); right: 0; }
  .nb-mi {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 4px 8px;
    border-radius: var(--nb-radius-sm);
    font: var(--nb-text-md) / 1.2 var(--nb-font-sans);
    cursor: pointer;
  }
  .nb-mi:hover:not(:disabled),
  .nb-mi:focus-visible {
    background: var(--nb-surface-sunken);
  }
  .nb-mi:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: -2px;
  }
  .nb-mi:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .nb-mi-icon {
    width: 16px;
    display: inline-flex;
    color: var(--nb-text-muted);
  }
  .nb-mi-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nb-mi-hint {
    color: var(--nb-text-faint);
    font-size: var(--nb-text-sm);
  }
</style>
