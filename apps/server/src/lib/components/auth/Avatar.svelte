<script lang="ts">
  // Letter avatar for a workspace: first letter of the name on an accent tint.
  let { name, size = 24 }: { name: string; size?: number } = $props();
  const letter = $derived((name.trim()[0] ?? '?').toUpperCase());
</script>

<span class="av" style="--s:{size}px" aria-hidden="true">{letter}</span>

<style>
  .av {
    display: inline-grid; place-items: center; flex: none; width: var(--s); height: var(--s);
    border-radius: calc(var(--s) / 4); background: var(--nb-accent); color: var(--nb-on-accent);
    font-size: calc(var(--s) * 0.5); font-weight: var(--nb-weight-semibold); line-height: 1;
  }
</style>
