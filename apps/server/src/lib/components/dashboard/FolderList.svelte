<script lang="ts">
  import { focusNow } from '#lib/components/focus.ts';
  // Sidebar folders (J-162, J-213, J-163, J-166): alphabetical, icon per row, the active one shows
  // its count; the heading collapses the list and shows a plus on hover; dropping cards moves them.
  import { invalidate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { toasts } from '@toolbar/ui';
  import type { Folder } from '@toolbar/shared/api';
  import DIcon from './DIcon.svelte';
  import { api, errMsg } from './api.ts';
  import { shell, DRAG_MIME } from './shell.svelte.ts';

  let { folders, workspaceId, canCreate }: { folders: Folder[]; workspaceId: string | null; canCreate: boolean } = $props();

  let collapsed = $state(false);
  let adding = $state(false);
  let name = $state('');
  let busy = $state(false);
  let over = $state<string | null>(null);

  try {
    collapsed = typeof localStorage !== 'undefined' && localStorage.getItem('nib.folders.collapsed') === '1';
  } catch {
    /* storage blocked */
  }

  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem('nib.folders.collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const activeKey = $derived(page.url.pathname.startsWith('/f/') ? page.url.pathname.slice(3).split('/')[0] : null);

  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim() || !workspaceId || busy) return;
    busy = true;
    try {
      const f = await api<Folder>('folders.create', { params: { workspaceId }, body: { name: name.trim() } });
      toasts.success(`Folder "${f.name}" created`);
      name = '';
      adding = false;
      await invalidate('nib:shell');
    } catch (err) {
      toasts.error(errMsg(err));
    } finally {
      busy = false;
    }
  }

  async function drop(e: DragEvent, f: Folder) {
    e.preventDefault();
    over = null;
    const raw = e.dataTransfer?.getData(DRAG_MIME);
    const ids: string[] = raw ? JSON.parse(raw) : shell.dragging;
    shell.dragging = [];
    if (!ids.length) return;
    try {
      await api('captures.bulk', { body: { action: 'move', ids, folderId: f.id } });
      toasts.success(ids.length === 1 ? `Moved to ${f.name}` : `Moved ${ids.length} captures to ${f.name}`, {
        action: { label: 'Open', run: () => goto(`/f/${f.shortId}`) },
      });
      shell.reload();
      await invalidate('nib:shell');
    } catch (err) {
      toasts.error(errMsg(err));
    }
  }
</script>

<div class="folders" class:dragging={shell.dragging.length > 0}>
  <div class="head">
    <button class="title" onclick={toggle} aria-expanded={!collapsed} data-testid="folders-heading">
      <DIcon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />Folders
    </button>
    {#if canCreate}
      <button class="plus" aria-label="New folder" title="New folder" onclick={() => ((adding = true), (collapsed = false))} data-testid="new-folder">
        <DIcon name="plus" size={14} />
      </button>
    {/if}
  </div>
  {#if !collapsed}
    <ul role="list" data-testid="folder-list">
      {#if adding}
        <li>
          <form onsubmit={create} class="add">
            <DIcon name="folder" size={16} />
            <input
             use:focusNow
              bind:value={name}
              placeholder="Folder name"
              aria-label="Folder name"
              maxlength="200"
              disabled={busy}
              onkeydown={(e) => e.key === 'Escape' && ((adding = false), (name = ''))}
              onblur={() => !name.trim() && (adding = false)}
              data-testid="new-folder-input"
            />
          </form>
        </li>
      {/if}
      {#each folders as f (f.id)}
        <li>
          <a
            href="/f/{f.shortId}"
            class:active={activeKey === f.shortId || activeKey === f.id}
            class:over={over === f.id}
            data-folder={f.id}
            ondragover={(e) => {
              if (!shell.dragging.length && !e.dataTransfer?.types.includes(DRAG_MIME)) return;
              e.preventDefault();
              over = f.id;
            }}
            ondragleave={() => over === f.id && (over = null)}
            ondrop={(e) => drop(e, f)}
            onclick={() => (shell.drawerOpen = false)}
          >
            <DIcon name={f.private ? 'lock' : 'folder'} size={16} />
            <span class="name">{f.name}</span>
            {#if activeKey === f.shortId || activeKey === f.id}<span class="count" data-testid="folder-count">{f.captureCount}</span>{/if}
          </a>
        </li>
      {:else}
        {#if !adding}<li class="none">No folders yet</li>{/if}
      {/each}
    </ul>
  {/if}
</div>

<style>
  .folders { margin-top: 14px; }
  .head { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 0 2px; }
  .title {
    all: unset; display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: var(--nb-radius-sm);
    font-size: var(--nb-text-sm); color: var(--nb-text-faint); font-weight: var(--nb-weight-semibold); cursor: pointer;
  }
  .title:hover { color: var(--nb-text); }
  .title:focus-visible, .plus:focus-visible { outline: 2px solid var(--nb-focus); }
  .plus {
    all: unset; display: grid; place-items: center; width: 22px; height: 22px; border-radius: var(--nb-radius-sm);
    color: var(--nb-text-muted); cursor: pointer; opacity: 0; transition: opacity var(--nb-dur-fast);
  }
  .head:hover .plus, .plus:focus-visible { opacity: 1; }
  @media (hover: none) { .plus { opacity: 1; } }
  .plus:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  ul { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  a {
    display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: var(--nb-radius-md);
    color: var(--nb-text-muted); text-decoration: none; border: 1px solid transparent;
  }
  a:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  a.active { background: var(--nb-accent-tint); color: var(--nb-accent-text); font-weight: var(--nb-weight-medium); }
  .dragging a { border: 1px dashed var(--nb-border-strong); }
  .dragging a.over { border: 1px solid var(--nb-accent); background: var(--nb-accent-tint); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font-size: var(--nb-text-xs); color: inherit; opacity: 0.8; }
  .none { padding: 4px 10px; font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .add { display: flex; align-items: center; gap: 8px; padding: 2px 8px; color: var(--nb-text-muted); }
  .add input { height: 28px; padding: 0 8px; font-size: var(--nb-text-md); }
</style>
