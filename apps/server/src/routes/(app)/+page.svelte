<script lang="ts">
  // All captures (J-158): unfiled captures of the workspace, newest first. "Created by me" is the
  // same page with the creator filter set to the caller.
  import { page } from '$app/state';
  import { COMMANDS } from '@toolbar/shared';
  import { Icon } from '@toolbar/ui';
  import CaptureGrid from '#lib/components/dashboard/CaptureGrid.svelte';
  import FilterBar from '#lib/components/dashboard/FilterBar.svelte';
  import NewCapture from '#lib/components/dashboard/NewCapture.svelte';

  let { data } = $props();
  const by = $derived(page.url.searchParams.get('by'));
  const mine = $derived(by === data.user.id);
  const linkId = $derived(page.url.searchParams.get('link'));
  const title = $derived(mine ? 'Created by me' : 'All captures');
  const canEdit = $derived(!!data.activeWorkspace && data.activeWorkspace.role !== 'viewer');
</script>

<svelte:head><title>{title}</title></svelte:head>

<CaptureGrid folderId="none" workspaceId={data.activeWorkspaceId} folders={data.dash.folders} {canEdit}>
  {#snippet header({ total, loading })}
    <div class="titlerow">
      <h1>{title}</h1>
      {#if !loading && total !== null}<span class="count" data-testid="grid-total">{total}</span>{/if}
    </div>
    <FilterBar members={data.dash.members} linkName={linkId ? 'recording link' : null} />
  {/snippet}
  {#snippet empty()}
    <div class="empty" data-testid="grid-empty">
      <Icon name="screenshot" size={32} />
      <h2>No captures yet</h2>
      <p>Take a screenshot with <kbd>{COMMANDS['screenshot-mode'].key}</kbd> or record a tab with the extension, or drop a video file here.</p>
      {#if canEdit}<NewCapture label="Make a capture" />{/if}
    </div>
  {/snippet}
</CaptureGrid>

<style>
  .titlerow { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px; }
  .titlerow h1 { margin: 0; }
  .count { color: var(--nb-text-faint); font: var(--nb-text-sm) var(--nb-font-mono); font-variant-numeric: tabular-nums; }
  .empty h2 { margin: 6px 0 0; color: var(--nb-text); }
  .empty p { margin: 0 0 8px; max-width: 420px; }
  kbd { font: var(--nb-text-sm) var(--nb-font-mono); padding: 0 4px; border: 1px solid var(--nb-border); border-radius: 4px; background: var(--nb-surface-2); }
</style>
