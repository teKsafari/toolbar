<script lang="ts">
  // Placeholder until the DOM replay player lands (J-100, J-229).
  import { useViewer } from './viewer.svelte.ts';
  const v = useViewer();
</script>

<div class="loading" data-testid="replay-loading">Loading the session replay for {v.detail.title || 'this capture'}</div>

<style>
  .loading { aspect-ratio: 16 / 9; display: grid; place-items: center; border-radius: var(--nb-radius-xl); background: var(--nb-surface); border: 1px solid var(--nb-border); color: var(--nb-text-muted); }
</style>
