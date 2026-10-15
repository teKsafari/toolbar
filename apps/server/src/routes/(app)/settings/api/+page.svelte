<script lang="ts">
  // "API" item of the settings nav: the REST API this server offers, for scripts and
  // tools. Tokens come from the API tokens page; the full route table is at /api/v1.
  import { ROUTE_LIST, routeListed, type RouteDef } from '@toolbar/shared/api';
  import Section from '#lib/components/dashboard/Section.svelte';
  import { page } from '$app/state';
  const origin = $derived(page.url.origin);
  // Routes of paused features (docs/scope.md: AI drafts, the audit log, integrations and send to
  // app) show only while their flag is on.
  const flags = $derived((page.data as { features?: Record<string, boolean> }).features ?? {});
  const mine = $derived((ROUTE_LIST as readonly RouteDef[]).filter((r) => r.auth !== 'session' && !r.path.startsWith('/s/') && !r.path.startsWith('/rl/') && r.path.startsWith('/api/v1') && routeListed(r, flags)));
</script>

<svelte:head><title>API · Settings</title></svelte:head>

<h1>API</h1>
<Section title="REST API" description="Everything the dashboard does is an HTTP call you can make too.">
  <p>Base URL: <code>{origin}/api/v1</code>. Send <code>Authorization: Bearer tb_pat_...</code> with a token from <a href="/settings/tokens">API tokens</a>. Lists return <code>{'{ items, total, returned, hasMore, nextCursor }'}</code>; errors return <code>{'{ error, message }'}</code>.</p>
  <pre class="ex">curl -H "Authorization: Bearer $NIB_TOKEN" {origin}/api/v1/recordings?limit=5</pre>
  <p>Machine-readable list: <a href={`${origin}/api/v1`} target="_blank" rel="noopener">{origin}/api/v1</a></p>
</Section>
<Section title="Endpoints" description="Routes of paused features (AI drafts, the audit log, integrations) are left out while their flag is off.">
  <div class="tablewrap">
    <table>
      <tbody>
        {#each mine as r (r.name)}
          <tr data-route={r.name}><td class="m">{r.method}</td><td><code>{r.path}</code></td><td class="muted">{r.summary}</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</Section>

<style>
  h1 { margin-bottom: 18px; }
  p { margin: 0; }
  code { font-size: var(--nb-text-sm); }
  .ex { margin: 0; padding: 10px 12px; border-radius: var(--nb-radius-md); background: var(--nb-surface-2); font: var(--nb-text-sm) var(--nb-font-mono); overflow-x: auto; }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; font-size: var(--nb-text-sm); }
  td { padding: 5px 8px; border-bottom: 1px solid var(--nb-border); vertical-align: top; }
  .m { font: var(--nb-text-xs) var(--nb-font-mono); color: var(--nb-text-muted); }
</style>
