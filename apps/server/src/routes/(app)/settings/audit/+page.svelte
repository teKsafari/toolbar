<script lang="ts">
  // J-178 audit log: captures made, deleted and shared, member and role changes, workspace
  // changes, apps connected and removed. Filter by kind; older rows load on demand.
  import { Button, toasts } from '@toolbar/ui';
  import { AUDIT_ACTIONS, type Page } from '@toolbar/shared/api';
  import { relativeTime } from '@toolbar/shared/areas/dashboard';
  import MultiSelect from '#lib/components/dashboard/MultiSelect.svelte';
  import UserAvatar from '#lib/components/dashboard/UserAvatar.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  type Entry = { id: string; at: string; actor: { name: string; image: string | null } | null; action: string; target: { type: string; id: string; label: string | null } | null; details: Record<string, unknown> };
  const LABEL: Record<string, string> = {
    'capture.created': 'made a capture',
    'capture.deleted': 'deleted a capture',
    'capture.shared': 'shared',
    'member.joined': 'joined',
    'member.removed': 'removed a member',
    'member.role_changed': 'changed a role',
    'workspace.updated': 'changed workspace settings',
    'integration.connected': 'connected an app',
    'integration.removed': 'removed an app',
    'token.created': 'created a token',
    'token.revoked': 'revoked a token',
  };
  let actions = $state<string[]>([]);
  let rows = $state<Entry[]>([]);
  let cursor = $state<string | null>(null);
  let loading = $state(true);

  async function load(reset: boolean) {
    loading = true;
    try {
      const r = await api<Page<Entry>>('workspaces.audit', { params: { workspaceId: data.workspaceId }, query: { actions, limit: 50, cursor: reset ? undefined : cursor } });
      rows = reset ? r.items : [...rows, ...r.items];
      cursor = r.nextCursor;
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void actions.length;
    void load(true);
  });
  const detail = (e: Entry) => {
    const d = e.details;
    if (e.action === 'member.role_changed') return `${d.from} to ${d.to}`;
    if (d.reason === 'auto-delete') return `auto-delete after ${d.days} days`;
    if (Array.isArray(d.invited)) return `invited ${(d.invited as string[]).join(', ')}`;
    if (Array.isArray(d.fields)) return (d.fields as string[]).join(', ');
    if (d.left) return 'left';
    return '';
  };
</script>

<svelte:head><title>Audit log · Settings</title></svelte:head>

<h1>Audit log</h1>
<div class="bar">
  <MultiSelect label="Activity" searchable={false} options={AUDIT_ACTIONS.map((a) => ({ value: a, label: LABEL[a] ?? a }))} selected={actions} onchange={(v) => (actions = v)} testid="audit-filter" />
</div>
<div class="tablewrap">
  <table data-testid="audit-table">
    <thead><tr><th>When</th><th>Who</th><th>What</th><th>Target</th></tr></thead>
    <tbody>
      {#each rows as e (e.id)}
        <tr data-action={e.action}>
          <td class="muted" title={new Date(e.at).toLocaleString()}>{relativeTime(e.at)}</td>
          <td>{#if e.actor}<span class="who"><UserAvatar name={e.actor.name} image={e.actor.image} size={20} />{e.actor.name}</span>{:else}<span class="muted">System</span>{/if}</td>
          <td>{LABEL[e.action] ?? e.action}{#if detail(e)} <span class="muted">({detail(e)})</span>{/if}</td>
          <td>{#if e.target}{#if e.target.type === 'capture'}<a href="/c/{e.target.id}">{e.target.label ?? 'capture'}</a>{:else}{e.target.label ?? e.target.type}{/if}{/if}</td>
        </tr>
      {:else}
        {#if !loading}<tr><td colspan="4" class="muted">Nothing recorded yet.</td></tr>{/if}
      {/each}
    </tbody>
  </table>
</div>
{#if loading}<p class="muted"><DIcon name="spinner" /></p>{:else if cursor}<Button onclick={() => load(false)}>Show older</Button>{/if}

<style>
  h1 { margin-bottom: 14px; }
  .bar { margin-bottom: 12px; }
  .tablewrap { overflow-x: auto; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: var(--nb-text-md); }
  th { text-align: left; font-size: var(--nb-text-xs); color: var(--nb-text-faint); font-weight: var(--nb-weight-semibold); padding: 8px 10px; border-bottom: 1px solid var(--nb-border); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--nb-border); }
  tr:last-child td { border-bottom: 0; }
  .who { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
</style>
