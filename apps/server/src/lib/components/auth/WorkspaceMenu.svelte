<script lang="ts">
  // Sidebar workspace button and its menu (J-168, J-221): the current workspace with its seat,
  // settings, the other workspaces to switch to, create or join, and sign out.
  import { Icon, Popover, toasts } from '@toolbar/ui';
  import type { Workspace } from '@toolbar/shared/api';
  import { invalidateAll } from '$app/navigation';
  import Avatar from './Avatar.svelte';
  import { call, ROUTES } from './api.ts';

  let { workspaces, activeId, user }: { workspaces: Workspace[]; activeId: string | null; user: { name: string; email: string } } = $props();
  let open = $state(false);
  const active = $derived(workspaces.find((w) => w.id === activeId) ?? workspaces[0] ?? null);
  const others = $derived(workspaces.filter((w) => w.id !== active?.id));
  const seatLabel = { admin: 'Admin', creator: 'Creator', viewer: 'Viewer' } as const;

  async function switchTo(w: Workspace, close: () => void) {
    close();
    try {
      await call(ROUTES['account.setActiveWorkspace'], {}, { workspaceId: w.id });
      await invalidateAll();
      toasts.success(`Switched to ${w.name}`);
    } catch (e) {
      toasts.error((e as Error).message);
    }
  }
</script>

<Popover bind:open label="Workspace menu" placement="bottom-start">
  {#snippet trigger({ toggle, open, id })}
    <button class="ws" onclick={toggle} aria-expanded={open} aria-controls={id} aria-haspopup="menu" data-testid="workspace-menu">
      <Avatar name={active?.name ?? '?'} size={26} />
      <span class="name">{active?.name ?? 'No workspace'}</span>
      <Icon name="more" size={16} />
    </button>
  {/snippet}
  {#snippet children({ close })}
    <div class="menu" role="menu">
      {#if active}
        <div class="current">
          <Avatar name={active.name} size={30} />
          <span class="col">
            <span class="title">{active.name}</span>
            <span class="meta">{active.memberCount} {active.memberCount === 1 ? 'member' : 'members'}</span>
          </span>
          <span class="chip">{seatLabel[active.role]}</span>
        </div>
        <a role="menuitem" href="/settings/workspace" onclick={close}><Icon name="settings" size={16} />Settings</a>
        <a role="menuitem" href="/settings/members" onclick={close}><Icon name="user" size={16} />Members</a>
      {/if}
      {#if others.length}
        <div class="label">Switch workspace</div>
        {#each others as w (w.id)}
          <button role="menuitem" onclick={() => switchTo(w, close)} data-ws={w.id}>
            <Avatar name={w.name} size={18} /><span class="grow">{w.name}</span><span class="meta">{seatLabel[w.role]}</span>
          </button>
        {/each}
      {/if}
      <a role="menuitem" href="/workspaces/new" onclick={close}><Icon name="plus" size={16} />Create or join a workspace</a>
      <hr />
      <div class="who" title={user.email}>{user.email}</div>
      <form method="POST" action="/logout"><button role="menuitem" type="submit"><Icon name="external" size={16} />Sign out</button></form>
    </div>
  {/snippet}
</Popover>

<style>
  .ws {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 226px; padding: 6px 8px;
    border-radius: var(--nb-radius-md); cursor: pointer; font-weight: var(--nb-weight-semibold);
  }
  .ws:hover { background: var(--nb-surface-sunken); }
  .ws:focus-visible { outline: 2px solid var(--nb-focus); }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu { display: flex; flex-direction: column; gap: 1px; width: 260px; }
  .current { display: flex; align-items: center; gap: 10px; padding: 6px 8px 10px; }
  .col { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .title { font-weight: var(--nb-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .chip { font-size: var(--nb-text-xs); padding: 2px 6px; border-radius: var(--nb-radius-pill); background: var(--nb-accent-tint); color: var(--nb-accent-text); }
  .label { padding: 8px 8px 4px; font-size: var(--nb-text-xs); color: var(--nb-text-faint); font-weight: var(--nb-weight-semibold); }
  a, button {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px;
    border-radius: var(--nb-radius-md); cursor: pointer; color: var(--nb-text); font-size: var(--nb-text-md);
  }
  a:hover, button:hover, a:focus-visible, button:focus-visible { background: var(--nb-surface-sunken); }
  .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  hr { border: 0; border-top: 1px solid var(--nb-border); margin: 6px 0; width: 100%; }
  .who { padding: 2px 8px 4px; font-size: var(--nb-text-sm); color: var(--nb-text-faint); overflow: hidden; text-overflow: ellipsis; }
</style>
