<script lang="ts">
  // The tab's unsent notes in pin order (compact list, M-28 in its smallest form). A row opens its
  // note when it is on this page; notes from other pages of the tab say where they are.
  import { Icon, type IconName } from '@toolbar/ui';
  import type { ReviewItem } from '@toolbar/shared/ext';
  import { review as r } from './state.svelte';
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
  const pathOf = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };
</script>

<div class="list" use:fitIn={`${place.left} ${place.top} ${place.right} ${place.bottom}`} style:left={place.left} style:right={place.right} style:top={place.top} style:bottom={place.bottom} role="dialog" aria-label="Notes on this tab" data-nb-interactive data-testid="review-list">
  <div class="head">
    <span>Notes</span>
    <span class="muted">{r.items.length ? `${r.items.length} not sent` : 'none yet'}</span>
    {#if r.trace}<span class="tr">on the trace</span>{/if}
  </div>
  {#if !r.items.length}
    <p class="empty">Press C and click an element, select text, or draw with R, A or F.</p>
  {:else}
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
    <div class="foot">
      <button type="button" class="btn" onclick={() => void r.clearAll()} data-testid="review-clear">Discard all</button>
      <button type="button" class="btn primary" disabled={r.busy} onclick={() => void r.submit()} data-testid="review-list-send">{r.trace ? 'Add to trace' : 'Send'} {r.items.length}</button>
    </div>
  {/if}
</div>

<style>
  /* Surface card with a header line, 30 px rows and a footer rule (D-176); placed beside the dock (D-199). */
  .list { position: fixed; width: min(320px, calc(100vw - 16px)); max-height: min(60vh, 420px); pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box; border-radius: var(--nb-radius-lg); background: var(--nb-surface); color: var(--nb-text); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); font: 13px/1.4 var(--nb-font-sans); letter-spacing: var(--nb-tracking-ui); overflow: hidden; animation: pop var(--nb-dur-med) var(--nb-ease-out); }
  @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 10px 12px 6px; font-weight: var(--nb-weight-semibold); }
  .muted { color: var(--nb-text-faint); font-weight: 400; font-size: 12px; }
  .tr { margin-left: auto; color: var(--nb-danger); font-size: 11px; font-weight: 500; }
  .empty { margin: 0; padding: 4px 12px 12px; color: var(--nb-text-muted); font-size: 12px; }
  ol { list-style: none; margin: 0; padding: 0 4px 4px; overflow: auto; }
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
