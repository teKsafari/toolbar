<script lang="ts">
  // The screenshot with its SVG annotation layer. Pointer input goes to AnnotatorState in image
  // coordinates; shapes render from the same primitives the flattened PNG uses.
  import { tick } from 'svelte';
  import { draw, textBaseline, TEXT_FONT, TEXT_COLOR, type Drawn } from './render.ts';
  import { bounds, centerOf, handlePoint, HANDLES, lineMid, textPad, type Pt, type Shape } from './shapes.ts';
  import type { AnnotatorState, HitTarget } from './annotator.svelte.ts';

  interface Props {
    state: AnnotatorState;
    src: string;
  }
  let { state: st, src }: Props = $props();

  const uid = Math.random().toString(36).slice(2, 8);
  let frame: HTMLDivElement | undefined = $state();
  let svg: SVGSVGElement | undefined = $state();
  let editor: HTMLDivElement | undefined = $state();
  let fw = $state(0);
  let fh = $state(0);
  let hover: HitTarget = $state(null);

  // fit the image into the frame without upscaling past 1:1 on small shots
  const scale = $derived(fw && fh ? Math.min(fw / st.width, fh / st.height, 2) : 1);
  const dw = $derived(Math.round(st.width * scale));
  const dh = $derived(Math.round(st.height * scale));
  $effect(() => {
    st.unitPerPx = 1 / (scale || 1);
  });

  $effect(() => {
    if (!frame) return;
    const ro = new ResizeObserver(([e]) => {
      fw = e!.contentRect.width;
      fh = e!.contentRect.height;
    });
    ro.observe(frame);
    return () => ro.disconnect();
  });

  const drawn = $derived(st.shapes.filter((s) => s.id !== st.editing).map((s) => draw(s, st.measure)));
  const liveDraft = $derived(st.draft ? draw(st.draft, st.measure, true) : null);
  const selected = $derived(st.selectedShapes());
  const editingShape = $derived(st.editing ? (st.shapes.find((s) => s.id === st.editing) ?? null) : null);

  function toImage(e: PointerEvent | MouseEvent): Pt {
    const r = svg!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * st.width, y: ((e.clientY - r.top) / r.height) * st.height };
  }

  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    // keep keyboard shortcuts working after a click on the image
    (document.activeElement as HTMLElement | null)?.blur?.();
    svg!.setPointerCapture(e.pointerId);
    st.pointerDown(toImage(e), { shift: e.shiftKey, alt: e.altKey });
    if (st.editing) void focusEditor();
  }
  function onMove(e: PointerEvent) {
    const p = toImage(e);
    if (st.dragging) st.pointerMove(p, { shift: e.shiftKey });
    else if (st.tool === 'select') hover = st.hit(p);
  }
  function onUp(e: PointerEvent) {
    if (!st.dragging) return;
    st.pointerUp(toImage(e));
  }
  function onCancel() {
    st.cancelDrag();
  }
  function onDbl(e: MouseEvent) {
    const t = st.hit(toImage(e));
    if (t?.kind !== 'shape') return;
    const s = st.shapes.find((x) => x.id === t.id);
    if (s?.type === 'text') {
      st.editText(s.id);
      void focusEditor();
    }
  }

  async function focusEditor() {
    await tick();
    if (!editor || !editingShape || editingShape.type !== 'text') return;
    editor.textContent = editingShape.text;
    editor.focus();
    const sel = editor.ownerDocument.getSelection();
    const range = editor.ownerDocument.createRange();
    range.selectNodeContents(editor);
    if (!st.editSelectAll) range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function onEditInput() {
    if (st.editing && editor) st.setText(st.editing, editor.innerText.replace(/\n$/, ''));
  }
  function onEditKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      st.commitText();
    }
  }

  const cursor = $derived.by(() => {
    if (st.tool === 'text') return 'text';
    if (st.tool !== 'select') return 'crosshair';
    const h = hover;
    if (!h) return 'default';
    if (h.kind === 'rotate') return 'grab';
    if (h.kind === 'handle') return h.handle === 'n' || h.handle === 's' ? 'ns-resize' : h.handle === 'e' || h.handle === 'w' ? 'ew-resize' : h.handle === 'nw' || h.handle === 'se' ? 'nwse-resize' : 'nesw-resize';
    if (h.kind === 'end' || h.kind === 'bend') return 'pointer';
    return 'move';
  });

  const deg = (r: number) => (r * 180) / Math.PI;
  const tf = (d: Drawn) => (d.rot ? `rotate(${deg(d.rot)} ${d.cx} ${d.cy})` : undefined);
  const px = $derived(1 / (scale || 1));

  function outline(s: Shape) {
    const b = bounds(s, st.measure);
    const c = centerOf(b);
    return { b, c, t: s.rot ? `rotate(${deg(s.rot)} ${c.x} ${c.y})` : undefined };
  }

  const editStyle = $derived.by(() => {
    const s = editingShape;
    if (!s || s.type !== 'text') return '';
    const pad = textPad(s.size);
    const b = bounds(s, st.measure);
    const c = centerOf(b);
    return [
      `left:${s.x * scale}px`,
      `top:${s.y * scale}px`,
      `font:700 ${s.size * scale}px/${1.25} ${TEXT_FONT}`,
      `padding:${pad.y * scale}px ${pad.x * scale}px`,
      `min-width:${s.size * scale}px`,
      `background:${s.color}`,
      `color:${TEXT_COLOR}`,
      `border-radius:${s.size * 0.4 * scale}px`,
      `transform-origin:${(c.x - s.x) * scale}px ${(c.y - s.y) * scale}px`,
      s.rot ? `transform:rotate(${deg(s.rot)}deg)` : '',
    ].join(';');
  });
</script>

<div class="nb-ann-frame" bind:this={frame}>
  <div class="nb-ann-stage" style="width:{dw}px;height:{dh}px" data-testid="annotator">
    <img {src} alt="Screenshot" draggable="false" width={dw} height={dh} />
    <svg
      bind:this={svg}
      viewBox="0 0 {st.width} {st.height}"
      width={dw}
      height={dh}
      style="cursor:{cursor}"
      role="application"
      aria-label="Annotation layer"
      data-tool={st.tool}
      onpointerdown={onDown}
      onpointermove={onMove}
      onpointerup={onUp}
      onpointercancel={onCancel}
      ondblclick={onDbl}
    >
      <defs>
        <filter id="nb-shadow-{uid}" x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx="0" dy={3 * px} stdDeviation={5 * px} flood-color="#000" flood-opacity="0.28" />
        </filter>
      </defs>
      {#snippet shape(d: Drawn, live: boolean)}
        <g transform={tf(d)} data-shape={d.id}>
          {#each d.prims as p, i (i)}
            {#if p.t === 'path'}
              <path
                d={p.d}
                fill={p.fill ?? 'none'}
                stroke={p.stroke ?? 'none'}
                stroke-width={p.sw ?? 0}
                stroke-linecap="round"
                stroke-linejoin="round"
                filter={p.shadow ? `url(#nb-shadow-${uid})` : undefined}
              />
            {:else if p.t === 'text'}
              <text fill={p.fill} font-family={TEXT_FONT} font-weight="700" font-size={p.size} style="white-space:pre">
                {#each p.lines as line, li (li)}
                  <tspan x={p.x} y={textBaseline(p, li)}>{line}</tspan>
                {/each}
              </text>
            {:else}
              <clipPath id="nb-clip-{uid}-{d.id}">
                <rect x={p.x} y={p.y} width={p.w} height={p.h} />
              </clipPath>
              <filter id="nb-blur-{uid}-{d.id}" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
                <feGaussianBlur stdDeviation={p.r} edgeMode="duplicate" />
              </filter>
              <g clip-path="url(#nb-clip-{uid}-{d.id})" data-blur>
                <image href={src} x="0" y="0" width={st.width} height={st.height} filter="url(#nb-blur-{uid}-{d.id})" preserveAspectRatio="none" />
              </g>
              {#if live}
                <rect x={p.x} y={p.y} width={p.w} height={p.h} fill="none" class="nb-ann-dash" vector-effect="non-scaling-stroke" />
              {/if}
            {/if}
          {/each}
        </g>
      {/snippet}

      {#each drawn as d (d.id)}
        {@render shape(d, false)}
      {/each}
      {#if liveDraft}
        {@render shape(liveDraft, true)}
      {/if}

      <!-- selection -->
      {#if selected.length === 1 && !st.editing}
        {@const s = selected[0]!}
        {#if s.type === 'line' || s.type === 'arrow'}
          <g class="nb-ann-sel" data-selection={s.id}>
            <circle cx={s.x1} cy={s.y1} r={5 * px} class="nb-ann-handle" vector-effect="non-scaling-stroke" data-handle="end1" />
            <circle cx={s.x2} cy={s.y2} r={5 * px} class="nb-ann-handle" vector-effect="non-scaling-stroke" data-handle="end2" />
            {#if s.type === 'arrow'}
              {@const m = lineMid(s)}
              <circle cx={m.x} cy={m.y} r={5 * px} class="nb-ann-handle nb-ann-mid" vector-effect="non-scaling-stroke" data-handle="bend" />
            {/if}
          </g>
        {:else}
          {@const o = outline(s)}
          <g class="nb-ann-sel" transform={o.t} data-selection={s.id}>
            <rect x={o.b.x} y={o.b.y} width={o.b.w} height={o.b.h} fill="none" class="nb-ann-box" vector-effect="non-scaling-stroke" />
            {#each HANDLES as h (h)}
              {@const hp = handlePoint(o.b, h)}
              <rect x={hp.x - 4 * px} y={hp.y - 4 * px} width={8 * px} height={8 * px} class="nb-ann-handle" vector-effect="non-scaling-stroke" data-handle={h} />
            {/each}
          </g>
        {/if}
      {:else if selected.length > 1}
        {#each selected as s (s.id)}
          {@const o = outline(s)}
          <rect x={o.b.x} y={o.b.y} width={o.b.w} height={o.b.h} transform={o.t} fill="none" class="nb-ann-box nb-ann-multi" vector-effect="non-scaling-stroke" data-selection={s.id} />
        {/each}
        {@const g = st.selectionBounds()}
        {#if g}
          <rect x={g.x} y={g.y} width={g.w} height={g.h} fill="none" class="nb-ann-box" vector-effect="non-scaling-stroke" />
        {/if}
      {/if}
      {#if st.marquee}
        <rect x={st.marquee.x} y={st.marquee.y} width={st.marquee.w} height={st.marquee.h} class="nb-ann-marquee" vector-effect="non-scaling-stroke" data-marquee />
      {/if}
    </svg>
    {#if editingShape}
      <div
        bind:this={editor}
        class="nb-ann-text"
        style={editStyle}
        contenteditable="plaintext-only"
        role="textbox"
        tabindex="0"
        aria-label="Callout text"
        aria-multiline="true"
        spellcheck="false"
        data-testid="text-editor"
        oninput={onEditInput}
        onkeydown={onEditKey}
        onblur={() => st.commitText()}
      ></div>
    {/if}
  </div>
</div>

<style>
  .nb-ann-frame {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .nb-ann-stage {
    position: relative;
    flex: none;
    box-shadow: var(--nb-shadow-sm);
    border-radius: var(--nb-radius-sm);
    overflow: hidden;
    background: var(--nb-surface-sunken);
  }
  .nb-ann-stage img {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
    pointer-events: none;
  }
  svg {
    position: absolute;
    inset: 0;
    display: block;
    touch-action: none;
    user-select: none;
    overflow: visible;
  }
  .nb-ann-box {
    stroke: var(--nb-accent);
    stroke-width: 1.5;
  }
  .nb-ann-multi {
    stroke-dasharray: 4 3;
  }
  .nb-ann-handle {
    fill: #fff;
    stroke: var(--nb-accent);
    stroke-width: 1.5;
  }
  .nb-ann-mid {
    fill: var(--nb-accent);
  }
  .nb-ann-marquee {
    fill: rgb(125 120 110 / 0.12);
    stroke: rgb(125 120 110 / 0.7);
    stroke-width: 1;
  }
  .nb-ann-dash {
    stroke: var(--nb-accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  .nb-ann-text {
    position: absolute;
    box-sizing: border-box;
    white-space: pre;
    outline: none;
    box-shadow: 0 3px 10px rgb(0 0 0 / 0.28);
    caret-color: #fff;
    cursor: text;
  }
</style>
