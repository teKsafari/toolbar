<script lang="ts">
  // Popup sign-in state (X-05) for the ext-ui popup to mount: signed out shows a sign-in button
  // that runs the launchWebAuthFlow sign-in; signed in shows the account and a sign-out item.
  // Talks to the service worker only (auth.state, auth.signIn, auth.signOut).
  import { browser } from 'wxt/browser';
  import { Button, Icon } from '@toolbar/ui';
  import { PRODUCT_NAME } from '@toolbar/shared/constants';
  import type { BgResult } from '@toolbar/shared/ext';

  let { onchange }: { onchange?: (signedIn: boolean) => void } = $props();
  type State = Extract<BgResult<'auth.state'>, { ok: true }>;
  let auth = $state<State | null>(null);
  let busy = $state(false);
  let error = $state('');

  async function refresh() {
    const r = (await browser.runtime.sendMessage({ type: 'auth.state' })) as BgResult<'auth.state'>;
    if (r.ok) auth = r;
  }
  async function signIn() {
    busy = true;
    error = '';
    const r = (await browser.runtime.sendMessage({ type: 'auth.signIn' })) as BgResult<'auth.signIn'>;
    busy = false;
    if (!r.ok) error = r.error === 'permission_denied' ? 'Sign-in was closed before it finished.' : (r.message ?? 'Sign-in failed.');
    await refresh();
    onchange?.(!!auth?.signedIn);
  }
  async function signOut() {
    await browser.runtime.sendMessage({ type: 'auth.signOut' });
    await refresh();
    onchange?.(false);
  }
  $effect(() => {
    void refresh();
  });
</script>

{#if auth && !auth.signedIn}
  <section class="card" data-testid="signed-out">
    <p class="lead">Sign in to save captures to your {PRODUCT_NAME} workspace.</p>
    <Button variant="primary" size="lg" class="wide" loading={busy} onclick={signIn}>Sign in</Button>
    <p class="server" title={auth.serverUrl}>{new URL(auth.serverUrl).host}</p>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
  </section>
{:else if auth?.user}
  <section class="who" data-testid="signed-in">
    <Icon name="user" size={14} />
    <span class="email" title={auth.user.email ?? ''}>{auth.user.email}</span>
    <Button variant="ghost" size="sm" onclick={signOut}>Sign out</Button>
  </section>
{/if}

<style>
  .card { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; }
  .lead { margin: 0; color: var(--nb-text-muted); }
  :global(.wide) { width: 100%; }
  .server { margin: 0; font-size: 11px; color: var(--nb-text-faint); text-align: center; }
  .err { margin: 0; color: var(--nb-danger); font-size: 12px; }
  .who { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--nb-text-muted); }
  .email { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
