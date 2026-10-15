// Agent hand-off against a throwaway Postgres database (skips when Postgres is not reachable):
// resolving fires feedback.resolved to a signed webhook, share links default to 14 days, the
// share URL's markdown starts with the pull command, and the MCP folder tools refuse link holders.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { execFileSync } from 'node:child_process';
import * as schema from '../src/lib/server/db/schema/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { createApiToken } from '../src/lib/server/tokens.ts';
import { handleMcpPost } from '../src/lib/server/mcp/protocol.ts';
import { attempt, createHook, verify } from '../src/lib/server/webhooks/index.ts';
import { reopenFeedback, resolutionOf, resolveFeedback } from '../src/lib/server/handoff/resolve.ts';
import { collectFolder } from '../src/lib/server/handoff/folder.ts';
import { expiryOf, mintShareLink, primaryShareUrl } from '../src/lib/server/share/tokens.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_handofftest_${process.pid}`;
let admin: postgres.Sql | null = null;
let client: postgres.Sql | null = null;
let db: Db;

const reachable = await (async () => {
  try {
    const s = postgres(base, { max: 1, connect_timeout: 2, onnotice: () => {} });
    await s`select 1`;
    await s.end();
    return true;
  } catch {
    return false;
  }
})();

let ids: { org: string; dana: string; vic: string; rec: string };

async function tool(token: string, toolName: string, args: Record<string, unknown>) {
  const res = await handleMcpPost(
    db,
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }),
    }),
  );
  return ((await res.json()) as { result: { content: { type: string; text?: string }[]; isError?: boolean } }).result;
}

describe.skipIf(!reachable)('hand-off (integration)', () => {
  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore' });
    const [dana] = await db.insert(schema.user).values({ name: 'Dana', email: 'dana@handoff.test', emailVerified: true }).returning();
    const [vic] = await db.insert(schema.user).values({ name: 'Vic', email: 'vic@handoff.test', emailVerified: true }).returning();
    const [org] = await db.insert(schema.organization).values({ name: 'Hand-off shop', slug: `handoff-${process.pid}` }).returning();
    await db.insert(schema.member).values([{ organizationId: org!.id, userId: dana!.id, role: 'owner' }]);
    const [rec] = await db
      .insert(schema.recording)
      .values({ clientId: crypto.randomUUID(), organizationId: org!.id, kind: 'screenshot', status: 'ready', title: 'Run does nothing', pageUrl: 'https://app.test/lessons/1', authorUserId: dana!.id, authorName: 'Dana', authorEmail: 'dana@handoff.test', finalizedAt: new Date() })
      .returning();
    ids = { org: org!.id, dana: dana!.id, vic: vic!.id, rec: rec!.id };
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('resolving stores who, note and commit, and sends a signed feedback.resolved delivery', async () => {
    const seen: { headers: Record<string, unknown>; body: string }[] = [];
    const srv: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        seen.push({ headers: req.headers, body });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    try {
      const port = (srv.address() as AddressInfo).port;
      const hook = await createHook(db, ids.org, ids.dana, { url: `http://127.0.0.1:${port}/in`, events: ['feedback.resolved'] });
      const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.id, ids.rec));
      const r = await resolveFeedback(db, rec!, ids.dana, { note: 'Run handler swallowed a 500; now shows it', commit: 'abc1234' }, 'Claude Code');
      expect(r).toMatchObject({ resolved: true, note: 'Run handler swallowed a 500; now shows it', commit: 'abc1234', via: 'Claude Code', resolvedBy: { name: 'Dana' } });
      const [d] = await db.select().from(schema.webhookDelivery).where(eq(schema.webhookDelivery.webhookId, hook.webhook.id));
      expect(d!.event).toBe('feedback.resolved');
      await attempt(db, d!.id);
      const got = seen.at(-1)!;
      expect(verify(hook.secret, got.body, String(got.headers['x-toolbar-signature']))).toBe(true);
      const payload = JSON.parse(got.body);
      expect(payload).toMatchObject({ event: 'feedback.resolved', data: { capture: { id: ids.rec }, feedback: { resolution: { commit: 'abc1234', via: 'Claude Code' } } } });
      expect(payload.data.feedback.pullCommand).toMatch(new RegExp(`^curl .*/api/v1/recordings/${ids.rec}/folder" \\| tar xz$`));
      // the folder carries the resolution
      const data = await collectFolder(db, rec!);
      expect(data.resolution?.commit).toBe('abc1234');
      await reopenFeedback(db, ids.rec);
      expect((await resolutionOf(db, ids.rec)).resolved).toBe(false);
    } finally {
      srv.close();
    }
  });

  it('new share links expire after 14 days by default, and the default link is reused while live', async () => {
    const before = Date.now();
    const { row } = await mintShareLink(db, ids.rec, {});
    expect(row.expiresAt!.getTime() - before).toBeGreaterThanOrEqual(14 * 86_400_000 - 1000);
    expect(row.expiresAt!.getTime() - before).toBeLessThan(14 * 86_400_000 + 60_000);
    expect(expiryOf(0)).toBeNull();
    const a = await primaryShareUrl(db, { id: ids.rec, access: 'anyone' }, ids.dana);
    const b = await primaryShareUrl(db, { id: ids.rec, access: 'anyone' }, ids.dana);
    expect(a).toBe(b);
  });

  it('MCP: members get the folder and resolve; others are refused', async () => {
    const dana = await createApiToken(db, { userId: ids.dana, kind: 'personal', name: 'mcp', scopes: ['mcp:read', 'mcp:write'] });
    const folder = await tool(dana.secret, 'get_feedback_folder', { capture: ids.rec });
    expect(folder.isError).toBeFalsy();
    expect(folder.content[0]!.text).toMatch(/^# open-toolbar feedback /);
    const listing = JSON.parse(folder.content[1]!.text!);
    expect(listing.files.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(['README.md', 'feedback.json', 'spans.jsonl', 'console.jsonl', 'network.jsonl', 'raw/network.har']));
    const readme = await tool(dana.secret, 'get_feedback_file', { capture: ids.rec, path: `.feedback/${ids.rec}/feedback.json` });
    expect(JSON.parse(readme.content[0]!.text!).id).toBe(ids.rec);
    const res = await tool(dana.secret, 'resolve_feedback', { capture: ids.rec, note: 'fixed' });
    expect(JSON.parse(res.content[0]!.text!)).toMatchObject({ resolved: true, note: 'fixed' });

    const vic = await createApiToken(db, { userId: ids.vic, kind: 'personal', name: 'mcp', scopes: ['mcp:read'] });
    const { token } = await mintShareLink(db, ids.rec, {});
    const refused = await tool(vic.secret, 'get_feedback_folder', { capture: `http://localhost/s/${token}` });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/summary only|seat/);
  });
});
