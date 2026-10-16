<script lang="ts" generics="T extends string | number">
  // Segmented control: one choice out of a few, e.g. the screenshot delay or the record mode.
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons.ts';

  interface Option {
    value: T;
    label: string;
    icon?: IconName;
  }
  interface Props {
    options: Option[];
    value: T;
    label: string;
    onchange?: (value: T) => void;
  }
  let { options, value = $bindable(), label, onchange }: Props = $props();

  function pick(v: T) {
    value = v;
    onchange?.(v);
  }
</script>

<div class="nb-seg" role="radiogroup" aria-label={label}>
  {#each options as o (o.value)}
    <button
      class="nb-opt"
      class:sel={o.value === value}
      type="button"
      role="radio"
      aria-checked={o.value === value}
      data-value={o.value}
      onclick={() => pick(o.value)}
    >
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}
      <span>{o.label}</span>
    </button>
  {/each}
</div>

<style>
  .nb-seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-surface-sunken);
    border: 1px solid var(--nb-border);
  }
  .nb-opt {
    all: unset;
    flex: 1;
    box-sizing: border-box;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 var(--nb-space-3);
    border-radius: var(--nb-radius-pill);
    cursor: pointer;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
    color: var(--nb-text-muted);
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
  }
  .nb-opt:hover {
    color: var(--nb-text);
  }
  .nb-opt.sel {
    background: var(--nb-surface);
    color: var(--nb-text);
    box-shadow: 0 0 0 1px var(--nb-border-strong), var(--nb-shadow-sm);
  }
  .nb-opt:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 1px;
  }
</style>
