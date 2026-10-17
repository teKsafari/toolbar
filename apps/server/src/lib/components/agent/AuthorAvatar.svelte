<script lang="ts">
  // Who wrote it (D-207). A person alone: their round avatar. A person through an agent: the
  // agent's square mark at full size with the person's avatar smaller over its bottom-right
  // corner, offset so both stay readable, ringed in the surface colour (the stacked avatar
  // GitHub draws for a commit an app made with a person). One element, labelled
  // "Nehemia Kaaya via Claude Code".
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
  // the person: a bit over half the mark, never under 12 px
  const small = $derived(Math.max(12, Math.round(size * 0.58)));
</script>

{#if agent}
  <span class="stack" style:--s="{size}px" style:--p="{small}px" role="img" aria-label={label} title={label} data-testid="author-stack">
    <AgentMark {agent} {size} decorative stacked />
    <span class="person" data-testid="author-person"><Avatar {name} {image} size={small} /></span>
  </span>
{:else}
  <Avatar {name} {image} {size} />
{/if}

<style>
  /* the box keeps the mark's size, so the row's alignment is the same as for a plain avatar;
     the person sits about two fifths outside the corner, into the gap the row already has */
  .stack { position: relative; display: inline-block; flex: none; width: var(--s); height: var(--s); }
  .person {
    position: absolute; right: calc(var(--p) * -0.38); bottom: calc(var(--p) * -0.38);
    display: grid; border-radius: 50%;
    /* the ring separates the two shapes on any row background (hover wash, highlight) */
    box-shadow: 0 0 0 2px var(--ring, var(--nb-surface));
    line-height: 0;
  }
</style>
