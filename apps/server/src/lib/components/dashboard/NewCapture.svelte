<script lang="ts">
  // J-018: the header's new-capture button asks the extension to open its capture menu on this
  // page. Without the extension it explains how to get it and lists the shortcuts.
  import { Button, Popover } from '@toolbar/ui';
  import { COMMANDS, PRODUCT_NAME } from '@toolbar/shared';
  import { NEW_CAPTURE_EVENT, EXTENSION_MARK_ATTR } from '@toolbar/shared/areas/dashboard';
  import DIcon from './DIcon.svelte';

  let { label = 'New capture', variant = 'primary' }: { label?: string; variant?: 'primary' | 'secondary' } = $props();
  let open = $state(false);

  function start(toggle: () => void) {
    const has = document.documentElement.hasAttribute(EXTENSION_MARK_ATTR) || !!document.querySelector('toolbar-root');
    if (has) {
      window.dispatchEvent(new CustomEvent(NEW_CAPTURE_EVENT, { detail: { from: 'dashboard' } }));
      return;
    }
    toggle();
  }
</script>

<Popover bind:open label="Make a capture" placement="bottom-end">
  {#snippet trigger({ toggle, open: o, id })}
    <Button {variant} icon="plus" onclick={() => start(toggle)} aria-expanded={o} aria-controls={id} data-testid="new-capture">{label}</Button>
  {/snippet}
  {#snippet children({ close })}
    <div class="np" data-testid="new-capture-help">
      <strong>Capture with the extension</strong>
      <p>The {PRODUCT_NAME} extension takes screenshots, records the tab or screen and saves console and network logs with them.</p>
      <ul>
        <li><DIcon name="screenshot" size={14} />Screenshot <kbd>{COMMANDS['screenshot-mode'].key}</kbd></li>
        <li><DIcon name="record" size={14} />Record the tab <kbd>{COMMANDS['record-tab'].key}</kbd></li>
        <li><DIcon name="replay" size={14} />Instant replay <kbd>{COMMANDS['instant-replay'].key}</kbd></li>
        <li><DIcon name="logo" size={14} />Capture menu <kbd>{COMMANDS._execute_action.key}</kbd></li>
      </ul>
      <a href="/settings/browsers" onclick={close}>Install and connect the extension</a>
      <p class="or">Or drop a video file on the captures grid to upload it.</p>
    </div>
  {/snippet}
</Popover>

<style>
  .np { width: 300px; display: flex; flex-direction: column; gap: 8px; padding: 4px; font-size: var(--nb-text-md); }
  p { margin: 0; color: var(--nb-text-muted); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: center; gap: 8px; }
  kbd { margin-left: auto; font: var(--nb-text-xs) var(--nb-font-mono); color: var(--nb-text-faint); }
  .or { font-size: var(--nb-text-sm); }
</style>
