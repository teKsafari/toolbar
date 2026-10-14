<script lang="ts">
  let { data } = $props();
</script>

<svelte:head><title>Capture</title></svelte:head>

<div class="viewer">
  <section class="media"><div class="empty">Capture {data.id}: the viewer is not built yet.</div></section>
  <section class="panel" aria-label="Developer tools">
    <div class="tabs"><span>Info</span><span>Console</span><span>Network</span><span>Actions</span></div>
  </section>
</div>

<style>
  .viewer { display: grid; grid-template-columns: minmax(0, 63fr) minmax(0, 37fr); gap: 16px; min-height: 70vh; }
  .media { background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-xl); }
  .panel { background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); }
  .tabs { display: flex; gap: 16px; padding: 10px 14px; border-bottom: 1px solid var(--nb-border); color: var(--nb-text-muted); }
  @media (max-width: 900px) { .viewer { grid-template-columns: 1fr; } }
</style>
