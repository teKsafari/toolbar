<script lang="ts">
  // J-148: create-key dialog with name, expiry (7, 30, 90 days or a year) and read-only or
  // read-write per surface (MCP and the HTTP API; Jam's two rows are MCP and its CLI, both
  // read-only by default). The `cli` field sets the API scopes, which the paused CLI also uses
  // (docs/scope.md). The secret has a fixed prefix and shows once.
  import { enhance } from '$app/forms';
  import { Button, Icon } from '@toolbar/ui';
  import { TOKEN_SCOPE_LABELS } from '@toolbar/shared/areas/auth';
  import { ago } from '#lib/components/auth/time.ts';

  let { data, form } = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let name = $state('');
  let mcp = $state('read');
  let cli = $state('read');
  const apiLabel = $derived(data.features.cli ? 'HTTP API and CLI' : 'HTTP API');
  let copied = $state(false);
  const created = $derived(form && 'created' in form ? form.created : null);

  $effect(() => {
    if (created) name = '';
  });
  async function copy(s: string) {
    await navigator.clipboard.writeText(s).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<svelte:head><title>API tokens · Settings</title></svelte:head>
<div class="head">
  <h1>API tokens</h1>
  <Button variant="primary" icon="plus" onclick={() => dialog?.showModal()}>Create token</Button>
</div>
<p class="muted">Personal tokens let agents and scripts act as you, over MCP and the HTTP API. Treat them like a password.</p>

{#if created}
  <div class="once" role="status" data-testid="token-secret">
    <p><b>{created.token.name}</b> is ready. Copy it now: it will not be shown again.</p>
    <div class="secret"><code>{created.secret}</code><Button size="sm" icon={copied ? 'check' : 'copy'} onclick={() => copy(created.secret)}>{copied ? 'Copied' : 'Copy'}</Button></div>
  </div>
{/if}

{#if data.tokens.length}
  <ul class="list">
    {#each data.tokens as t (t.id)}
      <li>
        <span class="col">
          <span class="name">{t.name} <code class="prefix">{t.prefix}...</code></span>
          <span class="meta">
            {t.scopes.map((s) => TOKEN_SCOPE_LABELS[s]).join(', ')} · created {ago(t.createdAt)} ·
            {t.expiresAt ? `expires ${new Date(t.expiresAt).toLocaleDateString()}` : 'never expires'} ·
            {t.lastUsedAt ? `used ${ago(t.lastUsedAt)}` : 'never used'}
          </span>
        </span>
        <form method="POST" action="?/revoke" use:enhance>
          <input type="hidden" name="id" value={t.id} />
          <Button type="submit" size="sm" variant="ghost" icon="trash">Revoke</Button>
        </form>
      </li>
    {/each}
  </ul>
{:else if !created}
  <div class="empty-box"><Icon name="settings" size={20} /><p>No tokens yet.</p></div>
{/if}
{#if form && 'message' in form}<p class="err" role="alert">{form.message}</p>{/if}

<dialog bind:this={dialog} aria-labelledby="tok-title">
  <form
    method="POST"
    action="?/create"
    use:enhance={() => async ({ update }) => {
      await update({ reset: false });
      dialog?.close();
    }}
  >
    <h2 id="tok-title">Create a token</h2>
    <label for="tok-name">Name</label>
    <input id="tok-name" type="text" name="name" maxlength="100" placeholder="Laptop agent" bind:value={name} required />
    <label for="tok-exp">Expires</label>
    <select id="tok-exp" name="expires">
      <option value="7">In 7 days</option>
      <option value="30" selected>In 30 days</option>
      <option value="90">In 90 days</option>
      <option value="365">In a year</option>
      <option value="never">Never</option>
    </select>
    <fieldset>
      <legend>MCP</legend>
      <label class="radio"><input type="radio" name="mcp" value="read" bind:group={mcp} /> Read only</label>
      <label class="radio"><input type="radio" name="mcp" value="write" bind:group={mcp} /> Read and write</label>
      <label class="radio"><input type="radio" name="mcp" value="none" bind:group={mcp} /> No access</label>
    </fieldset>
    <fieldset>
      <legend>{apiLabel}</legend>
      <label class="radio"><input type="radio" name="cli" value="read" bind:group={cli} /> Read only</label>
      <label class="radio"><input type="radio" name="cli" value="write" bind:group={cli} /> Read and write</label>
      <label class="radio"><input type="radio" name="cli" value="none" bind:group={cli} /> No access</label>
    </fieldset>
    <div class="actions">
      <Button onclick={() => dialog?.close()}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={!name.trim() || (cli === 'none' && mcp === 'none')}>Create</Button>
    </div>
  </form>
</dialog>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; }
  .head h1 { margin: 0; }
  .list { list-style: none; margin: 16px 0 0; padding: 0; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); }
  li { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
  li + li { border-top: 1px solid var(--nb-border); }
  .col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .name { font-weight: var(--nb-weight-medium); }
  .prefix { font: var(--nb-text-sm) var(--nb-font-mono); color: var(--nb-text-faint); font-weight: normal; }
  .meta { font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .once { margin-top: 16px; padding: 12px 14px; border-radius: var(--nb-radius-lg); background: var(--nb-success-tint); }
  .once p { margin: 0 0 8px; }
  .secret { display: flex; align-items: center; gap: 8px; }
  .secret code { flex: 1; font: var(--nb-text-md) var(--nb-font-mono); overflow-wrap: anywhere; }
  .empty-box { margin-top: 16px; display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px dashed var(--nb-border-strong); border-radius: var(--nb-radius-lg); color: var(--nb-text-muted); }
  .empty-box p { margin: 0; }
  .err { color: var(--nb-danger); }
  dialog {
    width: min(420px, calc(100vw - 32px)); padding: var(--nb-space-5); border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-xl); background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-lg);
  }
  dialog::backdrop { background: var(--nb-overlay); }
  dialog form { display: flex; flex-direction: column; gap: var(--nb-space-2); }
  dialog h2 { margin: 0 0 var(--nb-space-2); }
  dialog label { font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  select { height: var(--nb-control-lg); padding: 0 var(--nb-space-2); border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); font: inherit; }
  fieldset { border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); padding: 8px 12px; display: flex; gap: 14px; flex-wrap: wrap; }
  legend { font-size: var(--nb-text-sm); color: var(--nb-text-muted); padding: 0 4px; }
  .radio { display: inline-flex; align-items: center; gap: 6px; color: var(--nb-text); }
  .radio input { accent-color: var(--nb-accent); }
  .actions { display: flex; justify-content: flex-end; gap: var(--nb-space-2); margin-top: var(--nb-space-3); }
</style>
