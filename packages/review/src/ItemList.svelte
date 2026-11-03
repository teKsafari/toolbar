<script lang="ts">
  // What Send sends from this tab (compact list, M-28 in its smallest form): the traces of its trace
  // session (D-214), each with its actions, errors and the reviewer's note (editable here, and
  // removable), then the unsent notes in pin order. A note row opens its note when it is on this
  // page; notes from other pages of the tab say where they are.
  import { Icon, type IconName } from '@toolbar/ui';
  import type { ReviewItem } from '@toolbar/shared/ext';
  import { review as r, sendingWhat } from './state.svelte';
  import type { ReviewTake } from './platform';
  import { pinPoint, samePage } from './page';
  import { reveal } from './track';
  import { fitIn } from './viewport.svelte';

  const ICON: Record<ReviewItem['kind'], IconName> = { element: 'comment', text: 'text', draw: 'pen', shot: 'camera', voice: 'mic', note: 'comment' };
  // beside the dock, on the side away from its anchor corner; fitIn keeps it on screen (D-199)
  const GAP = 10;
  const place = $derived({
    left: r.pos.h === 'l' ? `${r.pos.x}px` : 'auto',
    right: r.pos.h === 'r' ? `${r.pos.x}px` : 'auto',
    top: r.pos.v === 't' ? `${r.pos.y + r.dockH + GAP}px` : 'auto',
    bottom: r.pos.v === 'b' ? `${r.pos.y + r.dockH + GAP}px` : 'auto',
  });

  function open(it: ReviewItem) {
    if (!samePage(it.page.url)) return;
    let p = pinPoint(it);
    if (p && (p.y < 0 || p.y > innerHeight)) {
      // the element's own scroll container (an app shell's <main>), else the document (D-204)
      if (!reveal(it)) scrollBy({ top: p.y - innerHeight / 2 });
      p = pinPoint(it);
    }
    r.edit(it, p ? { x: p.x + 14, y: p.y } : { x: innerWidth / 2 - 160, y: innerHeight / 3 });
  }
  const clock = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const problems = (t: ReviewTake) => (t.outcomes?.error ?? 0) + (t.outcomes?.silent ?? 0) + (t.outcomes?.stuck ?? 0) + (t.outcomes?.dead ?? 0);
  /** a note box keeps what is typed; it is saved on blur */
  function keepNote(t: ReviewTake, e: Event) {
    const v = (e.currentTarget as HTMLTextAreaElement).value.trim();
    if (v !== t.note) void r.setNote(t.n, v);
  }
  function noteKey(e: KeyboardEvent) {
    e.stopPropagation(); // the toolbar's single-key shortcuts stay out of the text
    if (e.key === 'Escape') (e.currentTarget as HTMLTextAreaElement).blur();
  }
  /** Discard all asks once when it would drop traces */
  let confirming = $state(false);
  function discard() {
    if (r.trace?.takes.length && !confirming) return void (confirming = true);
    confirming = false;
    void r.clearAll();
  }
  const total = $derived(r.items.length + (r.trace?.takes.length ?? 0));
  const pathOf = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };
</script>

<div class="list" use:fitIn={`${place.left} ${place.top} ${place.right} ${place.bottom}`} style:left={place.left} style:right={place.right} style:top={place.top} style:bottom={place.bottom} role="dialog" aria-label="Traces and notes on this tab" data-nb-interactive data-testid="review-list">
  {#if !total}
    <div class="head"><span>Notes</span><span class="muted">none yet</span></div>
    <p class="empty">Press C and click an element, select text, or draw with R, A or F. Press X to trace what you do.</p>
  {:else}
    <div class="scroll">
      {#if r.trace?.takes.length}
        <div class="head"><span>Traces</span><span class="muted">{r.trace.takes.length} not sent</span></div>
        <ol class="takes">
          {#each r.trace.takes as t (t.n)}
            {@const live = t.endedAt === null}
            <li class="take" class:live data-testid="review-list-trace" data-n={t.n}>
              <div class="row static">
                <span class="tn"><Icon name="record" size={12} /></span>
                <span class="txt">Trace {t.n}</span>
                <span class="muted num">{live ? `recording ${clock(r.now - t.startedAt)}` : clock(t.endedAt! - t.startedAt)}</span>
                {#if t.spans != null}<span class="muted num">{t.spans} {t.spans === 1 ? 'action' : 'actions'}</span>{/if}
                {#if problems(t)}<span class="warn" title="Errors, failed requests, stuck or dead actions">{problems(t)}</span>{/if}
                <span class="grow"></span>
                {#if live}
                  <button type="button" class="del" aria-label="Stop trace {t.n}" title="Stop and keep it" onclick={() => void r.toggleTrace()}><Icon name="stop" size={12} /></button>
                {/if}
                <button type="button" class="del" aria-label="Remove trace {t.n}" title="Remove this trace" data-testid="review-trace-remove" onclick={() => void r.removeTake(t.n)}><Icon name="close" size={12} /></button>
              </div>
              <textarea class="note" rows="1" maxlength="4000" placeholder="What should the agent notice here?" aria-label="Note on trace {t.n}" value={t.note} onblur={(e) => keepNote(t, e)} onkeydown={noteKey} data-testid="review-trace-note"></textarea>
            </li>
          {/each}
        </ol>
      {/if}
      {#if r.items.length}
        <div class="head"><span>Notes</span><span class="muted">{r.items.length} not sent</span></div>
        <ol>
          {#each r.items as it (it.id)}
            {@const here = samePage(it.page.url)}
            <li data-testid="review-list-item" data-n={it.n} data-kind={it.kind}>
              <button type="button" class="row" disabled={!here} onclick={() => open(it)}>
                <span class="n">{it.n}</span>
                <Icon name={ICON[it.kind]} size={13} />
                <span class="txt">{it.comment || (it.quote ? `"${it.quote}"` : it.voiceBlobId ? 'Voice note' : it.kind === 'draw' ? 'Drawing' : 'Screenshot')}</span>
                {#if it.voiceBlobId}<Icon name="mic" size={12} />{/if}
                {#if it.context.errors.length || it.context.failedRequests.length}<span class="warn" title="Errors and failed requests attached">{it.context.errors.length + it.context.failedRequests.length}</span>{/if}
                {#if !here}<span class="muted page">{pathOf(it.page.url)}</span>{/if}
              </button>
              <button type="button" class="del" aria-label="Delete note {it.n}" onclick={() => void r.remove(it.id)}><Icon name="close" size={12} /></button>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
    <div class="foot">
      <button type="button" class="btn" class:danger={confirming} onclick={discard} onblur={() => (confirming = false)} data-testid="review-clear">{confirming ? `Discard ${sendingWhat(r.items.length, r.trace?.takes.length ?? 0)}?` : 'Discard all'}</button>
      <button type="button" class="btn primary" disabled={r.busy} onclick={() => void r.send()} data-testid="review-list-send">Send {r.pending || ''}</button>
    </div>
  {/if}
</div>

<style>
  /* Surface card with a header line, 30 px rows and a footer rule (D-176); placed beside the dock (D-199). */
  .list { position: fixed; width: min(320px, calc(100vw - 16px)); max-height: min(60vh, 420px); pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box; border-radius: var(--nb-radius-lg); background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); font: 13px/1.4 var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui); overflow: hidden; animation: pop var(--nb-dur-med) var(--nb-ease-out); }
  @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 10px 12px 6px; font-weight: var(--nb-weight-semibold); }
  .muted { color: var(--nb-text-faint); font-weight: 400; font-size: 12px; }
  .scroll { overflow: auto; min-height: 0; }
  .scroll > .head + ol { padding-top: 0; }
  .takes { padding-bottom: 6px; }
  .take { flex-direction: column; align-items: stretch; padding: 2px 0 4px; }
  .take + .take { border-top: 1px solid var(--nb-border); }
  .row.static { cursor: default; }
  .row.static:hover { background: none; color: var(--nb-text-body); }
  .tn { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--nb-surface-sunken); color: var(--nb-text-muted); }
  .take.live .tn { color: var(--nb-danger); }
  .take .txt { flex: none; font-weight: var(--nb-weight-medium); color: var(--nb-text); }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grow { flex: 1; }
  .note { all: unset; box-sizing: border-box; display: block; margin: 0 8px 2px 33px; padding: 5px 8px; min-height: 28px; max-height: 120px; border-radius: var(--nb-radius-sm); background: var(--nb-surface-sunken); color: var(--nb-text); font: 12px/1.45 var(--nb-font-sans); white-space: pre-wrap; overflow-wrap: anywhere; overflow-y: auto; field-sizing: content; }
  .note::placeholder { color: var(--nb-text-faint); }
  .note:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .btn.danger { color: var(--nb-danger); }
  .empty { margin: 0; padding: 4px 12px 12px; color: var(--nb-text-muted); font-size: 12px; }
  ol { list-style: none; margin: 0; padding: 0 4px 4px; }
  li { display: flex; align-items: center; }
  .row { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: 30px; padding: 0 8px; border-radius: var(--nb-radius-sm); cursor: pointer; color: var(--nb-text-body); }
  .row:hover:not(:disabled) { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .row:disabled { cursor: default; opacity: 0.75; }
  .row:focus-visible, .del:focus-visible, .btn:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .n { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--nb-accent); color: var(--nb-on-accent); font: var(--nb-weight-semibold) 10px/1 var(--nb-font-sans); font-variant-numeric: tabular-nums; }
  .txt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .page { max-width: 90px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--nb-font-mono); font-size: 11px; letter-spacing: 0; }
  .warn { flex: none; font: var(--nb-weight-medium) 10px/16px var(--nb-font-sans); color: var(--nb-warning-text); background: var(--nb-warning-tint); border-radius: var(--nb-radius-pill); padding: 0 6px; }
  .del { all: unset; flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--nb-radius-sm); cursor: pointer; color: var(--nb-text-faint); }
  .del:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .foot { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid var(--nb-border); }
  .btn { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: var(--nb-radius-sm); cursor: pointer; font: var(--nb-weight-medium) 12px/28px var(--nb-font-sans); color: var(--nb-text-muted); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), transform var(--nb-dur-fast) var(--nb-ease-out); }
  .btn:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  /* flat accent on the card, as the composer's Add (D-199) */
  .btn.primary { background: var(--nb-accent); color: var(--nb-on-accent); font-weight: var(--nb-weight-semibold); font-variant-numeric: tabular-nums; }
  .btn.primary:hover:not(:disabled) { background: var(--nb-accent-hover); color: var(--nb-on-accent); }
  .btn.primary:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; box-shadow: var(--nb-focus-ring); }
  .btn.primary:active:not(:disabled) { background: var(--nb-accent-active); transform: translateY(1px); }
  .btn:disabled { opacity: 0.5; cursor: default; }
  @media (prefers-reduced-motion: reduce) {
    .list { animation: none; }
  }
</style>
