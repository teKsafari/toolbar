<script lang="ts">
  // J-139: a searchable two-column grid of apps. GitHub and GitLab connect with a personal
  // access token, Slack with an incoming webhook URL; webhooks, MCP agents and the CLI link to
  // their pages. Connections belong to the workspace (J-251). Apps that need a paid account or a
  // registered OAuth app are on the skip list and not shown.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import type { Integration } from '@toolbar/shared/api';
  import Modal from '#lib/components/dashboard/Modal.svelte';
  import Confirm from '#lib/components/dashboard/Confirm.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';
  import type { DashIconName } from '#lib/components/dashboard/icons.ts';
  import type { IconName } from '@toolbar/ui';

  let { data } = $props();
  type Kind = 'github' | 'gitlab' | 'slack';
  type Tile = { id: string; name: string; text: string; icon: IconName | DashIconName; kind?: Kind; href?: string; tag?: string };
  const tiles: Tile[] = [
    { id: 'github', name: 'GitHub Issues', text: 'File captures as issues with labels, assignee and milestone. Connect with a personal access token.', icon: 'issue', kind: 'github' },
    { id: 'gitlab', name: 'GitLab Issues', text: 'File captures as GitLab issues, on gitlab.com or your own instance, with a personal access token.', icon: 'issue', kind: 'gitlab' },
    { id: 'slack', name: 'Slack', text: 'Post new captures to a channel through an incoming webhook URL.', icon: 'chat', kind: 'slack' },
    { id: 'webhooks', name: 'Webhooks', text: 'Send signed capture events to any URL, such as a help desk or your own service.', icon: 'hook', href: '/settings/webhooks' },
    { id: 'mcp', name: 'MCP agents', text: 'Let Claude Code, Cursor, Codex or VS Code read captures through MCP.', icon: 'terminal', href: '/settings/mcp' },
    { id: 'cli', name: 'Command line', text: 'Read captures, logs and frames from a terminal or an agent skill.', icon: 'code', href: '/settings/cli' },
  ];
  let q = $state('');
  // paused features (docs/scope.md): trackers, Slack and the CLI show only with their flag on
  const flagOn = (t: Tile) => (t.kind === 'github' || t.kind === 'gitlab' ? data.features.trackers : t.kind === 'slack' ? data.features.slack : t.id === 'cli' ? data.features.cli : true);
  const shown = $derived(tiles.filter((t) => flagOn(t) && (!q.trim() || `${t.name} ${t.text}`.toLowerCase().includes(q.trim().toLowerCase()))));
  const connected = (k: Kind) => data.items.filter((i) => i.type === k);

  // connect dialog
  let kind = $state<Kind | null>(null);
  let open = $state(false);
  let form = $state({ name: '', token: '', baseUrl: '', defaultTarget: '', webhookUrl: '', channelLabel: '' });
  let busy = $state(false);
  let err = $state<string | null>(null);
  let removing = $state<Integration | null>(null);

  function start(k: Kind) {
    kind = k;
    form = { name: '', token: '', baseUrl: k === 'github' ? 'https://api.github.com' : k === 'gitlab' ? 'https://gitlab.com' : '', defaultTarget: '', webhookUrl: '', channelLabel: '' };
    err = null;
    open = true;
  }
  const valid = $derived(kind === 'slack' ? /^https?:\/\/\S+$/.test(form.webhookUrl.trim()) : form.token.trim().length >= 10 && /^https?:\/\//.test(form.baseUrl.trim()));

  async function connect(e: Event) {
    e.preventDefault();
    if (!kind || !valid || busy) return;
    busy = true;
    err = null;
    const body =
      kind === 'slack'
        ? { type: 'slack', webhookUrl: form.webhookUrl.trim(), name: form.name.trim() || undefined, channelLabel: form.channelLabel.trim() || undefined }
        : kind === 'github'
          ? { type: 'github', token: form.token.trim(), baseUrl: form.baseUrl.trim(), name: form.name.trim() || undefined, defaultRepo: form.defaultTarget.trim() || undefined }
          : { type: 'gitlab', token: form.token.trim(), baseUrl: form.baseUrl.trim(), name: form.name.trim() || undefined, defaultProject: form.defaultTarget.trim() || undefined };
    try {
      const i = await api<Integration>('integrations.connect', { params: { workspaceId: data.workspaceId }, body });
      toasts.success(`${i.name} connected`);
      open = false;
      await invalidateAll();
    } catch (x) {
      err = errMsg(x);
    } finally {
      busy = false;
    }
  }

  async function remove(i: Integration) {
    await api('integrations.remove', { params: { id: i.id } });
    toasts.success(`${i.name} disconnected`);
    await invalidateAll();
  }
</script>

<svelte:head><title>Integrations · Settings</title></svelte:head>

<h1>Integrations</h1>
<p class="muted lead">Connections belong to this workspace. Everyone in it can send captures to them; admins connect and remove them.</p>
<input class="q" type="search" bind:value={q} placeholder="Search apps" aria-label="Search apps" data-testid="integration-search" />

<div class="grid" data-testid="integration-grid">
  {#each shown as t (t.id)}
    <article class="tile" data-tile={t.id}>
      <div class="th"><span class="ic"><DIcon name={t.icon} size={20} /></span><strong>{t.name}</strong></div>
      <p>{t.text}</p>
      {#if t.kind}
        {@const list = connected(t.kind)}
        {#each list as i (i.id)}
          <div class="conn" data-testid="connection" data-type={i.type}>
            <span class="st" class:bad={i.status === 'error'} title={i.lastError ?? 'Working'}></span>
            <span class="cn">{i.name}{#if i.defaultTarget} <span class="muted">· {i.defaultTarget}</span>{/if}</span>
            {#if data.admin}<button class="rm" aria-label="Disconnect {i.name}" onclick={() => (removing = i)} data-testid="disconnect"><DIcon name="trash" size={14} /></button>{/if}
          </div>
          {#if i.status === 'error' && i.lastError}<p class="err small">{i.lastError}</p>{/if}
        {/each}
        {#if data.admin}
          <Button size="sm" variant={list.length ? 'secondary' : 'primary'} onclick={() => start(t.kind!)} data-testid="connect-{t.id}">{list.length ? 'Add another' : 'Connect'}</Button>
        {:else if !list.length}
          <span class="muted small">An admin can connect this.</span>
        {/if}
      {:else if t.href}
        <a class="open" href={t.href}>{t.id === 'webhooks' && data.webhookCount ? `${data.webhookCount} endpoint${data.webhookCount === 1 ? '' : 's'}` : 'Set up'}<DIcon name="chevron-right" size={12} /></a>
      {/if}
    </article>
  {:else}
    <p class="muted">No app matches "{q}".</p>
  {/each}
</div>

<Modal bind:open title={kind === 'github' ? 'Connect GitHub' : kind === 'gitlab' ? 'Connect GitLab' : 'Connect Slack'} width={480} testid="connect-dialog">
  <form id="connect-form" class="cf" onsubmit={connect}>
    {#if kind === 'slack'}
      <label>Incoming webhook URL<input type="url" bind:value={form.webhookUrl} placeholder="https://hooks.slack.com/services/..." data-testid="slack-url" /></label>
      <label>Channel <span class="muted">(label only)</span><input type="text" bind:value={form.channelLabel} placeholder="#bugs" /></label>
      <p class="muted small">In Slack, add the Incoming Webhooks app to a channel and paste its URL here.</p>
    {:else}
      <label>Personal access token<input type="password" bind:value={form.token} autocomplete="off" placeholder={kind === 'github' ? 'github_pat_...' : 'glpat-...'} data-testid="token-input" /></label>
      <label>{kind === 'github' ? 'API URL' : 'GitLab URL'}<input type="url" bind:value={form.baseUrl} data-testid="base-url" /></label>
      <label>{kind === 'github' ? 'Default repository' : 'Default project'} <span class="muted">(optional)</span><input type="text" bind:value={form.defaultTarget} placeholder={kind === 'github' ? 'org/repo' : 'group/project'} data-testid="default-target" /></label>
      <p class="muted small">{kind === 'github' ? 'Give the token Issues read and write on the repositories you file to.' : 'Give the token the api scope.'} It is stored encrypted and never shown again.</p>
    {/if}
    <label>Name <span class="muted">(optional)</span><input type="text" bind:value={form.name} maxlength="100" /></label>
    {#if err}<p class="err" role="alert" data-testid="connect-error">{err}</p>{/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="connect-form" disabled={!valid} loading={busy} data-testid="connect-submit">Test and connect</Button>
  {/snippet}
</Modal>

<Confirm
  open={!!removing}
  title={`Disconnect ${removing?.name}?`}
  message="Captures can no longer be sent there. Issues already filed stay linked."
  confirmLabel="Disconnect"
  onconfirm={async () => {
    if (removing) await remove(removing).catch((e) => toasts.error(errMsg(e)));
    removing = null;
  }}
/>

<style>
  .lead { margin: -8px 0 16px; }
  .q { max-width: 320px; height: 34px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 640px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  .th { display: flex; align-items: center; gap: 10px; }
  .ic { display: grid; place-items: center; width: 34px; height: 34px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); color: var(--nb-text); }
  .tile p { margin: 0; color: var(--nb-text-muted); font-size: var(--nb-text-md); flex: 1; }
  .conn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border-radius: var(--nb-radius-md); background: var(--nb-surface-2); font-size: var(--nb-text-md); }
  .cn { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .st { width: 8px; height: 8px; border-radius: 50%; background: var(--nb-success); flex: none; }
  .st.bad { background: var(--nb-danger); }
  .rm { all: unset; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 4px; color: var(--nb-text-faint); cursor: pointer; }
  .rm:hover { background: var(--nb-surface-sunken); color: var(--nb-danger); }
  .open { display: inline-flex; align-items: center; gap: 4px; font-size: var(--nb-text-md); text-decoration: none; }
  .cf { display: flex; flex-direction: column; gap: 10px; }
  .cf label { display: flex; flex-direction: column; gap: 4px; font-size: var(--nb-text-md); }
  .cf input { height: 34px; }
  .small { font-size: var(--nb-text-sm); margin: 0; }
  .err { color: var(--nb-danger); margin: 0; }
</style>
