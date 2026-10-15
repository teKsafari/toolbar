<script lang="ts">
  // Consent card (J-146): one approve click when signed in; the workspace picker defaults to the
  // active workspace. A quiet cancel link sits under the button.
  import { Button, Icon } from '@toolbar/ui';
  import { page } from '$app/state';
  import { PRODUCT_NAME } from '@toolbar/shared';

  let { data, form } = $props();
  let workspaceId = $state('');
  $effect.pre(() => {
    if (!workspaceId) workspaceId = data.activeId ?? data.workspaces[0]?.id ?? '';
  });
  let busy = $state(false);
  // named actions must keep the OAuth query string: ?<oauth params>&/approve
  const act = (name: string) => `${page.url.search || '?'}${page.url.search ? '&' : ''}/${name}`;
</script>

<svelte:head><title>Connect {data.client.name} · {PRODUCT_NAME}</title></svelte:head>

<main class="consent">
  <div class="brand"><span class="mark"><Icon name="logo" size={22} /></span> {PRODUCT_NAME}</div>
  <section class="card" data-testid="mcp-consent">
    <h1><span class="client" data-testid="mcp-client-name">{data.client.name}</span> wants to use your {PRODUCT_NAME} account</h1>
    <p class="muted">Signed in as {data.user.email}. The agent will act as you in the workspace you pick.</p>

    <form method="POST" action={act('approve')} onsubmit={() => (busy = true)}>
      <label class="field">
        <span>Workspace</span>
        <select name="workspaceId" bind:value={workspaceId} data-testid="mcp-workspace">
          {#each data.workspaces as w (w.id)}
            <option value={w.id}>{w.name}</option>
          {/each}
        </select>
      </label>

      <div class="scopes">
        <span class="label">It will be able to</span>
        <ul>
          {#each data.scopes as s (s.id)}
            <li><Icon name="check" size={14} /> {s.label}</li>
          {/each}
        </ul>
      </div>

      {#if form?.message}<p class="error" role="alert">{form.message}</p>{/if}

      <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!workspaceId} data-testid="mcp-approve">Allow access</Button>
    </form>
    <form method="POST" action={act('deny')} class="deny">
      <button type="submit" class="link">Cancel</button>
    </form>
    <p class="fine">You will return to {data.client.redirectHost}. Remove the agent at any time under Settings, MCP.</p>
  </section>
</main>

<style>
  .consent { min-height: 100vh; display: grid; grid-template-columns: min(420px, 100%); place-content: center; gap: var(--nb-space-5); padding: var(--nb-space-6); background: var(--nb-bg); }
  .brand { display: flex; align-items: center; gap: var(--nb-space-2); font-weight: var(--nb-weight-semibold); font-size: var(--nb-text-lg); justify-content: center; }
  .mark { display: inline-grid; place-items: center; width: 32px; height: 32px; border-radius: var(--nb-radius-md); background: var(--nb-accent); color: var(--nb-on-accent); }
  .card { justify-self: center; width: min(420px, 100%); background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); box-shadow: var(--nb-shadow-md); padding: var(--nb-space-6); display: grid; gap: var(--nb-space-4); }
  h1 { font-size: var(--nb-text-xl); line-height: var(--nb-leading-tight); margin: 0; }
  .client { color: var(--nb-accent-text); }
  .muted { color: var(--nb-text-muted); margin: 0; font-size: var(--nb-text-md); }
  form { display: grid; gap: var(--nb-space-4); }
  .field { display: grid; gap: var(--nb-space-1); font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); }
  select { height: var(--nb-control-lg); border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); padding: 0 var(--nb-space-3); background: var(--nb-surface); color: var(--nb-text); font: inherit; }
  .scopes .label { font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); }
  ul { list-style: none; padding: 0; margin: var(--nb-space-2) 0 0; display: grid; gap: var(--nb-space-2); }
  li { display: flex; gap: var(--nb-space-2); align-items: flex-start; font-size: var(--nb-text-md); color: var(--nb-text); }
  li :global(svg) { color: var(--nb-accent); margin-top: 2px; flex: none; }
  .error { color: var(--nb-danger); margin: 0; font-size: var(--nb-text-md); }
  .deny { justify-items: center; margin-top: calc(-1 * var(--nb-space-2)); }
  .link { background: none; border: 0; color: var(--nb-text-muted); font: inherit; font-size: var(--nb-text-md); cursor: pointer; text-decoration: underline; }
  .fine { color: var(--nb-text-faint); font-size: var(--nb-text-sm); margin: 0; text-align: center; }
  form :global(.nb-btn) { width: 100%; justify-content: center; }
</style>
