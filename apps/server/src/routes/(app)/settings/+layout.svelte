<script lang="ts">
  import { page } from '$app/state';
  let { children } = $props();
  const tabs = [
    ['profile', 'Profile'],
    ['workspace', 'Workspace'],
    ['members', 'Members'],
    ['browsers', 'Connected browsers'],
    ['tokens', 'API tokens'],
    ['integrations', 'Integrations'],
  ] as const;
</script>

<div class="settings">
  <nav aria-label="Settings">
    {#each tabs as [slug, label] (slug)}
      <a href="/settings/{slug}" class:active={page.url.pathname === `/settings/${slug}`}>{label}</a>
    {/each}
  </nav>
  <section>{@render children()}</section>
</div>

<style>
  .settings { display: grid; grid-template-columns: 200px minmax(0, 640px); gap: 32px; }
  nav { display: flex; flex-direction: column; gap: 2px; }
  a { padding: 6px 10px; border-radius: var(--nb-radius-md); color: var(--nb-text-muted); text-decoration: none; }
  a:hover { background: var(--nb-surface-sunken); }
  a.active { background: var(--nb-accent-tint); color: var(--nb-accent-text); }
  @media (max-width: 720px) { .settings { grid-template-columns: 1fr; } }
</style>
