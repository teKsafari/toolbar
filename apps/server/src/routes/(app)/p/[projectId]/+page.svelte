<script lang="ts">
  // A project (D-200): the origins and domains it covers and its captures. Admins add an exact
  // origin or a wildcard domain, remove one, and merge another project into this one.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import { PRESET_LABELS, PRESET_SUMMARY, normalizeOrigin } from '@toolbar/shared/projects';
  import CaptureGrid from '#lib/components/dashboard/CaptureGrid.svelte';
  import FilterBar from '#lib/components/dashboard/FilterBar.svelte';
  import MergeProjects from '#lib/components/dashboard/MergeProjects.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import ReviewLinks from '#lib/components/dashboard/ReviewLinks.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  const p = $derived(data.project);
  const canEdit = $derived(data.seat !== 'viewer');
  let adding = $state('');
  let busy = $state(false);
  let merging = $state(false);
  const addOk = $derived(!!normalizeOrigin(adding));

  async function setOrigins(origins: string[], done: string) {
    busy = true;
    try {
      await api('projects.update', { params: { id: p.id }, body: { origins } });
      toasts.success(done);
      await invalidateAll();
      return true;
    } catch (x) {
      toasts.error(errMsg(x));
      return false;
    } finally {
      busy = false;
    }
  }

  async function add(e: Event) {
    e.preventDefault();
    const o = normalizeOrigin(adding);
    if (!o || busy) return;
    if (p.origins.includes(o)) {
      adding = '';
      return;
    }
    if (await setOrigins([...p.origins, o], `Added ${o}`)) adding = '';
  }
</script>

<svelte:head><title>{p.name}</title></svelte:head>

{#key p.id}
  <CaptureGrid folderId="all" projectId={p.id} workspaceId={p.workspaceId} folders={data.dash.folders} {canEdit}>
    {#snippet header({ total, loading })}
      <div class="titlerow">
        <h1 data-testid="project-title"><DIcon name="globe" size={20} />{p.name}</h1>
        {#if !loading && total !== null}<span class="count" data-testid="project-total">{total}</span>{/if}
        <span class="grow"></span>
        <span class="preset" title={PRESET_SUMMARY[p.maskingPreset]}>{PRESET_LABELS[p.maskingPreset]}</span>
        {#if data.admin}
          <Button size="sm" onclick={() => (merging = true)} disabled={!data.others.length} data-testid="project-merge">Merge a project into this one</Button>
        {/if}
      </div>
      <ul class="chips" data-testid="project-page-origins">
        {#each p.origins as o (o)}
          <li>
            <code>{o}</code>
            {#if data.admin && p.origins.length > 1}
              <button
                class="x"
                aria-label={`Remove ${o}`}
                title={`Remove ${o}`}
                disabled={busy}
                onclick={() => setOrigins(p.origins.filter((x) => x !== o), `Removed ${o}`)}
                data-testid="origin-remove"><DIcon name="close" size={12} /></button
              >
            {/if}
          </li>
        {/each}
        {#if data.admin}
          <li class="addli">
            <form onsubmit={add}>
              <input bind:value={adding} placeholder="https://staging.example.com or *.example.com" aria-label="Add an origin or domain" maxlength="300" data-testid="origin-add-input" />
              <Button size="sm" type="submit" disabled={!addOk} loading={busy} data-testid="origin-add">Add</Button>
            </form>
          </li>
        {/if}
      </ul>
      {#if data.reviewLinks?.length}<div class="reviewlinks"><ReviewLinks links={data.reviewLinks} /></div>{/if}
      {#if data.admin}<p class="hint"><code>*.example.com</code> covers example.com and every subdomain, over https; add <code>http://*.example.com</code> for http. An exact origin wins over a domain when both match.</p>{/if}
      {#if total !== 0 || loading}<FilterBar members={data.dash.members} />{/if}
    {/snippet}
    {#snippet empty()}
      <div class="empty" data-testid="project-empty">
        <DIcon name="globe" size={32} />
        <h2>No captures yet</h2>
        <p>Captures made on {p.origins.join(', ')} show up here.</p>
      </div>
    {/snippet}
  </CaptureGrid>
{/key}

<MergeProjects bind:open={merging} into={p} others={data.others} />

<style>
  .titlerow { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  h1 { margin: 0; display: inline-flex; align-items: center; gap: 10px; min-width: 0; overflow-wrap: anywhere; }
  .count { color: var(--nb-text-faint); font: var(--nb-text-sm) var(--nb-font-mono); font-variant-numeric: tabular-nums; }
  .grow { flex: 1; }
  .preset { font-size: var(--nb-text-xs); font-weight: var(--nb-weight-medium); padding: 2px 8px; border-radius: var(--nb-radius-pill); background: var(--nb-info-tint); color: var(--nb-info-text); white-space: nowrap; }
  .chips { list-style: none; margin: 0 0 8px; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .chips li { display: inline-flex; align-items: center; gap: 4px; min-height: 26px; padding: 0 4px 0 8px; border-radius: var(--nb-radius-sm); border: 1px solid var(--nb-border); background: var(--nb-surface-2); max-width: 100%; }
  .chips li.addli { border: 0; background: none; padding: 0; flex: 1 1 260px; }
  .chips code { font-size: var(--nb-text-sm); overflow-wrap: anywhere; padding-right: 4px; }
  .x { all: unset; display: grid; place-items: center; width: 20px; height: 20px; border-radius: var(--nb-radius-sm); color: var(--nb-text-muted); cursor: pointer; }
  .x:hover { background: var(--nb-surface-sunken); color: var(--nb-text); }
  .x:focus-visible { outline: 2px solid var(--nb-focus); }
  form { display: flex; gap: 6px; width: 100%; }
  form input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; font: var(--nb-text-sm) var(--nb-font-mono, monospace); }
  .reviewlinks { margin: 4px 0 12px; }
  .hint { margin: 0 0 16px; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .empty h2 { margin: 6px 0 0; color: var(--nb-text); }
  .empty p { margin: 0 0 8px; overflow-wrap: anywhere; }
</style>
