<script lang="ts">
  // In-page UI root (ext-ui): screenshot mode, countdown veil, recording bar, live pen and blur,
  // the Part 2 reviewer toolbar (@toolbar/review), toasts. It is a view of the worker's capture session for this tab (ui/state.svelte.ts);
  // the editor (editor area) mounts on its own from ui.editor-open.
  import { onMount } from 'svelte';
  import { browser } from 'wxt/browser';
  import { Toaster, toasts } from '@toolbar/ui';
  import type { ContentCommand } from '@toolbar/shared/ext';
  import { LIVE_PEN_COLORS } from '@toolbar/shared/areas/ext-ui';
  import { ui } from './ui/state.svelte';
  import { setUiRoot } from '@toolbar/review/guard';
  import { send } from './ui/send';
  import * as blur from './ui/blur';
  import ScreenshotMode from './ui/ScreenshotMode.svelte';
  import CountdownVeil from './ui/CountdownVeil.svelte';
  import RecordingBar from './ui/RecordingBar.svelte';
  import LiveDraw from './ui/LiveDraw.svelte';
  import LiveBlur from './ui/LiveBlur.svelte';
  import { Review } from '@toolbar/review';
  import { applyAccent } from '@toolbar/ui/accent';
  import { brand, loadBrand } from '../../lib/brand.svelte';

  let root: HTMLDivElement | undefined = $state();
  let host: Element | null = $state(null);
  let penColor: string = $state(LIVE_PEN_COLORS[0]);
  let blurCount = $state(0);
  let draw: LiveDraw | undefined = $state();

  const s = $derived(ui.session);
  const barSession = $derived(s.state === 'countdown' || s.state === 'starting' || s.state === 'recording' || s.state === 'stopping' ? s : null);
  const live = $derived(s.state === 'countdown' || s.state === 'recording');

  function onCommand(msg: ContentCommand) {
    switch (msg?.type) {
      case 'ui.session':
        ui.apply(msg);
        return;
      case 'ui.toast':
        toasts.show(msg.text, {
          kind: msg.kind,
          action: msg.action ? { label: msg.action.label, run: () => void browser.runtime.sendMessage(msg.action!.request) } : undefined,
        });
        return;
      case 'ui.tools-reset':
        blur.clear();
        blurCount = 0;
        draw?.clear();
        return;
    }
  }

  // The recorder starts once the page painted without the countdown veil (J-006): two frames
  // after the starting state reached the DOM, the frame without the veil is on screen.
  let clearedFor: string | null = null;
  $effect(() => {
    if (s.state !== 'starting' || clearedFor === s.recordingId) return;
    const recordingId = (clearedFor = s.recordingId);
    requestAnimationFrame(() => requestAnimationFrame(() => void send('countdown.cleared', { recordingId })));
  });

  function setTool(tool: 'pen' | 'blur' | null) {
    ui.tool = tool;
    void send('recording.tool', { tool });
    // during the countdown the blur tool holds the count, and done lets it run on (J-036)
    if (s.state === 'countdown') void send(tool === 'blur' ? 'countdown.pause' : 'countdown.resume', {});
  }

  onMount(() => {
    const shadow = root?.getRootNode();
    if (shadow instanceof ShadowRoot) {
      setUiRoot(shadow);
      host = shadow.host;
    }
    const listener = (msg: ContentCommand) => {
      onCommand(msg);
      return undefined;
    };
    browser.runtime.onMessage.addListener(listener);
    void send('ui.state', {}).then((r) => {
      if (!r.ok) return;
      ui.tabId = r.tabId;
      ui.apply(r.cmd);
    });
    const settingsKey = 'tb:settings';
    void browser.storage.local.get(settingsKey).then((got) => {
      ui.micSetting = !!(got[settingsKey] as { mic?: boolean } | undefined)?.mic;
    });
    return () => {
      browser.runtime.onMessage.removeListener(listener);
      setUiRoot(null);
    };
  });

  // the signed-in server's accent on the bar, toasts and screenshot mode (D-112)
  loadBrand();
  $effect(() => {
    if (root) applyAccent(root, brand.accent);
  });

  // tools end with the recording
  $effect(() => {
    if (!live && ui.tool) ui.tool = null;
  });
</script>

<div class="nb-ui" data-nb-ui data-session={s.state} data-nb-brand={brand.name} bind:this={root}>
  {#if s.state === 'arming-screenshot'}
    {#key s.armedAt}
      <ScreenshotMode delaySec={s.delaySec} />
    {/key}
  {/if}
  {#if s.state === 'countdown' && ui.tool !== 'blur'}
    <CountdownVeil paused={s.paused} micOn={ui.micSetting} />
  {/if}
  {#if live}
    <LiveDraw bind:this={draw} active={ui.tool === 'pen' && s.state === 'recording'} color={penColor} onescape={() => setTool(null)} />
    {#if ui.tool === 'blur'}
      <LiveBlur {host} onchange={() => (blurCount = blur.count())} ondone={() => setTool(null)} />
    {/if}
  {/if}
  {#if barSession}
    <RecordingBar
      session={barSession}
      countdownLeftMs={ui.countdownLeftMs}
      countdownAt={ui.countdownAt}
      capMs={ui.capMs}
      tool={ui.tool}
      micSetting={ui.micSetting}
      {penColor}
      {blurCount}
      ontool={setTool}
      onpencolor={(c) => (penColor = c)}
      onblurundo={() => {
        blur.undo();
        blurCount = blur.count();
      }}
    />
  {/if}
  <!-- Part 2 reviewer toolbar: steps aside while a Jam-style capture owns the page -->
  <Review blocked={s.state !== 'idle'} />
  <Toaster />
</div>

<style>
  .nb-ui {
    /* status colours on the chrome (always near-black): the dark theme's AA steps, whatever the
       OS theme, so a red stop or an amber timer reads on the bar in light mode too (D-176) */
    --nb-chrome-danger: #f87171;
    --nb-chrome-warning: #fbbf24;
    --nb-chrome-faint: #8a8a8f;
    pointer-events: none;
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
    color: var(--nb-text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
</style>
