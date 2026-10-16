<script lang="ts">
  // Screenshot card (J-099): the image (scrolls when tall), creator chip and download; a click
  // opens a lightbox that Escape or an outside click closes. Area captures that kept the full
  // viewport show a crop/full switcher, crop first (J-209, J-004).
  import VIcon from './VIcon.svelte';
  import Avatar from './Avatar.svelte';
  import { useViewer } from './viewer.svelte.ts';
  import { agentNudge } from './actions.ts';

  const v = useViewer();
  const crop = $derived(v.detail.media.screenshot!);
  const full = $derived(v.detail.media.fullScreenshot);
  let which = $state<'crop' | 'full'>('crop');
  const shown = $derived(which === 'full' && full ? full : crop);
  let open = $state(false);
  /** Where the selected area sits on the full viewport, in percent, from the capture's screenshot marker (J-209). */
  const cropBox = $derived.by(() => {
    const m = [...v.events].reverse().find((e) => e.kind === 'marker' && e.data.type === 'screenshot' && e.data.rect);
    const r = m && m.kind === 'marker' ? m.data.rect : undefined;
    const vw = v.detail.env?.viewport?.w;
    const vh = v.detail.env?.viewport?.h;
    if (!r || !vw || !vh) return null;
    return { left: (r.x / vw) * 100, top: (r.y / vh) * 100, width: (r.w / vw) * 100, height: (r.h / vh) * 100 };
  });

  function download() {
    const a = document.createElement('a');
    a.href = `${shown.url}?download=1`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    agentNudge('Download started');
  }
</script>

<svelte:window onkeydown={(e) => { if (open && e.key === 'Escape') open = false; }} />

<div class="card" data-testid="screenshot-card">
  <div class="top">
    {#if v.detail.author}<span class="chip"><Avatar name={v.detail.author.name} size={20} />{v.detail.author.name}</span>{/if}
    <span class="grow"></span>
    <button type="button" class="ib" onclick={download} aria-label="Download image" title="Download" data-testid="download"><VIcon name="download" size={16} /></button>
  </div>
  <div class="scroll">
    <button type="button" class="imgbtn" onclick={() => (open = true)} aria-label="Open the image large">
      <span class="imgwrap">
        <img src={shown.url} alt={v.detail.title || 'Screenshot'} width={shown.width ?? undefined} height={shown.height ?? undefined} data-testid="screenshot" data-which={which} />
        {#if which === 'full' && full && cropBox}
          <span class="cropbox" style:left="{cropBox.left}%" style:top="{cropBox.top}%" style:width="{cropBox.width}%" style:height="{cropBox.height}%" data-testid="crop-box" aria-hidden="true"></span>
        {/if}
      </span>
    </button>
  </div>
  {#if full}
    <div class="switch" role="tablist" aria-label="Image" data-testid="switcher">
      <button type="button" role="tab" aria-selected={which === 'crop'} class:sel={which === 'crop'} onclick={() => (which = 'crop')} title="Selected area" data-testid="thumb-crop"><img src={crop.url} alt="Selected area" /></button>
      <button type="button" role="tab" aria-selected={which === 'full'} class:sel={which === 'full'} onclick={() => (which = 'full')} title="Full viewport" data-testid="thumb-full"><img src={full.url} alt="Full viewport" /></button>
    </div>
  {/if}
</div>

{#if open}
  <div class="lightbox" role="dialog" aria-modal="true" aria-label="Screenshot" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) open = false; }} onkeydown={() => {}} data-testid="lightbox">
    <img src={shown.url} alt={v.detail.title || 'Screenshot'} />
    <button type="button" class="close" onclick={() => (open = false)} aria-label="Close"><VIcon name="close" size={18} /></button>
  </div>
{/if}

<style>
  .card { position: relative; display: flex; flex-direction: column; border-radius: var(--nb-radius-lg); background: var(--nb-surface-2); border: 1px solid var(--nb-border); overflow: hidden; }
  .top { position: absolute; inset: 0 0 auto; z-index: 3; display: flex; align-items: center; gap: 8px; padding: 10px; pointer-events: none; }
  .grow { flex: 1; }
  .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 4px; border-radius: 999px; background: rgb(11 11 11 / 0.6); color: #fafafa; font-size: var(--nb-text-md); backdrop-filter: blur(6px); }
  .ib { all: unset; pointer-events: auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text); cursor: pointer; box-shadow: var(--nb-shadow-sm); }
  .ib:hover { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
  .ib:focus-visible { outline: 2px solid var(--nb-focus); }
  .scroll { position: relative; z-index: 1; max-height: 70vh; overflow: auto; display: grid; place-items: start center; padding: 48px 16px 16px; }
  .imgbtn { all: unset; cursor: zoom-in; display: block; max-width: 100%; }
  .imgbtn:focus-visible { outline: 2px solid var(--nb-focus); }
  .imgwrap { position: relative; display: block; }
  .cropbox { position: absolute; box-sizing: border-box; border: 2px solid var(--nb-accent); border-radius: 2px; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.6); pointer-events: none; }
  .scroll img { display: block; max-width: 100%; height: auto; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border); }
  .switch { display: flex; justify-content: center; gap: 8px; padding: 8px 0 12px; }
  .switch button { all: unset; cursor: pointer; width: 80px; height: 52px; border-radius: var(--nb-radius-sm); overflow: hidden; border: 2px solid var(--nb-border); background: var(--nb-surface); }
  .switch button.sel { border-color: var(--nb-accent); }
  .switch button:focus-visible { outline: 2px solid var(--nb-focus); }
  .switch img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .lightbox { position: fixed; inset: 0; z-index: 900; display: grid; place-items: center; padding: 32px; background: rgb(11 11 11 / 0.88); overflow: auto; }
  .lightbox img { max-width: 100%; height: auto; border-radius: 6px; }
  .close { all: unset; position: fixed; top: 16px; right: 16px; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: rgb(255 255 255 / 0.15); color: #fff; cursor: pointer; }
  @media (max-width: 720px) { .card { border-radius: 0; border-left: 0; border-right: 0; } }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .close:focus-visible { outline: 2px solid #fafafa; outline-offset: 2px; }
</style>
