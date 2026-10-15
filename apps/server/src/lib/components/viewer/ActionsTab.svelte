<script lang="ts">
  // Actions tab (J-108): clicks, typing, keys and navigations, the same row format as the
  // console, no filter bar; the attribute chip expands into a list (J-067).
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
{#if v.actions.length}
  <div class="vp-list" bind:this={list} role="list" data-testid="actions-list">
    {#each v.actions as r, i (r.id)}
      {@const attrs = targetAttributes(r.target)}
      <div class="vp-row ar" class:kind-navigation={r.type === 'navigation'} class:future={v.playable && r.at > v.now + 1} class:current={follow.current === i && v.playable} data-row-index={i} role="listitem">
        <button type="button" class="vp-gutter" onclick={() => v.seek(r.at, { arm: true })} aria-label="Seek to {fmtClock(r.at)}" title="Play from here"><VIcon name="play" size={10} /></button>
        <span class="vp-time" title={fmtWallMs(r.t, tz)}>{fmtClock(r.at)}</span>
        <div class="main">
          <span class="ic"><VIcon name={(r.type === 'navigation' ? 'external' : r.type === 'input' || r.type === 'key' ? 'text' : 'select') as never} size={13} /></span>
          <span class="msg" title={r.type === 'navigation' ? r.url : undefined}>{text(r)}{#if r.target && r.type !== 'navigation' && r.type !== 'key'}{' '}<span class="tag">{describeTarget(r.target)}</span>{/if}</span>
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
    {/each}
  </div>
{/if}

<style>
  /* One truncated line per row, time on the left, as in the console (J-067, J-108). */
  .ar { grid-template-columns: 18px auto minmax(0, 1fr); }
  .main { display: flex; align-items: flex-start; gap: 6px; min-width: 0; padding: 3px 0; }
  .ic { flex: none; color: var(--nb-text-faint); padding-top: 1px; }
  .msg { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { color: var(--nb-accent-text); }
  .attr { all: unset; flex: none; font: 10px var(--nb-font-sans); padding: 0 6px; height: 16px; line-height: 16px; border-radius: 999px; background: var(--nb-surface-sunken); color: var(--nb-text-muted); cursor: pointer; }
  .attrs { grid-column: 2 / -1; display: grid; grid-template-columns: max-content 1fr; gap: 1px 10px; margin: 0 0 6px 19px; padding: 6px 8px; border-radius: 6px; background: var(--nb-surface-sunken); }
  .attrs dt { color: var(--nb-text-muted); }
  .attrs dd { margin: 0; word-break: break-all; }
  .banner { display: flex; gap: 8px; align-items: center; margin: 8px; padding: 8px 10px; border-radius: var(--nb-radius-md); background: var(--nb-info-tint); color: var(--nb-text); font-size: var(--nb-text-md); }
</style>
