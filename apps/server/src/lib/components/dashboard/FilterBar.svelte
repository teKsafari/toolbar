<script lang="ts">
  // J-160: type, source and creator filters; a chosen value becomes a chip with a clear button.
  // State lives in the URL so it survives a reload. The search box opens the palette (J-161).
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { CAPTURE_SOURCES, type Member } from '@toolbar/shared/api';
  import { SOURCE_LABELS, TYPE_FILTERS, filtersFromParams, filtersToParams, type GridFilters } from '@toolbar/shared/areas/dashboard';
  import DIcon from './DIcon.svelte';
  import MultiSelect from './MultiSelect.svelte';
  import { shell } from './shell.svelte.ts';

  let { members, linkName = null }: { members: Member[]; linkName?: string | null } = $props();
  const f = $derived(filtersFromParams(page.url.searchParams));

  function set(next: Partial<GridFilters>) {
    const p = filtersToParams({ ...f, ...next }, page.url.searchParams);
    const qs = p.toString();
    void goto(`${page.url.pathname}${qs ? `?${qs}` : ''}`, { keepFocus: true, noScroll: true, replaceState: false });
  }

  const typeLabel = (v: string) => TYPE_FILTERS.find((t) => t.value === v)?.label ?? v;
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.person.name ?? 'Someone';
  const chips = $derived([
    ...f.types.map((v) => ({ key: `t:${v}`, label: typeLabel(v), clear: () => set({ types: f.types.filter((x) => x !== v) }) })),
    ...f.sources.map((v) => ({ key: `s:${v}`, label: SOURCE_LABELS[v], clear: () => set({ sources: f.sources.filter((x) => x !== v) }) })),
    ...f.authors.map((v) => ({ key: `a:${v}`, label: `By ${nameOf(v)}`, clear: () => set({ authors: f.authors.filter((x) => x !== v) }) })),
    ...(f.link ? [{ key: 'l', label: `Via ${linkName ?? 'recording link'}`, clear: () => set({ link: null }) }] : []),
  ]);
</script>

<div class="bar" data-testid="filter-bar">
  <div class="left">
    <MultiSelect label="Type" testid="filter-type" searchable={false} options={TYPE_FILTERS.map((t) => ({ value: t.value, label: t.label }))} selected={f.types} onchange={(v) => set({ types: v as GridFilters['types'] })} />
    <MultiSelect label="Source" testid="filter-source" searchable={false} options={CAPTURE_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))} selected={f.sources} onchange={(v) => set({ sources: v as GridFilters['sources'] })} />
    <MultiSelect
      label="Creator"
      testid="filter-creator"
      options={members.map((m) => ({ value: m.userId, label: m.person.name, sub: m.person.email ?? undefined, avatar: { name: m.person.name, image: m.person.image } }))}
      selected={f.authors}
      onchange={(v) => set({ authors: v })}
    />
    {#each chips as c (c.key)}
      <span class="chip" data-testid="filter-chip">{c.label}<button aria-label="Clear {c.label}" onclick={c.clear}><DIcon name="close" size={11} /></button></span>
    {/each}
  </div>
  <button class="search" onclick={() => (shell.paletteOpen = true)} aria-label="Search"><DIcon name="search" size={15} /><span>Search</span><kbd>Ctrl K</kbd></button>
</div>

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
  .left { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px; border-radius: var(--nb-radius-pill);
    background: var(--nb-accent-tint); color: var(--nb-accent-text); font-size: var(--nb-text-md); animation: chip-in var(--nb-dur-med) var(--nb-ease-out);
  }
  .chip button { all: unset; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; }
  .chip button:hover { background: rgb(0 0 0 / 0.08); }
  .chip button:focus-visible { outline: 2px solid var(--nb-focus); }
  @keyframes chip-in { from { opacity: 0; transform: translateX(-6px); } }
  .search {
    all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; min-width: 200px;
    border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); color: var(--nb-text-faint); cursor: text; font-size: var(--nb-text-md);
  }
  .search span { flex: 1; }
  .search:focus-visible { outline: 2px solid var(--nb-focus); }
  kbd { font: 11px var(--nb-font-mono); }
  @media (max-width: 860px) { .search { display: none; } }
  @media (prefers-reduced-motion: reduce) { .chip { animation: none; } }
</style>
