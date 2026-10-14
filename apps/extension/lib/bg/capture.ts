// Capture area wiring in the service worker: one call, setupCapture(), from background.ts.
// Handles the capture port, the capture-related BgRequest types, offscreen events, commands,
// tab events, the upload drain alarm and webRequest. Other request types are left to the
// other areas' listeners (this listener returns false for them).
import { browser, type Browser } from 'wxt/browser';
import { isOffscreenEvent, CAPTURE_PORT, type BgRequest, type BgRequestType, type BgError } from '@toolbar/shared/ext';
import { STORAGE } from '@toolbar/shared/ext';
import { TEST_HOOKS } from '../flags';
import { CaptureError, CaptureService } from '../capture/service';
import { HttpError } from '../upload/client';

type Handler = (msg: BgRequest, sender: Browser.runtime.MessageSender) => Promise<Record<string, unknown>>;

export function setupCapture(): CaptureService {
  const svc = new CaptureService();
  svc.startWebRequest();
  svc.startTimers();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === CAPTURE_PORT) svc.onConnect(port);
  });

  const tabOf = (sender: Browser.runtime.MessageSender, tabId?: number) => tabId ?? sender.tab?.id;
  const handlers: Partial<Record<BgRequestType, Handler>> = {
    'session.get': async () => {
      await svc.ready();
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const { isRestrictedUrl } = await import('../capture/service');
      return { session: svc.getSession(), replay: svc.getReplay(), tabId: tab?.id ?? null, restricted: isRestrictedUrl(tab?.url) };
    },
    capture: async (m, sender) => {
      const msg = m as Extract<BgRequest, { type: 'capture' }>;
      const tabId = tabOf(sender, msg.tabId);
      switch (msg.mode) {
        case 'screenshot':
          return { session: await svc.armScreenshot(tabId, msg.delaySec) };
        case 'video':
          return { session: await svc.startRecording({ tabId, mode: msg.recordMode, delaySec: msg.delaySec }) };
        case 'replay': {
          await svc.triggerReplay(tabId);
          return { session: svc.getSession() };
        }
        default:
          throw new CaptureError('not_implemented', `${msg.mode} is handled by the recording-link flow`);
      }
    },
    'screenshot.take': async (m) => {
      const msg = m as Extract<BgRequest, { type: 'screenshot.take' }>;
      const draft = await svc.takeScreenshot(msg.rect);
      return { draftId: draft.id };
    },
    'screenshot.cancel': async () => (await svc.cancelScreenshot(), {}),
    'countdown.pause': async () => (await svc.pauseCountdown(), {}),
    'countdown.resume': async () => (await svc.resumeCountdown(), {}),
    'countdown.cancel': async () => (await svc.cancelCountdown(), {}),
    'recording.stop': async () => ({ session: await svc.stopRecording() }),
    'recording.pause': async () => (await svc.pauseRecording(), {}),
    'recording.resume': async () => (await svc.resumeRecording(), {}),
    'recording.mic': async (m) => {
      const msg = m as Extract<BgRequest, { type: 'recording.mic' }>;
      return { mic: await svc.setMic(msg.muted, msg.deviceId) };
    },
    'recording.mark': async (m) => {
      const msg = m as Extract<BgRequest, { type: 'recording.mark' }>;
      await svc.mark(msg.kind, msg.label);
      return {};
    },
    'replay.trigger': async (m, sender) => {
      const msg = m as Extract<BgRequest, { type: 'replay.trigger' }>;
      return { draftId: (await svc.triggerReplay(tabOf(sender, msg.tabId))).id };
    },
    'replay.set': async (m, sender) => {
      const msg = m as Extract<BgRequest, { type: 'replay.set' }>;
      return { replay: await svc.setReplay({ enabled: msg.enabled, video: msg.video, tabId: msg.video !== undefined ? tabOf(sender, msg.tabId) : undefined }) };
    },
    'mic.request': async () => ({ granted: await svc.requestMic() }),
    'mic.result': async (m) => {
      const msg = m as Extract<BgRequest, { type: 'mic.result' }>;
      await svc.onMicResult(msg.granted, msg.deviceCount);
      return {};
    },
    'session.dismiss': async () => ({ session: await svc.dismissError() }),
    'capture.ring': async (m, sender) => {
      const msg = m as Extract<BgRequest, { type: 'capture.ring' }>;
      const tabId = tabOf(sender, msg.tabId);
      if (tabId === undefined) throw new CaptureError('invalid', 'tabId required');
      return await svc.ringInfo(tabId, msg.sinceMs, msg.full);
    },
  };

  browser.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    if (isOffscreenEvent(msg)) {
      void svc.onOffscreenEvent(msg);
      return false;
    }
    const type = (msg as { type?: string } | null)?.type as BgRequestType | undefined;
    const h = type && handlers[type];
    if (!h) return false;
    h(msg as BgRequest, sender as Browser.runtime.MessageSender).then(
      (res) => reply({ ok: true, ...res }),
      (e: unknown) => {
        const error: BgError = e instanceof CaptureError ? e.code : e instanceof HttpError ? (e.status === 401 ? 'not_signed_in' : e.status === 0 ? 'network' : 'server') : 'invalid';
        reply({ ok: false, error, message: e instanceof Error ? e.message : String(e) });
      },
    );
    return true;
  });

  browser.commands.onCommand.addListener((command, tab) => {
    const tabId = tab?.id;
    const run = async () => {
      if (command === 'record-tab') {
        const s = svc.getSession();
        if (s.state === 'recording') await svc.stopRecording();
        else await svc.startRecording({ tabId });
      } else if (command === 'screenshot-mode') await svc.armScreenshot(tabId);
      else if (command === 'instant-replay') await svc.triggerReplay(tabId);
    };
    void run().catch((e: unknown) => (svc.stats.lastError = `command ${command}: ${String(e)}`));
  });

  browser.tabs.onRemoved.addListener((tabId) => void svc.onTabRemoved(tabId));
  browser.tabs.onActivated.addListener(({ tabId }) => void svc.onTabActivated(tabId));
  browser.tabs.onUpdated.addListener((tabId, info) => void svc.onTabUpdated(tabId, info.status));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE.settings.key]) void svc.onSettingsChanged();
  });
  browser.alarms?.onAlarm.addListener((a) => {
    if (svc.isDrainAlarm(a.name)) void svc.drainAll().catch(() => {});
  });
  browser.runtime.onStartup.addListener(() => void svc.drainAll().catch(() => {}));

  if (TEST_HOOKS) {
    // background.ts assigns globalThis.__tb after the area setups run; extend it afterwards.
    queueMicrotask(() => {
      const g = globalThis as unknown as { __tb?: Record<string, unknown> };
      g.__tb = { ...(g.__tb ?? {}), capture: svc, captureStats: () => structuredClone(svc.stats) };
    });
  }
  return svc;
}
