<script lang="ts">
  import Icon from './Icon.svelte';
  import { toasts, type ToastKind } from './toast.svelte.ts';
  import type { IconName } from '../icons.ts';

  interface Props {
    position?: 'bottom-right' | 'bottom-left' | 'top-right';
  }
  let { position = 'bottom-right' }: Props = $props();
  const iconFor: Record<ToastKind, IconName> = { info: 'info', success: 'check', error: 'warning', loading: 'spinner' };
</script>

<div class="nb-toaster nb-{position}" role="region" aria-label="Notifications" aria-live="polite">
  {#each toasts.items as t (t.id)}
    <div class="nb-toast nb-{t.kind}" role={t.kind === 'error' ? 'alert' : 'status'} data-kind={t.kind}>
      <span class="nb-ticon"><Icon name={iconFor[t.kind]} size={16} /></span>
      <span class="nb-msg">{t.message}</span>
      {#if t.action}
        <button class="nb-act" type="button" onclick={() => { t.action?.run(); toasts.dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="nb-x" type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(t.id)}>
        <Icon name="close" size={12} />
      </button>
    </div>
  {/each}
</div>

<style>
  .nb-toaster {
    position: fixed;
    z-index: var(--nb-z-overlay);
    display: flex;
    flex-direction: column;
    gap: var(--nb-space-2);
    pointer-events: none;
  }
  .nb-bottom-right { right: 16px; bottom: 16px; align-items: flex-end; }
  .nb-bottom-left { left: 16px; bottom: 16px; align-items: flex-start; }
  .nb-top-right { right: 16px; top: 16px; align-items: flex-end; }
  .nb-toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--nb-space-2);
    min-width: 240px;
    max-width: 420px;
    padding: 10px 12px;
    border-radius: var(--nb-radius-lg);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    box-shadow: var(--nb-shadow-lg);
    font: var(--nb-text-base) / var(--nb-leading-tight) var(--nb-font-sans);
    animation: nb-slide var(--nb-dur-med) var(--nb-ease-out);
  }
  .nb-success .nb-ticon { color: var(--nb-success); }
  .nb-error .nb-ticon { color: var(--nb-danger); }
  .nb-msg { flex: 1; }
  .nb-act, .nb-x {
    all: unset;
    cursor: pointer;
    border-radius: var(--nb-radius-sm);
    color: var(--nb-on-chrome);
  }
  .nb-act { padding: 4px 8px; background: var(--nb-chrome-2); font-weight: var(--nb-weight-medium); }
  .nb-x { display: grid; place-items: center; width: 20px; height: 20px; color: var(--nb-on-chrome-muted); }
  .nb-act:focus-visible, .nb-x:focus-visible { outline: 2px solid var(--nb-focus); }
  @keyframes nb-slide {
    from { opacity: 0; transform: translateX(12px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nb-toast { animation: none; }
  }
</style>
