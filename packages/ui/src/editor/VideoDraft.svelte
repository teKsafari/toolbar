<script lang="ts">
  // Video and replay draft preview (J-084, J-085, J-240): play, click-to-toggle, a trim bar with
  // two grips that scrub the preview, the kept length in words, trim undo and redo. No drawing.
  import { untrack } from 'svelte';
  import EdIcon from './EdIcon.svelte';
  import Tip from './Tip.svelte';
  import { clock, spellDuration, type TrimState } from './trim.svelte.ts';
  import { ReplayDriver, type parseNdjson } from './replay.ts';

  interface Props {
    src: string | null;
    trim: TrimState;
    /** known length before the media reports one (MediaRecorder WebM has no duration header) */
    fallbackDurationMs?: number | null;
    /** a frame for the drafts list, once */
    onthumb?: (blob: Blob) => void;
    placeholder?: string;
    /** rrweb events of an instant-replay draft with no video: a DOM replay instead (J-009, J-010) */
    replayEvents?: ReturnType<typeof parseNdjson> | null;
    /** epoch ms of draft time 0, to line the replay up with the trim range */
    startedAt?: number | null;
  }
  let { src, trim, fallbackDurationMs = null, onthumb, placeholder = 'No video in this draft', replayEvents = null, startedAt = null }: Props = $props();

  let replayStage: HTMLDivElement | undefined = $state();
  let driver: ReplayDriver | null = null;
  const isReplay = $derived(!src && !!replayEvents?.length);
  $effect(() => {
    const stage = replayStage;
    if (!isReplay || !stage) return;
    const d = untrack(() => {
      try {
        const d = new ReplayDriver(stage, replayEvents!, startedAt);
        d.onfinish = () => {
          playing = false;
          cancelAnimationFrame(raf);
        };
        trim.setDuration(fallbackDurationMs || d.totalMs, trim.range);
        d.seek(trim.startMs);
        currentMs = trim.startMs;
        ready = true;
        return d;
      } catch {
        return null;
      }
    });
    if (!d) return;
    driver = d;
    return () => {
      d.destroy();
      driver = null;
    };
  });

  let video: HTMLVideoElement | undefined = $state();
  let track: HTMLDivElement | undefined = $state();
  let playing = $state(false);
  let currentMs = $state(0);
  let ready = $state(false);
  let probing = false;
  let thumbDone = false;
  let raf = 0;

  const pct = (ms: number) => (trim.durationMs ? (ms / trim.durationMs) * 100 : 0);

  function onMeta() {
    const v = video!;
    if (!Number.isFinite(v.duration) || v.duration === 0) {
      // WebM without a duration: seek far past the end so the browser computes it
      probing = true;
      v.currentTime = 1e101;
      return;
    }
    applyDuration();
  }
  function onDurationChange() {
    const v = video!;
    if (probing && Number.isFinite(v.duration) && v.duration > 0) {
      probing = false;
      applyDuration();
    }
  }
  function applyDuration() {
    const v = video!;
    const ms = Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : (fallbackDurationMs ?? 0);
    const range = trim.range;
    trim.setDuration(ms, range);
    v.currentTime = trim.startMs / 1000;
    currentMs = trim.startMs;
    ready = true;
  }
  function onSeeked() {
    if (probing || thumbDone || !onthumb || !video || !ready) return;
    thumbDone = true;
    try {
      const v = video;
      const w = 320;
      const h = Math.max(1, Math.round((v.videoHeight / Math.max(1, v.videoWidth)) * w));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(v, 0, 0, w, h);
      c.toBlob((b) => b && onthumb?.(b), 'image/webp', 0.8);
    } catch {
      /* a tainted or empty frame: no thumbnail */
    }
  }

  function loop() {
    if (driver) {
      currentMs = driver.currentMs;
      if (playing && currentMs >= trim.endMs - 20) {
        driver.seek(trim.endMs);
        playing = false;
        currentMs = trim.endMs;
        return;
      }
      if (playing) raf = requestAnimationFrame(loop);
      return;
    }
    if (!video) return;
    currentMs = video.currentTime * 1000;
    if (playing && currentMs >= trim.endMs - 20) {
      video.pause();
      video.currentTime = trim.endMs / 1000;
      currentMs = trim.endMs;
      return;
    }
    if (playing) raf = requestAnimationFrame(loop);
  }

  export async function toggle() {
    if (driver) {
      if (playing) {
        driver.pause();
        playing = false;
        cancelAnimationFrame(raf);
        currentMs = driver.currentMs;
        return;
      }
      const t = driver.currentMs;
      driver.play(t < trim.startMs || t >= trim.endMs - 50 ? trim.startMs : t);
      playing = true;
      raf = requestAnimationFrame(loop);
      return;
    }
    if (!video || !src) return;
    if (playing) {
      video.pause();
      return;
    }
    // play starts at the left grip (J-084)
    const t = video.currentTime * 1000;
    if (t < trim.startMs || t >= trim.endMs - 50) video.currentTime = trim.startMs / 1000;
    try {
      await video.play();
    } catch {
      /* autoplay policy or a broken file */
    }
  }
  export function seek(ms: number) {
    const clamped = Math.max(0, Math.min(ms, trim.durationMs));
    if (driver) {
      driver.seek(clamped);
      playing = false;
      cancelAnimationFrame(raf);
      currentMs = clamped;
      return;
    }
    if (!video) return;
    video.currentTime = clamped / 1000;
    currentMs = clamped;
  }

  function msAt(clientX: number) {
    const r = track!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * trim.durationMs;
  }

  let dragging: 'start' | 'end' | null = $state(null);
  function gripDown(which: 'start' | 'end', e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    video?.pause();
    if (driver && playing) toggle();
    dragging = which;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    trim.beginDrag();
  }
  function gripMove(e: PointerEvent) {
    if (!dragging) return;
    trim.moveGrip(dragging, msAt(e.clientX));
    seek(dragging === 'start' ? trim.startMs : trim.endMs);
  }
  function gripUp(e?: PointerEvent) {
    if (!dragging) return;
    if (e?.type === 'pointerup') gripMove(e); // the release point, in case the last move was coalesced
    dragging = null;
    trim.endDrag();
  }
  function trackDown(e: PointerEvent) {
    if (e.button !== 0) return;
    seek(msAt(e.clientX));
  }
  function gripKey(which: 'start' | 'end', e: KeyboardEvent) {
    const step = e.shiftKey ? 1000 : 100;
    const cur = which === 'start' ? trim.startMs : trim.endMs;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      trim.set(which, cur + (e.key === 'ArrowLeft' ? -step : step));
      seek(which === 'start' ? trim.startMs : trim.endMs);
    }
  }

  $effect(() => () => cancelAnimationFrame(raf));
  $effect(() => {
    if (!ready && fallbackDurationMs && !src && !isReplay) {
      trim.setDuration(fallbackDurationMs, trim.range);
      ready = true;
    }
  });
</script>

<div class="nb-vd" data-testid="video-draft">
  <div class="nb-vd-stage">
    {#if src}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video
        bind:this={video}
        {src}
        preload="auto"
        playsinline
        data-testid="draft-video"
        onloadedmetadata={onMeta}
        ondurationchange={onDurationChange}
        onseeked={onSeeked}
        onplay={() => {
          playing = true;
          raf = requestAnimationFrame(loop);
        }}
        onpause={() => {
          playing = false;
          cancelAnimationFrame(raf);
          if (video) currentMs = video.currentTime * 1000;
        }}
        onclick={toggle}
      ></video>
      {#if !playing}
        <button type="button" class="nb-vd-play" aria-label="Play" data-testid="play" onclick={toggle}>
          <EdIcon name="play" size={26} />
        </button>
      {/if}
    {:else if isReplay}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="nb-vd-replay" bind:this={replayStage} data-testid="draft-replay" onclick={toggle}></div>
      {#if !playing}
        <button type="button" class="nb-vd-play" aria-label="Play" data-testid="play" onclick={toggle}>
          <EdIcon name="play" size={26} />
        </button>
      {/if}
    {:else}
      <div class="nb-vd-empty">{placeholder}</div>
    {/if}
  </div>

  <div class="nb-vd-bar">
    <div
      class="nb-vd-track"
      bind:this={track}
      role="slider"
      tabindex="-1"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={trim.durationMs}
      aria-valuenow={Math.round(currentMs)}
      data-testid="trim-track"
      onpointerdown={trackDown}
    >
      <div class="nb-vd-cut" style="left:0;width:{pct(trim.startMs)}%" data-testid="cut-start"></div>
      <div class="nb-vd-cut" style="left:{pct(trim.endMs)}%;right:0" data-testid="cut-end"></div>
      <div class="nb-vd-keep" style="left:{pct(trim.startMs)}%;width:{pct(trim.endMs) - pct(trim.startMs)}%"></div>
      <div class="nb-vd-head" style="left:{pct(currentMs)}%" aria-hidden="true"></div>
      <button
        type="button"
        class="nb-vd-grip nb-start"
        style="left:{pct(trim.startMs)}%"
        aria-label="Trim start {clock(trim.startMs)}"
        data-testid="grip-start"
        onpointerdown={(e) => gripDown('start', e)}
        onpointermove={gripMove}
        onpointerup={(e) => gripUp(e)}
        onpointercancel={() => gripUp()}
        onkeydown={(e) => gripKey('start', e)}
      ></button>
      <button
        type="button"
        class="nb-vd-grip nb-end"
        style="left:{pct(trim.endMs)}%"
        aria-label="Trim end {clock(trim.endMs)}"
        data-testid="grip-end"
        onpointerdown={(e) => gripDown('end', e)}
        onpointermove={gripMove}
        onpointerup={(e) => gripUp(e)}
        onpointercancel={() => gripUp()}
        onkeydown={(e) => gripKey('end', e)}
      ></button>
    </div>
    <div class="nb-vd-under">
      <span class="nb-vd-time" aria-hidden="true">{clock(currentMs)}</span>
      <span class="nb-vd-len" data-testid="length">{spellDuration(trim.lengthMs)}</span>
      <span class="nb-vd-undo">
        <Tip label="Undo trim" keys="Ctrl+Z">
          <button type="button" class="nb-vd-btn" aria-label="Undo trim" disabled={!trim.canUndo} data-testid="trim-undo" onclick={() => trim.undo()}>
            <EdIcon name="undo" size={16} />
          </button>
        </Tip>
        <Tip label="Redo trim" keys="Ctrl+Shift+Z">
          <button type="button" class="nb-vd-btn" aria-label="Redo trim" disabled={!trim.canRedo} data-testid="trim-redo" onclick={() => trim.redo()}>
            <EdIcon name="redo" size={16} />
          </button>
        </Tip>
      </span>
    </div>
  </div>
</div>

<style>
  .nb-vd {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .nb-vd-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--nb-radius-md);
    background: #111;
    overflow: hidden;
  }
  video {
    max-width: 100%;
    max-height: 100%;
    display: block;
    cursor: pointer;
  }
  .nb-vd-replay {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--nb-surface);
    cursor: pointer;
  }
  .nb-vd-replay :global(.replayer-wrapper) {
    position: absolute;
  }
  .nb-vd-replay :global(iframe) {
    border: 0;
    pointer-events: none;
    background: #fff;
  }
  /* our own pointer glyph: a small ink arrow */
  .nb-vd-replay :global(.replayer-mouse) {
    position: absolute;
    width: 18px;
    height: 18px;
    pointer-events: none;
    transition:
      left 0.05s linear,
      top 0.05s linear;
    background: no-repeat 0 0 / 18px 18px
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 18 18'%3E%3Cpath d='M2 1.5v13l3.6-3.4 2.6 5.4 2.2-1-2.6-5.3H13z' fill='%231a1918' stroke='%23fff' stroke-width='1.2' stroke-linejoin='round'/%3E%3C/svg%3E");
  }
  .nb-vd-replay :global(.replayer-mouse.active) {
    transform: scale(0.85);
  }
  .nb-vd-replay :global(.replayer-mouse-tail) {
    display: none;
  }
  .nb-vd-play {
    all: unset;
    position: absolute;
    left: 50%;
    top: 50%;
    width: 60px;
    height: 60px;
    margin: -30px 0 0 -30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgb(255 255 255 / 0.92);
    color: var(--nb-paper-900, #1a1918);
    box-shadow: var(--nb-shadow-lg);
    cursor: pointer;
  }
  .nb-vd-play:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  .nb-vd-empty {
    color: #bbb;
    font: var(--nb-text-base) / 1.4 var(--nb-font-sans);
  }
  .nb-vd-bar {
    flex: none;
    padding: 0 6px;
  }
  .nb-vd-track {
    position: relative;
    height: 28px;
    border-radius: var(--nb-radius-sm);
    background: var(--nb-surface-sunken);
    cursor: pointer;
    touch-action: none;
  }
  .nb-vd-keep {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--nb-accent-tint);
    border-top: 2px solid var(--nb-accent);
    border-bottom: 2px solid var(--nb-accent);
    box-sizing: border-box;
  }
  .nb-vd-cut {
    position: absolute;
    top: 0;
    bottom: 0;
    background: repeating-linear-gradient(135deg, rgb(0 0 0 / 0.08) 0 4px, rgb(0 0 0 / 0.14) 4px 8px);
    border-radius: inherit;
  }
  .nb-vd-head {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    margin-left: -1px;
    background: var(--nb-text);
    pointer-events: none;
  }
  .nb-vd-grip {
    all: unset;
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 12px;
    margin-left: -6px;
    border-radius: 4px;
    background: var(--nb-accent);
    cursor: ew-resize;
    touch-action: none;
    box-shadow: var(--nb-shadow-sm);
  }
  .nb-vd-grip::after {
    content: '';
    position: absolute;
    left: 5px;
    top: 9px;
    bottom: 9px;
    width: 2px;
    border-radius: 1px;
    background: var(--nb-on-accent);
    opacity: 0.8;
  }
  .nb-vd-grip:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 2px;
  }
  .nb-vd-under {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-top: 8px;
    font: var(--nb-text-md) / 1 var(--nb-font-sans);
    color: var(--nb-text-muted);
  }
  .nb-vd-time {
    font-family: var(--nb-font-mono);
    font-size: var(--nb-text-sm);
  }
  .nb-vd-len {
    color: var(--nb-text);
    font-weight: var(--nb-weight-medium);
  }
  .nb-vd-undo {
    justify-self: end;
    display: inline-flex;
    gap: 2px;
  }
  .nb-vd-btn {
    all: unset;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--nb-radius-sm);
    color: var(--nb-text-muted);
    cursor: pointer;
  }
  .nb-vd-btn:hover:not(:disabled) {
    background: var(--nb-surface-sunken);
  }
  .nb-vd-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }
</style>
