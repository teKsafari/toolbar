// Service worker: script registration, command routing, capture ports.
// Recording, screenshots, uploads and the instant-replay ring are filled in by the area agents.
import { browser } from 'wxt/browser';
import type { CaptureEvent, CommandName } from '@toolbar/shared';
import { registerCaptureScripts } from '../lib/registration';
import { CAPTURE_PORT, type BgRequest, type PortMessage } from '../lib/messages';
import { TEST_HOOKS } from '../lib/flags';
import { registerDraftHandlers } from '../lib/bg/drafts';

export default defineBackground(() => {
  const stats = { ports: 0, events: 0, byKind: {} as Record<string, number>, commands: [] as string[], pages: [] as string[] };
  const recent: CaptureEvent[] = [];

  const ready = registerCaptureScripts().catch((e: unknown) => {
    console.error('[nib] content script registration failed', e);
    throw e;
  });
  registerDraftHandlers();
  browser.runtime.onInstalled.addListener(() => void registerCaptureScripts());
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
        // TODO(capture/upload area): append to the per-tab ring and the active recording's events stream.
      }
    });
    port.onDisconnect.addListener(() => stats.ports--);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    stats.commands.push(command);
    // TODO(capture area): route each command (screenshot mode, tab recording, instant replay, recording link).
    console.debug('[nib] command', command as CommandName, tab?.id);
  });

  browser.runtime.onMessage.addListener((msg: BgRequest, _sender, reply) => {
    if (msg?.type === 'status') {
      reply({ ok: true, stats });
      return true;
    }
    if (msg?.type === 'capture') {
      // TODO(capture area): start the chosen capture mode on the active tab.
      reply({ ok: false, error: 'not_implemented' });
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
