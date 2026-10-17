<script lang="ts">
  // An agent's mark (D-207): our own two-letter monogram in a rounded square, the shape GitHub's
  // Primer gives apps and bots so they never read as a person (people stay round). A muted hue
  // per agent; text passes 4.5:1 on the fill in light and dark (agent-name.ts, unit-tested).
  import { agentIdentity, markColors } from './agent-name.ts';

  interface Props {
    /** the raw client name, as stored */
    agent: string | null | undefined;
    size?: number;
    /** decorative inside a labelled stack; standalone it carries the agent's name */
    decorative?: boolean;
    /** a person's avatar covers the bottom-right corner: draw the letters toward the top-left */
    stacked?: boolean;
  }
  let { agent, size = 24, decorative = false, stacked = false }: Props = $props();
  const id = $derived(agentIdentity(agent));
  const c = $derived(markColors(id));
</script>

<span
  class="am"
  class:stacked
  style:--s="{size}px"
  style:--bg-l={c.light.bg}
  style:--fg-l={c.light.fg}
  style:--bg-d={c.dark.bg}
  style:--fg-d={c.dark.fg}
  role={decorative ? undefined : 'img'}
  aria-hidden={decorative ? 'true' : undefined}
  aria-label={decorative ? undefined : id.name}
  title={decorative ? undefined : id.name}
  data-testid="agent-mark"
  data-agent={id.name}>{id.monogram}</span>

<style>
  .am {
    --bg: var(--bg-l); --fg: var(--fg-l);
    display: inline-grid; place-items: center; flex: none; box-sizing: border-box;
    width: var(--s); height: var(--s);
    /* a quarter of the side: 6 px at 24, 7 px at 28, concentric with the 8 px cards around it */
    border-radius: calc(var(--s) * 0.26);
    background: var(--bg); color: var(--fg);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 14%, transparent);
    font: 600 calc(var(--s) * 0.4) / 1 var(--nb-font-sans);
    letter-spacing: -0.02em; font-variant-ligatures: none; user-select: none;
  }
  /* the letters move into the free top-left area, clear of the person's avatar */
  .am.stacked { place-items: start; padding: calc(var(--s) * 0.14) 0 0 calc(var(--s) * 0.12); font-size: calc(var(--s) * 0.36); }
  :global([data-theme='dark']) .am { --bg: var(--bg-d); --fg: var(--fg-d); }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .am { --bg: var(--bg-d); --fg: var(--fg-d); }
  }
</style>
