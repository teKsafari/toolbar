// Capture area wiring in the service worker: one call, setupCapture(), from background.ts.
// Handles the capture port, offscreen events, tab events, the upload drain alarm, webRequest
// and the capture-only requests (replay, mic grant, ring). The session, the countdown, the
// in-page UI and the keyboard commands belong to ext-ui (lib/bg/ui.ts): this module installs
// the capture service as ext-ui's CaptureDriver, and as the editor's capture bridge for the
// streams kept locally until create (lib/bg/drafts.ts). Other request types are left to the
// other areas' listeners (this listener returns false for them).
import { browser, type Browser } from 'wxt/browser';
import { isOffscreenEvent, CAPTURE_PORT, type BgRequest, type BgRequestType, type BgError, type Draft } from '@toolbar/shared/ext';
import { STORAGE } from '@toolbar/shared/ext';
import { TEST_HOOKS } from '../flags';
import { CaptureError, CaptureService } from '../capture/service';
import { HttpError } from '../upload/client';
import { uploadDraftStreams } from '../upload/draft';
import { getAuth, serverUrl } from '../capture/store';
import { BgFailure, dispatch, getSession, requestStop, setCaptureDriver, type CaptureDriver, type DraftHandle } from './ui';
import { setCaptureBridge } from './drafts';

/** CaptureError and HTTP failures as ext-ui's BgFailure (its handlers read `code`). */
function asBgFailure(e: unknown): BgFailure {
  if (e instanceof BgFailure) return e;
  if (e instanceof CaptureError) return new BgFailure(e.code, e.message);
  if (e instanceof HttpError) return new BgFailure(e.status === 401 ? 'not_signed_in' : e.status === 0 ? 'network' : 'server', e.message);
  return new BgFailure('server', e instanceof Error ? e.message : String(e));
}

async function wrap<T>(p: () => Promise<T>): Promise<T> {
  try {
    return await p();
  } catch (e) {
    throw asBgFailure(e);
  }
}

const handleOf = (d: Draft): DraftHandle => ({ draftId: d.id, kind: d.kind, recordingId: d.recordingId, tabId: d.tabId });

function driverFor(svc: CaptureService): CaptureDriver {
  return {
    prepareRecording: (o) => wrap(() => svc.prepareFor(o)),
    startRecording: (o) => wrap(async () => ({ mic: await svc.startFor(o) })),
    cancelRecording: (id) => wrap(() => svc.cancelFor(id)),
    stopRecording: (o) => wrap(async () => handleOf(await svc.stopFor(o.recordingId))),
    pauseRecording: () => wrap(() => svc.pauseRecording()),
    resumeRecording: () => wrap(() => svc.resumeRecording()),
    setMic: (_id, o) => wrap(() => svc.setMic(o.muted, o.deviceId)),
    mark: (_id, kind, label) => wrap(() => svc.mark(kind, label)),
    takeScreenshot: (o) => wrap(async () => handleOf(await svc.takeScreenshot(o.rect, { tabId: o.tabId, openEditor: false }))),
    triggerReplay: (o) => wrap(async () => handleOf(await svc.triggerReplay(o.tabId, { openEditor: false }))),
  };
}

type Handler = (msg: BgRequest, sender: Browser.runtime.MessageSender) => Promise<Record<string, unknown>>;

export function setupCapture(): CaptureService {
  const svc = new CaptureService({
    external: true,
    sessionSource: getSession,
    onMediaEnded: () => void requestStop().catch(() => undefined),
  });
  setCaptureDriver(driverFor(svc));
  setCaptureBridge({
    async uploadStreams(draft, recordingId) {
      const a = await getAuth();
      if (!a?.token) throw new BgFailure('not_signed_in', 'Sign in to create captures');
      const base = a.serverUrl || (await serverUrl());
      await wrap(() => uploadDraftStreams(draft, recordingId, { serverUrl: base, token: a.token }));
    },
    // the editor let go of the draft: the session leaves `draft` (J-035, J-219)
    async draftClosed(draftId, how) {
      const s = await getSession();
      if (!('draftId' in s) || s.draftId !== draftId) return;
      if (how === 'discarded') await dispatch({ type: 'DISCARD' });
      else if (how === 'saved') await dispatch({ type: 'SAVE_FOR_LATER' });
      else {
        await dispatch({ type: 'CREATE', recordingId: ('recordingId' in s && s.recordingId) || draftId });
        await dispatch({ type: 'UPLOAD_DONE' });
      }
    },
    // a draft reopened from the Drafts list holds the session again while its editor is open
    async draftOpened(d) {
      if ((await getSession()).state !== 'idle') return false;
      const next = await dispatch({ type: 'DRAFT_READY', draftId: d.id, kind: d.kind, recordingId: d.recordingId, tabId: d.tabId });
      return next.state === 'draft';
    },
  });
  svc.startWebRequest();
  svc.startTimers();

  browser.runtime.onConnect.addListener((port) => {
    if (port.name === CAPTURE_PORT) svc.onConnect(port);
  });

  const tabOf = (sender: Browser.runtime.MessageSender, tabId?: number) => tabId ?? sender.tab?.id;
  const handlers: Partial<Record<BgRequestType, Handler>> = {
    'replay.trigger': async (m, sender) => {
      const msg = m as Extract<BgRequest, { type: 'replay.trigger' }>;
      if ((await getSession()).state !== 'idle') throw new CaptureError('busy', 'Finish the open capture first');
      const d = await svc.triggerReplay(tabOf(sender, msg.tabId), { openEditor: false });
      // the session owner opens the editor on the draft (lib/bg/ui.ts)
      await dispatch({ type: 'DRAFT_READY', draftId: d.id, kind: d.kind, recordingId: d.recordingId, tabId: d.tabId });
      return { draftId: d.id };
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
    'session.dismiss': async () => {
      const s = await getSession();
      return { session: s.state === 'error' ? await dispatch({ type: 'CANCEL' }) : s };
    },
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

  // keyboard commands: lib/bg/ui.ts (ext-ui) routes them through the driver
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
