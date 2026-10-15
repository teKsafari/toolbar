// Small actions several components share: the share link, copy toasts and the agent nudge.
import { toasts } from '@toolbar/ui';
import type { ShareSettings } from '@toolbar/shared/api';
import { call } from './api.ts';
import type { Viewer } from './viewer.svelte.ts';

let shareCache: Promise<ShareSettings> | null = null;

/** Share settings of the capture (members only); fetched once per page. */
export function shareSettings(v: Viewer): Promise<ShareSettings> {
  shareCache ??= call<ShareSettings>('sharing.get', { id: v.detail.id }).catch((e) => {
    shareCache = null;
    throw e;
  });
  return shareCache;
}

/** Set the capture's general access (J-119); the cached settings follow. */
export async function setShareAccess(v: Viewer, access: ShareSettings['access']): Promise<ShareSettings> {
  const s = await call<ShareSettings>('sharing.update', { id: v.detail.id }, { access });
  shareCache = Promise.resolve(s);
  return s;
}

/** The link to copy: the share URL for members, the page's own link for share viewers. */
export async function shareBaseUrl(v: Viewer, devtools = true): Promise<string | null> {
  if (v.data.mode === 'share' && v.data.shareToken) {
    const u = new URL(`/s/${v.data.shareToken}`, location.origin);
    if (!devtools || !v.data.devtools) u.searchParams.set('devtools', '0');
    return u.toString();
  }
  try {
    const s = await shareSettings(v);
    return devtools ? s.link.url : s.contentOnlyLink.url;
  } catch {
    toasts.error('Could not get the share link');
    return null;
  }
}

/** Toast after copy cURL or download that offers the agent setup (J-154). */
export function agentNudge(message: string) {
  toasts.success(message, {
    duration: 6000,
    action: { label: 'Set up your agent', run: () => window.open('/settings/mcp', '_blank', 'noopener') },
  });
}
