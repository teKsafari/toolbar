<script lang="ts">
  // Icon from @toolbar/ui's set, or from the dashboard's extra set.
  import { icons, type IconName } from '@toolbar/ui';
  import { dashIcons, type DashIconName } from './icons.ts';

  let { name, size = 16, label }: { name: IconName | DashIconName; size?: number; label?: string } = $props();
  const parts = $derived(((icons as Record<string, readonly string[]>)[name] ?? (dashIcons as Record<string, readonly string[]>)[name] ?? []).join(''));
</script>

<svg
  class="di"
  class:spin={name === 'spinner'}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  data-icon={name}>{@html parts}</svg>

<style>
  .di { display: inline-block; flex: none; vertical-align: middle; }
  .spin { animation: di-spin 0.8s linear infinite; }
  @keyframes di-spin { to { transform: rotate(360deg); } }
</style>
