<script lang="ts">
  // Projects (D-123 to D-127): the origins the extension may run on and the masking preset it
  // applies there. Admins add, edit and remove; members read. The extension picks the list up
  // after sign-in and asks the reviewer for access to these origins only.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import type { Project } from '@toolbar/shared/api';
  import { PRESET_LABELS, PRESET_SUMMARY, PROJECT_PRESETS, TRACE_OPEN_MS, normalizeOrigin, type ProjectPreset } from '@toolbar/shared/projects';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Modal from '#lib/components/dashboard/Modal.svelte';
  import Confirm from '#lib/components/dashboard/Confirm.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();

  let open = $state(false);
  let editing = $state<Project | null>(null);
  let name = $state('');
  let originsText = $state('');
  let preset = $state<ProjectPreset>('staging');
  let allowText = $state('');
  /** span window for open requests, in seconds (D-166) */
  let openSec = $state(TRACE_OPEN_MS.default / 1000);
  let busy = $state(false);
  let removing = $state<Project | null>(null);

  const lines = (s: string) => s.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
  const badOrigins = $derived(lines(originsText).filter((o) => !normalizeOrigin(o)));
  const openOk = $derived(Number.isInteger(openSec) && openSec * 1000 >= TRACE_OPEN_MS.min && openSec * 1000 <= TRACE_OPEN_MS.max);
  const valid = $derived(!!name.trim() && lines(originsText).length > 0 && badOrigins.length === 0 && openOk);

  function startAdd() {
    editing = null;
    name = '';
    originsText = '';
    preset = data.defaults.maskingPreset;
    allowText = '';
    openSec = Math.round(data.defaults.traceOpenMs / 1000);
    open = true;
  }
  function startEdit(p: Project) {
    editing = p;
    name = p.name;
    originsText = p.origins.join('\n');
    preset = p.maskingPreset;
    allowText = p.bodyAllowlist.join('\n');
    openSec = Math.round(p.traceOpenMs / 1000);
    open = true;
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!valid || busy) return;
    busy = true;
    const body = { name: name.trim(), origins: lines(originsText), maskingPreset: preset, bodyAllowlist: preset === 'production' ? lines(allowText) : [], traceOpenMs: openSec * 1000 };
    try {
      if (editing) await api('projects.update', { params: { id: editing.id }, body });
      else await api('projects.create', { params: { workspaceId: data.workspaceId }, body });
      toasts.success(editing ? 'Project saved' : 'Project added');
      open = false;
      await invalidateAll();
    } catch (x) {
      toasts.error(errMsg(x));
    } finally {
      busy = false;
    }
  }

  async function del(p: Project) {
    await api('projects.delete', { params: { id: p.id } });
    toasts.success('Project removed');
    await invalidateAll();
  }
</script>

<svelte:head><title>Projects · Settings</title></svelte:head>

<div class="head">
  <h1>Projects</h1>
  {#if data.admin}<Button variant="primary" icon="plus" onclick={startAdd} data-testid="add-project">Add project</Button>{/if}
</div>
<p class="muted lead">
  A project is a web app your team reviews. The extension asks each reviewer for access to the project’s origins after sign-in, and records nothing on any other site. Captures from other origins are refused.
</p>

<Section title="Projects in this workspace" testid="projects-section">
  {#if !data.projects.length}
    <p class="muted" data-testid="projects-empty">No projects yet. {data.admin ? 'Add one with the origins of the app you want feedback on.' : 'Ask a workspace admin to add the app you review.'}</p>
  {/if}
  {#each data.projects as p (p.id)}
    <div class="proj" data-testid="project-row" data-id={p.id}>
      <div class="pr">
        <strong class="name">{p.name}</strong>
        <span class="preset {p.maskingPreset}" data-testid="project-preset" title={PRESET_SUMMARY[p.maskingPreset]}>{PRESET_LABELS[p.maskingPreset]}</span>
      </div>
      <ul class="chips" data-testid="project-origins">
        {#each p.origins as o (o)}<li><code>{o}</code></li>{/each}
      </ul>
      {#if p.maskingPreset === 'production'}
        <p class="small muted">
          {p.bodyAllowlist.length ? `Bodies kept for ${p.bodyAllowlist.length} allowlisted ${p.bodyAllowlist.length === 1 ? 'URL' : 'URLs'}` : 'No request or response bodies are kept'}
        </p>
      {/if}
      {#if p.traceOpenMs !== TRACE_OPEN_MS.default}
        <p class="small muted" data-testid="project-trace-open">Trace steps wait up to {p.traceOpenMs / 1000} s for open requests</p>
      {/if}
      {#if data.admin}
        <div class="acts">
          <Button size="sm" icon="pen" onclick={() => startEdit(p)} data-testid="project-edit">Edit</Button>
          <Button size="sm" variant="ghost" icon="trash" onclick={() => (removing = p)} data-testid="project-delete">Remove</Button>
        </div>
      {/if}
    </div>
  {/each}
</Section>

<Section title="Masking presets" description="Applied in the reviewer’s browser before anything is uploaded. Secrets are removed under both.">
  <dl class="presets">
    {#each PROJECT_PRESETS as k (k)}
      <dt>{PRESET_LABELS[k]}</dt>
      <dd>{PRESET_SUMMARY[k]}</dd>
    {/each}
    <dt>Always</dt>
    <dd>Authorization, Cookie, Set-Cookie and X-Api-Key headers, and any header named like a token, secret or key; password and token fields; JWTs, email addresses and card numbers in bodies and logs.</dd>
  </dl>
</Section>

<Modal bind:open title={editing ? 'Edit project' : 'Add project'} width={520} testid="project-dialog">
  <form id="project-form" class="f" onsubmit={save}>
    <label>Name<input type="text" bind:value={name} maxlength="80" placeholder="Nuru staging" data-testid="project-name" /></label>
    <label>
      Origins, one per line
      <textarea rows="3" bind:value={originsText} placeholder={'https://staging.example.com\nhttps://*.preview.example.com'} data-testid="project-origins-input"></textarea>
      {#if badOrigins.length}<span class="err" data-testid="project-origin-error">Not a web origin: {badOrigins.join(', ')}</span>{:else}<span class="hint">Scheme and host, and a port when it is not 80 or 443. <code>*.</code> covers subdomains.</span>{/if}
    </label>
    <fieldset>
      <legend>Masking preset</legend>
      {#each PROJECT_PRESETS as k (k)}
        <label class="radio" data-testid="preset-{k}">
          <input type="radio" name="preset" value={k} checked={preset === k} onchange={() => (preset = k)} />
          <span><strong>{PRESET_LABELS[k]}</strong><span class="hint">{PRESET_SUMMARY[k]}</span></span>
        </label>
      {/each}
    </fieldset>
    {#if preset === 'production'}
      <label>
        URLs whose bodies are kept, one per line
        <textarea rows="2" bind:value={allowText} placeholder="https://api.example.com/v1/public/*" data-testid="project-allowlist"></textarea>
        <span class="hint">Prefixes; <code>*</code> matches anything. Leave empty to keep no bodies.</span>
      </label>
    {/if}
    <label>
      Trace step window, in seconds
      <input type="number" bind:value={openSec} min={TRACE_OPEN_MS.min / 1000} max={TRACE_OPEN_MS.max / 1000} step="1" data-testid="project-trace-open-input" />
      {#if !openOk}<span class="err">Use a whole number from {TRACE_OPEN_MS.min / 1000} to {TRACE_OPEN_MS.max / 1000}.</span>{:else}<span class="hint">How long a trace step stays open while its requests are still running. Raise it when actions such as code runs take longer than {TRACE_OPEN_MS.default / 1000} s.</span>{/if}
    </label>
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="project-form" disabled={!valid} loading={busy} data-testid="project-save">{editing ? 'Save' : 'Add project'}</Button>
  {/snippet}
</Modal>

<Confirm
  open={!!removing}
  title="Remove this project?"
  message="Its captures stay. Reviewers’ extensions stop running on its origins at their next sync."
  confirmLabel="Remove"
  onconfirm={async () => {
    if (removing) await del(removing).catch((e) => toasts.error(errMsg(e)));
    removing = null;
  }}
/>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .head h1 { margin: 0; }
  .lead { margin: 0 0 16px; font-size: var(--nb-text-md); }
  .muted { color: var(--nb-text-muted); }
  .small { font-size: var(--nb-text-sm); margin: 0; }
  .proj { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  .pr { display: flex; align-items: center; gap: 10px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--nb-weight-medium); letter-spacing: var(--nb-tracking-ui); }
  .preset { font-size: var(--nb-text-xs); font-weight: var(--nb-weight-medium); padding: 2px 8px; border-radius: var(--nb-radius-pill); background: var(--nb-info-tint); color: var(--nb-info-text); white-space: nowrap; }
  .preset.production { background: var(--nb-warning-tint, var(--nb-surface-sunken)); color: var(--nb-warning-text); }
  .chips { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
  .chips li { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border); background: var(--nb-surface-2); }
  .chips code { font-size: var(--nb-text-sm); overflow-wrap: anywhere; }
  .acts { display: flex; gap: 6px; flex-wrap: wrap; }
  .presets { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: var(--nb-text-md); }
  .presets dt { font-weight: var(--nb-weight-semibold); }
  .presets dd { margin: 0; color: var(--nb-text-muted); }
  @media (max-width: 560px) { .presets { grid-template-columns: 1fr; } .presets dd { margin-bottom: 6px; } }
  .f { display: flex; flex-direction: column; gap: 12px; }
  .f > label { display: flex; flex-direction: column; gap: 6px; font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); }
  textarea { font: var(--nb-text-md) / 1.4 var(--nb-font-mono, monospace); resize: vertical; }
  .hint { font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .err { font-size: var(--nb-text-sm); color: var(--nb-danger); }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  legend { font-size: var(--nb-text-md); margin-bottom: 4px; }
  .radio { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); cursor: pointer; transition: border-color var(--nb-dur-fast) var(--nb-ease-out), background-color var(--nb-dur-fast) var(--nb-ease-out); }
  .radio input { accent-color: var(--nb-accent); }
  .radio:has(input:checked) { border-color: var(--nb-accent); background: var(--nb-accent-tint); }
  .radio > span { display: flex; flex-direction: column; gap: 2px; }
  .radio input { margin-top: 3px; }
</style>
