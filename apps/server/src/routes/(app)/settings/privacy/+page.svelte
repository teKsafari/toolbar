<script lang="ts">
  // Privacy and data: what is masked before anything leaves the page, sites where instant replay
  // never records (J-176, per person), how long the workspace keeps captures (J-178), and where
  // to delete data (J-191, J-225).
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import type { UserSettings } from '@toolbar/shared/api';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Field from '#lib/components/dashboard/Field.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  const admin = $derived(data.ws.role === 'admin');
  // svelte-ignore state_referenced_locally
  let blocked = $state<string[]>([...data.settings.extension.replayBlockedSites]);
  let site = $state('');

  async function saveBlocked(next: string[]) {
    const before = blocked;
    blocked = next;
    try {
      const r = await api<UserSettings>('account.updateSettings', { body: { extension: { replayBlockedSites: next } } });
      blocked = [...r.extension.replayBlockedSites];
    } catch (e) {
      blocked = before;
      toasts.error(errMsg(e));
    }
  }
  function add(e: Event) {
    e.preventDefault();
    let h = site.trim().toLowerCase();
    try {
      if (/^https?:\/\//.test(h)) h = new URL(h).hostname;
    } catch {
      /* keep as typed */
    }
    h = h.replace(/\/.*$/, '');
    if (!h || blocked.includes(h)) return;
    site = '';
    void saveBlocked([...blocked, h]);
  }

  async function retention(v: string) {
    try {
      await api('workspaces.update', { params: { workspaceId: data.ws.id }, body: { autoDeleteDays: v ? Number(v) : null } });
      await invalidateAll();
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }
</script>

<svelte:head><title>Privacy and data · Settings</title></svelte:head>

<h1>Privacy and data</h1>

<Section title="Masked by default" description="The extension removes these before a capture leaves your browser." testid="masking-section">
  <ul class="ticks">
    <li><DIcon name="check" size={14} />Password fields and fields marked as one-time codes or card numbers</li>
    <li><DIcon name="check" size={14} />Authorization, cookie and API-key headers, and any header named like a token, secret or key</li>
    <li><DIcon name="check" size={14} />Tokens, card numbers and email addresses found in request and response bodies</li>
    <li><DIcon name="check" size={14} />Text you blur in the editor is flattened into the image</li>
  </ul>
  <p class="muted small">Not captured: sites outside your workspace’s <a href="/settings/projects">projects</a>, other tabs, browser history, and anything on pages where you did not start a capture or turn on instant replay. Each project picks how much is masked.</p>
</Section>

<Section title="Instant replay never records on" description="Instant replay keeps the last minutes of a tab on your computer. It stays off on these sites." testid="blocked-section">
  <form class="add" onsubmit={add}>
    <input type="text" bind:value={site} placeholder="bank.example.com" aria-label="Site to block" data-testid="blocked-input" />
    <Button type="submit" icon="plus" disabled={!site.trim()} data-testid="blocked-add">Add</Button>
  </form>
  {#if blocked.length}
    <ul class="chips" data-testid="blocked-list">
      {#each blocked as b (b)}
        <li>{b}<button aria-label="Unblock {b}" onclick={() => saveBlocked(blocked.filter((x) => x !== b))}><DIcon name="close" size={11} /></button></li>
      {/each}
    </ul>
  {:else}
    <p class="muted small">No sites blocked.</p>
  {/if}
</Section>

<Section title={data.features.adminExtras ? 'Retention' : 'Deleting captures'} description={data.features.adminExtras ? 'How long this workspace keeps captures.' : 'What happens when a capture or an account is deleted.'} testid="retention-section">
  {#if data.features.adminExtras}
  <Field label="Delete captures automatically" hint={admin ? 'Older captures are deleted with their media, every hour.' : 'Set by a workspace admin.'}>
    <select disabled={!admin} value={data.ws.settings.autoDeleteDays === null ? '' : String(data.ws.settings.autoDeleteDays)} onchange={(e) => retention((e.currentTarget as HTMLSelectElement).value)} data-testid="retention-select">
      <option value="">Never</option>
      <option value="30">After 30 days</option>
      <option value="60">After 60 days</option>
      <option value="90">After 90 days</option>
      <option value="180">After 180 days</option>
      <option value="365">After a year</option>
    </select>
  </Field>
  {/if}
  <p class="muted small">Deleting a capture removes it from lists, search and its links at once; its media is erased from storage within minutes. To erase everything of yours, <a href="/settings/profile">delete your account</a>.</p>
</Section>

<style>
  h1 { margin-bottom: 18px; }
  .ticks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .ticks li { display: flex; gap: 10px; align-items: flex-start; }
  .ticks :global(svg) { color: var(--nb-success); margin-top: 3px; }
  .small { font-size: var(--nb-text-sm); margin: 0; }
  .add { display: flex; gap: 8px; max-width: 420px; }
  .add input { height: 34px; }
  .chips { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; flex-wrap: wrap; }
  .chips li { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 10px; border-radius: var(--nb-radius-pill); border: 1px solid var(--nb-border); background: var(--nb-surface); font: var(--nb-text-sm) var(--nb-font-mono); }
  .chips button { all: unset; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; }
  .chips button:hover { background: var(--nb-surface-sunken); }
  select { height: 34px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); padding: 0 8px; font: inherit; font-size: var(--nb-text-md); }
  /* keyboard focus for the controls above that `all: unset` strips of the browser ring (D-178) */
  .chips button:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 1px; }
</style>
