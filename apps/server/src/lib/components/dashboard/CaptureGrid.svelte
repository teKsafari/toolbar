<script lang="ts">
  // The capture grid (J-158) with filters from the URL (J-160), skeletons while loading (J-207),
  // empty and no-result states (J-203, J-204), selection mode (J-165), drag to folders (J-166) and
  // drop-a-video upload (J-020). Three columns at desktop width, fewer as the window narrows.
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import type { Snippet } from 'svelte';
  import { toasts } from '@toolbar/ui';
  import type { CaptureSummary, Folder, Page } from '@toolbar/shared/api';
  import { MAX_UPLOAD_VIDEO_BYTES, filtersFromParams, kindsOf } from '@toolbar/shared/areas/dashboard';
  import CaptureCard from './CaptureCard.svelte';
  import SelectionBar from './SelectionBar.svelte';
  import Skeleton from './Skeleton.svelte';
  import DIcon from './DIcon.svelte';
  import { api, errMsg, urlOf } from './api.ts';
  import { shell } from './shell.svelte.ts';

  interface Props {
    /** "none" for the main grid (unfiled captures), a folder id, or "all" */
    folderId: string;
    workspaceId: string | null;
    folders: Folder[];
    canEdit: boolean;
    /** the header row (title, filter bar); replaced by the selection bar while cards are ticked */
    header: Snippet<[{ total: number | null; loading: boolean }]>;
    /** nothing here at all, no filters set */
    empty: Snippet;
  }
  let { folderId, workspaceId, folders, canEdit, header, empty }: Props = $props();

  let items = $state<CaptureSummary[]>([]);
  let total = $state<number | null>(null);
  let cursor = $state<string | null>(null);
  let hasMore = $state(false);
  let loading = $state(true);
  let more = $state(false);
  let selected = $state<string[]>([]);
  let lastClicked: string | null = null;
  let dropping = $state(false);
  let uploading = $state<{ name: string; pct: number } | null>(null);
  let sentinel: HTMLElement | undefined = $state();

  const filters = $derived(filtersFromParams(page.url.searchParams));
  const filtered = $derived(filters.types.length + filters.sources.length + filters.authors.length > 0 || !!filters.link);
  const query = $derived({
    workspaceId,
    folderId: filters.link ? 'all' : folderId,
    kinds: kindsOf(filters.types),
    sources: filters.sources,
    authors: filters.authors,
    recordingLinkId: filters.link,
    limit: 30,
  });

  let seq = 0;
  async function load(reset: boolean) {
    const mine = ++seq;
    if (reset) {
      loading = true;
      cursor = null;
    } else more = true;
    try {
      const r = await api<Page<CaptureSummary>>('captures.list', { query: { ...query, cursor: reset ? undefined : cursor } });
      if (mine !== seq) return;
      items = reset ? r.items : [...items, ...r.items];
      total = r.total ?? null;
      cursor = r.nextCursor;
      hasMore = r.hasMore;
    } catch (e) {
      if (mine === seq) toasts.error(errMsg(e));
    } finally {
      if (mine === seq) {
        loading = false;
        more = false;
      }
    }
  }

  $effect(() => {
    // reload when the query or the reload counter changes
    void JSON.stringify(query);
    void shell.reloadTick;
    selected = [];
    void load(true);
  });

  $effect(() => {
    if (!sentinel || !hasMore) return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting) && !more && !loading) void load(false);
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  function toggle(id: string, shift: boolean) {
    if (shift && lastClicked && selected.length) {
      const a = items.findIndex((c) => c.id === lastClicked);
      const b = items.findIndex((c) => c.id === id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const range = items.slice(lo, hi + 1).map((c) => c.id);
      selected = [...new Set([...selected, ...range])];
    } else selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    lastClicked = id;
  }

  const dragIds = (id: string) => () => (selected.includes(id) ? selected : [id]);

  // ---------- J-020 upload ----------
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  function over(e: DragEvent) {
    if (!canEdit || !hasFiles(e)) return;
    e.preventDefault();
    dropping = true;
  }
  function leave(e: DragEvent) {
    if (e.currentTarget === e.target || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) dropping = false;
  }
  async function drop(e: DragEvent) {
    if (!canEdit || !hasFiles(e)) return;
    e.preventDefault();
    dropping = false;
    const file = e.dataTransfer?.files[0];
    if (file) await upload(file);
  }

  export async function upload(file: File) {
    if (!/^video\//.test(file.type) && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      toasts.error('Only video files can be uploaded (MP4, WebM or MOV)');
      return;
    }
    if (file.size > MAX_UPLOAD_VIDEO_BYTES) {
      toasts.error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(0)} MB; videos are limited to 200 MB`);
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    if (workspaceId) fd.set('workspaceId', workspaceId);
    if (folderId !== 'none' && folderId !== 'all') fd.set('folderId', folderId);
    uploading = { name: file.name, pct: 0 };
    const tid = toasts.loading(`Uploading ${file.name}`);
    try {
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', urlOf('captures.uploadVideo'));
        x.upload.onprogress = (ev) => ev.lengthComputable && uploading && (uploading.pct = Math.round((ev.loaded / ev.total) * 100));
        x.onload = () => {
          if (x.status >= 200 && x.status < 300) resolve();
          else {
            let m = `Upload failed (${x.status})`;
            try {
              m = JSON.parse(x.responseText).message ?? m;
            } catch {
              /* keep */
            }
            reject(new Error(m));
          }
        };
        x.onerror = () => reject(new Error('Upload failed: network error'));
        x.send(fd);
      });
      toasts.update(tid, { kind: 'success', message: `${file.name} uploaded; it plays once processing ends` });
      await load(true);
      void invalidate('nib:shell');
    } catch (err) {
      toasts.update(tid, { kind: 'error', message: errMsg(err) });
    } finally {
      uploading = null;
    }
  }

  const currentFolder = $derived(folderId === 'none' ? null : folderId === 'all' ? undefined : folderId);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="wrap" ondragover={over} ondragleave={leave} ondrop={drop}>
  {#if selected.length}
    <SelectionBar ids={selected} {folders} currentFolder={currentFolder ?? null} {workspaceId} onclear={() => (selected = [])} />
  {:else}
    {@render header({ total, loading })}
  {/if}

  {#if uploading}
    <div class="up" data-testid="upload-progress"><DIcon name="upload" size={16} /> Uploading {uploading.name}: {uploading.pct}%<span class="ub"><span style="width:{uploading.pct}%"></span></span></div>
  {/if}

  {#if loading}
    <div class="grid" aria-busy="true" data-testid="grid-skeleton">
      {#each Array(6) as _, i (i)}
        <div class="skc"><Skeleton h="auto" r="12px" w="100%" /><div class="skm"><Skeleton w="55%" /><Skeleton w="18%" /></div></div>
      {/each}
    </div>
  {:else if !items.length}
    {#if filtered}
      <div class="nores" data-testid="no-results">
        <p>No captures match these filters.</p>
        <p class="muted">Change or clear a filter to see more.</p>
      </div>
    {:else}
      {@render empty()}
    {/if}
  {:else}
    <div class="grid" data-testid="capture-grid">
      {#each items as c (c.id)}
        <CaptureCard {c} selected={selected.includes(c.id)} selecting={selected.length > 0} ontoggle={toggle} dragIds={dragIds(c.id)} />
      {/each}
    </div>
    {#if hasMore}<div class="more" bind:this={sentinel}>{#if more}<DIcon name="spinner" size={18} />{/if}</div>{/if}
  {/if}

  {#if dropping}
    <div class="drop" data-testid="drop-overlay">
      <DIcon name="upload" size={28} />
      <strong>Drop a video to upload it</strong>
      <span>MP4, WebM or MOV up to 200 MB. It becomes a capture with no logs.</span>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; min-height: 60vh; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px 20px; }
  @media (max-width: 1100px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 600px) { .grid { grid-template-columns: minmax(0, 1fr); gap: 18px; } }
  .skc > :global(.sk:first-child) { aspect-ratio: 16 / 10; }
  .skm { display: flex; justify-content: space-between; margin-top: 10px; }
  .nores { display: grid; place-items: center; padding: 72px 16px; text-align: center; gap: 2px; }
  .nores p { margin: 0; }
  .more { display: grid; place-items: center; height: 60px; color: var(--nb-text-faint); }
  .drop {
    position: absolute; inset: -8px; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
    border: 2px dashed var(--nb-accent); border-radius: var(--nb-radius-xl); background: color-mix(in srgb, var(--nb-surface) 88%, transparent);
    color: var(--nb-accent-text); text-align: center; pointer-events: none;
  }
  .drop span { color: var(--nb-text-muted); font-size: var(--nb-text-md); }
  .up { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  .ub { flex: 0 0 160px; height: 4px; border-radius: 4px; background: var(--nb-surface-sunken); overflow: hidden; }
  .ub span { display: block; height: 100%; background: var(--nb-accent); }
</style>
