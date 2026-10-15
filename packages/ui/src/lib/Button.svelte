<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons.ts';

  interface Props extends HTMLButtonAttributes {
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'chrome';
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    /** Icon-only button; requires an aria-label or title. */
    iconOnly?: boolean;
    loading?: boolean;
    /** Keyboard hint shown at the end, e.g. "Ctrl+Enter". */
    kbd?: string;
    children?: Snippet;
  }
  let {
    variant = 'secondary',
    size = 'md',
    icon,
    iconOnly = false,
    loading = false,
    kbd,
    type = 'button',
    disabled,
    children,
    class: cls = '',
    ...rest
  }: Props = $props();
</script>

<button
  {type}
  class="nb-btn nb-{variant} nb-{size} {cls}"
  class:nb-icon-only={iconOnly}
  disabled={disabled || loading}
  aria-busy={loading || undefined}
  {...rest}
>
  {#if loading}
    <Icon name="spinner" size={size === 'sm' ? 14 : 16} />
  {:else if icon}
    <Icon name={icon} size={size === 'sm' ? 14 : 16} />
  {/if}
  {#if children && !iconOnly}<span class="nb-label">{@render children()}</span>{/if}
  {#if kbd && !iconOnly}<kbd>{kbd}</kbd>{/if}
</button>

<style>
  .nb-btn {
    all: unset;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--nb-space-2);
    border-radius: var(--nb-radius-md);
    border: 1px solid transparent;
    font: var(--nb-weight-medium) var(--nb-text-base) / 1 var(--nb-font-sans);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    transition:
      background var(--nb-dur-fast) var(--nb-ease-out),
      border-color var(--nb-dur-fast) var(--nb-ease-out),
      color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .nb-btn:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  .nb-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .nb-sm { height: var(--nb-control-sm); padding: 0 var(--nb-space-2); font-size: var(--nb-text-md); }
  .nb-md { height: var(--nb-control-md); padding: 0 var(--nb-space-3); }
  .nb-lg { height: var(--nb-control-lg); padding: 0 var(--nb-space-4); }
  .nb-icon-only.nb-sm { width: var(--nb-control-sm); padding: 0; }
  .nb-icon-only.nb-md { width: var(--nb-control-md); padding: 0; }
  .nb-icon-only.nb-lg { width: var(--nb-control-lg); padding: 0; }

  .nb-primary { background: var(--nb-accent); color: var(--nb-on-accent); }
  /* a faded accent fill made the label unreadable in dark mode (G7 bug 8): a quiet neutral fill instead */
  .nb-primary:disabled { opacity: 1; background: var(--nb-surface-sunken); color: var(--nb-text-muted); }
  .nb-primary:hover:not(:disabled) { background: var(--nb-accent-hover); }
  .nb-secondary { background: var(--nb-surface); color: var(--nb-text); border-color: var(--nb-border-strong); }
  .nb-secondary:hover:not(:disabled) { background: var(--nb-surface-sunken); }
  .nb-ghost { background: transparent; color: var(--nb-text-muted); }
  .nb-ghost:hover:not(:disabled) { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .nb-danger { background: var(--nb-danger); color: var(--nb-on-danger); }
  .nb-danger:hover:not(:disabled) { background: var(--nb-danger-hover); }
  .nb-chrome { background: transparent; color: var(--nb-on-chrome); }
  .nb-chrome:hover:not(:disabled) { background: var(--nb-chrome-2); }

  kbd {
    font: var(--nb-text-xs) / 1 var(--nb-font-mono);
    padding: 2px 4px;
    border-radius: 4px;
    background: rgb(0 0 0 / 0.12);
    opacity: 0.85;
  }
</style>
