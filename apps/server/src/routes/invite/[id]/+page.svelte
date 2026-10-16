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
  .join {
    box-sizing: border-box; width: min(420px, calc(100% - 32px)); margin: 12vh auto 48px; padding: 24px;
    display: flex; flex-direction: column; align-items: flex-start; gap: var(--nb-space-3);
    background: var(--nb-surface); border: 1px solid var(--nb-border); border-radius: var(--nb-radius-lg);
  }
  .avatar {
    display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: var(--nb-radius-md);
    border: 1px solid var(--nb-border); background: var(--nb-surface-2); color: var(--nb-text);
    font: var(--nb-weight-medium) 20px / 1 var(--nb-font-display);
  }
  h1 { font-size: var(--nb-text-2xl); margin: 0; }
  p { margin: 0; color: var(--nb-text-body); line-height: var(--nb-leading-relaxed); }
  .hint { display: inline-flex; align-items: center; gap: 6px; font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .err { color: var(--nb-danger); }
  .go {
    display: inline-flex; align-items: center; height: var(--nb-control-lg); padding: 0 var(--nb-space-4);
    border-radius: var(--nb-radius-md); border: 1px solid var(--nb-border-strong); background: var(--nb-surface); text-decoration: none; color: var(--nb-text);
    font-weight: var(--nb-weight-medium); letter-spacing: var(--nb-tracking-ui); box-shadow: var(--nb-shadow-sm);
    transition: background-color var(--nb-dur-fast) var(--nb-ease-out), border-color var(--nb-dur-fast) var(--nb-ease-out);
  }
  .go:hover { border-color: color-mix(in srgb, var(--nb-text-faint) 60%, var(--nb-border-strong)); }
  .go:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .go.primary { background: var(--nb-accent); color: var(--nb-on-accent); border-color: transparent; box-shadow: var(--nb-shadow-primary); }
  .go.primary:hover { background: var(--nb-accent-hover); }
</style>
