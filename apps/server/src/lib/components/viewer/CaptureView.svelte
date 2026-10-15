<script lang="ts">
  // The capture page (J-090): header; left column with media, title, description, creator and
  // comments; right dev tools panel (about 38%) behind a draggable splitter; the panel hides
  // (J-091) and at phone width the page is one column with a toggle between the two (J-115).
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  import { call } from './api.ts';
  import './panel.css';
  import Header from './Header.svelte';
  import VideoPlayer from './VideoPlayer.svelte';
  import ScreenshotView from './ScreenshotView.svelte';
  import ReplayPlayer from './ReplayPlayer.svelte';
  import TitleDescription from './TitleDescription.svelte';
  import Comments from './Comments.svelte';
  import DevTools from './DevTools.svelte';
  import VIcon from './VIcon.svelte';
  import FeedbackList from '../feedback/FeedbackList.svelte';
  import { provideViewer, Viewer } from './viewer.svelte.ts';
  import type { CaptureDetail } from '@toolbar/shared/api';
  import type { ViewerData } from './types.ts';

  let { data }: { data: ViewerData } = $props();
  // svelte-ignore state_referenced_locally
  const v = new Viewer(data);
  provideViewer(v);

  let left: HTMLDivElement | undefined = $state();
  let main: HTMLElement | undefined = $state();
  let rightPct = $state(38);
  let dragging = $state(false);
  let hydrated = $state(false);
  const showDev = $derived(data.devtools && v.devtoolsOpen);

  onMount(() => {
    hydrated = true;
    try {
      const w = Number(localStorage.getItem('tb.viewer.split'));
      if (w >= 22 && w <= 70) rightPct = w;
    } catch {
      /* private mode */
    }
    void v.loadEvents();
    void call('captures.view', { id: v.detail.id }).catch(() => {});
    let timer: ReturnType<typeof setInterval> | undefined;
    if (v.detail.status !== 'ready') {
      timer = setInterval(async () => {
        try {
          const d = await call<CaptureDetail>('captures.get', { id: v.detail.id });
          if (d.status === 'ready' || d.status === 'failed') {
            clearInterval(timer);
            v.detail = d;
            void v.loadEvents();
          }
        } catch {
          /* keep waiting */
        }
      }, 3000);
    }
    return () => clearInterval(timer);
  });

  function startDrag(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: PointerEvent) {
    if (!dragging || !main) return;
    const r = main.getBoundingClientRect();
    rightPct = Math.min(70, Math.max(22, ((r.right - e.clientX) / r.width) * 100));
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    try {
      localStorage.setItem('tb.viewer.split', String(Math.round(rightPct)));
    } catch {
      /* private mode */
    }
  }
  function splitKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') rightPct = Math.min(70, rightPct + 2);
    else if (e.key === 'ArrowRight') rightPct = Math.max(22, rightPct - 2);
  }
</script>

<svelte:head><title>{v.detail.title || 'Untitled capture'} | {brandName}</title></svelte:head>

<div class="page" class:dragging data-hydrated={hydrated ? '' : undefined}>
  <Header />
  {#if data.devtools}
    <div class="narrowbar" role="tablist" aria-label="View">
      <button type="button" role="tab" aria-selected={v.narrowView === 'capture'} class:on={v.narrowView === 'capture'} onclick={() => (v.narrowView = 'capture')} data-testid="narrow-capture">Capture</button>
      <button type="button" role="tab" aria-selected={v.narrowView === 'devtools'} class:on={v.narrowView === 'devtools'} onclick={() => { v.narrowView = 'devtools'; if (!v.devtoolsOpen) v.toggleDevtools(true); }} data-testid="narrow-devtools">Dev tools</button>
    </div>
  {/if}
  <main class="layout" class:solo={!showDev} class:show-dev-narrow={v.narrowView === 'devtools' && showDev} bind:this={main} style:--right="{rightPct}%" onpointermove={onDrag} onpointerup={endDrag}>
    <div class="left" bind:this={left}>
      <div class="leftin">
        {#if v.detail.kind !== 'feedback' || v.detail.media.screenshot || v.detail.media.rrwebUrls.length}
        <div class="media" data-testid="media">
          {#if v.detail.status !== 'ready' && v.detail.status !== 'failed'}
            <div class="processing" data-testid="processing"><VIcon name="spinner" size={20} />Still processing. This page updates by itself when the capture is ready.</div>
          {:else if v.detail.status === 'failed'}
            <div class="processing">This capture could not be processed.</div>
          {:else if v.detail.media.video}
            <VideoPlayer />
          {:else if v.detail.kind === 'replay' || v.detail.media.rrwebUrls.length}
            <ReplayPlayer />
          {:else if v.detail.media.screenshot}
            <ScreenshotView />
          {:else}
            <div class="processing">No media in this capture.</div>
          {/if}
        </div>
        {/if}
        <FeedbackList recordingId={v.detail.id} primary={v.detail.kind === 'feedback'} />
        <TitleDescription />
        <Comments scroller={() => left} />
      </div>
    </div>
    {#if showDev}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize dev tools" aria-valuenow={Math.round(rightPct)} tabindex="0" onpointerdown={startDrag} onkeydown={splitKey} data-testid="splitter"></div>
      <aside class="right" data-testid="right-panel"><DevTools /></aside>
    {/if}
    {#if data.devtools && !v.devtoolsOpen}
      <button type="button" class="showdev" onclick={() => v.toggleDevtools(true)} aria-label="Show dev tools" title="Show dev tools" data-testid="show-devtools"><VIcon name="panel-right" size={16} /><span>Dev tools</span></button>
    {/if}
  </main>
</div>

<style>
  .page { display: flex; flex-direction: column; height: 100dvh; background: var(--nb-bg); }
  .page.dragging { cursor: col-resize; user-select: none; }
  .layout { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 8px minmax(300px, var(--right)); padding: 16px 16px 0; gap: 0; }
  .layout.solo { grid-template-columns: minmax(0, 1fr); }
  .left { min-width: 0; min-height: 0; overflow: auto; padding-right: 8px; }
  .leftin { display: flex; flex-direction: column; gap: 12px; min-height: 100%; max-width: 1080px; margin: 0 auto; }
  .solo .leftin { max-width: 960px; }
  .splitter { cursor: col-resize; position: relative; }
  .splitter::after { content: ''; position: absolute; inset: 0 3px; border-radius: 2px; }
  .splitter:hover::after, .splitter:focus-visible::after, .dragging .splitter::after { background: var(--nb-accent); }
  .right { min-width: 0; min-height: 0; padding-bottom: 16px; }
  .processing { display: flex; align-items: center; justify-content: center; gap: 10px; aspect-ratio: 16 / 9; border-radius: var(--nb-radius-xl); background: var(--nb-surface-sunken); color: var(--nb-text-muted); padding: 16px; text-align: center; }
  .showdev { all: unset; position: absolute; top: 16px; right: 16px; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); font-size: var(--nb-text-md); cursor: pointer; }
  .showdev:hover { background: var(--nb-surface-sunken); }
  .narrowbar { display: none; }
  @media (max-width: 720px) {
    .page { height: auto; min-height: 100dvh; }
    .narrowbar { display: flex; gap: 4px; padding: 6px 10px; background: var(--nb-surface); border-bottom: 1px solid var(--nb-border); position: sticky; top: 56px; z-index: 15; }
    .narrowbar button { all: unset; flex: 1; text-align: center; height: 32px; line-height: 32px; border-radius: var(--nb-radius-md); font-size: var(--nb-text-md); color: var(--nb-text-muted); cursor: pointer; }
    .narrowbar button.on { background: var(--nb-surface-sunken); color: var(--nb-text); font-weight: 500; }
    .layout, .layout.solo { display: block; padding: 0; }
    .left { overflow: visible; padding: 0; }
    .leftin { padding: 0 0 0; gap: 10px; }
    .leftin > :global(:not(.media)) { padding-left: 12px; padding-right: 12px; }
    .splitter, .showdev { display: none; }
    .right { display: none; height: calc(100dvh - 104px); padding: 0; }
    .show-dev-narrow .left { display: none; }
    .show-dev-narrow .right { display: block; }
  }
</style>
