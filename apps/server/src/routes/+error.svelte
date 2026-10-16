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
      <!-- line art in the language's manner: quiet 1.5 px strokes, a dashed "not connected" trail,
           and one accent element, the marker -->
      <rect x="20" y="22" width="200" height="110" rx="12" fill="var(--nb-surface)" stroke="var(--nb-border-strong)" stroke-width="1.5" />
      <path d="M20 44h200" stroke="var(--nb-border)" stroke-width="1.5" />
      <circle cx="35" cy="33" r="3.5" fill="none" stroke="var(--nb-border-strong)" stroke-width="1.5" />
      <circle cx="47" cy="33" r="3.5" fill="none" stroke="var(--nb-border-strong)" stroke-width="1.5" />
      <circle cx="59" cy="33" r="3.5" fill="none" stroke="var(--nb-border-strong)" stroke-width="1.5" />
      <rect x="36" y="58" width="64" height="6" rx="3" fill="var(--nb-surface-sunken)" />
      <rect x="36" y="70" width="40" height="6" rx="3" fill="var(--nb-surface-sunken)" />
      <path d="M72 100c18-34 36 6 54-22s34 10 46-8" fill="none" stroke="var(--nb-text-faint)" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="3 4" />
      <g transform="translate(160 64) rotate(35)">
        <path d="M0-26 14-6 8 16H-8l-6-22z" fill="var(--nb-accent)" />
        <path d="M0-4v20" stroke="var(--nb-on-accent)" stroke-width="2" />
        <circle cy="-6" r="3" fill="var(--nb-on-accent)" />
      </g>
      <text x="36" y="122" font-size="11" letter-spacing="1" font-family="var(--nb-font-mono)" fill="var(--nb-text-faint)">// 404</text>
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
  .art { width: min(260px, 70vw); height: auto; margin-bottom: 12px; }
  h1 { margin: 0; font-size: var(--nb-text-4xl); line-height: 1.15; }
  p { margin: 0; color: var(--nb-text-muted); font-size: var(--nb-text-lg); line-height: var(--nb-leading-relaxed); }
  .home {
    display: inline-flex; align-items: center; gap: 8px; height: var(--nb-control-lg); margin-top: 14px; padding: 0 16px; border-radius: var(--nb-radius-md);
    background: var(--nb-accent); color: var(--nb-on-accent); text-decoration: none; font-weight: var(--nb-weight-medium); letter-spacing: var(--nb-tracking-ui);
    box-shadow: var(--nb-shadow-primary); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), transform var(--nb-dur-fast) var(--nb-ease-out);
  }
  .home:hover { background: var(--nb-accent-hover); }
  .home:active { background: var(--nb-accent-active); transform: translateY(1px); }
  .home:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
</style>
