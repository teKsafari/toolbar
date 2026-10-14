<script lang="ts">
  // J-138: the capture page's send-to-app split button. Lists the workspace's connected apps
  // (connect items when none); picking one opens the field form (J-140) and files the capture.
  // The viewer area mounts this in the capture header; hide it for signed-out viewers.
  import { Button, Popover, toasts } from '@toolbar/ui';
  import type { Integration, LinkedIssue } from '@toolbar/shared/api';
  import DIcon from './DIcon.svelte';
  import Modal from './Modal.svelte';
  import TrackerFields from './TrackerFields.svelte';
  import type { Fields } from './fields.ts';
  import { api, errMsg } from './api.ts';

  let { captureId, workspaceId, captureTitle = '', canEdit = true, onsent }: { captureId: string; workspaceId: string; captureTitle?: string; canEdit?: boolean; onsent?: (i: LinkedIssue) => void } = $props();
  let list = $state<Integration[] | null>(null);
  let menuOpen = $state(false);
  let target = $state<Integration | null>(null);
  let formOpen = $state(false);
  let fields = $state<Fields>({ labels: [], assignees: [] });
  let title = $state('');
  let busy = $state(false);

  async function load() {
    try {
      list = (await api<{ items: Integration[] }>('integrations.list', { params: { workspaceId } })).items;
    } catch {
      list = [];
    }
  }
  $effect(() => {
    if (menuOpen && list === null) void load();
  });

  function pick(i: Integration) {
    menuOpen = false;
    target = i;
    fields = { labels: [], assignees: [] };
    title = captureTitle;
    formOpen = true;
  }

  async function send() {
    if (!target) return;
    busy = true;
    try {
      const issue = await api<LinkedIssue>('integrations.send', { params: { id: captureId }, body: { integrationId: target.id, fields: { ...fields, title } } });
      formOpen = false;
      onsent?.(issue);
      if (target.type === 'slack') toasts.success(`Posted to ${target.name}`);
      else {
        toasts.success(`Filed ${issue.key}`, { action: { label: 'Open', run: () => window.open(issue.url, '_blank', 'noopener') } });
        window.open(issue.url, '_blank', 'noopener');
      }
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      busy = false;
    }
  }
  const icon = (t: string) => (t === 'slack' ? 'chat' : 'issue') as 'chat' | 'issue';
</script>

{#if canEdit}
  <Popover bind:open={menuOpen} label="Send to app" placement="bottom-end">
    {#snippet trigger({ toggle, open, id })}
      <Button icon="external" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="send-to-app">Send to app</Button>
    {/snippet}
    {#snippet children()}
      <div class="menu" role="menu" data-testid="send-menu">
        {#if list === null}
          <span class="muted"><DIcon name="spinner" /></span>
        {:else if !list.length}
          <a role="menuitem" href="/settings/integrations"><DIcon name="issue" />Connect GitHub</a>
          <a role="menuitem" href="/settings/integrations"><DIcon name="issue" />Connect GitLab</a>
          <a role="menuitem" href="/settings/integrations"><DIcon name="chat" />Connect Slack</a>
          <a role="menuitem" href="/settings/webhooks"><DIcon name="hook" />Set up a webhook</a>
        {:else}
          {#each list as i (i.id)}
            <button role="menuitem" onclick={() => pick(i)} data-integration={i.id}><DIcon name={icon(i.type)} /><span>{i.name}</span>{#if i.status === 'error'}<em title={i.lastError ?? ''}>check</em>{/if}</button>
          {/each}
          <hr />
          <a role="menuitem" class="sub" href="/settings/integrations"><DIcon name="settings" />Manage apps</a>
        {/if}
      </div>
    {/snippet}
  </Popover>
{/if}

{#if target}
  <Modal bind:open={formOpen} title={target.type === 'slack' ? `Post to ${target.name}` : `File in ${target.name}`} width={460} testid="send-dialog">
    <TrackerFields integration={target} bind:fields bind:title />
    {#snippet footer()}
      <Button onclick={() => (formOpen = false)}>Cancel</Button>
      <Button variant="primary" loading={busy} disabled={target.type !== 'slack' && !fields.repo} onclick={send} data-testid="send-submit">{target.type === 'slack' ? 'Post' : 'Create issue'}</Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .menu { display: flex; flex-direction: column; gap: 1px; width: 230px; }
  .menu a, .menu button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 10px; padding: 7px 8px; border-radius: var(--nb-radius-md); cursor: pointer; color: var(--nb-text); }
  .menu a:hover, .menu button:hover, .menu a:focus-visible, .menu button:focus-visible { background: var(--nb-surface-sunken); }
  .menu span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  em { font-style: normal; font-size: var(--nb-text-xs); color: var(--nb-danger); }
  hr { border: 0; border-top: 1px solid var(--nb-border); margin: 4px 0; width: 100%; }
  .sub { color: var(--nb-text-muted) !important; }
</style>
