// Dashboard area pure parts: webhook signatures (J-142, D-030), the filed issue body (J-242),
// search snippets (J-161), settings merge (J-136).
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { DEFAULT_USER_SETTINGS } from '@toolbar/shared/api';
import { sign, verify, RETRY_DELAYS_S, MAX_ATTEMPTS } from '../src/lib/server/webhooks/index.ts';
import { issueMarkdown, signalsOf, slackText, envLines } from '../src/lib/server/integrations/issue-body.ts';
import { snippet } from '../src/lib/server/search/index.ts';
import { mergeSettings } from '../src/lib/server/dashboard/core.ts';

const ev = (seq: number, kind: string, data: unknown) => ({ v: 1, id: `top:${seq}`, ctx: 'top', seq, t: 1000 + seq, kind, data }) as unknown as CaptureEvent;

describe('webhook signatures (J-142)', () => {
  it('signs t.body with HMAC-SHA256 and verifies within five minutes', () => {
    const body = JSON.stringify({ a: 1 });
    const h = sign('whsec_x', body, 1_800_000_000);
    expect(h).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verify('whsec_x', body, h, 300, 1_800_000_100)).toBe(true);
    expect(verify('whsec_y', body, h, 300, 1_800_000_100)).toBe(false);
    expect(verify('whsec_x', body + ' ', h, 300, 1_800_000_100)).toBe(false);
    expect(verify('whsec_x', body, h, 300, 1_800_001_000)).toBe(false);
  });
  it('retries back off over about a day', () => {
    expect(MAX_ATTEMPTS).toBe(RETRY_DELAYS_S.length + 1);
    const total = RETRY_DELAYS_S.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(18 * 3600);
    expect(total).toBeLessThan(30 * 3600);
  });
});

describe('issue body (J-242)', () => {
  const events = [
    ev(1, 'console', { level: 'error', args: ['Order failed', { name: 'TypeError', message: 'x is undefined' }] }),
    ev(2, 'console', { level: 'error', args: ['Order failed', { name: 'TypeError', message: 'x is undefined' }] }),
    ev(3, 'error', { type: 'error', name: 'TypeError', message: 'Cannot read properties of undefined' }),
    ev(4, 'net.req', { rid: 'r1', method: 'POST', url: 'http://localhost:5173/api/orders', source: 'page' }),
    ev(5, 'net.res', { rid: 'r1', status: 500 }),
    ev(6, 'net.req', { rid: 'r2', method: 'GET', url: 'http://localhost:5173/api/ok', source: 'page' }),
    ev(7, 'net.res', { rid: 'r2', status: 200 }),
    ev(8, 'net.req', { rid: 'r3', method: 'GET', url: 'http://localhost:5173/slow', source: 'page' }),
    ev(9, 'net.fail', { rid: 'r3', error: 'net::ERR_TIMED_OUT' }),
  ];
  const env = {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/141',
    browser: { name: 'Chrome', version: '141' },
    os: { name: 'Linux' },
    viewport: { w: 1440, h: 900 },
    dpr: 2,
    locale: 'en-GB',
    tz: 'Africa/Nairobi',
    connection: { effectiveType: '4g', downlink: 10 },
  };
  it('collects console errors (counted) and failing requests', () => {
    const s = signalsOf(events);
    expect(s.consoleErrors).toEqual([
      { message: 'Order failed TypeError: x is undefined', count: 2 },
      { message: 'TypeError: Cannot read properties of undefined', count: 1 },
    ]);
    expect(s.failedRequests).toEqual([
      { method: 'POST', url: 'http://localhost:5173/api/orders', status: 500, error: null },
      { method: 'GET', url: 'http://localhost:5173/slow', status: null, error: 'net::ERR_TIMED_OUT' },
    ]);
  });
  it('holds title context, URL, time, device, OS, browser, viewport, speed and the link', () => {
    const md = issueMarkdown(
      { id: 'c1', title: 'Submit order does nothing', description: 'Clicked submit twice.', pageUrl: 'http://localhost:5173/checkout', createdAt: new Date('2026-10-14T10:00:00Z'), env, authorName: 'Dana' },
      signalsOf(events),
      'http://localhost:3106/c/c1',
    );
    for (const want of ['Clicked submit twice.', 'http://localhost:3106/c/c1', '| URL | http://localhost:5173/checkout |', '2026-10-14 10:00:00 UTC', '| Browser | Chrome 141 |', '| OS | Linux |', '| Device | Desktop |', '| Viewport | 1440 x 900 @2x |', 'en-GB, Africa/Nairobi', '| Network speed | 4g, 10 Mbps |', '### Console errors', '(x2)', '### Failing requests', '`POST http://localhost:5173/api/orders` 500', 'net::ERR_TIMED_OUT'])
      expect(md).toContain(want);
    expect(envLines(null)).toEqual([]);
    const t = slackText({ id: 'c1', title: 'T', description: '', pageUrl: null, createdAt: new Date(), env: null, authorName: null }, signalsOf(events), 'http://x/c/c1', 'please look');
    expect(t).toContain('<http://x/c/c1|T>');
    expect(t).toContain('please look');
    expect(t).toContain('Console errors: 2');
  });
});

describe('search and settings helpers', () => {
  it('snippets centre on the hit', () => {
    expect(snippet('a'.repeat(100) + 'needle' + 'b'.repeat(100), 'NEEDLE', 5)).toBe('...aaaaaneedlebbbbb...');
    expect(snippet('short text', 'missing')).toBe('short text');
  });
  it('merges stored settings over defaults key by key', () => {
    const m = mergeSettings({ notifications: { firstView: false, bogus: 1 }, editor: 'nope' });
    expect(m.notifications.firstView).toBe(false);
    expect(m.notifications.sharedWithMe).toBe(true);
    expect((m.notifications as Record<string, unknown>).bogus).toBeUndefined();
    expect(m.editor).toEqual(DEFAULT_USER_SETTINGS.editor);
  });
});
