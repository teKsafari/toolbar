import { describe, expect, it } from 'vitest';
import {
  allOrigins,
  allowlistMatches,
  bodyAllowed,
  bodyPolicyOf,
  matchPatternOf,
  normalizeAllowlistEntry,
  normalizeOrigin,
  originMatches,
  originOfPattern,
  projectForUrl,
} from '../src/projects.ts';
import { createRedactor, REDACTED } from '../src/redact.ts';
import type { CaptureEvent } from '../src/events.ts';

describe('normalizeOrigin', () => {
  it.each([
    ['https://App.Example.com/path?q=1', 'https://app.example.com'],
    ['app.example.com', 'https://app.example.com'],
    ['http://localhost:5173', 'http://localhost:5173'],
    ['http://localhost:80/', 'http://localhost'],
    ['https://example.com:443', 'https://example.com'],
    ['https://*.example.com', 'https://*.example.com'],
    ['http://127.0.0.1:3000', 'http://127.0.0.1:3000'],
  ])('%s', (input, out) => expect(normalizeOrigin(input)).toBe(out));

  it.each(['', 'ftp://x.test', 'https://*.com', 'https://a b.test', 'https://*', 'javascript:alert(1)', 'https://x.test:99999', 'https://-bad.test'])('refuses %s', (input) =>
    expect(normalizeOrigin(input)).toBeNull(),
  );

  it('round-trips through a match pattern', () => {
    expect(matchPatternOf('http://localhost:5173')).toBe('http://localhost:5173/*');
    expect(originOfPattern('http://localhost:5173/*')).toBe('http://localhost:5173');
  });
});

describe('originMatches', () => {
  it('needs the same scheme, host and port', () => {
    expect(originMatches('http://localhost:5173', 'http://localhost:5173/a/b?c')).toBe(true);
    expect(originMatches('http://localhost:5173', 'http://localhost:5174/')).toBe(false);
    expect(originMatches('https://app.test', 'http://app.test/')).toBe(false);
    expect(originMatches('https://app.test', 'https://evil-app.test/')).toBe(false);
    expect(originMatches('https://app.test', 'https://app.test.evil.test/')).toBe(false);
  });
  it('treats a missing port as any port, as Chrome does', () => {
    expect(originMatches('http://localhost', 'http://localhost:5173/')).toBe(true);
  });
  it('covers subdomains with a wildcard', () => {
    expect(originMatches('https://*.example.com', 'https://a.b.example.com/')).toBe(true);
    expect(originMatches('https://*.example.com', 'https://example.com/')).toBe(true);
    expect(originMatches('https://*.example.com', 'https://notexample.com/')).toBe(false);
  });
  it('refuses non-web URLs', () => {
    expect(originMatches('https://app.test', 'chrome://extensions')).toBe(false);
    expect(originMatches('https://app.test', 'not a url')).toBe(false);
  });
});

describe('projects', () => {
  const projects = [
    { id: 'a', origins: ['http://localhost:5173'] },
    { id: 'b', origins: ['https://*.nuru.test', 'https://nuru.test'] },
  ];
  it('finds the project of a URL', () => {
    expect(projectForUrl(projects, 'http://localhost:5173/x')?.id).toBe('a');
    expect(projectForUrl(projects, 'https://learn.nuru.test/')?.id).toBe('b');
    expect(projectForUrl(projects, 'http://localhost:5174/')).toBeNull();
    expect(projectForUrl(projects, null)).toBeNull();
  });
  it('lists every origin once', () => {
    expect(allOrigins([...projects, { id: 'c', origins: ['http://localhost:5173'] }])).toEqual(['http://localhost:5173', 'https://*.nuru.test', 'https://nuru.test']);
  });
});

describe('body policy', () => {
  const staging = bodyPolicyOf({ maskingPreset: 'staging', origins: ['http://localhost:5173', 'https://api.app.test'], bodyAllowlist: [] });
  const production = bodyPolicyOf({ maskingPreset: 'production', origins: ['https://app.test'], bodyAllowlist: ['https://app.test/api/public/*', 'https://app.test/health'] });

  it('staging keeps bodies of the page origin and the project origins', () => {
    expect(bodyAllowed(staging, '/api/items', 'http://localhost:5173/')).toBe(true);
    expect(bodyAllowed(staging, 'https://api.app.test/v1', 'http://localhost:5173/')).toBe(true);
    expect(bodyAllowed(staging, 'https://tracker.example/collect', 'http://localhost:5173/')).toBe(false);
  });
  it('production keeps bodies only for allowlisted URLs', () => {
    expect(bodyAllowed(production, '/api/items', 'https://app.test/')).toBe(false);
    expect(bodyAllowed(production, '/api/public/x/y', 'https://app.test/')).toBe(true);
    expect(bodyAllowed(production, 'https://app.test/health?x=1', 'https://app.test/')).toBe(true);
  });
  it('no project keeps everything', () => {
    expect(bodyAllowed(bodyPolicyOf(null), 'https://anything.test/', undefined)).toBe(true);
  });
  it('allowlist entries are prefixes with * wildcards', () => {
    expect(normalizeAllowlistEntry('https://app.test/api/*')).toBe('https://app.test/api/*');
    expect(normalizeAllowlistEntry('/relative')).toBeNull();
    expect(normalizeAllowlistEntry('https://a.test/x y')).toBeNull();
    expect(allowlistMatches('https://*.app.test/api/', 'https://eu.app.test/api/v1')).toBe(true);
    expect(allowlistMatches('https://app.test/api', 'https://app.test.evil/api')).toBe(false);
  });
});

describe('createRedactor', () => {
  const ev = <K extends CaptureEvent['kind']>(kind: K, data: unknown) => ({ v: 1, kind, t: 1, ctx: 'top-i', seq: 1, data }) as unknown as CaptureEvent;
  const page = 'https://app.test/dash';

  it('drops bodies outside the policy and marks why, request and response alike', () => {
    const r = createRedactor(() => bodyPolicyOf({ maskingPreset: 'staging', origins: ['https://app.test'], bodyAllowlist: [] }), () => page);
    const req = r(ev('net.req', { rid: '1', method: 'POST', url: 'https://third.test/collect', body: '{"a":1}', source: 'page' })) as Extract<CaptureEvent, { kind: 'net.req' }>;
    expect(req.data.body).toBeUndefined();
    expect(req.data.bodyOmitted).toBe('masking');
    const res = r(ev('net.res', { rid: '1', status: 200, body: '{"ok":true}' })) as Extract<CaptureEvent, { kind: 'net.res' }>;
    expect(res.data.body).toBeUndefined();
    expect(res.data.bodyOmitted).toBe('masking');
    const own = r(ev('net.req', { rid: '2', method: 'POST', url: '/api/login', headers: { Authorization: 'Bearer x', 'X-Csrf-Token': 'y' }, body: '{"password":"hunter2","email":"a@b.test"}', source: 'page' })) as Extract<CaptureEvent, { kind: 'net.req' }>;
    expect(own.data.bodyOmitted).toBeUndefined();
    expect(own.data.headers).toEqual({ Authorization: REDACTED, 'X-Csrf-Token': REDACTED });
    expect(JSON.parse(own.data.body!)).toEqual({ password: REDACTED, email: REDACTED });
  });

  it('decides WebSocket frames by the URL seen at open', () => {
    const r = createRedactor(() => bodyPolicyOf({ maskingPreset: 'production', origins: ['https://app.test'], bodyAllowlist: [] }), () => page);
    r(ev('ws', { sid: 's1', op: 'open', url: 'wss://app.test/socket' }));
    const frame = r(ev('ws', { sid: 's1', op: 'recv', data: 'secret stuff' })) as Extract<CaptureEvent, { kind: 'ws' }>;
    expect(frame.data.data).toBeUndefined();
    expect(frame.data.bodyOmitted).toBe('masking');
  });

  it('keeps Part 1 behavior without a project', () => {
    const r = createRedactor();
    const req = r(ev('net.req', { rid: '1', method: 'GET', url: 'https://x.test/', body: 'hello', source: 'page' })) as Extract<CaptureEvent, { kind: 'net.req' }>;
    expect(req.data.body).toBe('hello');
  });
});
