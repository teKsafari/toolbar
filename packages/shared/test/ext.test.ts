import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPLAY,
  IDLE,
  STORAGE,
  elapsedMs,
  popupActions,
  transition,
  recordingKindOf,
  isOffscreenRequest,
  type CaptureSession,
} from '../src/ext/index.ts';

const run = (s: CaptureSession, ...events: Parameters<typeof transition>[1][]) => events.reduce(transition, s);

describe('capture session state machine', () => {
  it('runs a tab recording from countdown to upload', () => {
    let s = run(IDLE, { type: 'START_RECORDING', tabId: 1, mode: 'tab', recordingId: 'r1', now: 0 });
    expect(s.state).toBe('countdown');
    s = run(s, { type: 'COUNTDOWN_DONE' }, { type: 'MEDIA_STARTED', recordingId: 'r1', now: 3000, mic: 'off' });
    expect(s.state).toBe('recording');
    s = run(s, { type: 'PAUSE', now: 5000 }, { type: 'RESUME', now: 10_000 });
    expect(elapsedMs(s, 13_000)).toBe(5000);
    s = run(s, { type: 'STOP', now: 13_000 });
    expect(s.state).toBe('stopping');
    s = run(s, { type: 'DRAFT_READY', draftId: 'd1', kind: 'video', recordingId: 'r1', tabId: 1 });
    expect(popupActions(s, DEFAULT_REPLAY)).toEqual(['link', 'open-drafts']);
    s = run(s, { type: 'CREATE', recordingId: 'r1' }, { type: 'UPLOAD_DONE' });
    expect(s).toBe(IDLE);
  });

  it('skips the countdown for screen and desktop, and drops a cancelled picker', () => {
    const s = run(IDLE, { type: 'START_RECORDING', tabId: 1, mode: 'desktop', recordingId: 'r2', now: 0 });
    expect(s.state).toBe('starting');
    expect(run(s, { type: 'PICKER_CANCELLED' })).toBe(IDLE);
  });

  it('follows tab switches only in desktop mode', () => {
    const start = (mode: 'tab' | 'desktop') =>
      run(IDLE, { type: 'START_RECORDING', tabId: 1, mode, recordingId: 'r', now: 0 }, { type: 'COUNTDOWN_DONE' }, { type: 'MEDIA_STARTED', recordingId: 'r', now: 0, mic: 'on' });
    const d = run(start('desktop'), { type: 'TAB_ACTIVATED', tabId: 2 });
    expect(d.state === 'recording' && d.tabs).toEqual([1, 2]);
    const t = start('tab');
    expect(run(t, { type: 'TAB_ACTIVATED', tabId: 2 })).toBe(t);
  });

  it('toggles screenshot mode and ignores events that do not apply', () => {
    const armed = run(IDLE, { type: 'ARM_SCREENSHOT', tabId: 1, delaySec: 0, now: 0 });
    expect(popupActions(armed, DEFAULT_REPLAY)).toEqual(['exit-screenshot']);
    expect(run(armed, { type: 'ARM_SCREENSHOT', tabId: 1, delaySec: 0, now: 1 })).toBe(IDLE);
    expect(run(armed, { type: 'SHOT_TAKEN', draftId: 'd' }).state).toBe('draft');
    expect(transition(IDLE, { type: 'STOP', now: 0 })).toBe(IDLE);
  });

  it('keeps the draft id on failure', () => {
    const draft = run(IDLE, { type: 'DRAFT_READY', draftId: 'd9', kind: 'replay', recordingId: null, tabId: 4 });
    const e = run(draft, { type: 'FAIL', error: 'network', message: 'offline' });
    expect(e).toMatchObject({ state: 'error', draftId: 'd9', tabId: 4 });
  });

  it('lists the replay row only when replay is on', () => {
    expect(popupActions(IDLE, DEFAULT_REPLAY)).not.toContain('replay');
    expect(popupActions(IDLE, { ...DEFAULT_REPLAY, enabled: true })).toContain('replay');
    expect(recordingKindOf('screen')).toBe('screen');
  });
});

describe('storage and message helpers', () => {
  it('uses unique storage keys', () => {
    const keys = Object.values(STORAGE).map((s) => `${s.area}:${s.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('recognises offscreen requests', () => {
    expect(isOffscreenRequest({ to: 'offscreen', type: 'ping' })).toBe(true);
    expect(isOffscreenRequest({ type: 'ping' })).toBe(false);
  });
});
