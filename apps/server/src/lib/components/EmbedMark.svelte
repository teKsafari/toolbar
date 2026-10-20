<script lang="ts">
  // After an embed reviewer's name (D-213): they typed it on the site's embedded toolbar and no
  // account stands behind it, so "Ola" here is not the member Ola. Takes the colour around it, so it
  // reads on the dark chips over thumbnails as on the page.
</script>

<span class="em" title="Name typed on the site's embedded toolbar, not a signed-in account" data-testid="embed-mark">embed</span>

<style>
  .em {
    flex: none; display: inline-block; margin-left: 5px; padding: 0 5px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
    border-radius: var(--nb-radius-pill); font-size: 10.5px; font-weight: 500; line-height: 14px; letter-spacing: 0.01em; vertical-align: 1px;
    opacity: 0.8; white-space: nowrap;
  }
</style>
