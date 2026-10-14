<script lang="ts">
  // Live pen during a recording (J-030): strokes drawn on an SVG layer over the page, smoothed
  // with perfect-freehand, each fading out a few seconds after the pointer lifts, like a laser
  // pointer. Strokes are part of the tab video; a pen marker goes on the timeline.
  import { onMount } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import { LIVE_STROKE_FADE_MS } from '@toolbar/shared/areas/ext-ui';
  import { setGuard } from './guard';
  import { send } from './send';

  interface Props {
    active: boolean;
    color: string;
    onescape: () => void;
  }
  let { active, color, onescape }: Props = $props();

  interface Stroke {
    id: number;
    color: string;
    points: [number, number, number][];
    fading: boolean;
  }
  let strokes: Stroke[] = $state([]);
  let drawing: Stroke | null = null;
  let nextId = 1;
  let lastMark = 0;

  function pathOf(points: [number, number, number][]): string {
    const outline = getStroke(points, { size: 8, thinning: 0.5, smoothing: 0.5, streamline: 0.5, simulatePressure: true });
    if (!outline.length) return '';
    const d = outline.reduce<string[]>((acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]!;
      acc.push(`${x0.toFixed(1)},${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)},${((y0 + y1) / 2).toFixed(1)}`);
      return acc;
    }, []);
    return `M ${d[0]} Q ${d.slice(1).join(' ')} Z`;
  }

  function fade(s: Stroke) {
    setTimeout(() => {
      const live = strokes.find((x) => x.id === s.id);
      if (live) live.fading = true;
      setTimeout(() => (strokes = strokes.filter((x) => x.id !== s.id)), 600);
    }, LIVE_STROKE_FADE_MS);
  }

  function handle(e: Event): boolean {
    if (e instanceof KeyboardEvent) {
      if (e.type === 'keydown' && e.key === 'Escape') {
        onescape();
        return true;
      }
      return false;
    }
    const p = e as PointerEvent;
    if (e.type === 'pointerdown' && p.button === 0) {
      drawing = { id: nextId++, color, points: [[p.clientX, p.clientY, p.pressure || 0.5]], fading: false };
      strokes.push(drawing);
      drawing = strokes[strokes.length - 1]!;
    } else if (e.type === 'pointermove' && drawing) {
      drawing.points.push([p.clientX, p.clientY, p.pressure || 0.5]);
    } else if ((e.type === 'pointerup' || e.type === 'pointercancel') && drawing) {
      fade(drawing);
      drawing = null;
      if (Date.now() - lastMark > 2000) {
        lastMark = Date.now();
        void send('recording.mark', { kind: 'pen' });
      }
    }
    return true;
  }

  $effect(() => {
    if (!active) return;
    setGuard(handle);
    return () => {
      setGuard(null);
      if (drawing) fade(drawing);
      drawing = null;
    };
  });

  export function clear() {
    strokes = [];
  }

  onMount(() => () => (strokes = []));
</script>

{#if active || strokes.length}
  <svg class="nb-draw" class:active data-nb-draw-layer width="100%" height="100%">
    {#each strokes as s (s.id)}
      <path d={pathOf(s.points)} fill={s.color} class:fading={s.fading} data-nb-stroke></path>
    {/each}
  </svg>
{/if}

<style>
  .nb-draw {
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    overflow: visible;
  }
  .nb-draw.active {
    pointer-events: auto;
    cursor: crosshair;
  }
  path {
    transition: opacity 0.6s ease-out;
  }
  path.fading {
    opacity: 0;
  }
</style>
