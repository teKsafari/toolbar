<script lang="ts">
  import '@toolbar/ui/fonts.css';
  import '@toolbar/ui/tokens.css';
  import '#lib/styles/app.css';
  import { Toaster } from '@toolbar/ui';
  import GlobalPalette from '#lib/components/dashboard/GlobalPalette.svelte';

  let { children } = $props();
</script>

{@render children()}
<GlobalPalette />
<Toaster />
