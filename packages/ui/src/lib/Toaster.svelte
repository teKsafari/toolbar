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
    <!-- data-nb-interactive: over a host page the extension's pointer guard (a picking tool on) lets clicks through to it -->
    <div class="nb-toast nb-{t.kind}" role={t.kind === 'error' ? 'alert' : 'status'} data-kind={t.kind} data-nb-interactive>
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
  /* teksafari.org toasts (D-175): a surface card with a quiet edge, 16 px radius, the floating
     shadow; the status shows in the icon colour only. */
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
    gap: 10px;
    min-width: 240px;
    max-width: 420px;
    padding: 12px 12px 12px 16px;
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-xl);
    background: var(--nb-surface-raised);
    color: var(--nb-text);
    box-shadow: var(--nb-shadow-lg);
    font: var(--nb-weight-medium) var(--nb-text-base) / var(--nb-leading-tight) var(--nb-font-sans);
    animation: nb-slide var(--nb-dur-med) var(--nb-ease-out);
  }
  .nb-ticon { display: inline-flex; color: var(--nb-text-muted); }
  .nb-success .nb-ticon { color: var(--nb-success); }
  .nb-error .nb-ticon { color: var(--nb-danger); }
  .nb-info .nb-ticon { color: var(--nb-info); }
  .nb-msg { flex: 1; }
  .nb-act, .nb-x {
    all: unset;
    cursor: pointer;
    border-radius: var(--nb-radius-sm);
    color: var(--nb-text);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .nb-act {
    padding: 0 10px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--nb-border-strong);
    background: var(--nb-surface);
    box-shadow: var(--nb-shadow-sm);
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
  }
  .nb-x { display: grid; place-items: center; width: 24px; height: 24px; color: var(--nb-text-muted); }
  @media (hover: hover) {
    .nb-act:hover { background: var(--nb-surface-sunken); }
    .nb-x:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  }
  .nb-act:focus-visible, .nb-x:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
  @keyframes nb-slide {
    from { opacity: 0; transform: translateY(8px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nb-toast { animation: none; }
  }
</style>
