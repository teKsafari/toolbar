<script lang="ts">
  import { iconParts, type EditorIconName } from './icons.ts';

  interface Props {
    name: EditorIconName;
    size?: number;
    stroke?: number;
    label?: string;
  }
  let { name, size = 16, stroke = 1.75, label }: Props = $props();
</script>

<svg
  class="nb-edicon"
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
  {@html iconParts(name).join('')}
</svg>

<style>
  .nb-edicon {
    display: inline-block;
    flex: none;
    vertical-align: middle;
  }
  .nb-spin {
    animation: nb-edspin 0.8s linear infinite;
  }
  @keyframes nb-edspin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
