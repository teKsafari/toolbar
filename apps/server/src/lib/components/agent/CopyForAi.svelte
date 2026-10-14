<script lang="ts">
  // Copy for AI: one click puts a markdown bundle on the clipboard (summary, errors, failed
  // requests with bodies, steps, and pointers to the MCP server and CLI) for pasting into any
  // chat or agent. The viewer area mounts it in the capture header.
  import { Button, toasts } from '@toolbar/ui';
  import { copyLater, fetchBrief } from './brief.ts';

  interface Props {
    captureId: string;
    shareToken?: string | null;
    size?: 'sm' | 'md';
    variant?: 'secondary' | 'ghost';
  }
  let { captureId, shareToken = null, size = 'md', variant = 'secondary' }: Props = $props();
  let busy = $state(false);
  let done = $state(false);

  async function copy() {
    busy = true;
    try {
      await copyLater(fetchBrief(captureId, shareToken).then((b) => b.markdown));
      done = true;
      toasts.success('Copied for AI: paste it into your agent', {
        action: shareToken ? undefined : { label: 'Connect an agent', run: () => (location.href = '/settings/mcp') },
      });
      setTimeout(() => (done = false), 2000);
    } catch (e) {
      toasts.error(`Could not copy: ${(e as Error).message}`);
    } finally {
      busy = false;
    }
  }
</script>

<Button {size} {variant} icon={done ? 'check' : 'copy'} loading={busy} onclick={copy} title="Copy a summary with errors, failed requests and steps for an AI agent" data-testid="copy-for-ai">
  Copy for AI
</Button>
