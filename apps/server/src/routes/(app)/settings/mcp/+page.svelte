<script lang="ts">
  // J-145: one card per agent; each opens a dialog with a snippet that holds only the server URL,
  // a copy button and numbered steps. J-147: connected agents with a row menu to remove one; the
  // row goes at once and the agent's next call gets 401.
  import { enhance } from '$app/forms';
  import { Button, Icon, toasts } from '@toolbar/ui';
  import type { AgentSetup } from '@toolbar/shared/areas/agent';
  import { ago } from '#lib/components/auth/time.ts';

  let { data, form } = $props();
  let dialog: HTMLDialogElement | undefined = $state();
  let confirmDialog: HTMLDialogElement | undefined = $state();
  let open = $state<AgentSetup | null>(null);
  let removing = $state<{ id: string; name: string } | null>(null);
  let menuFor = $state<string | null>(null);
  let copied = $state(false);

  const initials: Record<string, string> = { 'claude-code': 'CC', cursor: 'Cu', codex: 'Cx', vscode: 'VS', other: '+' };

  function show(s: AgentSetup) {
    open = s;
    copied = false;
    dialog?.showModal();
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      toasts.success('Copied');
      setTimeout(() => (copied = false), 1500);
    } catch {
      toasts.error('The browser blocked the clipboard');
    }
  }
  function askRemove(c: { id: string; name: string }) {
    menuFor = null;
    removing = c;
    confirmDialog?.showModal();
  }
</script>

<svelte:head><title>MCP · Settings</title></svelte:head>
<h1>MCP</h1>
<p class="muted">Connect a coding agent to your captures. It reads console, network, user events and frames, and can comment back. The agent signs in through your browser; no token goes in its config.</p>

<div class="url">
  <span class="label">Server URL</span>
  <code data-testid="mcp-server-url">{data.serverUrl}</code>
  <Button size="sm" variant="ghost" icon="copy" onclick={() => copy(data.serverUrl)} aria-label="Copy server URL">Copy</Button>
</div>

<ul class="cards" aria-label="Agents">
  {#each data.setups as s (s.id)}
    <li>
      <button type="button" class="card" onclick={() => show(s)} data-testid="agent-card-{s.id}">
        <span class="logo" aria-hidden="true">{initials[s.id]}</span>
        <span class="name" data-testid="agent-card-name">{s.id === 'other' ? 'Other agent' : s.name}</span>
        <span class="chev" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
      </button>
    </li>
  {/each}
</ul>

<h2>Connected agents</h2>
{#if data.clients.length}
  <ul class="list" data-testid="mcp-clients">
    {#each data.clients as c (c.id)}
      <li data-testid="mcp-client">
        <span class="col">
          <span class="cname">{c.name}</span>
          <span class="meta">{c.workspaceName} · {c.scopes.includes('captures:write') ? 'read, comment and organise' : 'read only'} · connected {ago(c.createdAt)} · {c.lastUsedAt ? `used ${ago(c.lastUsedAt)}` : 'not used yet'}</span>
        </span>
        <span class="menu">
          <Button size="sm" variant="ghost" iconOnly icon="more" aria-label="Agent actions" onclick={() => (menuFor = menuFor === c.id ? null : c.id)} data-testid="mcp-client-menu" />
          {#if menuFor === c.id}
            <div class="pop" role="menu">
              <button type="button" role="menuitem" class="danger" onclick={() => askRemove(c)} data-testid="mcp-client-remove"><Icon name="trash" size={14} /> Remove</button>
            </div>
          {/if}
        </span>
      </li>
    {/each}
  </ul>
{:else}
  <div class="empty-box" data-testid="mcp-clients-empty"><Icon name="link" size={20} /><p>No agent is connected yet. Pick one above and follow its steps.</p></div>
{/if}
{#if form && 'message' in form}<p class="err" role="alert">{form.message}</p>{/if}

<dialog bind:this={dialog} aria-labelledby="setup-title" onclose={() => (open = null)}>
  {#if open}
    <h2 id="setup-title">Connect {open.id === 'other' ? 'another agent' : open.name}</h2>
    <div class="snippet">
      <pre data-testid="setup-snippet">{open.snippet}</pre>
      <Button size="sm" icon={copied ? 'check' : 'copy'} onclick={() => copy(open!.snippet)} data-testid="copy-snippet">{copied ? 'Copied' : 'Copy'}</Button>
    </div>
    <ol>
      {#each open.steps as step, i (i)}<li>{step}</li>{/each}
    </ol>
    <div class="actions"><Button onclick={() => dialog?.close()}>Done</Button></div>
  {/if}
</dialog>

<dialog bind:this={confirmDialog} aria-labelledby="rm-title">
  {#if removing}
    <form
      method="POST"
      action="?/remove"
      use:enhance={() => async ({ update }) => {
        await update();
        confirmDialog?.close();
        toasts.success('Agent removed');
      }}
    >
      <h2 id="rm-title">Remove {removing.name}?</h2>
      <p class="muted">Its access stops at once. Connect it again to use it.</p>
      <input type="hidden" name="id" value={removing.id} />
      <div class="actions">
        <Button onclick={() => confirmDialog?.close()}>Cancel</Button>
        <Button type="submit" variant="danger" data-testid="mcp-client-remove-confirm">Remove</Button>
      </div>
    </form>
  {/if}
</dialog>

<style>
  h1 { margin: 0; }
  h2 { font-size: var(--nb-text-lg); letter-spacing: var(--nb-tracking-ui); margin: var(--nb-space-6) 0 var(--nb-space-2); }
  .muted { color: var(--nb-text-muted); }
  .url { display: flex; align-items: center; gap: var(--nb-space-2); padding: 8px 12px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); background: var(--nb-surface-2); }
  .url .label { font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); }
  .url code { flex: 1; min-width: 0; font: var(--nb-text-md) var(--nb-font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 480px) { .url .label { display: none; } }
  /* one row height for every card: the grid stretches each li, the li hands its height to the card,
     and a label too long for its column ends in an ellipsis instead of wrapping */
  .cards { list-style: none; padding: 0; margin: var(--nb-space-4) 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--nb-space-2); }
  .cards li { display: flex; min-width: 0; }
  .card { all: unset; box-sizing: border-box; width: 100%; min-width: 0; display: flex; align-items: center; gap: var(--nb-space-3); padding: 12px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); cursor: pointer; transition: border-color var(--nb-dur-fast) var(--nb-ease-out); }
  .card:hover { border-color: var(--nb-border-strong); }
  .card:focus-visible { outline: 2px solid var(--nb-focus); }
  .logo { flex: none; width: 32px; height: 32px; display: grid; place-items: center; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); color: var(--nb-text); font: var(--nb-weight-medium) var(--nb-text-sm) var(--nb-font-mono); }
  .name { flex: 1; min-width: 0; font-weight: var(--nb-weight-medium); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chev { flex: none; display: inline-flex; }
  .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  .list li { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  .list li + li { border-top: 1px solid var(--nb-border); }
  .col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .cname { font-weight: var(--nb-weight-medium); }
  .meta { font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .menu { position: relative; }
  .pop { position: absolute; right: 0; top: 100%; z-index: 5; min-width: 140px; padding: 6px; background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); box-shadow: var(--nb-shadow-lg); }
  .pop button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: var(--nb-radius-sm); cursor: pointer; }
  .pop button:hover { background: var(--nb-surface-sunken); }
  .danger { color: var(--nb-danger); }
  .empty-box { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px dashed var(--nb-border-strong); border-radius: var(--nb-radius-lg); background: var(--nb-surface-2); color: var(--nb-text-muted); }
  .empty-box p { margin: 0; }
  .err { color: var(--nb-danger); }
  dialog { width: min(520px, calc(100vw - 32px)); padding: var(--nb-space-5); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-lg); }
  dialog::backdrop { background: var(--nb-overlay); }
  dialog h2 { margin: 0 0 var(--nb-space-3); }
  .snippet { display: flex; align-items: flex-start; gap: var(--nb-space-2); padding: 10px 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); }
  .snippet pre { flex: 1; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: var(--nb-text-md) var(--nb-font-mono); }
  ol { padding-left: 20px; display: grid; gap: 6px; }
  .actions { display: flex; justify-content: flex-end; gap: var(--nb-space-2); margin-top: var(--nb-space-3); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .pop button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: -2px; }
</style>
