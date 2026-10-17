<script lang="ts">
  // An agent's mark (D-207, D-208): a rounded square, the shape GitHub's Primer gives apps and
  // bots so they never read as a person (people stay round). A known agent shows its product's
  // logo on a neutral tile, in its brand colour where that keeps 3:1 against the tile, else in
  // monochrome (agent-name.ts, unit-tested). Any other agent keeps a two-letter monogram on a
  // muted hue whose text passes 4.5:1 on the fill.
  import { AGENT_LOGOS } from './agent-logos.ts';
  import { agentIdentity, logoColors, markColors } from './agent-name.ts';

  interface Props {
    /** the raw client name, as stored */
    agent: string | null | undefined;
    size?: number;
    /** decorative inside a labelled stack; standalone it carries the agent's name */
    decorative?: boolean;
    /** a person's avatar covers the bottom-right corner: draw the letters toward the top-left */
    stacked?: boolean;
    /** a small round badge on a person's avatar (D-209) */
    badge?: boolean;
  }
  let { agent, size = 24, decorative = false, stacked = false, badge = false }: Props = $props();
  const id = $derived(agentIdentity(agent));
  const logo = $derived(id.logo ? AGENT_LOGOS[id.logo] : null);
  const c = $derived.by(() => {
    if (!id.logo) return markColors(id);
    const l = logoColors(id.logo);
    return { light: { bg: l.light.tile, fg: l.light.ink }, dark: { bg: l.dark.tile, fg: l.dark.ink } };
  });
</script>

<span
  class="am"
  class:stacked
  class:badge
  class:logo={!!logo}
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
  data-agent={id.name}
  data-logo={id.logo}
  >{#if logo}<svg viewBox="0 0 {logo.box} {logo.box}" aria-hidden="true" focusable="false" data-testid="agent-logo"><title>{logo.title}</title><path d={logo.path} fill="currentColor" /></svg>{:else}{id.monogram}{/if}</span>

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
  /* a logo: centred at 62 % of the side; stacked, 56 % in the top-left, where the person's avatar
     at the bottom-right corner leaves it whole (its ring stops short of the logo's box) */
  .am svg { display: block; width: calc(var(--s) * 0.62); height: calc(var(--s) * 0.62); }
  .am.logo { box-shadow: inset 0 0 0 1px var(--nb-border); }
  .am.logo.stacked { padding: calc(var(--s) * 0.09); }
  .am.logo.stacked svg { width: calc(var(--s) * 0.56); height: calc(var(--s) * 0.56); }
  /* badge: a disc, the logo centred and large enough to read at 14 to 18 px */
  .am.badge { border-radius: 50%; padding: 0; font-size: calc(var(--s) * 0.42); }
  .am.badge svg { width: calc(var(--s) * 0.72); height: calc(var(--s) * 0.72); }
  :global([data-theme='dark']) .am { --bg: var(--bg-d); --fg: var(--fg-d); }
  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .am { --bg: var(--bg-d); --fg: var(--fg-d); }
  }
</style>
