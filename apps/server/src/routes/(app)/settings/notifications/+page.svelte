<script lang="ts">
  // J-136: email toggles that save at once with no toast. Turn off all overrides the rest.
  // There is no in-app inbox, as in Jam. No plan-limit email (skip list: no plans).
  import { toasts } from '@toolbar/ui';
  import type { UserSettings } from '@toolbar/shared/api';
  import Section from '#lib/components/dashboard/Section.svelte';
  import Field from '#lib/components/dashboard/Field.svelte';
  import Switch from '#lib/components/dashboard/Switch.svelte';
  import { api, errMsg } from '#lib/components/dashboard/api.ts';

  let { data } = $props();
  // svelte-ignore state_referenced_locally
  let n = $state<UserSettings['notifications']>(structuredClone(data.settings.notifications));
  type Key = keyof UserSettings['notifications'];
  const rows: [Key, string, string][] = [
    ['firstView', 'Someone opens my capture', 'The first time someone else views a capture you made.'],
    ['sharedWithMe', 'A capture or folder is shared with me', 'When a teammate shares something with you.'],
    ['recordingLinkUsed', 'My recording link is used', 'Each time someone records through a link you made.'],
    ['domainSignup', 'Someone from my domain joins', 'When a person with your email domain joins a workspace you admin.'],
    ['mentions', 'I am mentioned in a comment', 'When someone @mentions you on a capture.'],
  ];

  async function set(patch: Partial<UserSettings['notifications']>) {
    const before = $state.snapshot(n);
    Object.assign(n, patch);
    try {
      const r = await api<UserSettings>('account.updateSettings', { body: { notifications: patch } });
      n = structuredClone(r.notifications);
    } catch (e) {
      n = before;
      toasts.error(errMsg(e));
    }
  }
</script>

<svelte:head><title>Notifications · Settings</title></svelte:head>

<h1>Notifications</h1>
<Section title="Email" description="Which emails we send you. Changes save as you flip them." testid="notification-section">
  {#each rows as [k, label, hint] (k)}
    <Field {label} {hint}>
      <Switch {label} checked={!n.allOff && (n[k] as boolean)} disabled={n.allOff} onchange={(v) => set({ [k]: v })} testid="notify-{k}" />
    </Field>
  {/each}
  <hr />
  <Field label="Turn off all emails" hint="Stops every email above. Sign-in links and invitations still arrive.">
    <Switch label="Turn off all emails" checked={n.allOff} onchange={(v) => set({ allOff: v })} testid="notify-allOff" />
  </Field>
</Section>

<style>
  h1 { margin-bottom: 18px; }
  hr { border: 0; border-top: 1px solid var(--nb-border); width: 100%; margin: 2px 0; }
</style>
