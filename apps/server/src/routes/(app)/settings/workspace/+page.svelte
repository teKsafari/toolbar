<script lang="ts">
  // J-172 workspace general settings: logo (hover to upload) and name; access (sign-in providers,
  // default link access J-120, join by email domain J-125); data (AI switch J-156, auto-delete
  // J-178, audit log). Settings save at once with no toast, and nothing is plan-gated. The data
  // section holds paused features only (docs/scope.md: FEATURE_AI, FEATURE_ADMIN_EXTRAS), so it
  // shows only when one of those flags is on.
  import { invalidateAll } from '$app/navigation';
  import { toasts } from '@toolbar/ui';
  import type { WorkspaceSettings } from '@toolbar/shared/api';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Field from '#lib/components/dashboard/Field.svelte';
  import Switch from '#lib/components/dashboard/Switch.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, errMsg, urlOf } from '#lib/components/dashboard/api.ts';
  import { HELP_LINKS } from '#lib/components/dashboard/links.ts';

  let { data } = $props();
  const ws = $derived(data.ws);
  const admin = $derived(ws.role === 'admin');
  const f = $derived(data.features);
  // svelte-ignore state_referenced_locally
  // svelte-ignore state_referenced_locally
  let s = $state<WorkspaceSettings>(structuredClone(data.ws.settings));
  // svelte-ignore state_referenced_locally
  let name = $state(data.ws.name);
  let logoBusy = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  async function patch(body: Record<string, unknown>) {
    try {
      const r = await api<{ settings: WorkspaceSettings; name: string }>('workspaces.update', { params: { workspaceId: ws.id }, body });
      s = structuredClone(r.settings);
      if ('name' in body || 'logoAssetId' in body) await invalidateAll();
    } catch (e) {
      toasts.error(errMsg(e));
      s = structuredClone(data.ws.settings);
    }
  }

  async function saveName() {
    const n = name.trim();
    if (!n || n === ws.name) return;
    await patch({ name: n });
  }

  async function uploadLogo(file: File) {
    logoBusy = true;
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('kind', 'logo');
      const res = await fetch(urlOf('captures.uploadAsset'), { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? 'Upload failed');
      await patch({ logoAssetId: j.id });
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      logoBusy = false;
    }
  }

  const autoDeleteOptions = [
    [null, 'Never'],
    [30, 'After 30 days'],
    [60, 'After 60 days'],
    [90, 'After 90 days'],
    [180, 'After 180 days'],
    [365, 'After a year'],
  ] as const;
</script>

<svelte:head><title>General · Settings</title></svelte:head>

<h1>General</h1>
{#if !admin}<p class="muted note">Only workspace admins can change these settings.</p>{/if}

<Section title="Workspace" description="How your workspace shows up for members and in shared links." testid="ws-identity">
  <div class="ident">
    <button class="logo" disabled={!admin || logoBusy} onclick={() => fileInput?.click()} aria-label="Upload a logo" data-testid="ws-logo">
      {#if ws.logoUrl}<img src={ws.logoUrl} alt="" />{:else}<span class="letter">{(ws.name[0] ?? '?').toUpperCase()}</span>{/if}
      {#if admin}<span class="over">{#if logoBusy}<DIcon name="spinner" />{:else}<DIcon name="upload" />{/if}</span>{/if}
    </button>
    <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) void uploadLogo(f); }} />
    <label class="name">Workspace name
      <input type="text" bind:value={name} disabled={!admin} maxlength="100" onblur={saveName} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} data-testid="ws-name" />
    </label>
    {#if ws.logoUrl && admin}<button class="link" onclick={() => patch({ logoAssetId: null })}>Remove logo</button>{/if}
  </div>
</Section>

<Section title="Access" description="Who can get in and what new share links allow." docs={HELP_LINKS.docs}>
  <Field label="Single sign-on" hint={data.sso.length ? `Members can sign in with ${data.sso.join(', ')}.` : 'Set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET on the server to offer it on the sign-in page.'}>
    <span class="pill" class:on={data.sso.length > 0}>{data.sso.length ? 'On' : 'Off'}</span>
  </Field>
  <Field label="Default link access" hint="General access of new captures. Anyone with the link, or only members of this workspace.">
    <select disabled={!admin} value={s.defaultLinkAccess} onchange={(e) => patch({ defaultLinkAccess: (e.currentTarget as HTMLSelectElement).value })} data-testid="ws-default-access">
      <option value="anyone">Anyone with the link</option>
      <option value="workspace">Workspace members only</option>
    </select>
  </Field>
  <Field label="Join by email domain" hint={s.domainJoin.domain ? `People who sign up with @${s.domainJoin.domain} join as viewers.` : 'People who sign up with your company domain join as viewers.'}>
    <Switch label="Join by email domain" disabled={!admin || !s.domainJoin.domain} checked={s.domainJoin.enabled} onchange={(v) => patch({ domainJoin: { ...s.domainJoin, enabled: v } })} testid="ws-domain-join" />
  </Field>
  {#if admin}
    <Field label="Domain">
      <input class="dom" type="text" value={s.domainJoin.domain ?? ''} placeholder="example.com" onchange={(e) => { const d = (e.currentTarget as HTMLInputElement).value.trim().toLowerCase().replace(/^@/, ''); void patch({ domainJoin: { enabled: d ? s.domainJoin.enabled : false, domain: d || null } }); }} data-testid="ws-domain" />
    </Field>
  {/if}
</Section>

{#if f.ai || f.adminExtras}
<Section title="Data" description={f.ai && f.adminExtras ? 'AI features, how long captures are kept, and the record of changes.' : f.ai ? 'AI features.' : 'How long captures are kept, and the record of changes.'} docs={HELP_LINKS.docs}>
  {#if f.ai}
  <Field label="AI titles, chapters and summaries" hint="Off: nobody in this workspace gets AI suggestions, chapters or analysis.">
    <Switch label="AI features" disabled={!admin} checked={s.aiEnabled} onchange={(v) => patch({ aiEnabled: v })} testid="ws-ai" />
  </Field>
  {/if}
  {#if f.adminExtras}
  <Field label="Delete captures automatically" hint="Captures older than this are deleted with their media, every hour.">
    <select disabled={!admin} value={s.autoDeleteDays === null ? '' : String(s.autoDeleteDays)} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; void patch({ autoDeleteDays: v ? Number(v) : null }); }} data-testid="ws-auto-delete">
      {#each autoDeleteOptions as [v, l] (l)}<option value={v === null ? '' : String(v)}>{l}</option>{/each}
    </select>
  </Field>
  <Field label="Audit log" hint="Captures made, deleted and shared, member and role changes, apps connected.">
    {#if admin}<a href="/settings/audit" data-testid="ws-audit-link">Open the audit log</a>{:else}<span class="muted">Admins only</span>{/if}
  </Field>
  {/if}
</Section>
{/if}


<style>
  h1 { margin-bottom: 18px; }
  .note { margin: -8px 0 16px; }
  .ident { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; }
  .logo { all: unset; position: relative; width: 64px; height: 64px; border-radius: var(--nb-radius-lg); overflow: hidden; cursor: pointer; background: var(--nb-accent); color: var(--nb-on-accent); display: grid; place-items: center; }
  .logo:disabled { cursor: default; }
  .logo img { width: 100%; height: 100%; object-fit: cover; }
  .letter { font: var(--nb-weight-medium) 28px / 1 var(--nb-font-display); }
  .over { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(11 11 11 / 0.5); color: #fafafa; opacity: 0; transition: opacity var(--nb-dur-fast) var(--nb-ease-out); }
  .logo:hover .over, .logo:focus-visible .over { opacity: 1; }
  .logo:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .name { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 6px; font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); color: var(--nb-text); }
  .name input { color: var(--nb-text); font-weight: var(--nb-weight-normal); }
  .link { all: unset; color: var(--nb-accent-text); cursor: pointer; font-size: var(--nb-text-md); }
  select, .dom {
    height: var(--nb-control-lg); border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface);
    color: var(--nb-text); padding: 0 8px; font: inherit; font-size: var(--nb-text-md); max-width: 240px;
  }
  .pill { font-size: var(--nb-text-xs); font-weight: var(--nb-weight-medium); padding: 2px 8px; border-radius: var(--nb-radius-pill); background: var(--nb-surface-sunken); color: var(--nb-text-muted); }
  .pill.on { background: var(--nb-success-tint); color: var(--nb-success-text); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .link:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: 2px; }
</style>
