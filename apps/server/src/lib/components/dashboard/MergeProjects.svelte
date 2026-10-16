<script lang="ts">
  // Merge projects (D-200): pick another project of the workspace; its origins and captures move
  // into `into` and it is removed. Used on the project page and in Settings > Projects.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import Modal from './Modal.svelte';
  import { api, errMsg } from './api.ts';

  interface P {
    id: string;
    name: string;
    origins: string[];
  }
  let { open = $bindable(false), into, others }: { open?: boolean; into: P | null; others: P[] } = $props();

  let from = $state('');
  let busy = $state(false);
  const picked = $derived(others.find((o) => o.id === from) ?? null);

  $effect(() => {
    if (open) from = '';
  });

  async function merge(e: Event) {
    e.preventDefault();
    if (!into || !picked || busy) return;
    busy = true;
    try {
      const r = await api<{ movedCaptures: number }>('projects.merge', { params: { id: into.id }, body: { from: picked.id } });
      toasts.success(`Merged ${picked.name} into ${into.name}${r.movedCaptures ? `, ${r.movedCaptures} ${r.movedCaptures === 1 ? 'capture' : 'captures'} moved` : ''}`);
      open = false;
      await invalidateAll();
    } catch (x) {
      toasts.error(errMsg(x));
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={into ? `Merge into ${into.name}` : 'Merge projects'} width={480} testid="merge-dialog">
  <form id="merge-form" class="f" onsubmit={merge}>
    {#if others.length}
      <label>
        Project to merge
        <select bind:value={from} data-testid="merge-from">
          <option value="" disabled>Pick a project</option>
          {#each others as o (o.id)}<option value={o.id}>{o.name} ({o.origins.join(', ')})</option>{/each}
        </select>
      </label>
      {#if picked && into}
        <p class="hint" data-testid="merge-summary">
          {into.name} gets {picked.origins.filter((o) => !into.origins.includes(o)).join(', ') || 'no new origins'} and every capture of {picked.name}. {picked.name} is removed; {into.name} keeps its own masking preset and trace step window.
        </p>
      {/if}
    {:else}
      <p class="hint">There is no other project in this workspace.</p>
    {/if}
  </form>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="primary" type="submit" form="merge-form" disabled={!picked} loading={busy} data-testid="merge-confirm">Merge</Button>
  {/snippet}
</Modal>

<style>
  .f { display: flex; flex-direction: column; gap: 12px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); }
  .hint { margin: 0; font-size: var(--nb-text-sm); color: var(--nb-text-muted); overflow-wrap: anywhere; }
</style>
