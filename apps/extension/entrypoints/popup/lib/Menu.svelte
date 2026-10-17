<script lang="ts">
  // The popup's three-dot menu (J-176, J-177): dark, 28 px rows with leading line icons.
  import { browser } from 'wxt/browser';
  import { Icon, type IconName } from '@toolbar/ui';
  import { HELP_LINKS, SHORTCUTS_URL } from '@toolbar/shared/areas/ext-ui';
  import { store } from './store.svelte';
  import { send } from '../../capture.content/ui/send';

  let open = $state(false);
  let root: HTMLElement | undefined = $state();
  let restarting = $state(false);

  $effect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => root && !e.composedPath().includes(root) && (open = false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (open = false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  });

  const tab = (url: string) => {
    void browser.tabs.create({ url });
    window.close();
  };

  const items: { id: string; label: string; icon: IconName; run: () => void; when?: () => boolean }[] = [
    { id: 'settings', label: 'Settings', icon: 'settings', run: () => (store.screen = 'settings') },
    { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', run: () => tab(SHORTCUTS_URL) },
    { id: 'docs', label: 'Help and docs', icon: 'book', run: () => tab(HELP_LINKS.docs) },
    {
      id: 'report',
      label: 'Report a problem',
      icon: 'bug',
      // a recording link to the server admin when the server names one, else the issue tracker
      run: () => tab(store.bootstrap?.data.supportRecordingLink ?? HELP_LINKS.issues),
    },
    {
      // D-205: admins, or the person who added this site
      id: 'remove-site',
      label: 'Remove this site',
      icon: 'trash',
      when: () => !!store.context?.site.removable && store.tabId != null,
      run: () =>
        void send('site.remove', { tabId: store.tabId! }).then((r) => {
          if (!r.ok) store.error = r.message ?? 'Could not remove the site';
          return store.load();
        }),
    },
    {
      id: 'restart',
      label: 'Restart extension',
      icon: 'power',
      run: () => {
        restarting = true;
        void send('ext.restart', {});
      },
    },
    { id: 'signout', label: 'Sign out', icon: 'logout', run: () => void send('auth.signOut', {}).then(() => store.load()), when: () => store.signedIn },
  ];
</script>

<span class="wrap" bind:this={root}>
  <button class="icon-btn" type="button" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} data-menu-button onclick={() => (open = !open)}>
    <Icon name="more" size={16} />
  </button>
  {#if open}
    <div class="menu" role="menu" data-menu>
      {#each items.filter((i) => !i.when || i.when()) as item (item.id)}
        <button
          type="button"
          role="menuitem"
          data-menu-item={item.id}
          onclick={() => {
            if (item.id !== 'restart') open = false;
            item.run();
          }}
        >
          <Icon name={item.id === 'restart' && restarting ? 'spinner' : item.icon} size={14} />
          <span>{item.id === 'restart' && restarting ? 'Restarting' : item.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-flex;
  }
  .menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    min-width: 190px;
    padding: 6px;
    border-radius: var(--nb-radius-lg);
    border: 1px solid var(--nb-border);
    background: var(--nb-surface-raised);
    color: var(--nb-text);
    box-shadow: var(--nb-shadow-lg);
    transform-origin: top right;
    animation: nb-menu-in var(--nb-dur-med) var(--nb-ease-out);
  }
  @keyframes nb-menu-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu {
      animation: none;
    }
  }
  .menu :global(svg) {
    color: var(--nb-text-muted);
  }
  .menu button {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: var(--nb-radius-sm);
    cursor: pointer;
    font: var(--nb-text-md) / 1 var(--nb-font-sans);
  }
  .menu button:hover,
  .menu button:focus-visible {
    background: var(--nb-surface-sunken);
  }
  .menu button:focus-visible {
    outline: 2px solid var(--nb-focus);
    outline-offset: -2px;
  }
</style>
