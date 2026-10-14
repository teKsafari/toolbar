<script lang="ts">
  // J-170: round help button bottom-left of the sidebar: docs, source repository, issue tracker,
  // extension install, keyboard shortcuts, and the theme (light, dark, system).
  import { Popover } from '@toolbar/ui';
  import DIcon from './DIcon.svelte';
  import { COMMANDS } from '@toolbar/shared';
  import { HELP_LINKS } from './links.ts';

  type Theme = 'system' | 'light' | 'dark';
  let theme = $state<Theme>('system');
  $effect(() => {
    try {
      theme = (localStorage.getItem('nib.theme') as Theme) || 'system';
    } catch {
      /* storage blocked */
    }
  });
  function setTheme(t: Theme) {
    theme = t;
    try {
      localStorage.setItem('nib.theme', t);
    } catch {
      /* ignore */
    }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
</script>

<Popover label="Help" placement="top-start">
  {#snippet trigger({ toggle, open, id })}
    <button class="help" onclick={toggle} aria-expanded={open} aria-controls={id} aria-label="Help" title="Help" data-testid="help-button">
      <DIcon name="help" size={18} />
    </button>
  {/snippet}
  {#snippet children({ close })}
    <div class="menu" role="menu" data-testid="help-menu">
      <a role="menuitem" href={HELP_LINKS.docs} target="_blank" rel="noopener" onclick={close}><DIcon name="book" />Documentation</a>
      <a role="menuitem" href={HELP_LINKS.repo} target="_blank" rel="noopener" onclick={close}><DIcon name="code" />Source code</a>
      <a role="menuitem" href={HELP_LINKS.issues} target="_blank" rel="noopener" onclick={close}><DIcon name="issue" />Report a problem</a>
      <a role="menuitem" href={HELP_LINKS.install} onclick={close}><DIcon name="puzzle" />Install the extension</a>
      <hr />
      <div class="label">Shortcuts</div>
      <div class="kb"><span>Search</span><kbd>Ctrl K</kbd></div>
      <div class="kb"><span>Capture menu (extension)</span><kbd>{COMMANDS._execute_action.key}</kbd></div>
      <div class="kb"><span>Screenshot (extension)</span><kbd>{COMMANDS['screenshot-mode'].key}</kbd></div>
      <hr />
      <div class="label">Theme</div>
      <div class="seg" role="radiogroup" aria-label="Theme">
        {#each [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as const as [v, l, ic] (v)}
          <button role="radio" aria-checked={theme === v} onclick={() => setTheme(v)} data-theme-choice={v}><DIcon name={ic} size={14} />{l}</button>
        {/each}
      </div>
    </div>
  {/snippet}
</Popover>

<style>
  .help {
    all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--nb-border);
    background: var(--nb-surface); color: var(--nb-text-muted); cursor: pointer;
  }
  .help:hover { color: var(--nb-text); background: var(--nb-surface-sunken); }
  .help:focus-visible { outline: 2px solid var(--nb-focus); }
  .menu { display: flex; flex-direction: column; gap: 1px; width: 240px; }
  a { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md); color: var(--nb-text); text-decoration: none; }
  a:hover { background: var(--nb-surface-sunken); }
  hr { border: 0; border-top: 1px solid var(--nb-border); margin: 6px 0; width: 100%; }
  .label { padding: 2px 8px 4px; font-size: var(--nb-text-xs); color: var(--nb-text-faint); font-weight: var(--nb-weight-semibold); }
  .kb { display: flex; justify-content: space-between; padding: 3px 8px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  kbd { font: var(--nb-text-xs) var(--nb-font-mono); }
  .seg { display: flex; gap: 2px; padding: 2px; margin: 0 6px 4px; border-radius: var(--nb-radius-md); background: var(--nb-surface-sunken); }
  .seg button {
    all: unset; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 0;
    border-radius: var(--nb-radius-sm); font-size: var(--nb-text-sm); color: var(--nb-text-muted); cursor: pointer;
  }
  .seg button[aria-checked='true'] { background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
</style>
