<script lang="ts">
  // Holds the not-found boundary for share links (+error.svelte, J-205).
  let { children } = $props();
</script>

{@render children()}
