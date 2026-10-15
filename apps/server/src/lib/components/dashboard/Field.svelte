<script lang="ts">
  // One settings row: label and hint on the left, the control on the right.
  import type { Snippet } from 'svelte';
  let { label, hint, children, badge }: { label: string; hint?: string; children: Snippet; badge?: string } = $props();
</script>

<div class="f">
  <div class="l">
    <span class="lab">{label}{#if badge}<span class="badge">{badge}</span>{/if}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </div>
  <div class="c">{@render children()}</div>
</div>

<style>
  .f { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .l { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .lab { font-weight: var(--nb-weight-medium); display: inline-flex; align-items: center; gap: 8px; }
  .hint { font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .c { flex: none; display: flex; align-items: center; gap: 8px; }
  .badge { font-size: var(--nb-text-xs); font-weight: var(--nb-weight-normal); padding: 1px 6px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-pill); color: var(--nb-text-muted); }
  /* On a phone a switch or a button stays at the right end of its row; only wide controls
     (text fields, selects) move under their label (J-124, J-172, J-173). */
  @media (max-width: 560px) {
    .f { align-items: flex-start; }
    .f:has(.c :global(:is(input:not([type='checkbox']):not([type='radio']), select, textarea))) { flex-direction: column; align-items: stretch; }
    .c { justify-content: flex-start; }
  }
</style>
