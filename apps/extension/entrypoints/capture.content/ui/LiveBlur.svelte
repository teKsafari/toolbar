<script lang="ts">
  // Blur tool on the recording bar (J-031, J-036): hovering outlines a page element, a click
  // blurs it in the live page (and so in the video), a second click unblurs it. Escape or done
  // on the bar leaves the tool.
  import { onMount } from 'svelte';
  import { setGuard } from '@toolbar/review/guard';
  import { blurTarget, isBlurred, toggle } from './blur';
  import { send } from './send';

  interface Props {
    host: Element | null;
    onchange: () => void;
    ondone: () => void;
  }
  let { host, onchange, ondone }: Props = $props();

  let hover: { x: number; y: number; w: number; h: number; blurred: boolean } | null = $state(null);
  let current: HTMLElement | null = null;

  function outline(el: HTMLElement | null) {
    current = el;
    if (!el) return (hover = null);
    const r = el.getBoundingClientRect();
    hover = { x: r.left, y: r.top, w: r.width, h: r.height, blurred: isBlurred(el) };
  }

  function handle(e: Event): boolean {
    if (e instanceof KeyboardEvent) {
      if (e.type === 'keydown' && e.key === 'Escape') {
        ondone();
        return true;
      }
      return false;
    }
    if (e.type === 'pointermove' || e.type === 'mouseover') {
      outline(blurTarget(e.target, host));
      return true;
    }
    if (e.type === 'click') {
      const el = blurTarget(e.target, host);
      if (el) {
        toggle(el);
        outline(el);
        onchange();
        void send('recording.mark', { kind: 'blur' });
      }
      return true;
    }
    // presses, releases and context menus stay away from the page while blurring
    return e.type !== 'pointerout' && e.type !== 'mouseout' && e.type !== 'pointerleave' && e.type !== 'mouseleave';
  }

  onMount(() => {
    setGuard(handle);
    const onScroll = () => outline(current);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      setGuard(null);
      window.removeEventListener('scroll', onScroll, true);
    };
  });
</script>

{#if hover}
  <div class="nb-blur-hover" data-nb-blur-hover style:left="{hover.x - 2}px" style:top="{hover.y - 2}px" style:width="{hover.w + 4}px" style:height="{hover.h + 4}px">
    <span class="nb-blur-tip" class:below={hover.y < 32}>{hover.blurred ? 'Click to unblur' : 'Click to blur'}</span>
  </div>
{/if}

<style>
  .nb-blur-hover {
    position: fixed;
    pointer-events: none;
    border: 2px solid var(--nb-accent);
    border-radius: 4px;
    box-sizing: border-box;
    background: var(--nb-accent-tint);
    /* hairlines of the opposite colour keep the outline readable on any page (D-176) */
    box-shadow:
      0 0 0 1px var(--nb-on-accent),
      inset 0 0 0 1px var(--nb-on-accent);
  }
  .nb-blur-tip {
    position: absolute;
    left: 0;
    bottom: calc(100% + 6px);
    padding: 4px 8px;
    border-radius: var(--nb-radius-sm);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    box-shadow:
      inset 0 0 0 1px var(--nb-chrome-border),
      var(--nb-shadow-md);
    font: var(--nb-weight-medium) var(--nb-text-sm) / 1.2 var(--nb-font-sans);
    white-space: nowrap;
  }
  .nb-blur-tip.below {
    bottom: auto;
    top: calc(100% + 6px);
  }
</style>
