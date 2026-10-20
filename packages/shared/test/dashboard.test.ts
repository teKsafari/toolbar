import { describe, expect, it } from 'vitest';
import {
  durationLabel,
  fallbackTitle,
  filtersFromParams,
  filtersToParams,
  kindsOf,
  onboardingSteps,
  parseIssueRefs,
  refOfUrl,
  relativeTime,
} from '../src/areas/dashboard.ts';
import { ROUTES } from '../src/api/index.ts';

describe('dashboard helpers', () => {
  it('J-169, D-170: the setup steps point at webhooks while trackers are paused', () => {
    const off = onboardingSteps({ trackers: false });
    expect(off.map((s) => s.href)).toEqual(['/settings/browsers', '/', '/settings/members', '/settings/webhooks']);
    expect(off.at(-1)!.label).toBe('Add a webhook');
    expect(onboardingSteps({ trackers: true }).at(-1)).toEqual({ id: 'integration', label: 'Connect an app', href: '/settings/integrations' });
  });

  it('J-160: filters survive a round trip through the URL', () => {
    const id = '019a0000-0000-7000-8000-000000000001';
    const p = filtersToParams({ types: ['video', 'screenshot'], sources: ['upload'], authors: [id], link: null }, new URLSearchParams('x=1'));
    expect(p.toString()).toBe(`x=1&type=video%2Cscreenshot&source=upload&by=${encodeURIComponent(id)}`);
    expect(filtersFromParams(p)).toEqual({ types: ['video', 'screenshot'], sources: ['upload'], authors: [id], link: null });
    // unknown values are dropped, "me" resolves to the caller
    expect(filtersFromParams(new URLSearchParams('type=nope,replay&source=fin&by=me'), id)).toEqual({ types: ['replay'], sources: [], authors: [id], link: null });
  });

  it('J-160: the video type covers tab, screen and link recordings', () => {
    expect(kindsOf(['video'])).toEqual(['video', 'screen', 'link']);
    expect(kindsOf([])).toEqual([]);
  });

  it('J-241: issue references in text', () => {
    const refs = parseIssueRefs('Broken since https://github.com/acme/shop/issues/12 and see acme/api#7, also https://gitlab.com/g/sub/proj/-/issues/3 (acme/shop#12 again)');
    expect(refs.map((r) => [r.tracker, r.key])).toEqual([
      ['github', 'acme/shop#12'],
      ['gitlab', 'g/sub/proj#3'],
      ['other', 'acme/api#7'],
    ]);
    expect(parseIssueRefs('no refs here, just a #hash and a/b')).toEqual([]);
    expect(refOfUrl('https://github.com/acme/shop/issues/5')).toEqual({ url: 'https://github.com/acme/shop/issues/5', tracker: 'github', key: 'acme/shop#5' });
    expect(refOfUrl('https://tracker.example.com/browse/BUG-42')).toMatchObject({ tracker: 'tracker.example.com', key: '#42' });
  });

  it('J-158: card labels', () => {
    const now = Date.parse('2026-10-14T12:00:00Z');
    expect(relativeTime('2026-10-14T11:59:50Z', now)).toBe('just now');
    expect(relativeTime('2026-10-14T11:55:00Z', now)).toBe('5 min ago');
    expect(relativeTime('2026-10-14T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-10-11T12:00:00Z', now)).toBe('3 d ago');
    expect(durationLabel(65_000)).toBe('1:05');
    expect(durationLabel(null)).toBeNull();
    expect(fallbackTitle({ title: '', authorName: 'Dana Reviewer', kind: 'screenshot' })).toBe("Dana's screenshot");
    expect(fallbackTitle({ title: '', authorName: null, kind: 'link', recordingLinkName: 'Support' })).toBe("A guest's recording");
    expect(fallbackTitle({ title: '', authorName: 'Ola Owner', kind: 'feedback', authorVerified: false })).toBe("A reviewer's feedback");
    expect(fallbackTitle({ title: 'Kept', authorName: null, kind: 'video' })).toBe('Kept');
  });

  it('dashboard routes are in the table and owned by the dashboard area', () => {
    expect(ROUTES['captures.uploadVideo'].path).toBe('/api/v1/recordings/upload');
    expect(ROUTES['dashboard.onboarding'].area).toBe('dashboard');
  });
});
