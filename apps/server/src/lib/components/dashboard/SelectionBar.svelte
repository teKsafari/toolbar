<script lang="ts">
  // J-165: with cards ticked, the page header becomes a selection bar with the count, move and
  // delete. Move opens the folder list and moves at once; delete asks first.
  import { invalidate } from '$app/navigation';
  import { Button, Popover, toasts } from '@toolbar/ui';
  import type { Folder } from '@toolbar/shared/api';
  import DIcon from './DIcon.svelte';
  import Confirm from './Confirm.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import { api, errMsg } from './api.ts';
  import { shell } from './shell.svelte.ts';

  interface Props {
    ids: string[];
    folders: Folder[];
    currentFolder: string | null;
    workspaceId: string | null;
    onclear: () => void;
  }
  let { ids, folders, currentFolder, workspaceId, onclear }: Props = $props();
  let confirm = $state(false);
  let moveOpen = $state(false);

  async function move(folderId: string | null, name: string | null) {
    moveOpen = false;
    try {
      const r = await api<{ updated: number }>('captures.bulk', { body: { action: 'move', ids, folderId } });
      toasts.success(`Moved ${r.updated} ${r.updated === 1 ? 'capture' : 'captures'} to ${name ?? 'all captures'}`);
      onclear();
      shell.reload();
      await invalidate('nib:shell');
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function del() {
    try {
      const r = await api<{ updated: number }>('captures.bulk', { body: { action: 'delete', ids } });
      toasts.success(`Deleted ${r.updated} ${r.updated === 1 ? 'capture' : 'captures'}`);
      onclear();
      shell.reload();
      await invalidate('nib:shell');
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }
</script>

<div class="sel" role="toolbar" aria-label="Selection" data-testid="selection-bar">
  <button class="x" aria-label="Clear selection" onclick={onclear}><DIcon name="close" size={14} /></button>
  <strong data-testid="selection-count">{ids.length} selected</strong>
  <span class="grow"></span>
  <Popover bind:open={moveOpen} label="Move to folder" placement="bottom-end">
    {#snippet trigger({ toggle, open, id })}
      <Button icon="folder" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="bulk-move">Move</Button>
    {/snippet}
    {#snippet children()}
      <FolderPicker {folders} current={currentFolder} {workspaceId} onpick={move} />
    {/snippet}
  </Popover>
  <Button variant="danger" icon="trash" onclick={() => (confirm = true)} data-testid="bulk-delete">Delete</Button>
</div>

<Confirm
  bind:open={confirm}
  title={ids.length === 1 ? 'Delete this capture?' : `Delete ${ids.length} captures?`}
  message="This is permanent. Share links stop working and the media is erased."
  onconfirm={del}
/>

<style>
  .sel {
    display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 6px 10px 6px 6px; margin-bottom: 18px;
    border-radius: var(--nb-radius-lg); background: var(--nb-accent-tint); color: var(--nb-accent-text);
  }
  .x { all: unset; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; }
  .x:hover { background: rgb(0 0 0 / 0.06); }
  .x:focus-visible { outline: 2px solid var(--nb-focus); }
  .grow { flex: 1; }
</style>
