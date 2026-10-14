<script lang="ts">
  // Mounted in the root layout so Ctrl+K works on the dashboard and on capture pages (J-161,
  // J-228), whose layout resets the app shell. Only for signed-in pages; never on share,
  // recorder or sign-in pages. Also applies the stored theme choice (help menu).
  import { page } from '$app/state';
  import Palette from './Palette.svelte';

  const user = $derived((page.data as { user?: { id: string } | null }).user ?? null);
  const ws = $derived((page.data as { activeWorkspaceId?: string | null }).activeWorkspaceId ?? null);
  const off = $derived(/^\/(s|rl|login|invite|ext)(\/|$)/.test(page.url.pathname));

  $effect(() => {
    try {
      const t = localStorage.getItem('nib.theme');
      if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    } catch {
      /* storage blocked */
    }
  });
</script>

{#if (user || page.url.pathname.startsWith('/c/')) && !off}<Palette workspaceId={ws} />{/if}
