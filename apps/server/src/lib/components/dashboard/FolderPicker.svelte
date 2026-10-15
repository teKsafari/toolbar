<script lang="ts">
  import { focusNow } from '#lib/components/focus.ts';
  // Folder list for moves (J-165) and recording-link targets (J-223): the current location greyed,
  // "no folder", and an optional new-folder item that creates one and picks it.
  import { invalidate } from '$app/navigation';
  import { toasts } from '@toolbar/ui';
  import type { Folder } from '@toolbar/shared/api';
  import DIcon from './DIcon.svelte';
  import { api, errMsg } from './api.ts';

  interface Props {
    folders: Folder[];
    current: string | null | undefined;
    workspaceId: string | null;
    onpick: (folderId: string | null, name: string | null) => void;
    allowNone?: boolean;
    allowCreate?: boolean;
    noneLabel?: string;
  }
  let { folders, current, workspaceId, onpick, allowNone = true, allowCreate = true, noneLabel = 'No folder (all captures)' }: Props = $props();
  let creating = $state(false);
  let name = $state('');

  async function create(e: Event) {
    e.preventDefault();
    if (!name.trim() || !workspaceId) return;
    try {
      const f = await api<Folder>('folders.create', { params: { workspaceId }, body: { name: name.trim() } });
      await invalidate('nib:shell');
      onpick(f.id, f.name);
    } catch (err) {
      toasts.error(errMsg(err));
    }
  }
</script>

<div class="fp" role="menu" data-testid="folder-picker">
  {#if allowNone}
    <button role="menuitem" disabled={current === null} onclick={() => onpick(null, null)} data-folder-pick="none"><DIcon name="home" />{noneLabel}</button>
  {/if}
  {#each folders as f (f.id)}
    <button role="menuitem" disabled={current === f.id} onclick={() => onpick(f.id, f.name)} data-folder-pick={f.id}><DIcon name="folder" /><span>{f.name}</span>{#if current === f.id}<em>here</em>{/if}</button>
  {/each}
  {#if allowCreate}
    {#if creating}
      <form onsubmit={create}>
        <input bind:value={name} placeholder="New folder name" aria-label="New folder name" use:focusNow data-testid="picker-new-folder-input" />
      </form>
    {:else}
      <button role="menuitem" class="new" onclick={() => (creating = true)} data-testid="picker-new-folder"><DIcon name="folder-plus" />New folder</button>
    {/if}
  {/if}
</div>

<style>
  .fp { display: flex; flex-direction: column; gap: 1px; width: 240px; max-height: 320px; overflow-y: auto; }
  button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md); cursor: pointer; }
  button:hover:not(:disabled), button:focus-visible { background: var(--nb-surface-sunken); }
  button:disabled { color: var(--nb-text-faint); cursor: default; }
  span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  em { font-style: normal; font-size: var(--nb-text-xs); }
  .new { color: var(--nb-accent-text); }
  form { padding: 4px; }
  input { height: 30px; font-size: var(--nb-text-md); }
</style>
