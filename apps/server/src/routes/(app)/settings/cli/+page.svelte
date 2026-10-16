<script lang="ts">
  // J-155: the CLI page. Install (macOS and Linux, or Windows), sign in (browser or token), and
  // install the agent skill that tells coding agents which reads to make first.
  import { Button, toasts } from '@toolbar/ui';
  import { CLI_BIN } from '@toolbar/shared/areas/agent';

  let { data } = $props();
  let os = $state<'unix' | 'windows'>('unix');
  let copied = $state<string | null>(null);

  const install = $derived(
    os === 'unix'
      ? `curl -fsSL ${data.serverUrl}/cli/install.sh | sh`
      : `irm ${data.serverUrl}/cli/install.ps1 | iex`,
  );
  const steps = $derived([
    { id: 'install', title: 'Install', body: 'Needs Node.js 24 or newer. Puts the open-toolbar command on your PATH.', cmd: install },
    { id: 'login', title: 'Sign in', body: 'Opens your browser to approve, like an MCP agent. On a machine without a browser, create a token under API tokens and pass it with --token.', cmd: `${CLI_BIN} login --server ${data.serverUrl}` },
    { id: 'skill', title: 'Teach your agents', body: 'Writes a skill file for Claude Code (or --agent codex, cursor) with the order to read a capture in.', cmd: `${CLI_BIN} skill install` },
    { id: 'try', title: 'Try it', body: 'Lists your latest captures. Then open-toolbar get <link>, open-toolbar network <link> --status 5xx, open-toolbar frames <link> --at 5000.', cmd: `${CLI_BIN} ls` },
  ]);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = id;
      toasts.success('Copied');
      setTimeout(() => copied === id && (copied = null), 1500);
    } catch {
      toasts.error('The browser blocked the clipboard');
    }
  }
</script>

<svelte:head><title>CLI · Settings</title></svelte:head>
<h1>CLI</h1>
<p class="muted">The <code>{CLI_BIN}</code> command gives terminal agents the same data as the MCP server, as JSON and files on disk, and lets them make captures of their own.</p>

<div class="seg" role="tablist" aria-label="Operating system">
  <button type="button" role="tab" aria-selected={os === 'unix'} class:on={os === 'unix'} onclick={() => (os = 'unix')}>macOS and Linux</button>
  <button type="button" role="tab" aria-selected={os === 'windows'} class:on={os === 'windows'} onclick={() => (os = 'windows')}>Windows</button>
</div>

<ol class="steps">
  {#each steps as s, i (s.id)}
    <li>
      <span class="n">{i + 1}</span>
      <div class="body">
        <h2>{s.title}</h2>
        <p class="muted">{s.body}</p>
        <div class="cmd">
          <code data-testid="cli-{s.id}">{s.cmd}</code>
          <Button size="sm" variant="ghost" icon={copied === s.id ? 'check' : 'copy'} onclick={() => copy(s.id, s.cmd)} aria-label="Copy command">Copy</Button>
        </div>
      </div>
    </li>
  {/each}
</ol>
{#if !data.bundle}
  <p class="warn" data-testid="cli-no-bundle">This server has no CLI build to hand out yet. Build it with <code>pnpm --filter @toolbar/cli build</code>, or run it from a checkout with <code>node packages/cli/dist/open-toolbar.mjs</code>.</p>
{/if}

<style>
  h1 { margin: 0; }
  .muted { color: var(--nb-text-muted); margin: 0; }
  code { font-family: var(--nb-font-mono); font-size: var(--nb-text-md); }
  .seg { display: inline-flex; gap: 2px; margin: var(--nb-space-4) 0; padding: 2px; border-radius: var(--nb-radius-pill); background: var(--nb-surface-sunken); }
  .seg button { all: unset; cursor: pointer; padding: 4px 12px; border-radius: var(--nb-radius-pill); font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  .seg button.on { background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  .steps { list-style: none; padding: 0; margin: 0; display: grid; gap: var(--nb-space-4); }
  .steps li { display: flex; gap: var(--nb-space-3); }
  .n { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--nb-border-strong); background: var(--nb-surface); color: var(--nb-text); font: var(--nb-weight-medium) var(--nb-text-sm) var(--nb-font-mono); }
  .body { flex: 1; min-width: 0; display: grid; gap: var(--nb-space-1); }
  h2 { font-size: var(--nb-text-base); margin: 0; }
  .cmd { display: flex; align-items: center; gap: var(--nb-space-2); padding: 8px 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); }
  .cmd code { flex: 1; overflow-wrap: anywhere; }
  .warn { margin-top: var(--nb-space-4); padding: 10px 12px; border-radius: var(--nb-radius-md); background: var(--nb-warning-tint); font-size: var(--nb-text-md); }
</style>
