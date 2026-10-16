<script lang="ts">
  // Instant replay playback (J-100, J-229): a loading card with a thin progress bar while the DOM
  // recording downloads, then the rrweb replay scaled into the media card with a pointer glyph,
  // and a small control bar: play, back and forward 5 s, time, speed, fullscreen, with error
  // markers above the seek bar. No download, share-at-time, mute, quality or chapters.
  import { onMount } from 'svelte';
  import { fmtClock } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import Avatar from './Avatar.svelte';
  import Dropdown from './Dropdown.svelte';
  import Timeline from './Timeline.svelte';
  import { getShareToken } from './api.ts';
  import { useViewer } from './viewer.svelte.ts';
  import { SHARE_TOKEN_HEADER } from '@toolbar/shared/api';
  import '@rrweb/replay/dist/style.css';

  type RrEvent = { type: number; timestamp: number; data: unknown };
  type Player = import('@rrweb/replay').Replayer;

  const v = useViewer();
  let stage: HTMLDivElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  let host: HTMLDivElement | undefined = $state();
  let progress = $state(0);
  let ready = $state(false);
  let failed: string | null = $state(null);
  let menu = $state(false);
  let ended = $state(false);
  let dragging = $state(false);
  let scale = $state(1);
  let size = $state({ w: 1280, h: 720 });
  let player: Player | null = null;
  /** player ms at rrweb time 0 */
  let base = 0;
  const SPEEDS = [0.5, 1, 1.5, 2];

  async function fetchChunk(url: string): Promise<RrEvent[]> {
    const headers = new Headers();
    const t = getShareToken();
    if (t) headers.set(SHARE_TOKEN_HEADER, t);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Replay data missing (${res.status})`);
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    }
    const text = new TextDecoder().decode(buf).trim();
    if (text.startsWith('[')) return JSON.parse(text) as RrEvent[];
    return text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as RrEvent);
  }

  function fit() {
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    scale = Math.min(r.width / size.w, r.height / size.h);
  }

  onMount(() => {
    let dead = false;
    let raf = 0;
    const ro = new ResizeObserver(fit);
    (async () => {
      try {
        const urls = v.detail.media.rrwebUrls;
        const all: RrEvent[] = [];
        for (const [i, url] of urls.entries()) {
          all.push(...(await fetchChunk(url)));
          progress = (i + 1) / Math.max(1, urls.length);
        }
        if (dead) return;
        all.sort((a, b) => a.timestamp - b.timestamp);
        if (all.length < 2) throw new Error('The replay holds no page snapshot');
        const meta = all.find((e) => e.type === 4)?.data as { width?: number; height?: number } | undefined;
        if (meta?.width && meta?.height) size = { w: meta.width, h: meta.height };
        const { Replayer } = await import('@rrweb/replay');
        if (dead || !host) return;
        player = new Replayer(all as never, { root: host, skipInactive: false, showWarning: false, mouseTail: false, speed: v.prefs.playbackRate, triggerFocus: false });
        base = all[0]!.timestamp - v.map.startedAt;
        v.duration = player.getMetaData().totalTime + base;
        v.seekImpl = (ms) => {
          ended = false;
          const t = Math.max(0, ms - base);
          if (v.playing) player?.play(t);
          else player?.pause(t);
        };
        v.playImpl = () => toggle();
        player.on('finish', () => {
          v.playing = false;
          ended = true;
        });
        player.pause(Math.max(0, (v.data.startAt ?? 0) * 1000 - base));
        ready = true;
        fit();
        if (stage) ro.observe(stage);
        const tick = () => {
          if (player && !dragging && v.playing) v.now = player.getCurrentTime() + base;
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        failed = (e as Error).message;
      }
    })();
    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      player?.destroy();
      v.seekImpl = null;
      v.playImpl = null;
    };
  });

  function toggle() {
    if (!player) return;
    if (v.playing) {
      player.pause();
      v.playing = false;
    } else {
      const at = ended ? 0 : Math.max(0, v.now - base);
      ended = false;
      player.play(at);
      v.playing = true;
    }
  }
  function jump(ms: number) {
    v.seek(v.now + ms);
  }
  function setSpeed(s: number) {
    player?.setConfig({ speed: s });
    v.setPref({ playbackRate: s });
    menu = false;
  }
  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    else await card?.requestFullscreen().catch(() => {});
    setTimeout(fit, 100);
  }
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
    if (e.key === 'k' || (e.key === ' ' && !t?.closest('button'))) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'f') void fullscreen();
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !t?.closest('[data-keys-own]')) {
      e.preventDefault();
      jump(e.key === 'ArrowLeft' ? -5000 : 5000);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="card" bind:this={card} data-testid="replay-card">
  {#if v.detail.author}<span class="chip"><Avatar name={v.detail.author.name} size={20} />{v.detail.author.name}</span>{/if}
  <div class="stage" bind:this={stage}>
    <!-- inert: the replayed page is a picture of the session, so Tab and screen readers skip its
         recorded controls (D-180); the frame stays readable for tests and the clock -->
    <div class="host" bind:this={host} inert style:width="{size.w}px" style:height="{size.h}px" style:transform="translate(-50%, -50%) scale({scale})" data-testid="replay-stage"></div>
  </div>
  {#if !ready}
    <div class="loading" data-testid="replay-loading">
      {#if failed}
        <p>{failed}</p>
      {:else}
        <p>Rebuilding the session in your browser</p>
        <div class="progress"><span style:width="{Math.max(6, progress * 100)}%"></span></div>
      {/if}
    </div>
  {:else}
    {#if ended}
      <button type="button" class="again" onclick={() => { v.seek(0); toggle(); }} data-testid="replay-prompt"><VIcon name="replay" size={18} />Watch again</button>
    {/if}
    <div class="controls">
      <Timeline bind:dragging comments={true} />
      <div class="row">
        <div class="pill">
          <button type="button" class="ib" onclick={toggle} aria-label={v.playing ? 'Pause' : 'Play'} data-testid="play"><VIcon name={v.playing ? 'pause' : 'play'} size={16} /></button>
          <button type="button" class="ib" onclick={() => jump(-5000)} aria-label="Back 5 seconds"><VIcon name="skip-back" size={16} /></button>
          <button type="button" class="ib" onclick={() => jump(5000)} aria-label="Forward 5 seconds"><VIcon name="skip-forward" size={16} /></button>
          <span class="time" data-testid="time">{fmtClock(v.now)} / {fmtClock(v.duration)}</span>
        </div>
        <span class="grow"></span>
        <div class="pill">
          <Dropdown open={menu} up align="end" onclose={() => (menu = false)}>
            {#snippet trigger()}
              <button type="button" class="ib txt" onclick={() => (menu = !menu)} aria-label="Playback speed" data-testid="speed">{v.prefs.playbackRate}x</button>
            {/snippet}
            <div class="list" role="menu">
              {#each SPEEDS as s (s)}<button type="button" role="menuitem" class:sel={v.prefs.playbackRate === s} onclick={() => setSpeed(s)}>{s}x</button>{/each}
            </div>
          </Dropdown>
          <button type="button" class="ib" onclick={fullscreen} aria-label="Fullscreen" data-testid="fullscreen"><VIcon name="fullscreen" size={16} /></button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .card { position: relative; aspect-ratio: 16 / 9; max-height: 70vh; width: 100%; border-radius: var(--nb-radius-lg); overflow: hidden; background: #1b1b1b; display: flex; flex-direction: column; }
  .chip { position: absolute; top: 12px; left: 12px; z-index: 3; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 4px; border-radius: 999px; background: rgb(11 11 11 / 0.6); color: #fafafa; font-size: var(--nb-text-md); backdrop-filter: blur(6px); }
  .stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  .host { position: absolute; left: 50%; top: 50%; transform-origin: center; background: #fff; }
  .host :global(iframe) { border: 0; background: #fff; }
  .host :global(.replayer-mouse) { display: block !important; width: 22px; height: 22px; background: none; border: 0; }
  .host :global(.replayer-mouse::after) { content: ''; position: absolute; inset: 0; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 3.5 18 12l-5.25 1.25L10 18.5z' fill='%230b0b0b' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat; border: 0; border-radius: 0; animation: none; }
  .host :global(.replayer-mouse.active::after) { filter: drop-shadow(0 0 4px #60a5fa); }
  .loading { position: absolute; inset: 0; z-index: 4; display: grid; place-content: center; gap: 12px; justify-items: center; background: var(--nb-surface); color: var(--nb-text-muted); }
  .loading p { margin: 0; }
  .progress { width: 220px; height: 3px; border-radius: 2px; background: var(--nb-border); overflow: hidden; }
  .progress span { display: block; height: 100%; background: var(--nb-text); transition: width var(--nb-dur-med); }
  .controls { position: absolute; inset: auto 0 0; padding: 8px 10px 8px; background: linear-gradient(transparent, rgb(0 0 0 / 0.55)); color: #fafafa; z-index: 3; }
  .row { display: flex; align-items: center; margin-top: 4px; }
  .grow { flex: 1; }
  .pill { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 999px; border: 1px solid var(--nb-chrome-border); background: var(--nb-chrome); }
  .ib { all: unset; display: inline-grid; place-items: center; min-width: 28px; height: 28px; border-radius: 999px; cursor: pointer; color: var(--nb-on-chrome); transition: background-color var(--nb-dur-fast) var(--nb-ease-out); }
  .ib:hover { background: var(--nb-chrome-2); }
  .ib:focus-visible { outline: 2px solid #fafafa; outline-offset: -2px; }
  .txt { font: 500 var(--nb-text-sm) var(--nb-font-mono); padding: 0 6px; }
  .time { font: 500 var(--nb-text-sm) var(--nb-font-mono); padding: 0 8px; }
  .again { all: unset; position: absolute; left: 50%; top: 45%; translate: -50% -50%; z-index: 3; display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; background: #ffffff; color: #0b0b0b; font-weight: 600; cursor: pointer; box-shadow: 0 1px 2px rgb(0 0 0 / 0.18), inset 0 1px 0 rgb(255 255 255 / 0.7), 0 18px 40px rgb(0 0 0 / 0.28); }
  .list { display: flex; flex-direction: column; padding: 4px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-chrome-border); background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: var(--nb-shadow-lg); }
  .list button { all: unset; padding: 5px 10px; border-radius: var(--nb-radius-sm); cursor: pointer; font-size: var(--nb-text-md); }
  .list button:hover, .list .sel { background: var(--nb-chrome-2); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .again:focus-visible { outline: 2px solid #fafafa; outline-offset: 2px; }
  .list button:focus-visible { outline: 2px solid #fafafa; outline-offset: -2px; }
</style>
