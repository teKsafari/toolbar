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
      theme = (localStorage.getItem('tb.theme') as Theme) || 'system';
    } catch {
      /* storage blocked */
    }
  });
  function setTheme(t: Theme) {
    theme = t;
    try {
      localStorage.setItem('tb.theme', t);
    } catch {
      /* ignore */
    }
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }
</script>

<!-- the top layer: the sidebar is a scroll container narrower than this menu (see layer in Popover) -->
<Popover label="Help" placement="top-start" layer>
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
    all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--nb-border-strong);
    background: var(--nb-surface); color: var(--nb-text-muted); cursor: pointer; box-shadow: var(--nb-shadow-sm);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .help:hover { color: var(--nb-text); background: var(--nb-surface-sunken); }
  .help:focus-visible { outline: 2px solid var(--nb-focus); }
  /* 280 px keeps the longest shortcut row on one line; the top layer clamps it to the viewport */
  .menu { display: flex; flex-direction: column; gap: 1px; width: 280px; max-width: calc(100vw - 30px); }
  a { display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md); color: var(--nb-text); text-decoration: none; }
  a:hover { background: var(--nb-surface-sunken); }
  hr { border: 0; border-top: 1px solid var(--nb-border); margin: 6px 0; width: 100%; }
  .label { padding: 4px 8px 4px; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  /* the key never wraps or stretches; a long label wraps beside it instead */
  .kb { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 3px 8px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .kb span { min-width: 0; overflow-wrap: anywhere; }
  kbd { flex: none; white-space: nowrap; font: var(--nb-text-xs) var(--nb-font-mono); padding: 0 4px; border: 1px solid var(--nb-border); border-radius: 4px; background: var(--nb-surface-2); }
  .seg { display: flex; gap: 2px; padding: 2px; margin: 0 6px 4px; border-radius: var(--nb-radius-pill); background: var(--nb-surface-sunken); }
  .seg button {
    all: unset; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 0;
    border-radius: var(--nb-radius-pill); font-size: var(--nb-text-sm); color: var(--nb-text-muted); cursor: pointer; white-space: nowrap; min-width: 0;
  }
  .seg button[aria-checked='true'] { background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .seg button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
</style>
