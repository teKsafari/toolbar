<script lang="ts">
  // J-122: folder share popover: copy the folder link, invite by email with a role, who has
  // access with roles, and general access (workspace members or only the people listed).
  import { invalidateAll } from '$app/navigation';
  import { Button, Popover, toasts } from '@toolbar/ui';
  import type { z } from 'zod';
  import type { folderShareSchema } from '@toolbar/shared/api';
  import DIcon from './DIcon.svelte';
  import UserAvatar from './UserAvatar.svelte';
  import { api, copyText, errMsg } from './api.ts';

  type Share = z.infer<typeof folderShareSchema>;
  let { folderId, canEdit }: { folderId: string; canEdit: boolean } = $props();
  let open = $state(false);
  let share = $state<Share | null>(null);
  let email = $state('');
  let role = $state<'viewer' | 'creator'>('viewer');
  let busy = $state(false);
  const valid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  async function load() {
    try {
      share = await api<Share>('folders.getShare', { params: { id: folderId } });
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }
  $effect(() => {
    if (open) void load();
  });

  async function invite(e: Event) {
    e.preventDefault();
    if (!valid || busy) return;
    busy = true;
    try {
      share = await api<Share>('folders.updateShare', { params: { id: folderId }, body: { invite: [{ email: email.trim(), role }] } });
      toasts.success(`Invited ${email.trim()}`);
      email = '';
    } catch (err) {
      toasts.error(errMsg(err));
    } finally {
      busy = false;
    }
  }

  async function setAccess(access: 'workspace' | 'private') {
    try {
      share = await api<Share>('folders.updateShare', { params: { id: folderId }, body: { access } });
      await invalidateAll(); // the lock icon in the sidebar and the title
    } catch (err) {
      toasts.error(errMsg(err));
    }
  }

  async function remove(id: string | null) {
    if (!id) return;
    share = await api<Share>('folders.updateShare', { params: { id: folderId }, body: { remove: [id] } }).catch((e) => (toasts.error(errMsg(e)), share));
  }

  async function copy() {
    if (share && (await copyText(share.url))) toasts.success('Folder link copied');
  }
</script>

<Popover bind:open label="Share folder" placement="bottom-end">
  {#snippet trigger({ toggle, open: o, id })}
    <Button icon="link" onclick={toggle} aria-expanded={o} aria-controls={id} data-testid="folder-share">Share</Button>
  {/snippet}
  {#snippet children()}
    <div class="fs" data-testid="folder-share-popover">
      <div class="row1">
        <strong>Share folder</strong>
        <Button size="sm" icon="copy" onclick={copy} data-testid="folder-copy-link">Copy link</Button>
      </div>
      {#if canEdit}
        <form class="inv" onsubmit={invite}>
          <input type="email" bind:value={email} placeholder="Email address" aria-label="Email to invite" data-testid="folder-invite-email" />
          <select bind:value={role} aria-label="Role">
            <option value="viewer">Viewer</option>
            <option value="creator">Creator</option>
          </select>
          <Button type="submit" variant="primary" size="sm" disabled={!valid} loading={busy} data-testid="folder-invite">Invite</Button>
        </form>
      {/if}
      <div class="label">People with access</div>
      {#if !share}
        <div class="muted"><DIcon name="spinner" /></div>
      {:else}
        <ul data-testid="folder-people">
          {#each share.people as p (p.person.id ?? p.person.email)}
            <li>
              <UserAvatar name={p.person.name} image={p.person.image} size={24} />
              <span class="col"><span>{p.person.name}</span>{#if p.person.email && p.person.email !== p.person.name}<span class="sub">{p.person.email}</span>{/if}</span>
              <span class="role">{p.pending ? 'Invited' : p.role === 'admin' ? 'Admin' : p.role === 'creator' ? 'Creator' : 'Viewer'}</span>
              {#if canEdit && p.role !== 'admin' && p.person.id}
                <button class="rm" aria-label="Remove {p.person.name}" onclick={() => remove(p.person.id)}><DIcon name="close" size={12} /></button>
              {/if}
            </li>
          {/each}
        </ul>
        <div class="label">General access</div>
        <div class="ga">
          <DIcon name={share.access === 'private' ? 'lock' : 'users'} size={18} />
          <select value={share.access} disabled={!canEdit} onchange={(e) => setAccess((e.currentTarget as HTMLSelectElement).value as 'workspace' | 'private')} aria-label="General access" data-testid="folder-access">
            <option value="workspace">Everyone in the workspace</option>
            <option value="private">Only people listed</option>
          </select>
        </div>
      {/if}
    </div>
  {/snippet}
</Popover>

<style>
  .fs { width: min(380px, calc(100vw - 32px)); display: flex; flex-direction: column; gap: 10px; padding: 4px; }
  .row1 { display: flex; align-items: center; justify-content: space-between; }
  .inv { display: flex; gap: 6px; }
  .inv input { height: 32px; flex: 1; min-width: 0; font-size: var(--nb-text-md); }
  select { height: 32px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); padding: 0 6px; font: inherit; font-size: var(--nb-text-md); }
  .label { font-size: var(--nb-text-xs); color: var(--nb-text-faint); font-weight: var(--nb-weight-semibold); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 200px; overflow-y: auto; }
  li { display: flex; align-items: center; gap: 8px; }
  .col { display: flex; flex-direction: column; flex: 1; min-width: 0; font-size: var(--nb-text-md); }
  .col span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { font-size: var(--nb-text-xs); color: var(--nb-text-faint); }
  .role { font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .rm { all: unset; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; cursor: pointer; color: var(--nb-text-faint); }
  .rm:hover { background: var(--nb-surface-sunken); }
  .ga { display: flex; align-items: center; gap: 8px; }
  .ga select { flex: 1; }
</style>
