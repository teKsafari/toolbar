<script lang="ts">
  // Screenshot mode (J-025, J-003, J-005, J-026, J-250). No dimming and no toolbar: a grey pill
  // trails the pointer; a click takes the visible area, a drag takes a box. The press that takes
  // the shot never reaches the page. With a delay, a round badge counts down bottom-left with a
  // cancel pill bottom-right, and the shot fires at zero.
  import { onMount } from 'svelte';
  import { CURSOR_PILL_OFFSET, DRAG_THRESHOLD_PX, rectFromPoints } from '@toolbar/shared/areas/ext-ui';
  import type { Rect } from '@toolbar/shared/events';
  import { setGuard, swallowClicksFor } from './guard';
  import { send, errorText } from './send';
  import { toasts } from '@toolbar/ui';

  interface Props {
    delaySec: number;
  }
  let { delaySec }: Props = $props();

  type Phase = 'armed' | 'delay' | 'shooting';
  let phase: Phase = $state('armed');
  let pointer: { x: number; y: number } | null = $state(null);
  let start: { x: number; y: number } | null = null;
  let dragging = $state(false);
  let rect: Rect | null = $state(null);
  let left = $state(0);
  let timer: ReturnType<typeof setInterval> | null = null;

  const viewport = () => ({ w: document.documentElement.clientWidth || innerWidth, h: document.documentElement.clientHeight || innerHeight });

  function handle(e: Event): boolean {
    if (phase !== 'armed') return false;
    if (e instanceof KeyboardEvent) {
      if (e.type === 'keydown' && e.key === 'Escape') {
        void send('screenshot.cancel');
        return true;
      }
      return false;
    }
    const p = e as PointerEvent;
    if (typeof p.clientX === 'number' && (e.type === 'pointermove' || e.type === 'pointerdown' || e.type === 'pointerup')) {
      const at = { x: p.clientX, y: p.clientY };
      if (e.type === 'pointermove') {
        pointer = at;
        if (start && !dragging && Math.hypot(at.x - start.x, at.y - start.y) > DRAG_THRESHOLD_PX) dragging = true;
        if (start && dragging) rect = rectFromPoints(start, at, viewport());
      } else if (e.type === 'pointerdown' && p.button === 0) {
        start = at;
        pointer = at;
      } else if (e.type === 'pointerup' && start) {
        const r = dragging ? rectFromPoints(start, at, viewport()) : null;
        start = null;
        finish(r && r.w >= 2 && r.h >= 2 ? r : null);
      }
    }
    return true; // every pointer, mouse and touch event stays away from the page
  }

  function finish(r: Rect | null) {
    swallowClicksFor(600);
    rect = r;
    dragging = false;
    if (delaySec > 0) {
      phase = 'delay';
      left = delaySec;
      timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          if (timer) clearInterval(timer);
          void shoot(r);
        }
      }, 1000);
    } else void shoot(r);
  }

  async function shoot(r: Rect | null) {
    phase = 'shooting'; // hides every element of ours before the capture
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const res = await send('screenshot.take', { rect: r, dpr: devicePixelRatio });
    if (!res.ok && res.error !== 'not_implemented') toasts.error(errorText(res));
  }

  function cancel() {
    if (timer) clearInterval(timer);
    void send('screenshot.cancel');
  }

  onMount(() => {
    setGuard(handle);
    return () => {
      setGuard(null);
      if (timer) clearInterval(timer);
    };
  });
</script>

{#if phase === 'armed'}
  <div class="nb-shot-veil" data-nb-shot-overlay></div>
  {#if rect && dragging}
    <div class="nb-shot-rect" data-nb-shot-rect style:left="{rect.x}px" style:top="{rect.y}px" style:width="{rect.w}px" style:height="{rect.h}px"></div>
  {/if}
  {#if pointer}
    {#if dragging && rect}
      <div class="nb-shot-size" data-nb-shot-size style:left="{pointer.x + 12}px" style:top="{pointer.y + 12}px">{rect.w} × {rect.h}</div>
    {:else}
      <div class="nb-shot-pill" data-nb-cursor-pill style:left="{pointer.x + CURSOR_PILL_OFFSET.x}px" style:top="{pointer.y + CURSOR_PILL_OFFSET.y}px">
        {delaySec > 0 ? `Click or drag. Shot after ${delaySec} s` : 'Click or drag to capture'}
      </div>
    {/if}
  {/if}
{:else if phase === 'delay'}
  <div class="nb-delay" data-nb-delay-badge aria-live="polite">{left}</div>
  <button class="nb-delay-cancel" data-nb-interactive data-nb-delay-cancel type="button" onclick={cancel}>Cancel</button>
{/if}

<style>
  .nb-shot-veil {
    position: fixed;
    inset: 0;
    cursor: crosshair;
    pointer-events: auto;
    background: transparent;
  }
  .nb-shot-rect {
    position: fixed;
    background: var(--nb-capture-tint);
    pointer-events: none;
  }
  .nb-shot-pill,
  .nb-shot-size {
    position: fixed;
    pointer-events: none;
    white-space: nowrap;
    padding: 0 16px;
    height: 36px;
    display: flex;
    align-items: center;
    border-radius: var(--nb-radius-pill);
    background: rgb(26 25 24 / 0.62);
    color: #fff;
    font: var(--nb-weight-medium) var(--nb-text-base) / 1 var(--nb-font-sans);
    backdrop-filter: blur(4px);
  }
  .nb-shot-size {
    height: 24px;
    padding: 0 8px;
    font: var(--nb-text-sm) / 1 var(--nb-font-mono);
  }
  .nb-delay {
    position: fixed;
    left: 24px;
    bottom: 24px;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--nb-accent-tint);
    border: 2px solid var(--nb-accent);
    color: var(--nb-accent-text);
    font: var(--nb-weight-semibold) 24px / 1 var(--nb-font-sans);
    pointer-events: none;
    backdrop-filter: blur(6px);
    box-shadow: var(--nb-shadow-md);
  }
  .nb-delay-cancel {
    all: unset;
    position: fixed;
    right: 24px;
    bottom: 32px;
    height: 34px;
    padding: 0 16px;
    border-radius: var(--nb-radius-pill);
    background: rgb(26 25 24 / 0.7);
    color: #fff;
    cursor: pointer;
    pointer-events: auto;
    font: var(--nb-weight-medium) var(--nb-text-md) / 34px var(--nb-font-sans);
  }
  .nb-delay-cancel:focus-visible {
    outline: 2px solid var(--nb-focus);
  }
</style>
