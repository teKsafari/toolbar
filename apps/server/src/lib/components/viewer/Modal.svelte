<script lang="ts">
  // Small centred confirm dialog: autofocused confirm, Escape cancels, Enter confirms.
  import type { Snippet } from 'svelte';
  import { Button } from '@toolbar/ui';

  interface Props {
    title: string;
    confirmLabel: string;
    danger?: boolean;
    busy?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    children?: Snippet;
  }
  let { title, confirmLabel, danger = false, busy = false, onconfirm, oncancel, children }: Props = $props();
  let box: HTMLDivElement | undefined = $state();
  $effect(() => {
    box?.querySelector<HTMLButtonElement>('[data-confirm]')?.focus();
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') oncancel(); }} />

<div class="backdrop" role="presentation" onpointerdown={(e) => { if (e.target === e.currentTarget) oncancel(); }}>
  <div class="dlg" role="alertdialog" aria-modal="true" aria-label={title} bind:this={box}>
    <h2>{title}</h2>
    {#if children}<div class="body">{@render children()}</div>{/if}
    <div class="actions">
      <Button variant="secondary" onclick={oncancel}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} onclick={onconfirm} data-confirm>{confirmLabel}</Button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: var(--nb-overlay); padding: 16px; }
  .dlg { width: min(420px, 100%); padding: 20px; border-radius: var(--nb-radius-lg); background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-lg); }
  h2 { margin: 0 0 8px; font-size: var(--nb-text-lg); }
  .body { color: var(--nb-text-muted); margin-bottom: 16px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
