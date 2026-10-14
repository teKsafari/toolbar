<script lang="ts">
  // Resets to the root layout: the capture page brings its own header (J-112), and this level
  // holds the not-found boundary (+error.svelte, J-205).
  let { children } = $props();
</script>

{@render children()}
