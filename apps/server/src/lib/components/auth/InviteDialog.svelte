<script lang="ts">
  // Invite modal (J-123, J-234): the workspace invite link with a copy button (joins as
  // creator), then an email field with a creator or viewer choice. Invite stays disabled until
  // the address is valid. Pending invitations are listed with a cancel button.
  import { Button, Icon, toasts } from '@toolbar/ui';
  import type { Workspace } from '@toolbar/shared/api';
  import { page } from '$app/state';
  import { call, ROUTES } from './api.ts';

  let { workspace, open = $bindable(false) }: { workspace: Workspace; open?: boolean } = $props();

  type Link = { enabled: boolean; url: string | null; expiresAt: string | null };
  type Invite = { id: string; email: string; role: 'creator' | 'viewer'; status: string };
  let dialog: HTMLDialogElement | undefined = $state();
  let link = $state<Link | null>(null);
  let pending = $state<Invite[]>([]);
  let email = $state('');
  let role = $state<'creator' | 'viewer'>('creator');
  let busy = $state(false);
  let copied = $state(false);
  const valid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const canAdmin = $derived(workspace.role === 'admin');
  const canInvite = $derived(workspace.role !== 'viewer');
  // With mail paused (FEATURE_EMAIL off, docs/scope.md) an invite reaches no one by itself: the
  // dialog makes the person's own invite link and copies it, for you to send (J-123).
  const mailOn = $derived(!!(page.data as { features?: { email?: boolean } }).features?.email);
  const inviteUrl = (id: string) => `${location.origin}/invite/${id}`;
  async function copyInvite(p: Invite) {
    await navigator.clipboard.writeText(inviteUrl(p.id)).catch(() => {});
    toasts.success(`Invite link for ${p.email} copied`);
  }

  async function load() {
    if (!canInvite) return;
    const [l, p] = await Promise.all([
      call<Link>(ROUTES['invites.getLink'], { workspaceId: workspace.id }).catch(() => null),
      call<{ items: Invite[] }>(ROUTES['invites.list'], { workspaceId: workspace.id }).catch(() => ({ items: [] })),
    ]);
    link = l;
    pending = p.items;
  }

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void load();
    } else if (!open && dialog.open) dialog.close();
  });

  async function copy() {
    if (!link?.url) return;
    await navigator.clipboard.writeText(link.url).catch(() => {});
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function invite(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    busy = true;
    try {
      const r = await call<{ items: Invite[] }>(ROUTES['invites.create'], { workspaceId: workspace.id }, { emails: [email.trim()], role });
      const made = r.items.find((x) => x.email.toLowerCase() === email.trim().toLowerCase()) ?? r.items[0];
      if (mailOn) toasts.success(`Invitation sent to ${email.trim()}`);
      else if (made) await copyInvite(made);
      pending = [...r.items, ...pending.filter((p) => !r.items.some((x) => x.id === p.id))];
      email = '';
    } catch (err) {
      toasts.error((err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function cancel(inv: Invite) {
    try {
      await call(ROUTES['invites.cancel'], { id: inv.id });
      pending = pending.filter((p) => p.id !== inv.id);
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }

  async function reset() {
    try {
      link = await call<Link>(ROUTES['invites.resetLink'], { workspaceId: workspace.id });
      toasts.success('New invite link made. The old one no longer works.');
    } catch (err) {
      toasts.error((err as Error).message);
    }
  }
</script>

<dialog bind:this={dialog} onclose={() => (open = false)} aria-labelledby="invite-title" data-testid="invite-dialog">
  <header>
    <h2 id="invite-title">Invite people to {workspace.name}</h2>
    <Button variant="ghost" size="sm" icon="close" iconOnly aria-label="Close" onclick={() => (open = false)} />
  </header>

  {#if !canInvite}
    <p class="muted">Viewers cannot invite. Ask an admin of {workspace.name}.</p>
  {:else}
    <section>
      <div class="row-label">Invite link</div>
      {#if link?.enabled && link.url}
        <div class="linkrow">
          <input type="text" readonly value={link.url} aria-label="Invite link" onfocus={(e) => e.currentTarget.select()} />
          <Button icon={copied ? 'check' : 'copy'} onclick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
        <p class="note">
          People who join with this link come in as creators.
          {#if link.expiresAt}It works until {new Date(link.expiresAt).toLocaleDateString()}.{/if}
          {#if canAdmin}<button class="textbtn" type="button" onclick={reset}>Reset link</button>{/if}
        </p>
      {:else if link}
        <p class="note">The invite link is turned off for this workspace.</p>
      {/if}
    </section>

    <form onsubmit={invite}>
      <div class="row-label">{mailOn ? 'Invite by email' : 'Invite one person'}</div>
      <div class="emailrow">
        <input type="email" placeholder="name@company.com" aria-label="Email address" bind:value={email} autocomplete="off" />
        <select bind:value={role} aria-label="Seat">
          <option value="creator">Creator</option>
          <option value="viewer">Viewer</option>
        </select>
      </div>
      <p class="note">{role === 'creator' ? 'Creators capture, comment and organise.' : 'Viewers watch captures and comment.'}{#if !mailOn}{' '}This server sends no mail: you get a link for this person to send them yourself.{/if}</p>
      <div class="actions"><Button type="submit" variant="primary" disabled={!valid} loading={busy} data-testid="invite-submit">{mailOn ? 'Invite' : 'Copy invite link'}</Button></div>
    </form>

    {#if pending.length}
      <section>
        <div class="row-label">Pending</div>
        <ul>
          {#each pending as p (p.id)}
            <li><Icon name="user" size={14} /><span class="grow">{p.email}</span><span class="meta">{p.role === 'viewer' ? 'Viewer' : 'Creator'}</span>
              {#if !mailOn}<Button variant="ghost" size="sm" icon="copy" iconOnly aria-label="Copy the invite link for {p.email}" onclick={() => copyInvite(p)} data-testid="invite-copy" />{/if}
              <Button variant="ghost" size="sm" icon="close" iconOnly aria-label="Cancel invitation to {p.email}" onclick={() => cancel(p)} /></li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</dialog>

<style>
  dialog {
    width: min(480px, calc(100vw - 32px)); padding: var(--nb-space-5); border: 1px solid var(--nb-border);
    border-radius: var(--nb-radius-xl); background: var(--nb-surface); color: var(--nb-text); box-shadow: var(--nb-shadow-lg);
  }
  dialog::backdrop { background: var(--nb-overlay); }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--nb-space-4); }
  h2 { margin: 0; font-size: var(--nb-text-lg); }
  section, form { display: flex; flex-direction: column; gap: var(--nb-space-2); margin-bottom: var(--nb-space-4); }
  .row-label { font-size: var(--nb-text-md); font-weight: var(--nb-weight-medium); }
  .linkrow, .emailrow { display: flex; gap: var(--nb-space-2); }
  .linkrow input { flex: 1; font: var(--nb-text-md) var(--nb-font-mono); color: var(--nb-text-muted); }
  .emailrow input { flex: 1; }
  select {
    height: var(--nb-control-lg); padding: 0 var(--nb-space-2); border: 1px solid var(--nb-border-strong);
    border-radius: var(--nb-radius-md); background: var(--nb-surface); color: var(--nb-text); font: inherit;
  }
  .note { margin: 0; font-size: var(--nb-text-sm); color: var(--nb-text-faint); }
  .textbtn { all: unset; cursor: pointer; color: var(--nb-accent-text); margin-left: 4px; }
  .textbtn:hover { text-decoration: underline; }
  .actions { display: flex; justify-content: flex-end; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  li { display: flex; align-items: center; gap: 8px; font-size: var(--nb-text-md); }
  .grow { flex: 1; overflow: hidden; text-overflow: ellipsis; }
  .meta { color: var(--nb-text-faint); font-size: var(--nb-text-sm); }
</style>
