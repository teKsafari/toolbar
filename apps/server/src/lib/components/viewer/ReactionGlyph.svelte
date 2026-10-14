<script lang="ts">
  // One of the eight reaction glyphs, drawn by us (D-029: no emoji characters).
  import type { ReactionKey } from '@toolbar/shared/api';
  import { reactionGlyphs } from '@toolbar/ui/viewer';

  let { k, size = 16 }: { k: ReactionKey; size?: number } = $props();
  const g = $derived(reactionGlyphs[k]);
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style:color={g.color} role="img" aria-label={g.label} data-reaction={k}>{@html g.svg.join('')}</svg>
