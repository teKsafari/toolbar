<script lang="ts">
  // The name line of an author (D-207): "Nehemia Kaaya" in the row's name style, then "via
  // Claude Code" as a quiet secondary label. The agent name is cleaned and normalised.
  import { AGENT_LOGOS } from './agent-logos.ts';
  import { agentIdentity, agentName, authorLabel, logoColors } from './agent-name.ts';

  interface Props {
    name: string;
    agent?: string | null;
  }
  let { name, agent = null }: Props = $props();
  // the agent's logo before its name, in the brand colour where it keeps 3:1, else the ink (D-209)
  const id = $derived(agentIdentity(agent));
  const logo = $derived(id.logo ? AGENT_LOGOS[id.logo] : null);
  const ink = $derived(id.logo ? logoColors(id.logo) : null);
</script>

<span class="an" title={agent ? authorLabel(name, agent) : undefined} data-testid="author-name"><span class="who">{name}</span>{#if agent}<span class="via" data-testid="author-via" style:--lg-l={ink?.light.ink} style:--lg-d={ink?.dark.ink}>{" "}via {#if logo}<svg class="lg" viewBox="0 0 {logo.box} {logo.box}" aria-hidden="true" focusable="false"><path d={logo.path} fill="currentColor" /></svg>{/if}{agentName(agent)}</span>{/if}</span>

<style>
  .an { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who { font-weight: var(--who-weight, 600); color: var(--who-color, inherit); }
  .via { font-weight: 400; color: var(--nb-text-muted); white-space: pre; }
  .lg { display: inline-block; width: 0.95em; height: 0.95em; margin: 0 0.25em 0 0.05em; vertical-align: -0.12em; color: var(--lg-l, currentColor); }
  :global([data-theme='dark']) .lg { color: var(--lg-d, currentColor); }
  @media (prefers-color-scheme: dark) { :global(:root:not([data-theme='light'])) .lg { color: var(--lg-d, currentColor); } }
</style>
