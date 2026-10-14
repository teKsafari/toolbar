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
  .ic { color: var(--nb-text-faint); }
  .t { margin: 0; font-weight: 600; color: var(--nb-text); }
  .b { margin: 0; max-width: 340px; font-size: var(--nb-text-md); }
  .a { margin-top: 6px; font-size: var(--nb-text-md); padding: 6px 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); text-decoration: none; color: var(--nb-text); }
  .a:hover { background: var(--nb-surface-sunken); }
</style>
