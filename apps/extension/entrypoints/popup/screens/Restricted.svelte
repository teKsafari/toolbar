<script lang="ts">
  // Restricted page (J-199): browser pages and extension stores block every capture.
</script>

<div class="restricted" data-screen="restricted">
  <svg viewBox="0 0 120 80" aria-hidden="true">
    <rect x="10" y="8" width="100" height="64" rx="8" class="frame" />
    <path d="M10 22h100" class="line" />
    <circle cx="20" cy="15" r="2.5" class="dotf" />
    <circle cx="28" cy="15" r="2.5" class="dotf" />
    <circle cx="60" cy="47" r="14" class="ring" />
    <path d="M50 57 70 37" class="ring" />
  </svg>
  <p><strong>This page can't be captured.</strong></p>
  <p class="muted">Browser pages and extension stores are off limits. Open a regular website and try again.</p>
</div>

<style>
  .restricted {
    padding: 8px 8px 4px;
    text-align: center;
  }
  svg {
    width: 120px;
    height: 80px;
  }
  .frame {
    fill: var(--nb-surface-2);
    stroke: var(--nb-border-strong);
    stroke-width: 2;
  }
  .line {
    stroke: var(--nb-border-strong);
    stroke-width: 2;
  }
  .dotf {
    fill: var(--nb-border-strong);
  }
  .ring {
    fill: none;
    stroke: var(--nb-danger);
    stroke-width: 4;
    stroke-linecap: round;
  }
  p {
    margin: 6px 0 0;
  }
  .muted {
    color: var(--nb-text-muted);
    font-size: var(--nb-text-md);
  }
</style>
