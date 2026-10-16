<script lang="ts">
  // Review links of a project's sites (D-201), on the project page and Settings, Projects. Copy
  // gives the share-ready link; Open posts to the link's action, which hands off to the site at
  // once in a new tab. A reviewer who opens the link signs in and lands on the site with the
  // toolbar, through the injector.
  import { Button, toasts } from '@toolbar/ui';

  let { links }: { links: { origin: string; host: string; href: string }[] } = $props();

  const pathOf = (href: string) => {
    const u = new URL(href);
    return u.pathname + u.search;
  };

  async function copy(href: string) {
    try {
      await navigator.clipboard.writeText(href);
      toasts.success('Review link copied. Anyone in this workspace who opens it gets the toolbar on the site.');
    } catch {
      toasts.error(`Copy failed. The link: ${href}`);
    }
  }
</script>

{#if links.length}
  <ul class="review" data-testid="project-review">
    {#each links as l (l.origin)}
      <li data-origin={l.origin}>
        <span class="rhost">{l.host}</span>
        <Button size="sm" icon="copy" onclick={() => copy(l.href)} data-testid="review-copy" data-href={l.href}>Copy review link</Button>
        <form method="POST" action={pathOf(l.href)} target="_blank">
          <Button size="sm" variant="ghost" icon="external" type="submit" data-testid="review-open">Open with toolbar</Button>
        </form>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .review { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .review li { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .review form { display: contents; }
  .rhost { font: var(--nb-text-sm) var(--nb-font-mono, monospace); color: var(--nb-text-muted); margin-right: 4px; overflow-wrap: anywhere; }
</style>
