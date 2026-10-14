<script lang="ts">
  // Icon from the shared set (packages/ui/src/icons.ts) or the viewer additions.
  import { icons, type IconName } from '@toolbar/ui';
  import { viewerIcons, type ViewerIconName } from '@toolbar/ui/viewer';

  interface Props {
    name: IconName | ViewerIconName;
    size?: number;
    label?: string;
    class?: string;
  }
  let { name, size = 16, label, class: cls = '' }: Props = $props();
  const parts = $derived(((viewerIcons as Record<string, readonly string[]>)[name] ?? (icons as Record<string, readonly string[]>)[name] ?? []).join(''));
</script>

<svg
  class="vi {cls}"
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
  .vi { display: inline-block; flex: none; vertical-align: middle; }
  .spin { animation: vi-spin 0.8s linear infinite; }
  @keyframes vi-spin { to { transform: rotate(360deg); } }
</style>
