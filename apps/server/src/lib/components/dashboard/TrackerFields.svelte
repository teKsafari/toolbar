<script lang="ts">
  // J-140: the field form for a tracker destination: repository or project, labels, assignee and
  // milestone from the tracker API, with the last values and recents remembered per integration
  // (account settings editor.recentFields). Slack gets a message box. The editor's draft form
  // (J-137) and the capture page's send-to-app (J-138) both mount this.
  import type { Integration } from '@toolbar/shared/api';
  import DIcon from './DIcon.svelte';
  import { api, errMsg } from './api.ts';
  import type { Fields } from './fields.ts';

  type Options = {
    repos: { id: string; fullName: string }[];
    labels: { name: string; color: string | null }[];
    assignees: { login: string; name: string | null; avatarUrl: string | null }[];
    milestones: { id: string; title: string }[];
  };

  let { integration, fields = $bindable(), title = $bindable('') }: { integration: Integration; fields: Fields; title?: string } = $props();
  let options = $state<Options | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let repoQ = $state('');

  async function load(repo?: string) {
    if (integration.type === 'slack') return;
    loading = true;
    error = null;
    try {
      options = await api<Options>('integrations.options', { params: { id: integration.id }, query: { repo } });
    } catch (e) {
      error = errMsg(e);
    } finally {
      loading = false;
    }
  }

  // Remembered values first (J-140), then the integration's default target.
  $effect(() => {
    const id = integration.id;
    void (async () => {
      try {
        const s = await api<{ editor: { recentFields: Record<string, { repo?: string; labels?: string[]; assignees?: string[]; milestone?: string | null }> } }>('account.getSettings');
        const last = s.editor.recentFields[id];
        if (last) fields = { ...fields, repo: fields.repo ?? last.repo ?? undefined, labels: fields.labels.length ? fields.labels : (last.labels ?? []), assignees: fields.assignees.length ? fields.assignees : (last.assignees ?? []), milestone: fields.milestone ?? last.milestone ?? undefined };
      } catch {
        /* defaults only */
      }
      if (!fields.repo && integration.defaultTarget) fields = { ...fields, repo: integration.defaultTarget };
      await load(fields.repo);
    })();
  });

  const repos = $derived((options?.repos ?? []).filter((r) => !repoQ.trim() || r.fullName.toLowerCase().includes(repoQ.trim().toLowerCase())));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
</script>

<div class="tf" data-testid="tracker-fields">
  {#if integration.type === 'slack'}
    <label>Message <span class="muted">(optional)</span>
      <textarea rows="3" bind:value={fields.message} placeholder="Anything to add for the channel" data-testid="slack-message"></textarea>
    </label>
  {:else}
    <label>Title<input type="text" bind:value={title} maxlength="256" data-testid="issue-title" /></label>
    <label>{integration.type === 'github' ? 'Repository' : 'Project'}
      <span class="row">
        <input type="text" list="repos-{integration.id}" bind:value={repoQ} placeholder={fields.repo ?? 'Search'} aria-label="Find a repository" />
        <select value={fields.repo ?? ''} onchange={(e) => { fields = { ...fields, repo: (e.currentTarget as HTMLSelectElement).value || undefined, labels: [], assignees: [], milestone: undefined }; void load(fields.repo); }} data-testid="issue-repo">
          <option value="">Pick one</option>
          {#if fields.repo && !repos.some((r) => r.fullName === fields.repo)}<option value={fields.repo}>{fields.repo}</option>{/if}
          {#each repos as r (r.id)}<option value={r.fullName}>{r.fullName}</option>{/each}
        </select>
      </span>
    </label>
    {#if loading}<span class="muted"><DIcon name="spinner" size={12} /> Loading from {integration.type === 'github' ? 'GitHub' : 'GitLab'}</span>{/if}
    {#if error}<p class="err">{error}. You can still file with the repository typed above, or save the capture with a link only.</p>{/if}
    {#if options && fields.repo}
      {#if options.labels.length}
        <div class="lab">Labels</div>
        <div class="chips">
          {#each options.labels as l (l.name)}
            <button type="button" class:on={fields.labels.includes(l.name)} aria-pressed={fields.labels.includes(l.name)} onclick={() => (fields = { ...fields, labels: toggle(fields.labels, l.name) })} data-label={l.name}>
              {#if l.color}<span class="dot" style="background:{l.color}"></span>{/if}{l.name}
            </button>
          {/each}
        </div>
      {/if}
      {#if options.assignees.length}
        <label>Assignee
          <select value={fields.assignees[0] ?? ''} onchange={(e) => { const v = (e.currentTarget as HTMLSelectElement).value; fields = { ...fields, assignees: v ? [v] : [] }; }} data-testid="issue-assignee">
            <option value="">Nobody</option>
            {#each options.assignees as a (a.login)}<option value={a.login}>{a.name ? `${a.name} (${a.login})` : a.login}</option>{/each}
          </select>
        </label>
      {/if}
      {#if options.milestones.length}
        <label>Milestone
          <select value={fields.milestone ?? ''} onchange={(e) => (fields = { ...fields, milestone: (e.currentTarget as HTMLSelectElement).value || undefined })} data-testid="issue-milestone">
            <option value="">None</option>
            {#each options.milestones as m (m.id)}<option value={m.id}>{m.title}</option>{/each}
          </select>
        </label>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .tf { display: flex; flex-direction: column; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: var(--nb-text-md); }
  .row { display: flex; gap: 6px; }
  .row input { flex: 1; min-width: 0; height: 34px; }
  input[type='text'] { height: 34px; }
  select { height: 34px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); padding: 0 6px; font: inherit; font-size: var(--nb-text-md); max-width: 100%; }
  textarea { padding: 8px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); font: inherit; }
  .lab { font-size: var(--nb-text-md); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button { all: unset; display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: var(--nb-radius-pill); border: 1px solid var(--nb-border-strong); font-size: var(--nb-text-sm); cursor: pointer; }
  .chips button.on { border-color: var(--nb-accent); background: var(--nb-accent-tint); color: var(--nb-accent-text); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .err { color: var(--nb-danger); margin: 0; font-size: var(--nb-text-sm); }
</style>
