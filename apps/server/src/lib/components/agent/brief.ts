// Client helpers for the agent tab and the copy-for-AI button.
import { buildPath, ROUTES, SHARE_TOKEN_HEADER, type AgentBrief } from '@toolbar/shared/api';

/** One agent the signed-in person connected over MCP OAuth (agent.listClients). */
export interface ConnectedAgent {
  id: string;
  name: string;
  lastUsedAt: string | null;
}

/** The person's connected agents; empty for link viewers and on any error. */
export async function fetchConnected(): Promise<ConnectedAgent[]> {
  try {
    const res = await fetch(ROUTES['agent.listClients'].path);
    if (!res.ok) return [];
    return ((await res.json()) as { items: ConnectedAgent[] }).items;
  } catch {
    return [];
  }
}

export async function fetchBrief(captureId: string, shareToken: string | null): Promise<AgentBrief> {
  const res = await fetch(buildPath(ROUTES['agent.captureBrief'].path, { id: captureId }), {
    headers: shareToken ? { [SHARE_TOKEN_HEADER]: shareToken } : {},
  });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${res.status}`);
  return (await res.json()) as AgentBrief;
}

/**
 * Copy text that is still being fetched. ClipboardItem with a promise keeps the click's user
 * activation while the request runs (Chrome, Safari); writeText is the fallback.
 */
export async function copyLater(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
      return;
    } catch {
      /* fall through */
    }
  }
  await navigator.clipboard.writeText(await text);
}
