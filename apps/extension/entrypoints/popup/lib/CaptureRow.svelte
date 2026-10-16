<script lang="ts">
  // One capture row (ergonomics.md): a full-width outlined button about 370x40, 16 px line icon,
  // 14 px label, and for rows with options a chevron in its own 40 px hit area split off by a
  // thin rule. Opening the chevron grows the row in place. Hovering about 2 s shows the
  // command's current chord above the row (J-212).
  import type { Snippet } from 'svelte';
  import { browser } from 'wxt/browser';
  import { Icon, type IconName } from '@toolbar/ui';
  import { SHORTCUT_TOOLTIP_DELAY_MS, chordLabel } from '@toolbar/shared/areas/ext-ui';

  interface Props {
    id: string;
    icon: IconName;
    label: string;
    tone?: 'default' | 'danger';
    disabled?: boolean;
    command?: string;
    open?: boolean;
    onclick: () => void;
    /** options shown under the row when the chevron is open */
    options?: Snippet;
    /** the row is a stop or exit row: its options do not apply */
    hideOptions?: boolean;
    /** extra inline content at the right of the label (mic pill, badges, help icon) */
    extra?: Snippet;
  }
  let { id, icon, label, tone = 'default', disabled = false, command, open = $bindable(false), onclick, options, hideOptions = false, extra }: Props = $props();

  let tip: string | null = $state(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function hoverStart() {
    if (!command || timer) return;
    timer = setTimeout(async () => {
      // query on every hover so a rebinding shows at once
      const all = await browser.commands.getAll();
      const c = all.find((x) => x.name === command);
      tip = chordLabel(c?.shortcut) ?? 'No shortcut set';
    }, SHORTCUT_TOOLTIP_DELAY_MS);
  }
  function hoverEnd() {
    if (timer) clearTimeout(timer);
    timer = null;
    tip = null;
  }
</script>

<div class="row-wrap" class:open data-row={id} data-tone={tone} aria-disabled={disabled}>
  {#if tip}<span class="tip" role="tooltip" data-row-tip>{tip}</span>{/if}
  <div class="row" class:danger={tone === 'danger'} class:disabled onpointerenter={hoverStart} onpointerleave={hoverEnd} role="group">
    <button class="main" type="button" {disabled} data-row-main={id} onclick={() => { hoverEnd(); onclick(); }}>
      <Icon name={icon} size={16} />
      <span class="label">{label}</span>
    </button>
    {#if extra}<span class="extra">{@render extra()}</span>{/if}
    {#if options && !hideOptions}
      <span class="rule"></span>
      <button class="chev" type="button" {disabled} aria-expanded={open} aria-label="{label} options" data-row-chevron={id} onclick={() => (open = !open)}>
        <Icon name="chevron-down" size={16} />
      </button>
    {/if}
  </div>
  {#if open && options && !disabled && !hideOptions}
    <div class="opts" data-row-options={id}>{@render options()}</div>
  {/if}
</div>

<style>
  .row-wrap {
    position: relative;
    border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md);
    background: var(--nb-surface);
    box-shadow: var(--nb-shadow-sm);
    transition: border-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .row-wrap:hover:not([aria-disabled='true']):not([data-tone='danger']) {
    border-color: color-mix(in srgb, var(--nb-text-faint) 55%, var(--nb-border-strong));
  }
  .row-wrap[data-tone='danger'] {
    border-color: var(--nb-danger);
  }
  .row-wrap[aria-disabled='true'] {
    opacity: 0.45;
  }
  .row {
    display: flex;
    align-items: center;
    height: 38px;
  }
  .main {
    all: unset;
    box-sizing: border-box;
    flex: 1;
    height: 100%;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    border-radius: var(--nb-radius-md);
    font: var(--nb-weight-medium) var(--nb-text-base) / 1 var(--nb-font-sans);
    color: var(--nb-text);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .main :global(svg) {
    color: var(--nb-text-muted);
  }
  .danger .main :global(svg) {
    color: inherit;
  }
  .danger .main {
    color: var(--nb-danger);
  }
  .main:disabled,
  .chev:disabled {
    cursor: default;
  }
  .main:hover:not(:disabled),
  .chev:hover:not(:disabled) {
    background: var(--nb-surface-sunken);
  }
  .main:focus-visible,
  .chev:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: -2px;
  }
  .label {
    flex: 1;
  }
  .extra {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding-right: 8px;
  }
  .rule {
    width: 1px;
    align-self: stretch;
    margin: 8px 0;
    background: var(--nb-border);
  }
  .chev {
    all: unset;
    box-sizing: border-box;
    width: 40px;
    height: 100%;
    display: grid;
    place-items: center;
    cursor: pointer;
    color: var(--nb-text-muted);
    border-radius: 0 var(--nb-radius-md) var(--nb-radius-md) 0;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .chev :global(svg) {
    transition: rotate var(--nb-dur-med) var(--nb-ease-out);
  }
  .open .chev :global(svg) {
    rotate: 180deg;
  }
  .open .row {
    border-bottom: 1px solid var(--nb-border);
  }
  .opts {
    padding: 4px 8px 8px;
  }
  .tip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 6px);
    translate: -50% 0;
    z-index: 5;
    padding: 5px 8px;
    border-radius: var(--nb-radius-sm);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    box-shadow: var(--nb-shadow-md);
    font: var(--nb-weight-medium) var(--nb-text-sm) / 1.2 var(--nb-font-mono);
    letter-spacing: 0;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
