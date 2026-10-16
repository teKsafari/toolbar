<script lang="ts">
  // Anchored popover. Closes on Escape and on a pointer press outside (shadow-root safe:
  // uses composedPath, so it works inside the extension's closed shadow root).
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'top' | 'bottom';
    /** The element that toggles the popover. Receives toggle() and the open state. */
    trigger: Snippet<[{ toggle: () => void; open: boolean; id: string }]>;
    children: Snippet<[{ close: () => void }]>;
    label?: string;
    onclose?: () => void;
  }
  let { open = $bindable(false), placement = 'bottom-start', trigger, children, label, onclose }: Props = $props();

  const id = `nb-pop-${Math.random().toString(36).slice(2, 9)}`;
  let root: HTMLElement | undefined = $state();

  function close() {
    if (!open) return;
    open = false;
    onclose?.();
  }
  function toggle() {
    if (open) close();
    else open = true;
  }

  $effect(() => {
    if (!open || !root) return;
    const doc = root.ownerDocument;
    const onDown = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
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

<span class="nb-pop-root" bind:this={root}>
  {@render trigger({ toggle, open, id })}
  {#if open}
    <div {id} class="nb-pop nb-{placement}" role="dialog" aria-label={label}>
      {@render children({ close })}
    </div>
  {/if}
</span>

<style>
  .nb-pop-root {
    position: relative;
    display: inline-flex;
  }
  .nb-pop {
    position: absolute;
    z-index: 10;
    min-width: 180px;
    padding: 6px;
    background: var(--nb-surface);
    color: var(--nb-text);
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-lg);
    box-shadow: var(--nb-shadow-lg);
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
    transform-origin: top left;
    animation: nb-pop-in var(--nb-dur-med) var(--nb-ease-out);
  }
  /* the site's dropdown: surface, quiet edge, 12 px radius, 6 px inset, the floating shadow */
  .nb-bottom-start { top: calc(100% + 6px); left: 0; }
  .nb-bottom-end { top: calc(100% + 6px); right: 0; transform-origin: top right; }
  .nb-bottom { top: calc(100% + 6px); left: 50%; translate: -50% 0; transform-origin: top center; }
  .nb-top-start { bottom: calc(100% + 6px); left: 0; transform-origin: bottom left; }
  .nb-top-end { bottom: calc(100% + 6px); right: 0; transform-origin: bottom right; }
  .nb-top { bottom: calc(100% + 6px); left: 50%; translate: -50% 0; transform-origin: bottom center; }
  @keyframes nb-pop-in {
    from { opacity: 0; transform: scale(0.97); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nb-pop { animation: none; }
  }
</style>
