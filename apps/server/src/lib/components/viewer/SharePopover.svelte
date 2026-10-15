<script lang="ts">
  // Share popover behind the caret of the copy button (J-118): two tiles side by side, the full
  // link with dev tools and a content-only link (media, title, description, comments).
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
  <!-- two tiles side by side with a short caption each, then General access (J-118, J-119);
       the longer explanation stays in each tile's tooltip -->
  <div class="tiles">
    <button type="button" class="card" onclick={() => copy(true)} title="Media, comments and every dev tools tab: console, network, actions, info." data-testid="share-full">
      <span class="ic"><VIcon name="console" size={22} /><span class="cp"><VIcon name="copy" size={13} /></span></span>
      <span class="cap">Full link</span>
    </button>
    <button type="button" class="card" onclick={() => copy(false)} title="Media, title, description and comments only. Good for people outside the team." data-testid="share-content">
      <span class="ic"><VIcon name="screenshot" size={22} /><span class="cp"><VIcon name="copy" size={13} /></span></span>
      <span class="cap">Without dev tools</span>
    </button>
  </div>
  {#if access}
    <div class="general">
      <label for="share-access-select">General access</label>
      {#if v.detail.canEdit}
        <div class="sel">
          <VIcon name={access === 'anyone' ? 'globe' : 'lock'} size={14} />
          <select id="share-access-select" value={access} disabled={saving} aria-describedby="share-access-line" onchange={(e) => changeAccess((e.currentTarget as HTMLSelectElement).value as 'anyone' | 'workspace')} data-testid="share-access-select">
            <option value="anyone">Anyone with the link</option>
            <option value="workspace">Workspace members only</option>
          </select>
          <VIcon name="chevron-down" size={14} />
        </div>
      {/if}
      <!-- an editor reads the choice in the select; the line is its description for screen readers -->
      <p class="access" class:sr={v.detail.canEdit} id="share-access-line" data-testid="share-access"><VIcon name={access === 'anyone' ? 'globe' : 'lock'} size={13} />{access === 'anyone' ? 'Anyone with the link can view and comment.' : 'Only members of this workspace can open the link.'}</p>
    </div>
  {/if}
</div>

<style>
  .share { width: 360px; max-width: calc(100vw - 32px); padding: 12px; border-radius: var(--nb-radius-lg); background: var(--nb-surface); border: 1px solid var(--nb-border); box-shadow: var(--nb-shadow-lg); display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
  .head { margin: 0; font-weight: 600; }
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card { all: unset; box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch; gap: 6px; padding: 6px 6px 8px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); cursor: pointer; color: var(--nb-text); text-align: center; min-width: 0; }
  .card:hover { border-color: var(--nb-accent); background: var(--nb-accent-tint); }
  .card:focus-visible { outline: 2px solid var(--nb-focus); }
  .ic { position: relative; display: grid; place-items: center; height: 64px; border-radius: var(--nb-radius-sm, 6px); background: var(--nb-surface-sunken); color: var(--nb-text); }
  .cp { position: absolute; top: 6px; right: 6px; color: var(--nb-text-muted); }
  .cap { font-size: var(--nb-text-md); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .general { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 1px solid var(--nb-border); }
  .general label { font-size: var(--nb-text-sm); font-weight: 600; color: var(--nb-text); }
  .sel { position: relative; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text-muted); }
  .sel:focus-within { outline: 2px solid var(--nb-focus); }
  .sel select { all: unset; flex: 1; height: 100%; color: var(--nb-text); font-size: var(--nb-text-md); cursor: pointer; }
  .sel select option { color: initial; }
  .access { display: flex; align-items: center; gap: 6px; margin: 0; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
