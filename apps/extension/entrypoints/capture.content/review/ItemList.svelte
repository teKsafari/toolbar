<script lang="ts">
  // The tab's unsent notes in pin order (compact list, M-28 in its smallest form). A row opens its
  // note when it is on this page; notes from other pages of the tab say where they are.
  import { Icon, type IconName } from '@toolbar/ui';
  import type { ReviewItem } from '@toolbar/shared/ext';
  import { review as r } from './state.svelte';
  import { pinPoint, samePage } from './page';

  const ICON: Record<ReviewItem['kind'], IconName> = { element: 'comment', text: 'text', draw: 'pen', shot: 'camera', voice: 'mic', note: 'comment' };
  const top = $derived(r.corner === 'tl' || r.corner === 'tr');
  const left = $derived(r.corner === 'tl' || r.corner === 'bl');

  function open(it: ReviewItem) {
    if (!samePage(it.page.url)) return;
    let p = pinPoint(it);
    if (p && (p.y < 0 || p.y > innerHeight)) {
      scrollBy({ top: p.y - innerHeight / 2 });
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

<div class="list" class:top class:left role="dialog" aria-label="Notes on this tab" data-nb-interactive data-testid="review-list">
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
  .list { position: fixed; right: 20px; bottom: 74px; width: 320px; max-height: min(60vh, 420px); pointer-events: auto; display: flex; flex-direction: column; box-sizing: border-box; border-radius: 12px; background: #18181b; color: #f4f4f5; box-shadow: 0 12px 36px rgb(0 0 0 / 0.32), 0 0 0 1px rgb(255 255 255 / 0.08) inset; font: 13px/1.4 var(--nb-font-sans); overflow: hidden; }
  .list.left { right: auto; left: 20px; }
  .list.top { bottom: auto; top: 74px; }
  .head { display: flex; align-items: baseline; gap: 8px; padding: 10px 12px 6px; font-weight: 600; }
  .muted { color: #a1a1aa; font-weight: 400; font-size: 12px; }
  .tr { margin-left: auto; color: #ff6b6f; font-size: 11px; font-weight: 500; }
  .empty { margin: 0; padding: 4px 12px 12px; color: #a1a1aa; font-size: 12px; }
  ol { list-style: none; margin: 0; padding: 0 4px; overflow: auto; }
  li { display: flex; align-items: center; }
  .row { all: unset; box-sizing: border-box; flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: 30px; padding: 0 8px; border-radius: 8px; cursor: pointer; color: #e4e4e7; }
  .row:hover:not(:disabled) { background: #27272a; }
  .row:disabled { cursor: default; opacity: 0.75; }
  .n { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--nb-accent); color: var(--nb-on-accent); font: 600 10px/1 var(--nb-font-sans); }
  .txt { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .page { max-width: 90px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .warn { flex: none; font-size: 10px; color: #18181b; background: #f5a524; border-radius: 7px; padding: 0 5px; }
  .del { all: unset; flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 6px; cursor: pointer; color: #71717a; }
  .del:hover { background: #27272a; color: #fff; }
  .foot { display: flex; justify-content: flex-end; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid #27272a; }
  .btn { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: 8px; cursor: pointer; font: 500 12px/28px var(--nb-font-sans); color: #d4d4d8; }
  .btn:hover { background: #27272a; }
  .btn.primary { background: var(--nb-accent); color: var(--nb-on-accent); }
  .btn:disabled { opacity: 0.5; }
</style>
