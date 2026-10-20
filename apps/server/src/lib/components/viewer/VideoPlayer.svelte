<script lang="ts">
  // Video card (J-092): dark card, creator chip, big play button with the duration, auto-hiding
  // controls (play, back and forward 5 s, mute, time, chapters, captions, speed, quality,
  // download, fullscreen), the seek bar with error, request, pen and comment markers (J-072,
  // J-095, J-128), hover preview (J-094), share at the current time (J-097), keyboard (J-093)
  // and a replay prompt at the end. The <video> element is the clock master (architecture s12).
  import EmbedMark from '../EmbedMark.svelte';
  import { onMount } from 'svelte';
  import { toasts } from '@toolbar/ui';
  import { fmtClock, fmtClockPrecise, secondsParam } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import Dropdown from './Dropdown.svelte';
  import Avatar from './Avatar.svelte';
  import Timeline from './Timeline.svelte';
  import { useViewer } from './viewer.svelte.ts';
  import { copyText } from './api.ts';
  import { agentNudge, shareBaseUrl } from './actions.ts';

  const v = useViewer();
  const video = $derived(v.detail.media.video!);

  let el: HTMLVideoElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  let preview: HTMLVideoElement | undefined = $state();

  let started = $state(false);
  let ended = $state(false);
  let muted = $state(false);
  let showControls = $state(true);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let menu: 'speed' | 'quality' | 'chapters' | null = $state(null);
  let captions = $state(false);
  let quality = $state('Original');
  let src = $state('');
  let hovering = $state(false);
  let dragging = $state(false);
  let fullscreen = $state(false);

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const cue = $derived(captions ? v.data.cues.find((c) => v.now >= c.startMs && v.now < c.endMs) : undefined);

  onMount(() => {
    src = video.url;
    v.seekImpl = (ms) => {
      if (!el) return;
      el.currentTime = ms / 1000;
      ended = false;
    };
    v.playImpl = () => void play();
    let raf = 0;
    const tick = () => {
      if (el && !dragging) v.now = el.currentTime * 1000;
      const rvfc = (el as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number })?.requestVideoFrameCallback;
      if (el && rvfc && v.playing) rvfc.call(el, tick);
      else raf = requestAnimationFrame(tick);
    };
    tick();
    const onFs = () => (fullscreen = document.fullscreenElement === card);
    document.addEventListener('fullscreenchange', onFs);
    if (v.data.startAt != null) queueMicrotask(() => v.seek(v.data.startAt! * 1000));
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('fullscreenchange', onFs);
      v.seekImpl = null;
      v.playImpl = null;
    };
  });

  function onMeta() {
    if (!el) return;
    const d = el.duration;
    if (Number.isFinite(d) && d > 0) v.duration = d * 1000;
    el.playbackRate = v.prefs.playbackRate;
    if (v.data.startAt != null && !started) el.currentTime = v.data.startAt;
  }

  async function play() {
    if (!el) return;
    started = true;
    ended = false;
    try {
      await el.play();
    } catch {
      /* autoplay refused; the button stays */
    }
  }
  function toggle() {
    if (!el) return;
    if (el.paused) void play();
    else el.pause();
  }
  function jump(ms: number) {
    v.seek((el ? el.currentTime * 1000 : v.now) + ms);
  }
  function setSpeed(s: number) {
    if (el) el.playbackRate = s;
    v.setPref({ playbackRate: s });
    menu = null;
  }
  function setQuality(label: string, url: string) {
    const t = el?.currentTime ?? 0;
    const was = el ? !el.paused : false;
    quality = label;
    src = url;
    menu = null;
    queueMicrotask(() => {
      if (!el) return;
      el.currentTime = t;
      if (was) void el.play();
    });
  }
  function toggleMute() {
    if (!el) return;
    el.muted = !el.muted;
    muted = el.muted;
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await card?.requestFullscreen().catch(() => {});
  }
  async function pip() {
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      /* not supported */
    }
  }

  function poke() {
    showControls = true;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (v.playing && !menu && !hovering) showControls = false;
    }, 2500);
  }

  async function shareAtTime() {
    const ms = el ? el.currentTime * 1000 : v.now;
    const base = await shareBaseUrl(v);
    if (!base) return;
    const sep = base.includes('?') ? '&' : '?';
    if (await copyText(`${base}${sep}t=${secondsParam(ms)}`)) toasts.success(`Link to ${fmtClockPrecise(ms)} copied`);
  }

  function download() {
    const a = document.createElement('a');
    a.href = `${video.url}?download=1`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    agentNudge('Download started');
  }

  function isTyping(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }
  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
    const k = e.key;
    if (k === 'k' || k === ' ') {
      if (k === ' ' && (e.target as HTMLElement)?.closest?.('button')) return;
      e.preventDefault();
      toggle();
    } else if (k === 'm') toggleMute();
    else if (k === 'f') void toggleFullscreen();
    else if (k === 'i') void pip();
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      if ((e.target as HTMLElement)?.closest?.('[data-keys-own]')) return;
      e.preventDefault();
      jump(k === 'ArrowLeft' ? -5000 : 5000);
    } else if (/^[0-9]$/.test(k)) {
      v.seek((Number(k) / 10) * v.duration);
    } else return;
    poke();
  }
</script>

<svelte:window onkeydown={onKey} />

<div
  class="card"
  class:hide={!showControls && started}
  class:fs={fullscreen}
  bind:this={card}
  onpointermove={poke}
  onpointerleave={() => { if (v.playing) showControls = false; }}
  data-testid="video-card"
  role="region"
  aria-label="Video">
  <!-- svelte-ignore a11y_media_has_caption -->
  <video
    bind:this={el}
    {src}
    preload="metadata"
    playsinline
    onloadedmetadata={onMeta}
    ondurationchange={onMeta}
    onplay={() => { v.playing = true; started = true; ended = false; poke(); }}
    onpause={() => { v.playing = false; showControls = true; }}
    onended={() => { v.playing = false; ended = true; showControls = true; }}
    onseeked={() => { if (el) v.now = el.currentTime * 1000; }}
    onclick={toggle}
    data-testid="video"></video>

  {#if cue}<div class="caption" data-testid="caption">{cue.text}</div>{/if}

  <div class="top">
    {#if v.detail.author}
      <span class="chip"><Avatar name={v.detail.author.name} size={20} />{v.detail.author.name}{#if !v.detail.authorVerified}<EmbedMark />{/if}</span>
    {/if}
    <span class="grow"></span>
    <button type="button" class="pill" onclick={shareAtTime} title="Copy a link that opens at this moment" data-testid="share-at-time">
      <VIcon name="link" size={14} />{fmtClockPrecise(v.now)}
    </button>
  </div>

  {#if !started}
    <button type="button" class="big" onclick={play} aria-label="Play" data-testid="big-play">
      <VIcon name="play" size={28} />
      <span class="dur">{fmtClock(v.duration)}</span>
    </button>
  {:else if ended}
    <button type="button" class="big again" onclick={() => { v.seek(0); void play(); }} data-testid="replay-prompt">
      <VIcon name="replay" size={24} /><span>Watch again</span>
    </button>
  {/if}

  <div class="controls">
    <Timeline frameSource={preview} bind:dragging onhover={(h) => (hovering = h)} />

    <div class="row">
      <button type="button" class="ib" onclick={toggle} aria-label={v.playing ? 'Pause' : 'Play'} title="Play or pause (k)" data-testid="play">
        <VIcon name={v.playing ? 'pause' : 'play'} size={18} />
      </button>
      <button type="button" class="ib" onclick={() => jump(-5000)} aria-label="Back 5 seconds" title="Back 5 s"><VIcon name="skip-back" size={18} /></button>
      <button type="button" class="ib" onclick={() => jump(5000)} aria-label="Forward 5 seconds" title="Forward 5 s"><VIcon name="skip-forward" size={18} /></button>
      <button type="button" class="ib" onclick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} title="Mute (m)"><VIcon name={muted ? 'volume-off' : 'volume'} size={18} /></button>
      <span class="time" data-testid="time">{fmtClock(v.now)} / {fmtClock(v.duration)}</span>
      {#if v.data.chapters && v.chapters.length}
        <!-- chapters are an AI feature, paused unless FEATURE_AI is on (docs/scope.md, J-092 review) -->
        <Dropdown open={menu === 'chapters'} up onclose={() => (menu = null)}>
          {#snippet trigger()}
            <button type="button" class="txt chap" onclick={() => (menu = menu === 'chapters' ? null : 'chapters')} data-testid="chapter-pill">
              {v.chapterAt(v.now)?.title ?? v.chapters[0]!.title}<VIcon name="chevron-up" size={12} />
            </button>
          {/snippet}
          <div class="list" role="menu" data-testid="chapters">
            {#each v.chapters as c (c.startMs)}
              <button type="button" role="menuitem" onclick={() => { v.seek(c.startMs); menu = null; }}><span class="t">{fmtClock(c.startMs)}</span>{c.title}</button>
            {/each}
          </div>
        </Dropdown>
      {/if}
      <span class="grow"></span>
      {#if v.data.cues.length}
        <button type="button" class="ib" class:on={captions} onclick={() => (captions = !captions)} aria-pressed={captions} aria-label="Captions" title="Captions" data-testid="cc"><VIcon name="captions" size={18} /></button>
      {/if}
      <Dropdown open={menu === 'speed'} up align="end" onclose={() => (menu = null)}>
        {#snippet trigger()}
          <button type="button" class="txt" onclick={() => (menu = menu === 'speed' ? null : 'speed')} aria-label="Playback speed" data-testid="speed">{v.prefs.playbackRate}x</button>
        {/snippet}
        <div class="list" role="menu">
          {#each SPEEDS as s (s)}
            <button type="button" role="menuitem" class:sel={v.prefs.playbackRate === s} onclick={() => setSpeed(s)}>{s}x</button>
          {/each}
        </div>
      </Dropdown>
      <Dropdown open={menu === 'quality'} up align="end" onclose={() => (menu = null)}>
        {#snippet trigger()}
          <button type="button" class="ib" onclick={() => (menu = menu === 'quality' ? null : 'quality')} aria-label="Quality" title="Quality" data-testid="quality"><VIcon name="settings" size={17} /></button>
        {/snippet}
        <div class="list" role="menu">
          <div class="head">Quality</div>
          {#each video.renditions as r (r.label)}
            <button type="button" role="menuitem" class:sel={quality === r.label} disabled={r.ready === false} title={r.ready === false ? 'Still being prepared' : undefined} onclick={() => setQuality(r.label, r.url)}>{r.label}{#if r.ready === false}<span class="prep"> preparing</span>{/if}</button>
          {/each}
          <button type="button" role="menuitem" class:sel={quality === 'Auto'} onclick={() => setQuality('Auto', video.url)}>Auto</button>
        </div>
      </Dropdown>
      <button type="button" class="ib" onclick={download} aria-label="Download video" title="Download" data-testid="download"><VIcon name="download" size={18} /></button>
      <button type="button" class="ib" onclick={toggleFullscreen} aria-label="Fullscreen" title="Fullscreen (f)" data-testid="fullscreen"><VIcon name="fullscreen" size={18} /></button>
    </div>
  </div>
  <!-- hidden twin used for the hover preview frames -->
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={preview} class="twin" src={video.url} preload="auto" muted playsinline></video>
</div>

<style>
  .card {
    position: relative; overflow: hidden; border-radius: var(--nb-radius-lg); background: #0b0b0b; color: #fafafa;
    aspect-ratio: 16 / 9; max-height: 70vh; width: 100%; display: grid; user-select: none;
  }
  .card.fs { border-radius: 0; max-height: none; }
  video { width: 100%; height: 100%; object-fit: contain; grid-area: 1 / 1; background: #000; }
  .twin { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
  .top {
    position: absolute; inset: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px;
    background: linear-gradient(rgb(0 0 0 / 0.55), transparent); transition: opacity var(--nb-dur-med);
  }
  .grow { flex: 1; }
  .chip, .pill {
    display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 4px; border-radius: 999px;
    background: rgb(11 11 11 / 0.6); color: #fafafa; font-size: var(--nb-text-md); border: 0; backdrop-filter: blur(6px);
  }
  .pill { padding: 0 10px; cursor: pointer; font: 500 var(--nb-text-md) var(--nb-font-mono); }
  .pill:hover { background: rgb(11 11 11 / 0.8); }
  .big {
    position: absolute; left: 50%; top: 50%; translate: -50% -50%; display: inline-flex; align-items: center; gap: 10px;
    height: 56px; padding: 0 20px 0 18px; border-radius: 999px; border: 0; cursor: pointer;
    background: rgb(255 255 255 / 0.94); color: #0b0b0b; font: 600 var(--nb-text-base) var(--nb-font-sans);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.18), inset 0 1px 0 rgb(255 255 255 / 0.7), 0 18px 40px rgb(0 0 0 / 0.28);
    transition: transform var(--nb-dur-fast) var(--nb-ease-out), background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .big:hover { background: #ffffff; }
  .big:active { transform: translateY(1px); }
  .big .dur { font: 500 var(--nb-text-md) var(--nb-font-mono); color: #4b5563; }
  .caption {
    position: absolute; left: 50%; bottom: 84px; translate: -50% 0; max-width: 80%; padding: 4px 10px; border-radius: 6px;
    background: rgb(11 11 11 / 0.8); color: #fafafa; font-size: var(--nb-text-lg); text-align: center; pointer-events: none;
  }
  .controls {
    position: absolute; inset: auto 0 0; padding: 28px 12px 8px;
    background: linear-gradient(transparent, rgb(0 0 0 / 0.7)); transition: opacity var(--nb-dur-med);
  }
  .hide .controls, .hide .top { opacity: 0; }
  .row { display: flex; align-items: center; gap: 2px; margin-top: 4px; }
  .ib, .txt {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    height: 32px; min-width: 32px; padding: 0 6px; border-radius: var(--nb-radius-sm); cursor: pointer; color: #fafafa;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .ib:hover, .txt:hover, .ib.on { background: rgb(255 255 255 / 0.14); }
  .ib:focus-visible, .txt:focus-visible { outline: 2px solid #fafafa; outline-offset: -2px; }
  .txt { font: 500 var(--nb-text-md) var(--nb-font-mono); }
  .chap { font-family: var(--nb-font-sans); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: rgb(255 255 255 / 0.1); border-radius: 999px; padding: 0 10px; height: 26px; }
  .time { font: 500 var(--nb-text-md) var(--nb-font-mono); padding: 0 8px; white-space: nowrap; }
  .list {
    display: flex; flex-direction: column; min-width: 140px; max-height: 260px; overflow: auto; padding: 4px;
    border-radius: var(--nb-radius-md); border: 1px solid var(--nb-chrome-border); background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: var(--nb-shadow-lg); font-size: var(--nb-text-md);
  }
  .list button { all: unset; display: flex; gap: 10px; padding: 5px 8px; border-radius: var(--nb-radius-sm); cursor: pointer; white-space: nowrap; }
  .list button:hover, .list .sel { background: var(--nb-chrome-2); }
  .list button:disabled { opacity: 0.55; cursor: default; background: none; }
  .list .prep { color: var(--nb-on-chrome-muted); font-size: var(--nb-text-xs); }
  .list .sel { font-weight: 600; }
  .list .t { font-family: var(--nb-font-mono); color: var(--nb-on-chrome-muted); }
  .list .head { padding: 4px 8px; font: 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-on-chrome-muted); }
  @media (max-width: 720px) {
    .card { border-radius: 0; }
    .chap { display: none; }
    .row :global([data-testid='quality']) { display: none; }
  }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .list button:focus-visible { outline: 2px solid #fafafa; outline-offset: -2px; }
</style>
