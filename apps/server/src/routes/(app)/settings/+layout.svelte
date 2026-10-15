<script lang="ts">
  // J-171: settings have their own layout: a back link and a left nav in three groups,
  // workspace, apps and tools, account. Content sits in a centred column of sections.
  // Shared nav (docs/parallel.md): auth owns browsers and tokens, agent owns mcp and cli.
  // Pages of paused features (docs/scope.md: audit log, integrations, CLI, notification mail)
  // show only when their flag is on.
  import { page } from '$app/state';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { shell } from '#lib/components/dashboard/shell.svelte.ts';

  let { data, children } = $props();
  const isAdmin = $derived(data.activeWorkspace?.role === 'admin');
  const f = $derived(data.features);
  const groups = $derived([
    {
      label: 'Workspace',
      items: [
        ['workspace', 'General'],
        ['members', 'Members'],
        ['privacy', 'Privacy and data'],
        ...(isAdmin && f.adminExtras ? [['audit', 'Audit log']] : []),
      ],
    },
    {
      label: 'Apps and tools',
      items: [
        ...(f.trackers || f.slack ? [['integrations', 'Integrations']] : []),
        ['sdk', 'SDK'],
        ['mcp', 'MCP'],
        ...(f.cli ? [['cli', 'CLI']] : []),
        ...(isAdmin ? [['webhooks', 'Webhooks']] : []),
        ['api', 'API'],
      ],
    },
    {
      label: 'Account',
      items: [
        ['profile', 'Profile'],
        ...(f.email ? [['notifications', 'Notifications']] : []),
        ['tokens', 'API tokens'],
        ['browsers', 'Connected browsers'],
      ],
    },
    ...(data.instanceAdmin ? [{ label: 'Instance', items: [['server', 'Server']] }] : []),
  ] as { label: string; items: [string, string][] }[]);
  const here = $derived(page.url.pathname.split('/')[2] ?? '');
</script>

<div class="settings">
  <nav aria-label="Settings" class:open={shell.drawerOpen}>
    <a class="back" href="/" data-testid="settings-back"><DIcon name="arrow-left" size={16} />Back to captures</a>
    <div class="ws">{data.activeWorkspace?.name ?? 'Settings'}</div>
    {#each groups as g (g.label)}
      <div class="glabel">{g.label}</div>
      {#each g.items as [slug, label] (slug)}
        <a href="/settings/{slug}" class:active={here === slug} data-testid="settings-nav-{slug}" onclick={() => (shell.drawerOpen = false)}>{label}</a>
      {/each}
    {/each}
  </nav>
  <div class="mobilebar">
    <a href="/" aria-label="Back to captures"><DIcon name="arrow-left" size={18} /></a>
    <strong>Settings</strong>
    <button aria-label="Settings menu" onclick={() => (shell.drawerOpen = !shell.drawerOpen)} data-testid="settings-menu"><DIcon name="menu" size={20} /></button>
  </div>
  <main><div class="col">{@render children()}</div></main>
</div>

<style>
  .settings { display: grid; grid-template-columns: 240px minmax(0, 1fr); min-height: 100vh; }
  nav {
    position: sticky; top: 0; height: 100vh; overflow-y: auto; display: flex; flex-direction: column; gap: 1px;
    padding: 16px 12px; border-right: 1px solid var(--nb-border); background: var(--nb-surface-2);
  }
  .back { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px; margin-bottom: 10px; color: var(--nb-text-muted); text-decoration: none; border-radius: var(--nb-radius-md); }
  .back:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .ws { padding: 0 8px 8px; font-weight: var(--nb-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .glabel { padding: 14px 8px 4px; font-size: var(--nb-text-xs); color: var(--nb-text-faint); font-weight: var(--nb-weight-semibold); }
  nav a:not(.back) { padding: 6px 10px; border-radius: var(--nb-radius-md); color: var(--nb-text-muted); text-decoration: none; }
  nav a:not(.back):hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  nav a.active { background: var(--nb-accent-tint); color: var(--nb-accent-text); font-weight: var(--nb-weight-medium); }
  main { padding: 32px 24px 64px; min-width: 0; }
  .col { max-width: 680px; margin: 0 auto; }
  .mobilebar { display: none; }
  @media (max-width: 860px) {
    .settings { grid-template-columns: minmax(0, 1fr); }
    nav { position: fixed; z-index: 30; top: 52px; left: 0; bottom: 0; height: auto; width: 260px; transform: translateX(calc(-100% - 24px)); transition: transform var(--nb-dur-med) var(--nb-ease-out); box-shadow: var(--nb-shadow-lg); }
    nav.open { transform: none; }
    .mobilebar {
      position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; height: 52px; padding: 0 12px;
      border-bottom: 1px solid var(--nb-border); background: var(--nb-surface);
    }
    .mobilebar a, .mobilebar button { all: unset; display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--nb-radius-md); cursor: pointer; color: var(--nb-text); }
    main { padding: 18px 14px 48px; }
  }
</style>
