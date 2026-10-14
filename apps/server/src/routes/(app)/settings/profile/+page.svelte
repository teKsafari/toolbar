<script lang="ts">
  // J-175 profile: avatar upload and delete on hover, first and last name, a role picker that
  // changes a hint line, a locked email, and the delete-account button. J-225: the dialog lists
  // the workspaces that go with the account and needs DELETE typed in capitals.
  import { invalidateAll } from '$app/navigation';
  import { Button, toasts } from '@toolbar/ui';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Modal from '#lib/components/dashboard/Modal.svelte';
  import UserAvatar from '#lib/components/dashboard/UserAvatar.svelte';
  import DIcon from '#lib/components/dashboard/DIcon.svelte';
  import { api, errMsg, urlOf } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  // svelte-ignore state_referenced_locally
  // svelte-ignore state_referenced_locally
  // svelte-ignore state_referenced_locally
  let first = $state(data.me.firstName ?? '');
  // svelte-ignore state_referenced_locally
  let last = $state(data.me.lastName ?? '');
  // svelte-ignore state_referenced_locally
  let role = $state(data.me.roleHint ?? '');
  let busy = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let delOpen = $state(false);
  let typed = $state('');
  let deleting = $state(false);

  const ROLES: [string, string][] = [
    ['', 'Pick one'],
    ['engineering', 'Engineering'],
    ['qa', 'QA and testing'],
    ['product', 'Product'],
    ['design', 'Design'],
    ['support', 'Customer support'],
    ['other', 'Something else'],
  ];
  const HINTS: Record<string, string> = {
    '': 'Tell us what you do and we will point you at the parts that help most.',
    engineering: 'Agents can read your captures through MCP or the CLI: see Apps and tools.',
    qa: 'Instant replay saves the last minutes of a tab, so a bug you just hit is never lost.',
    product: 'Recording links let customers record their screen for you without installing anything.',
    design: 'Annotate screenshots with arrows, boxes and blur before you share them.',
    support: 'Send a recording link to a customer; their recording lands here with an email to you.',
    other: 'Ctrl K searches captures, people and folders from anywhere.',
  };

  async function save(body: Record<string, unknown>) {
    busy = true;
    try {
      await api('account.update', { body });
      await invalidateAll();
    } catch (e) {
      toasts.error(errMsg(e));
    } finally {
      busy = false;
    }
  }
  function saveNames() {
    if (first.trim() === (data.me.firstName ?? '') && last.trim() === (data.me.lastName ?? '')) return;
    void save({ firstName: first.trim(), lastName: last.trim() });
  }

  async function uploadAvatar(file: File) {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('kind', 'avatar');
    try {
      const res = await fetch(urlOf('captures.uploadAsset'), { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? 'Upload failed');
      await save({ imageAssetId: j.id });
    } catch (e) {
      toasts.error(errMsg(e));
    }
  }

  async function deleteAccount() {
    deleting = true;
    try {
      await api('account.delete', { body: { confirm: 'DELETE' } });
      location.href = '/login';
    } catch (e) {
      toasts.error(errMsg(e));
      deleting = false;
    }
  }
</script>

<svelte:head><title>Profile · Settings</title></svelte:head>

<h1>Profile</h1>

<Section title="You" description="How you appear on captures, comments and the members list." testid="profile-section">
  <div class="av">
    <button class="pic" onclick={() => fileInput?.click()} aria-label="Upload a photo" data-testid="avatar-upload">
      <UserAvatar name={data.me.name} image={data.me.image} size={72} />
      <span class="over"><DIcon name="upload" /></span>
    </button>
    <input bind:this={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) void uploadAvatar(f); }} />
    {#if data.me.image}<button class="link" onclick={() => save({ imageAssetId: null })} data-testid="avatar-delete">Remove photo</button>{/if}
  </div>
  <div class="two">
    <label>First name<input type="text" bind:value={first} maxlength="100" onblur={saveNames} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} data-testid="first-name" /></label>
    <label>Last name<input type="text" bind:value={last} maxlength="100" onblur={saveNames} onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} data-testid="last-name" /></label>
  </div>
  <label>What do you do?
    <select bind:value={role} onchange={() => save({ roleHint: role || null })} data-testid="role-hint">
      {#each ROLES as [v, l] (v)}<option value={v}>{l}</option>{/each}
    </select>
  </label>
  <p class="hint" data-testid="role-hint-line">{HINTS[role] ?? HINTS['']}</p>
  <label>Email<span class="locked"><input type="email" value={data.me.email} disabled aria-describedby="email-note" /><DIcon name="lock" size={14} /></span></label>
  <p class="hint" id="email-note">Your email is how you sign in, so it cannot be changed here.</p>
  {#if busy}<span class="muted small"><DIcon name="spinner" size={12} /> Saving</span>{/if}
</Section>

<Section title="Delete account" description="Erases your account. Workspaces where you are the only member go with it." testid="delete-section">
  <div><Button variant="danger" icon="trash" onclick={() => ((typed = ''), (delOpen = true))} data-testid="delete-account">Delete account</Button></div>
</Section>

<Modal bind:open={delOpen} title="Delete your account?" width={480} testid="delete-dialog">
  {#if data.plan.blocked.length}
    <p class="err" data-testid="delete-blocked">You are the only admin of {data.plan.blocked.map((b) => b.name).join(', ')}, which other people use. Make someone else an admin there first, or remove the other members.</p>
  {:else}
    <p>This is permanent.</p>
    {#if data.plan.erase.length}
      <p>These workspaces have no other members and are erased with all their captures, folders, links and comments:</p>
      <ul data-testid="delete-workspaces">{#each data.plan.erase as w (w.id)}<li>{w.name}</li>{/each}</ul>
    {/if}
    {#if data.plan.leave.length}
      <p class="muted">You leave {data.plan.leave.map((w) => w.name).join(', ')}. Captures you made there stay; your comments show as from a deleted account.</p>
    {/if}
    <label>Type DELETE to confirm<input type="text" bind:value={typed} autocomplete="off" data-testid="delete-confirm-input" /></label>
  {/if}
  {#snippet footer()}
    <Button onclick={() => (delOpen = false)}>Cancel</Button>
    <Button variant="danger" disabled={typed !== 'DELETE' || data.plan.blocked.length > 0} loading={deleting} onclick={deleteAccount} data-testid="delete-confirm">Delete my account</Button>
  {/snippet}
</Modal>

<style>
  h1 { margin-bottom: 18px; }
  .av { display: flex; align-items: center; gap: 16px; }
  .pic { all: unset; position: relative; border-radius: 50%; overflow: hidden; cursor: pointer; display: inline-flex; }
  .pic:focus-visible { outline: 2px solid var(--nb-focus); outline-offset: 2px; }
  .over { position: absolute; inset: 0; display: grid; place-items: center; background: rgb(0 0 0 / 0.45); color: #fff; opacity: 0; transition: opacity var(--nb-dur-fast); }
  .pic:hover .over, .pic:focus-visible .over { opacity: 1; }
  .link { all: unset; color: var(--nb-accent-text); cursor: pointer; font-size: var(--nb-text-md); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 520px) { .two { grid-template-columns: 1fr; } }
  label { display: flex; flex-direction: column; gap: 4px; font-size: var(--nb-text-md); color: var(--nb-text-muted); }
  label input, label select { color: var(--nb-text); }
  select { height: 38px; border: 1px solid var(--nb-border-strong); border-radius: var(--nb-radius-md); background: var(--nb-surface); padding: 0 8px; font: inherit; max-width: 320px; }
  .hint { margin: -6px 0 0; font-size: var(--nb-text-sm); color: var(--nb-text-muted); }
  .locked { position: relative; display: flex; align-items: center; }
  .locked :global(svg) { position: absolute; right: 12px; color: var(--nb-text-faint); }
  .locked input { padding-right: 34px; }
  .small { font-size: var(--nb-text-sm); }
  .err { color: var(--nb-danger); margin: 0; }
  ul { margin: 0; padding-left: 20px; }
  p { margin: 0; }
</style>
