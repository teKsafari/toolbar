<script lang="ts">
  // Seek bar with markers above it (J-072, J-095, J-128): grouped errors and failed requests with
  // a status badge, pen and blur marks, comment bubbles; hover pills; a frame preview with the
  // time and chapter name (J-094); chapter edges split the bar (J-096).
  import { fmtClock } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import { useViewer } from './viewer.svelte.ts';

  interface Props {
    /** hidden video used to draw hover frames; none for the replay player */
    frameSource?: HTMLVideoElement;
    comments?: boolean;
    dragging?: boolean;
    onhover?: (active: boolean) => void;
  }
  let { frameSource, comments = true, dragging = $bindable(false), onhover }: Props = $props();
  const v = useViewer();

  let bar: HTMLDivElement | undefined = $state();
  let canvas: HTMLCanvasElement | undefined = $state();
  let hover: { x: number; ms: number } | null = $state(null);
  let tip: { x: number; title: string; lines: string[] } | null = $state(null);
  const pct = (ms: number) => (v.duration ? Math.min(100, Math.max(0, (ms / v.duration) * 100)) : 0);
  let rowW = $state(0);
  let tipW = $state(0);
  /** The card stays inside the player: centred on its marker, pushed in at either edge (J-128). */
  const tipLeft = $derived.by(() => {
    if (!tip) return 0;
    const x = (tip.x / 100) * rowW;
    if (!rowW || !tipW) return x;
    return Math.max(0, Math.min(rowW - tipW, x - tipW / 2));
  });
  /** A marker's own nudge at the edges, so a marker at 0:00 or the end is not cut in half (J-072). */
  const edge = (x: number) => (x < 2 ? '0' : x > 98 ? '-100%' : '-50%');
  // Markers closer than one marker's width on this bar merge into one, the most serious kind
  // first, so a burst of errors on a narrow (390 px) player does not pile up (J-072).
  const RANK: Record<string, number> = { 'net-fail': 3, error: 2, pen: 1 };
  const shown = $derived.by(() => {
    const px = (ms: number) => (pct(ms) / 100) * (rowW || 1);
    const out: (typeof v.markers)[number][] = [];
    for (const m of v.markers) {
      const last = out[out.length - 1];
      if (last && rowW && px(m.at) - px(last.at) < 16) {
        const keep = (RANK[m.kind] ?? 0) > (RANK[last.kind] ?? 0) ? { ...m, at: last.at } : last;
        out[out.length - 1] = { ...keep, count: last.count + m.count, items: [...last.items, ...m.items], status: keep.status ?? last.status ?? m.status };
      } else out.push(m);
    }
    return out;
  });

  const bubbles = $derived.by(() => {
    if (!comments) return [];
    const out: { at: number; items: typeof v.timedComments }[] = [];
    for (const c of [...v.timedComments].sort((a, b) => a.tMs! - b.tMs!)) {
      const last = out[out.length - 1];
      if (last && v.duration && ((c.tMs! - last.at) / v.duration) * 100 < 2) last.items.push(c);
      else out.push({ at: c.tMs!, items: [c] });
    }
    return out;
  });

  $effect(() => {
    const src = frameSource;
    if (!src) return;
    const draw = () => canvas?.getContext('2d')?.drawImage(src, 0, 0, canvas.width, canvas.height);
    src.addEventListener('seeked', draw);
    return () => src.removeEventListener('seeked', draw);
  });

  function msAt(clientX: number): { x: number; ms: number } {
    const r = bar!.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - r.left), r.width);
    return { x, ms: (x / r.width) * v.duration };
  }
  let lastPreview = 0;
  function onMove(e: PointerEvent) {
    hover = msAt(e.clientX);
    onhover?.(true);
    if (dragging) v.seek(hover.ms);
    const now = performance.now();
    if (frameSource && now - lastPreview > 80) {
      lastPreview = now;
      frameSource.currentTime = hover.ms / 1000;
    }
  }
  function onDown(e: PointerEvent) {
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    v.seek(msAt(e.clientX).ms);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      v.seek(v.now + (e.key === 'ArrowLeft' ? -5000 : 5000));
    }
  }
  function markerClick(m: (typeof v.markers)[number]) {
    v.seek(m.at, { arm: true });
    if (m.kind === 'error' || m.kind === 'net-fail') v.reveal('console', m.ref ?? '');
  }
  const markerTitle = (m: (typeof v.markers)[number]) =>
    m.kind === 'net-fail'
      ? `${m.count} failed request${m.count > 1 ? 's' : ''}`
      : m.kind === 'error'
        ? `${m.count} error${m.count > 1 ? 's' : ''}`
        : m.kind === 'pen'
          ? 'Drawing'
          : m.kind === 'blur'
            ? 'Blur'
            : m.label;
  function bubbleClick(b: (typeof bubbles)[number]) {
    v.seek(b.at);
    v.highlightComment = b.items[0]!.id;
    document.getElementById(`comment-${b.items[0]!.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const plain = (s: string) => s.replace(/@\[([^\]]+)\]\(user:[^)]+\)/g, '@$1').slice(0, 90);
</script>

<div class="markers" class:two={bubbles.length > 0} aria-label="Timeline markers" bind:clientWidth={rowW}>
  {#each shown as m, i (i)}
    <button
      type="button"
      class="mk mk-{m.kind}"
      style:left="{pct(m.at)}%"
      style:translate="{edge(pct(m.at))} 0"
      onclick={() => markerClick(m)}
      onpointerenter={() => (tip = { x: pct(m.at), title: markerTitle(m), lines: m.items.slice(0, 3) })}
      onpointerleave={() => (tip = null)}
      aria-label="{markerTitle(m)} at {fmtClock(m.at)}"
      data-testid="marker-{m.kind}">
      {#if m.kind === 'net-fail'}<span class="badge">{m.status ?? 'xhr'}</span>{#if m.count > 1}<span class="n">{m.count}</span>{/if}
      {:else if m.kind === 'error'}<VIcon name="warning" size={11} />{#if m.count > 1}<span class="n">{m.count}</span>{/if}
      {:else if m.kind === 'pen'}<VIcon name="pen" size={11} />
      {:else if m.kind === 'blur'}<VIcon name="blur" size={11} />
      {:else}<span class="dot"></span>{/if}
    </button>
  {/each}
  {#each bubbles as b (b.items[0]!.id)}
    <button
      type="button"
      class="mk bubble"
      style:left="{pct(b.at)}%"
      style:translate="{edge(pct(b.at))} 0"
      onclick={() => bubbleClick(b)}
      onpointerenter={() => (tip = { x: pct(b.at), title: b.items.map((c) => c.displayName).join(', '), lines: b.items.map((c) => plain(c.body)) })}
      onpointerleave={() => (tip = null)}
      aria-label="{b.items.length} comment{b.items.length > 1 ? 's' : ''} at {fmtClock(b.at)}"
      data-testid="marker-comment">
      <VIcon name="bubble" size={14} /><span class="n">{b.items.length}</span>
    </button>
  {/each}
  {#if tip}
    <div class="tip" bind:clientWidth={tipW} style:left="{tipLeft}px" data-testid="marker-tip">
      <strong>{tip.title}</strong>
      {#each tip.lines as l, i (i)}<span>{l}</span>{/each}
    </div>
  {/if}
</div>

<div
  class="bar"
  bind:this={bar}
  role="slider"
  tabindex="0"
  aria-label="Seek"
  aria-valuemin={0}
  aria-valuemax={Math.round(v.duration / 1000)}
  aria-valuenow={Math.round(v.now / 1000)}
  aria-valuetext={fmtClock(v.now)}
  onpointerdown={onDown}
  onpointermove={onMove}
  onpointerup={() => (dragging = false)}
  onpointerleave={() => { hover = null; onhover?.(false); }}
  onkeydown={onKey}
  data-testid="seekbar">
  {#each v.chapters.slice(1) as c (c.startMs)}<span class="split" style:left="{pct(c.startMs)}%" data-testid="chapter-split"></span>{/each}
  <span class="fill" style:width="{pct(v.now)}%"></span>
  <span class="knob" style:left="{pct(v.now)}%"></span>
  {#if hover}
    <div class="preview" style:left="{(hover.x / (bar?.clientWidth || 1)) * 100}%" data-testid="seek-preview">
      {#if frameSource}<canvas bind:this={canvas} width="160" height="90"></canvas>{/if}
      <span>{fmtClock(hover.ms)}{#if v.chapterAt(hover.ms)} · {v.chapterAt(hover.ms)!.title}{/if}</span>
    </div>
  {/if}
</div>

<style>
  .markers { position: relative; height: 22px; margin: 0 6px; }
  .markers.two { height: 42px; }
  .mk {
    position: absolute; bottom: 2px; translate: -50% 0; display: inline-flex; align-items: center; gap: 2px;
    height: 18px; min-width: 18px; padding: 0 4px; border-radius: 999px; border: 0; cursor: pointer;
    font: 600 10px var(--nb-font-mono); color: #fff; background: #c22e1f;
  }
  .mk-net-fail { background: #e04a6e; }
  .mk-pen, .mk-blur, .mk-mark { background: #f2b100; color: #1a1918; }
  .mk-pause, .mk-resume, .mk-nav, .mk-voice { background: #6d7deb; min-width: 10px; height: 10px; padding: 0; }
  .mk .dot { width: 4px; height: 4px; border-radius: 50%; background: #fff; }
  .bubble { background: #2c2a27; color: #f7f6f2; bottom: 22px; border: 1px solid #45423c; }
  .mk:hover { filter: brightness(1.15); z-index: 2; }
  .tip {
    position: absolute; bottom: 24px; z-index: 3; display: flex; flex-direction: column; gap: 2px;
    max-width: min(280px, 100%); box-sizing: border-box; padding: 6px 10px; border-radius: 8px; background: #1a1918; color: #f7f6f2; font-size: var(--nb-text-sm);
    box-shadow: var(--nb-shadow-lg); pointer-events: none; white-space: nowrap;
  }
  .markers.two .tip { bottom: 44px; }
  .tip span { overflow: hidden; text-overflow: ellipsis; color: #d6d2c8; }
  .bar { position: relative; height: 14px; margin: 0 6px; cursor: pointer; touch-action: none; }
  .bar::before { content: ''; position: absolute; inset: 5px 0; border-radius: 2px; background: rgb(255 255 255 / 0.28); }
  .bar:focus-visible { outline: 2px solid var(--nb-focus); border-radius: 4px; }
  .fill { position: absolute; left: 0; top: 5px; height: 4px; border-radius: 2px; background: #6d7deb; }
  .split { position: absolute; top: 4px; width: 2px; height: 6px; background: #0d0d0c; translate: -1px 0; z-index: 1; }
  .knob { position: absolute; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: #fff; translate: -50% 0; }
  .preview {
    position: absolute; bottom: 20px; translate: -50% 0; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 4px; border-radius: 8px; background: #1a1918; color: #f7f6f2; pointer-events: none; z-index: 4;
  }
  .preview canvas { width: 160px; height: 90px; border-radius: 4px; background: #000; }
  .preview span { font: 500 var(--nb-text-sm) var(--nb-font-mono); white-space: nowrap; padding: 0 4px; }
</style>
