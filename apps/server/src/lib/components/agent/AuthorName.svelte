<script lang="ts">
  // The name line of an author (D-207): "Nehemia Kaaya" in the row's name style, then "via
  // Claude Code" as a quiet secondary label. The agent name is cleaned and normalised.
  import { agentName, authorLabel } from './agent-name.ts';

  interface Props {
    name: string;
    agent?: string | null;
  }
  let { name, agent = null }: Props = $props();
</script>

<span class="an" title={agent ? authorLabel(name, agent) : undefined} data-testid="author-name"><span class="who">{name}</span>{#if agent}<span class="via" data-testid="author-via">{` via ${agentName(agent)}`}</span>{/if}</span>

<style>
  .an { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who { font-weight: var(--who-weight, 600); color: var(--who-color, inherit); }
  .via { font-weight: 400; color: var(--nb-text-muted); }
</style>
