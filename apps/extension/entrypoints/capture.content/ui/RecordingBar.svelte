<script lang="ts" module>
  // Dragged positions survive a re-render of the bar for the same recording (J-238).
  const positions = new Map<string, { x: number; y: number }>();
</script>

<script lang="ts">
  // Recording control bar (J-028, J-029, J-238, J-030, J-031, J-013, J-200, J-034, J-027).
  // A dark pill at bottom centre, about 295x40 and 70 px above the viewport's bottom edge:
  // stop, pause, timer (drag handle), mic, divider, pen, blur. Tools swap its contents in place.
  // It sits in the page, so it is part of the tab video.
  import { Icon } from '@toolbar/ui';
  import { elapsedMs, type CaptureSession, type MicState } from '@toolbar/shared/ext';
  import { LIVE_PEN_COLORS, capStage, clampToViewport, formatTimer } from '@toolbar/shared/areas/ext-ui';
  import { send, errorText } from './send';
  import { toasts } from '@toolbar/ui';
  import * as blur from './blur';

  interface Props {
    session: Extract<CaptureSession, { state: 'countdown' | 'starting' | 'recording' | 'stopping' }>;
    countdownLeftMs: number;
    countdownAt: number;
    capMs: number | null;
    tool: 'pen' | 'blur' | null;
    micSetting: boolean;
    penColor: string;
    blurCount: number;
    ontool: (tool: 'pen' | 'blur' | null) => void;
    onpencolor: (c: string) => void;
    onblurundo: () => void;
  }
  let { session, countdownLeftMs, countdownAt, capMs, tool, micSetting, penColor, blurCount, ontool, onpencolor, onblurundo }: Props = $props();

  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 200);
    return () => clearInterval(t);
  });

  const recId = $derived(session.recordingId);
  let pos: { x: number; y: number } | null = $state(null);
  $effect(() => {
    pos = positions.get(recId) ?? null;
  });
  let bar: HTMLDivElement | undefined = $state();

  const countdownN = $derived(
    session.state === 'countdown' ? Math.max(1, Math.ceil((session.paused ? countdownLeftMs : countdownLeftMs - (now - countdownAt)) / 1000)) : 0,
  );
  const elapsed = $derived(session.state === 'recording' ? elapsedMs(session, now) : 0);
  const stage = $derived(capStage(elapsed, capMs));
  const paused = $derived(session.state === 'recording' && session.pausedAt !== null);
  // the worker stops at the cap; if it slept through its timer, the bar asks once (J-013)
  let capAsked = '';
  $effect(() => {
    if (session.state !== 'recording' || !capMs || paused || elapsed < capMs + 1000 || capAsked === recId) return;
    capAsked = recId;
    void send('recording.stop', {});
  });
  const mic: MicState = $derived(session.state === 'recording' ? session.mic : micSetting ? 'on' : 'off');

  // ---- drag by the timer (J-238)
  let drag: { dx: number; dy: number; id: number } | null = null;
  function dragStart(e: PointerEvent) {
    if (e.button !== 0 || !bar) return;
    const r = bar.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function dragMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id || !bar) return;
    const r = bar.getBoundingClientRect();
    pos = clampToViewport({ x: e.clientX - drag.dx, y: e.clientY - drag.dy }, { w: r.width, h: r.height }, { w: innerWidth, h: innerHeight });
    positions.set(recId, pos);
  }
  function dragEnd(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) drag = null;
  }

  async function call<K extends 'recording.stop' | 'recording.pause' | 'recording.resume' | 'countdown.cancel' | 'countdown.pause' | 'countdown.resume'>(type: K) {
    const r = await send(type, {});
    if (!r.ok) toasts.error(errorText(r));
  }

  async function toggleMic() {
    if (mic === 'denied') return;
    const r = await send('recording.mic', { muted: mic === 'on' });
    if (!r.ok) toasts.error(errorText(r));
  }

  const micTip = $derived(
    mic === 'denied'
      ? 'Microphone permission is missing'
      : mic === 'on'
        ? 'Mute microphone'
        : mic === 'muted'
          ? 'Unmute microphone'
          : 'Microphone off',
  );
</script>

<div
  class="nb-bar"
  class:placed={pos !== null}
  data-nb-bar
  data-nb-interactive
  data-state={session.state}
  data-stage={stage}
  bind:this={bar}
  style:left={pos ? `${pos.x}px` : undefined}
  style:top={pos ? `${pos.y}px` : undefined}
>
  {#if session.state === 'countdown'}
    <span class="nb-dot" aria-hidden="true"></span>
    <span class="nb-count" data-nb-count aria-live="assertive">{countdownN}</span>
    <span class="nb-label">{session.paused ? 'Paused' : 'Get ready'}</span>
    <span class="nb-sep"></span>
    <button class="nb-b" class:on={tool === 'blur'} type="button" data-tip="Blur elements" aria-label="Blur elements" data-nb-tool="blur" onclick={() => ontool(tool === 'blur' ? null : 'blur')}>
      <Icon name="blur" size={18} />
    </button>
    <button class="nb-b" type="button" data-tip="Cancel" aria-label="Cancel recording" data-nb-cancel onclick={() => call('countdown.cancel')}>
      <Icon name="close" size={16} />
    </button>
  {:else if session.state === 'starting'}
    <Icon name="spinner" size={16} />
    <span class="nb-label" data-nb-starting>Starting</span>
  {:else if session.state === 'stopping'}
    <Icon name="spinner" size={16} />
    <span class="nb-label" data-nb-processing>Collecting logs</span>
  {:else if tool === 'pen'}
    <div class="nb-swatches" role="radiogroup" aria-label="Pen colour">
      {#each LIVE_PEN_COLORS as c (c)}
        <button
          class="nb-swatch"
          class:sel={c === penColor}
          type="button"
          role="radio"
          aria-checked={c === penColor}
          aria-label="Colour {c}"
          data-nb-swatch={c}
          style:--sw={c}
          onclick={() => onpencolor(c)}
        ></button>
      {/each}
    </div>
    <button class="nb-done" type="button" data-nb-tool-done onclick={() => ontool(null)}>Done</button>
  {:else if tool === 'blur'}
    <span class="nb-label nb-hint">Click elements to blur</span>
    <button class="nb-b" type="button" data-tip="Undo" aria-label="Undo blur" data-nb-blur-undo disabled={!blurCount && !blur.canUndo()} onclick={onblurundo}>
      <Icon name="undo" size={16} />
    </button>
    <button class="nb-done" type="button" data-nb-tool-done onclick={() => ontool(null)}>Done</button>
  {:else}
    <button class="nb-b nb-stop" type="button" data-tip="Stop and review" aria-label="Stop recording" data-nb-stop onclick={() => call('recording.stop')}>
      <Icon name="stop" size={18} />
    </button>
    <button
      class="nb-b"
      type="button"
      data-tip={paused ? 'Resume' : 'Pause'}
      aria-label={paused ? 'Resume recording' : 'Pause recording'}
      data-nb-pause
      onclick={() => call(paused ? 'recording.resume' : 'recording.pause')}
    >
      <Icon name={paused ? 'play' : 'pause'} size={16} />
    </button>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span
      class="nb-timer"
      class:paused
      data-nb-timer
      title="Drag to move"
      onpointerdown={dragStart}
      onpointermove={dragMove}
      onpointerup={dragEnd}
      onpointercancel={dragEnd}
    >
      {formatTimer(elapsed)}{#if stage === 'warn' || stage === 'danger'}<span class="nb-cap" data-nb-cap> / {formatTimer(capMs ?? 0)}</span>{/if}
    </span>
    <button
      class="nb-b nb-mic"
      class:denied={mic === 'denied'}
      class:off={mic !== 'on'}
      type="button"
      data-tip={micTip}
      aria-label={micTip}
      aria-disabled={mic === 'denied'}
      data-nb-mic={mic}
      onclick={toggleMic}
    >
      <Icon name={mic === 'on' ? 'mic' : mic === 'denied' ? 'mic-denied' : 'mic-off'} size={16} />
    </button>
    <span class="nb-sep"></span>
    <button class="nb-b" type="button" data-tip="Draw" aria-label="Draw on the page" data-nb-tool="pen" onclick={() => ontool('pen')}>
      <Icon name="pen" size={16} />
    </button>
    <button class="nb-b" type="button" data-tip="Blur elements" aria-label="Blur elements" data-nb-tool="blur" onclick={() => ontool('blur')}>
      <Icon name="blur" size={18} />
    </button>
  {/if}
</div>

<style>
  .nb-bar {
    position: fixed;
    left: 50%;
    bottom: 70px;
    translate: -50% 0;
    height: 40px;
    min-width: 120px;
    box-sizing: border-box;
    padding: 0 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    box-shadow: var(--nb-shadow-lg);
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-sans);
    pointer-events: auto;
    user-select: none;
    animation: nb-rise var(--nb-dur-med) var(--nb-ease-out);
  }
  .nb-bar.placed {
    bottom: auto;
    translate: none;
  }
  .nb-bar[data-state='starting'],
  .nb-bar[data-state='stopping'] {
    padding: 0 14px;
    gap: 8px;
  }
  .nb-b {
    all: unset;
    position: relative;
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    cursor: pointer;
    color: var(--nb-on-chrome);
  }
  .nb-b:hover:not(:disabled) {
    background: var(--nb-chrome-2);
  }
  .nb-b:focus-visible,
  .nb-done:focus-visible,
  .nb-swatch:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: 1px;
  }
  .nb-b:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .nb-b.on {
    background: var(--nb-chrome-2);
    color: var(--nb-accent);
  }
  .nb-stop {
    color: #f0675a;
  }
  .nb-mic.off {
    color: var(--nb-on-chrome-muted);
  }
  .nb-mic.denied {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .nb-timer {
    min-width: 58px;
    padding: 0 6px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--nb-weight-medium) var(--nb-text-md) / 1 var(--nb-font-mono);
    font-variant-numeric: tabular-nums;
    cursor: grab;
    border-radius: var(--nb-radius-sm);
    touch-action: none;
  }
  .nb-timer:active {
    cursor: grabbing;
  }
  .nb-timer.paused {
    animation: nb-blink 1.2s steps(2, start) infinite;
  }
  .nb-bar[data-stage='warn'] .nb-timer {
    color: #f5a524;
  }
  .nb-bar[data-stage='danger'] .nb-timer {
    color: #f0675a;
  }
  .nb-cap {
    color: inherit;
    opacity: 0.8;
    margin-left: 2px;
  }
  .nb-sep {
    width: 1px;
    height: 20px;
    margin: 0 4px;
    background: var(--nb-chrome-2);
  }
  .nb-dot {
    width: 10px;
    height: 10px;
    margin: 0 6px 0 8px;
    border-radius: 50%;
    background: #e0402f;
  }
  .nb-count {
    min-width: 18px;
    font: var(--nb-weight-semibold) 18px / 1 var(--nb-font-sans);
    font-variant-numeric: tabular-nums;
  }
  .nb-label {
    padding: 0 6px;
    white-space: nowrap;
  }
  .nb-hint {
    padding-left: 12px;
    color: var(--nb-on-chrome-muted);
  }
  .nb-swatches {
    display: flex;
    gap: 3px;
    padding: 0 4px;
  }
  .nb-swatch {
    all: unset;
    box-sizing: border-box;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--sw);
    border: 2px solid rgb(255 255 255 / 0.15);
    cursor: pointer;
  }
  .nb-swatch.sel {
    border-color: #fff;
    box-shadow: 0 0 0 2px var(--nb-chrome), 0 0 0 3px var(--sw);
  }
  .nb-done {
    all: unset;
    height: 28px;
    padding: 0 12px;
    margin-left: 4px;
    border-radius: var(--nb-radius-pill);
    background: var(--nb-accent);
    color: var(--nb-on-accent);
    cursor: pointer;
    font: var(--nb-weight-semibold) var(--nb-text-md) / 28px var(--nb-font-sans);
  }
  [data-tip]::after {
    content: attr(data-tip);
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    translate: -50% 4px;
    padding: 5px 8px;
    border-radius: var(--nb-radius-sm);
    background: var(--nb-chrome);
    color: var(--nb-on-chrome);
    font: var(--nb-weight-medium) var(--nb-text-sm) / 1.2 var(--nb-font-sans);
    white-space: nowrap;
    box-shadow: var(--nb-shadow-md);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--nb-dur-fast),
      translate var(--nb-dur-fast);
  }
  [data-tip]:hover::after {
    opacity: 1;
    translate: -50% 0;
    transition-delay: 600ms;
  }
  @keyframes nb-rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @keyframes nb-blink {
    to {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .nb-bar,
    .nb-timer.paused {
      animation: none;
    }
  }
</style>
