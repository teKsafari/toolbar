<script lang="ts">
  // In-page reviewer toolbar (Part 2, "What the reviewer can do"; owner taste M-01 to M-19).
  // Asleep it is one round launcher; awake it is a dark pill of tools: comment on an element,
  // screenshot an element, rectangle, arrow, freehand, voice note, start or stop a trace, the
  // list of this tab's notes, hide pins, send. Pins, highlights and drawings stay on the page
  // until the notes are sent. Keyboard first: single keys while awake (never while typing), Esc
  // backs out one level, Ctrl or Cmd+Shift+. wakes and hides it from anywhere.
  import { onMount } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import { REVIEW_KEYS, type FeedbackShape } from '@toolbar/shared/areas/reviewer';
  import { setGuard, swallowClicksFor } from './guard';
  import { review as r, type Tool } from './state.svelte';
  import { samePage, setOwnRoot, typingIn } from './page';
  import { docPlacement, place, setActive, startTracking, type Placed, type Placement } from './track';
  import Pill from './Pill.svelte';
  import Composer from './Composer.svelte';
  import ItemList from './ItemList.svelte';
  import { fitIn, viewport } from './viewport.svelte';

  interface Props {
    /** a Jam-style capture (screenshot mode, countdown, recording, editor) owns the page */
    blocked: boolean;
  }
  let { blocked }: Props = $props();

  let anchor: HTMLSpanElement | undefined = $state();
  onMount(() => {
    const root = anchor?.getRootNode();
    if (root instanceof ShadowRoot) setOwnRoot(root);
    void r.init();
    const unwatch = viewport.watch();
    const bump = () => r.tick++;
    // notes follow their elements: one redraw per animation frame after a scroll (document or
    // any container), a resize, a tracked element's resize or a DOM change (D-204)
    const untrack = startTracking(bump);
    const slow = setInterval(() => {
      r.now = Date.now();
      if (r.awake) bump();
    }, 500);
    const ctx = setInterval(() => {
      if (r.awake && !document.hidden) {
        void r.refreshContext();
        void r.refreshTrace();
      }
    }, 5000);
    const onSel = () => {
      if (r.awake && !r.tool && !r.draft) r.checkSelection();
    };
    document.addEventListener('selectionchange', onSel);
    return () => {
      unwatch();
      untrack();
      clearInterval(slow);
      clearInterval(ctx);
      document.removeEventListener('selectionchange', onSel);
    };
  });

  // a Jam-style capture takes the page: the reviewer toolbar steps aside until it ends
  $effect(() => {
    if (blocked && r.awake) r.sleep();
  });

  // ---- picking and drawing: page pointer events go to us, never to the app (M-11)
  function guard(e: Event): boolean {
    if (e instanceof KeyboardEvent) return false;
    const p = e as PointerEvent;
    if (typeof p.clientX !== 'number') return true;
    const drawingTool = r.tool === 'rect' || r.tool === 'arrow' || r.tool === 'freehand';
    if (e.type === 'pointermove') {
      if (r.drawing) r.moveShape(p.clientX, p.clientY, p.pressure);
      else r.hoverAt(p.clientX, p.clientY);
    } else if (e.type === 'pointerdown' && p.button === 0) {
      if (drawingTool) r.startShape(p.clientX, p.clientY);
    } else if (e.type === 'pointerup' && p.button === 0) {
      // the mouseup and click that trail this pointerup come in the same input task; a longer
      // window would also eat the next pick's pointerup
      swallowClicksFor(80);
      if (drawingTool && r.drawing) void r.endShape(p.clientX, p.clientY);
      else if (!drawingTool) void r.pick(p.clientX, p.clientY);
    }
    return true;
  }
  $effect(() => {
    if (!r.awake || blocked || !r.tool || r.draft || r.naming) return;
    setGuard(guard);
    return () => setGuard(null);
  });

  // ---- keyboard (M-09)
  const TOOL_KEYS: Record<string, Tool> = { [REVIEW_KEYS.comment]: 'comment', [REVIEW_KEYS.shot]: 'shot', [REVIEW_KEYS.rect]: 'rect', [REVIEW_KEYS.arrow]: 'arrow', [REVIEW_KEYS.freehand]: 'freehand' };
  function onKey(e: KeyboardEvent) {
    if (blocked) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.shiftKey && (e.key === '.' || e.key === '>' || e.code === 'Period')) {
      if (r.closed) void r.reopen().then(() => r.wake());
      else if (r.awake) r.sleep();
      else r.wake();
      return stop(e);
    }
    // a quiet crop is in flight and the composer is about to open: keep what the person types
    if (r.typeahead !== null && !mod && !e.altKey) {
      if (r.typeaheadEnd) return stop(e);
      if (e.key.length === 1) r.typeahead += e.key;
      else if (e.key === 'Backspace') r.typeahead = r.typeahead.slice(0, -1);
      else if (e.key === 'Enter' && e.shiftKey) r.typeahead += '\n';
      else if (e.key === 'Enter') r.typeaheadEnd = 'add';
      else if (e.key === 'Escape') r.typeaheadEnd = 'cancel';
      return stop(e);
    }
    if (!r.awake || r.closed || typingIn(e) || mod || e.altKey) return;
    if (e.key === 'Escape') {
      r.back();
      return stop(e);
    }
    if (e.shiftKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (TOOL_KEYS[k]) r.setTool(TOOL_KEYS[k]!);
    else if (k === REVIEW_KEYS.text) void r.commentOnSelection();
    else if (k === REVIEW_KEYS.voice) r.toggleVoice();
    else if (k === REVIEW_KEYS.list) r.listOpen = !r.listOpen;
    else if (k === REVIEW_KEYS.hidePins) r.pinsHidden = !r.pinsHidden;
    else if (k === REVIEW_KEYS.trace) void r.toggleTrace();
    else return;
    stop(e);
  }
  function stop(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ---- drawing on an SVG layer in document coordinates
  function freehandPath(points: FeedbackShape['points'], size: number): string {
    const outline = getStroke(
      points.map((p) => [p[0], p[1], p[2] ?? 0.5]),
      { size, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true },
    );
    if (!outline.length) return '';
    const d = outline.reduce<string[]>((acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]!;
      acc.push(`${x0!.toFixed(1)},${y0!.toFixed(1)} ${((x0! + x1!) / 2).toFixed(1)},${((y0! + y1!) / 2).toFixed(1)}`);
      return acc;
    }, []);
    return `M ${d[0]} Q ${d.slice(1).join(' ')} Z`;
  }
  function arrowHead(s: FeedbackShape): string {
    const [a, b] = [s.points[0]!, s.points[1] ?? s.points[0]!];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const len = 8 + s.width * 3;
    const p1 = [b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)];
    const p2 = [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)];
    return `${b[0]},${b[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`;
  }

  const here = $derived.by(() => {
    void r.tick;
    return r.items.filter((it) => samePage(it.page.url));
  });
  /** where each note on this page is now: its pin, and where its shapes or highlights go */
  const placed = $derived.by(() => {
    void r.tick;
    return new Map<string, Placed>(here.map((it) => [it.id, place(it)]));
  });
  const pins = $derived(
    here.flatMap((it) => {
      const p = placed.get(it.id);
      return p?.pin ? [{ it, p: p.pin, detached: p.detached }] : [];
    }),
  );
  /** the draft's drawing or highlight follows its element too, while the composer is open */
  const draftAt = $derived.by(() => {
    void r.tick;
    const d = r.draft;
    return d && !d.id && (d.shapes.length || d.marks?.length) ? (place(d).shapes ?? docPlacement()) : null;
  });
  const live = $derived.by(() => {
    void r.tick;
    return docPlacement();
  });
  const tf = (t: Placement) => `translate(${t.dx} ${t.dy}) scale(${t.sx} ${t.sy})`;
  $effect(() => {
    setActive(here.length > 0 || !!r.draft);
  });
  const showPins = $derived(r.awake && !blocked && !r.pinsHidden && !r.hiding);
  const drawingTool = $derived(r.tool === 'rect' || r.tool === 'arrow' || r.tool === 'freehand');
  let hoverPin: string | null = $state(null);
</script>

{#snippet shape(s: FeedbackShape, live = false)}
  {#if s.type === 'rect' && s.points.length > 1}
    {@const a = s.points[0]!}
    {@const b = s.points[1]!}
    <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(b[0] - a[0])} height={Math.abs(b[1] - a[1])} fill="none" stroke={s.color} stroke-width={s.width} vector-effect="non-scaling-stroke" rx="2" data-shape="rect" data-live={live || undefined} />
  {:else if s.type === 'arrow' && s.points.length > 1}
    <line x1={s.points[0]![0]} y1={s.points[0]![1]} x2={s.points[1]![0]} y2={s.points[1]![1]} stroke={s.color} stroke-width={s.width} stroke-linecap="round" vector-effect="non-scaling-stroke" data-shape="arrow" data-live={live || undefined} />
    <polygon points={arrowHead(s)} fill={s.color} />
  {:else if s.type === 'freehand'}
    <path d={freehandPath(s.points, s.width)} fill={s.color} data-shape="freehand" data-live={live || undefined} />
  {/if}
{/snippet}

<span bind:this={anchor} hidden></span>
<!-- D-205: closed on this origin (the pill's X): nothing of the toolbar shows until the extension icon is clicked -->
{#if !blocked && !r.closed}
  <!-- drawings and text highlights, each drawn at its offset from its element (track.ts, D-204) -->
  {#if (showPins && here.length) || r.drawing || r.draft?.shapes.length || r.draft?.marks?.length}
    <svg class="layer" data-testid="review-layer" aria-hidden="true">
      {#if showPins}
        {#each here as it (it.id)}
          {@const t = placed.get(it.id)?.shapes}
          {#if t}
            <g transform={tf(t)} data-detached={t.detached || undefined}>
              {#each it.marks ?? [] as m, i (i)}<rect class="mark" x={m.x} y={m.y} width={m.w} height={m.h} data-testid="review-mark" />{/each}
              {#each it.shapes as s, i (i)}{@render shape(s)}{/each}
            </g>
          {/if}
        {/each}
      {/if}
      {#if r.draft && !r.draft.id && draftAt}
        <g transform={tf(draftAt)}>
          {#each r.draft.marks ?? [] as m, i (i)}<rect class="mark" x={m.x} y={m.y} width={m.w} height={m.h} />{/each}
          {#each r.draft.shapes as s, i (i)}{@render shape(s, true)}{/each}
        </g>
      {/if}
      {#if r.drawing}<g transform={tf(live)}>{@render shape(r.drawing, true)}</g>{/if}
    </svg>
  {/if}

  {#if r.awake && !r.hiding}
    <!-- hover highlight and the name the agent will get (M-10) -->
    {#if r.hover && !r.draft}
      <div class="hover" style:left="{r.hover.rect.x}px" style:top="{r.hover.rect.y}px" style:width="{r.hover.rect.w}px" style:height="{r.hover.rect.h}px" data-testid="review-hover"></div>
      <div class="hover-label" style:left="{Math.max(4, Math.min(innerWidth - 260, r.hover.rect.x))}px" style:top="{r.hover.rect.y > 28 ? r.hover.rect.y - 24 : r.hover.rect.y + r.hover.rect.h + 4}px" data-testid="review-hover-label">
        {r.tool === 'shot' ? 'Screenshot ' : ''}{r.hover.label}
      </div>
    {/if}
    {#if drawingTool && r.pointer && !r.drawing && !r.draft}
      <div class="cross" style:left="{r.pointer.x}px" style:top="{r.pointer.y}px" style:--c={r.color} aria-hidden="true"></div>
    {/if}

    {#if showPins}
      {#each pins as { it, p, detached } (it.id)}
        <button
          type="button"
          class="pin"
          class:area={it.kind === 'draw' || it.kind === 'shot'}
          class:editing={r.draft?.id === it.id}
          class:detached
          style:left="{p.x}px"
          style:top="{p.y}px"
          data-nb-interactive
          data-testid="review-pin"
          data-n={it.n}
          data-detached={detached || undefined}
          aria-label="Note {it.n}: {it.comment || it.quote || it.kind}{detached ? ' (detached: its element is no longer on the page)' : ''}"
          onmouseenter={() => (hoverPin = it.id)}
          onmouseleave={() => (hoverPin = null)}
          onclick={() => r.edit(it, { x: p.x + 14, y: p.y })}>{it.n}</button>
        {#if hoverPin === it.id && r.draft?.id !== it.id}
          <div class="preview" use:fitIn style:left="{p.x + 16}px" style:top="{p.y + 12}px" data-testid="review-pin-preview">
            {#if it.quote}<q>{it.quote.slice(0, 80)}</q>{/if}
            <span>{it.comment || (it.voiceBlobId ? 'Voice note' : 'No comment')}</span>
            {#if detached}<span class="detached-note">Detached: its element is no longer on the page</span>{/if}
          </div>
        {/if}
      {/each}
    {/if}

    {#if r.chip && !r.draft}
      <button type="button" class="chip" style:left="{r.chip.x}px" style:top="{r.chip.y}px" data-nb-interactive data-testid="review-text-chip" onmousedown={(e) => e.preventDefault()} onclick={() => void r.commentOnSelection()}>
        Comment <kbd>T</kbd>
      </button>
    {/if}

    {#if r.draft}
      <Composer />
    {/if}
    {#if r.listOpen}
      <ItemList />
    {/if}
  {/if}

  {#if !r.hiding}
    <Pill />
  {/if}
{/if}

<svelte:window onkeydowncapture={onKey} />

<style>
  .layer { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
  .mark { fill: rgb(255 214 10 / 0.38); }
  /* the picked element: the accent between two hairlines of its opposite, so it reads on any page
     whatever the theme and the accent (black on a dark page, white on a light one) (D-176) */
  .hover { position: fixed; pointer-events: none; box-shadow: 0 0 0 1px var(--nb-on-accent), 0 0 0 3px var(--nb-accent), 0 0 0 4px var(--nb-on-accent); background: color-mix(in srgb, var(--nb-accent) 6%, transparent); border-radius: 3px; transition: all 60ms linear; }
  .hover-label { position: fixed; pointer-events: none; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 2px 8px; border-radius: var(--nb-radius-sm); background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), var(--nb-shadow-md); font: var(--nb-weight-medium) 12px/18px var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui); }
  .cross { position: fixed; pointer-events: none; width: 16px; height: 16px; margin: -8px 0 0 -8px; }
  .cross::before, .cross::after { content: ''; position: absolute; background: var(--c); }
  .cross::before { left: 7px; top: 0; width: 2px; height: 16px; }
  .cross::after { top: 7px; left: 0; height: 2px; width: 16px; }
  .pin { all: unset; box-sizing: border-box; position: fixed; pointer-events: auto; cursor: pointer; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50% 50% 50% 2px; display: grid; place-items: center; background: var(--nb-accent); color: var(--nb-on-accent); font: var(--nb-weight-semibold) 11px/1 var(--nb-font-sans); font-variant-numeric: tabular-nums; box-shadow: 0 0 0 2px var(--nb-on-accent), var(--nb-shadow-md); transition: transform var(--nb-dur-fast) var(--nb-ease-out); }
  .pin.area { background: var(--nb-success); color: var(--nb-surface); box-shadow: 0 0 0 2px var(--nb-surface), var(--nb-shadow-md); }
  .pin:hover, .pin.editing { transform: scale(1.15); }
  /* the element of the note is gone: the pin stays where it was, hollow and dashed */
  .pin.detached { background: var(--nb-surface); color: var(--nb-text); box-shadow: 0 0 0 2px var(--nb-text-muted), var(--nb-shadow-md); outline: 1px dashed var(--nb-text-muted); outline-offset: 3px; }
  g[data-detached] { opacity: 0.55; }
  .detached-note { color: var(--nb-text-muted); }
  .pin:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .preview { position: fixed; pointer-events: none; max-width: 240px; display: flex; flex-direction: column; gap: 2px; padding: 6px 9px; border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border); font: 12px/1.4 var(--nb-font-sans); box-shadow: var(--nb-shadow-lg); }
  .preview q { color: var(--nb-text-muted); font-style: italic; }
  .chip { all: unset; position: fixed; pointer-events: auto; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--nb-chrome); color: var(--nb-on-chrome); font: var(--nb-weight-medium) 12px/1 var(--nb-font-sans); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), var(--nb-shadow-md); transition: background-color var(--nb-dur-fast) var(--nb-ease-out); }
  .chip:hover { background: var(--nb-chrome-2); }
  .chip:focus-visible { outline: 2px solid var(--nb-chrome-accent); outline-offset: 2px; }
  kbd { font: 10px/1 var(--nb-font-mono); color: var(--nb-on-chrome-muted); border: 1px solid var(--nb-chrome-border); border-radius: 4px; padding: 2px 4px; }
</style>
