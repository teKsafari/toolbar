<script lang="ts">
  // App shell (J-158 to J-170): sidebar with the workspace menu, nav, folders, setup card and
  // help; a header with the search box, member avatars, invite and new capture. Settings pages
  // bring their own layout (J-171), so the shell steps aside there. At phone width the sidebar
  // becomes a drawer behind a menu button.
  import { page } from '$app/state';
  import { Button, Icon, type IconName } from '@toolbar/ui';
  import WorkspaceMenu from '#lib/components/auth/WorkspaceMenu.svelte';
  import InviteDialog from '#lib/components/auth/InviteDialog.svelte';
  import FolderList from '#lib/components/dashboard/FolderList.svelte';
  import ProjectList from '#lib/components/dashboard/ProjectList.svelte';
  import Onboarding from '#lib/components/dashboard/Onboarding.svelte';
  import HelpMenu from '#lib/components/dashboard/HelpMenu.svelte';
  import NewCapture from '#lib/components/dashboard/NewCapture.svelte';
  import UserAvatar from '#lib/components/dashboard/UserAvatar.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { shell } from '#lib/components/dashboard/shell.svelte.ts';

  let { data, children } = $props();
  let inviteOpen = $state(false);
  const bare = $derived(page.url.pathname.startsWith('/settings'));
  const nav = $derived<{ href: string; label: string; icon: IconName; testid: string }[]>([
    { href: '/', label: 'All captures', icon: 'home', testid: 'nav-all' },
    { href: `/?by=${data.user.id}`, label: 'Created by me', icon: 'user', testid: 'nav-mine' },
    { href: '/links', label: 'Recording links', icon: 'link', testid: 'nav-links' },
  ]);
  const active = (href: string) => {
    const here = page.url.pathname + page.url.search;
    if (href === '/') return page.url.pathname === '/' && !page.url.searchParams.has('by');
    return here === href || (href !== '/' && page.url.pathname === href);
  };
  const canCreate = $derived(!!data.activeWorkspace && data.activeWorkspace.role !== 'viewer');
  const avatars = $derived(data.dash.members.slice(0, 4));
</script>

{#if bare}
  {@render children()}
{:else}
  <div class="shell">
    <button class="scrim" class:show={shell.drawerOpen} aria-label="Close menu" tabindex="-1" onclick={() => (shell.drawerOpen = false)}></button>
    <aside class:open={shell.drawerOpen} aria-label="Sidebar">
      <div class="ws">
        <WorkspaceMenu workspaces={data.myWorkspaces} activeId={data.activeWorkspaceId} user={data.user} />
      </div>
      <nav>
        {#each nav as n (n.href)}
          <a href={n.href} class:active={active(n.href)} data-testid={n.testid} onclick={() => (shell.drawerOpen = false)}><Icon name={n.icon} size={16} />{n.label}</a>
        {/each}
      </nav>
      <FolderList folders={data.dash.folders} workspaceId={data.activeWorkspaceId} {canCreate} />
      <ProjectList projects={data.dash.projects} />
      <div class="grow"></div>
      <Onboarding data={data.dash.onboarding} />
      <div class="bottom">
        <HelpMenu />
        <a class="settings" href="/settings/workspace" title="Settings" aria-label="Settings" data-testid="nav-settings"><Icon name="settings" size={16} /></a>
      </div>
    </aside>
    <div class="main">
      <header>
        <button class="menu" aria-label="Open menu" onclick={() => (shell.drawerOpen = true)} data-testid="menu-button"><DIcon name="menu" size={20} /></button>
        <button class="search" onclick={() => (shell.paletteOpen = true)} aria-label="Search (Ctrl K)" title="Search (Ctrl K)" data-testid="search-box">
          <Icon name="search" size={16} />
        </button>
        <span class="head-actions">
          {#if avatars.length > 1}
            <a class="avs" href="/settings/members" title="Members" data-testid="member-avatars">
              {#each avatars as m (m.userId)}<UserAvatar name={m.person.name} image={m.person.image} size={26} />{/each}
              {#if data.dash.members.length > avatars.length}<span class="more">+{data.dash.members.length - avatars.length}</span>{/if}
            </a>
          {/if}
          {#if canCreate}
            <Button icon="user" onclick={() => (inviteOpen = true)} data-testid="invite-button" class="inv">Invite</Button>
            <!-- narrow screens keep the invite as an icon, so the modal stays one click away (J-123) -->
            <Button icon="user" iconOnly aria-label="Invite" title="Invite" onclick={() => (inviteOpen = true)} data-testid="invite-button-sm" class="inv-sm" />
          {/if}
          {#if canCreate}<NewCapture />{/if}
        </span>
      </header>
      <div class="content">{@render children()}</div>
    </div>
  </div>
  {#if data.activeWorkspace}<InviteDialog workspace={data.activeWorkspace} bind:open={inviteOpen} />{/if}
{/if}

<style>
  .shell { display: grid; grid-template-columns: 250px minmax(0, 1fr); min-height: 100vh; }
  aside {
    position: sticky; top: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; gap: var(--nb-space-1);
    padding: var(--nb-space-2) var(--nb-space-3) var(--nb-space-3); border-right: 1px solid var(--nb-border); background: var(--nb-bg);
  }
  .ws { display: flex; align-items: center; min-height: 32px; padding: 0 0 var(--nb-space-3); }
  nav { display: flex; flex-direction: column; gap: 2px; }
  /* the site's nav: muted links that turn foreground, the current one at weight 500 on a quiet wash */
  nav a {
    display: flex; align-items: center; gap: 10px; height: var(--nb-control-md); padding: 0 8px; border-radius: var(--nb-radius-md);
    color: var(--nb-text-muted); text-decoration: none; letter-spacing: var(--nb-tracking-ui);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
  }
  nav a:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  nav a.active { background: var(--nb-surface-sunken); color: var(--nb-text); font-weight: var(--nb-weight-medium); }
  nav a:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .grow { flex: 1; }
  .bottom { display: flex; align-items: center; justify-content: space-between; padding-top: var(--nb-space-2); }
  .settings { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--nb-radius-md); color: var(--nb-text-muted); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out); }
  .settings:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .settings:focus-visible { outline: 2px solid var(--nb-focus); }
  .main { display: flex; flex-direction: column; min-width: 0; }
  /* the site's 48 px bar: canvas glass with a blur and an edge rule */
  header {
    position: sticky; top: 0; z-index: 5; display: flex; align-items: center; gap: 12px; height: 48px;
    padding: 0 24px; border-bottom: 1px solid var(--nb-border);
    background: color-mix(in srgb, var(--nb-bg) 82%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  }
  .menu { all: unset; display: none; place-items: center; width: 32px; height: 32px; border-radius: var(--nb-radius-md); cursor: pointer; color: var(--nb-text); }
  .menu:hover { background: var(--nb-surface-sunken); }
  .search {
    all: unset; box-sizing: border-box; display: grid; place-items: center; width: 32px; height: 32px;
    border-radius: var(--nb-radius-md); color: var(--nb-text-muted); cursor: pointer;
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .search:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .search:focus-visible, .menu:focus-visible { outline: 2px solid var(--nb-focus); }
  .head-actions { display: inline-flex; align-items: center; gap: var(--nb-space-2); margin-left: auto; }
  .avs { display: inline-flex; align-items: center; margin-right: 4px; text-decoration: none; }
  .avs :global(.ua) { margin-left: -6px; box-shadow: 0 0 0 2px var(--nb-bg); }
  .avs :global(.ua:first-child) { margin-left: 0; }
  .more { margin-left: 4px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .content { padding: var(--nb-space-6) var(--nb-space-6) var(--nb-space-12); }
  .scrim { display: none; }
  @media (max-width: 860px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside {
      position: fixed; z-index: 30; left: 0; top: 0; bottom: 0; width: 270px; transform: translateX(calc(-100% - 24px));
      /* closed, the drawer is hidden as well as moved off-canvas, so Tab skips its links; visibility
         flips after the slide on close and at once on open */
      visibility: hidden;
      transition: transform var(--nb-dur-med) var(--nb-ease-out), visibility 0s linear var(--nb-dur-med); box-shadow: var(--nb-shadow-lg);
    }
    aside.open { transform: none; visibility: visible; transition: transform var(--nb-dur-med) var(--nb-ease-out), visibility 0s; }
    .scrim.show { all: unset; display: block; position: fixed; inset: 0; z-index: 29; background: var(--nb-overlay); }
    .menu { display: grid; }
    aside { background: var(--nb-surface); border-right-color: var(--nb-border); }
    header { padding: 0 var(--nb-space-3); gap: 8px; }
    .content { padding: var(--nb-space-4) var(--nb-space-4) var(--nb-space-10); }
    .avs { display: none; }
  }
  .head-actions :global(.inv-sm) { display: none; }
  @media (max-width: 520px) {
    .head-actions :global(.inv) { display: none; }
    .head-actions :global(.inv-sm) { display: inline-flex; }
  }
</style>
