<script lang="ts">
  // Dark tooltip pill above its child after a short dwell, with an optional key badge (J-050).
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    keys?: string;
    delay?: number;
    placement?: 'top' | 'bottom';
    children: Snippet;
  }
  let { label, keys, delay = 600, placement = 'top', children }: Props = $props();
  let open = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function enter() {
    clearTimeout(timer);
    timer = setTimeout(() => (open = true), delay);
  }
  function leave() {
    clearTimeout(timer);
    open = false;
  }
</script>

<span class="nb-tip-wrap" role="presentation" onpointerenter={enter} onpointerleave={leave} onpointerdown={leave}>
  {@render children()}
  {#if open}
    <span class="nb-tip nb-tip-{placement}" role="tooltip" data-testid="tooltip">
      {label}
      {#if keys}<kbd>{keys}</kbd>{/if}
    </span>
  {/if}
</span>

<style>
  .nb-tip-wrap {
    position: relative;
    display: inline-flex;
  }
  .nb-tip {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: var(--nb-radius-sm);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    font: var(--nb-weight-medium) var(--nb-text-sm) / 1 var(--nb-font-sans);
    white-space: nowrap;
    pointer-events: none;
    z-index: 20;
    box-shadow: var(--nb-shadow-md);
  }
  .nb-tip-top {
    bottom: calc(100% + 8px);
  }
  .nb-tip-bottom {
    top: calc(100% + 8px);
  }
  kbd {
    font: var(--nb-text-xs) / 1 var(--nb-font-mono);
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--nb-chrome-2);
    color: var(--nb-on-chrome);
    border: 1px solid rgb(255 255 255 / 0.14);
  }
</style>
