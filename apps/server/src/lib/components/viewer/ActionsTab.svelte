<script lang="ts">
  // Actions tab (J-108): clicks, typing, keys and navigations, the same row format as the
  // console, no filter bar; the attribute chip expands into a list (J-067). A trace capture with
  // traces (D-214) groups the rows under one header per trace, with the reviewer's note on it;
  // the header seeks to the trace's start.
  import { TRACE_LEAD_MS } from '@toolbar/trace';
  import { describeTarget, fmtClock, fmtWallMs, targetAttributes, type ActionViewRow } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import EmptyState from './EmptyState.svelte';
  import { useViewer } from './viewer.svelte.ts';
  import { followPlayback } from './follow.svelte.ts';

  const v = useViewer();
  let open = $state(new Set<string>());
  let list: HTMLDivElement | undefined = $state();
  const follow = followPlayback(() => list, () => v.actions, v);
  const tz = $derived(v.prefs.timeZone === 'utc' ? 'UTC' : v.prefs.timeZone === 'capture' ? (v.detail.env?.tz ?? undefined) : undefined);

  // Full loads say why they happened (J-069); SPA changes say how.
  const NAV_WORDS: Record<string, string> = {
    load: 'Loaded',
    reload: 'Reloaded',
    typed: 'Opened from the address bar',
    link: 'Followed a link to',
    form: 'Sent a form to',
    back_forward: 'Went back or forward to',
    other: 'Loaded',
    popstate: 'Went back to',
    bfcache: 'Went back to',
  };

  function text(r: ActionViewRow): string {
    switch (r.type) {
      case 'navigation':
        return `${NAV_WORDS[r.cause ?? ''] ?? 'Navigated to'} ${r.url}`;
      case 'input':
        return `Typed ${r.masked ? 'masked text' : JSON.stringify(r.value ?? '')} into`;
      case 'key':
        return `Pressed ${r.key}`;
      case 'visibility':
        return r.value === 'hidden' ? 'Tab hidden' : 'Tab visible';
      case 'dblclick':
        return 'Double click on';
      case 'contextmenu':
        return 'Right click on';
      case 'select':
        return 'Selected text in';
      default:
        return 'Click on';
    }
  }
  // traces: each action's outcome (packages/trace), the quiet failures first in the count line
  const OUTCOME_ORDER = ['dead', 'stuck', 'silent', 'error', 'changed'] as const;
  const counts = $derived(OUTCOME_ORDER.map((o) => [o, v.spans.filter((s) => s.outcome === o).length] as const).filter(([, n]) => n > 0));
  const outcomeText = (o: string, silent?: string) => (o === 'silent' && silent ? `silent ${silent}` : o);

  // one group per trace: the rows inside its window, its actions (spans) and their quiet outcomes;
  // rows outside every window (none after finalize, but an older capture may hold some) go last
  type Group = { n: number | null; startedAt: number; durationMs: number; note: string; rows: { r: ActionViewRow; i: number }[]; spans: number; quiet: [string, number][] };
  const groups: Group[] | null = $derived.by(() => {
    const ts = v.detail.traces;
    if (!ts.length) return null;
    const out: Group[] = ts.map((t) => {
      const sp = v.spans.filter((s) => s.trace === t.n);
      const quiet = OUTCOME_ORDER.filter((o) => o !== 'changed')
        .map((o) => [o, sp.filter((s) => s.outcome === o).length] as [string, number])
        .filter(([, n]) => n > 0);
      return { n: t.n, startedAt: t.startedAt, durationMs: t.endedAt - t.startedAt, note: t.note, rows: [], spans: sp.length, quiet };
    });
    const loose: Group = { n: null, startedAt: 0, durationMs: 0, note: '', rows: [], spans: 0, quiet: [] };
    v.actions.forEach((r, i) => {
      const k = ts.findIndex((t) => r.t >= t.startedAt - TRACE_LEAD_MS && r.t <= t.endedAt);
      (k >= 0 ? out[k]! : loose).rows.push({ r, i });
    });
    return loose.rows.length ? [...out, loose] : out;
  });
  const plain = $derived(v.actions.map((r, i) => ({ r, i })));

  function toggle(id: string) {
    const s = new Set(open);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    open = s;
  }
</script>

{#if v.detail.source === 'recording-link' && !v.actions.length}
  <div class="banner" data-testid="rl-banner"><VIcon name="info" size={14} />User events for recording-link captures are on the way. For now they come with the extension.</div>
{/if}
{#if v.eventsLoaded && !v.actions.some((r) => r.type !== 'navigation')}
  <EmptyState icon="select" title="Nobody clicked a thing. A very calm session." testid="actions-empty" />
{/if}
{#if counts.length}
  <div class="trace-sum" data-testid="trace-outcomes">
    {#each counts as [o, n] (o)}<span class="oc oc-{o}">{n} {o}</span>{/each}
  </div>
{/if}
{#snippet row(r: ActionViewRow, i: number)}
  {@const attrs = targetAttributes(r.target)}
  <div class="vp-row ar" class:kind-navigation={r.type === 'navigation'} class:future={v.playable && r.at > v.now + 1} class:current={follow.current === i && v.playable} data-row-index={i} role="listitem">
    <button type="button" class="vp-gutter" onclick={() => v.seek(r.at, { arm: true })} aria-label="Seek to {fmtClock(r.at)}" title="Play from here"><VIcon name="play" size={10} /></button>
    <span class="vp-time" title={fmtWallMs(r.t, tz)}>{fmtClock(r.at)}</span>
    <div class="main">
      <span class="ic"><VIcon name={(r.type === 'navigation' ? 'external' : r.type === 'input' || r.type === 'key' ? 'text' : 'select') as never} size={13} /></span>
      <span class="msg" title={r.type === 'navigation' ? r.url : undefined}>{text(r)}{#if r.target && r.type !== 'navigation' && r.type !== 'key'}{' '}<span class="tag">{describeTarget(r.target)}</span>{/if}</span>
      {#if v.spanByEvent.get(r.id)}
        {@const sp = v.spanByEvent.get(r.id)!}
        <span class="oc oc-{sp.outcome}" title={sp.summary} data-testid="span-outcome" data-outcome={sp.outcome}>{outcomeText(sp.outcome, sp.silent)}</span>
      {/if}
      {#if attrs.length > 1 && r.type !== 'key'}
        <button type="button" class="attr" onclick={() => toggle(r.id)} aria-expanded={open.has(r.id)} data-testid="attr-chip">{open.has(r.id) ? 'less' : `+${attrs.length}`}</button>
      {/if}
    </div>
    {#if open.has(r.id)}
      <dl class="attrs" data-testid="attr-list">
        {#each attrs as [k, val] (k)}<dt>{k}</dt><dd>{val}</dd>{/each}
      </dl>
    {/if}
  </div>
{/snippet}

{#if groups}
  <div class="vp-list" bind:this={list} role="list" data-testid="actions-list">
    {#each groups as g (g.n ?? 'loose')}
      {#if g.n !== null}
        {@const at = v.map.toPlayer(g.startedAt)}
        <div class="th" role="listitem" data-testid="trace-group" data-trace={g.n}>
          <button type="button" class="th-head" onclick={() => v.seek(at, { arm: true })} title="Play this trace from its start" data-testid="trace-head">
            <span class="th-name">Trace {g.n}</span>
            <span class="th-meta">{fmtClock(g.durationMs)} · {g.spans} {g.spans === 1 ? 'action' : 'actions'}</span>
            {#each g.quiet as [o, n] (o)}<span class="oc oc-{o}">{n} {o}</span>{/each}
            <span class="th-at">from {fmtClock(at)}</span>
          </button>
          {#if g.note.trim()}<p class="th-note" data-testid="trace-note">{g.note}</p>{/if}
        </div>
      {:else}
        <div class="th" role="listitem" data-testid="trace-group" data-trace="none"><div class="th-head th-static"><span class="th-name">Outside the traces</span></div></div>
      {/if}
      {#each g.rows as { r, i } (r.id)}{@render row(r, i)}{/each}
    {/each}
  </div>
{:else if v.actions.length}
  <div class="vp-list" bind:this={list} role="list" data-testid="actions-list">
    {#each plain as { r, i } (r.id)}{@render row(r, i)}{/each}
  </div>
{/if}

<style>
  /* One truncated line per row, time on the left, as in the console (J-067, J-108). */
  .ar { grid-template-columns: 18px auto minmax(0, 1fr); }
  .main { display: flex; align-items: flex-start; gap: 6px; min-width: 0; padding: 3px 0; }
  .ic { flex: none; color: var(--nb-text-faint); padding-top: 1px; }
  .msg { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { color: var(--nb-accent-text); }
  .attr { all: unset; flex: none; font: var(--nb-weight-medium) 10px var(--nb-font-sans); padding: 0 6px; height: 16px; line-height: 16px; border-radius: 999px; background: var(--nb-surface-sunken); color: var(--nb-text-muted); cursor: pointer; }
  .attr:hover { color: var(--nb-text); }
  .attrs { grid-column: 2 / -1; display: grid; grid-template-columns: max-content 1fr; gap: 1px 10px; margin: 0 0 6px 19px; padding: 6px 8px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-sm); background: var(--nb-surface-2); }
  .attrs dt { color: var(--nb-text-muted); }
  .attrs dd { margin: 0; word-break: break-all; }
  .trace-sum { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 4px; }
  .oc { flex: none; font: 500 10px/16px var(--nb-font-sans); padding: 0 6px; border-radius: 999px; background: var(--nb-surface-sunken); color: var(--nb-text-muted); white-space: nowrap; }
  .oc-changed { background: var(--nb-success-tint); color: var(--nb-success-text); }
  .oc-error, .oc-stuck { background: var(--nb-danger-tint); color: var(--nb-danger-text); }
  .oc-dead, .oc-silent { background: var(--nb-warning-tint); color: var(--nb-warning-text); }
  /* a trace's header (D-214): sans like the outcome line, a sunken band so the rows under it read as its own */
  .th { border-bottom: 1px solid var(--nb-border); background: var(--nb-surface-2); font-family: var(--nb-font-sans); }
  .th-head { all: unset; box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 100%; padding: 6px 10px; cursor: pointer; }
  .th-head:hover .th-name { color: var(--nb-accent-text); }
  .th-static { cursor: default; }
  .th-name { font-weight: var(--nb-weight-medium); font-size: var(--nb-text-md); color: var(--nb-text); }
  .th-meta, .th-at { font-size: var(--nb-text-sm); color: var(--nb-text-muted); font-variant-numeric: tabular-nums; }
  .th-at { margin-left: auto; }
  .th-note { margin: 0 10px 8px; padding: 2px 10px; border-left: 2px solid var(--nb-accent); color: var(--nb-text); font-size: var(--nb-text-md); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  .th-head:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .banner { display: flex; gap: 8px; align-items: center; margin: 8px; padding: 8px 10px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); background: var(--nb-surface-2); color: var(--nb-text); font-size: var(--nb-text-md); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .attr:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
</style>
