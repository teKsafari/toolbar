<script lang="ts">
  // J-161, J-228: Ctrl+K (or the header search box) opens a centred palette. Empty: recently
  // viewed captures. Typing: live results grouped as members, folders and captures, a preview of
  // the highlighted capture with the matched text, arrows to move, Enter to open, Ctrl+C to copy
  // the link, Escape to close. The footer shows the count and what Enter will do.
  import EmbedMark from '../EmbedMark.svelte';
  import { goto } from '$app/navigation';
  import { toasts } from '@toolbar/ui';
  import type { CaptureSummary, SearchResult } from '@toolbar/shared/api';
  import { durationLabel, fallbackTitle, relativeTime } from '@toolbar/shared/areas/dashboard';
  import DIcon from './DIcon.svelte';
  import UserAvatar from './UserAvatar.svelte';
  import Skeleton from './Skeleton.svelte';
  import { api, copyText } from './api.ts';
  import { shell } from './shell.svelte.ts';

  let { workspaceId }: { workspaceId: string | null } = $props();

  type Row =
    | { type: 'member'; key: string; label: string; sub: string; href: string; image: string | null }
    | { type: 'folder'; key: string; label: string; sub: string; href: string; url: string }
    | { type: 'capture'; key: string; label: string; sub: string; href: string; url: string; c: CaptureSummary & { match?: SearchResult['captures'][number]['match'] } };

  let dialog: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let q = $state('');
  let loading = $state(false);
  let recentRows = $state<Row[] | null>(null);
  let result = $state<SearchResult | null>(null);
  let active = $state(0);
  let seq = 0;

  const capRow = (c: CaptureSummary & { match?: SearchResult['captures'][number]['match'] }): Row => ({
    type: 'capture',
    key: `c:${c.id}`,
    label: fallbackTitle(c),
    sub: `${c.authorName ?? 'Guest'}${c.authorVerified ? '' : ' (embed)'} · ${relativeTime(c.createdAt)}`,
    href: `/c/${c.id}`,
    url: c.url,
    c,
  });

  const rows = $derived.by<Row[]>(() => {
    if (!q.trim()) return recentRows ?? [];
    if (!result) return [];
    return [
      ...result.members.map<Row>((m) => ({
        type: 'member',
        key: `m:${m.userId}`,
        label: m.person.name,
        sub: m.person.email ?? '',
        href: `/?by=${m.userId}`,
        image: m.person.image,
      })),
      ...result.folders.map<Row>((f) => ({ type: 'folder', key: `f:${f.id}`, label: f.name, sub: f.captureCount === 1 ? '1 capture' : `${f.captureCount} captures`, href: `/f/${f.shortId}`, url: `${location.origin}/f/${f.shortId}` })),
      ...result.captures.map(capRow),
    ];
  });
  const current = $derived(rows[active] ?? null);
  const groups = $derived.by(() => {
    const g: { label: string; items: { row: Row; i: number }[] }[] = [];
    rows.forEach((row, i) => {
      const label = !q.trim() ? 'Recently viewed' : row.type === 'member' ? 'Members' : row.type === 'folder' ? 'Folders' : 'Captures';
      const last = g[g.length - 1];
      if (last?.label === label) last.items.push({ row, i });
      else g.push({ label, items: [{ row, i }] });
    });
    return g;
  });
  const enterHint = $derived(!current ? '' : current.type === 'member' ? 'Show their captures' : current.type === 'folder' ? 'Open folder' : 'Open capture');
  const count = $derived(q.trim() ? (result?.total ?? 0) : rows.length);

  $effect(() => {
    if (!dialog) return;
    if (shell.paletteOpen && !dialog.open) {
      dialog.showModal();
      q = '';
      result = null;
      active = 0;
      queueMicrotask(() => input?.focus());
      void loadRecent();
    } else if (!shell.paletteOpen && dialog.open) dialog.close();
  });

  async function loadRecent() {
    recentRows = null;
    try {
      const r = await api<{ items: CaptureSummary[] }>('search.recent', { query: { workspaceId, limit: 8 } });
      recentRows = r.items.map(capRow);
    } catch {
      recentRows = [];
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  function onInput() {
    active = 0;
    clearTimeout(timer);
    if (!q.trim()) {
      result = null;
      loading = false;
      return;
    }
    loading = true;
    const mine = ++seq;
    timer = setTimeout(async () => {
      try {
        const r = await api<SearchResult>('search.query', { query: { q: q.trim(), workspaceId, limit: 20 } });
        if (mine === seq) result = r;
      } catch {
        if (mine === seq) result = { members: [], folders: [], captures: [], total: 0 };
      } finally {
        if (mine === seq) loading = false;
      }
    }, 150);
  }

  function go(row: Row | null) {
    if (!row) return;
    shell.paletteOpen = false;
    void goto(row.href);
  }

  async function copy(row: Row | null) {
    if (!row || row.type === 'member') return;
    if (await copyText(row.url)) toasts.success('Link copied');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(rows.length - 1, active + 1);
      scrollActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(0, active - 1);
      scrollActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(current);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const el = input;
      if (el && el.selectionStart !== el.selectionEnd) return; // copying typed text
      e.preventDefault();
      void copy(current);
    }
  }

  function scrollActive() {
    queueMicrotask(() => dialog?.querySelector(`[data-row-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  function global(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      shell.paletteOpen = !shell.paletteOpen;
    }
  }

  function highlight(text: string, needle: string) {
    const i = text.toLowerCase().indexOf(needle.toLowerCase());
    if (!needle || i < 0) return [{ t: text, hit: false }];
    return [
      { t: text.slice(0, i), hit: false },
      { t: text.slice(i, i + needle.length), hit: true },
      { t: text.slice(i + needle.length), hit: false },
    ];
  }
  const fieldLabel: Record<string, string> = {
    title: 'Title',
    description: 'Description',
    comment: 'Comment',
    transcript: 'Transcript',
    url: 'Page URL',
    issue: 'Linked issue',
    author: 'Creator',
    id: 'Capture id',
  };
</script>

<svelte:window onkeydown={global} />

<dialog
  bind:this={dialog}
  class="pal"
  aria-label="Search"
  data-testid="palette"
  onclose={() => (shell.paletteOpen = false)}
  onclick={(e) => e.target === dialog && (shell.paletteOpen = false)}
>
  <div class="box">
    <div class="field">
      <DIcon name="search" size={18} />
      <input
        bind:this={input}
        bind:value={q}
        oninput={onInput}
        onkeydown={onKey}
        placeholder="Search captures, people and folders"
        aria-label="Search captures, people and folders"
        aria-controls="pal-list"
        aria-activedescendant={current ? `pal-${current.key}` : undefined}
        role="combobox"
        aria-expanded="true"
        data-testid="palette-input"
      />
      {#if loading}<DIcon name="spinner" size={16} />{/if}
      <kbd>Esc</kbd>
    </div>
    <div class="split">
      <div class="list" id="pal-list" role="listbox" aria-label="Results">
        {#if !q.trim() && recentRows === null}
          {#each [0, 1, 2, 3, 4] as i (i)}
            <div class="skrow" data-testid="palette-skeleton"><Skeleton w="44px" h="28px" /><span class="col"><Skeleton w="60%" /><Skeleton w="35%" h="10px" /></span></div>
          {/each}
        {:else if q.trim() && !loading && result && !rows.length}
          <div class="none" data-testid="palette-empty">
            <DIcon name="search" size={28} />
            <strong>Nothing matches "{q.trim()}"</strong>
            <span>Try a title, a person, a folder, a comment or paste a capture link.</span>
          </div>
        {:else if !q.trim() && !rows.length}
          <div class="none"><span>Captures you open show up here.</span></div>
        {:else}
          {#each groups as g (g.label)}
            <div class="glabel">{g.label}</div>
            {#each g.items as { row, i } (row.key)}
              <div
                id="pal-{row.key}"
                role="option"
                tabindex="-1"
                aria-selected={i === active}
                class="row"
                class:on={i === active}
                data-row-index={i}
                data-row-type={row.type}
                onmousemove={() => (active = i)}
                onclick={() => go(row)}
                onkeydown={() => {}}
              >
                {#if row.type === 'member'}
                  <UserAvatar name={row.label} image={row.image} size={28} />
                  <span class="lab">{row.label}</span>
                  <span class="email">{row.sub}</span>
                {:else if row.type === 'folder'}
                  <span class="ic"><DIcon name="folder" size={16} /></span>
                  <span class="col"><span class="lab">{row.label}</span><span class="sub">{row.sub}</span></span>
                {:else}
                  <span class="thumb">
                    {#if row.c.thumbUrl}<img src={row.c.thumbUrl} alt="" loading="lazy" />{:else}<DIcon name={row.c.kind === 'screenshot' ? 'image' : 'video'} size={14} />{/if}
                  </span>
                  <span class="col"><span class="lab">{row.label}</span><span class="sub">{row.sub}</span></span>
                {/if}
              </div>
            {/each}
          {/each}
        {/if}
      </div>
      {#if current?.type === 'capture'}
        {@const c = current.c}
        <aside class="preview" data-testid="palette-preview">
          <div class="pthumb">
            {#if c.thumbUrl}<img src={c.thumbUrl} alt="" />{:else}<DIcon name={c.kind === 'screenshot' ? 'image' : 'video'} size={28} />{/if}
            {#if durationLabel(c.durationMs) && c.kind !== 'screenshot'}<span class="dur">{durationLabel(c.durationMs)}</span>{/if}
          </div>
          <strong class="ptitle">{fallbackTitle(c)}</strong>
          <span class="sub">{c.authorName ?? 'Guest'}{#if !c.authorVerified}<EmbedMark />{/if} · {relativeTime(c.createdAt)}</span>
          {#if c.pageUrl}<span class="purl">{c.pageUrl}</span>{/if}
          {#if c.match && q.trim()}
            <div class="match">
              <span class="mf">{fieldLabel[c.match.field] ?? c.match.field}</span>
              <p>{#each highlight(c.match.snippet, q.trim()) as part, k (k)}{#if part.hit}<mark>{part.t}</mark>{:else}{part.t}{/if}{/each}</p>
            </div>
          {/if}
        </aside>
      {/if}
    </div>
    <div class="foot">
      <span data-testid="palette-count">{count} {count === 1 ? 'result' : 'results'}</span>
      <span class="hints">
        {#if current && current.type !== 'member'}<span><kbd>Ctrl C</kbd> Copy link</span>{/if}
        {#if enterHint}<span data-testid="palette-enter-hint"><kbd>Enter</kbd> {enterHint}</span>{/if}
      </span>
    </div>
  </div>
</dialog>

<style>
  .pal {
    width: min(1000px, calc(100vw - 24px)); max-height: min(640px, calc(100vh - 80px)); margin-top: 10vh; padding: 0;
    border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); color: var(--nb-text);
    box-shadow: var(--nb-shadow-lg); overflow: hidden;
  }
  .pal::backdrop { background: var(--nb-overlay); }
  .box { display: flex; flex-direction: column; max-height: inherit; }
  .field { display: flex; align-items: center; gap: 10px; padding: 0 16px; border-bottom: 1px solid var(--nb-border); color: var(--nb-text-faint); }
  .field input { flex: 1; height: 52px; border: 0; background: transparent; color: var(--nb-text); font-size: var(--nb-text-lg); letter-spacing: var(--nb-tracking-ui); outline: none; padding: 0; box-shadow: none; }
  .field input:focus-visible { box-shadow: none; }
  kbd { font: var(--nb-text-xs) var(--nb-font-mono); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--nb-border); background: var(--nb-surface-2); color: var(--nb-text-faint); }
  .split { display: flex; min-height: 280px; overflow: hidden; flex: 1; }
  .list { flex: 1; overflow-y: auto; padding: 6px; min-width: 0; }
  .glabel { padding: 10px 10px 6px; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  .row { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: var(--nb-radius-md); cursor: pointer; min-height: 40px; }
  .row.on { background: var(--nb-accent-tint); }
  .lab { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .email { margin-left: auto; color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
  .col { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 3px; }
  .sub { font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  /* the selected row sits on accent-tint: secondary text takes text-muted there (D-178, D-181) */
  .row.on .sub, .row.on .email { color: var(--nb-text-muted); }
  .ic { display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--nb-radius-md); background: var(--nb-surface-sunken); color: var(--nb-text-muted); }
  .thumb { display: grid; place-items: center; width: 44px; height: 28px; border-radius: 4px; overflow: hidden; background: var(--nb-surface-sunken); color: var(--nb-text-faint); flex: none; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .skrow { display: flex; align-items: center; gap: 10px; padding: 8px 10px; }
  .none { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 48px 16px; color: var(--nb-text-muted); text-align: center; }
  .none strong { color: var(--nb-text); }
  .preview { width: 340px; flex: none; border-left: 1px solid var(--nb-border); padding: 16px; display: flex; flex-direction: column; gap: 6px; overflow-y: auto; }
  .pthumb { position: relative; aspect-ratio: 16 / 10; border-radius: var(--nb-radius-md); overflow: hidden; background: var(--nb-surface-sunken); display: grid; place-items: center; color: var(--nb-text-faint); }
  .pthumb img { width: 100%; height: 100%; object-fit: cover; }
  .dur { position: absolute; right: 6px; bottom: 6px; padding: 1px 6px; border-radius: var(--nb-radius-pill); background: rgb(11 11 11 / 0.66); color: #fafafa; font: var(--nb-text-xs) var(--nb-font-mono); font-variant-numeric: tabular-nums; }
  .ptitle { margin-top: 4px; font-weight: var(--nb-weight-medium); letter-spacing: var(--nb-tracking-ui); }
  .purl { font-size: var(--nb-text-sm); color: var(--nb-text-muted); overflow-wrap: anywhere; }
  .match { margin-top: 6px; padding: 8px 10px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); }
  .match p { margin: 4px 0 0; font-size: var(--nb-text-md); }
  .mf { font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  mark { background: var(--nb-capture-tint); color: inherit; border-radius: 2px; padding: 0 1px; }
  .foot { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--nb-border); font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .hints { display: inline-flex; gap: 14px; }
  @media (max-width: 720px) {
    .preview { display: none; }
    .pal { margin-top: 12px; }
  }
</style>
