<script lang="ts">
  // J-214: a path that matches no page shows a drawn not-found scene with a button home.
  // Other errors keep a plain message with the same way back.
  import { page } from '$app/state';
  import { Icon } from '@toolbar/ui';
  const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? 'Page not found' : 'Something went wrong'}</title></svelte:head>

<main class="nf" data-testid={missing ? 'not-found' : 'error-page'}>
  {#if missing}
    <svg class="art" viewBox="0 0 240 150" aria-hidden="true">
      <rect x="20" y="22" width="200" height="110" rx="12" fill="var(--nb-surface)" stroke="var(--nb-border-strong)" stroke-width="2" />
      <path d="M20 46h200" stroke="var(--nb-border-strong)" stroke-width="2" />
      <circle cx="36" cy="34" r="4" fill="var(--nb-danger)" opacity=".7" />
      <circle cx="50" cy="34" r="4" fill="var(--nb-marker, #f2b100)" opacity=".8" />
      <circle cx="64" cy="34" r="4" fill="var(--nb-success)" opacity=".7" />
      <path d="M72 96c18-34 36 6 54-22s34 10 46-8" fill="none" stroke="var(--nb-accent)" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 10" />
      <g transform="translate(160 64) rotate(35)">
        <path d="M0-26 14-6 8 16H-8l-6-22z" fill="var(--nb-accent)" />
        <path d="M0-4v20" stroke="var(--nb-on-accent)" stroke-width="2" />
        <circle cy="-6" r="3" fill="var(--nb-on-accent)" />
      </g>
      <text x="78" y="122" font-size="14" font-family="ui-monospace, monospace" fill="var(--nb-text-faint)">404</text>
    </svg>
    <h1>Nothing to see on this page</h1>
    <p>The address may have a typo, or the page moved.</p>
  {:else}
    <h1>{page.status}: something went wrong</h1>
    <p>{page.error?.message}</p>
  {/if}
  <a class="home" href="/"><Icon name="home" size={16} />Back to captures</a>
</main>

<style>
  .nf { min-height: 80vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px 16px; text-align: center; }
  .art { width: min(260px, 70vw); height: auto; margin-bottom: 8px; }
  h1 { margin: 0; }
  p { margin: 0; color: var(--nb-text-muted); }
  .home {
    display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 8px 14px; border-radius: var(--nb-radius-md);
    background: var(--nb-accent); color: var(--nb-on-accent); text-decoration: none; font-weight: var(--nb-weight-medium);
  }
  .home:hover { background: var(--nb-accent-hover); }
</style>
