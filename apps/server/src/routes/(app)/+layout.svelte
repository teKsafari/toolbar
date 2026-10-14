<script lang="ts">
  import { page } from '$app/state';
  import { Button, Icon, type IconName } from '@toolbar/ui';
  import WorkspaceMenu from '#lib/components/auth/WorkspaceMenu.svelte';
  import InviteDialog from '#lib/components/auth/InviteDialog.svelte';

  let { data, children } = $props();
  let inviteOpen = $state(false);
  const nav: { href: string; label: string; icon: IconName }[] = [
    { href: '/', label: 'All captures', icon: 'home' },
    { href: '/?by=me', label: 'Created by me', icon: 'user' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];
  const active = (href: string) =>
    href === '/' ? page.url.pathname === '/' && !page.url.search : (page.url.pathname + page.url.search).startsWith(href);
</script>

<div class="shell">
  <aside>
    <div class="ws">
      <WorkspaceMenu workspaces={data.myWorkspaces} activeId={data.activeWorkspaceId} user={data.user} />
    </div>
    <nav>
      {#each nav as n (n.href)}
        <a href={n.href} class:active={active(n.href)}><Icon name={n.icon} size={16} />{n.label}</a>
      {/each}
    </nav>
    <div class="section">Folders</div>
    <p class="muted small">No folders yet</p>
    <div class="grow"></div>
    <form method="POST" action="/logout" class="me">
      <span class="who" title={data.user.email}>{data.user.name}</span>
      <Button type="submit" variant="ghost" size="sm">Sign out</Button>
    </form>
  </aside>
  <div class="main">
    <header>
      <label class="search">
        <Icon name="search" size={16} />
        <input type="text" placeholder="Search captures, people and folders" aria-label="Search" />
        <kbd>Ctrl K</kbd>
      </label>
      <span class="head-actions">
        {#if data.activeWorkspace && data.activeWorkspace.role !== 'viewer'}
          <Button icon="user" onclick={() => (inviteOpen = true)} data-testid="invite-button">Invite</Button>
        {/if}
        <Button variant="primary" icon="plus">New capture</Button>
      </span>
    </header>
    <div class="content">{@render children()}</div>
  </div>
</div>
{#if data.activeWorkspace}<InviteDialog workspace={data.activeWorkspace} bind:open={inviteOpen} />{/if}

<style>
  .shell { display: grid; grid-template-columns: 250px 1fr; min-height: 100vh; }
  aside {
    display: flex; flex-direction: column; gap: var(--nb-space-1);
    padding: var(--nb-space-3); border-right: 1px solid var(--nb-border); background: var(--nb-surface-2);
  }
  .ws { display: flex; align-items: center; padding: 0 0 10px; }
  .head-actions { display: inline-flex; gap: var(--nb-space-2); }
  nav { display: flex; flex-direction: column; gap: 2px; }
  nav a {
    display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md);
    color: var(--nb-text-muted); text-decoration: none;
  }
  nav a:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  nav a.active { background: var(--nb-accent-tint); color: var(--nb-accent-text); font-weight: 500; }
  .section { margin-top: 16px; padding: 0 8px; font-size: 12px; color: var(--nb-text-faint); font-weight: 600; }
  .small { font-size: 12px; padding: 0 8px; margin: 4px 0; }
  .grow { flex: 1; }
  .me { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 0 0 8px; }
  .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .main { display: flex; flex-direction: column; min-width: 0; }
  header {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 12px 24px; border-bottom: 1px solid var(--nb-border); background: var(--nb-surface);
  }
  .search {
    display: flex; align-items: center; gap: 8px; flex: 0 1 420px; height: 34px; padding: 0 10px;
    border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); color: var(--nb-text-faint);
  }
  .search input { border: 0; height: 100%; padding: 0; background: transparent; outline: none; }
  kbd { font: 11px var(--nb-font-mono); color: var(--nb-text-faint); white-space: nowrap; }
  .content { padding: 24px; }
  @media (max-width: 720px) {
    .shell { grid-template-columns: 1fr; }
    aside { display: none; }
  }
</style>
