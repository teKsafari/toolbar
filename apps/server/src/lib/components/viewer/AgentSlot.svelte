<script lang="ts">
  // Mount point for the agent tab. The agent area builds lib/components/agent/AgentTab.svelte
  // (props: detail, shareToken); until it exists this shows a short pointer to the MCP setup.
  import type { Component } from 'svelte';
  import EmptyState from './EmptyState.svelte';
  import { useViewer } from './viewer.svelte.ts';

  const v = useViewer();
  const mods = import.meta.glob<{ default: Component<{ detail: unknown; shareToken: string | null }> }>('../agent/AgentTab.svelte');
  const load = Object.values(mods)[0];
</script>

{#if load}
  {#await load() then mod}
    <mod.default detail={v.detail} shareToken={v.data.shareToken} />
  {/await}
{:else}
  <EmptyState icon="agent" title="Hand this capture to a coding agent" body="Connect an agent through the MCP server, then ask it to fix the capture by its link." action={{ label: 'Set up an agent', href: '/settings/mcp' }} testid="agent-empty" />
{/if}
