<script lang="ts">
  // Anchored popover. Closes on Escape and on a pointer press outside (shadow-root safe:
  // uses composedPath, so it works inside the extension's closed shadow root).
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'top' | 'bottom';
    /** The element that toggles the popover. Receives toggle() and the open state. */
    trigger: Snippet<[{ toggle: () => void; open: boolean; id: string }]>;
    children: Snippet<[{ close: () => void }]>;
    label?: string;
    onclose?: () => void;
    /**
     * Open in the top layer (the popover API), placed against the viewport next to the trigger
     * and clamped inside it. For a trigger in a scroll container, such as the sidebar, where an
     * absolutely placed popover counts toward the container's scroll width and gets clipped by it.
     */
    layer?: boolean;
  }
  let { open = $bindable(false), placement = 'bottom-start', trigger, children, label, onclose, layer = false }: Props = $props();

  const id = `nb-pop-${Math.random().toString(36).slice(2, 9)}`;
  let root: HTMLElement | undefined = $state();
  let pop: HTMLElement | undefined = $state();
  const topLayer = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

  /** Gap between the trigger and the popover, and the popover's least distance to the viewport edge. */
  const GAP = 6;
  const EDGE = 8;

  $effect(() => {
    if (!open || !layer || !root || !pop) return;
    const anchor = root;
    const el = pop;
    const doc = anchor.ownerDocument;
    const win = doc.defaultView ?? window;
    if (topLayer) {
      try {
        el.showPopover();
      } catch {
        /* already shown, or detached */
      }
    }
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const vw = doc.documentElement.clientWidth;
      const vh = doc.documentElement.clientHeight;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const [side, align] = placement.split('-') as ['top' | 'bottom', 'start' | 'end' | undefined];
      let left = align === 'start' ? a.left : align === 'end' ? a.right - w : a.left + a.width / 2 - w / 2;
      const above = a.top - GAP - h;
      const below = a.bottom + GAP;
      // flip to the other side when the preferred one has no room and the other has more
      let top = side === 'top' ? (above < EDGE && vh - below > a.top ? below : above) : below + h > vh - EDGE && a.top > vh - below ? above : below;
      left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
      top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    win.addEventListener('resize', place);
    doc.addEventListener('scroll', place, true);
    return () => {
      ro.disconnect();
      win.removeEventListener('resize', place);
      doc.removeEventListener('scroll', place, true);
    };
  });

  function close() {
    if (!open) return;
    open = false;
    onclose?.();
  }
  function toggle() {
    if (open) close();
    else open = true;
  }

  $effect(() => {
    if (!open || !root) return;
    const doc = root.ownerDocument;
    const onDown = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    doc.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('keydown', onKey, true);
    return () => {
      doc.removeEventListener('pointerdown', onDown, true);
      doc.removeEventListener('keydown', onKey, true);
    };
  });
</script>

<span class="nb-pop-root" bind:this={root}>
  {@render trigger({ toggle, open, id })}
  {#if open}
    <div {id} class="nb-pop nb-{placement}" class:nb-layer={layer} role="dialog" aria-label={label} popover={layer && topLayer ? 'manual' : undefined} bind:this={pop}>
      {@render children({ close })}
    </div>
  {/if}
</span>

<style>
  .nb-pop-root {
    position: relative;
    display: inline-flex;
  }
  .nb-pop {
    position: absolute;
    z-index: 10;
    min-width: 180px;
    padding: 6px;
    background: var(--nb-surface);
    color: var(--nb-text);
    border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-lg);
    box-shadow: var(--nb-shadow-lg);
    font: var(--nb-text-base) / var(--nb-leading-normal) var(--nb-font-sans);
    transform-origin: top left;
    animation: nb-pop-in var(--nb-dur-med) var(--nb-ease-out);
  }
  /* the site's dropdown: surface, quiet edge, 12 px radius, 6 px inset, the floating shadow */
  .nb-bottom-start { top: calc(100% + 6px); left: 0; }
  .nb-bottom-end { top: calc(100% + 6px); right: 0; transform-origin: top right; }
  .nb-bottom { top: calc(100% + 6px); left: 50%; translate: -50% 0; transform-origin: top center; }
  .nb-top-start { bottom: calc(100% + 6px); left: 0; transform-origin: bottom left; }
  .nb-top-end { bottom: calc(100% + 6px); right: 0; transform-origin: bottom right; }
  .nb-top { bottom: calc(100% + 6px); left: 50%; translate: -50% 0; transform-origin: bottom center; }
  /* top layer: placed by script against the viewport; drops the UA popover box (inset 0, auto
     margins, Canvas colours) and never grows past the viewport */
  .nb-pop.nb-layer {
    position: fixed; inset: auto; margin: 0; translate: none; overflow: auto;
    max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); box-sizing: border-box;
  }
  @keyframes nb-pop-in {
    from { opacity: 0; transform: scale(0.97); }
  }
  @media (prefers-reduced-motion: reduce) {
    .nb-pop { animation: none; }
  }
</style>
