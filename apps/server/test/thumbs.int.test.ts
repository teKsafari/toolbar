// Card images for every capture kind (D-184) against a throwaway Postgres database and the S3
// bucket (skips when either is not reachable): the backfill job gives ready captures without a
// thumbnail one, from a still the extension sent when there is one and the placeholder card
// otherwise; the startup check enqueues it once.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNull } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import * as schema from '../src/lib/server/db/schema/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { getBytes, keys, putObjectWith } from '../src/lib/server/s3.ts';
import { placeholderSvg, wrap } from '../src/lib/server/media/placeholder.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_thumbstest_${process.pid}`;
let admin: postgres.Sql | null = null;
let client: postgres.Sql | null = null;
let db: Db;

const reachable = await (async () => {
  try {
    const s = postgres(base, { max: 1, connect_timeout: 2, onnotice: () => {} });
    await s`select 1`;
    await s.end();
    await putObjectWith(keys.final('probe', 'probe.txt'), 'ok', { contentType: 'text/plain' });
    return true;
  } catch {
    return false;
  }
})();

describe('placeholder card', () => {
  it('names the kind, the page title, the host and the path, escaped', () => {
    const svg = placeholderSvg({ kind: 'replay', pageUrl: 'https://lab.test:5173/lessons/42?token=x', pageTitle: 'Loops & <conditions>', title: 'ignored', durationMs: 65_000 });
    expect(svg).toContain('DOM replay · 1:05');
    expect(svg).toContain('Loops &amp; &lt;conditions&gt;');
    expect(svg).toContain('lab.test:5173');
    expect(svg).toContain('/lessons/42?…');
    expect(svg).not.toContain('token=x');
  });

  it('wraps long titles to two lines with an ellipsis', () => {
    expect(wrap('one two three four five six seven', 10, 2)).toEqual(['one two', 'three fou…']);
    expect(wrap('short', 10, 2)).toEqual(['short']);
  });
});

describe.skipIf(!reachable)('thumbnails for every kind (integration)', () => {
  let handlers: typeof import('../src/lib/server/jobs/handlers.ts');
  let org: string;

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'ignore' });
    const [o] = await db.insert(schema.organization).values({ name: 'Thumb shop', slug: `thumbs-${process.pid}` }).returning();
    org = o!.id;
    handlers = await import('../src/lib/server/jobs/handlers.ts');
    handlers.useDb(db);
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  const mk = async (kind: 'replay' | 'trace' | 'feedback', over: Partial<typeof schema.recording.$inferInsert> = {}) =>
    (
      await db
        .insert(schema.recording)
        .values({ clientId: crypto.randomUUID(), organizationId: org, kind, status: 'ready', title: '', pageUrl: 'https://app.test/lessons/1', pageTitle: 'Lesson 1', finalizedAt: new Date(), ...over })
        .returning()
    )[0]!;

  it('the startup check enqueues one backfill; the job uses a sent still, else the placeholder', async () => {
    // a DOM replay that sent a still (an 800x500 PNG), an embed trace without one, a deleted one
    const withStill = await mk('replay');
    const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#3366cc' } }).png().toBuffer();
    const [a] = await db.insert(schema.asset).values({ recordingId: withStill.id, kind: 'thumb', s3Key: '', contentType: 'image/png', bytes: png.byteLength, width: 800, height: 500 }).returning();
    const key = keys.asset(withStill.id, a!.id);
    await putObjectWith(key, png, { contentType: 'image/png' });
    await db.update(schema.asset).set({ s3Key: key }).where(eq(schema.asset.id, a!.id));
    const bare = await mk('trace', { source: 'embed', pageTitle: 'Checkout' });
    const gone = await mk('replay', { deletedAt: new Date() });

    await handlers.ensureRecurringJobs(db);
    await handlers.ensureRecurringJobs(db);
    const pending = await db.select().from(schema.job).where(and(eq(schema.job.type, 'backfill-thumbs'), isNull(schema.job.doneAt)));
    expect(pending).toHaveLength(1);

    await handlers._internal.backfillThumbs({});
    const rows = Object.fromEntries((await db.select().from(schema.recording)).map((r) => [r.id, r]));
    expect(rows[withStill.id]!.thumbKey).toBe(keys.final(withStill.id, 'thumb.webp'));
    expect(rows[bare.id]!.thumbKey).toBe(keys.final(bare.id, 'thumb.webp'));
    expect(rows[gone.id]!.thumbKey).toBeNull();

    const still = await sharp(Buffer.from(await getBytes(rows[withStill.id]!.thumbKey!))).metadata();
    expect(still).toMatchObject({ format: 'webp', width: 640, height: 400 });
    const stats = await sharp(Buffer.from(await getBytes(rows[withStill.id]!.thumbKey!))).stats();
    // the blue of the still, not the grey of the placeholder
    expect(stats.channels[2]!.mean).toBeGreaterThan(stats.channels[0]!.mean + 50);
    const card = await sharp(Buffer.from(await getBytes(rows[bare.id]!.thumbKey!))).metadata();
    expect(card).toMatchObject({ format: 'webp', width: 640, height: 400 });

    // nothing left: the startup check enqueues nothing more once the pending job is done
    await db.update(schema.job).set({ doneAt: new Date() }).where(eq(schema.job.type, 'backfill-thumbs'));
    await handlers.ensureRecurringJobs(db);
    expect(await db.select().from(schema.job).where(and(eq(schema.job.type, 'backfill-thumbs'), isNull(schema.job.doneAt)))).toHaveLength(0);
  }, 60_000);
});
