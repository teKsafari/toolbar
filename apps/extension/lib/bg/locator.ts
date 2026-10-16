// Locator packets in the service worker (D-128). background.ts registers it with one line:
// registerLocator(capture).
//
// - `locator.capture`: asks the page for its part (target, Svelte dev location, SvelteKit entry
//   modules), reads the app's route table from its entry module, maps the stacks of the last
//   60 s of errors through the app's source maps, and crops the target at 1x CSS pixels.
// - Every `error` event and every console error with a stack that reaches the worker gets a
//   follow-up `stackmap` event with original positions, when the app serves source maps.
// Fetches run here, never in the page: the worker's own requests never enter a capture (J-248).
import { browser, type Browser } from 'wxt/browser';
import type { CaptureEvent } from '@toolbar/shared';
import type { LocatorPacket } from '@toolbar/shared/locator';
import { completeLocator, createRouteTables, errorOf } from '@toolbar/shared/locator-complete';
import { createStackMapper, type FetchedText } from '@toolbar/shared/sourcemap';
import type { BgRequest, BgResult, LocatorCrop } from '@toolbar/shared/ext';
import type { PageLocator } from '@toolbar/capture';
import { CAPTURE_PORT, type PortMessage } from '../messages';
import { cropImage, dataUrlToBlob } from '../crop';
import { TEST_HOOKS } from '../flags';
import type { CaptureService } from '../capture/service';
import { noteShot, noteShotError } from './shot-access';

const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const ERRORS_MAX = 10;

type PageLocatorReply = PageLocator | { error: string };

/** GET as the extension, cached by the browser; null on any failure or an oversize body. */
export async function fetchText(url: string): Promise<FetchedText | null> {
  try {
    const res = await fetch(url, { credentials: 'include', cache: 'force-cache' });
    if (!res.ok) return null;
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_TEXT_BYTES) return null;
    const text = await res.text();
    const headers: Record<string, string> = {};
    for (const k of ['sourcemap', 'x-sourcemap', 'content-type']) {
      const v = res.headers.get(k);
      if (v) headers[k] = v;
    }
    return { text, headers };
  } catch {
    return null;
  }
}

export const mapper = createStackMapper({ fetchText });

const tables = createRouteTables(fetchText);

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

class LocatorError_ extends Error {
  constructor(
    readonly code: 'restricted_page' | 'invalid' | 'server',
    message: string,
  ) {
    super(message);
  }
}

export async function captureLocator(
  svc: CaptureService,
  req: Extract<BgRequest, { type: 'locator.capture' }>,
  tabId: number,
): Promise<{ locator: LocatorPacket; crop: LocatorCrop | null }> {
  const tab = await browser.tabs.get(tabId);
  const target = { kind: req.kind, at: req.at, selector: req.selector, rect: req.rect, selection: req.selection };
  const page = (await browser.tabs.sendMessage(tabId, { type: 'locator.describe', target }, { frameId: 0 }).catch(() => undefined)) as PageLocatorReply | undefined;
  if (!page || 'error' in page) throw new LocatorError_('restricted_page', page && 'error' in page ? page.error : 'The page did not answer (restricted or not loaded)');
  const packet = page.packet;
  // route table of a SvelteKit app and the errors of the last minute, stacks mapped
  const since = req.errorsSinceMs ?? 60_000;
  let events: CaptureEvent[] = [];
  if (since > 0) {
    await svc.flushTabs([tabId]).catch(() => undefined); // events the page has not sent yet
    const info = await svc.ringInfo(tabId, since, true).catch(() => null);
    events = (info?.slice?.events ?? []) as CaptureEvent[];
  }
  await completeLocator(page, { routes: tables, mapper, events, maxErrors: ERRORS_MAX });

  // the crop, 1x CSS pixels
  let crop: LocatorCrop | null = null;
  if (req.crop !== false && page.cropRect && tab.active) {
    const shot = await svc.captureTab(tab.windowId).then(
      (s) => (noteShot(tabId, 'ok'), s),
      (e) => (noteShotError(tabId, e), null),
    );
    if (shot) {
      const out = await cropImage(await dataUrlToBlob(shot), page.cropRect, packet.viewport.w, { cssPixels: true });
      crop = { dataUrl: await toDataUrl(out.blob), w: out.width, h: out.height };
      packet.crop = { w: out.width, h: out.height, scale: 1 };
    }
  }
  return { locator: packet, crop };
}

/** Follow-up `stackmap` events for errors with stacks, at most 30 a minute per tab. */
function watchErrors(svc: CaptureService) {
  const budget = new Map<number, { start: number; n: number }>();
  const allow = (tabId: number) => {
    const now = Date.now();
    const b = budget.get(tabId);
    if (!b || now - b.start > 60_000) {
      budget.set(tabId, { start: now, n: 1 });
      return true;
    }
    return ++b.n <= 30;
  };
  browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
    if (port.name !== CAPTURE_PORT) return;
    const tabId = port.sender?.tab?.id;
    if (tabId === undefined || tabId < 0) return;
    port.onMessage.addListener((msg: PortMessage) => {
      if (msg?.type !== 'events') return;
      for (const e of msg.batch) {
        if (e.kind !== 'error' && e.kind !== 'console') continue;
        const x = errorOf(e);
        if (!x?.stack || !/https?:\/\//.test(x.stack) || !allow(tabId)) continue;
        void mapper.mapStack(x.stack).then(
          (m) => {
            if (m.mapped) svc.emit(tabId, 'stackmap', { ref: e.id, frames: m.frames });
          },
          () => undefined,
        );
      }
    });
  });
}

export function registerLocator(svc: CaptureService) {
  watchErrors(svc);
  browser.runtime.onMessage.addListener(((msg: BgRequest, sender: Browser.runtime.MessageSender, reply: (r: BgResult<'locator.capture'>) => void) => {
    if (msg?.type !== 'locator.capture') return false;
    const m = msg as Extract<BgRequest, { type: 'locator.capture' }>;
    (async () => {
      const tabId = m.tabId ?? sender.tab?.id ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (tabId === undefined) throw new LocatorError_('invalid', 'No tab to locate in');
      return captureLocator(svc, m, tabId);
    })().then(
      (res) => reply({ ok: true, ...res }),
      (e: unknown) => reply({ ok: false, error: e instanceof LocatorError_ ? e.code : 'server', message: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

  if (TEST_HOOKS) {
    queueMicrotask(() => {
      const g = globalThis as unknown as { __tb?: Record<string, unknown> };
      if (!g.__tb) return;
      g.__tb.locator = {
        capture: (req: Omit<Extract<BgRequest, { type: 'locator.capture' }>, 'type'> & { tabId: number }) => captureLocator(svc, { type: 'locator.capture', ...req }, req.tabId),
        mapStack: (stack: string) => mapper.mapStack(stack),
        clear: () => {
          mapper.clear();
          tables.clear();
        },
      };
    });
  }
}
