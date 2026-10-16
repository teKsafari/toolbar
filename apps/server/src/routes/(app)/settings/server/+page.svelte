<script lang="ts">
  // Settings > Server (D-112): the instance name, logo (light and dark) and accent colour that
  // the sign-in page, share pages, mail and the extension show. A value the server environment
  // sets is shown read-only. Changes save at once; the preview follows before saving.
  import { invalidateAll } from '$app/navigation';
  import { toasts } from '@toolbar/ui';
  import { deriveAccent } from '@toolbar/ui/accent';
  import type { AdminBranding } from '@toolbar/shared/api';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Field from '#lib/components/dashboard/Field.svelte';
  import { api, errMsg, urlOf } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  // svelte-ignore state_referenced_locally
  let a = $state<AdminBranding>(data.admin);
  // svelte-ignore state_referenced_locally
  let name = $state(data.admin.branding.name);
  // svelte-ignore state_referenced_locally
  let accent = $state(data.admin.branding.accent);
  let busy = $state<'light' | 'dark' | null>(null);
  let inputs: Record<'light' | 'dark', HTMLInputElement | undefined> = $state({ light: undefined, dark: undefined });

  const b = $derived(a.branding);
  const lock = (v: string) => `Set by ${v} on the server`;

  async function done(next: AdminBranding) {
    const headChanged = next.branding.accent !== a.branding.accent || next.branding.logo.light !== a.branding.logo.light;
    a = next;
    name = next.branding.name;
    accent = next.branding.accent;
    await invalidateAll();
    // the favicons and accent tokens live in the server-written <head>: load it again
    if (headChanged) location.reload();
  }

  async function put(body: { name?: string | null; accent?: string | null }) {
    try {
      await done(await api<AdminBranding>('branding.update', { body }));
    } catch (e) {
      toasts.error(errMsg(e));
      name = a.branding.name;
      accent = a.branding.accent;
    }
  }

  function saveName() {
    const n = name.trim();
    if (n === a.branding.name) return;
    void put({ name: n ? n : null });
  }

  async function upload(variant: 'light' | 'dark', file: File) {
    busy = variant;
    try {
      const fd = new FormData();
      fd.set('file', file);
      const res = await fetch(urlOf('branding.uploadLogo', {}, { variant }), { method: 'PUT', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? 'Upload failed');
      await done(j as AdminBranding);
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      busy = null;
    }
  }

  async function removeLogo(variant: 'light' | 'dark') {
    try {
      const res = await fetch(urlOf('branding.deleteLogo', {}, { variant }), { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? 'Could not remove the logo');
      await done(j as AdminBranding);
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  const previewAccent = $derived(/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : b.accent);
  // each pane shows its theme's accent, as the pages do: the dark one lightens (black turns near-white)
  const pv = $derived(deriveAccent(previewAccent));
</script>

<svelte:head><title>Server · Settings</title></svelte:head>

<h1>Server</h1>
<p class="muted note">These settings apply to everyone on this server: the sign-in page, share pages, recording links, mail and the browser extension after sign-in.</p>

<Section title="Branding" description="The product name, logo and accent colour people see on this server." testid="server-branding">
  <Field label="Name" hint={a.locked.name ? lock('APP_NAME') : `Up to 40 characters. Empty resets to ${a.defaults.name}.`}>
    <input type="text" bind:value={name} disabled={a.locked.name} maxlength="40" onblur={saveName} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} data-testid="brand-name" />
  </Field>

  {#each [['light', 'Logo', 'APP_LOGO_URL'], ['dark', 'Logo on dark backgrounds', 'APP_LOGO_DARK_URL']] as const as [variant, label, envName] (variant)}
    {@const locked = variant === 'light' ? a.locked.logo : a.locked.logoDark}
    {@const has = variant === 'light' ? !!a.stored.logo?.light : !!a.stored.logo?.dark}
    <Field label={label} hint={locked ? lock(envName) : variant === 'light' ? 'SVG or PNG, at most 512 KB. Without one, a filled rectangle in the accent colour.' : 'Optional. Shown when the page is dark.'}>
      <input bind:this={inputs[variant]} type="file" accept="image/svg+xml,image/png" hidden onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; (e.currentTarget as HTMLInputElement).value = ''; if (f) void upload(variant, f); }} data-testid="brand-logo-input-{variant}" />
      {#if has && !locked}<button class="link" onclick={() => removeLogo(variant)} data-testid="brand-logo-remove-{variant}">Remove</button>{/if}
      <button class="btn" disabled={locked || busy !== null} onclick={() => inputs[variant]?.click()} data-testid="brand-logo-{variant}">{busy === variant ? 'Uploading' : has ? 'Replace' : 'Upload'}</button>
    </Field>
  {/each}

  <Field label="Accent colour" hint={a.locked.accent ? lock('APP_ACCENT') : 'Buttons, links and the default logo. Text on it must stay readable.'}>
    <input type="color" value={previewAccent} disabled={a.locked.accent} oninput={(e) => (accent = (e.currentTarget as HTMLInputElement).value)} onchange={() => put({ accent })} aria-label="Accent colour" data-testid="brand-accent-picker" />
    <input class="hex" type="text" bind:value={accent} disabled={a.locked.accent} maxlength="7" onblur={() => accent !== a.branding.accent && put({ accent: accent.trim() || null })} data-testid="brand-accent" />
    {#if !a.locked.accent && a.branding.accent !== a.defaults.accent}<button class="link" onclick={() => put({ accent: null })}>Reset</button>{/if}
  </Field>
</Section>

<Section title="Preview" description="The sign-in header, a browser tab and the extension's toolbar icon." testid="server-preview">
  <div class="preview">
    {#each ['light', 'dark'] as const as theme (theme)}
      {@const src = theme === 'dark' && b.logo.dark ? b.logo.dark : b.logo.light}
      <div class="pane {theme}" style:--pv-accent={pv[theme].accent} style:--pv-on={pv[theme].on}>
        <div class="hdr">
          {#if b.defaultLogo}<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><rect x="2" y="7" width="20" height="10" fill="var(--pv-accent)" /></svg>{:else}<img {src} alt="" height="28" />{/if}
          <span data-testid="brand-preview-name-{theme}">{name.trim() || a.defaults.name}</span>
        </div>
        <div class="tab"><img src={b.logo.icons['32']} alt="" width="16" height="16" /><span>Sign in · {name.trim() || a.defaults.name}</span></div>
        <div class="tb"><img src={b.logo.icons['32']} alt="" width="16" height="16" /><img src={b.logo.icons['48']} alt="" width="24" height="24" /></div>
        <button class="cta" type="button" tabindex="-1">Sign in</button>
      </div>
    {/each}
  </div>
</Section>

<style>
  h1 { margin-bottom: 8px; }
  .note { margin: 0 0 16px; max-width: 60ch; }
  input[type='text'] { width: 220px; }
  input.hex { width: 96px; font-family: var(--nb-font-mono); }
  input[type='color'] { width: 36px; height: var(--nb-control-lg); padding: 3px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); cursor: pointer; }
  input[type='color']::-webkit-color-swatch-wrapper { padding: 0; }
  input[type='color']::-webkit-color-swatch { border: 0; border-radius: 4px; }
  /* a secondary button: white, control border, the site's lift */
  .btn {
    height: var(--nb-control-md); padding: 0 12px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md);
    background: var(--nb-surface); color: var(--nb-text); font: var(--nb-weight-medium) var(--nb-text-md) var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui);
    cursor: pointer; box-shadow: var(--nb-shadow-sm); transition: border-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .btn:hover:not(:disabled) { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .link { all: unset; color: var(--nb-accent-text); cursor: pointer; font-size: var(--nb-text-sm); }
  .preview { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  /* the two canvases of the token themes (light #fafafa, dark #0b0b0b), not the page's own theme */
  .pane { display: flex; flex-direction: column; gap: 12px; padding: 16px; border-radius: var(--nb-radius-lg); border: 1px solid var(--nb-border); }
  .pane.light { background: #fafafa; color: #111827; border-color: #e5e7eb; }
  .pane.dark { background: #0b0b0b; color: #e6e6e6; border-color: #262626; }
  .hdr { display: flex; align-items: center; gap: 8px; font: var(--nb-weight-semibold) var(--nb-text-lg) / 1.2 var(--nb-font-display); letter-spacing: var(--nb-tracking-tight); min-width: 0; }
  .hdr img { height: 28px; width: auto; max-width: 140px; object-fit: contain; }
  .hdr span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tab { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px 8px 0 0; font-size: var(--nb-text-sm); width: fit-content; max-width: 100%; overflow: hidden; white-space: nowrap; }
  .tb { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 6px; width: fit-content; }
  .light .tab, .light .tb { background: #f3f4f6; }
  .dark .tab, .dark .tb { background: #1b1b1b; }
  .cta { all: unset; align-self: flex-start; height: var(--nb-control-md); line-height: var(--nb-control-md); padding: 0 14px; border-radius: var(--nb-radius-md); background: var(--pv-accent); color: var(--pv-on); font: var(--nb-weight-medium) var(--nb-text-md) var(--nb-font-sans); box-shadow: 0 1px 2px rgb(0 0 0 / 0.2), inset 0 1px 0 rgb(255 255 255 / 0.16); }
  @media (max-width: 560px) { input[type='text'] { width: 150px; } }
</style>
