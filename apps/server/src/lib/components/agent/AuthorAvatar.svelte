<script lang="ts">
  // Who wrote it (D-207, D-209). A person alone: their round avatar. A person through an agent:
  // the person's avatar at full size (they are accountable for the comment) with the agent's
  // logo as a small round badge on its bottom-right corner, ringed in the surface colour, the
  // way Slack and Linear mark app actions. One element, labelled "Nehemia Kaaya via Claude Code".
  import Avatar from '../viewer/Avatar.svelte';
  import AgentMark from './AgentMark.svelte';
  import { authorLabel } from './agent-name.ts';

  interface Props {
    name: string;
    image?: string | null;
    /** raw client name of the agent that wrote it for the person */
    agent?: string | null;
    size?: number;
  }
  let { name, image = null, agent = null, size = 28 }: Props = $props();
  const label = $derived(authorLabel(name, agent));
  // the badge: just over half the avatar, never under 13 px so the logo stays legible
  const badge = $derived(Math.max(13, Math.round(size * 0.58)));
</script>

{#if agent}
  <span class="stack" style:--s="{size}px" style:--b="{badge}px" role="img" aria-label={label} title={label} data-testid="author-stack">
    <span class="person" data-testid="author-person"><Avatar {name} {image} {size} /></span>
    <span class="badge"><AgentMark {agent} size={badge} decorative badge /></span>
  </span>
{:else}
  <Avatar {name} {image} {size} />
{/if}

<style>
  /* the box keeps the avatar's size, so rows align exactly as for a plain avatar; the badge sits
     about a third outside the corner, into the gap the row already has */
  .stack { position: relative; display: inline-block; flex: none; width: var(--s); height: var(--s); line-height: 0; }
  .person { display: block; line-height: 0; }
  .badge {
    position: absolute; right: calc(var(--b) * -0.42); bottom: calc(var(--b) * -0.36);
    display: grid; border-radius: 50%; line-height: 0;
    /* the ring separates badge and avatar on any row background (hover wash, highlight) */
    box-shadow: 0 0 0 2px var(--ring, var(--nb-surface));
  }
</style>
