// Bulk feedback export (D-182) against a throwaway Postgres database (skips when Postgres is not
// reachable): the archive streams (INDEX.md and the first folder arrive before the next folder is
// built), pages by limit and by the size cap with a cursor in the header and in INDEX.md, the
// filters pick the right captures, and the MCP tools list_feedback and get_feedback_index answer.
import { constants as zlibConstants, gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { execFileSync } from 'node:child_process';
import { feedbackFiltersSchema } from '@toolbar/shared/api';
import * as schema from '../src/lib/server/db/schema/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { createApiToken } from '../src/lib/server/tokens.ts';
import { handleMcpPost } from '../src/lib/server/mcp/protocol.ts';
import { feedbackArchive, feedbackIndex, feedbackList, selectPage, type ExportScope } from '../src/lib/server/handoff/export.ts';
import { untar } from '../src/lib/server/handoff/tar.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_exporttest_${process.pid}`;
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

let scope: ExportScope;
let ids: { org: string; dana: string; sam: string; folder: string; recs: string[] };
const filters = (q: Record<string, unknown> = {}) => feedbackFiltersSchema.parse(q);

/** Read a web stream to the end, gunzip and untar it. */
async function readAll(body: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  const r = body.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  return untar(gunzipSync(Buffer.concat(chunks)));
}

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

describe.skipIf(!reachable)('bulk feedback export (integration)', () => {
  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 6, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore' });
    const [dana] = await db.insert(schema.user).values({ name: 'Dana', email: 'dana@export.test', emailVerified: true }).returning();
    const [sam] = await db.insert(schema.user).values({ name: 'Sam', email: 'sam@export.test', emailVerified: true }).returning();
    const [org] = await db.insert(schema.organization).values({ name: 'Export shop', slug: `export-${process.pid}` }).returning();
    await db.insert(schema.member).values([
      { organizationId: org!.id, userId: dana!.id, role: 'owner' },
      { organizationId: org!.id, userId: sam!.id, role: 'member' },
    ]);
    const [folder] = await db.insert(schema.folder).values({ organizationId: org!.id, name: 'Lessons', createdBy: dana!.id }).returning();
    const specs = [
      { kind: 'trace', title: 'Run button does nothing on lesson 4', page: 'https://app.test/lessons/4', author: dana!, folder: folder!.id, bytes: 0 },
      { kind: 'replay', title: 'Progress spinner never stops', page: 'https://app.test/lessons/7', author: sam!, folder: folder!.id, bytes: 600_000 },
      { kind: 'screenshot', title: 'Quiz score shows NaN', page: 'https://app.test/quiz/3', author: sam!, folder: null, bytes: 600_000 },
      { kind: 'video', title: 'Lesson video stutters', page: 'https://app.test/lessons/9', author: dana!, folder: null, bytes: 600_000 },
      { kind: 'feedback', title: 'Run output is empty again', page: 'https://app.test/lessons/4', author: dana!, folder: folder!.id, bytes: 0 },
      { kind: 'trace', title: 'Fixed: login loop', page: 'https://app.test/login', author: sam!, folder: null, bytes: 0 },
    ] as const;
    const recs: string[] = [];
    for (const [i, s] of specs.entries()) {
      const [rec] = await db
        .insert(schema.recording)
        .values({
          clientId: crypto.randomUUID(),
          organizationId: org!.id,
          folderId: s.folder,
          kind: s.kind,
          status: 'ready',
          title: s.title,
          pageUrl: s.page,
          authorUserId: s.author.id,
          authorName: s.author.name,
          authorEmail: s.author.email,
          finalizedAt: new Date(),
          createdAt: new Date(Date.UTC(2026, 9, 10 + i, 12)),
        })
        .returning();
      recs.push(rec!.id);
      if (s.bytes) await db.insert(schema.recordingStream).values({ recordingId: rec!.id, name: 'rrweb', contentType: 'application/x-ndjson', totalBytes: s.bytes });
    }
    await db.insert(schema.comment).values({ recordingId: recs[0]!, authorUserId: sam!.id, body: 'The run output never shows; same on lesson 7.' });
    await db.insert(schema.feedbackResolution).values({ recordingId: recs[5]!, resolvedBy: sam!.id, resolvedByName: 'Sam', note: 'cookie path' });
    ids = { org: org!.id, dana: dana!.id, sam: sam!.id, folder: folder!.id, recs };
    scope = { userId: dana!.id, workspaceId: org!.id, seat: 'admin' };
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('streams INDEX.md and the first folder before the next folder is built', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const built: string[] = [];
    const a = await feedbackArchive(db, scope, filters({ limit: 3 }), {
      beforeFolder: async (id, i) => {
        if (i === 1) await gate;
        built.push(id);
      },
    });
    expect(a.page.recs).toHaveLength(3);
    // read until INDEX.md and folder 1's README.md have arrived, while folder 2 waits on the gate
    const chunks: Buffer[] = [];
    // a sync flush ends each folder, so the bytes so far inflate on their own
    const raw = () => gunzipSync(Buffer.concat(chunks), { finishFlush: zlibConstants.Z_SYNC_FLUSH });
    const reader = a.body.getReader();
    const first = a.page.recs[0]!.id;
    const seen = () => untar(raw()).map((e) => e.path);
    for (let n = 0; n < 50 && !seen().includes(`.feedback/${first}/README.md`); n++) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    expect(seen()[0]).toBe('.feedback/INDEX.md');
    expect(seen()).toContain(`.feedback/${first}/README.md`);
    expect(built).toEqual([first]);
    expect(seen().some((p) => p.startsWith(`.feedback/${a.page.recs[1]!.id}/`))).toBe(false);
    release();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    const all = untar(gunzipSync(Buffer.concat(chunks)));
    const paths = all.map((e) => e.path);
    for (const { id } of a.page.recs) expect(paths).toEqual(expect.arrayContaining([`.feedback/${id}/README.md`, `.feedback/${id}/feedback.json`, `.feedback/${id}/spans.jsonl`]));
    const index = all.find((e) => e.path === '.feedback/INDEX.md')!;
    expect(Buffer.from(index.data).toString()).toBe(a.index);
  });

  it('pages by limit with a cursor in the header value and in INDEX.md, and the next page writes INDEX-2.md', async () => {
    // unresolved by default: five of six
    const p1 = await feedbackArchive(db, scope, filters({ limit: 3 }));
    expect(p1.page).toMatchObject({ total: 5, page: 1, stoppedBy: 'limit' });
    expect(p1.page.nextCursor).toBeTruthy();
    expect(p1.index).toContain(`cursor \`${p1.page.nextCursor}\``);
    expect(p1.index).toContain('.feedback/INDEX-2.md');
    // newest first
    expect(p1.page.recs.map((r) => r.id)).toEqual([ids.recs[4], ids.recs[3], ids.recs[2]]);
    await readAll(p1.body);
    const p2 = await feedbackArchive(db, scope, filters({ limit: 3, cursor: p1.page.nextCursor! }));
    expect(p2.page).toMatchObject({ page: 2, nextCursor: null, stoppedBy: null });
    expect(p2.page.recs.map((r) => r.id)).toEqual([ids.recs[1], ids.recs[0]]);
    const files = await readAll(p2.body);
    expect(files[0]!.path).toBe('.feedback/INDEX-2.md');
    expect(Buffer.from(files[0]!.data).toString()).toMatch(/^# open-toolbar feedback index, page 2/);
    expect(Buffer.from(files[0]!.data).toString()).toContain('This is the last page');
  });

  it('ends a page at the size cap, always with one capture at least', async () => {
    const a = await selectPage(db, scope, filters({ status: 'all' }), { maxBytes: 1_000_000 });
    // newest first: login (0 B, resolved), Run output (0 B), lesson video (600 KB), then the quiz would pass 1 MB
    expect(a.recs.map((r) => r.id)).toEqual([ids.recs[5], ids.recs[4], ids.recs[3]]);
    expect(a.stoppedBy).toBe('size');
    const b = await selectPage(db, scope, filters({ status: 'all', cursor: a.nextCursor! }), { maxBytes: 100 });
    expect(b.recs.map((r) => r.id)).toEqual([ids.recs[2]]);
    expect(b.stoppedBy).toBe('size');
    const ix = await feedbackIndex(db, scope, filters({ status: 'all' }), { maxBytes: 1_000_000 });
    expect(ix.markdown).toContain('the size cap of about 1 MB');
  });

  it('filters by status, kind, folder, creator and dates', async () => {
    const list = async (q: Record<string, unknown>) => (await feedbackList(db, scope, filters(q))).items.map((i) => i.id);
    expect(await list({ status: 'resolved' })).toEqual([ids.recs[5]]);
    expect(await list({ status: 'all' })).toHaveLength(6);
    expect(await list({ kind: 'trace,feedback' })).toEqual([ids.recs[4], ids.recs[0]]);
    expect(await list({ folder: ids.folder })).toEqual([ids.recs[4], ids.recs[1], ids.recs[0]]);
    expect(await list({ folder: 'none' })).toEqual([ids.recs[3], ids.recs[2]]);
    expect(await list({ creator: 'sam@export.test' })).toEqual([ids.recs[2], ids.recs[1]]);
    expect(await list({ creator: 'me' })).toEqual([ids.recs[4], ids.recs[3], ids.recs[0]]);
    expect(await list({ since: '2026-10-11', until: '2026-10-13' })).toEqual([ids.recs[2], ids.recs[1]]);
    const out = await feedbackList(db, scope, filters({ limit: 2 }));
    expect(out).toMatchObject({ total: 5, returned: 2, hasMore: true, stoppedBy: 'limit' });
    expect(out.items[0]).toMatchObject({ id: ids.recs[4], dir: `.feedback/${ids.recs[4]}`, status: 'open', route: 'app.test/lessons/:id', summary: 'Run output is empty again' });
    expect(out.items[0]!.pullCommand).toMatch(/\/api\/v1\/recordings\/.+\/folder" \| tar xz$/);
    expect(out.pullCommand).toMatch(/\/api\/v1\/feedback\/export\?limit=2" \| tar xz$/);
  });

  it('MCP: list_feedback and get_feedback_index walk all feedback; a viewer sees only visible captures', async () => {
    const dana = await createApiToken(db, { userId: ids.dana, kind: 'personal', name: 'mcp', scopes: ['mcp:read'] });
    const l = await tool(dana.secret, 'list_feedback', { limit: 2 });
    expect(l.isError).toBeFalsy();
    const page = JSON.parse(l.content[0]!.text!);
    expect(page).toMatchObject({ total: 5, returned: 2, hasMore: true });
    const l2 = JSON.parse((await tool(dana.secret, 'list_feedback', { limit: 2, cursor: page.nextCursor })).content[0]!.text!);
    expect(l2.items.map((i: { id: string }) => i.id)).toEqual([ids.recs[2], ids.recs[1]]);
    const ix = await tool(dana.secret, 'get_feedback_index', { kinds: ['trace'], status: 'all' });
    expect(ix.isError).toBeFalsy();
    expect(ix.content[0]!.text).toMatch(/^# open-toolbar feedback index\n\n2 captures in this page \(1 open, 1 resolved\) of 2 matching/);
    expect(ix.content[0]!.text).toContain(`[${ids.recs[0]}](${ids.recs[0]}/README.md)`);
    expect(ix.content[0]!.text).toMatch(/recurring|Recurring words/);
    expect(JSON.parse(ix.content[1]!.text!)).toMatchObject({ captures: 2, total: 2, nextCursor: null });
    const bad = await tool(dana.secret, 'list_feedback', { since: 'yesterday' });
    expect(bad.isError).toBe(true);
    // a private capture of Dana's stays out of Sam's list
    await db.update(schema.recording).set({ private: true }).where(eq(schema.recording.id, ids.recs[3]!));
    const sam = await createApiToken(db, { userId: ids.sam, kind: 'personal', name: 'mcp', scopes: ['mcp:read'] });
    const ls = JSON.parse((await tool(sam.secret, 'list_feedback', {})).content[0]!.text!);
    expect(ls.items.map((i: { id: string }) => i.id)).not.toContain(ids.recs[3]);
    expect(ls.total).toBe(4);
  });
});
