<script lang="ts">
  // Round avatar for a person: their image, else initials on a hue picked from the name.
  let { name, image = null, size = 24, title }: { name: string; image?: string | null; size?: number; title?: string } = $props();
  const initials = $derived(
    name
      .trim()
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?',
  );
  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

{#if image}
  <img class="ua" src={image} alt="" width={size} height={size} style="--s:{size}px" title={title ?? name} />
{:else}
  <span class="ua" style="--s:{size}px; --h:{hue}" title={title ?? name} aria-hidden="true">{initials}</span>
{/if}

<style>
  .ua {
    display: inline-grid; place-items: center; flex: none; width: var(--s); height: var(--s); border-radius: 50%;
    object-fit: cover; font-size: calc(var(--s) * 0.42); font-weight: var(--nb-weight-semibold); line-height: 1;
    background: hsl(var(--h, 230) 45% 88%); color: hsl(var(--h, 230) 45% 28%);
  }
  :global([data-theme='dark']) .ua:not(img) { background: hsl(var(--h, 230) 30% 30%); color: hsl(var(--h, 230) 60% 88%); }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .ua:not(img) { background: hsl(var(--h, 230) 30% 30%); color: hsl(var(--h, 230) 60% 88%); }
  }
</style>
