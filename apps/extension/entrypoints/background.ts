// Service worker: script registration, command routing, capture ports.
// Recording, screenshots, uploads and the instant-replay ring are filled in by the area agents.
import { browser } from 'wxt/browser';
import type { CaptureEvent, CommandName } from '@toolbar/shared';
import { injectIntoOpenTabs, registerCaptureScripts } from '../lib/registration';
import { CAPTURE_PORT, type BgRequest, type PortMessage } from '../lib/messages';
import { TEST_HOOKS } from '../lib/flags';
import { registerAuth } from '../lib/bg/auth';
import { migrateStorage } from '../lib/migrate';
import { setupCapture } from '../lib/bg/capture';
import { registerUi } from '../lib/bg/ui';
import { registerDraftHandlers } from '../lib/bg/drafts';
import { registerDashboard } from '../lib/bg/dashboard';

export default defineBackground(() => {
  void migrateStorage();
  registerAuth();
  registerUi();
  registerDashboard();
  const stats = { ports: 0, events: 0, byKind: {} as Record<string, number>, commands: [] as string[], pages: [] as string[] };
  const recent: CaptureEvent[] = [];

  const ready = registerCaptureScripts().catch((e: unknown) => {
    console.error('[toolbar] content script registration failed', e);
    throw e;
  });
  registerDraftHandlers();
  browser.runtime.onInstalled.addListener(() => void registerCaptureScripts().then(injectIntoOpenTabs, () => undefined));
  setupCapture();
  browser.runtime.onStartup.addListener(() => void registerCaptureScripts());

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
      ready: () => ready.then((r) => r.map((s) => s.id)),
      stats: () => structuredClone(stats),
      events: () => recent.slice(),
    };
  }
});
