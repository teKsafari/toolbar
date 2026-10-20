// Typed request to the service worker, shared by the in-page UI and the popup.
// A missing handler (an area not merged yet) comes back as not_implemented instead of throwing.
import { browser } from 'wxt/browser';
import type { BgRequestMap, BgRequestType, BgResult } from '@toolbar/shared/ext';

export { errorText } from '@toolbar/review/errors';

export async function send<K extends BgRequestType>(type: K, req: BgRequestMap[K]['req'] = {} as BgRequestMap[K]['req']): Promise<BgResult<K>> {
  try {
    const r = (await browser.runtime.sendMessage({ type, ...req })) as BgResult<K> | undefined;
    return r ?? { ok: false, error: 'not_implemented' };
  } catch (e) {
    return { ok: false, error: 'not_implemented', message: e instanceof Error ? e.message : String(e) };
  }
}
