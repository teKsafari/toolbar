<script lang="ts">
  // Anchored dropdown holder: closes on Escape and outside press.
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    align?: 'start' | 'end';
    up?: boolean;
    onclose: () => void;
    children: Snippet;
    trigger: Snippet;
    class?: string;
  }
  let { open, align = 'start', up = false, onclose, children, trigger, class: cls = '' }: Props = $props();
  let root: HTMLElement | undefined = $state();
  $effect(() => {
    if (!open || !root) return;
    const onDown = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root)) onclose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<span class="dd {cls}" bind:this={root}>
  {@render trigger()}
  {#if open}
    <div class="pop" class:end={align === 'end'} class:up>{@render children()}</div>
  {/if}
</span>

<style>
  .dd { position: relative; display: inline-flex; }
  .pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; }
  .pop.end { left: auto; right: 0; }
  .pop.up { top: auto; bottom: calc(100% + 6px); }
</style>
