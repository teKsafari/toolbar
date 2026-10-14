<script lang="ts">
  // Small centred modal (ergonomics: autofocused field, grey cancel, coloured confirm that stays
  // disabled until valid, Enter submits). Built on <dialog> so Escape and focus trapping are native.
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    title: string;
    width?: number;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
    testid?: string;
  }
  let { open = $bindable(false), title, width = 420, onclose, children, footer, testid }: Props = $props();
  let dialog: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      queueMicrotask(() => {
        const f = dialog?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]):not([disabled]), textarea, select');
        f?.focus();
        if (f instanceof HTMLInputElement && f.dataset.select !== undefined) f.select();
      });
    } else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="nb-modal"
  style="--w:{width}px"
  aria-label={title}
  data-testid={testid}
  onclose={() => {
    open = false;
    onclose?.();
  }}
  onclick={(e) => {
    if (e.target === dialog) dialog?.close();
  }}
>
  <div class="inner">
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
    {#if footer}<div class="foot">{@render footer()}</div>{/if}
  </div>
</dialog>

<style>
  .nb-modal {
    width: min(var(--w), calc(100vw - 24px)); padding: 0; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-xl);
    background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-lg);
  }
  .nb-modal::backdrop { background: var(--nb-overlay); }
  .nb-modal[open] { animation: m-in var(--nb-dur-med) var(--nb-ease-out); }
  @keyframes m-in { from { opacity: 0; transform: translateY(4px) scale(0.99); } }
  .inner { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  h2 { margin: 0; font-size: var(--nb-text-lg); }
  .body { display: flex; flex-direction: column; gap: 10px; }
  .foot { display: flex; justify-content: flex-end; gap: 8px; }
  @media (prefers-reduced-motion: reduce) { .nb-modal[open] { animation: none; } }
</style>
