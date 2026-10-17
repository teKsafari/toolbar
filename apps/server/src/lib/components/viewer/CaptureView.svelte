<script lang="ts">
  // The capture page (J-090): header; left column with media, title, description, creator and
  // comments; right dev tools panel (about 38%) behind a draggable splitter; the panel hides
  // (J-091) and at phone width the page is one column with a toggle between the two (J-115). A
  // lean capture (nothing for the dev tools, no video, replay or trace; D-206) starts with the
  // pane collapsed and shows URL, browser, OS and viewport in a thin strip under the header.
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
  import { stripFacts } from './layout.ts';
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
  const strip = $derived(data.devtools && v.lean);
  const facts = $derived(strip ? stripFacts(v.detail) : []);

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
  {#if strip}
    <div class="strip" data-testid="info-strip">
      <dl>
        {#each facts as f (f.label)}
          <div class="fact" class:url={f.label === 'URL'}><dt>{f.label}</dt><dd>{#if f.href}<a href={f.href} target="_blank" rel="noopener noreferrer" title={f.value}>{f.value}</a>{:else}{f.value}{/if}</dd></div>
        {/each}
      </dl>
      <button type="button" class="striptoggle" class:on={v.devtoolsOpen} aria-pressed={v.devtoolsOpen} onclick={() => v.toggleDevtools()} aria-label={v.devtoolsOpen ? 'Hide dev tools' : 'Show dev tools'} title={v.devtoolsOpen ? 'Hide dev tools' : 'Show dev tools'} data-testid="show-devtools"><VIcon name="panel-right" size={14} /><span>Dev tools</span></button>
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
    {#if data.devtools && !v.devtoolsOpen && !strip}
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
  .processing { display: flex; align-items: center; justify-content: center; gap: 10px; aspect-ratio: 16 / 9; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface-2); color: var(--nb-text-muted); padding: 16px; text-align: center; }
  .showdev { all: unset; position: absolute; top: 16px; right: 16px; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); cursor: pointer; box-shadow: var(--nb-shadow-sm); }
  .showdev:hover { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
  .showdev:focus-visible { outline: 2px solid var(--nb-focus); }
  .narrowbar { display: none; }
  /* the lean page's facts (D-206): one quiet line of mono labels and values, the pane toggle at its end */
  .strip { flex: none; display: flex; align-items: center; gap: 12px; min-height: 36px; padding: 4px 16px; border-bottom: 1px solid var(--nb-border); background: var(--nb-surface); }
  .strip dl { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 20px; margin: 0; }
  .fact { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
  .fact.url { flex: 0 1 auto; max-width: min(560px, 100%); }
  .fact dt { flex: none; font: 10px/16px var(--nb-font-mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--nb-text-faint); }
  .fact dd { margin: 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: var(--nb-text-sm); color: var(--nb-text-body); }
  .fact a { color: inherit; text-decoration: none; }
  .fact a:hover { color: var(--nb-text); text-decoration: underline; }
  .fact a:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: 2px; }
  .striptoggle { all: unset; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: var(--nb-radius-sm); color: var(--nb-text-muted); font-size: var(--nb-text-sm); font-weight: var(--nb-weight-medium); cursor: pointer; transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out); }
  .striptoggle:hover, .striptoggle.on { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .striptoggle:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
  @media (max-width: 720px) {
    .page { height: auto; min-height: 100dvh; }
    /* a capsule segmented toggle (language section 10) */
    .narrowbar { display: flex; gap: 2px; margin: 0; padding: 6px 12px; background: var(--nb-bg); border-bottom: 1px solid var(--nb-border); position: sticky; top: 48px; z-index: 15; }
    .narrowbar button { all: unset; flex: 1; text-align: center; height: 32px; line-height: 32px; border-radius: var(--nb-radius-pill); font-size: var(--nb-text-md); color: var(--nb-text-muted); cursor: pointer; }
    .narrowbar button.on { background: var(--nb-surface); color: var(--nb-text); font-weight: var(--nb-weight-medium); box-shadow: inset 0 0 0 1px var(--nb-border-strong), var(--nb-shadow-sm); }
    .layout, .layout.solo { display: block; padding: 0; }
    .left { overflow: visible; padding: 0; }
    .leftin { padding: 0 0 0; gap: 10px; }
    .leftin > :global(:not(.media)) { padding-left: 12px; padding-right: 12px; }
    .splitter, .showdev, .striptoggle { display: none; }
    .strip { padding: 6px 12px; }
    .strip dl { gap: 2px 14px; }
    .fact.url { flex-basis: 100%; }
    .right { display: none; height: calc(100dvh - 93px); padding: 0; }
    .show-dev-narrow .left { display: none; }
    .show-dev-narrow .right { display: block; }
  }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .narrowbar button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
</style>
