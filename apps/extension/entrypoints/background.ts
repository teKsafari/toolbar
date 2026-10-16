// Service worker: script registration, command routing, capture ports.
// Recording, screenshots, uploads and the instant-replay ring are filled in by the area agents.
import { browser } from 'wxt/browser';
import type { CaptureEvent, CommandName } from '@toolbar/shared';
import { syncRegistration } from '../lib/registration';
import { registerScope } from '../lib/bg/scope';
import { scope } from '../lib/scope';
import { CAPTURE_PORT, type BgRequest, type PortMessage } from '../lib/messages';
import { TEST_HOOKS } from '../lib/flags';
import { registerAuth } from '../lib/bg/auth';
import { brandState, registerBrand } from '../lib/bg/brand';
import { setupCapture } from '../lib/bg/capture';
import { registerUi } from '../lib/bg/ui';
import { registerDraftHandlers } from '../lib/bg/drafts';
import { registerDashboard } from '../lib/bg/dashboard';
import { registerTrace } from '../lib/bg/trace';
import { registerLocator } from '../lib/bg/locator';
import { registerReview } from '../lib/bg/review';

export default defineBackground(() => {
  registerBrand();
  registerAuth();
  registerUi();
  registerDashboard();
  const stats = { ports: 0, events: 0, byKind: {} as Record<string, number>, commands: [] as string[], pages: [] as string[] };
  const recent: CaptureEvent[] = [];

  // D-126: capture scripts run on the granted project origins only (lib/scope.ts)
  registerScope();
  const ready = syncRegistration().catch((e: unknown) => {
    console.error('[toolbar] content script registration failed', e);
    throw e;
  });
  registerDraftHandlers();
  browser.runtime.onInstalled.addListener(() => void syncRegistration().catch(() => undefined));
  const capture = setupCapture();
  registerTrace(capture);
  registerLocator(capture);
  registerReview(capture);
  browser.runtime.onStartup.addListener(() => void syncRegistration().catch(() => undefined));

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CAPTURE_PORT) return;
    stats.ports++;
    port.onMessage.addListener((msg: PortMessage) => {
      if (msg.type === 'hello') stats.pages.push(msg.url);
      if (msg.type === 'events') {
        stats.events += msg.batch.length;
        for (const e of msg.batch) stats.byKind[e.kind] = (stats.byKind[e.kind] ?? 0) + 1;
        if (TEST_HOOKS) recent.push(...msg.batch.slice(-200));
        if (recent.length > 1000) recent.splice(0, recent.length - 1000);
      }
    });
    port.onDisconnect.addListener(() => stats.ports--);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    stats.commands.push(command);
    // routed by lib/bg/ui.ts (ext-ui)
    console.debug('[toolbar] command', command as CommandName, tab?.id);
  });

  browser.runtime.onMessage.addListener((msg: BgRequest, _sender, reply) => {
    if (msg?.type === 'status') {
      reply({ ok: true, stats });
      return true;
    }
    return false;
  });

  if (TEST_HOOKS) {
    (globalThis as unknown as { __tb: unknown }).__tb = {
      ready: () => ready.then(() => browser.scripting.getRegisteredContentScripts()).then((r) => r.map((s) => s.id)),
      // D-126: what the extension may run on, and what is registered
      scope: () => scope(),
      registered: () => browser.scripting.getRegisteredContentScripts(),
      sync: () => syncRegistration(),
      stats: () => structuredClone(stats),
      events: () => recent.slice(),
      brand: () => ({ ...brandState }),
    };
  }
});
