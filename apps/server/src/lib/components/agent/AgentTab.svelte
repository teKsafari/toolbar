<script lang="ts">
  // Agent tab of the dev tools panel (J-152). Before the viewer has connected an agent: a card
  // with a copyable setup prompt naming the MCP server. After: three preset chips (fix it,
  // summarise, end-to-end test), each showing a short prompt with the capture URL and a copy
  // button. Mounted by the viewer area through AgentSlot.svelte (props: detail, shareToken).
  import { Button, Icon, toasts } from '@toolbar/ui';
  import type { AgentBrief } from '@toolbar/shared/api';
  import { fetchBrief, fetchConnected, type ConnectedAgent } from './brief.ts';
  import CopyForAi from './CopyForAi.svelte';
  import AuthorAvatar from './AuthorAvatar.svelte';
  import AuthorName from './AuthorName.svelte';
  import { ago } from '../auth/time.ts';
  import { useViewer } from '../viewer/viewer.svelte.ts';

  interface Props {
    detail: unknown;
    shareToken: string | null;
  }
  let { detail, shareToken }: Props = $props();
  const captureId = $derived((detail as { id?: string } | null)?.id ?? '');

  type Preset = 'fix' | 'summarize' | 'e2e';
  const PRESETS: { id: Preset; label: string }[] = [
    { id: 'fix', label: 'Fix it' },
    { id: 'summarize', label: 'Summarise' },
    { id: 'e2e', label: 'E2E test' },
  ];
  let preset = $state<Preset>('fix');
  let brief = $state<AgentBrief | null>(null);
  let err = $state<string | null>(null);
  let copied = $state<string | null>(null);
  let showSetup = $state(false);
  /** the person's connected agents, drawn as "agent for you" like their comments (D-207) */
  let agents = $state<ConnectedAgent[]>([]);
  const me = useViewer()?.data.me ?? null;

  $effect(() => {
    if (!captureId) return;
    let alive = true;
    fetchBrief(captureId, shareToken)
      .then((b) => {
        if (!alive) return;
        brief = b;
        if (b.connected && me && !shareToken) void fetchConnected().then((a) => alive && (agents = a));
      })
      .catch((e: Error) => alive && (err = e.message));
    return () => {
      alive = false;
    };
  });

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = key;
      toasts.success('Prompt copied');
      setTimeout(() => copied === key && (copied = null), 2000);
    } catch {
      toasts.error('The browser blocked the clipboard');
    }
  }

  const connected = $derived(!!brief?.connected && !showSetup);
</script>

<div class="agent" data-testid="agent-tab">
  {#if err}
    <p class="note">The agent prompts could not be loaded: {err}</p>
  {:else if !brief}
    <p class="note"><Icon name="spinner" size={14} /> Loading</p>
  {:else if !connected}
    <section class="card" data-testid="agent-setup">
      <h3>Hand this capture to a coding agent</h3>
      <p class="muted">Paste this into Claude Code, Cursor, Codex or another agent. It adds the MCP server, signs in through your browser, then opens this capture.</p>
      <pre class="prompt" data-testid="agent-setup-prompt">{brief.prompts.setup}</pre>
      <div class="row">
        <Button variant="primary" size="sm" icon={copied === 'setup' ? 'check' : 'copy'} onclick={() => copy('setup', brief!.prompts.setup)} data-testid="copy-setup">Copy prompt</Button>
        {#if !shareToken}<a class="link" href="/settings/mcp">Setup per agent</a>{/if}
        {#if brief.connected}<button type="button" class="link" onclick={() => (showSetup = false)}>Show presets</button>{/if}
      </div>
    </section>
  {:else}
    {#if agents.length && me}
      <ul class="agents" aria-label="Connected agents" data-testid="agent-connected">
        {#each agents as a (a.id)}
          <li data-testid="agent-connected-item">
            <AuthorAvatar name={me.name} image={me.image} agent={a.name} size={24} />
            <span class="aname"><AuthorName name={me.name} agent={a.name} /></span>
            <span class="aused">{a.lastUsedAt ? `used ${ago(a.lastUsedAt)}` : 'not used yet'}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="chips" role="tablist" aria-label="Prompt presets">
      {#each PRESETS as p (p.id)}
        <button type="button" role="tab" aria-selected={preset === p.id} class:on={preset === p.id} onclick={() => (preset = p.id)} data-testid="preset-{p.id}">{p.label}</button>
      {/each}
    </div>
    <section class="card">
      <pre class="prompt" data-testid="agent-prompt">{brief.prompts[preset]}</pre>
      <div class="row">
        <Button variant="primary" size="sm" icon={copied === preset ? 'check' : 'copy'} onclick={() => copy(preset, brief!.prompts[preset])} data-testid="copy-prompt">Copy prompt</Button>
        <button type="button" class="link" onclick={() => (showSetup = true)}>Setup prompt</button>
      </div>
    </section>
  {/if}

  {#if brief}
    <section class="more">
      <div class="row between">
        <span class="muted">No MCP in your tool? Copy everything as markdown.</span>
        <CopyForAi {captureId} {shareToken} size="sm" variant="ghost" />
      </div>
      {#if brief.cli}<p class="muted small">Terminal agents can also run <code>{brief.cli} get {brief.captureUrl}</code> (Settings, CLI).</p>{/if}
    </section>
  {/if}
</div>

<style>
  .agent { display: flex; flex-direction: column; gap: var(--nb-space-3); padding: var(--nb-space-3); overflow: auto; font-size: var(--nb-text-md); }
  .card { display: grid; gap: var(--nb-space-2); padding: var(--nb-space-3); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); background: var(--nb-surface-2); }
  h3 { margin: 0; font-size: var(--nb-text-base); font-weight: var(--nb-weight-semibold); letter-spacing: var(--nb-tracking-ui); }
  .muted { color: var(--nb-text-muted); margin: 0; }
  .small { font-size: var(--nb-text-sm); }
  .note { color: var(--nb-text-muted); display: flex; gap: 6px; align-items: center; margin: 0; }
  .prompt { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--nb-font-mono); font-size: var(--nb-text-sm); line-height: var(--nb-leading-normal); background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-sm); padding: var(--nb-space-2) var(--nb-space-3); }
  .row { display: flex; align-items: center; gap: var(--nb-space-3); flex-wrap: wrap; }
  .between { justify-content: space-between; }
  .link { background: none; border: 0; padding: 0; color: var(--nb-accent-text); font: inherit; cursor: pointer; text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .chips { display: flex; gap: var(--nb-space-1); }
  .chips button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: var(--nb-radius-pill); border: 1px solid transparent; color: var(--nb-text-muted); font-size: var(--nb-text-sm); font-weight: var(--nb-weight-medium); }
  .chips button:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .chips button.on { background: var(--nb-surface); border-color: var(--nb-border-strong); color: var(--nb-text); box-shadow: var(--nb-shadow-sm); }
  .chips button:focus-visible { outline: 2px solid var(--nb-focus); }
  .agents { --ring: var(--nb-surface); list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .agents li { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .aname { flex: 1; min-width: 0; display: flex; font-size: var(--nb-text-md); }
  .aused { flex: none; color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
  .more { display: grid; gap: var(--nb-space-1); border-top: 1px solid var(--nb-border); padding-top: var(--nb-space-3); }
  code { font-family: var(--nb-font-mono); font-size: var(--nb-text-sm); background: var(--nb-surface-sunken); padding: 1px 4px; border-radius: 4px; word-break: break-all; }
</style>
