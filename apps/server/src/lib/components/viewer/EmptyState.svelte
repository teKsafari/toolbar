<script lang="ts">
  // Centred empty state for dev tools tabs (J-231, J-206).
  import VIcon from './VIcon.svelte';

  interface Props {
    icon?: string;
    title: string;
    body?: string;
    action?: { label: string; href: string };
    testid?: string;
  }
  let { icon, title, body, action, testid = 'empty' }: Props = $props();
</script>

<div class="empty" data-testid={testid}>
  {#if icon}<span class="ic"><VIcon name={icon as never} size={22} /></span>{/if}
  <p class="t">{title}</p>
  {#if body}<p class="b">{body}</p>{/if}
  {#if action}<a class="a" href={action.href}>{action.label}</a>{/if}
</div>

<style>
  .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 20px; text-align: center; color: var(--nb-text-muted); }
  .ic { display: grid; place-items: center; width: 40px; height: 40px; margin-bottom: 4px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text-faint); }
  .t { margin: 0; font: var(--nb-weight-medium) var(--nb-text-lg) / 1.3 var(--nb-font-display); letter-spacing: var(--nb-tracking-tight); color: var(--nb-text); }
  .b { margin: 0; max-width: 340px; font-size: var(--nb-text-md); line-height: var(--nb-leading-relaxed); }
  .a { display: inline-flex; align-items: center; height: var(--nb-control-md); margin-top: 8px; font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); padding: 0 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); text-decoration: none; color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  .a:hover { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
</style>
