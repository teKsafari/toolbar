<script lang="ts">
  // "SDK" item of the settings nav (J-171): how a page attaches its own data to every capture
  // (custom metadata, J-073). No package to install: the extension puts window.toolbar on each
  // page, and the callback runs when a capture is made.
  import { Button, toasts } from '@toolbar/ui';
  import Section from '#lib/components/dashboard/Section.svelte';
  import { copyText } from '#lib/components/dashboard/api.ts';

  const snippet = `// Runs when someone makes a capture on this page. Return plain JSON under 10 KB.
window.toolbar?.setMetadata(() => ({
  userId: currentUser?.id,
  plan: currentUser?.plan,
  build: APP_VERSION,
}));`;
  const guarded = `if (window.toolbar) window.toolbar.setMetadata({ tenant: 'acme' });
// Pass null to stop attaching data.`;
</script>

<svelte:head><title>SDK · Settings</title></svelte:head>

<h1>SDK</h1>
<Section title="Custom metadata" description="Attach your own data, such as the user id, plan or build, to every capture made on your app." testid="sdk-metadata">
  <ol class="steps">
    <li>Add the call below to your app's code, after sign-in. Nothing to install: the extension provides <code>window.toolbar</code> on each page.</li>
    <li>Make a capture. The data shows in the capture's info tab as custom metadata, and agents read it through MCP and the HTTP API.</li>
  </ol>
  <div class="code">
    <pre data-testid="sdk-snippet">{snippet}</pre>
    <Button size="sm" icon="copy" onclick={async () => (await copyText(snippet)) && toasts.success('Snippet copied')} data-testid="sdk-copy">Copy</Button>
  </div>
  <pre class="alt">{guarded}</pre>
</Section>
<Section title="Limits" description="What the extension accepts.">
  <ul class="limits">
    <li>The callback, or the object you pass, must give plain JSON of at most 10 KB. Larger data is dropped, and the capture's console shows a warning row.</li>
    <li>The callback runs once per capture, on the page being captured, so it can read the state of that moment.</li>
    <li>Masking rules do not apply to this data. Leave out passwords and tokens.</li>
  </ul>
</Section>

<style>
  h1 { margin-bottom: 18px; }
  .steps, .limits { margin: 0 0 14px; padding-left: 20px; display: grid; gap: 6px; font-size: var(--nb-text-md); }
  .limits { margin: 0; }
  code { font-size: var(--nb-text-sm); }
  .code { position: relative; }
  .code :global(button) { position: absolute; top: 8px; right: 8px; }
  pre { margin: 0 0 10px; padding: 12px 14px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); background: var(--nb-surface-2); font: var(--nb-text-sm) / 1.6 var(--nb-font-mono); overflow-x: auto; }
  .alt { color: var(--nb-text-muted); }
</style>
