<script lang="ts">
  // A folder (J-162): its captures with the filter bar, a share popover (J-122) and a three-dot
  // menu to rename or delete it (J-164). An empty folder shows a heading, one line and a button
  // to make a capture, with no filter bar (J-203).
  import { goto, invalidate, invalidateAll } from '$app/navigation';
  import { Button, Popover, toasts } from '@toolbar/ui';
  import CaptureGrid from '#lib/components/dashboard/CaptureGrid.svelte';
  import FilterBar from '#lib/components/dashboard/FilterBar.svelte';
  import FolderShare from '#lib/components/dashboard/FolderShare.svelte';
  import NewCapture from '#lib/components/dashboard/NewCapture.svelte';
  import Modal from '#lib/components/dashboard/Modal.svelte';
  import Confirm from '#lib/components/dashboard/Confirm.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  const f = $derived(data.folder);
  const canEdit = $derived(data.seat !== 'viewer');
  let renaming = $state(false);
  let deleting = $state(false);
  let name = $state('');
  let busy = $state(false);

  async function rename(e: Event) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    busy = true;
    try {
      await api('folders.update', { params: { id: f.id }, body: { name: name.trim() } });
      toasts.success(`Renamed to "${name.trim()}"`);
      renaming = false;
      await invalidateAll();
    } catch (err) {
      toasts.error(errMsg(err));
    } finally {
      busy = false;
    }
  }

  async function del() {
    const r = await api<{ deletedCaptures: number }>('folders.delete', { params: { id: f.id } });
    toasts.success(`Deleted "${f.name}"${r.deletedCaptures ? ` and ${r.deletedCaptures} ${r.deletedCaptures === 1 ? 'capture' : 'captures'}` : ''}`);
    await invalidate('nib:shell');
    await goto('/');
  }
</script>

<svelte:head><title>{f.name}</title></svelte:head>

{#key f.id}
  <CaptureGrid folderId={f.id} workspaceId={f.workspaceId} folders={data.dash.folders} {canEdit}>
    {#snippet header({ total, loading })}
      <div class="titlerow">
        <h1 data-testid="folder-title"><DIcon name={f.private ? 'lock' : 'folder'} size={20} />{f.name}</h1>
        {#if !loading && total !== null}<span class="count">{total}</span>{/if}
        <span class="grow"></span>
        <FolderShare folderId={f.id} {canEdit} />
        {#if canEdit}
          <Popover label="Folder actions" placement="bottom-end">
            {#snippet trigger({ toggle, open, id })}
              <Button iconOnly icon="more" aria-label="Folder actions" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="folder-menu" />
            {/snippet}
            {#snippet children({ close })}
              <div class="menu" role="menu">
                <button role="menuitem" onclick={() => ((name = f.name), (renaming = true), close())} data-testid="folder-rename"><DIcon name="edit" />Rename</button>
                <button role="menuitem" class="danger" onclick={() => ((deleting = true), close())} data-testid="folder-delete"><DIcon name="trash" />Delete folder</button>
              </div>
            {/snippet}
          </Popover>
        {/if}
      </div>
      {#if total !== 0 || loading}<FilterBar members={data.dash.members} />{/if}
    {/snippet}
    {#snippet empty()}
      <div class="empty" data-testid="folder-empty">
        <DIcon name="folder" size={32} />
        <h2>This folder is empty</h2>
        <p>Captures you move here, or make with this folder picked, show up here.</p>
        {#if canEdit}<NewCapture label="Make a capture" />{/if}
      </div>
    {/snippet}
  </CaptureGrid>
{/key}

<Modal bind:open={renaming} title="Rename folder" testid="rename-dialog">
  <form id="rename-form" onsubmit={rename}>
    <input type="text" bind:value={name} aria-label="Folder name" maxlength="200" data-select data-testid="rename-input" />
  </form>
  {#snippet footer()}
    <Button onclick={() => (renaming = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="rename-form" disabled={!name.trim() || name.trim() === f.name} loading={busy} data-testid="rename-save">Rename</Button>
  {/snippet}
</Modal>

<Confirm
  bind:open={deleting}
  title={`Delete "${f.name}"?`}
  message="This permanently deletes the folder and every capture in it. Share links to those captures stop working."
  confirmLabel="Delete folder"
  onconfirm={async () => {
    await del().catch((e) => {
      toasts.error(errMsg(e));
    });
  }}
/>

<style>
  .titlerow { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
  h1 { margin: 0; display: inline-flex; align-items: center; gap: 10px; min-width: 0; overflow-wrap: anywhere; }
  .count { color: var(--nb-text-faint); font-size: var(--nb-text-md); }
  .grow { flex: 1; }
  .menu { display: flex; flex-direction: column; gap: 1px; width: 180px; }
  .menu button { all: unset; display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md); cursor: pointer; }
  .menu button:hover, .menu button:focus-visible { background: var(--nb-surface-sunken); }
  .danger { color: var(--nb-danger); }
  .empty h2 { margin: 6px 0 0; color: var(--nb-text); }
  .empty p { margin: 0 0 8px; }
</style>
