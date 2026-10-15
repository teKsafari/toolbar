<script lang="ts">
  // The server's logo in extension pages (D-112), or the rectangle in the accent colour.
  import { Icon } from '@toolbar/ui';
  import { brand } from '../brand.svelte';

  let { size = 18 }: { size?: number } = $props();
</script>

{#if brand.logo}
  <img class="logo" src={brand.logo} alt="" style:height="{size}px" data-brand-logo="custom" />
{:else}
  <span class="rect" data-brand-logo="default"><Icon name="logo" {size} /></span>
{/if}

<style>
  .logo { display: inline-block; width: auto; max-width: 120px; object-fit: contain; vertical-align: middle; }
  .rect { display: inline-flex; color: var(--nb-accent); }
</style>
