<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button, Icon } from '@toolbar/ui';
  import { page } from '$app/state';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');
  import { ago } from '#lib/components/auth/time.ts';

  let { data, form } = $props();
</script>

<svelte:head><title>Connected browsers · Settings</title></svelte:head>
<h1>Connected browsers</h1>
<p class="muted">Browsers where the {brandName} extension is signed in to your account. Disconnect one to sign it out at once.</p>

{#if data.devices.length}
  <ul class="list" data-testid="device-list">
    {#each data.devices as d (d.id)}
      <li>
        <span class="icon"><Icon name="monitor" size={18} /></span>
        <span class="col">
          <span class="name">{d.name}</span>
          <span class="meta">Connected {ago(d.createdAt)} · {d.lastUsedAt ? `last used ${ago(d.lastUsedAt)}` : 'not used yet'}</span>
        </span>
        <form method="POST" action="?/revoke" use:enhance>
          <input type="hidden" name="id" value={d.id} />
          <Button type="submit" size="sm">Disconnect</Button>
        </form>
      </li>
    {/each}
  </ul>
{:else}
  <div class="empty-box">
    <Icon name="monitor" size={22} />
    <p>No browser is connected yet. Open the extension and choose sign in.</p>
  </div>
{/if}
{#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}

<style>
  .list { list-style: none; margin: 16px 0 0; padding: 0; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg); background: var(--nb-surface); }
  li { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
  li + li { border-top: 1px solid var(--nb-border); }
  .icon { color: var(--nb-text-muted); display: inline-flex; }
  .col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .name { font-weight: var(--nb-weight-medium); }
  .meta { font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .empty-box { margin-top: 16px; display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px dashed var(--nb-border-strong); border-radius: var(--nb-radius-lg); background: var(--nb-surface-2); color: var(--nb-text-muted); }
  .empty-box p { margin: 0; }
  .err { color: var(--nb-danger); }
</style>
