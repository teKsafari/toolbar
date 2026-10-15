<script lang="ts">
  // Share popover behind the caret of the copy button (J-118): two large cards, the full link
  // with dev tools and a content-only link (media, title, description, comments).
  import { toasts } from '@toolbar/ui';
  import VIcon from './VIcon.svelte';
  import { copyText } from './api.ts';
  import { setShareAccess, shareBaseUrl, shareSettings } from './actions.ts';
  import { useViewer } from './viewer.svelte.ts';

  let { onclose }: { onclose: () => void } = $props();
  const v = useViewer();
  let access: 'anyone' | 'workspace' | null = $state(null);
  $effect(() => {
    if (v.data.mode === 'member') void shareSettings(v).then((s) => (access = s.access)).catch(() => {});
  });

  let saving = $state(false);
  // General access (J-119): a full-width select at the bottom, for anyone who may edit the capture.
  async function changeAccess(next: 'anyone' | 'workspace') {
    if (next === access) return;
    const prev = access;
    access = next;
    saving = true;
    try {
      access = (await setShareAccess(v, next)).access;
      toasts.success(next === 'anyone' ? 'Anyone with the link can open it' : 'Only workspace members can open it');
    } catch {
      access = prev;
      toasts.error('Could not change who can open the link');
    } finally {
      saving = false;
    }
  }

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
    <div class="general">
      <label for="share-access-select">General access</label>
      {#if v.detail.canEdit}
        <div class="sel">
          <VIcon name={access === 'anyone' ? 'globe' : 'lock'} size={14} />
          <select id="share-access-select" value={access} disabled={saving} onchange={(e) => changeAccess((e.currentTarget as HTMLSelectElement).value as 'anyone' | 'workspace')} data-testid="share-access-select">
            <option value="anyone">Anyone with the link</option>
            <option value="workspace">Workspace members only</option>
          </select>
          <VIcon name="chevron-down" size={14} />
        </div>
      {/if}
      <p class="access" data-testid="share-access"><VIcon name={access === 'anyone' ? 'globe' : 'lock'} size={13} />{access === 'anyone' ? 'Anyone with the link can view and comment.' : 'Only members of this workspace can open the link.'}</p>
    </div>
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
  .general { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--nb-border); }
  .general label { font-size: var(--nb-text-sm); font-weight: 600; color: var(--nb-text); }
  .sel { position: relative; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text-muted); }
  .sel:focus-within { outline: 2px solid var(--nb-focus); }
  .sel select { all: unset; flex: 1; height: 100%; color: var(--nb-text); font-size: var(--nb-text-md); cursor: pointer; }
  .sel select option { color: initial; }
  .access { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
</style>
