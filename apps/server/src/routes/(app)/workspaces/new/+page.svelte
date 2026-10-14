<script lang="ts">
  import { Button } from '@toolbar/ui';
  import Avatar from '#lib/components/auth/Avatar.svelte';

  let { data, form } = $props();
  let name = $state('');
  let busy = $state(false);
  $effect.pre(() => {
    if (form?.name) name = form.name;
  });
</script>

<svelte:head><title>New workspace</title></svelte:head>

<div class="wrap">
  {#if data.invites.length}
    <section class="invites">
      <h2>Invitations for you</h2>
      <ul>
        {#each data.invites as i (i.id)}
          <li><Avatar name={i.workspace} size={24} /><span class="grow">{i.workspace}</span><a class="join" href="/invite/{i.id}">Join</a></li>
        {/each}
      </ul>
    </section>
  {/if}

  <form method="POST" onsubmit={() => (busy = true)}>
    <h1>Create a workspace</h1>
    <p class="muted">A workspace holds your team's captures, folders and integrations. You can invite people next.</p>
    <div class="avatar"><Avatar name={name || '?'} size={56} /></div>
    <label for="ws-name">Workspace name</label>
    <input id="ws-name" type="text" name="name" maxlength="100" placeholder="Acme web team" bind:value={name} autocomplete="off" />
    <label class="check">
      <input type="checkbox" name="domainJoin" checked />
      <span>
        {#if data.domain}Let anyone with an <b>@{data.domain}</b> email join this workspace{:else}Let people with your email domain join this workspace{/if}
        <span class="hint">{data.domain ? 'They join as viewers, and admins get an email.' : 'Not available for webmail addresses such as Gmail.'}</span>
      </span>
    </label>
    {#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}
    <div class="actions"><Button type="submit" variant="primary" size="lg" disabled={!name.trim()} loading={busy}>Next</Button></div>
  </form>
</div>

<style>
  .wrap { max-width: 440px; margin: 32px auto; display: flex; flex-direction: column; gap: var(--nb-space-6); }
  form { display: flex; flex-direction: column; gap: var(--nb-space-2); }
  h1 { margin: 0; font-size: var(--nb-text-xl); }
  h2 { font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  p { margin: 0; }
  .avatar { margin: var(--nb-space-3) 0; }
  label { font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  .check { display: flex; align-items: flex-start; gap: 10px; margin-top: var(--nb-space-2); color: var(--nb-text); cursor: pointer; }
  .check input { margin-top: 3px; accent-color: var(--nb-accent); }
  .hint { display: block; font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .actions { display: flex; justify-content: flex-end; margin-top: var(--nb-space-3); }
  .err { color: var(--nb-danger); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--nb-border); border-radius: var(--nb-radius-md); }
  .grow { flex: 1; }
  .join { font-weight: var(--nb-weight-medium); }
</style>
