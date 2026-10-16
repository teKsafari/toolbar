<script lang="ts">
  // Sidebar projects (D-200): captures grouped by the app they were made on. Each row opens the
  // project's page with its captures; the heading collapses the list.
  import { page } from '$app/state';
  import DIcon from './DIcon.svelte';
  import { shell } from './shell.svelte.ts';

  interface P {
    id: string;
    name: string;
    origins: string[];
    captureCount: number;
  }
  let { projects }: { projects: P[] } = $props();

  let collapsed = $state(false);
  try {
    collapsed = typeof localStorage !== 'undefined' && localStorage.getItem('tb.projects.collapsed') === '1';
  } catch {
    /* storage blocked */
  }
  function toggle() {
    collapsed = !collapsed;
    try {
      localStorage.setItem('tb.projects.collapsed', collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }
  const activeId = $derived(page.url.pathname.startsWith('/p/') ? page.url.pathname.slice(3).split('/')[0] : null);
</script>

{#if projects.length}
  <div class="projects">
    <div class="head">
      <button class="title" onclick={toggle} aria-expanded={!collapsed} data-testid="projects-heading">
        <DIcon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} />Projects
      </button>
    </div>
    {#if !collapsed}
      <ul role="list" data-testid="project-list">
        {#each projects as p (p.id)}
          <li>
            <a href="/p/{p.id}" class:active={activeId === p.id} title={p.origins.join(', ')} data-project={p.id} data-testid="project-link" onclick={() => (shell.drawerOpen = false)}>
              <DIcon name="globe" size={16} />
              <span class="name">{p.name}</span>
              <span class="count" data-testid="project-count">{p.captureCount}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .projects { margin-top: 14px; }
  .head { display: flex; align-items: center; padding: 0 4px 0 2px; }
  .title {
    all: unset; display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px; border-radius: var(--nb-radius-sm);
    font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); cursor: pointer;
  }
  .title:hover { color: var(--nb-text); }
  .title:focus-visible { outline: 2px solid var(--nb-focus); }
  ul { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  a {
    display: flex; align-items: center; gap: 10px; height: var(--nb-control-md); padding: 0 8px; border-radius: var(--nb-radius-md);
    color: var(--nb-text-muted); text-decoration: none; letter-spacing: var(--nb-tracking-ui);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
  }
  a:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  a.active { background: var(--nb-surface-sunken); color: var(--nb-text); font-weight: var(--nb-weight-medium); }
  a:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
  .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count { font: var(--nb-text-xs) var(--nb-font-mono); font-variant-numeric: tabular-nums; color: var(--nb-text-faint); }
  a:hover .count, a.active .count { color: var(--nb-text-muted); }
</style>
