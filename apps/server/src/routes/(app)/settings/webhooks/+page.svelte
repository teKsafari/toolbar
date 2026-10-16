<script lang="ts">
  // J-142: endpoints that receive signed capture events. Add one (the signing secret shows once),
  // pause it, send a test, read the delivery log with attempts, retries and responses.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import { WEBHOOK_EVENTS, WEBHOOK_SIGNATURE_HEADER, type Page } from '@toolbar/shared/api';
  import { relativeTime } from '@toolbar/shared/areas/dashboard';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Switch from '#lib/components/dashboard/Switch.svelte';
  import Modal from '#lib/components/dashboard/Modal.svelte';
  import Confirm from '#lib/components/dashboard/Confirm.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, copyText, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  type Hook = (typeof data.hooks)[number];
  type Delivery = { id: string; event: string; status: 'pending' | 'ok' | 'failed'; attempts: number; responseStatus: number | null; error: string | null; createdAt: string; nextAttemptAt: string | null };

  let adding = $state(false);
  let url = $state('');
  let events = $state<string[]>([...WEBHOOK_EVENTS]);
  let busy = $state(false);
  let secret = $state<string | null>(null);
  let openLog = $state<string | null>(null);
  let log = $state<Delivery[]>([]);
  let logLoading = $state(false);
  let removing = $state<Hook | null>(null);
  const valid = $derived(/^https?:\/\/\S+$/.test(url.trim()) && events.length > 0);
  const label: Record<string, string> = { 'capture.created': 'Capture created', 'capture.deleted': 'Capture deleted', 'comment.created': 'Comment added', 'feedback.created': 'Feedback ready for an agent', 'feedback.resolved': 'Feedback resolved' };

  async function add(e: Event) {
    e.preventDefault();
    if (!valid || busy) return;
    busy = true;
    try {
      const r = await api<{ secret: string }>('webhooks.create', { params: { workspaceId: data.workspaceId }, body: { url: url.trim(), events } });
      secret = r.secret;
      adding = false;
      url = '';
      await invalidateAll();
    } catch (x) {
      toasts.error(errMsg(x));
    } finally {
      busy = false;
    }
  }

  async function toggle(h: Hook, active: boolean) {
    try {
      await api('webhooks.update', { params: { id: h.id }, body: { active } });
      await invalidateAll();
    } catch (x) {
      toasts.error(errMsg(x));
    }
  }

  async function loadLog(id: string) {
    logLoading = true;
    try {
      log = (await api<Page<Delivery>>('webhooks.deliveries', { params: { id }, query: { limit: 50 } })).items;
    } finally {
      logLoading = false;
    }
  }
  async function showLog(id: string) {
    openLog = openLog === id ? null : id;
    if (openLog) await loadLog(id);
  }

  async function test(h: Hook) {
    try {
      const d = await api<Delivery>('webhooks.test', { params: { id: h.id } });
      if (d.status === 'ok') toasts.success(`Test delivered (HTTP ${d.responseStatus})`);
      else toasts.error(`Test failed: ${d.error ?? d.status}; it will be retried`);
      await invalidateAll();
      if (openLog === h.id) await loadLog(h.id);
    } catch (x) {
      toasts.error(errMsg(x));
    }
  }

  async function del(h: Hook) {
    await api('webhooks.delete', { params: { id: h.id } });
    toasts.success('Endpoint removed');
    await invalidateAll();
  }
</script>

<svelte:head><title>Webhooks · Settings</title></svelte:head>

<div class="head">
  <h1>Webhooks</h1>
  <Button variant="primary" icon="plus" onclick={() => (adding = true)} data-testid="add-webhook">Add endpoint</Button>
</div>
<p class="muted lead">Each event is posted as JSON and signed: <code>{WEBHOOK_SIGNATURE_HEADER}: t=&lt;unix time&gt;,v1=&lt;HMAC-SHA256 of "t.body" with your secret&gt;</code>. Failed deliveries are retried with backoff for about a day.</p>

<Section title="Endpoints" testid="webhook-section">
  {#if !data.hooks.length}
    <p class="muted">No endpoints yet.</p>
  {/if}
  {#each data.hooks as h (h.id)}
    <div class="hook" data-testid="webhook-row" data-id={h.id}>
      <div class="hr">
        <span class="st" class:off={!h.active} class:bad={h.lastDelivery && !h.lastDelivery.ok}></span>
        <code class="url">{h.url}</code>
        <Switch label="Active" checked={h.active} onchange={(v) => toggle(h, v)} testid="webhook-active" />
      </div>
      <div class="meta">
        <span>{h.events.map((e) => label[e] ?? e).join(', ')}</span>
        <span>{h.lastDelivery ? `last delivery ${relativeTime(h.lastDelivery.at)}: ${h.lastDelivery.ok ? 'OK' : 'failed'}${h.lastDelivery.status ? ` (${h.lastDelivery.status})` : ''}` : 'no deliveries yet'}</span>
      </div>
      <div class="acts">
        <Button size="sm" icon="external" onclick={() => test(h)} data-testid="webhook-test">Send test</Button>
        <Button size="sm" variant="ghost" icon="replay" onclick={() => showLog(h.id)} aria-expanded={openLog === h.id} data-testid="webhook-log-toggle">Delivery log</Button>
        <Button size="sm" variant="ghost" icon="trash" onclick={() => (removing = h)} data-testid="webhook-delete">Remove</Button>
      </div>
      {#if openLog === h.id}
        <div class="log" data-testid="webhook-log">
          {#if logLoading && !log.length}<DIcon name="spinner" />{:else if !log.length}<p class="muted">Nothing sent yet.</p>{:else}
            <table>
              <thead><tr><th>Event</th><th>Result</th><th>Attempts</th><th>Sent</th><th>Next try</th></tr></thead>
              <tbody>
                {#each log as d (d.id)}
                  <tr data-status={d.status}>
                    <td>{label[d.event] ?? d.event}</td>
                    <td><span class="res {d.status}">{d.status === 'ok' ? `OK ${d.responseStatus ?? ''}` : d.status === 'pending' ? `Retrying${d.error ? `: ${d.error}` : ''}` : `Failed${d.error ? `: ${d.error}` : ''}`}</span></td>
                    <td data-testid="delivery-attempts">{d.attempts}</td>
                    <td>{relativeTime(d.createdAt)}</td>
                    <td>{d.nextAttemptAt && d.status === 'pending' ? new Date(d.nextAttemptAt).toLocaleTimeString() : ''}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </div>
  {/each}
</Section>

<Modal bind:open={adding} title="Add webhook endpoint" width={480} testid="add-webhook-dialog">
  <form id="hook-form" class="f" onsubmit={add}>
    <label>Endpoint URL<input type="url" bind:value={url} placeholder="https://example.com/tb-webhook" data-testid="webhook-url" /></label>
    <fieldset>
      <legend>Events</legend>
      {#each WEBHOOK_EVENTS as ev (ev)}
        <label class="cb"><input type="checkbox" checked={events.includes(ev)} onchange={(e) => (events = (e.currentTarget as HTMLInputElement).checked ? [...events, ev] : events.filter((x) => x !== ev))} />{label[ev]}</label>
      {/each}
    </fieldset>
  </form>
  {#snippet footer()}
    <Button onclick={() => (adding = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="hook-form" disabled={!valid} loading={busy} data-testid="webhook-save">Add endpoint</Button>
  {/snippet}
</Modal>

<Modal open={!!secret} title="Signing secret" onclose={() => (secret = null)} testid="webhook-secret-dialog">
  <p class="muted">Copy it now; it is not shown again. Use it to check the signature of each delivery.</p>
  <div class="sec"><code data-testid="webhook-secret">{secret}</code><Button size="sm" icon="copy" onclick={async () => secret && (await copyText(secret)) && toasts.success('Secret copied')}>Copy</Button></div>
  {#snippet footer()}<Button variant="primary" onclick={() => (secret = null)}>Done</Button>{/snippet}
</Modal>

<Confirm
  open={!!removing}
  title="Remove this endpoint?"
  message="Deliveries stop at once and its log is deleted."
  confirmLabel="Remove"
  onconfirm={async () => {
    if (removing) await del(removing).catch((e) => toasts.error(errMsg(e)));
    removing = null;
  }}
/>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .head h1 { margin: 0; }
  .lead { margin: 0 0 16px; font-size: var(--nb-text-md); }
  .lead code { font-size: var(--nb-text-sm); overflow-wrap: anywhere; }
  .hook { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  .hr { display: flex; align-items: center; gap: 10px; }
  .url { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: var(--nb-text-md) var(--nb-font-mono); }
  .st { width: 8px; height: 8px; border-radius: 50%; background: var(--nb-success); flex: none; }
  .st.bad { background: var(--nb-danger); }
  .st.off { background: var(--nb-border-strong); }
  .meta { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .log { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--nb-text-sm); }
  th { text-align: left; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); padding: 4px 6px; border-bottom: 1px solid var(--nb-border); }
  td { padding: 5px 6px; border-bottom: 1px solid var(--nb-border); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .res.ok { color: var(--nb-success); }
  .res.failed { color: var(--nb-danger); }
  .res.pending { color: var(--nb-warning); }
  .f { display: flex; flex-direction: column; gap: 12px; }
  .f label { display: flex; flex-direction: column; gap: 6px; font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); }
  .f input[type='url'] { height: 34px; }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  legend { font-size: var(--nb-text-md); margin-bottom: 4px; }
  .cb { flex-direction: row !important; align-items: center; gap: 8px !important; }
  .sec { display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); }
  .sec code { flex: 1; overflow-wrap: anywhere; font-size: var(--nb-text-sm); }
</style>
