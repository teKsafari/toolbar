<script lang="ts">
  // Header of a screen that replaces the popup body: back arrow and a heading.
  import { Icon } from '@toolbar/ui';
  interface Props {
    title: string;
    onback: () => void;
  }
  let { title, onback }: Props = $props();
</script>

<div class="head">
  <button class="back" type="button" aria-label="Back" data-back onclick={onback}><Icon name="arrow-left" size={16} /></button>
  <h2>{title}</h2>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .back {
    all: unset;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--nb-radius-sm);
    cursor: pointer;
    color: var(--nb-text-muted);
  }
  .back:hover {
    background: var(--nb-surface-sunken);
    color: var(--nb-text);
  }
  .back:focus-visible {
    outline: 2px solid var(--nb-focus);
  }
  h2 {
    margin: 0;
    font: var(--nb-weight-semibold) var(--nb-text-lg) / 1.2 var(--nb-font-sans);
  }
</style>
