<script lang="ts">
  // A project's embed (D-210, D-211) on Settings, Projects, once it has a key: the script tag a site
  // owner adds, and the npm package behind a disclosure. Admins rotate the key and turn it off
  // (turning it on is the page's Embed button); members see the snippet read-only.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import { EMBED_FILES_PATH, EMBED_PACKAGE_FILE, EMBED_SCRIPT_PATH, type Project } from '@toolbar/shared/api';
  import Confirm from './Confirm.svelte';
  import { api, copyText, errMsg } from './api.ts';

  let { project, admin, publicUrl }: { project: Project; admin: boolean; publicUrl: string } = $props();

  let busy = $state(false);
  let confirm = $state<'rotate' | 'off' | null>(null);

  const key = $derived(project.embedKey);
  const tag = $derived(`<script src="${publicUrl}${EMBED_SCRIPT_PATH}" data-key="${key}"><\/script>`);
  const npm = $derived(`npm i ${publicUrl}${EMBED_FILES_PATH}/${EMBED_PACKAGE_FILE}

import { init } from '@open-toolbar/embed';
init({ key: '${key}', server: '${publicUrl}' });`);

  async function copy(text: string, what: string) {
    if (await copyText(text)) toasts.success(`${what} copied`);
  }

  async function run(name: 'embed.rotateKey' | 'embed.deleteKey', done: string) {
    busy = true;
    try {
      await api(name, { params: { id: project.id } });
      toasts.success(done);
      await invalidateAll();
    } catch (x) {
      toasts.error(errMsg(x));
    } finally {
      busy = false;
    }
  }
</script>

{#if key}
  <div class="embed" data-testid="project-embed">
    <div class="eh">
      <span class="label">Embed</span>
      {#if admin}
        <Button size="sm" variant="ghost" onclick={() => (confirm = 'rotate')} disabled={busy} data-testid="embed-rotate">Rotate key</Button>
        <Button size="sm" variant="ghost" onclick={() => (confirm = 'off')} disabled={busy} data-testid="embed-off">Turn off</Button>
      {/if}
    </div>
    <div class="code">
      <pre data-testid="embed-snippet">{tag}</pre>
      <Button size="sm" icon="copy" onclick={() => copy(tag, 'Script tag')} data-testid="embed-copy">Copy</Button>
    </div>
    <details>
      <summary>npm package</summary>
      <div class="code">
        <pre data-testid="embed-npm">{npm}</pre>
        <Button size="sm" icon="copy" onclick={() => copy(npm, 'Snippet')} data-testid="embed-npm-copy">Copy</Button>
      </div>
    </details>
  </div>
{/if}

<Confirm
  open={confirm !== null}
  title={confirm === 'rotate' ? 'Rotate the embed key?' : 'Turn off the embed?'}
  message={confirm === 'rotate' ? 'The current key stops working now. Sites show the toolbar again once their snippet has the new key.' : 'The key stops working now, and sites that use it no longer show the toolbar.'}
  confirmLabel={confirm === 'rotate' ? 'Rotate' : 'Turn off'}
  onconfirm={async () => {
    const c = confirm;
    confirm = null;
    if (c === 'rotate') await run('embed.rotateKey', 'Key rotated');
    else if (c === 'off') await run('embed.deleteKey', 'Embed off');
  }}
/>

<style>
  .embed { display: flex; flex-direction: column; gap: 6px; }
  .eh { display: flex; align-items: center; gap: 4px; }
  .label { flex: 1; font-size: var(--nb-text-sm); font-weight: var(--nb-weight-medium); color: var(--nb-text-muted); }
  .code { position: relative; }
  .code :global(button) { position: absolute; top: 6px; right: 6px; }
  pre { margin: 0; padding: 10px 84px 10px 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); font: var(--nb-text-sm) / 1.6 var(--nb-font-mono, monospace); white-space: pre-wrap; overflow-wrap: anywhere; }
  details { font-size: var(--nb-text-sm); }
  summary { cursor: pointer; color: var(--nb-text-muted); width: max-content; }
  details[open] summary { margin-bottom: 6px; }
</style>
