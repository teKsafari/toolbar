<script lang="ts">
  // Share popover behind the caret of the copy button (J-118): two large cards, the full link
  // with dev tools and a content-only link (media, title, description, comments).
  import { toasts } from '@toolbar/ui';
  import VIcon from './VIcon.svelte';
  import { copyText } from './api.ts';
  import { shareBaseUrl, shareSettings } from './actions.ts';
  import { useViewer } from './viewer.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();
  const v = useViewer();
  let access: 'anyone' | 'workspace' | null = $state(null);
  $effect(() => {
    if (v.data.mode === 'member') void shareSettings(v).then((s) => (access = s.access)).catch(() => {});
  });

  async function copy(devtools: boolean) {
    const url = await shareBaseUrl(v, devtools);
    if (!url) return;
    if (await copyText(url)) toasts.success(devtools ? 'Link copied' : 'Link without dev tools copied');
    onclose();
  }
</script>

<div class="share" role="dialog" aria-label="Share" data-testid="share-popover">
  <p class="head">Share this capture</p>
  <button type="button" class="card" onclick={() => copy(true)} data-testid="share-full">
    <span class="ic"><VIcon name="console" size={20} /></span>
    <span class="txt"><strong>Full link</strong><span>Media, comments and every dev tools tab: console, network, actions, info.</span></span>
    <VIcon name="copy" size={16} />
  </button>
  <button type="button" class="card" onclick={() => copy(false)} data-testid="share-content">
    <span class="ic"><VIcon name="screenshot" size={20} /></span>
    <span class="txt"><strong>Without dev tools</strong><span>Media, title, description and comments only. Good for people outside the team.</span></span>
    <VIcon name="copy" size={16} />
  </button>
  {#if access}
    <p class="access" data-testid="share-access"><VIcon name={access === 'anyone' ? 'globe' : 'lock'} size={13} />{access === 'anyone' ? 'Anyone with the link can view and comment.' : 'Only members of this workspace can open the link.'}</p>
  {/if}
</div>

<style>
  .share { width: 360px; max-width: calc(100vw - 32px); padding: 12px; border-radius: var(--nb-radius-lg); background: var(--nb-surface); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); display: flex; flex-direction: column; gap: 8px; }
  .head { margin: 0 0 2px; font-weight: 600; }
  .card { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); cursor: pointer; color: var(--nb-text-muted); }
  .card:hover { border-color: var(--nb-accent); background: var(--nb-accent-tint); }
  .card:focus-visible { outline: 2px solid var(--nb-focus); }
  .ic { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--nb-radius-md); background: var(--nb-surface-sunken); color: var(--nb-text); flex: none; }
  .txt { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: var(--nb-text-md); }
  .txt strong { color: var(--nb-text); font-size: var(--nb-text-base); }
  .access { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
</style>
