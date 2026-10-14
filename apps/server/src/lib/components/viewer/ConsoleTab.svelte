<script lang="ts">
  // Console tab (J-102, J-103, J-104): the merged timeline with a text filter, a level menu and
  // kind chips; hover shows a gutter triangle that seeks and arms a timestamped comment; a row
  // click expands it; the row at the current time is marked while the video plays.
  import { tick } from 'svelte';
  import { filterConsole, fmtClock, fmtValue, fmtWallMs, presentConsoleChips, type ConsoleKindChip, type ConsoleViewRow } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import Dropdown from './Dropdown.svelte';
  import EmptyState from './EmptyState.svelte';
  import { useViewer } from './viewer.svelte.ts';
  import { followPlayback } from './follow.svelte.ts';

  const v = useViewer();
  const LEVELS = [
    { id: 'error', label: 'Errors' },
    { id: 'warn', label: 'Warnings' },
    { id: 'info', label: 'Info' },
    { id: 'log', label: 'Logs' },
    { id: 'debug', label: 'Debug' },
  ] as const;
  type Level = (typeof LEVELS)[number]['id'];

  let q = $state('');
  let levels: Level[] = $state([]);
  let hidden: ConsoleKindChip[] = $state([]);
  let levelMenu = $state(false);
  let expanded = $state(new Set<string>());
  let flash: string | null = $state(null);
  let list: HTMLDivElement | undefined = $state();

  const chips = $derived(presentConsoleChips(v.consoleRows));
  const rows = $derived(filterConsole(v.consoleRows, { q, levels, hidden }));
  const follow = followPlayback(() => list, () => rows, v);
  const tz = $derived(v.prefs.timeZone === 'utc' ? 'UTC' : v.prefs.timeZone === 'capture' ? (v.detail.env?.tz ?? undefined) : undefined);

  function toggleLevel(l: Level) {
    levels = levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l];
  }
  function toggleChip(c: ConsoleKindChip) {
    hidden = hidden.includes(c) ? hidden.filter((x) => x !== c) : [...hidden, c];
  }
  function toggleRow(id: string) {
    const s = new Set(expanded);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    expanded = s;
  }
  const icon = (r: ConsoleViewRow) =>
    r.kind === 'navigation' ? 'external' : r.kind === 'click' ? 'select' : r.kind === 'input' ? 'text' : r.kind === 'media' ? 'record' : r.kind === 'network' ? 'network' : r.level === 'error' ? 'warning' : r.level === 'warn' ? 'warning' : 'info';

  // Marker clicks and "open in console" requests (J-095).
  $effect(() => {
    const f = v.focus;
    if (!f || f.tab !== 'console') return;
    q = '';
    levels = [];
    hidden = [];
    void tick().then(() => {
      const row = list?.querySelector<HTMLElement>(`[data-id="${CSS.escape(f.id)}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'center' });
      flash = f.id;
      setTimeout(() => (flash = null), 1600);
    });
  });
</script>

{#if v.detail.source === 'recording-link' && !v.consoleRows.length}
  <EmptyState icon="console" title="No logs for recording-link captures yet" body="Recording links capture video only. Logs come with the extension, or when the recorder runs on your own domain." action={{ label: 'How to set it up', href: '/settings/integrations' }} />
{:else}
  <div class="vp-bar">
    <label class="vp-search"><VIcon name="search" size={14} /><input type="text" placeholder="Filter" bind:value={q} aria-label="Filter console" data-testid="console-filter" /></label>
    <Dropdown open={levelMenu} onclose={() => (levelMenu = false)}>
      {#snippet trigger()}
        <button type="button" class="vp-chip" onclick={() => (levelMenu = !levelMenu)} aria-haspopup="menu" data-testid="level-menu">
          {levels.length ? levels.map((l) => LEVELS.find((x) => x.id === l)!.label).join(', ') : 'All levels'}<VIcon name="chevron-down" size={12} />
        </button>
      {/snippet}
      <div class="levels" role="menu">
        {#each LEVELS as l (l.id)}
          <label class="lv"><input type="checkbox" checked={levels.includes(l.id)} onchange={() => toggleLevel(l.id)} />{l.label}</label>
        {/each}
      </div>
    </Dropdown>
    {#each chips as c (c.id)}
      <button type="button" class="vp-chip toggle" class:off={hidden.includes(c.id)} aria-pressed={!hidden.includes(c.id)} onclick={() => toggleChip(c.id)} data-testid="chip-{c.id}">{c.label}</button>
    {/each}
  </div>

  <div class="vp-list" bind:this={list} role="list" data-testid="console-list">
    {#if !v.eventsLoaded}
      <div class="vp-note">Loading logs</div>
    {:else if !v.consoleRows.length}
      <div class="vp-note">Nothing was logged during this capture.</div>
    {:else if !rows.length}
      <div class="vp-striped">No rows match these filters.</div>
    {/if}
    {#each rows as r, i (r.id)}
      {@const open = expanded.has(r.id)}
      <div
        class="vp-row cr lvl-{r.level} kind-{r.kind}"
        class:future={v.playable && r.at > v.now + 1}
        class:current={follow.current === i && v.playable}
        class:flash={flash === r.id}
        data-id={r.id}
        data-row-index={i}
        role="listitem">
        <button type="button" class="vp-gutter" onclick={() => v.seek(r.at, { arm: true })} aria-label="Seek to {fmtClock(r.at)}" title="Play from here"><VIcon name="play" size={10} /></button>
        <button type="button" class="main" onclick={() => toggleRow(r.id)} aria-expanded={open}>
          <span class="ic"><VIcon name={icon(r) as never} size={13} /></span>
          <span class="msg" class:wrap={open}>{r.message}</span>
          {#if r.count > 1}<span class="count">{r.count}</span>{/if}
        </button>
        <span class="vp-time" title={fmtWallMs(r.t, tz)}>{fmtClock(r.at)}</span>
        {#if open}
          <div class="detail">
            {#if r.args?.length}
              {#each r.args as a, j (j)}<pre>{typeof a === 'object' && a !== null ? JSON.stringify(a, null, 2) : fmtValue(a)}</pre>{/each}
            {/if}
            {#if r.stack}<pre class="stack">{r.stack}</pre>{/if}
            {#if r.source}<div class="src">{r.source.fn ?? 'anonymous'} at <a href={r.source.url} target="_blank" rel="noopener noreferrer">{r.source.url.split('/').pop()}:{r.source.line}:{r.source.col}</a></div>{/if}
            {#if r.kind === 'network' && r.rid}<button type="button" class="link" onclick={() => { v.selectedRid = r.rid!; v.reveal('network', r.rid!); }}>Open in network</button>{/if}
            {#if r.kind === 'click' && r.target}<pre>{r.target.selector}</pre>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .levels { display: flex; flex-direction: column; min-width: 150px; padding: 6px; border-radius: var(--nb-radius-md); background: var(--nb-surface); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-md); }
  .lv { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 4px; cursor: pointer; font-size: var(--nb-text-md); }
  .lv:hover { background: var(--nb-surface-sunken); }
  .cr { grid-template-columns: 18px minmax(0, 1fr) auto; }
  .main { all: unset; display: flex; align-items: flex-start; gap: 6px; min-width: 0; cursor: pointer; padding: 3px 0; }
  .ic { display: inline-flex; padding-top: 1px; color: var(--nb-text-faint); }
  .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg.wrap { white-space: pre-wrap; word-break: break-word; }
  .count { font-size: 10px; padding: 0 5px; border-radius: 999px; background: var(--nb-surface-sunken); }
  .detail { grid-column: 2 / -1; padding: 0 0 6px 19px; display: flex; flex-direction: column; gap: 4px; }
  .detail pre { margin: 0; padding: 6px 8px; border-radius: 6px; background: var(--nb-surface-sunken); white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow: auto; }
  .stack { color: var(--nb-danger); }
  .src { color: var(--nb-text-muted); }
  .link { all: unset; color: var(--nb-accent-text); cursor: pointer; text-decoration: underline; }
  .lvl-error .ic, .lvl-error .msg { color: var(--nb-danger); }
  .lvl-warn .ic { color: var(--nb-warning); }
</style>
