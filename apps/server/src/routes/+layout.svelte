<script lang="ts">
  import '@toolbar/ui/tokens.css';
  import '#lib/styles/app.css';
  import { Toaster } from '@toolbar/ui';

  let { children } = $props();
</script>

{@render children()}
<Toaster />
