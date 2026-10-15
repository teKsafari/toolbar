import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AREAS,
  ERROR_STATUS,
  ROUTE_LIST,
  ROUTES,
  routeListed,
  buildPath,
  matchPath,
  pathParams,
  finalizeCaptureBodySchema,
  createCommentBodySchema,
  networkQuerySchema,
  connectIntegrationBodySchema,
  listCapturesQuerySchema,
  parseCaptureRef,
  seatRoleOf,
  roleAtLeast,
  DEFAULT_USER_SETTINGS,
  userSettingsSchema,
  type RouteDef,
} from '../src/api/index.ts';
import { API_PREFIX, uuidv7 } from '../src/index.ts';

const routes = ROUTE_LIST as readonly RouteDef[];
const PAGE_PATHS = ['/s/', '/rl/', '/ext/connect', '/mcp', '/api/health', '/.well-known/'];

describe('route table', () => {
  it('has unique names and unique method + path pairs', () => {
    expect(new Set(routes.map((r) => r.name)).size).toBe(routes.length);
    expect(new Set(routes.map((r) => `${r.method} ${r.path}`)).size).toBe(routes.length);
  });

  it('keeps API routes under the prefix and pages on known paths', () => {
    for (const r of routes) {
      const ok = r.path.startsWith(`${API_PREFIX}/`) || PAGE_PATHS.some((p) => r.path.startsWith(p));
      expect(ok, r.name).toBe(true);
    }
  });

  it('declares a params schema key for every :param, and no others', () => {
    for (const r of routes) {
      const declared = r.params instanceof z.ZodObject ? Object.keys(r.params.shape).sort() : [];
      expect(declared, r.name).toEqual(pathParams(r.path).sort());
    }
  });

  it('uses known areas and error codes', () => {
    for (const r of routes) {
      expect(AREAS, r.name).toContain(r.area);
      for (const e of r.errors) expect(Object.keys(ERROR_STATUS), `${r.name} ${e}`).toContain(e);
      expect(r.summary.length, r.name).toBeGreaterThan(5);
    }
  });

  it('keeps the reference product out of route summaries, which /settings/api shows', () => {
    const named = ROUTE_LIST.filter((r) => /\bjam\b/i.test(r.summary)).map((r) => r.name);
    expect(named).toEqual([]);
  });

  it('exposes routes by name', () => {
    expect(ROUTES['captures.finalize'].path).toBe('/api/v1/recordings/:id/finalize');
    expect(ROUTES['captures.create'].status).toBe(201);
  });

  it('builds and matches paths', () => {
    const id = uuidv7();
    const p = buildPath(ROUTES['captures.putChunk'].path, { id, stream: 'events', seq: 3 });
    expect(p).toBe(`/api/v1/recordings/${id}/streams/events/chunks/3`);
    expect(matchPath(ROUTES['captures.putChunk'].path, p)).toEqual({ id, stream: 'events', seq: '3' });
    expect(matchPath('/s/:token.md', '/s/abcdefghijklmnopqrstuv.md')).toEqual({ token: 'abcdefghijklmnopqrstuv' });
    expect(() => buildPath('/a/:id')).toThrow();
  });
});

describe('contract schemas', () => {
  it('fills finalize defaults on top of the older DTO', () => {
    const f = finalizeCaptureBodySchema.parse({});
    expect(f.destination).toEqual({ type: 'link' });
    expect(f.attachmentAssetIds).toEqual([]);
    expect(finalizeCaptureBodySchema.safeParse({ trim: { startMs: 5, endMs: 2 } }).success).toBe(false);
  });

  it('needs text or an image in a comment', () => {
    expect(createCommentBodySchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(createCommentBodySchema.safeParse({ body: '', attachmentAssetIds: [uuidv7()] }).success).toBe(true);
  });

  it('parses comma lists and booleans in queries', () => {
    const q = networkQuerySchema.parse({ status: '4xx,5xx', methods: ['get', 'post'], errorsOnly: 'true' });
    expect(q.status).toEqual(['4xx', '5xx']);
    expect(q.methods).toEqual(['GET', 'POST']);
    expect(q.errorsOnly).toBe(true);
    expect(q.bodies).toBe('errors');
    expect(listCapturesQuerySchema.parse({}).folderId).toBe('all');
  });

  it('validates integrations by type', () => {
    expect(connectIntegrationBodySchema.parse({ type: 'github', token: 'ghp_0123456789' })).toHaveProperty('baseUrl', 'https://api.github.com');
    expect(connectIntegrationBodySchema.safeParse({ type: 'slack', token: 'x' }).success).toBe(false);
  });

  it('finds a capture id in a pasted URL', () => {
    const id = uuidv7();
    expect(parseCaptureRef(`http://localhost:3000/c/${id}?t=5`)).toBe(id);
    expect(parseCaptureRef('nothing here')).toBeNull();
  });

  it('maps stored roles to seats', () => {
    expect(seatRoleOf('owner')).toBe('admin');
    expect(seatRoleOf('member')).toBe('creator');
    expect(seatRoleOf('viewer')).toBe('viewer');
    expect(roleAtLeast('creator', 'viewer')).toBe(true);
    expect(roleAtLeast('viewer', 'creator')).toBe(false);
  });

  it('has valid default settings', () => {
    expect(userSettingsSchema.parse(DEFAULT_USER_SETTINGS)).toEqual(DEFAULT_USER_SETTINGS);
  });
});

describe('paused routes (docs/scope.md)', () => {
  const off = { email: false, trackers: false, slack: false, cli: false, ai: false, adminExtras: false };
  const listed = (flags: typeof off) => new Set<string>(ROUTE_LIST.filter((r) => routeListed(r, flags)).map((r) => r.name));

  it('hides ai-draft, the audit log, integrations and send to app while every flag is off', () => {
    const names = listed(off);
    for (const n of ['captures.aiDraft', 'workspaces.audit', 'integrations.list', 'integrations.connect', 'integrations.send', 'integrations.linkedIssues']) expect(names.has(n), n).toBe(false);
    for (const n of ['captures.list', 'webhooks.create', 'folders.updateShare', 'agent.captureBrief']) expect(names.has(n), n).toBe(true);
  });

  it('lists each paused route once its flag is on', () => {
    expect(listed({ ...off, ai: true }).has('captures.aiDraft')).toBe(true);
    expect(listed({ ...off, adminExtras: true }).has('workspaces.audit')).toBe(true);
    expect(listed({ ...off, slack: true }).has('integrations.send')).toBe(true);
    expect(listed({ ...off, trackers: true }).has('integrations.options')).toBe(true);
  });

  it('claims no mail where mail is paused', () => {
    const mailClaims = ROUTE_LIST.filter((r) => /\b(sends mail|emails? the|Mailpit)\b/i.test(r.summary)).map((r) => r.name);
    expect(mailClaims).toEqual([]);
  });
});

