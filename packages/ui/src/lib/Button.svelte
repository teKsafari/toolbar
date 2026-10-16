<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from '../icons.ts';

  interface Props extends HTMLButtonAttributes {
    /**
     * primary: the accent fill, one per action group. secondary: surface with a border and lift.
     * ghost: quiet, washes on hover. danger: destructive. chrome: quiet on the dark chrome bar.
     * inverted: the chrome's primary (the accent's dark-theme shade, near-white by default).
     */
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'chrome' | 'inverted';
    /** sm 28 px, md 32 px, lg 36 px (forms), touch 40 px (popup main actions, touch). */
    size?: 'sm' | 'md' | 'lg' | 'touch';
    /** pill: content actions, filter chips, invitations; chrome and toolbars stay rect. */
    shape?: 'rect' | 'pill';
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
    shape = 'rect',
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
  class:nb-pill={shape === 'pill'}
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
  /* teksafari.org buttons (D-175): 1 px border, hairline lift, 150 ms on listed properties,
     a 1 px press. Focus keeps a solid 2 px outline (>= 3:1) rather than the site's 25 % ring. */
  .nb-btn {
    all: unset;
    box-sizing: border-box;
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--nb-space-2);
    border-radius: var(--nb-radius-sm);
    border: 1px solid transparent;
    font: var(--nb-weight-medium) var(--nb-text-base) / 1 var(--nb-font-sans);
    letter-spacing: var(--nb-tracking-ui);
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    transition:
      background-color var(--nb-dur-fast) var(--nb-ease-out),
      border-color var(--nb-dur-fast) var(--nb-ease-out),
      color var(--nb-dur-fast) var(--nb-ease-out),
      box-shadow var(--nb-dur-fast) var(--nb-ease-out),
      translate var(--nb-dur-fast) var(--nb-ease-out);
  }
  .nb-btn:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  .nb-btn:active:not(:disabled) {
    translate: 0 1px;
  }
  .nb-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .nb-sm { height: var(--nb-control-sm); padding: 0 10px; font-size: var(--nb-text-md); }
  .nb-md { height: var(--nb-control-md); padding: 0 var(--nb-space-3); }
  .nb-lg { height: var(--nb-control-lg); padding: 0 14px; border-radius: var(--nb-radius-md); }
  .nb-touch { height: var(--nb-control-touch); padding: 0 var(--nb-space-4); border-radius: var(--nb-radius-md); }
  .nb-pill { border-radius: var(--nb-radius-pill); }
  .nb-pill.nb-sm { padding: 0 14px; }
  .nb-pill.nb-md { padding: 0 var(--nb-space-4); }
  .nb-pill.nb-lg { padding: 0 18px; }
  .nb-pill.nb-touch { padding: 0 var(--nb-space-5); }
  .nb-icon-only.nb-sm { width: var(--nb-control-sm); padding: 0; }
  .nb-icon-only.nb-md { width: var(--nb-control-md); padding: 0; }
  .nb-icon-only.nb-lg { width: var(--nb-control-lg); padding: 0; }
  .nb-icon-only.nb-touch { width: var(--nb-control-touch); padding: 0; }

  .nb-primary { background: var(--nb-accent); color: var(--nb-on-accent); box-shadow: var(--nb-shadow-primary); }
  /* a faded accent fill made the label unreadable in dark mode (G7 bug 8): a quiet neutral fill instead */
  .nb-primary:disabled { opacity: 1; background: var(--nb-surface-sunken); color: var(--nb-text-muted); box-shadow: none; border-color: var(--nb-border); }
  .nb-primary:active:not(:disabled) { background: var(--nb-accent-active); }
  .nb-secondary { background: var(--nb-surface); color: var(--nb-text); border-color: var(--nb-border-strong); box-shadow: var(--nb-shadow-sm); }
  .nb-secondary:active:not(:disabled) { background: var(--nb-surface-sunken); }
  .nb-ghost { background: transparent; color: var(--nb-text-muted); }
  .nb-danger { background: var(--nb-danger); color: var(--nb-on-danger); box-shadow: var(--nb-shadow-primary); }
  .nb-chrome { background: transparent; color: var(--nb-on-chrome); }
  .nb-inverted { background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); box-shadow: var(--nb-shadow-primary); }
  @media (hover: hover) {
    .nb-primary:hover:not(:disabled):not(:active) { background: var(--nb-accent-hover); }
    .nb-secondary:hover:not(:disabled) { background: var(--nb-surface-sunken); border-color: color-mix(in srgb, var(--nb-text-faint) 55%, var(--nb-border-strong)); }
    .nb-ghost:hover:not(:disabled) { background: var(--nb-surface-sunken); color: var(--nb-text); }
    .nb-danger:hover:not(:disabled) { background: var(--nb-danger-hover); }
    .nb-chrome:hover:not(:disabled) { background: var(--nb-chrome-2); }
    .nb-inverted:hover:not(:disabled) { background: var(--nb-chrome-accent-hover); }
  }
  .nb-chrome:focus-visible, .nb-inverted:focus-visible { outline-color: var(--nb-on-chrome); }
  @media (prefers-reduced-motion: reduce) {
    .nb-btn { transition: none; }
    .nb-btn:active:not(:disabled) { translate: none; }
  }

  kbd {
    font: var(--nb-text-xs) / 1 var(--nb-font-mono);
    padding: 2px 4px;
    border-radius: 4px;
    background: color-mix(in srgb, currentColor 14%, transparent);
    opacity: 0.85;
  }
</style>
