<script lang="ts">
  // Letter avatar with a colour picked from the name (anonymous comments get a letter too, J-134).
  interface Props {
    name: string;
    image?: string | null;
    size?: number;
  }
  let { name, image = null, size = 24 }: Props = $props();
  const HUES = [228, 262, 18, 152, 196, 330, 38, 120];
  const hue = $derived(HUES[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length]);
  const letter = $derived((name.trim()[0] ?? '?').toUpperCase());
</script>

{#if image}
  <img class="av" src={image} alt="" width={size} height={size} style:width="{size}px" style:height="{size}px" />
{:else}
  <span class="av" style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.46)}px" style:background="hsl({hue} 55% 46%)" aria-hidden="true">{letter}</span>
{/if}

<style>
  .av { display: inline-grid; place-items: center; flex: none; border-radius: 50%; color: #fff; font-weight: 600; object-fit: cover; }
</style>
