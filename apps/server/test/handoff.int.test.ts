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
import { assembleFolder } from '../src/lib/server/handoff/assemble.ts';
import { sql } from 'drizzle-orm';
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

  it('reviewer toolbar pins become annotations, and resolving some pins leaves the capture open', async () => {
    // the reviewer-ui work package owns this table; create it here when this tree does not have it
    await db.execute(sql`create table if not exists feedback_item (
      id uuid primary key default uuidv7(), recording_id uuid not null, client_id uuid not null, n integer not null, kind text not null,
      comment text not null default '', quote text, target jsonb, anchor jsonb, shapes jsonb not null default '[]'::jsonb, crop_asset_id uuid,
      crop_rect jsonb, voice_asset_id uuid, voice_duration_ms integer, transcript_status text, transcript_vtt text, transcript_text text,
      transcript_language text, transcript_error text, context jsonb, page jsonb not null, intent text not null default 'fix',
      severity text not null default 'important', status text not null default 'pending', t bigint not null, author_user_id uuid,
      author_name text, author_email text, author_issuer text, author_subject text, created_at timestamptz not null default now())`);
    const page = JSON.stringify({ url: 'https://app.test/lessons/1', title: 'Lesson 1', viewport: { w: 800, h: 600 }, scroll: { x: 0, y: 0 }, dpr: 1 });
    const target = JSON.stringify({ selector: 'button#run', tag: 'button', name: 'Run', rect: { x: 10, y: 20, w: 60, h: 30 } });
    await db.execute(sql`insert into feedback_item (recording_id, client_id, n, kind, comment, quote, target, page, t, severity, author_name, context)
      values (${ids.rec}, ${crypto.randomUUID()}, 1, 'element', 'Run does nothing', null, ${target}::jsonb, ${page}::jsonb, ${Date.now()}, 'blocking', 'Dana', ${JSON.stringify({ windowMs: 60000, errors: [{ t: 1, kind: 'error', text: 'TypeError' }], failedRequests: [] })}::jsonb),
             (${ids.rec}, ${crypto.randomUUID()}, 2, 'text', 'Typo here', 'Andka', null, ${page}::jsonb, ${Date.now() + 1000}, 'suggestion', 'Dana', null)`);
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.id, ids.rec));
    const data = await collectFolder(db, rec!);
    expect(data.annotations.map((a) => a.item?.n)).toEqual([1, 2]);
    const none = async () => {
      throw new Error('no io');
    };
    const f = await assembleFolder(data, { bytes: none, toCss: none, flatten: none, crop: none, size: none, ocr: async () => null, ocrAvailable: async () => false });
    const paths = f.files.map((x) => x.path);
    expect(paths).toEqual(expect.arrayContaining(['annotations/a01.locator.json', 'annotations/a01.shapes.json', 'annotations/a02.locator.json']));
    expect(JSON.parse(String(f.files.find((x) => x.path === 'annotations/a01.locator.json')!.data)).selector).toBe('button#run');
    expect(f.readme).toContain('captured source="element pin 1 = a01 (fix, blocking, pending; 1 error and 0 failed requests in the 60 s before, in feedback.json)" author="Dana"');
    expect(f.readme).toMatch(/captured source="highlighted text of a02" author="page"[^\n]*\nAndka\n/);
    const fb = JSON.parse(String(f.files.find((x) => x.path === 'feedback.json')!.data));
    expect(fb.annotations[0]).toMatchObject({ pin: 1, kind: 'element', severity: 'blocking', status: 'pending' });

    await reopenFeedback(db, ids.rec);
    const some = await resolveFeedback(db, rec!, ids.dana, { note: 'Run fixed', items: [1] }, 'API');
    expect(some).toMatchObject({ resolved: false, itemsResolved: [1], itemsOpen: 1 });
    const rest = await resolveFeedback(db, rec!, ids.dana, { note: 'Typo fixed', items: [2] }, 'API');
    expect(rest).toMatchObject({ resolved: true, itemsResolved: [2], itemsOpen: 0, note: 'Typo fixed' });
    expect((await resolutionOf(db, ids.rec)).itemsOpen).toBe(0);
  });
});
