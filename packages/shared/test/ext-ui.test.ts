import { describe, expect, it } from 'vitest';
import {
  CAP_DANGER_MS,
  CAP_WARN_MS,
  DEFAULT_REPLAY_BLOCKED_SITES,
  LIVE_PEN_COLORS,
  SCREENSHOT_DELAYS,
  capStage,
  chordLabel,
  clampToViewport,
  formatTimer,
  hostMatches,
  isReplayBlocked,
  isRestrictedUrl,
  normalizeDomain,
  rectFromPoints,
  relativeAge,
} from '../src/areas/ext-ui.ts';
import { extensionSettingsSchema } from '../src/api/account.ts';

describe('ext-ui helpers', () => {
  it('formats the bar timer as m:ss and h:mm:ss', () => {
    expect(formatTimer(0)).toBe('0:00');
    expect(formatTimer(9_999)).toBe('0:09');
    expect(formatTimer(65_000)).toBe('1:05');
    expect(formatTimer(3_726_000)).toBe('1:02:06');
    expect(formatTimer(-5)).toBe('0:00');
  });

  it('turns the timer orange then red before the cap (J-013)', () => {
    const cap = 60_000;
    expect(capStage(10_000, null)).toBe('none');
    expect(capStage(10_000, cap)).toBe('normal');
    expect(capStage(cap - CAP_WARN_MS, cap)).toBe('warn');
    expect(capStage(cap - CAP_DANGER_MS, cap)).toBe('danger');
    expect(capStage(cap + 1, cap)).toBe('danger');
  });

  it('knows restricted pages (J-199)', () => {
    for (const u of ['chrome://extensions', 'chrome-extension://abc/popup.html', 'about:blank', 'https://chromewebstore.google.com/detail/x', 'view-source:https://a.com', 'edge://settings', undefined, '', 'not a url'])
      expect(isRestrictedUrl(u), String(u)).toBe(true);
    for (const u of ['http://localhost:5173/', 'https://example.com/a?b', 'file:///tmp/x.html']) expect(isRestrictedUrl(u), u).toBe(false);
  });

  it('normalises domains for the blocked-sites list (J-012)', () => {
    expect(normalizeDomain('https://www.Example-Bank.com/login')).toBe('example-bank.com');
    expect(normalizeDomain(' paypal.com ')).toBe('paypal.com');
    expect(normalizeDomain('localhost')).toBe('localhost');
    expect(normalizeDomain('not a domain')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
  });

  it('blocks replay on listed domains and their subdomains (J-012)', () => {
    expect(hostMatches('www.paypal.com', 'paypal.com')).toBe(true);
    expect(hostMatches('notpaypal.com', 'paypal.com')).toBe(false);
    expect(isReplayBlocked('https://secure.chase.com/x', DEFAULT_REPLAY_BLOCKED_SITES)).toBe(true);
    expect(isReplayBlocked('http://localhost:5173/', DEFAULT_REPLAY_BLOCKED_SITES)).toBe(false);
    expect(DEFAULT_REPLAY_BLOCKED_SITES.length).toBeGreaterThan(50);
    expect(new Set(DEFAULT_REPLAY_BLOCKED_SITES).size).toBe(DEFAULT_REPLAY_BLOCKED_SITES.length);
    for (const d of DEFAULT_REPLAY_BLOCKED_SITES) expect(normalizeDomain(d), d).toBe(d);
  });

  it('builds drag rectangles in either direction, clamped to the viewport (J-003)', () => {
    const vp = { w: 800, h: 600 };
    expect(rectFromPoints({ x: 400, y: 350 }, { x: 100, y: 150 }, vp)).toEqual({ x: 100, y: 150, w: 300, h: 200 });
    expect(rectFromPoints({ x: -20, y: 10 }, { x: 900, y: 700 }, vp)).toEqual({ x: 0, y: 10, w: 800, h: 590 });
  });

  it('keeps a dragged bar inside the viewport (J-238)', () => {
    const size = { w: 295, h: 40 };
    const vp = { w: 1280, h: 720 };
    expect(clampToViewport({ x: -50, y: -50 }, size, vp)).toEqual({ x: 8, y: 8 });
    expect(clampToViewport({ x: 2000, y: 2000 }, size, vp)).toEqual({ x: 1280 - 295 - 8, y: 720 - 40 - 8 });
    expect(clampToViewport({ x: 400, y: 300 }, size, vp)).toEqual({ x: 400, y: 300 });
  });

  it('writes relative ages for the Drafts list (J-218)', () => {
    const now = 10_000_000;
    expect(relativeAge(now - 5_000, now)).toBe('just now');
    expect(relativeAge(now - 120_000, now)).toBe('2 min ago');
    expect(relativeAge(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(relativeAge(now - 50 * 3600_000, now)).toBe('2 d ago');
  });

  it('labels chords and the pen palette', () => {
    expect(chordLabel('Ctrl+Shift+S')).toBe('Ctrl+Shift+S');
    expect(chordLabel('')).toBeNull();
    expect(chordLabel('⇧⌘S')).toBe('Shift+Cmd+S');
    expect(LIVE_PEN_COLORS).toHaveLength(12);
    expect(LIVE_PEN_COLORS[0]).toBe('#e0402f');
  });

  it('every popup delay is a valid stored setting (J-005)', () => {
    for (const d of SCREENSHOT_DELAYS) expect(extensionSettingsSchema.shape.screenshotDelaySec.safeParse(d).success).toBe(true);
  });
});
