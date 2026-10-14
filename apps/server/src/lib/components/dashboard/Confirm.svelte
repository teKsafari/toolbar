<script lang="ts">
  // Destructive confirm: says the action is permanent; the red button runs it (ergonomics:
  // destructive actions take three clicks including this confirm).
  import { Button } from '@toolbar/ui';
  import Modal from './Modal.svelte';

  interface Props {
    open?: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onconfirm: () => Promise<void> | void;
  }
  let { open = $bindable(false), title, message, confirmLabel = 'Delete', onconfirm }: Props = $props();
  let busy = $state(false);

  async function run() {
    busy = true;
    try {
      await onconfirm();
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open {title} testid="confirm-dialog">
  <p class="msg">{message}</p>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Cancel</Button>
    <Button variant="danger" loading={busy} onclick={run} data-testid="confirm-button" autofocus>{confirmLabel}</Button>
  {/snippet}
</Modal>

<style>
  .msg { margin: 0; color: var(--nb-text-muted); }
</style>
