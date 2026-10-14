<script lang="ts">
  // Recording links (J-167, J-223, J-126, J-241): rows with a thumbnail mosaic, name with an
  // in-place rename, creator, uses, a folder chip that retargets the link, share (copy), open the
  // captures made through it, and delete. Status, sort and creator filters; a new-link popover.
  import { invalidate } from '$app/navigation';
  import { Button, Popover, toasts } from '@toolbar/ui';
  import type { Page, RecordingLink } from '@toolbar/shared/api';
  import { relativeTime } from '@toolbar/shared/areas/dashboard';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import UserAvatar from '#lib/components/dashboard/UserAvatar.svelte';
  import FolderPicker from '#lib/components/dashboard/FolderPicker.svelte';
  import MultiSelect from '#lib/components/dashboard/MultiSelect.svelte';
  import Confirm from '#lib/components/dashboard/Confirm.svelte';
  import { api, copyText, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  const ws = $derived(data.activeWorkspaceId);
  const canEdit = $derived(!!data.activeWorkspace && data.activeWorkspace.role !== 'viewer');
  const isAdmin = $derived(data.activeWorkspace?.role === 'admin');

  let status = $state<'active' | 'revoked' | 'all'>('active');
  let sort = $state<'newest' | 'oldest' | 'most-used' | 'name'>('newest');
  let creators = $state<string[]>([]);
  let links = $state<RecordingLink[]>([]);
  let loading = $state(true);
  let editing = $state<string | null>(null);
  let editName = $state('');
  let toDelete = $state<RecordingLink | null>(null);

  // new-link popover
  let newOpen = $state(false);
  let newName = $state('');
  let newFolder = $state<string>('');
  let newRef = $state('');
  let creating = $state(false);

  let seq = 0;
  async function load() {
    if (!ws) return;
    const mine = ++seq;
    loading = true;
    try {
      const r = await api<Page<RecordingLink>>('recordingLinks.list', { params: { workspaceId: ws }, query: { status, sort, creators, limit: 200 } });
      if (mine === seq) links = r.items;
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      if (mine === seq) loading = false;
    }
  }
  $effect(() => {
    void status;
    void sort;
    void creators.length;
    void load();
  });

  const replace = (l: RecordingLink) => (links = links.map((x) => (x.id === l.id ? l : x)));
  const mayChange = (l: RecordingLink) => isAdmin || (canEdit && l.createdBy?.id === data.user.id);

  async function create(e: Event) {
    e.preventDefault();
    if (!ws || creating) return;
    creating = true;
    try {
      const l = await api<RecordingLink>('recordingLinks.create', {
        params: { workspaceId: ws },
        body: { name: newName.trim(), folderId: newFolder || null, refUrl: newRef.trim() || undefined },
      });
      const copied = await copyText(l.url);
      toasts.success(copied ? 'Recording link created and copied' : 'Recording link created');
      newOpen = false;
      newName = newRef = newFolder = '';
      links = [l, ...links];
    } catch (err) {
      toasts.error(errMsg(err));
    } finally {
      creating = false;
    }
  }

  async function saveName(l: RecordingLink) {
    const n = editName.trim();
    editing = null;
    if (n === l.name) return;
    try {
      replace(await api<RecordingLink>('recordingLinks.update', { params: { id: l.id }, body: { name: n } }));
      toasts.success('Link renamed');
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function retarget(l: RecordingLink, folderId: string | null, name: string | null, close: () => void) {
    close();
    try {
      replace(await api<RecordingLink>('recordingLinks.update', { params: { id: l.id }, body: { folderId } }));
      toasts.success(name ? `New recordings land in ${name}` : 'New recordings land in all captures');
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function setRevoked(l: RecordingLink, revoked: boolean) {
    try {
      replace(await api<RecordingLink>('recordingLinks.update', { params: { id: l.id }, body: { revoked } }));
      toasts.success(revoked ? 'Link turned off' : 'Link turned on');
      if (status !== 'all') void load();
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function del(l: RecordingLink) {
    await api('recordingLinks.delete', { params: { id: l.id } });
    links = links.filter((x) => x.id !== l.id);
    toasts.success('Recording link deleted');
  }

  async function copy(l: RecordingLink) {
    if (await copyText(l.url)) toasts.success('Link copied');
  }
  const preset = (l: RecordingLink, mic: boolean) => `${l.url}?${new URLSearchParams({ ...(l.name ? { title: l.name } : {}), ...(mic ? { mic: '1' } : {}) })}`;

  const memberOpts = $derived(
    data.dash.members.map((m) => ({ value: m.userId, label: m.person.name, sub: m.person.email ?? undefined, avatar: { name: m.person.name, image: m.person.image } })),
  );
</script>

<svelte:head><title>Recording links</title></svelte:head>

<div class="top">
  <div>
    <h1>Recording links</h1>
    <p class="muted lead">Send a link; whoever opens it records their screen with no extension and no account. The recording lands here and you get an email.</p>
  </div>
  {#if canEdit}
    <Popover bind:open={newOpen} label="New recording link" placement="bottom-end">
      {#snippet trigger({ toggle, open, id })}
        <Button variant="primary" icon="plus" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="new-link">New link</Button>
      {/snippet}
      {#snippet children()}
        <form class="nl" onsubmit={create} data-testid="new-link-form">
          <strong>New recording link</strong>
          <label>Name <span class="opt">(optional)</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input type="text" bind:value={newName} placeholder="Support inbox" maxlength="200" autofocus data-testid="new-link-name" />
          </label>
          <label>Save recordings in
            <select bind:value={newFolder} data-testid="new-link-folder">
              <option value="">All captures</option>
              {#each data.dash.folders as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
            </select>
          </label>
          <label>Ticket URL <span class="opt">(optional)</span>
            <input type="url" bind:value={newRef} placeholder="https://github.com/org/repo/issues/12" data-testid="new-link-ref" />
          </label>
          <div class="dom"><span class="dot" title="Video only: the page's console and network are not captured"></span>Recorder on this server: video and voice only</div>
          <Button type="submit" variant="primary" loading={creating} data-testid="new-link-create">Create and copy</Button>
        </form>
      {/snippet}
    </Popover>
  {/if}
</div>

<div class="filters">
  <div class="seg" role="radiogroup" aria-label="Status" data-testid="link-status">
    {#each [['active', 'Active'], ['revoked', 'Turned off'], ['all', 'All']] as const as [v, l] (v)}
      <button role="radio" aria-checked={status === v} onclick={() => (status = v)}>{l}</button>
    {/each}
  </div>
  <MultiSelect label="Creator" options={memberOpts} selected={creators} onchange={(v) => (creators = v)} testid="link-creator" />
  <label class="sort">Sort
    <select bind:value={sort} data-testid="link-sort">
      <option value="newest">Newest</option>
      <option value="oldest">Oldest</option>
      <option value="most-used">Most used</option>
      <option value="name">Name</option>
    </select>
  </label>
</div>

{#if loading && !links.length}
  <div class="spin" data-testid="links-loading"><DIcon name="spinner" size={22} /></div>
{:else if !links.length}
  <div class="empty" data-testid="links-empty">
    <DIcon name="link" size={30} />
    <h2>{status === 'active' ? 'No recording links yet' : 'Nothing here'}</h2>
    <p>Make one with New link, or from the extension's recording-link row.</p>
  </div>
{:else}
  <ul class="rows" data-testid="link-rows">
    {#each links as l (l.id)}
      <li class="row" class:off={l.status === 'revoked'} data-testid="link-row" data-id={l.id}>
        <div class="mosaic" aria-hidden="true">
          {#each Array(4) as _, i (i)}
            {#if l.thumbs[i]}<img src={l.thumbs[i]} alt="" loading="lazy" />{:else}<span></span>{/if}
          {/each}
        </div>
        <div class="main">
          <div class="namerow">
            {#if editing === l.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="rename"
                bind:value={editName}
                autofocus
                aria-label="Link name"
                onkeydown={(e) => {
                  if (e.key === 'Enter') saveName(l);
                  if (e.key === 'Escape') editing = null;
                }}
                onblur={() => saveName(l)}
                data-testid="link-rename-input"
              />
            {:else}
              <strong class="name" data-testid="link-name">{l.name || 'Untitled link'}</strong>
              {#if mayChange(l)}
                <button class="ib" aria-label="Rename link" title="Rename" onclick={() => ((editing = l.id), (editName = l.name))} data-testid="link-rename"><DIcon name="edit" size={14} /></button>
              {/if}
            {/if}
            {#if l.status === 'revoked'}<span class="tag">Off</span>{/if}
          </div>
          <div class="meta">
            {#if l.createdBy}<span class="by"><UserAvatar name={l.createdBy.name} image={l.createdBy.image} size={18} />{l.createdBy.name}</span>{/if}
            <span data-testid="link-uses">{l.uses} {l.uses === 1 ? 'recording' : 'recordings'}</span>
            <span>{l.lastUsedAt ? `last ${relativeTime(l.lastUsedAt)}` : `made ${relativeTime(l.createdAt)}`}</span>
            {#if l.ref}<a class="ref" href={l.ref.url} target="_blank" rel="noopener" data-testid="link-ref"><DIcon name="issue" size={12} />{l.ref.key ?? l.ref.tracker}</a>{/if}
          </div>
        </div>
        <Popover label="Where recordings land" placement="bottom-end">
          {#snippet trigger({ toggle, open, id })}
            <button class="fchip" onclick={toggle} aria-expanded={open} aria-controls={id} disabled={!mayChange(l)} data-testid="link-folder">
              <DIcon name="folder" size={13} />{l.folder?.name ?? 'All captures'}<DIcon name="chevron-down" size={11} />
            </button>
          {/snippet}
          {#snippet children({ close })}
            <FolderPicker folders={data.dash.folders} current={l.folder?.id ?? null} workspaceId={ws} noneLabel="All captures" onpick={(id, name) => retarget(l, id, name, close)} />
          {/snippet}
        </Popover>
        <div class="acts">
          <Popover label="Share link" placement="bottom-end">
            {#snippet trigger({ toggle, open, id })}
              <Button size="sm" icon="link" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="link-share">Share</Button>
            {/snippet}
            {#snippet children({ close })}
              <div class="share">
                <code>{l.url}</code>
                <Button size="sm" icon="copy" onclick={() => (copy(l), close())} data-testid="link-copy">Copy link</Button>
                <Button size="sm" variant="ghost" icon="mic" onclick={async () => { if (await copyText(preset(l, true))) toasts.success('Link with voice on copied'); close(); }}>Copy with voice on</Button>
                <p class="hint">Add <code>?title=</code>, <code>&amp;folder=</code>, <code>&amp;ref=</code> or <code>&amp;mic=1</code> to preset the recorder.</p>
              </div>
            {/snippet}
          </Popover>
          <a class="btnlink" href="/?link={l.id}" data-testid="link-open-captures" title="Captures made through this link"><DIcon name="video" size={14} />Captures</a>
          {#if mayChange(l)}
            <Popover label="More" placement="bottom-end">
              {#snippet trigger({ toggle, open, id })}
                <Button size="sm" iconOnly icon="more" aria-label="More actions" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="link-more" />
              {/snippet}
              {#snippet children({ close })}
                <div class="menu" role="menu">
                  <button role="menuitem" onclick={() => (setRevoked(l, l.status !== 'revoked'), close())}><DIcon name={l.status === 'revoked' ? 'check' : 'stop'} />{l.status === 'revoked' ? 'Turn on' : 'Turn off'}</button>
                  <button role="menuitem" class="danger" onclick={() => ((toDelete = l), close())} data-testid="link-delete"><DIcon name="trash" />Delete</button>
                </div>
              {/snippet}
            </Popover>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
{/if}

<Confirm
  open={!!toDelete}
  title="Delete this recording link?"
  message="The link stops working at once. Recordings already made through it stay in your workspace."
  onconfirm={async () => {
    if (toDelete) await del(toDelete).catch((e) => toasts.error(errMsg(e)));
    toDelete = null;
    void invalidate('nib:shell');
  }}
/>

<style>
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
  h1 { margin: 0 0 4px; }
  .lead { margin: 0; max-width: 620px; }
  .filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--nb-radius-md); background: var(--nb-surface-sunken); }
  .seg button { all: unset; padding: 5px 10px; border-radius: var(--nb-radius-sm); font-size: var(--nb-text-md); color: var(--nb-text-muted); cursor: pointer; }
  .seg button[aria-checked='true'] { background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  .seg button:focus-visible { outline: 2px solid var(--nb-focus); }
  .sort { display: inline-flex; align-items: center; gap: 6px; font-size: var(--nb-text-md); color: var(--nb-text-muted); margin-left: auto; }
  select {
    height: 32px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface);
    color: var(--nb-text); padding: 0 8px; font: inherit; font-size: var(--nb-text-md);
  }
  .spin { display: grid; place-items: center; padding: 80px 0; color: var(--nb-text-faint); }
  .empty h2 { margin: 6px 0 0; color: var(--nb-text); }
  .empty p { margin: 0; }
  .rows { list-style: none; margin: 0; padding: 0; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  .row { display: flex; align-items: center; gap: 14px; padding: 12px 14px; border-top: 1px solid var(--nb-border); }
  .row:first-child { border-top: 0; }
  .row.off .main, .row.off .mosaic { opacity: 0.55; }
  .mosaic { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; width: 72px; height: 46px; flex: none; border-radius: var(--nb-radius-md); overflow: hidden; background: var(--nb-surface-sunken); }
  .mosaic img, .mosaic span { width: 100%; height: 100%; object-fit: cover; background: var(--nb-surface-2); display: block; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .namerow { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rename { height: 28px; max-width: 320px; font-weight: var(--nb-weight-semibold); }
  .ib { all: unset; display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--nb-radius-sm); color: var(--nb-text-faint); cursor: pointer; }
  .ib:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .ib:focus-visible { outline: 2px solid var(--nb-focus); }
  .tag { font-size: var(--nb-text-xs); padding: 1px 6px; border-radius: var(--nb-radius-pill); background: var(--nb-surface-sunken); color: var(--nb-text-muted); }
  .meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .by { display: inline-flex; align-items: center; gap: 6px; }
  .ref { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }
  .fchip {
    all: unset; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: var(--nb-radius-pill);
    background: var(--nb-surface-sunken); font-size: var(--nb-text-sm); cursor: pointer; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fchip:hover:not(:disabled) { background: var(--nb-border); }
  .fchip:disabled { cursor: default; }
  .fchip:focus-visible { outline: 2px solid var(--nb-focus); }
  .acts { display: inline-flex; align-items: center; gap: 6px; }
  .btnlink {
    display: inline-flex; align-items: center; gap: 6px; height: var(--nb-control-sm); padding: 0 8px; border-radius: var(--nb-radius-md);
    border: 1px solid var(--nb-border-strong); color: var(--nb-text); text-decoration: none; font-size: var(--nb-text-md); background: var(--nb-surface);
  }
  .btnlink:hover { background: var(--nb-surface-sunken); }
  .menu { display: flex; flex-direction: column; gap: 1px; width: 170px; }
  .menu button { all: unset; display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md); cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: var(--nb-surface-sunken); }
  .danger { color: var(--nb-danger); }
  .nl { display: flex; flex-direction: column; gap: 10px; width: min(320px, calc(100vw - 40px)); padding: 4px; }
  .nl label { display: flex; flex-direction: column; gap: 4px; font-size: var(--nb-text-md); }
  .nl input { height: 34px; }
  .opt { color: var(--nb-text-faint); }
  .dom { display: flex; align-items: center; gap: 8px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--nb-danger); flex: none; }
  .share { display: flex; flex-direction: column; gap: 8px; width: min(320px, calc(100vw - 40px)); padding: 4px; }
  .share code { font-size: var(--nb-text-sm); overflow-wrap: anywhere; }
  .hint { margin: 0; font-size: var(--nb-text-xs); color: var(--nb-text-faint); }
  .hint code { font-size: inherit; }
  @media (max-width: 760px) {
    .row { flex-wrap: wrap; }
    .main { flex-basis: calc(100% - 90px); }
    .acts { margin-left: auto; }
    .sort { margin-left: 0; }
  }
</style>
