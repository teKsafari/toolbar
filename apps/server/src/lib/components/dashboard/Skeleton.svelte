<script lang="ts">
  let { w = '100%', h = '12px', r = '6px', round = false }: { w?: string; h?: string; r?: string; round?: boolean } = $props();
</script>

<span class="sk" style="width:{w};height:{h};border-radius:{round ? '50%' : r}" aria-hidden="true"></span>

<style>
  .sk {
    display: block; background: linear-gradient(90deg, var(--nb-surface-sunken) 25%, var(--nb-surface-2) 50%, var(--nb-surface-sunken) 75%);
    background-size: 200% 100%; animation: sk 1.2s ease-in-out infinite;
  }
  @keyframes sk { from { background-position: 100% 0; } to { background-position: -100% 0; } }
  @media (prefers-reduced-motion: reduce) { .sk { animation: none; } }
</style>
