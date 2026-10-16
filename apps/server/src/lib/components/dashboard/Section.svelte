<script lang="ts">
  // A settings section (J-171): heading, one line of description and a docs link on the right,
  // then the controls. Sections are split by thin rules.
  import type { Snippet } from 'svelte';
  let { title, description, docs, children, testid, actions }: { title: string; description?: string; docs?: string; children: Snippet; testid?: string; actions?: Snippet } = $props();
</script>

<section class="sec" data-testid={testid}>
  <div class="h">
    <div>
      <h2>{title}</h2>
      {#if description}<p>{description}</p>{/if}
    </div>
    {#if actions}<div class="acts">{@render actions()}</div>{/if}
    {#if docs}<a class="docs" href={docs} target="_blank" rel="noopener">Docs</a>{/if}
  </div>
  <div class="body">{@render children()}</div>
</section>

<style>
  .sec { padding: 24px 0; border-top: 1px solid var(--nb-border); }
  .sec:first-of-type { border-top: 0; padding-top: 8px; }
  .h { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
  h2 { margin: 0 0 4px; font-size: var(--nb-text-lg); font-weight: var(--nb-weight-semibold); letter-spacing: var(--nb-tracking-ui); }
  p { margin: 0; color: var(--nb-text-muted); font-size: var(--nb-text-md); line-height: var(--nb-leading-relaxed); }
  .acts { flex: none; display: flex; align-items: center; gap: 8px; }
  .docs { font-size: var(--nb-text-sm); white-space: nowrap; }
  .body { display: flex; flex-direction: column; gap: 14px; }
</style>
