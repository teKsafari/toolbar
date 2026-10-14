<script lang="ts">
  // Network tab (J-105, J-106, J-224, J-243, J-104): a DevTools-style table with type chips, a
  // text filter, an errors-only box and sortable columns; failed rows are pink. A row click opens
  // the detail pane and the list collapses to two columns; Up and Down step through requests and
  // the pane keeps its sub-tab.
  import { tick } from 'svelte';
  import {
    filterNetwork,
    fmtBytes,
    fmtClock,
    fmtDuration,
    fmtWallMs,
    isFailed,
    NETWORK_CHIPS,
    sortNetwork,
    type NetworkChip,
    type NetworkSortKey,
    type NetworkViewRow,
  } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import EmptyState from './EmptyState.svelte';
  import RequestDetail from './RequestDetail.svelte';
  import { useViewer } from './viewer.svelte.ts';
  import { followPlayback } from './follow.svelte.ts';

  const v = useViewer();
  let q = $state('');
  let chip: NetworkChip = $state('all');
  let errorsOnly = $state(false);
  let sortKey: NetworkSortKey = $state('index');
  let sortDir: 1 | -1 = $state(1);
  let sub: 'headers' | 'payload' | 'response' | 'timing' = $state('headers');
  let list: HTMLDivElement | undefined = $state();
  let flash: string | null = $state(null);

  const rows = $derived(sortNetwork(filterNetwork(v.network, { chip, q, errorsOnly }), sortKey, sortDir));
  const selected = $derived(v.selectedRid ? (v.network.find((n) => n.rid === v.selectedRid) ?? null) : null);
  const follow = followPlayback(() => list, () => (sortKey === 'index' && sortDir === 1 ? rows : []), v);
  const span = $derived(Math.max(1, ...v.network.map((n) => n.startAt + (n.durationMs ?? 0))));
  const tz = $derived(v.prefs.timeZone === 'utc' ? 'UTC' : v.prefs.timeZone === 'capture' ? (v.detail.env?.tz ?? undefined) : undefined);

  const COLS: { key: NetworkSortKey; label: string; cls: string }[] = [
    { key: 'index', label: '#', cls: 'c-i' },
    { key: 'name', label: 'Name', cls: 'c-name' },
    { key: 'method', label: 'Method', cls: 'c-m' },
    { key: 'status', label: 'Status', cls: 'c-s' },
    { key: 'domain', label: 'Domain', cls: 'c-d' },
    { key: 'type', label: 'Type', cls: 'c-t' },
  ];

  function sortBy(k: NetworkSortKey) {
    if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
    else {
      sortKey = k;
      sortDir = 1;
    }
  }
  function select(r: NetworkViewRow) {
    v.selectedRid = r.rid;
    if ((r.type === 'websocket' || r.type === 'eventsource') && (sub === 'payload' || sub === 'response')) sub = 'response';
  }
  function step(d: 1 | -1) {
    const i = rows.findIndex((r) => r.rid === v.selectedRid);
    const next = rows[i < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, i + d))];
    if (!next) return;
    v.selectedRid = next.rid;
    void tick().then(() => list?.querySelector(`[data-rid="${CSS.escape(next.rid)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }
  function onKey(e: KeyboardEvent) {
    if (!v.selectedRid || v.tab !== 'network') return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Escape') v.selectedRid = null;
  }
  const typeIcon = (r: NetworkViewRow) =>
    r.type === 'websocket' || r.type === 'eventsource' ? 'link' : r.type === 'image' || r.type === 'media' ? 'screenshot' : r.type === 'document' ? 'tab' : r.type === 'script' || r.type === 'stylesheet' ? 'console' : 'network';
  const typeLabel = (r: NetworkViewRow) => (r.type === 'eventsource' ? 'sse' : r.type === 'websocket' ? 'ws' : r.type === 'stylesheet' ? 'css' : r.type === 'script' ? 'js' : r.type);

  $effect(() => {
    const f = v.focus;
    if (!f || f.tab !== 'network') return;
    q = '';
    chip = 'all';
    errorsOnly = false;
    v.selectedRid = f.id;
    void tick().then(() => {
      list?.querySelector(`[data-rid="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: 'center' });
      flash = f.id;
      setTimeout(() => (flash = null), 1600);
    });
  });
</script>

<svelte:window onkeydown={onKey} />

{#if v.detail.source === 'recording-link' && !v.network.length}
  <EmptyState icon="network" title="No network logs for recording-link captures yet" body="Requests are recorded by the extension, or when the recorder runs on your own domain." action={{ label: 'How to set it up', href: '/settings/integrations' }} />
{:else if v.eventsLoaded && !v.network.length}
  <EmptyState icon="network" title="Not a single request. This page kept to itself." testid="network-empty" />
{:else}
  <div class="vp-bar">
    <label class="vp-search"><VIcon name="search" size={14} /><input type="text" placeholder="Filter by URL, method or status" bind:value={q} aria-label="Filter requests" data-testid="network-filter" /></label>
    <label class="errs"><input type="checkbox" bind:checked={errorsOnly} data-testid="errors-only" />Errors only</label>
    <div class="chips" role="group" aria-label="Request type">
      {#each NETWORK_CHIPS as c (c.id)}
        <button type="button" class="vp-chip" class:sel={chip === c.id} aria-pressed={chip === c.id} onclick={() => (chip = c.id)} data-testid="type-{c.id}">{c.label}</button>
      {/each}
    </div>
  </div>
  <div class="split" class:open={!!selected}>
    <div class="vp-list tablewrap" bind:this={list} data-testid="network-list">
      <div class="table" class:tabcol={v.showTabColumn} class:narrow={!!selected} role="table" aria-label="Requests">
        <div class="hrow" role="row">
          {#each COLS as c (c.key)}
            {#if !selected || c.key === 'index' || c.key === 'name'}
              <button type="button" role="columnheader" class="h {c.cls}" onclick={() => sortBy(c.key)} aria-sort={sortKey === c.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
                {c.label}{#if sortKey === c.key && c.key !== 'index'}<VIcon name={sortDir === 1 ? 'chevron-up' : 'chevron-down'} size={10} />{/if}
              </button>
            {/if}
          {/each}
          {#if !selected}
            {#if v.showTabColumn}<span role="columnheader" class="h c-tab" data-testid="tab-column">Tab</span>{/if}
            <span role="columnheader" class="h c-f">Frame</span>
            <button type="button" role="columnheader" class="h c-z" onclick={() => sortBy('size')}>Size</button>
            <button type="button" role="columnheader" class="h c-ms" onclick={() => sortBy('time')}>Time</button>
            <span role="columnheader" class="h c-w">Waterfall</span>
          {/if}
        </div>
        {#if !rows.length}<div class="vp-striped">No requests match these filters.</div>{/if}
        {#each rows as r, i (r.rid)}
          <div
            class="vp-row nrow"
            class:failed={isFailed(r)}
            class:pending={r.state === 'pending'}
            class:sel={v.selectedRid === r.rid}
            class:future={v.playable && r.at > v.now + 1}
            class:current={follow.current === i && v.playable}
            class:flash={flash === r.rid}
            data-rid={r.rid}
            data-row-index={i}
            role="row"
            tabindex="-1"
            onclick={() => select(r)}
            onkeydown={(e) => { if (e.key === 'Enter') select(r); }}>
            <button type="button" class="vp-gutter g" onclick={(e) => { e.stopPropagation(); v.seek(r.at, { arm: true }); }} aria-label="Seek to {fmtClock(r.at)}" title="Play from here"><VIcon name="play" size={10} /></button>
            <span class="c-i" role="cell">{r.index + 1}</span>
            <span class="c-name" role="cell" title={r.url}><VIcon name={typeIcon(r) as never} size={12} /><span class="ell">{r.path || r.url}</span></span>
            {#if !selected}
              <span class="c-m" role="cell">{r.method}</span>
              <span class="c-s" role="cell">{r.status ?? (r.state === 'pending' ? 'pending' : (r.error ?? 'failed'))}</span>
              <span class="c-d" role="cell"><span class="ell">{r.host}</span></span>
              <span class="c-t" role="cell">{typeLabel(r)}</span>
              {#if v.showTabColumn}<span class="c-tab" role="cell">{r.tabId ?? ''}</span>{/if}
              <span class="c-f" role="cell">{r.frame}</span>
              <span class="c-z" role="cell">{fmtBytes(r.size)}</span>
              <span class="c-ms" role="cell" title={fmtWallMs(r.t, tz)}>{r.state === 'pending' ? '' : fmtDuration(r.durationMs)}</span>
              <span class="c-w" role="cell"><span class="wf" class:pend={r.state === 'pending'} style:left="{(r.startAt / span) * 100}%" style:width="{Math.max(0.6, ((r.durationMs ?? span - r.startAt) / span) * 100)}%"></span></span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
    {#if selected}
      <RequestDetail entry={selected} bind:sub onclose={() => (v.selectedRid = null)} />
    {/if}
  </div>
{/if}

<style>
  .errs { display: inline-flex; align-items: center; gap: 5px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); white-space: nowrap; cursor: pointer; }
  .chips { display: flex; gap: 4px; overflow-x: auto; max-width: 100%; scrollbar-width: none; }
  .split { flex: 1; min-height: 0; display: flex; }
  .tablewrap { flex: 1; min-width: 0; overflow: auto; }
  .split.open .tablewrap { flex: 0 0 34%; max-width: 260px; border-right: 1px solid var(--nb-border); }
  .table { min-width: 880px; }
  .table.narrow { min-width: 0; }
  .hrow, .nrow { display: grid; grid-template-columns: 18px 34px minmax(140px, 2.4fr) 56px 64px minmax(80px, 1fr) 70px 46px 64px 64px minmax(90px, 1.2fr); align-items: center; }
  .table.tabcol .hrow, .table.tabcol .nrow { grid-template-columns: 18px 34px minmax(140px, 2.4fr) 56px 64px minmax(80px, 1fr) 70px 46px 46px 64px 64px minmax(90px, 1.2fr); }
  .table.narrow .hrow, .table.narrow .nrow { grid-template-columns: 18px 34px minmax(0, 1fr); }
  .hrow { position: sticky; top: 0; z-index: 1; height: 26px; background: var(--nb-surface); border-bottom: 1px solid var(--nb-border-strong); padding: 0 10px 0 7px; }
  .hrow .h:first-child { grid-column: 2; }
  .h { all: unset; display: inline-flex; align-items: center; gap: 2px; font: 600 var(--nb-text-xs) var(--nb-font-sans); color: var(--nb-text-muted); cursor: pointer; white-space: nowrap; }
  .nrow { cursor: pointer; padding-top: 0; }
  .nrow > span { overflow: hidden; white-space: nowrap; padding: 3px 4px 3px 0; }
  .nrow.sel { background: var(--nb-accent-tint) !important; }
  .nrow.failed { background: var(--nb-danger-tint); color: var(--nb-danger); }
  .nrow.pending .c-s { color: var(--nb-text-faint); font-style: italic; }
  .c-i { color: var(--nb-text-faint); }
  .c-name { display: flex; align-items: center; gap: 5px; min-width: 0; }
  .ell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .c-d { display: flex; min-width: 0; }
  .c-w { position: relative; height: 22px; }
  .wf { position: absolute; top: 8px; height: 6px; border-radius: 2px; background: var(--nb-accent); opacity: 0.75; }
  .wf.pend { background: repeating-linear-gradient(90deg, var(--nb-text-faint) 0 4px, transparent 4px 7px); }
  .failed .wf { background: var(--nb-danger); }
  .g { opacity: 0; }
  @media (max-width: 720px) {
    .split.open { flex-direction: column; }
    .split.open .tablewrap { flex: 0 0 35%; max-width: none; border-right: 0; border-bottom: 1px solid var(--nb-border); }
  }
</style>
