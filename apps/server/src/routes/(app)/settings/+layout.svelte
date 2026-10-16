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
        ['projects', 'Projects'],
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
    padding: 8px 12px 16px; border-right: 1px solid var(--nb-border); background: var(--nb-bg);
  }
  .back { display: inline-flex; align-items: center; gap: 8px; height: var(--nb-control-md); padding: 0 8px; margin-bottom: 10px; color: var(--nb-text-muted); text-decoration: none; border-radius: var(--nb-radius-md); transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out); }
  .back:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .ws { padding: 0 8px 4px; font-weight: var(--nb-weight-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: var(--nb-tracking-ui); }
  .glabel { padding: 16px 8px 6px; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  nav a:not(.back) {
    display: flex; align-items: center; height: var(--nb-control-md); padding: 0 8px; border-radius: var(--nb-radius-md);
    color: var(--nb-text-muted); text-decoration: none; letter-spacing: var(--nb-tracking-ui);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
  }
  nav a:not(.back):hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  nav a.active { background: var(--nb-surface-sunken); color: var(--nb-text); font-weight: var(--nb-weight-medium); }
  nav a:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  main { padding: 40px 24px 64px; min-width: 0; }
  .col { max-width: 680px; margin: 0 auto; }
  .mobilebar { display: none; }
  @media (max-width: 860px) {
    .settings { grid-template-columns: minmax(0, 1fr); }
    nav { position: fixed; z-index: 30; top: 48px; left: 0; bottom: 0; height: auto; width: 260px; background: var(--nb-surface); transform: translateX(calc(-100% - 24px)); visibility: hidden; transition: transform var(--nb-dur-med) var(--nb-ease-out), visibility 0s linear var(--nb-dur-med); box-shadow: var(--nb-shadow-lg); }
    /* closed, the nav is hidden too, so Tab skips its links (as the app drawer) */
    nav.open { transform: none; visibility: visible; transition: transform var(--nb-dur-med) var(--nb-ease-out), visibility 0s; }
    .mobilebar {
      position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; height: 48px; padding: 0 12px;
      border-bottom: 1px solid var(--nb-border); background: color-mix(in srgb, var(--nb-bg) 82%, transparent); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    }
    .mobilebar a, .mobilebar button { all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--nb-radius-md); cursor: pointer; color: var(--nb-text); }
    .mobilebar a:hover, .mobilebar button:hover { background: var(--nb-surface-sunken); }
    main { padding: 20px 16px 48px; }
  }
  .mobilebar a:focus-visible, .mobilebar button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
</style>
