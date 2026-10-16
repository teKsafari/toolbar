<script lang="ts">
  import { icons, type IconName } from '../icons.ts';

  interface Props {
    name: IconName;
    size?: number;
    stroke?: number;
    /** Accessible label. Without one the icon is decorative and hidden from assistive tech. */
    label?: string;
    class?: string;
  }
  // stroke 2 on the 24 grid, as lucide draws (teksafari.org); 1.33 px at 16 px
  let { name, size = 16, stroke = 2, label, class: cls = '' }: Props = $props();
</script>

<svg
  class="nb-icon {cls}"
  class:nb-spin={name === 'spinner'}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  data-icon={name}
>
  {@html icons[name].join('')}
</svg>

<style>
  .nb-icon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
  }
  .nb-spin {
    animation: nb-spin 0.8s linear infinite;
  }
  @keyframes nb-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
