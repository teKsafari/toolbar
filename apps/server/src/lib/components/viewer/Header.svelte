<script lang="ts">
  import { focusNow } from '#lib/components/focus.ts';
  // Capture page header (J-112, J-113, J-114, J-117, J-118, J-121): home, folder chip, three-dot
  // menu (move to folder, delete), send-to-app split button and the copy-link split button.
  // J-138, J-140: send-to-app opens the tracker field form (repo, labels, assignee, milestone from
  // the tracker API, remembered values) for the picked app, or offers connect items when none.
  // Signed-out viewers see the product mark with sign-in and sign-up only. Send to app is a
  // paused feature (docs/scope.md, FEATURE_TRACKERS and FEATURE_SLACK): hidden while both are off.
  import { goto } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import { PRODUCT_NAME } from '@toolbar/shared';
  import type { Integration, LinkedIssue } from '@toolbar/shared/api';
  import TrackerFields from '#lib/components/dashboard/TrackerFields.svelte';
  import FormModal from '#lib/components/dashboard/Modal.svelte';
  import type { Fields } from '#lib/components/dashboard/fields.ts';
  import VIcon from './VIcon.svelte';
  import Dropdown from './Dropdown.svelte';
  import Menu, { type MenuItem } from './Menu.svelte';
  import Modal from './Modal.svelte';
  import SharePopover from './SharePopover.svelte';
  import { call, copyText } from './api.ts';
  import { shareBaseUrl } from './actions.ts';
  import { useViewer } from './viewer.svelte.ts';

  const v = useViewer();
  let menu: 'more' | 'send' | 'share' | null = $state(null);
  let copied = $state(false);
  let confirmDelete = $state(false);
  let newFolder = $state(false);
  let folderName = $state('');
  let busy = $state(false);
  const member = $derived(v.data.mode === 'member' && !!v.data.me);
  const folder = $derived(v.detail.folder);
  const next = $derived(typeof location !== 'undefined' ? location.pathname + location.search : '/');

  async function copyLink() {
    const url = await shareBaseUrl(v);
    if (!url) return;
    if (await copyText(url)) {
      copied = true;
      toasts.success('Link copied');
      setTimeout(() => (copied = false), 2000);
    } else toasts.error('Could not copy the link');
  }

  async function move(folderId: string | null) {
    try {
      await call('captures.update', { id: v.detail.id }, { folderId });
      const f = folderId ? v.folders.find((x) => x.id === folderId) : null;
      v.detail.folderId = folderId;
      v.detail.folder = f ? { id: f.id, shortId: f.id.replace(/-/g, '').slice(-10), name: f.name } : null;
      toasts.success(f ? `Moved to ${f.name}` : 'Moved out of the folder');
    } catch (e) {
      toasts.error(`Not moved: ${(e as Error).message}`);
    }
  }
  async function createAndMove() {
    const name = folderName.trim();
    if (!name) return;
    busy = true;
    try {
      const f = await call<{ id: string; name: string }>('folders.create', { workspaceId: v.detail.workspaceId }, { name });
      v.folders = [...v.folders, { id: f.id, name: f.name }];
      newFolder = false;
      folderName = '';
      await move(f.id);
    } catch (e) {
      toasts.error(`Folder not created: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }
  async function remove() {
    busy = true;
    try {
      await call('captures.delete', { id: v.detail.id });
      confirmDelete = false;
      toasts.success('Capture deleted');
      await goto('/', { replaceState: true });
    } catch (e) {
      toasts.error(`Not deleted: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }
  // the field form for the picked app (J-140)
  let target = $state<Integration | null>(null);
  let formOpen = $state(false);
  let fields = $state<Fields>({ labels: [], assignees: [] });
  let issueTitle = $state('');
  let sending = $state(false);
  function openForm(i: { id: string; type: string; name: string; defaultTarget?: string | null }) {
    menu = null;
    target = { id: i.id, workspaceId: v.detail.workspaceId, type: i.type as Integration['type'], name: i.name, account: null, baseUrl: null, defaultTarget: i.defaultTarget ?? null, status: 'ok', lastError: null, createdBy: null, createdAt: '' };
    fields = { labels: [], assignees: [] };
    issueTitle = v.detail.title || '';
    formOpen = true;
  }
  async function send() {
    if (!target) return;
    const t = target;
    sending = true;
    try {
      const issue = await call<LinkedIssue>('integrations.send', { id: v.detail.id }, { integrationId: t.id, fields: { ...$state.snapshot(fields), title: issueTitle } });
      formOpen = false;
      try {
        localStorage.setItem('nib.viewer.lastSend', t.id);
      } catch {
        /* private mode */
      }
      if (t.type === 'slack') toasts.success(`Posted to ${t.name}`);
      else {
        toasts.success(`Sent to ${t.name}: ${issue.key}`, { action: { label: 'Open', run: () => window.open(issue.url, '_blank', 'noopener') } });
        window.open(issue.url, '_blank', 'noopener');
      }
    } catch (e) {
      toasts.error(`Not sent: ${(e as Error).message}`);
    } finally {
      sending = false;
    }
  }
  const lastSend = $derived.by(() => {
    try {
      const id = typeof localStorage !== 'undefined' ? localStorage.getItem('nib.viewer.lastSend') : null;
      return v.data.integrations.find((i) => i.id === id) ?? v.data.integrations[0] ?? null;
    } catch {
      return v.data.integrations[0] ?? null;
    }
  });

  const moreItems = $derived<MenuItem[]>([
    {
      id: 'move',
      label: 'Move to folder',
      icon: 'move',
      items: [
        { id: 'none', label: 'No folder', icon: 'home', disabled: !v.detail.folderId, run: () => void move(null) },
        ...v.folders.map((f) => ({ id: f.id, label: f.name, icon: 'folder', disabled: f.id === v.detail.folderId, run: () => void move(f.id) })),
        { id: 'new', label: 'New folder', icon: 'plus', run: () => (newFolder = true) },
      ],
    },
    ...(v.canEdit ? [{ id: 'delete', label: 'Delete', icon: 'trash', danger: true, run: () => (confirmDelete = true) }] : []),
  ]);
</script>

<header class="hdr" data-testid="viewer-header">
  {#if member}
    <a class="ib" href="/" aria-label="All captures" title="All captures" data-testid="home"><VIcon name="home" size={18} /></a>
    <a class="folder" href={folder ? `/f/${folder.id}` : '/'} data-testid="folder-chip"><VIcon name="folder" size={14} />{folder?.name ?? 'All captures'}</a>
    <Dropdown open={menu === 'more'} onclose={() => (menu = null)}>
      {#snippet trigger()}
        <button type="button" class="ib" onclick={() => (menu = menu === 'more' ? null : 'more')} aria-label="More actions" aria-haspopup="menu" data-testid="more"><VIcon name="more" size={18} /></button>
      {/snippet}
      <Menu items={moreItems} onpick={() => (menu = null)} label="Capture actions" />
    </Dropdown>
  {:else}
    <a class="brand" href="/" aria-label={PRODUCT_NAME}><VIcon name="logo" size={20} /><span>{PRODUCT_NAME}</span></a>
  {/if}
  <span class="grow"></span>
  {#if !v.data.me}
    <Button variant="ghost" size="sm" onclick={() => goto(`/login?next=${encodeURIComponent(next)}`)} data-testid="sign-in">Sign in</Button>
    <Button variant="primary" size="sm" onclick={() => goto(`/login?mode=signup&next=${encodeURIComponent(next)}`)} data-testid="sign-up">Sign up</Button>
  {:else}
    {#if member && (v.data.sendTo.trackers || v.data.sendTo.slack)}
      <div class="split" data-testid="send-split">
        <button type="button" class="sbtn" onclick={() => (lastSend ? openForm(lastSend) : (menu = 'send'))} data-testid="send-main">
          <VIcon name="external" size={14} />{lastSend ? `Send to ${lastSend.name}` : 'Send to app'}
        </button>
        <Dropdown open={menu === 'send'} align="end" onclose={() => (menu = null)}>
          {#snippet trigger()}
            <button type="button" class="sbtn caret" onclick={() => (menu = menu === 'send' ? null : 'send')} aria-label="Pick an app" data-testid="send-caret"><VIcon name="chevron-down" size={12} /></button>
          {/snippet}
          <Menu
            label="Send to"
            onpick={() => (menu = null)}
            items={v.data.integrations.length
              ? [
                  ...v.data.integrations.map((i) => ({ id: i.id, label: i.name, icon: 'external', run: () => openForm(i) })),
                  { id: 'connect', label: 'Manage apps', icon: 'settings', run: () => void goto('/settings/integrations') },
                ]
              : [
                  ...(v.data.sendTo.trackers
                    ? [
                        { id: 'connect-github', label: 'Connect GitHub', icon: 'plus', run: () => void goto('/settings/integrations#github') },
                        { id: 'connect-gitlab', label: 'Connect GitLab', icon: 'plus', run: () => void goto('/settings/integrations#gitlab') },
                      ]
                    : []),
                  ...(v.data.sendTo.slack ? [{ id: 'connect-slack', label: 'Connect Slack', icon: 'plus', run: () => void goto('/settings/integrations#slack') }] : []),
                  { id: 'connect-webhook', label: 'Set up a webhook', icon: 'plus', run: () => void goto('/settings/webhooks') },
                ]} />
        </Dropdown>
      </div>
    {/if}
    <div class="split copy" data-testid="copy-split">
      <button type="button" class="sbtn primary" onclick={copyLink} data-testid="copy-link">
        <VIcon name={copied ? 'check' : 'link'} size={14} />{copied ? 'Copied' : 'Copy link'}
      </button>
      <Dropdown open={menu === 'share'} align="end" onclose={() => (menu = null)}>
        {#snippet trigger()}
          <button type="button" class="sbtn primary caret" onclick={() => (menu = menu === 'share' ? null : 'share')} aria-label="Share options" data-testid="share-caret"><VIcon name="chevron-down" size={12} /></button>
        {/snippet}
        <SharePopover onclose={() => (menu = null)} />
      </Dropdown>
    </div>
  {/if}
</header>

{#if target}
  {@const t = target}
  <FormModal bind:open={formOpen} title={t.type === 'slack' ? `Post to ${t.name}` : `File in ${t.name}`} width={460} testid="send-dialog">
    <TrackerFields integration={t} bind:fields bind:title={issueTitle} />
    {#snippet footer()}
      <Button onclick={() => (formOpen = false)}>Cancel</Button>
      <Button variant="primary" loading={sending} disabled={t.type !== 'slack' && !fields.repo} onclick={send} data-testid="send-submit">{t.type === 'slack' ? 'Post' : 'Create issue'}</Button>
    {/snippet}
  </FormModal>
{/if}

{#if confirmDelete}
  <Modal title="Delete this capture?" confirmLabel="Delete" danger {busy} onconfirm={remove} oncancel={() => (confirmDelete = false)}>
    This is permanent. The video or image, the logs and the comments go, and every share link stops working.
  </Modal>
{/if}
{#if newFolder}
  <Modal title="New folder" confirmLabel="Create and move" {busy} onconfirm={createAndMove} oncancel={() => (newFolder = false)}>
    <input type="text" bind:value={folderName} placeholder="Folder name" aria-label="Folder name" use:focusNow onkeydown={(e) => { if (e.key === 'Enter') void createAndMove(); }} data-testid="folder-name" />
  </Modal>
{/if}

<style>
  .hdr { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 10px 16px; border-bottom: 1px solid var(--nb-border); background: var(--nb-surface); position: sticky; top: 0; z-index: 20; }
  .grow { flex: 1; }
  .ib { all: unset; display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--nb-radius-md); color: var(--nb-text-muted); cursor: pointer; }
  .ib:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .ib:focus-visible, .sbtn:focus-visible, .folder:focus-visible { outline: 2px solid var(--nb-focus); }
  .folder { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 999px; background: var(--nb-surface-sunken); color: var(--nb-text); text-decoration: none; font-size: var(--nb-text-md); max-width: 200px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .folder:hover { background: var(--nb-border); }
  .brand { display: inline-flex; align-items: center; gap: 6px; color: var(--nb-accent-text); font-weight: 600; text-decoration: none; }
  .split { display: inline-flex; align-items: stretch; }
  .sbtn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text); font: 500 var(--nb-text-md) var(--nb-font-sans); cursor: pointer; white-space: nowrap; border-radius: var(--nb-radius-md) 0 0 var(--nb-radius-md); }
  .sbtn:hover { background: var(--nb-surface-sunken); }
  .sbtn.caret { padding: 0 8px; border-left: 0; border-radius: 0 var(--nb-radius-md) var(--nb-radius-md) 0; }
  .sbtn.primary { background: var(--nb-accent); color: var(--nb-on-accent); border-color: var(--nb-accent); }
  .sbtn.primary:hover { background: var(--nb-accent-hover); }
  .sbtn.primary.caret { border-left: 1px solid rgb(255 255 255 / 0.3); }
  @media (max-width: 720px) {
    .hdr { padding: 8px 10px; gap: 6px; }
    .split:not(.copy) { display: none; }
    .folder { max-width: 120px; }
  }
</style>
