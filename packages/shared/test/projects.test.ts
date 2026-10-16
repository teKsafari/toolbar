import { describe, expect, it } from 'vitest';
import {
  allOrigins,
  allowlistMatches,
  autoProjectOf,
  bestOriginFor,
  bodyAllowed,
  mergeOrigins,
  originSpecificity,
  pageOrigin,
  SITE_ACCESS_MODES,
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

describe('matching precedence (D-200)', () => {
  // listed oldest first, as the server and the bootstrap list them: the wildcard project is older
  const projects = [
    { id: 'domain', origins: ['https://*.nuru.sh'] },
    { id: 'apps', origins: ['https://*.apps.nuru.sh'] },
    { id: 'staging', origins: ['https://staging.nuru.sh'] },
    { id: 'local-any', origins: ['http://localhost'] },
    { id: 'local-5173', origins: ['http://localhost:5173'] },
  ];

  it('an exact origin wins over an older wildcard domain', () => {
    expect(projectForUrl(projects, 'https://staging.nuru.sh/login')?.id).toBe('staging');
  });
  it('the most specific wildcard wins among wildcards', () => {
    expect(projectForUrl(projects, 'https://x.apps.nuru.sh/')?.id).toBe('apps');
    expect(projectForUrl(projects, 'https://116.nuru.sh/')?.id).toBe('domain');
  });
  it('a wildcard covers the bare domain, over https only', () => {
    expect(projectForUrl(projects, 'https://nuru.sh/')?.id).toBe('domain');
    expect(projectForUrl(projects, 'http://nuru.sh/')).toBeNull();
    expect(projectForUrl([...projects, { id: 'plain', origins: ['http://*.nuru.sh'] }], 'http://staging.nuru.sh/')?.id).toBe('plain');
  });
  it('an origin with a port wins over the same host without one', () => {
    expect(projectForUrl(projects, 'http://localhost:5173/')?.id).toBe('local-5173');
    expect(projectForUrl(projects, 'http://localhost:5174/')?.id).toBe('local-any');
  });
  it('a tie goes to the earlier project', () => {
    expect(projectForUrl([{ id: 'one', origins: ['https://a.test'] }, { id: 'two', origins: ['https://a.test'] }], 'https://a.test/')?.id).toBe('one');
  });
  it('ranks origins', () => {
    expect(originSpecificity('http://localhost:5173')).toBeGreaterThan(originSpecificity('http://localhost'));
    expect(originSpecificity('http://localhost')).toBeGreaterThan(originSpecificity('https://*.a.very.long.domain.example.com'));
    expect(originSpecificity('https://*.a.nuru.sh')).toBeGreaterThan(originSpecificity('https://*.nuru.sh'));
    expect(originSpecificity('nonsense')).toBe(0);
    expect(bestOriginFor(['https://*.nuru.sh', 'https://staging.nuru.sh'], 'https://staging.nuru.sh/x')?.origin).toBe('https://staging.nuru.sh');
    expect(bestOriginFor(['https://*.nuru.sh'], 'https://evil.test/')).toBeNull();
  });
});

describe('automatic projects and merging (D-200)', () => {
  it('names a project after the host and lists the exact origin', () => {
    expect(autoProjectOf('http://localhost:5173/form?x=1')).toEqual({ name: 'localhost:5173', origins: ['http://localhost:5173'] });
    expect(autoProjectOf('http://127.0.0.1:5173/')).toEqual({ name: '127.0.0.1:5173', origins: ['http://127.0.0.1:5173'] });
    expect(autoProjectOf('https://Staging.Nuru.sh:443/a')).toEqual({ name: 'staging.nuru.sh', origins: ['https://staging.nuru.sh'] });
    expect(autoProjectOf('chrome://extensions')).toBeNull();
    expect(autoProjectOf('file:///tmp/x.html')).toBeNull();
    expect(autoProjectOf(null)).toBeNull();
  });
  it('reads the page origin of http(s) URLs only', () => {
    expect(pageOrigin('https://a.test:8443/x')).toBe('https://a.test:8443');
    expect(pageOrigin('data:text/html,hi')).toBeNull();
    expect(pageOrigin('not a url')).toBeNull();
    expect(pageOrigin('https://*.nuru.sh')).toBeNull();
  });
  it('merges origins: the first project keeps its order, the second adds what is new', () => {
    expect(mergeOrigins(['http://localhost:5173'], ['http://127.0.0.1:5173', 'http://localhost:5173'])).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173']);
    expect(mergeOrigins(['https://nuru.sh'], ['https://*.nuru.sh'])).toEqual(['https://nuru.sh', 'https://*.nuru.sh']);
  });
  it('refuses a merge past the origin limit', () => {
    const many = (p: string) => Array.from({ length: 30 }, (_, i) => `https://${p}${i}.test`);
    expect(() => mergeOrigins(many('a'), many('b'))).toThrow(RangeError);
  });
  it('lists the modes', () => {
    expect(SITE_ACCESS_MODES).toEqual(['all', 'projects']);
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
