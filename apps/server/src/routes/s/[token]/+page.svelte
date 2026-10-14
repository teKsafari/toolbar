<script lang="ts">
  import CaptureView from '#lib/components/viewer/CaptureView.svelte';
  let { data } = $props();
</script>

<svelte:head><meta name="robots" content="noindex, nofollow" /></svelte:head>
{#key data.viewer.detail.id}
  <CaptureView data={data.viewer} />
{/key}
