<script lang="ts">
  // The launcher and the tool pill (M-01, M-03, M-04, M-05). Asleep: one dark round button with
  // the count of unsent notes. Awake: a dark pill of 32 px icon buttons that grows from the
  // launcher's corner. A running trace shows a red dot and the elapsed time (M-05). Drag the
  // launcher or the pill's grip anywhere (or move them with the arrow keys): the dock anchors to
  // the nearest corner, is remembered per origin, and stays inside the visible area (D-199).
  import { Icon, type IconName } from '@toolbar/ui';
  import { onMount } from 'svelte';
  import { DRAW_COLORS } from '@toolbar/shared/areas/reviewer';
  import { review as r, type DockPos, type Tool } from './state.svelte';
  import { EDGE, fitIn, viewport } from './viewport.svelte';

  const tools: { tool: Tool; icon: IconName; label: string; key: string }[] = [
    { tool: 'comment', icon: 'comment', label: 'Comment on an element', key: 'C' },
    { tool: 'shot', icon: 'camera', label: 'Screenshot an element', key: 'S' },
    { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
    { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
    { tool: 'freehand', icon: 'freehand', label: 'Freehand', key: 'F' },
  ];

  const elapsed = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const drawing = $derived(r.tool === 'rect' || r.tool === 'arrow' || r.tool === 'freehand');
  const left = $derived(r.pos.h === 'l');
  const top = $derived(r.pos.v === 't');

  // ---- drag anywhere, anchored to the nearest corner (M-03, D-199)
  let dock: HTMLDivElement | undefined = $state();
  /** a press on the launcher or grip; it becomes a drag past THRESHOLD px, else stays a click */
  let drag: { id: number; ox: number; oy: number; sx: number; sy: number; moved: boolean; x: number; y: number; w: number; h: number } | null = $state(null);
  const THRESHOLD = 4;
  /** the click that trails a drag of the launcher must not open the toolbar */
  let dragged = false;

  onMount(() => viewport.watch());

  /** The dock's box in the viewport, our own clamping shift left out. */
  function dockBox() {
    const b = dock!.getBoundingClientRect();
    const t = (dock!.style.translate || '0px 0px').split(' ').map((v) => parseFloat(v) || 0);
    return { x: b.left - (t[0] ?? 0), y: b.top - (t[1] ?? 0), w: b.width, h: b.height };
  }
  /** Keep a dragged box on screen. */
  function clampTo(x: number, y: number, w: number, h: number) {
    const a = viewport.box;
    return { x: Math.min(Math.max(x, a.x + EDGE), Math.max(a.x + EDGE, a.x + a.w - EDGE - w)), y: Math.min(Math.max(y, a.y + EDGE), Math.max(a.y + EDGE, a.y + a.h - EDGE - h)) };
  }
  /** A box's place as a position: the nearest corner and the distance from its two edges. */
  function anchorOf(x: number, y: number, w: number, h: number): DockPos {
    const a = viewport.box;
    const L = viewport.layout;
    const hEdge = x + w / 2 < a.x + a.w / 2 ? 'l' : 'r';
    const vEdge = y + h / 2 < a.y + a.h / 2 ? 't' : 'b';
    return { h: hEdge, v: vEdge, x: hEdge === 'l' ? x : L.w - (x + w), y: vEdge === 't' ? y : L.h - (y + h) };
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !dock) return;
    const b = dockBox();
    drag = { id: e.pointerId, ox: e.clientX - b.x, oy: e.clientY - b.y, sx: e.clientX, sy: e.clientY, moved: false, x: b.x, y: b.y, w: b.w, h: b.h };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    // the grip never selects page text; the launcher keeps its click
    if ((e.currentTarget as HTMLElement).classList.contains('grip')) e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < THRESHOLD) return;
    const p = clampTo(e.clientX - drag.ox, e.clientY - drag.oy, drag.w, drag.h);
    drag = { ...drag, moved: true, x: p.x, y: p.y };
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    dragged = true;
    setTimeout(() => (dragged = false), 0);
    r.setPos(anchorOf(d.x, d.y, d.w, d.h));
  }
  /** The press ended without a pointerup (pointercancel, lost capture, a DevTools dock change): the dock stays where it was. */
  function cancel(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) drag = null;
  }
  // a drag never outlives the window losing focus or a viewport change
  $effect(() => {
    if (!drag) return;
    const end = () => (drag = null);
    addEventListener('blur', end);
    return () => removeEventListener('blur', end);
  });

  /** Arrow keys move the dock from its anchor: 10 px, 50 px with Shift. */
  function nudge(e: KeyboardEvent) {
    const step = e.shiftKey ? 50 : 10;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    e.stopPropagation();
    if (!dock) return;
    const b = dockBox();
    const p = clampTo(b.x + dx, b.y + dy, b.w, b.h);
    r.setPos(anchorOf(p.x, p.y, b.w, b.h));
  }
  function launch() {
    if (dragged) return;
    r.wake();
  }

  /** Inline place of the dock: its anchor edges, or the pointer while dragging. */
  const place = $derived.by(() => {
    if (drag?.moved) return { left: `${drag.x}px`, top: `${drag.y}px`, right: 'auto', bottom: 'auto' };
    const p = r.pos;
    return {
      left: p.h === 'l' ? `${p.x}px` : 'auto',
      right: p.h === 'r' ? `${p.x}px` : 'auto',
      top: p.v === 't' ? `${p.y}px` : 'auto',
      bottom: p.v === 'b' ? `${p.y}px` : 'auto',
    };
  });
  /** the action's shortcut (Ctrl+Shift+Y): opening the menu on the tab lets Chrome grant screenshots (D-185) */
  const menuKey = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd+Shift+Y' : 'Ctrl+Shift+Y';
</script>

<div
  class="dock"
  class:left
  class:top
  class:dragging={!!drag?.moved}
  bind:this={dock}
  bind:offsetHeight={r.dockH}
  use:fitIn={`${place.left} ${place.top} ${place.right} ${place.bottom} ${r.awake}`}
  style:left={place.left}
  style:top={place.top}
  style:right={place.right}
  style:bottom={place.bottom}
  data-testid="review-dock"
  data-corner={r.corner}
>
  {#if !r.awake}
    <button
      type="button"
      class="launcher"
      data-nb-interactive
      data-testid="review-launcher"
      aria-label="Open the review toolbar (Ctrl+Shift+.). Drag or use the arrow keys to move it"
      title="Review this page (Ctrl+Shift+.). Drag to move"
      onclick={launch}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={cancel}
      onlostpointercapture={cancel}
      onkeydown={nudge}
    >
      <Icon name="comment" size={20} />
      {#if r.items.length}<span class="badge" data-testid="review-badge">{r.items.length}</span>{/if}
      {#if r.trace}<span class="rec-dot" aria-label="Trace running"></span>{/if}
    </button>
  {:else}
    {#if r.shotsBlocked}
      <p class="shots-note" use:fitIn role="status" data-nb-interactive data-testid="review-shots-blocked">
        <Icon name="camera" size={14} />Screenshots are off on this tab. Press {menuKey} once to allow them.
      </p>
    {/if}
    <div class="pill" role="toolbar" aria-label="Review toolbar" data-nb-interactive data-testid="review-pill">
      <button type="button" class="grip" aria-label="Move the toolbar (drag, or arrow keys)" title="Drag to move" data-testid="review-grip" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} onlostpointercapture={cancel} onkeydown={nudge}><Icon name="grip" size={14} /></button>
      {#each tools as t (t.tool)}
        <button type="button" class="ib" class:on={r.tool === t.tool} aria-pressed={r.tool === t.tool} aria-label="{t.label} ({t.key})" title="{t.label} ({t.key})" data-testid="review-tool-{t.tool}" onclick={() => r.setTool(t.tool)}>
          <Icon name={t.icon} size={17} />
          {#if t.tool === 'comment' && (r.context.errors || r.context.failed)}<span class="warn-dot" title="{r.context.errors} errors and {r.context.failed} failed requests in the last minute will go with a comment" data-testid="review-context-dot"></span>{/if}
        </button>
      {/each}
      {#if drawing}
        <span class="colors" role="radiogroup" aria-label="Colour">
          {#each DRAW_COLORS as c (c)}
            <button type="button" role="radio" aria-checked={r.color === c} aria-label="Colour {c}" class="sw" class:sel={r.color === c} style:background={c} onclick={() => (r.color = c)}></button>
          {/each}
        </span>
      {/if}
      <button type="button" class="ib" class:rec={r.voice?.for === 'standalone'} aria-label={r.voice ? 'Stop the voice note (V)' : 'Voice note (V)'} title={r.voice ? 'Stop the voice note (V)' : 'Voice note on the page or trace (V)'} data-testid="review-voice" onclick={() => r.toggleVoice()}>
        <Icon name={r.voice ? 'stop' : 'mic'} size={17} />
        {#if r.voice}<span class="time" data-testid="review-voice-time">{elapsed(r.now - r.voice.startedAt)}</span>{/if}
      </button>
      <span class="sep"></span>
      {#if r.trace}
        <button type="button" class="ib trace on-trace" aria-label="Stop trace (X)" title="Stop trace (X)" data-testid="review-trace-stop" onclick={() => r.toggleTrace()}>
          <span class="rec-dot inline"></span><span class="time" data-testid="review-trace-time">{elapsed(r.now - r.trace.startedAt)}</span><Icon name="stop" size={15} />
        </button>
      {:else}
        <button type="button" class="ib trace" aria-label="Start trace (X)" title={r.traceAvailable ? 'Start trace (X)' : 'Traces are not in this build'} disabled={!r.traceAvailable} data-testid="review-trace-start" onclick={() => r.toggleTrace()}>
          <Icon name="record" size={17} /><span class="lbl">Trace</span>
        </button>
      {/if}
      <span class="sep"></span>
      <button type="button" class="ib" class:on={r.listOpen} aria-pressed={r.listOpen} aria-label="Notes on this tab (L)" title="Notes on this tab (L)" data-testid="review-list-toggle" onclick={() => (r.listOpen = !r.listOpen)}>
        <Icon name="list" size={17} />
        {#if r.items.length}<span class="count" data-testid="review-count">{r.items.length}</span>{/if}
      </button>
      <button type="button" class="ib" aria-pressed={r.pinsHidden} aria-label={r.pinsHidden ? 'Show pins (H)' : 'Hide pins (H)'} title={r.pinsHidden ? 'Show pins (H)' : 'Hide pins (H)'} data-testid="review-hide-pins" onclick={() => (r.pinsHidden = !r.pinsHidden)}>
        <Icon name={r.pinsHidden ? 'eye' : 'eye-off'} size={17} />
      </button>
      <button type="button" class="send" disabled={!r.items.length || r.busy} aria-label="Send {r.items.length} notes" title={r.trace ? 'Add the notes to the trace' : 'Send the notes'} data-testid="review-send" onclick={() => void r.submit()}>
        <Icon name="send" size={15} />{r.items.length || ''}
      </button>
      <button type="button" class="ib" aria-label="Close (Esc)" title="Close (Esc)" data-testid="review-close" onclick={() => r.sleep()}><Icon name="close" size={17} /></button>
    </div>
  {/if}
</div>

<style>
  /* Chrome of the teksafari language (D-176): near-black capsule with a 1 px chrome edge, muted
     icons that brighten on hover, the chrome accent (near-white, or the brand's dark-theme shade)
     for the pressed tool and Send. Sizes and positions are the parity ones (M-01 to M-05). */
  /* placed inline from the saved position (anchor corner plus offsets); fitIn keeps it on screen */
  .dock { position: fixed; pointer-events: none; display: flex; justify-content: flex-end; font: var(--nb-weight-medium) 13px/1 var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui); }
  .dock.left { justify-content: flex-start; }
  .dock.dragging { opacity: 0.85; }
  .dock.dragging .launcher, .dock.dragging .grip { cursor: grabbing; }
  .launcher { all: unset; box-sizing: border-box; position: relative; pointer-events: auto; cursor: pointer; touch-action: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), inset 0 1px 0 rgb(255 255 255 / 0.06), var(--nb-shadow-lg); transition: transform var(--nb-dur-fast) var(--nb-ease-out), background-color var(--nb-dur-fast) var(--nb-ease-out); }
  .launcher:hover { background: var(--nb-chrome-2); }
  .launcher:active { transform: translateY(1px); }
  .launcher:focus-visible, .ib:focus-visible, .send:focus-visible { outline: 2px solid var(--nb-chrome-accent); outline-offset: 2px; }
  .badge { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); box-shadow: 0 0 0 2px var(--nb-chrome); font: var(--nb-weight-semibold) 11px/18px var(--nb-font-sans); font-variant-numeric: tabular-nums; text-align: center; }
  .rec-dot { position: absolute; bottom: 2px; right: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--nb-chrome-danger); box-shadow: 0 0 0 2px var(--nb-chrome); animation: pulse 1.4s ease-in-out infinite; }
  .rec-dot.inline { position: static; box-shadow: none; width: 8px; height: 8px; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  .pill { pointer-events: auto; display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 6px; box-sizing: border-box; border-radius: 22px; background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), inset 0 1px 0 rgb(255 255 255 / 0.06), var(--nb-shadow-lg); animation: grow var(--nb-dur-med) var(--nb-ease-out); max-width: calc(100vw - 40px); overflow-x: auto; scrollbar-width: none; }
  @keyframes grow { from { opacity: 0; transform: scale(0.95); } }
  /* the browser blocks screenshots on this tab (D-185): one line above the pill */
  .shots-note { pointer-events: auto; position: absolute; right: 0; bottom: calc(100% + 8px); margin: 0; max-width: min(340px, calc(100vw - 40px)); box-sizing: border-box; padding: 8px 12px; border-radius: 12px; display: flex; gap: 8px; align-items: flex-start; background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), var(--nb-shadow-lg); font: var(--nb-weight-medium) 12px/1.4 var(--nb-font-sans); }
  .dock.left .shots-note { right: auto; left: 0; }
  .dock.top .shots-note { bottom: auto; top: calc(100% + 8px); }
  /* phone width (390 px): the pill wraps onto two rows, so Send and Close stay on screen (D-185) */
  @media (max-width: 520px) {
    .pill { flex-wrap: wrap; justify-content: center; height: auto; padding: 6px; row-gap: 4px; max-width: calc(100vw - 24px); overflow: visible; }
    .sep { display: none; }
  }
  .grip { all: unset; box-sizing: border-box; flex: none; display: grid; place-items: center; width: 16px; height: 32px; border-radius: 4px; color: var(--nb-on-chrome-muted); cursor: grab; touch-action: none; }
  .grip:hover { color: var(--nb-on-chrome); }
  .grip:focus-visible { outline: 2px solid var(--nb-chrome-accent); outline-offset: 1px; color: var(--nb-on-chrome); }
  .ib { all: unset; box-sizing: border-box; position: relative; flex: none; height: 32px; min-width: 32px; padding: 0 7px; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; color: var(--nb-on-chrome-muted); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out); }
  .ib:hover { background: var(--nb-chrome-2); color: var(--nb-on-chrome); }
  .ib.on { background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); }
  .ib:disabled { opacity: 0.4; cursor: default; }
  .ib:disabled:hover { background: none; color: var(--nb-on-chrome-muted); }
  .ib.rec, .on-trace { color: var(--nb-chrome-danger); }
  .time { font: var(--nb-weight-medium) 12px/1 var(--nb-font-mono); font-variant-numeric: tabular-nums; letter-spacing: 0; }
  .lbl { font-size: 12px; }
  .count { position: absolute; top: 1px; right: 0; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); box-shadow: 0 0 0 1.5px var(--nb-chrome); font: var(--nb-weight-semibold) 9px/14px var(--nb-font-sans); text-align: center; }
  .ib.on .count { box-shadow: 0 0 0 1.5px var(--nb-chrome-accent); background: var(--nb-chrome); color: var(--nb-on-chrome); }
  .warn-dot { position: absolute; top: 4px; right: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--nb-chrome-warning); box-shadow: 0 0 0 1.5px var(--nb-chrome); }
  .sep { flex: none; width: 1px; height: 20px; margin: 0 3px; background: var(--nb-chrome-border); }
  .colors { display: inline-flex; gap: 3px; padding: 0 4px; }
  .sw { all: unset; width: 14px; height: 14px; border-radius: 50%; cursor: pointer; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.2) inset; }
  .sw.sel { box-shadow: 0 0 0 2px var(--nb-chrome), 0 0 0 3.5px var(--nb-on-chrome); }
  /* keyboard focus on a swatch, which `all: unset` left without a ring (D-181) */
  .sw:focus-visible { outline: 2px solid var(--nb-chrome-accent); outline-offset: 3px; }
  .send { all: unset; box-sizing: border-box; flex: none; height: 32px; padding: 0 11px; margin-left: 2px; border-radius: 16px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5); font: var(--nb-weight-semibold) 12px/1 var(--nb-font-sans); font-variant-numeric: tabular-nums; transition: background-color var(--nb-dur-fast) var(--nb-ease-out), transform var(--nb-dur-fast) var(--nb-ease-out); }
  .send:hover { background: var(--nb-chrome-accent-hover); }
  .send:active:not(:disabled) { transform: translateY(1px); }
  .send:disabled { opacity: 0.4; cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .pill, .rec-dot { animation: none; }
    .launcher, .ib, .send { transition: none; }
  }
</style>
