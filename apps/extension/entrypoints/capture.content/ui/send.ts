// Typed request to the service worker, shared by the in-page UI and the popup.
// A missing handler (an area not merged yet) comes back as not_implemented instead of throwing.
import { browser } from 'wxt/browser';
import type { BgRequestMap, BgRequestType, BgResult } from '@toolbar/shared/ext';

export async function send<K extends BgRequestType>(type: K, req: BgRequestMap[K]['req'] = {} as BgRequestMap[K]['req']): Promise<BgResult<K>> {
  try {
    const r = (await browser.runtime.sendMessage({ type, ...req })) as BgResult<K> | undefined;
    return r ?? { ok: false, error: 'not_implemented' };
  } catch (e) {
    return { ok: false, error: 'not_implemented', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Human line for a failed request. */
export function errorText(r: { ok: false; error: string; message?: string }): string {
  if (r.message && r.error !== 'not_implemented') return r.message;
  switch (r.error) {
    case 'not_signed_in':
      return 'Sign in to continue';
    case 'restricted_page':
      return 'Open a normal web page first';
    case 'busy':
      return 'Finish the open capture first';
    case 'not_implemented':
      return 'Not available in this build yet';
    case 'network':
      return 'The server did not answer';
    case 'permission_denied':
      return 'Permission missing';
    default:
      return r.message ?? 'Something went wrong';
  }
}
