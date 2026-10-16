<script lang="ts">
  // The comment card next to a pin, selection or drawing (M-12, M-15, M-17, M-30). Top: what the
  // note points at, with its selector. Then the text box, the screenshot when there is one, the
  // voice note, what goes with it from the last minute, and the tags. Enter adds, Shift+Enter is a
  // new line, Esc cancels.
  import { onMount, tick } from 'svelte';
  import { Icon } from '@toolbar/ui';
  import { FEEDBACK_INTENTS, FEEDBACK_SEVERITIES } from '@toolbar/shared/areas/reviewer';
  import { review as r } from './state.svelte';
  import { shortSelector } from './page';
  import { fitIn, viewport } from './viewport.svelte';

  let box: HTMLTextAreaElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  let size = $state({ w: 344, h: 210 });

  const d = $derived(r.draft!);
  // beside the point it was opened for, inside the visible area, recomputed when the window is
  // resized or zoomed; fitIn moves it back on screen if it still does not fit (D-199)
  const pos = $derived.by(() => {
    const a = viewport.box;
    const gap = 14;
    const right = a.x + a.w - 8;
    const bottom = a.y + a.h - (a.h > 400 ? 76 : 8);
    let x = d.at.x + gap;
    let y = d.at.y - 12;
    if (x + size.w > right) x = d.at.x - gap - size.w;
    if (x < a.x + 8) x = Math.max(a.x + 8, right - size.w);
    if (y + size.h > bottom) y = bottom - size.h;
    return { x, y: Math.max(a.y + 8, y) };
  });
  const placeholder = $derived(
    d.kind === 'text' ? 'What is wrong with this text?' : d.kind === 'voice' ? 'Add a few words (optional)' : d.kind === 'draw' || d.kind === 'shot' ? 'What should change here? (optional)' : 'What should change?',
  );
  /** "1 error and 2 failed requests from the last minute go with it", naming only what is there */
  const contextLine = $derived.by(() => {
    const parts = [
      r.context.errors ? `${r.context.errors} ${r.context.errors === 1 ? 'error' : 'errors'}` : '',
      r.context.failed ? `${r.context.failed} failed ${r.context.failed === 1 ? 'request' : 'requests'}` : '',
    ].filter(Boolean);
    const one = r.context.errors + r.context.failed === 1;
    return `${parts.join(' and ')} from the last minute ${one ? 'goes' : 'go'} with it`;
  });
  const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`;

  onMount(() => {
    void tick().then(() => {
      box?.focus();
      // text typed before the composer opened stays, with the caret after it (D-160)
      if (box) box.selectionStart = box.selectionEnd = box.value.length;
    });
  });
  $effect(() => {
    if (!card) return;
    const ro = new ResizeObserver(() => {
      if (card) size = { w: card.offsetWidth, h: card.offsetHeight };
    });
    ro.observe(card);
    return () => ro.disconnect();
  });

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void r.saveDraft();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      r.cancelDraft();
    }
  }
</script>

<div class="card" bind:this={card} use:fitIn={`${pos.x} ${pos.y}`} style:left="{pos.x}px" style:top="{pos.y}px" role="dialog" aria-label="Note" data-nb-interactive data-testid="review-composer" data-kind={d.kind}>
  <div class="head" title={d.target?.selector ?? ''}>
    <span class="what" data-testid="review-composer-label">{d.label}</span>
    {#if d.target}<code class="sel">{shortSelector(d.target)}</code>{/if}
  </div>
  {#if d.quote}<blockquote data-testid="review-composer-quote">{d.quote.length > 200 ? d.quote.slice(0, 199) + '…' : d.quote}</blockquote>{/if}
  <textarea bind:this={box} bind:value={r.draft!.comment} rows="3" {placeholder} onkeydown={key} data-testid="review-comment"></textarea>
  {#if d.cropPreview}
    <img class="crop" src={d.cropPreview} alt="Screenshot of the {d.kind === 'draw' ? 'drawing' : 'element'}" data-testid="review-crop" />
  {:else if d.cropBlobId && !d.cropAuto}
    <span class="att" data-testid="review-crop-kept"><Icon name="camera" size={13} />Screenshot attached</span>
  {/if}
  {#if r.voice?.for === 'draft'}
    <span class="att rec" data-testid="review-composer-recording"><span class="dot"></span>Recording {fmt(r.now - r.voice.startedAt)}</span>
  {:else if d.voiceBlobId}
    <span class="att" data-testid="review-composer-voice"><Icon name="mic" size={13} />Voice note {d.voiceDurationMs ? fmt(d.voiceDurationMs) : ''}
      <button type="button" class="x" aria-label="Remove the voice note" onclick={() => { r.draft!.voiceBlobId = undefined; r.draft!.voiceDurationMs = undefined; }}><Icon name="close" size={11} /></button>
    </span>
  {/if}
  {#if !d.id && (r.context.errors || r.context.failed)}
    <span class="ctx" data-testid="review-context">
      <Icon name="warning" size={13} />{contextLine}
    </span>
  {/if}
  <div class="row">
    {#if d.kind !== 'voice'}
      <button type="button" class="ib" aria-label="Screenshot of what the note points at" title="Attach a screenshot" disabled={!!d.cropBlobId || r.busy} data-testid="review-composer-shot" onclick={() => void r.attachShot()}><Icon name="camera" size={16} /></button>
    {/if}
    <button type="button" class="ib" class:rec={r.voice?.for === 'draft'} aria-label={r.voice?.for === 'draft' ? 'Stop the voice note' : 'Record a voice note'} title={r.voice?.for === 'draft' ? 'Stop' : 'Voice note'} disabled={r.adding} data-testid="review-composer-voice-toggle" onclick={() => (r.voice ? void r.stopVoice() : void r.startVoice('draft'))}>
      <Icon name={r.voice?.for === 'draft' ? 'stop' : 'mic'} size={16} />
    </button>
    <select bind:value={r.draft!.intent} aria-label="Intent" data-testid="review-intent">
      {#each FEEDBACK_INTENTS as i (i)}<option value={i}>{i}</option>{/each}
    </select>
    <select bind:value={r.draft!.severity} aria-label="Severity" data-testid="review-severity">
      {#each FEEDBACK_SEVERITIES as s (s)}<option value={s}>{s}</option>{/each}
    </select>
    <span class="actions">
    {#if d.id}
      <button type="button" class="ib" aria-label="Delete the note" title="Delete" data-testid="review-delete" onclick={() => void r.remove(d.id!)}><Icon name="trash" size={16} /></button>
    {/if}
    <button type="button" class="btn" onclick={() => r.cancelDraft()} data-testid="review-cancel">Cancel</button>
    <button type="button" class="btn primary" disabled={r.busy || r.adding} aria-busy={r.adding} title={r.voice?.for === 'draft' ? 'Stop the voice note and add' : undefined} onclick={() => void r.saveDraft()} data-testid="review-add">{d.id ? 'Save' : 'Add'}</button>
    </span>
  </div>
</div>

<style>
  /* A surface card of the teksafari language (D-176): the theme's surface, 1 px edge, the floating
     shadow (it sits on an unknown page), a 32 px-class field with the 3 px focus ring, the accent
     as the one primary (M-12, M-15, M-17). 344 px wide, so the tools, both tags, Cancel and Add
     fit one line (at 320 the footer ran past the card); never wider than the viewport (D-199). */
  .card { position: fixed; pointer-events: auto; width: min(344px, calc(100vw - 16px)); box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: var(--nb-radius-lg); background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); font: 13px/1.45 var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui); animation: pop var(--nb-dur-med) var(--nb-ease-out); }
  @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
  .head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .what { font-weight: var(--nb-weight-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .sel { flex: none; max-width: 45%; font: 11px/1 var(--nb-font-mono); letter-spacing: 0; color: var(--nb-text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  blockquote { margin: 0; padding: 2px 8px; border-left: 2px solid var(--nb-capture-tint); color: var(--nb-text-body); font-style: italic; max-height: 4.2em; overflow: hidden; }
  textarea { all: unset; box-sizing: border-box; width: 100%; min-height: 60px; max-height: 180px; overflow: auto; padding: 8px 10px; border-radius: var(--nb-radius-md); background: var(--nb-surface); border: 1px solid var(--nb-border-strong); color: var(--nb-text); font: 13px/1.45 var(--nb-font-sans); white-space: pre-wrap; resize: vertical; transition: border-color var(--nb-dur-fast) var(--nb-ease-out), box-shadow var(--nb-dur-fast) var(--nb-ease-out); }
  textarea::placeholder { color: var(--nb-text-faint); }
  textarea:focus { border-color: var(--nb-focus); box-shadow: var(--nb-focus-ring); }
  .crop { display: block; max-width: 100%; max-height: 140px; object-fit: contain; align-self: flex-start; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border); background: #fff; }
  .att { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nb-text-muted); }
  .att.rec { color: var(--nb-danger); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--nb-danger); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.4; } }
  .x { all: unset; cursor: pointer; display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; color: var(--nb-text-faint); }
  .x:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .x:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; color: var(--nb-text); }
  .ctx { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nb-warning); }
  /* tools and tags on the left, Cancel and Add on the right; on a card too narrow for both (a
     phone under 360 px, or an edit with its delete button) the actions wrap to a line of their own */
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; }
  .row > * { flex: none; }
  .actions { display: flex; align-items: center; gap: 4px; margin-left: auto; }
  .ib { all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: var(--nb-radius-sm); display: grid; place-items: center; cursor: pointer; color: var(--nb-text-muted); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out); }
  .ib:hover:not(:disabled) { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .ib:disabled { opacity: 0.35; cursor: default; }
  .ib.rec { color: var(--nb-danger); }
  /* sized to the chosen value (field-sizing, Chrome 123+), so "fix" leaves room for Add; older
     Chrome sizes it to the longest option and the actions wrap */
  select { box-sizing: border-box; height: 28px; max-width: 100px; field-sizing: content; padding: 0 4px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text-body); font: 12px var(--nb-font-sans); cursor: pointer; }
  select:hover { background: var(--nb-surface-sunken); }
  .btn { all: unset; box-sizing: border-box; height: 28px; padding: 0 8px; border-radius: var(--nb-radius-sm); cursor: pointer; font: var(--nb-weight-medium) 12px/28px var(--nb-font-sans); color: var(--nb-text-muted); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), transform var(--nb-dur-fast) var(--nb-ease-out); }
  .btn:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  /* The one primary action: the accent, flat on the card (black with white text in light,
     near-white with near-black text in dark, or the brand's accent). The site's lift shadow and
     inset highlight made it look like a stray raised light button on the dark card, so a card
     button gets none; hover and press take the accent's own steps, focus the 3 px ring (D-199). */
  .btn.primary { padding: 0 12px; background: var(--nb-accent); color: var(--nb-on-accent); font-weight: var(--nb-weight-semibold); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), transform var(--nb-dur-fast) var(--nb-ease-out), box-shadow var(--nb-dur-fast) var(--nb-ease-out); }
  .btn.primary:hover:not(:disabled) { background: var(--nb-accent-hover); color: var(--nb-on-accent); }
  .btn.primary:active:not(:disabled) { background: var(--nb-accent-active); transform: translateY(1px); }
  .btn.primary:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; box-shadow: var(--nb-focus-ring); }
  .btn.primary[aria-busy='true'] { cursor: progress; }
  .btn:disabled { opacity: 0.5; cursor: default; }
  .ib:focus-visible, .btn:not(.primary):focus-visible, select:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) {
    .card, .dot { animation: none; }
    .btn, .btn.primary, .ib { transition: none; }
  }
</style>
