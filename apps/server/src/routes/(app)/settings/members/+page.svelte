<script lang="ts">
  // J-173 members page: invite-link switch with a copyable link (29-day expiry) and reset,
  // restrict-invites switch, add members, and a table of name, role, last active and a row menu
  // (leave for yourself, remove for admins). J-222: admins click a role to change the seat; the
  // auto-approve switch decides whether a viewer who creates becomes a creator. Guests: people
  // given a folder who are not members (J-122). J-249: a member who leaves keeps their captures
  // in the workspace.
  import { goto, invalidateAll } from '$app/navigation';
  import { Button, Popover, toasts } from '@toolbar/ui';
  import type { Member, SeatRole } from '@toolbar/shared/api';
  import { relativeTime } from '@toolbar/shared/areas/dashboard';
  import InviteDialog from '#lib/components/auth/InviteDialog.svelte';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Field from '#lib/components/dashboard/Field.svelte';
  import Switch from '#lib/components/dashboard/Switch.svelte';
  import Confirm from '#lib/components/dashboard/Confirm.svelte';
  import UserAvatar from '#lib/components/dashboard/UserAvatar.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, copyText, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  const admin = $derived(data.ws.role === 'admin');
  // svelte-ignore state_referenced_locally
  let members = $state<Member[]>(data.members);
  let inviteOpen = $state(false);
  let leaving = $state<Member | null>(null);
  let filter = $state('');
  $effect(() => {
    members = data.members;
  });

  const shown = $derived(members.filter((m) => !filter.trim() || `${m.person.name} ${m.person.email}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const roleLabel: Record<SeatRole, string> = { admin: 'Admin', creator: 'Creator', viewer: 'Viewer' };
  const roleHint: Record<SeatRole, string> = {
    admin: 'Manages the workspace, members and apps',
    creator: 'Makes captures and recording links',
    viewer: 'Views and comments',
  };

  async function patchWs(body: Record<string, unknown>) {
    try {
      await api('workspaces.update', { params: { workspaceId: data.ws.id }, body });
      await invalidateAll();
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function setRole(m: Member, role: SeatRole, close: () => void) {
    close();
    if (role === m.role) return;
    try {
      const u = await api<Member>('members.update', { params: { workspaceId: data.ws.id, userId: m.userId }, body: { role } });
      members = members.map((x) => (x.userId === m.userId ? u : x));
      toasts.success(`${m.person.name} is now ${roleLabel[role].toLowerCase()}`);
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function remove(m: Member) {
    await api('members.remove', { params: { workspaceId: data.ws.id, userId: m.userId } });
    if (m.userId === data.me) {
      toasts.success(`You left ${data.ws.name}`);
      await goto('/', { invalidateAll: true });
    } else {
      members = members.filter((x) => x.userId !== m.userId);
      toasts.success(`${m.person.name} was removed; their captures stay in the workspace`);
    }
  }

  async function copyLink() {
    if (data.link?.url && (await copyText(data.link.url))) toasts.success('Invite link copied');
  }
  async function resetLink() {
    try {
      await api('invites.resetLink', { params: { workspaceId: data.ws.id } });
      await invalidateAll();
      toasts.success('New invite link made; the old one stopped working');
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }
  const daysLeft = $derived(data.link?.expiresAt ? Math.max(0, Math.round((Date.parse(data.link.expiresAt) - Date.now()) / 86_400_000)) : null);
</script>

<svelte:head><title>Members · Settings</title></svelte:head>

<div class="head">
  <h1>Members</h1>
</div>

<Section title="Invite link" description="Anyone with this link joins as a creator. It expires after 29 days; reset it to stop the old one." testid="invite-link-section">
  <Field label="Invite link" hint={data.ws.settings.inviteLinkEnabled ? (daysLeft !== null ? `Expires in ${daysLeft} days` : '') : 'Off: people join only through email invites.'}>
    <Switch label="Invite link" disabled={!admin} checked={data.ws.settings.inviteLinkEnabled} onchange={(v) => patchWs({ inviteLinkEnabled: v })} testid="invite-link-switch" />
  </Field>
  {#if data.link?.url}
    <div class="linkrow">
      <input type="text" readonly value={data.link.url} aria-label="Invite link" data-testid="invite-link-url" />
      <Button icon="copy" onclick={copyLink} data-testid="invite-link-copy">Copy</Button>
      {#if admin}<Button variant="ghost" icon="replay" onclick={resetLink} data-testid="invite-link-reset">Reset</Button>{/if}
    </div>
  {/if}
  <Field label="Only admins can invite" hint="Creators no longer see the invite button or link.">
    <Switch label="Only admins can invite" disabled={!admin} checked={data.ws.settings.restrictInvites} onchange={(v) => patchWs({ restrictInvites: v })} testid="restrict-invites" />
  </Field>
  <Field label="Approve new creators automatically" hint="On: a viewer who makes a capture becomes a creator. Off: they stay a viewer until an admin changes the seat.">
    <Switch label="Approve new creators automatically" disabled={!admin} checked={data.ws.settings.autoApproveCreators} onchange={(v) => patchWs({ autoApproveCreators: v })} testid="auto-approve" />
  </Field>
</Section>

<Section title={`${members.length} ${members.length === 1 ? 'member' : 'members'}`} testid="member-section">
  {#snippet actions()}
    <!-- beside the members table heading, where the list it adds to is (J-173) -->
    {#if data.canInvite}<Button variant="primary" icon="plus" onclick={() => (inviteOpen = true)} data-testid="add-members">Add members</Button>{/if}
  {/snippet}
  {#if members.length > 6}<input class="filter" type="text" bind:value={filter} placeholder="Find a member" aria-label="Find a member" />{/if}
  <div class="tablewrap">
    <table data-testid="member-table">
      <thead><tr><th class="name">Name</th><th>Role</th><th class="last">Last active</th><th><span class="sr">Actions</span></th></tr></thead>
      <tbody>
        {#each shown as m (m.userId)}
          <tr data-user={m.userId}>
            <td class="name">
              <span class="who">
                <UserAvatar name={m.person.name} image={m.person.image} size={30} />
                <span class="col"><span class="n">{m.person.name}{#if m.userId === data.me}<span class="you">you</span>{/if}</span><span class="e">{m.person.email}</span></span>
              </span>
            </td>
            <td>
              {#if admin && m.userId !== data.me}
                <Popover label="Change role" placement="bottom-start">
                  {#snippet trigger({ toggle, open, id })}
                    <button class="role" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="role-button">{roleLabel[m.role]}{#if m.isOwner}<span class="own">owner</span>{/if}<DIcon name="chevron-down" size={11} /></button>
                  {/snippet}
                  {#snippet children({ close })}
                    <div class="roles" role="menu">
                      {#each ['viewer', 'creator', 'admin'] as const as r (r)}
                        <button role="menuitemradio" aria-checked={m.role === r} onclick={() => setRole(m, r, close)} data-role={r}>
                          <span class="rl">{roleLabel[r]}{#if m.role === r}<DIcon name="check" size={13} />{/if}</span>
                          <span class="rh">{roleHint[r]}</span>
                        </button>
                      {/each}
                    </div>
                  {/snippet}
                </Popover>
              {:else}
                <span class="rolestatic">{roleLabel[m.role]}{#if m.isOwner}<span class="own">owner</span>{/if}</span>
              {/if}
            </td>
            <td class="muted last">{m.lastActiveAt ? relativeTime(m.lastActiveAt) : 'Not yet'}</td>
            <td class="act">
              {#if m.userId === data.me || admin}
                <Popover label="Member actions" placement="bottom-end">
                  {#snippet trigger({ toggle, open, id })}
                    <Button size="sm" variant="ghost" iconOnly icon="more" aria-label="Actions for {m.person.name}" onclick={toggle} aria-expanded={open} aria-controls={id} data-testid="member-menu" />
                  {/snippet}
                  {#snippet children({ close })}
                    <div class="roles" role="menu">
                      <button role="menuitem" class="danger" onclick={() => ((leaving = m), close())} data-testid="member-remove">
                        <span class="rl"><DIcon name={m.userId === data.me ? 'arrow-left' : 'trash'} size={14} />{m.userId === data.me ? 'Leave workspace' : 'Remove from workspace'}</span>
                      </button>
                    </div>
                  {/snippet}
                </Popover>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</Section>

{#if data.pending.length}
  <Section title="Pending invites" description="Sent by email and not accepted yet.">
    <ul class="plain">
      {#each data.pending as i (i.id)}
        <li><DIcon name="bell" size={14} /><span class="grow">{i.email}</span><span class="muted">{i.role === 'viewer' ? 'Viewer' : 'Creator'} · expires {relativeTime(i.expiresAt)}</span></li>
      {/each}
    </ul>
  </Section>
{/if}

<Section title="Guests" description="People given access to a folder who are not members. They see only that folder." testid="guest-section">
  {#if data.guests.length}
    <ul class="plain">
      {#each data.guests as g (g.id)}
        <li>
          <UserAvatar name={g.name} image={g.image} size={24} />
          <span class="grow">{g.name}{#if g.email && g.email !== g.name} <span class="muted">{g.email}</span>{/if}</span>
          <a href="/f/{g.folder.shortId}">{g.folder.name}</a>
          <span class="muted">{g.pending ? 'Invited' : g.role === 'creator' ? 'Creator' : 'Viewer'}</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">No guests. Share a folder from its page to add one.</p>
  {/if}
</Section>

{#if data.canInvite}
  <InviteDialog workspace={{ id: data.ws.id, name: data.ws.name, slug: data.ws.slug, logoUrl: data.ws.logoUrl, role: data.ws.role, isOwner: data.ws.isOwner, memberCount: members.length, createdAt: data.ws.createdAt }} bind:open={inviteOpen} />
{/if}

<Confirm
  open={!!leaving}
  title={leaving?.userId === data.me ? `Leave ${data.ws.name}?` : `Remove ${leaving?.person.name}?`}
  message={leaving?.userId === data.me ? 'You lose access to its captures. Captures you made stay in the workspace.' : 'They lose access at once. Captures they made stay in the workspace.'}
  confirmLabel={leaving?.userId === data.me ? 'Leave' : 'Remove'}
  onconfirm={async () => {
    if (leaving) await remove(leaving).catch((e) => toasts.error(errMsg(e)));
    leaving = null;
  }}
/>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .head h1 { margin: 0; }
  .linkrow { display: flex; gap: 8px; }
  .linkrow input { flex: 1; min-width: 0; height: 34px; font-family: var(--nb-font-mono); font-size: var(--nb-text-sm); }
  .filter { height: 32px; max-width: 280px; }
  /* The table fits its column, so the role and row menus open outside it instead of being cut
     off by a scroll box (J-222); on a phone the last-active column goes (J-124, J-173). */
  .tablewrap { overflow: visible; }
  table { width: 100%; border-collapse: collapse; }
  .name { width: 100%; max-width: 0; }
  .last { white-space: nowrap; }
  @media (max-width: 560px) {
    .last { display: none; }
    td { padding: 8px 4px; }
  }
  /* the language's table header: mono 10.5 px uppercase, faint, over an edge rule */
  th { text-align: left; font: var(--nb-weight-normal) 10.5px / 1.4 var(--nb-font-mono); letter-spacing: var(--nb-tracking-label); text-transform: uppercase; color: var(--nb-text-faint); padding: 6px 8px; border-bottom: 1px solid var(--nb-border); }
  td { padding: 8px; border-bottom: 1px solid var(--nb-border); vertical-align: middle; }
  tbody tr { transition: background-color var(--nb-dur-fast) var(--nb-ease-out); }
  tbody tr:hover { background: var(--nb-surface-2); }
  tr:last-child td { border-bottom: 0; }
  .who { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .col { display: flex; flex-direction: column; min-width: 0; }
  .n { font-weight: var(--nb-weight-medium); display: inline-flex; align-items: center; gap: 6px; }
  .e { font-size: var(--nb-text-sm); color: var(--nb-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .n { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .role, .rolestatic { white-space: nowrap; }
  .you, .own { font-size: var(--nb-text-xs); padding: 0 7px; border-radius: var(--nb-radius-pill); background: var(--nb-surface-sunken); color: var(--nb-text-muted); font-weight: var(--nb-weight-medium); }
  .role { all: unset; display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: var(--nb-radius-md); cursor: pointer; }
  .role:hover { background: var(--nb-surface-sunken); }
  .role:focus-visible { outline: 2px solid var(--nb-focus); }
  .rolestatic { display: inline-flex; gap: 6px; align-items: center; padding: 4px 8px; }
  .roles { display: flex; flex-direction: column; gap: 1px; width: 250px; }
  .roles button { all: unset; display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; border-radius: var(--nb-radius-md); cursor: pointer; }
  .roles button:hover, .roles button:focus-visible { background: var(--nb-surface-sunken); }
  .rl { display: inline-flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: var(--nb-weight-medium); }
  .rh { font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .danger .rl { color: var(--nb-danger); justify-content: flex-start; }
  .act { text-align: right; width: 40px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .plain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .plain li { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  p.muted { margin: 0; }
</style>
