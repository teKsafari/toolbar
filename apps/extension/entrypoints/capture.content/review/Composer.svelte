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

  let box: HTMLTextAreaElement | undefined = $state();
  let card: HTMLDivElement | undefined = $state();
  let size = $state({ w: 320, h: 210 });

  const d = $derived(r.draft!);
  const pos = $derived.by(() => {
    const gap = 14;
    let x = d.at.x + gap;
    let y = d.at.y - 12;
    if (x + size.w > innerWidth - 8) x = Math.max(8, d.at.x - gap - size.w);
    if (y + size.h > innerHeight - 76) y = Math.max(8, innerHeight - 76 - size.h);
    return { x, y: Math.max(8, y) };
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

<div class="card" bind:this={card} style:left="{pos.x}px" style:top="{pos.y}px" role="dialog" aria-label="Note" data-nb-interactive data-testid="review-composer" data-kind={d.kind}>
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
    <button type="button" class="ib" class:rec={r.voice?.for === 'draft'} aria-label={r.voice?.for === 'draft' ? 'Stop the voice note' : 'Record a voice note'} title={r.voice?.for === 'draft' ? 'Stop' : 'Voice note'} data-testid="review-composer-voice-toggle" onclick={() => (r.voice ? void r.stopVoice() : void r.startVoice('draft'))}>
      <Icon name={r.voice?.for === 'draft' ? 'stop' : 'mic'} size={16} />
    </button>
    <select bind:value={r.draft!.intent} aria-label="Intent" data-testid="review-intent">
      {#each FEEDBACK_INTENTS as i (i)}<option value={i}>{i}</option>{/each}
    </select>
    <select bind:value={r.draft!.severity} aria-label="Severity" data-testid="review-severity">
      {#each FEEDBACK_SEVERITIES as s (s)}<option value={s}>{s}</option>{/each}
    </select>
    <span class="grow"></span>
    {#if d.id}
      <button type="button" class="ib" aria-label="Delete the note" title="Delete" data-testid="review-delete" onclick={() => void r.remove(d.id!)}><Icon name="trash" size={16} /></button>
    {/if}
    <button type="button" class="btn" onclick={() => r.cancelDraft()} data-testid="review-cancel">Cancel</button>
    <button type="button" class="btn primary" disabled={r.busy} onclick={() => void r.saveDraft()} data-testid="review-add">{d.id ? 'Save' : 'Add'}</button>
  </div>
</div>

<style>
  .card { position: fixed; pointer-events: auto; width: 320px; box-sizing: border-box; display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 12px; background: #18181b; color: #f4f4f5; box-shadow: 0 12px 36px rgb(0 0 0 / 0.32), 0 0 0 1px rgb(255 255 255 / 0.08) inset; font: 13px/1.4 var(--nb-font-sans); animation: pop var(--nb-dur-fast) var(--nb-ease-out); }
  @keyframes pop { from { opacity: 0; transform: translateY(4px); } }
  .head { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .what { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .sel { flex: none; max-width: 45%; font: 11px/1 var(--nb-font-mono); color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  blockquote { margin: 0; padding: 2px 8px; border-left: 3px solid #f5d90a; color: #d4d4d8; font-style: italic; max-height: 4.2em; overflow: hidden; }
  textarea { all: unset; box-sizing: border-box; width: 100%; min-height: 60px; max-height: 180px; overflow: auto; padding: 8px 9px; border-radius: 8px; background: #27272a; color: #fafafa; font: 13px/1.45 var(--nb-font-sans); white-space: pre-wrap; resize: vertical; }
  textarea::placeholder { color: #8b8b93; }
  textarea:focus { box-shadow: 0 0 0 2px var(--nb-accent); }
  .crop { display: block; max-width: 100%; max-height: 140px; object-fit: contain; align-self: flex-start; border-radius: 6px; border: 1px solid #3f3f46; background: #fff; }
  .att { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #d4d4d8; }
  .att.rec { color: #ff6b6f; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #e5484d; animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.4; } }
  .x { all: unset; cursor: pointer; display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; color: #a1a1aa; }
  .x:hover { background: #3f3f46; color: #fff; }
  .ctx { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: #f5c451; }
  .row { display: flex; align-items: center; gap: 4px; }
  .grow { flex: 1; }
  .ib { all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; cursor: pointer; color: #d4d4d8; }
  .ib:hover { background: #27272a; color: #fff; }
  .ib:disabled { opacity: 0.35; cursor: default; }
  .ib.rec { color: #ff6b6f; }
  select { box-sizing: border-box; height: 26px; max-width: 86px; padding: 0 4px; border-radius: 7px; border: 1px solid #3f3f46; background: #18181b; color: #d4d4d8; font: 12px var(--nb-font-sans); }
  .btn { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: 8px; cursor: pointer; font: 500 12px/28px var(--nb-font-sans); color: #d4d4d8; }
  .btn:hover { background: #27272a; }
  .btn.primary { background: var(--nb-accent); color: var(--nb-on-accent); }
  .btn.primary:hover { background: var(--nb-accent-hover); }
  .btn:disabled { opacity: 0.5; }
  .ib:focus-visible, .btn:focus-visible, select:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
</style>
