<script lang="ts">
  // In-page UI root. Empty until a capture mode is armed; the UI area agent builds the
  // screenshot cursor hint, recording bar and draft editor here.
  import { Toaster } from '@toolbar/ui';
</script>

<div class="nb-ui" data-nb-ui>
  <Toaster />
</div>

<style>
  .nb-ui {
    pointer-events: auto;
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
    color: var(--nb-text);
  }
</style>
