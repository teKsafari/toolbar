<script lang="ts">
  // The launcher and the tool pill (M-01, M-03, M-04, M-05). Asleep: one dark round button with
  // the count of unsent notes. Awake: a dark pill of 32 px icon buttons that grows from the
  // launcher's corner. A running trace shows a red dot and the elapsed time (M-05). Drag the
  // grip to another corner; the corner is remembered for this browser.
  import { Icon, type IconName } from '@toolbar/ui';
  import { DRAW_COLORS } from '@toolbar/shared/areas/reviewer';
  import { review as r, type Corner, type Tool } from './state.svelte';

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
  const left = $derived(r.corner === 'bl' || r.corner === 'tl');
  const top = $derived(r.corner === 'tl' || r.corner === 'tr');

  // ---- drag to a corner (M-03)
  let drag: { id: number; x: number; y: number } | null = $state(null);
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function move(e: PointerEvent) {
    if (drag && e.pointerId === drag.id) drag = { ...drag, x: e.clientX, y: e.clientY };
  }
  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const c: Corner = `${e.clientY < innerHeight / 2 ? 't' : 'b'}${e.clientX < innerWidth / 2 ? 'l' : 'r'}` as Corner;
    drag = null;
    r.setCorner(c);
  }
</script>

<div class="dock" class:left class:top class:dragging={!!drag} style:--dx={drag ? `${drag.x}px` : undefined} style:--dy={drag ? `${drag.y}px` : undefined} data-testid="review-dock" data-corner={r.corner}>
  {#if !r.awake}
    <button type="button" class="launcher" data-nb-interactive data-testid="review-launcher" aria-label="Open the review toolbar (Ctrl+Shift+.)" title="Review this page (Ctrl+Shift+.)" onclick={() => r.wake()}>
      <Icon name="comment" size={20} />
      {#if r.items.length}<span class="badge" data-testid="review-badge">{r.items.length}</span>{/if}
      {#if r.trace}<span class="rec-dot" aria-label="Trace running"></span>{/if}
    </button>
  {:else}
    <div class="pill" role="toolbar" aria-label="Review toolbar" data-nb-interactive data-testid="review-pill">
      <span class="grip" role="presentation" title="Drag to another corner" onpointerdown={down} onpointermove={move} onpointerup={up}><Icon name="grip" size={14} /></span>
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
  .dock { position: fixed; right: 20px; bottom: 20px; pointer-events: none; display: flex; justify-content: flex-end; font: var(--nb-weight-medium) 13px/1 var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui); }
  .dock.left { right: auto; left: 20px; justify-content: flex-start; }
  .dock.top { bottom: auto; top: 20px; }
  .dock.dragging { left: var(--dx); top: var(--dy); right: auto; bottom: auto; transform: translate(-50%, -50%); opacity: 0.85; }
  .launcher { all: unset; box-sizing: border-box; position: relative; pointer-events: auto; cursor: pointer; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), inset 0 1px 0 rgb(255 255 255 / 0.06), var(--nb-shadow-lg); transition: transform var(--nb-dur-fast) var(--nb-ease-out), background-color var(--nb-dur-fast) var(--nb-ease-out); }
  .launcher:hover { background: var(--nb-chrome-2); }
  .launcher:active { transform: translateY(1px); }
  .launcher:focus-visible, .ib:focus-visible, .send:focus-visible { outline: 2px solid var(--nb-chrome-accent); outline-offset: 2px; }
  .badge { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); box-shadow: 0 0 0 2px var(--nb-chrome); font: var(--nb-weight-semibold) 11px/18px var(--nb-font-sans); font-variant-numeric: tabular-nums; text-align: center; }
  .rec-dot { position: absolute; bottom: 2px; right: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--nb-chrome-danger); box-shadow: 0 0 0 2px var(--nb-chrome); animation: pulse 1.4s ease-in-out infinite; }
  .rec-dot.inline { position: static; box-shadow: none; width: 8px; height: 8px; }
  @keyframes pulse { 50% { opacity: 0.45; } }
  .pill { pointer-events: auto; display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 6px; box-sizing: border-box; border-radius: 22px; background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: inset 0 0 0 1px var(--nb-chrome-border), inset 0 1px 0 rgb(255 255 255 / 0.06), var(--nb-shadow-lg); animation: grow var(--nb-dur-med) var(--nb-ease-out); max-width: calc(100vw - 40px); overflow-x: auto; scrollbar-width: none; }
  @keyframes grow { from { opacity: 0; transform: scale(0.95); } }
  .grip { display: grid; place-items: center; width: 16px; height: 32px; color: var(--nb-chrome-faint); cursor: grab; touch-action: none; }
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
  .send { all: unset; box-sizing: border-box; flex: none; height: 32px; padding: 0 11px; margin-left: 2px; border-radius: 16px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; background: var(--nb-chrome-accent); color: var(--nb-on-chrome-accent); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5); font: var(--nb-weight-semibold) 12px/1 var(--nb-font-sans); font-variant-numeric: tabular-nums; transition: background-color var(--nb-dur-fast) var(--nb-ease-out), transform var(--nb-dur-fast) var(--nb-ease-out); }
  .send:hover { background: var(--nb-chrome-accent-hover); }
  .send:active:not(:disabled) { transform: translateY(1px); }
  .send:disabled { opacity: 0.4; cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .pill, .rec-dot { animation: none; }
    .launcher, .ib, .send { transition: none; }
  }
</style>
