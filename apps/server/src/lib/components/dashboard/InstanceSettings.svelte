<script lang="ts">
  // Settings > Server, instance settings (D-194): one section per INSTANCE_SECTIONS entry, fields
  // from INSTANCE_FIELDS. A field an environment variable sets is read-only with a badge. Each
  // section saves its changed fields with one button; an emptied field resets to its default.
  // Values are checked here with the same schemas the server uses, so errors show before saving.
  import { Button, toasts } from '@toolbar/ui';
  import {
    INSTANCE_FIELDS,
    INSTANCE_SECTIONS,
    parseInstanceValue,
    type AdminInstanceSettings,
    type InstanceFieldSpec,
    type InstanceKey,
    type InstanceSectionId,
    type TestInstanceSettingResult,
  } from '@toolbar/shared/api';
  import Section from './Section.svelte';
  import Field from './Field.svelte';
  import { api, copyText, errMsg } from './api.ts';

  let { initial }: { initial: AdminInstanceSettings } = $props();
  // svelte-ignore state_referenced_locally
  let s = $state<AdminInstanceSettings>(initial);

  /** The form text of a value: lists joined, the span window in seconds, null as empty. */
  function textOf(f: InstanceFieldSpec, v: unknown): string {
    if (f.kind === 'secret' || v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join(f.key === 'oidcScopes' ? ' ' : ', ');
    if (typeof v === 'number' && f.scale) return String(v / f.scale);
    return String(v);
  }
  const formOf = (a: AdminInstanceSettings) => Object.fromEntries(INSTANCE_FIELDS.map((f) => [f.key, textOf(f, a.values[f.key])])) as Record<InstanceKey, string>;
  // svelte-ignore state_referenced_locally
  let form = $state<Record<InstanceKey, string>>(formOf(initial));
  let busy = $state<InstanceSectionId | null>(null);
  let results = $state<Partial<Record<'transcription' | 'oidc', TestInstanceSettingResult & { busy?: boolean }>>>({});

  const fieldsOf = (id: InstanceSectionId) => INSTANCE_FIELDS.filter((f) => f.section === id);
  const changed = (f: InstanceFieldSpec) => !s.locked[f.key] && form[f.key].trim() !== textOf(f, s.values[f.key]);

  /** The value to send for a field: null resets it; numbers in stored units. */
  function valueOf(f: InstanceFieldSpec): unknown {
    const t = form[f.key].trim();
    if (!t) return null;
    if (f.kind === 'int' || f.kind === 'number') {
      const n = Number(t);
      return Number.isFinite(n) && f.scale ? Math.round(n * f.scale) : n;
    }
    return t;
  }
  function errorOf(f: InstanceFieldSpec): string | null {
    if (!changed(f)) return null;
    const v = valueOf(f);
    if (v === null) return null;
    const r = parseInstanceValue(f.key, v);
    return r.ok ? null : r.message;
  }
  const dirty = (id: InstanceSectionId) => fieldsOf(id).filter(changed);
  const invalid = (id: InstanceSectionId) => fieldsOf(id).some((f) => errorOf(f));

  function applied(next: AdminInstanceSettings, keys: InstanceKey[]) {
    s = next;
    const fresh = formOf(next);
    // keep what the person typed in other sections
    for (const k of keys) form[k] = fresh[k];
  }

  async function save(id: InstanceSectionId) {
    const fields = dirty(id);
    if (!fields.length || invalid(id)) return;
    busy = id;
    try {
      const body = Object.fromEntries(fields.map((f) => [f.key, valueOf(f)]));
      applied(await api<AdminInstanceSettings>('instanceSettings.update', { body }), fields.map((f) => f.key));
      toasts.success('Settings saved');
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      busy = null;
    }
  }

  async function reset(f: InstanceFieldSpec) {
    try {
      applied(await api<AdminInstanceSettings>('instanceSettings.update', { body: { [f.key]: null } }), [f.key]);
      toasts.success(`${f.label} reset`);
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function test(target: 'transcription' | 'oidc') {
    results[target] = { ok: false, message: 'Testing...', busy: true };
    const keys = INSTANCE_FIELDS.filter((f) => f.section === (target === 'oidc' ? 'signin' : 'transcription'));
    const values = Object.fromEntries(keys.filter((f) => !s.locked[f.key] && form[f.key].trim()).map((f) => [f.key, valueOf(f)]));
    try {
      results[target] = await api<TestInstanceSettingResult>('instanceSettings.test', { body: { target, values } });
    } catch (e) {
      results[target] = { ok: false, message: errMsg(e) };
    }
  }

  const display = (f: InstanceFieldSpec, v: unknown) => (v === null || v === undefined || (Array.isArray(v) && !v.length) ? 'none' : textOf(f, v) + (f.unit ? ` ${f.unit}` : ''));
  const hintOf = (f: InstanceFieldSpec) => {
    const lock = s.locked[f.key];
    if (lock) return `Set by ${lock} on the server. ${f.hint}`;
    const d = s.defaults[f.key];
    return f.kind === 'secret' || f.kind === 'enum' ? f.hint : `${f.hint} Default: ${display(f, d)}.`;
  };
  const provider = $derived(form.transcribeProvider);
  /** fields that matter for the provider picked on the form */
  const shown = (f: InstanceFieldSpec) => {
    if (f.section !== 'transcription' || f.key === 'transcribeProvider') return true;
    if (provider === 'none') return false;
    if (f.key === 'whisperUrl') return provider === 'local';
    if (['transcribeApiKey', 'transcribeModel', 'transcribeBaseUrl', 'transcribeTimestamps', 'transcribeChunkSeconds', 'transcribeConcurrency'].includes(f.key)) return provider === 'openai';
    return true;
  };
</script>

{#each INSTANCE_SECTIONS as sec (sec.id)}
  <Section title={sec.title} description={sec.description} testid="server-{sec.id}">
    {#if sec.id === 'signin'}
      <Field label="Provider" hint={s.oidc.configured ? `Set by OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET on the server. Register the redirect URI with the provider.` : 'No provider yet: set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET on the server.'} badge="Set by environment">
        <span class="mono" data-testid="server-oidc-issuer">{s.oidc.issuer ?? 'not set'}</span>
      </Field>
      {#if s.oidc.configured}
        <Field label="Redirect URI">
          <span class="mono">{s.oidc.redirectUri}</span>
          <button class="link" onclick={async () => (await copyText(s.oidc.redirectUri)) && toasts.success('Redirect URI copied')}>Copy</button>
        </Field>
      {/if}
      {#if s.bootstrap.publicUrl && s.bootstrap.openSignIn}
        <p class="warn" role="note" data-testid="server-open-signin">
          No allowed email domains: anyone your provider signs in can get in. Add your domains below.
        </p>
      {/if}
    {/if}

    {#each fieldsOf(sec.id).filter(shown) as f (f.key)}
      {@const lock = s.locked[f.key]}
      {@const err = errorOf(f)}
      <Field label={f.label} hint={hintOf(f)} badge={lock ? 'Set by environment' : undefined}>
        <div class="cell">
        <div class="ctl" data-testid="setting-{f.key}" data-locked={lock ? 'true' : undefined}>
          {#if f.kind === 'enum'}
            <select bind:value={form[f.key]} disabled={!!lock} aria-label={f.label}>
              {#each f.options ?? [] as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
          {:else if f.kind === 'secret'}
            <input
              type="password"
              autocomplete="off"
              bind:value={form[f.key]}
              disabled={!!lock}
              aria-label={f.label}
              placeholder={s.values[f.key] ? `Saved: ${s.values[f.key]}. Type to replace` : (f.placeholder ?? '')}
            />
          {:else}
            <input
              type="text"
              inputmode={f.kind === 'int' || f.kind === 'number' ? 'decimal' : undefined}
              class:num={f.kind === 'int' || f.kind === 'number'}
              bind:value={form[f.key]}
              disabled={!!lock}
              aria-label={f.label}
              aria-invalid={err ? 'true' : undefined}
              placeholder={f.placeholder ?? display(f, s.defaults[f.key])}
              onkeydown={(e) => e.key === 'Enter' && save(sec.id)}
            />
          {/if}
          {#if f.unit}<span class="unit">{f.unit}</span>{/if}
          {#if !lock && s.stored[f.key]}<button class="link" onclick={() => reset(f)} data-testid="reset-{f.key}">{f.kind === 'secret' ? 'Remove' : 'Reset'}</button>{/if}
        </div>
        {#if err}<span class="err" role="alert" data-testid="error-{f.key}">{err}</span>{/if}
        </div>
      </Field>
    {/each}

    <div class="acts">
      {#if sec.id === 'transcription'}
        <Button onclick={() => test('transcription')} disabled={results.transcription?.busy} data-testid="test-transcription">Test connection</Button>
      {/if}
      {#if sec.id === 'signin' && s.oidc.configured}
        <Button onclick={() => test('oidc')} disabled={results.oidc?.busy} data-testid="test-oidc">Test discovery URL</Button>
      {/if}
      {#if fieldsOf(sec.id).some((f) => !s.locked[f.key])}
        <Button variant="primary" disabled={!dirty(sec.id).length || invalid(sec.id) || busy !== null} loading={busy === sec.id} onclick={() => save(sec.id)} data-testid="save-{sec.id}">Save</Button>
      {/if}
    </div>
    {#if sec.id === 'transcription' && results.transcription && !results.transcription.busy}
      <p class="result" class:ok={results.transcription.ok} role="status" data-testid="test-result-transcription">{results.transcription.message}</p>
    {/if}
    {#if sec.id === 'signin' && results.oidc && !results.oidc.busy}
      <p class="result" class:ok={results.oidc.ok} role="status" data-testid="test-result-signin">{results.oidc.message}</p>
    {/if}
  </Section>
{/each}

<style>
  .cell { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .ctl { display: flex; align-items: center; gap: 8px; }
  input, select {
    height: var(--nb-control-lg); border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface);
    color: var(--nb-text); padding: 0 8px; font: inherit; font-size: var(--nb-text-md); width: 280px; max-width: 100%;
  }
  input.num { width: 110px; }
  input:disabled, select:disabled { opacity: 0.7; }
  input[aria-invalid='true'] { border-color: var(--nb-danger); }
  .unit { color: var(--nb-text-muted); font-size: var(--nb-text-sm); white-space: nowrap; }
  .mono { font-family: var(--nb-font-mono); font-size: var(--nb-text-sm); word-break: break-all; }
  .err { color: var(--nb-danger-text); font-size: var(--nb-text-sm); }
  .warn { margin: 0; padding: 10px 12px; border-radius: var(--nb-radius-md); background: var(--nb-warning-tint); color: var(--nb-warning-text); font-size: var(--nb-text-md); }
  .acts { display: flex; justify-content: flex-end; gap: 8px; }
  .result { margin: 0; font-size: var(--nb-text-md); color: var(--nb-danger-text); }
  .result.ok { color: var(--nb-success-text); }
  .link { all: unset; color: var(--nb-accent-text); cursor: pointer; font-size: var(--nb-text-sm); }
  .link:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; border-radius: 2px; }
  @media (max-width: 560px) { input, select { width: 100%; } .cell { align-items: stretch; } .ctl { flex-wrap: wrap; } }
</style>
