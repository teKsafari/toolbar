// Seed a user, a workspace and three realistic captures so the viewer, dashboard and agent
// areas can build before capture lands. Idempotent: it deletes its own rows (fixed ids) first.
//
//   pnpm --filter @toolbar/server db:seed            # uses DATABASE_URL, S3_*, S3_KEY_PREFIX
//   pnpm --filter @toolbar/server db:seed --no-media # rows only, skip S3 uploads
//
// The schema must exist first (db:migrate, or db:push in an area database). Refuses to run on a
// non-localhost PUBLIC_URL, because it creates a known password and a known personal token.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import { STREAM_CONTENT_TYPES, TOKEN_PREFIX, base64url, type CaptureEvent } from '@toolbar/shared';
import { db, sqlClient } from '../src/lib/server/db/index.ts';
import * as t from '../src/lib/server/db/schema/index.ts';
import { env } from '../src/lib/server/env.ts';
import { keys, putObject } from '../src/lib/server/s3.ts';
import { seal } from '../src/lib/server/crypto.ts';
import { hashToken } from '../src/lib/server/tokens.ts';
import { commentedEvents, FIXTURE_T0, LAB, screenshotEvents, sortEvents, tabVideoEvents } from '../fixtures/events.ts';

const args = new Set(process.argv.slice(2));
const withMedia = !args.has('--no-media');

if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.publicUrl)) {
  console.error(`[seed] refusing to seed ${env.publicUrl}: the seed creates a known password and token (dev only)`);
  process.exit(1);
}

/** Fixed ids (UUIDv7 layout) so re-runs replace the same rows and URLs stay stable. */
const u = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const SEED = {
  password: 'nib-dev-password',
  users: {
    dana: { id: u(0x1), name: 'Dana Reviewer', email: 'dana@nib.test' },
    sam: { id: u(0x2), name: 'Sam Developer', email: 'sam@nib.test' },
  },
  workspace: { id: u(0xa1), name: 'Lab shop', slug: 'lab-shop' },
  folder: { id: u(0xf1), name: 'Checkout bugs' },
  captures: { video: u(0xc1), screenshot: u(0xc2), commented: u(0xc3) },
  recordingLink: u(0x91),
} as const;

const seedToken = (label: string, bytes = 16) =>
  base64url(createHash('sha256').update(`nib-seed:${label}`).digest().subarray(0, bytes));
const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
const at = (ms: number) => new Date(FIXTURE_T0 + ms);

async function main() {
  const exists = await db.execute<{ r: string | null }>(sql`select to_regclass('public.recording')::text as r`);
  if (!exists[0]?.r) {
    console.error('[seed] no schema here. Run `pnpm --filter @toolbar/server db:migrate` (or db:push) first.');
    process.exit(1);
  }

  const { dana, sam } = SEED.users;
  const ws = SEED.workspace;
  const capIds = Object.values(SEED.captures);

  // ---------- clean up earlier seed rows ----------
  await db.delete(t.recording).where(or(inArray(t.recording.id, capIds), inArray(t.recording.clientId, capIds.map(clientIdOf))));
  await db.delete(t.recordingLink).where(eq(t.recordingLink.id, SEED.recordingLink));
  await db.delete(t.organization).where(or(eq(t.organization.id, ws.id), eq(t.organization.slug, ws.slug)));
  await db.delete(t.user).where(or(inArray(t.user.id, [dana.id, sam.id]), inArray(t.user.email, [dana.email, sam.email])));

  // ---------- people and workspace ----------
  const hashed = await hashPassword(SEED.password);
  for (const p of [dana, sam]) {
    await db.insert(t.user).values({ id: p.id, name: p.name, email: p.email, emailVerified: true, createdAt: at(-86_400_000) });
    await db.insert(t.account).values({ accountId: p.id, providerId: 'credential', userId: p.id, password: hashed });
  }
  await db.insert(t.organization).values({ id: ws.id, name: ws.name, slug: ws.slug, createdAt: at(-86_400_000) });
  await db.insert(t.member).values([
    { organizationId: ws.id, userId: dana.id, role: 'owner' },
    { organizationId: ws.id, userId: sam.id, role: 'creator' },
  ]);
  await db.insert(t.folder).values({ id: SEED.folder.id, organizationId: ws.id, name: SEED.folder.name, createdBy: dana.id, createdAt: at(-3_600_000) });

  const pat = `${TOKEN_PREFIX.personal}seed_${seedToken('pat')}`;
  await db.insert(t.apiToken).values({ userId: dana.id, kind: 'personal', name: 'Seed token (dev only)', tokenHash: hashToken(pat) });

  const rlToken = seedToken('recording-link');
  await db.insert(t.recordingLink).values({
    id: SEED.recordingLink,
    organizationId: ws.id,
    folderId: SEED.folder.id,
    name: 'Support inbox',
    tokenHash: hashToken(rlToken),
    tokenEnc: seal(rlToken, 'recording-link-token'),
    createdBy: dana.id,
  });

  const author = (p: { id: string; name: string; email: string }) => ({
    authorUserId: p.id,
    authorName: p.name,
    authorEmail: p.email,
    authorIssuer: env.publicUrl,
    authorSubject: p.id,
  });

  // ---------- capture 1: tab video with console, network, user events, device info ----------
  const v = SEED.captures.video;
  const videoEvents = sortEvents(tabVideoEvents());
  await insertCapture({
    id: v,
    kind: 'video',
    title: 'Submit order does nothing',
    description: 'Clicked Submit order on the checkout page. The button spins and stops, no message. Sync never finishes either.',
    pageUrl: `${LAB}/checkout`,
    pageTitle: 'Checkout - Lab shop',
    startedAt: at(0),
    durationMs: 8000,
    events: videoEvents,
    video: true,
    thumb: 'tab-video.thumb.webp',
    createdAt: at(10_000),
    ...author(dana),
  });

  // ---------- capture 2: area screenshot with annotations ----------
  const s = SEED.captures.screenshot;
  await insertCapture({
    id: s,
    kind: 'screenshot',
    title: 'Submit order button: no feedback',
    description: 'Area shot of the checkout buttons. The order request failed with a 500 just before.',
    pageUrl: `${LAB}/checkout`,
    pageTitle: 'Checkout - Lab shop',
    startedAt: at(3_600_000),
    durationMs: null,
    events: sortEvents(screenshotEvents()),
    video: false,
    thumb: 'screenshot.thumb.webp',
    folderId: SEED.folder.id,
    createdAt: at(3_601_000),
    ...author(dana),
  });
  const cropId = u(0xe1);
  const fullId = u(0xe2);
  await db.insert(t.asset).values([
    { id: cropId, recordingId: s, kind: 'crop', s3Key: keys.asset(s, cropId), contentType: 'image/png', width: 720, height: 300, bytes: fixture('screenshot.png').length },
    { id: fullId, recordingId: s, kind: 'screenshot', s3Key: keys.asset(s, fullId), contentType: 'image/png', width: 1280, height: 720, bytes: fixture('screenshot-full.png').length },
  ]);
  await db.insert(t.annotation).values({
    recordingId: s,
    assetId: cropId,
    t: FIXTURE_T0 + 3_600_000,
    // Shapes in crop pixel coordinates (the editor area owns the final shape format).
    shapes: [
      { id: 's1', type: 'rect', x: 238, y: 40, w: 252, h: 68, color: 'marker', stroke: 5, radius: 10 },
      { id: 's2', type: 'arrow', from: { x: 600, y: 230 }, to: { x: 500, y: 110 }, bend: 0, color: 'red', stroke: 5 },
      { id: 's3', type: 'text', x: 520, y: 220, w: 192, h: 50, text: 'Nothing happens', color: 'red' },
    ],
    target: {
      selector: 'button[data-testid="submit-order"]',
      tag: 'button',
      role: 'button',
      name: 'Submit order',
      text: 'Submit order',
      testId: 'submit-order',
      rect: { x: 288, y: 170, w: 232, h: 48 },
      landmarks: ['main'],
      heading: 'Checkout',
    },
    comment: 'Nothing happens',
    authorUserId: dana.id,
  });

  // ---------- capture 3: video with a comment thread ----------
  const c = SEED.captures.commented;
  await insertCapture({
    id: c,
    kind: 'video',
    title: 'Details form rejects valid input',
    description: 'Filled the form and pressed Send. It returned 403 and showed nothing. A refresh error appears a second later.',
    pageUrl: `${LAB}/form`,
    pageTitle: 'Form - Lab shop',
    startedAt: at(7_200_000),
    durationMs: 8000,
    events: sortEvents(commentedEvents()),
    video: true,
    thumb: 'tab-video.thumb.webp',
    createdAt: at(7_210_000),
    ...author(sam),
  });
  const c1 = u(0xb1);
  await db.insert(t.comment).values([
    {
      id: c1,
      recordingId: c,
      authorUserId: dana.id,
      body: 'The form action returns 403 "CSRF check failed" here. Is the token lost after the SSE reconnect?',
      tMs: 3180,
      createdAt: at(7_300_000),
    },
    {
      recordingId: c,
      parentId: c1,
      authorUserId: sam.id,
      body: 'Looks like it. The hidden input is rendered before the session refresh. I will move it into the load function.',
      createdAt: at(7_360_000),
    },
    {
      recordingId: c,
      authorUserId: null,
      authorName: 'Visitor',
      body: 'Same thing happens for me in Firefox.',
      createdAt: at(7_400_000),
    },
    {
      recordingId: c,
      authorUserId: dana.id,
      body: `@[${sam.name}](user:${sam.id}) the unhandled rejection at this point says the refresh token expired.`,
      tMs: 4500,
      createdAt: at(7_420_000),
      editedAt: at(7_430_000),
    },
  ]);
  await db.insert(t.transcript).values({
    recordingId: c,
    stream: 'voice',
    provider: 'fixture',
    model: 'none',
    language: 'en',
    status: 'done',
    vtt: 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nI fill in the name and press send.\n\n00:00:03.200 --> 00:00:05.500\nNothing happens, and the console shows a warning.\n',
  });

  // ---------- share links ----------
  const shares: Record<string, string> = {};
  for (const id of capIds) {
    const token = seedToken(`share:${id}`);
    shares[id] = token;
    await db.insert(t.shareLink).values({ recordingId: id, tokenHash: hashToken(token), tokenEnc: seal(token, 'share-token'), access: 'anyone', createdBy: dana.id });
  }

  // ---------- media ----------
  if (withMedia) {
    const put = async (key: string, body: Uint8Array | string, type: string) => {
      try {
        await putObject(key, body, type);
      } catch (e) {
        console.error(`[seed] S3 upload of ${key} failed (${(e as Error).message}). Is Garage up? Re-run with --no-media to skip media.`);
        process.exit(1);
      }
    };
    const eventsOf: Record<string, CaptureEvent[]> = { [v]: videoEvents, [s]: sortEvents(screenshotEvents()), [c]: sortEvents(commentedEvents()) };
    for (const id of capIds) await put(keys.final(id, 'events.json.gz'), gzipSync(JSON.stringify(eventsOf[id])), 'application/gzip');
    for (const id of [v, c]) {
      await put(keys.final(id, 'video.webm'), fixture('tab-video.webm'), 'video/webm');
      await put(keys.final(id, 'thumb.webp'), fixture('tab-video.thumb.webp'), 'image/webp');
    }
    await put(keys.final(s, 'thumb.webp'), fixture('screenshot.thumb.webp'), 'image/webp');
    await put(keys.asset(s, cropId), fixture('screenshot.png'), 'image/png');
    await put(keys.asset(s, fullId), fixture('screenshot-full.png'), 'image/png');
  }

  // ---------- report ----------
  const base = env.publicUrl;
  console.log(`[seed] done${withMedia ? '' : ' (no media)'}${env.s3.keyPrefix ? `, S3 prefix ${env.s3.keyPrefix}` : ''}`);
  console.log(`  sign in:    ${dana.email} or ${sam.email}, password ${SEED.password}`);
  console.log(`  workspace:  ${ws.name} (${ws.id}), folder "${SEED.folder.name}" (${SEED.folder.id})`);
  console.log(`  token:      ${pat}   (personal, dev only)`);
  console.log(`  rec. link:  ${base}/rl/${rlToken}`);
  for (const [name, id] of Object.entries(SEED.captures)) console.log(`  ${name.padEnd(11)} ${base}/c/${id}   share ${base}/s/${shares[id]}`);

  async function insertCapture(r: {
    id: string;
    kind: 'video' | 'screenshot';
    title: string;
    description: string;
    pageUrl: string;
    pageTitle: string;
    startedAt: Date;
    durationMs: number | null;
    events: CaptureEvent[];
    video: boolean;
    thumb: string;
    folderId?: string;
    createdAt: Date;
    authorUserId: string;
    authorName: string;
    authorEmail: string;
    authorIssuer: string;
    authorSubject: string;
  }) {
    const env0 = r.events.find((e) => e.kind === 'env')?.data ?? null;
    await db.insert(t.recording).values({
      id: r.id,
      clientId: clientIdOf(r.id),
      organizationId: ws.id,
      folderId: r.folderId ?? null,
      kind: r.kind,
      status: 'ready',
      title: r.title,
      description: r.description,
      pageUrl: r.pageUrl,
      pageTitle: r.pageTitle,
      startedAt: r.startedAt,
      durationMs: r.durationMs,
      env: env0,
      authorUserId: r.authorUserId,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
      authorIssuer: r.authorIssuer,
      authorSubject: r.authorSubject,
      thumbKey: keys.final(r.id, 'thumb.webp'),
      createdAt: r.createdAt,
      updatedAt: r.createdAt,
    });
    const ndjsonBytes = r.events.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
    const streams: (typeof t.recordingStream.$inferInsert)[] = [
      { recordingId: r.id, name: 'events', contentType: STREAM_CONTENT_TYPES.events, lastSeq: 0, totalBytes: ndjsonBytes, completedAt: r.createdAt, finalKey: keys.final(r.id, 'events.json.gz') },
    ];
    if (r.video)
      streams.push({ recordingId: r.id, name: 'video', contentType: STREAM_CONTENT_TYPES.video, lastSeq: 7, totalBytes: fixture('tab-video.webm').length, completedAt: r.createdAt, finalKey: keys.final(r.id, 'video.webm') });
    await db.insert(t.recordingStream).values(streams);
  }
}

/** Client ids differ from server ids but are just as fixed. */
function clientIdOf(id: string) {
  return id.replace(/^019a0000/, '019a0001');
}

try {
  await main();
} finally {
  await sqlClient.end();
}
