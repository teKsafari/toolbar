<script lang="ts">
  import { Button, Icon } from '@toolbar/ui';
  import { page } from '$app/state';
  const brandName = $derived(page.data.brand?.name ?? 'open-toolbar');

  let { data, form } = $props();
  const inv = $derived(data.invite);
  const seat = $derived(inv.role === 'viewer' ? 'viewer: you can watch captures and comment' : 'creator: you can capture, comment and organise');
  const wrongUser = $derived(!!(data.me && inv.email && inv.email.toLowerCase() !== data.me.email.toLowerCase()));
  let busy = $state(false);
</script>

<svelte:head><title>Join {inv.workspaceName} · {brandName}</title></svelte:head>

<main class="join">
  <span class="avatar" aria-hidden="true">{inv.workspaceName.slice(0, 1).toUpperCase()}</span>
  <h1>Join {inv.workspaceName}</h1>
  <p class="muted">
    {#if inv.inviterName}{inv.inviterName} invited you to this {brandName} workspace.{:else}You were invited to this {brandName} workspace.{/if}
    You join as a {seat}.
  </p>

  {#if inv.status === 'expired'}
    <p class="err" role="alert">This invitation has expired. Ask whoever sent it for a new one.</p>
  {:else if inv.status === 'canceled'}
    <p class="err" role="alert">This invitation was canceled.</p>
  {:else if data.already}
    <p>You are already a member.</p>
    <a class="go" href="/">Open {inv.workspaceName}</a>
  {:else if !data.me}
    <a class="go primary" href={data.loginUrl}>Sign in to join</a>
    {#if inv.email}<p class="hint">Use {inv.email}, the address the invitation went to.</p>{/if}
  {:else if wrongUser}
    <p class="err" role="alert">This invitation was sent to {inv.email}, and you are signed in as {data.me.email}.</p>
    <form method="POST" action="/logout"><Button type="submit">Sign out and switch account</Button></form>
  {:else}
    <form method="POST" onsubmit={() => (busy = true)}>
      <Button type="submit" variant="primary" size="lg" loading={busy}>Join {inv.workspaceName}</Button>
    </form>
    <p class="hint"><Icon name="user" size={14} /> Signed in as {data.me.email}</p>
  {/if}
  {#if form?.message}<p class="err" role="alert">{form.message}</p>{/if}
</main>

<style>
  .join { max-width: 420px; margin: 14vh auto 48px; padding: 0 16px; display: flex; flex-direction: column; align-items: flex-start; gap: var(--nb-space-3); }
  .avatar {
    display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: var(--nb-radius-lg);
    background: var(--nb-accent-tint); color: var(--nb-accent-text); font-size: 22px; font-weight: var(--nb-weight-semibold);
  }
  h1 { font-size: var(--nb-text-xl); margin: 0; }
  p { margin: 0; }
  .hint { display: inline-flex; align-items: center; gap: 6px; font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .err { color: var(--nb-danger); }
  .go {
    display: inline-flex; align-items: center; height: var(--nb-control-lg); padding: 0 var(--nb-space-4);
    border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); text-decoration: none; color: var(--nb-text);
  }
  .go.primary { background: var(--nb-accent); color: var(--nb-on-accent); border-color: transparent; }
</style>
