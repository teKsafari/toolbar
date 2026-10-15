<script lang="ts">
  // Info tab (J-101, J-070): page and device metadata as label and value rows, a timestamp whose
  // menu switches between the capture's zone, yours and UTC, and a custom logs row with setup.
  import { fmtTimestamp, type ZoneChoice } from '@toolbar/ui/viewer';
  import VIcon from './VIcon.svelte';
  import Dropdown from './Dropdown.svelte';
  import { useViewer } from './viewer.svelte.ts';
  import { copyText } from './api.ts';
  import { toasts } from '@toolbar/ui';

  const v = useViewer();
  const env = $derived(v.detail.env);
  let zoneMenu = $state(false);
  let setup = $state(false);
  const t = $derived(Date.parse(v.detail.startedAt ?? v.detail.createdAt));
  const ZONES: { id: ZoneChoice; label: string }[] = $derived([
    { id: 'capture', label: `Capture's time zone${env?.tz ? ` (${env.tz})` : ''}` },
    { id: 'local', label: 'Your time zone' },
    { id: 'utc', label: 'UTC' },
  ]);
  const speed = $derived.by(() => {
    const c = env?.connection;
    if (!c) return null;
    const parts = [c.effectiveType?.toUpperCase(), c.downlink != null ? `${c.downlink} Mbps` : null, c.rtt != null ? `${c.rtt} ms latency` : null].filter(Boolean);
    return parts.join(', ');
  });
  /** Country of the capture (J-070, J-101): a region name from the ISO code the capture holds. */
  const location = $derived.by(() => {
    const cc = (env as { country?: string } | null)?.country;
    if (!cc) return null;
    try {
      return `${new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) ?? cc}`;
    } catch {
      return cc;
    }
  });
  const MASKING: Record<string, string> = {
    staging: 'Staging, own team: text recorded, bodies of the app’s own origins',
    production: 'Production: text and inputs masked, media blocked, bodies only for allowlisted URLs',
  };
  const rows = $derived(
    [
      ['URL', v.detail.pageUrl ?? env?.url ?? null],
      ['Page title', v.detail.pageTitle],
      // D-117, D-119
      ['Project', v.detail.project?.name ?? null],
      ['Masking', MASKING[v.detail.maskingPreset ?? env?.maskingPreset ?? ''] ?? null],
      ['OS', env?.os ? `${env.os.name}${env.os.version ? ' ' + env.os.version : ''}` : (env?.platform ?? null)],
      ['Browser', env?.browser ? `${env.browser.name} ${env.browser.version}` : null],
      ['Viewport', env?.viewport ? `${env.viewport.w} x ${env.viewport.h}` : null],
      ['Screen', env?.screen ? `${env.screen.w} x ${env.screen.h}` : null],
      ['Pixel ratio', env?.dpr != null ? String(env.dpr) : null],
      ['Language', env?.locale ?? null],
      ['Location', location],
      ['Time zone', env?.tz ?? null],
      ['Network speed', speed],
      ['Incognito', env?.incognito == null ? null : env.incognito ? 'Yes' : 'No'],
      ['Extension', env?.extVersion ? `${env.extVersion}` : null],
      ['User agent', env?.ua ?? null],
    ].filter((r): r is [string, string] => !!r[1]),
  );
  async function copySnippet() {
    if (await copyText(snippet)) toasts.success('Snippet copied');
    else toasts.error('Could not copy');
  }
  const snippet = `window.toolbar?.setMetadata({\n  userId: 'u_123',\n  plan: 'team',\n});`;
</script>

<div class="info" data-testid="info-tab">
  <dl>
    <dt>Captured</dt>
    <dd class="ts">
      <span data-testid="timestamp">{fmtTimestamp(t, v.prefs.timeZone, env?.tz)}</span>
      <Dropdown open={zoneMenu} align="end" onclose={() => (zoneMenu = false)}>
        {#snippet trigger()}
          <button type="button" class="mini" onclick={() => (zoneMenu = !zoneMenu)} aria-haspopup="menu" data-testid="zone-menu"><VIcon name="clock" size={12} />{v.prefs.timeZone === 'utc' ? 'UTC' : v.prefs.timeZone === 'local' ? 'Yours' : 'Capture'}<VIcon name="chevron-down" size={11} /></button>
        {/snippet}
        <div class="menu" role="menu">
          {#each ZONES as z (z.id)}
            <button type="button" role="menuitemradio" aria-checked={v.prefs.timeZone === z.id} class:sel={v.prefs.timeZone === z.id} onclick={() => { v.setPref({ timeZone: z.id }); zoneMenu = false; }}>{z.label}</button>
          {/each}
        </div>
      </Dropdown>
    </dd>
    {#each rows as [k, val] (k)}
      <dt>{k}</dt>
      <dd>{#if k === 'URL'}<a href={val} target="_blank" rel="noopener noreferrer">{val}</a>{:else}{val}{/if}</dd>
    {/each}
    <dt>Custom logs</dt>
    <dd>
      {#if v.detail.metadata && Object.keys(v.detail.metadata).length}
        <pre>{JSON.stringify(v.detail.metadata, null, 2)}</pre>
      {:else}
        <span class="muted">None sent.</span>
        <button type="button" class="mini" onclick={() => (setup = !setup)} aria-expanded={setup} data-testid="custom-logs-setup">Set up</button>
      {/if}
    </dd>
  </dl>
  {#if setup}
    <div class="setup">
      <p>Pages can attach their own fields to every capture. Call this from the page; the extension picks it up on the next capture.</p>
      <div class="snip">
        <pre>{snippet}</pre>
        <button type="button" class="mini copy" onclick={copySnippet} data-testid="custom-logs-copy"><VIcon name="copy" size={12} />Copy</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .info { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px 16px; }
  dl { display: grid; grid-template-columns: minmax(96px, max-content) 1fr; gap: 0; margin: 0; font-size: var(--nb-text-md); }
  dt, dd { padding: 6px 0; border-bottom: 1px solid var(--nb-border); }
  dt { color: var(--nb-text-muted); padding-right: 12px; }
  dd { margin: 0; word-break: break-word; min-width: 0; }
  .ts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .mini { all: unset; display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid var(--nb-border-strong); font-size: var(--nb-text-sm); cursor: pointer; }
  .mini:hover { background: var(--nb-surface-sunken); }
  .menu { display: flex; flex-direction: column; min-width: 220px; padding: 4px; border-radius: var(--nb-radius-md); background: var(--nb-chrome); color: var(--nb-on-chrome); box-shadow: var(--nb-shadow-lg); }
  .menu button { all: unset; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: var(--nb-text-md); }
  .menu button:hover, .menu .sel { background: var(--nb-chrome-2); }
  .muted { color: var(--nb-text-muted); margin-right: 8px; }
  pre { margin: 0; padding: 6px 8px; border-radius: 6px; background: var(--nb-surface-sunken); font: var(--nb-text-sm) var(--nb-font-mono); white-space: pre-wrap; }
  .setup { margin-top: 12px; padding: 10px 12px; border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border); font-size: var(--nb-text-md); }
  .setup p { margin: 0 0 8px; color: var(--nb-text-muted); }
  .snip { position: relative; }
  .snip .copy { position: absolute; top: 6px; right: 6px; background: var(--nb-surface); }
</style>
