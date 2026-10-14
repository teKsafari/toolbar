<script lang="ts">
  import CaptureView from '#lib/components/viewer/CaptureView.svelte';
  let { data } = $props();
</script>

{#key data.viewer.detail.id}
  <CaptureView data={data.viewer} />
{/key}
