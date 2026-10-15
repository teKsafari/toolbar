<script lang="ts">
  // Deleted or unknown capture (J-205): one plain centred line, no header and no link home.
  import { page } from '$app/state';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
</script>

<svelte:head><title>Not found | {brandName}</title></svelte:head>
<main class="nf" data-testid="not-found">{page.status === 404 ? 'This capture could not be found.' : (page.error?.message ?? 'Something went wrong.')}</main>

<style>
  .nf { min-height: 100dvh; display: grid; place-items: center; padding: 16px; text-align: center; color: var(--nb-text-muted); }
</style>
