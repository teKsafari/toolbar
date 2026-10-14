// Integration test against the compose Postgres. Skips when it is not reachable.
// Creates a throwaway database, applies the migrations, and runs the job queue.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../src/lib/server/db/schema.ts';
import { claim, complete, enqueue, fail } from '../src/lib/server/jobs/queue.ts';
import type { Db } from '../src/lib/server/db/index.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_test_${process.pid}`;
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

describe.skipIf(!reachable)('database (integration)', () => {
  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
  });

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('creates every core table', async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = new Set(rows.map((r) => r.table_name));
    for (const t of [
      'user', 'session', 'account', 'verification', 'organization', 'member', 'invitation', 'folder', 'recording',
      'recording_stream', 'recording_chunk', 'asset', 'annotation', 'comment', 'transcript', 'share_link',
      'recording_link', 'api_token', 'ext_auth_code', 'integration', 'webhook', 'notification', 'job',
    ])
      expect(names, t).toContain(t);
  });

  it('defaults ids to uuidv7', async () => {
    const [u] = await db.insert(schema.user).values({ name: 'a', email: 'a@x.test' }).returning();
    expect(u!.id[14]).toBe('7');
  });

  it('claims each job once, retries with backoff, completes', async () => {
    const id = await enqueue(db, 'thumbnail', { n: 1 });
    const [a, b] = await Promise.all([claim(db, 'w1', 'thumbnail', 5), claim(db, 'w2', 'thumbnail', 5)]);
    expect([...a, ...b].map((j) => j.id)).toEqual([id]);
    const j = [...a, ...b][0]!;
    await fail(db, j.id, j.attempts, 'boom');
    expect(await claim(db, 'w1', 'thumbnail')).toEqual([]); // backoff pushed run_at into the future
    await db.execute(sql`update job set run_at = now() where id = ${id}`);
    const [again] = await claim(db, 'w1', 'thumbnail');
    expect(again!.attempts).toBe(2);
    await complete(db, id);
    expect(await claim(db, 'w1', 'thumbnail')).toEqual([]);
  });
});
