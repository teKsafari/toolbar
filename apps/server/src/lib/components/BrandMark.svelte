<script lang="ts">
  // The instance logo (D-112). The built-in rectangle is drawn inline in the accent colour, so it
  // follows the theme; an uploaded logo is an <img> (never inlined), with its dark variant when
  // the page is dark by system setting or by the dashboard's own theme switch.
  import { page } from '$app/state';
  import { Icon } from '@toolbar/ui';

  let { size = 20, label = false }: { size?: number; label?: boolean } = $props();
  const brand = $derived(page.data.brand as import('#lib/server/branding/index.ts').PageBrand | undefined);
  let forced = $state<'light' | 'dark' | null>(null);

  $effect(() => {
    const root = document.documentElement;
    const read = () => {
      const t = root.getAttribute('data-theme');
      forced = t === 'dark' || t === 'light' ? t : null;
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  });
</script>

{#if !brand || brand.defaultLogo}
  <span class="mark" aria-hidden={label ? undefined : 'true'} aria-label={label ? (brand?.name ?? 'open-toolbar') : undefined} data-brand-logo="default"><Icon name="logo" {size} /></span>
{:else if brand.logoDark && forced === null}
  <picture data-brand-logo="custom">
    <source srcset={brand.logoDark} media="(prefers-color-scheme: dark)" />
    <img src={brand.logo} alt={label ? brand.name : ''} style:height="{size}px" />
  </picture>
{:else}
  <img data-brand-logo="custom" src={forced === 'dark' && brand.logoDark ? brand.logoDark : brand.logo} alt={label ? brand.name : ''} style:height="{size}px" />
{/if}

<style>
  .mark {
    display: inline-flex;
    color: var(--nb-accent);
  }
  img {
    display: block;
    width: auto;
    max-width: 160px;
    object-fit: contain;
  }
  picture {
    display: inline-flex;
  }
</style>
