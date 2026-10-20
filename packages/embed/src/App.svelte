<script lang="ts">
  // The embed's UI root (D-212): the shared reviewer toolbar and the toasts, in the project's
  // accent. No Jam-style capture here, so nothing ever blocks the toolbar.
  import { Toaster } from '@toolbar/ui';
  import { applyAccent } from '@toolbar/ui/accent';
  import { Review } from '@toolbar/review';
  import { setUiRoot } from '@toolbar/review/guard';
  import { onMount } from 'svelte';

  let { accent, brand }: { accent: string | null; brand: string } = $props();
  let root: HTMLDivElement | undefined = $state();

  onMount(() => {
    const shadow = root?.getRootNode();
    if (shadow instanceof ShadowRoot) setUiRoot(shadow);
    return () => setUiRoot(null);
  });
  $effect(() => {
    if (root) applyAccent(root, accent);
  });
</script>

<div class="nb-ui" data-nb-ui data-nb-brand={brand} data-testid="embed-root" bind:this={root}>
  <Review blocked={false} />
  <Toaster />
</div>

<style>
  .nb-ui {
    --nb-chrome-danger: #f87171;
    --nb-chrome-warning: #fbbf24;
    --nb-chrome-faint: #8a8a8f;
    pointer-events: none;
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
    color: var(--nb-text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
</style>
