// Dashboard area against a throwaway Postgres database, Garage (S3_KEY_PREFIX) and Mailpit, with
// local HTTP servers standing in for a webhook receiver, the GitHub API and a Slack incoming
// webhook. Skips when Postgres is not reachable.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, isNull } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { listCapturesQuerySchema, searchQuerySchema, WEBHOOK_SIGNATURE_HEADER } from '@toolbar/shared/api';
import { uuidv7 } from '@toolbar/shared';
import * as schema from '../src/lib/server/db/schema/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { createWorkspace, patchSettings } from '../src/lib/server/auth/workspaces.ts';
import { aiAllowed, audit, emailAllowed, patchRawSettings, findFolder } from '../src/lib/server/dashboard/core.ts';
import { authorSnapshot, createCaptureRecord } from '../src/lib/server/upload/service.ts';
import { bulkDelete, bulkMove, changeable, listCaptures, uploadVideo } from '../src/lib/server/dashboard/captures.ts';
import { createFolder, deleteFolder, folderShare, listFolders, updateFolder, updateFolderShare } from '../src/lib/server/dashboard/folders.ts';
import { createLink, linkByToken, listLinks, recorderCreate, recorderInfo, toLinks, updateLink } from '../src/lib/server/dashboard/links.ts';
import { changeSeat, deleteAccount, deletionPlan, listAudit, listMembers, onboarding, removeMember, updateProfile, updateWorkspace } from '../src/lib/server/dashboard/workspace.ts';
import { autoDelete, sweepNotices } from '../src/lib/server/dashboard/notices.ts';
import { attempt, createHook, dispatch, listDeliveries, verify } from '../src/lib/server/webhooks/index.ts';
import { connect, destinationHandler, linkedIssuesOf, options, sendCapture, integrationById } from '../src/lib/server/integrations/index.ts';
import { recent, search } from '../src/lib/server/search/index.ts';
import { seatOf } from '../src/lib/server/share/access.ts';
import { ApiError } from '../src/lib/server/share/http.ts';
import { env } from '../src/lib/server/env.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
// these tests cover the paused mail code too (docs/scope.md, FEATURE_EMAIL)
process.env.FEATURE_EMAIL = '1';
process.env.SMTP_URL ||= 'smtp://localhost:1025'; // Mailpit (docker-compose.mail.yml)
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
// The paused mail (FEATURE_EMAIL) lands in Mailpit, which runs only with the override file
// docker-compose.mail.yml (D-116, D-171): the mail tests skip without it.
const mailpitUp = await fetch(`${MAILPIT}/api/v1/info`).then((r) => r.ok, () => false);
const itMail = it.skipIf(!mailpitUp);
const name = `toolbar_dashtest_${process.pid}`;
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

const run = Date.now().toString(36);
const mkUser = async (who: string) => {
  const [u] = await db.insert(schema.user).values({ name: who, email: `${who.toLowerCase().replace(/\s+/g, '.')}-${run}@dash${run}.test`, emailVerified: true }).returning();
  return u!;
};

type Rec = typeof schema.recording.$inferInsert;
async function mkCapture(o: Partial<Rec> & { organizationId: string }) {
  const at = o.createdAt ?? new Date();
  const [r] = await db
    .insert(schema.recording)
    .values({ clientId: uuidv7(), kind: 'video', status: 'ready', title: 'Capture', finalizedAt: at, createdAt: at, ...o })
    .returning();
  return r!;
}

const listQ = (q: Record<string, unknown>) => listCapturesQuerySchema.parse(q);
const fails = async (p: Promise<unknown>, code: string) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
};

async function listen(handler: (req: IncomingMessage, body: string) => { status: number; json?: unknown }) {
  const seen: { method: string; url: string; headers: IncomingMessage['headers']; body: string }[] = [];
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: b });
      const r = handler(req, b);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise<void>((r) => srv.close(() => r())) };
}

async function mailTo(to: string, subject: RegExp) {
  for (let i = 0; i < (to.includes('sam-maker') ? 8 : 40); i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((x) => x.json() as Promise<{ messages: { Subject: string }[] }>);
    const hit = (r.messages ?? []).find((m) => subject.test(m.Subject));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

describe.skipIf(!reachable)('dashboard (integration)', () => {
  let dana: typeof schema.user.$inferSelect;
  let sam: typeof schema.user.$inferSelect;
  let vera: typeof schema.user.$inferSelect;
  let ws: string;
  let ws2: string;
  const ctxOf = async (u: { id: string }, w = ws) => ({ userId: u.id, workspaceId: w, seat: (await seatOf(db, u.id, w))! });

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'ignore',
    });
    dana = await mkUser('Dana Owner');
    sam = await mkUser('Sam Maker');
    vera = await mkUser('Vera Viewer');
    ws = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Shop', domainJoin: false })).id;
    await db.insert(schema.member).values([
      { organizationId: ws, userId: sam.id, role: 'creator' },
      { organizationId: ws, userId: vera.id, role: 'viewer' },
    ]);
    ws2 = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Other', domainJoin: false })).id;
  }, 90_000);

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('J-162, J-163, J-164: folders get 4-character ids, list alphabetically, rename, and delete with their captures', async () => {
    const z = await createFolder(db, ws, dana.id, { name: 'zeta', private: false });
    const a = await createFolder(db, ws, sam.id, { name: 'Alpha', private: false });
    expect(z.shortId).toMatch(/^[a-z2-9]{4}$/);
    expect((await findFolder(db, a.shortId!))!.id).toBe(a.id);
    const inA = await mkCapture({ organizationId: ws, folderId: a.id, authorUserId: sam.id });
    const list = await listFolders(db, ws, await ctxOf(dana));
    expect(list.map((f) => f.name)).toEqual(['Alpha', 'zeta']);
    expect(list[0]!.captureCount).toBe(1);
    await updateFolder(db, a, { name: 'Alpha bugs' });
    expect((await findFolder(db, a.id))!.name).toBe('Alpha bugs');
    expect(await deleteFolder(db, (await findFolder(db, a.id))!, dana.id)).toBe(1);
    const [gone] = await db.select().from(schema.recording).where(eq(schema.recording.id, inA.id));
    expect(gone!.deletedAt).not.toBeNull();
    expect(await findFolder(db, a.id)).toBeNull();
    await deleteFolder(db, z, dana.id);
  });

  it('J-158, J-160, J-203: the grid leaves out foldered captures and filters by type, source, creator and link, with cursor paging', async () => {
    const w = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Grid', domainJoin: false })).id;
    await db.insert(schema.member).values({ organizationId: w, userId: sam.id, role: 'creator' });
    const f = await createFolder(db, w, dana.id, { name: 'F', private: false });
    const l = await createLink(db, w, dana.id, { name: 'Inbox' });
    const t0 = Date.now() - 60_000;
    const shot = await mkCapture({ organizationId: w, kind: 'screenshot', authorUserId: dana.id, createdAt: new Date(t0) });
    const vid = await mkCapture({ organizationId: w, kind: 'video', authorUserId: sam.id, createdAt: new Date(t0 + 1000) });
    const up = await mkCapture({ organizationId: w, kind: 'video', source: 'upload', authorUserId: sam.id, createdAt: new Date(t0 + 2000) });
    const viaLink = await mkCapture({ organizationId: w, kind: 'link', source: 'recording-link', recordingLinkId: l.id, createdAt: new Date(t0 + 3000) });
    await mkCapture({ organizationId: w, folderId: f.id, authorUserId: dana.id, createdAt: new Date(t0 + 4000) });
    await mkCapture({ organizationId: w, status: 'uploading', finalizedAt: null, authorUserId: dana.id }); // a draft: never listed
    const ctx = await ctxOf(dana, w);
    const main = await listCaptures(db, listQ({ folderId: 'none' }), ctx);
    expect(main.items.map((c) => c.id)).toEqual([viaLink.id, up.id, vid.id, shot.id]);
    expect(main.items[0]).toMatchObject({ recordingLinkName: 'Inbox', source: 'recording-link', author: null });
    expect((await listCaptures(db, listQ({ folderId: 'none', kinds: 'video,screen,link' }), ctx)).items.map((c) => c.id)).toEqual([viaLink.id, up.id, vid.id]);
    expect((await listCaptures(db, listQ({ folderId: 'none', sources: 'upload' }), ctx)).items.map((c) => c.id)).toEqual([up.id]);
    expect((await listCaptures(db, listQ({ folderId: 'none', authors: dana.id }), ctx)).items.map((c) => c.id)).toEqual([shot.id]);
    expect((await listCaptures(db, listQ({ recordingLinkId: l.id }), ctx)).items.map((c) => c.id)).toEqual([viaLink.id]);
    expect((await listCaptures(db, listQ({ folderId: f.id }), ctx)).total).toBe(1);
    const p1 = await listCaptures(db, listQ({ folderId: 'none', limit: 3 }), ctx);
    expect(p1).toMatchObject({ returned: 3, hasMore: true, total: 4 });
    const p2 = await listCaptures(db, listQ({ folderId: 'none', limit: 3, cursor: p1.nextCursor }), ctx);
    expect(p2.items.map((c) => c.id)).toEqual([shot.id]);
    expect(p2.hasMore).toBe(false);
  });

  it('J-165, J-166: bulk move and delete change only what the caller may change', async () => {
    const f = await createFolder(db, ws, dana.id, { name: 'Bulk', private: false });
    const mine = await mkCapture({ organizationId: ws, authorUserId: sam.id });
    const theirs = await mkCapture({ organizationId: ws, authorUserId: dana.id });
    const seatFor = (u: string) => (w: string) => seatOf(db, u, w);
    const asSam = await changeable(db, [mine.id, theirs.id], sam.id, seatFor(sam.id));
    expect(asSam.ok.map((r) => r.id)).toEqual([mine.id]);
    expect(await bulkMove(db, asSam.ok, f.id, sam.id)).toBe(1);
    const asDana = await changeable(db, [mine.id, theirs.id], dana.id, seatFor(dana.id));
    expect(asDana.ok).toHaveLength(2);
    await fails(bulkMove(db, asDana.ok, (await createFolder(db, ws2, dana.id, { name: 'Elsewhere', private: false })).id, dana.id), 'invalid_body');
    expect(await bulkDelete(db, asDana.ok, dana.id)).toBe(2);
    const left = await db.select().from(schema.recording).where(and(eq(schema.recording.folderId, f.id), isNull(schema.recording.deletedAt)));
    expect(left).toHaveLength(0);
    const log = await listAudit(db, ws, { limit: 50, actions: ['capture.deleted'] });
    expect(log.items.filter((e) => [mine.id, theirs.id].includes(e.target?.id ?? ''))).toHaveLength(2);
  });

  itMail('J-122, J-237: folder share invites by email, lists people, and makes the folder private', async () => {
    const f = await createFolder(db, ws, dana.id, { name: 'Secret', private: false });
    const guest = `guest-${run}@guest${run}.test`;
    const s = await updateFolderShare(db, f, { id: dana.id, name: 'Dana Owner' }, { access: 'private', invite: [{ email: guest, role: 'viewer' }, { email: vera.email, role: 'viewer' }] });
    expect(s.access).toBe('private');
    expect(s.url).toMatch(new RegExp(`/f/${f.shortId}$`));
    expect(s.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'admin', pending: false }),
      expect.objectContaining({ person: expect.objectContaining({ email: guest }), pending: true }),
      expect.objectContaining({ person: expect.objectContaining({ id: vera.id }), pending: false }),
    ]));
    expect(await mailTo(guest, /shared "Secret"/)).not.toBeNull();
    expect((await listFolders(db, ws, await ctxOf(sam))).some((x) => x.id === f.id)).toBe(false);
    expect((await listFolders(db, ws, await ctxOf(vera))).some((x) => x.id === f.id)).toBe(true);
    // J-136: Sam turned off "shared with me", so his invite sends no mail
    await patchRawSettings(db, sam.id, { notifications: { sharedWithMe: false } });
    await updateFolderShare(db, f, { id: dana.id, name: 'Dana Owner' }, { invite: [{ email: sam.email, role: 'viewer' }] });
    expect(await mailTo(sam.email, /shared "Secret"/)).toBeNull();
    await patchRawSettings(db, sam.id, { notifications: { sharedWithMe: true } });
    await updateFolderShare(db, f, { id: dana.id, name: 'Dana' }, { access: 'workspace', remove: [vera.id, sam.id] });
    expect((await folderShare(db, f)).people.some((p) => p.person.id === vera.id)).toBe(false);
    expect((await listFolders(db, ws, await ctxOf(sam))).some((x) => x.id === f.id)).toBe(true);
  }, 30_000);

  it('J-161, J-228, J-150: search finds members, folders and captures by title, comment, transcript, issue and pasted URL', async () => {
    const w = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Search', domainJoin: false })).id;
    await db.insert(schema.member).values({ organizationId: w, userId: sam.id, role: 'creator' });
    await createFolder(db, w, dana.id, { name: 'Payments wombat', private: false });
    const a = await mkCapture({ organizationId: w, title: 'Wombat checkout breaks', authorUserId: dana.id, authorName: 'Dana Owner' });
    const b = await mkCapture({ organizationId: w, title: 'Other', description: 'Nothing here', authorUserId: sam.id });
    await db.insert(schema.comment).values({ recordingId: b.id, authorUserId: dana.id, body: 'I saw a quokka on the form' });
    const c = await mkCapture({ organizationId: w, title: 'Narrated', authorUserId: sam.id });
    await db.insert(schema.transcript).values({ recordingId: c.id, provider: 'test', status: 'done', vtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nThe pangolin button is grey\n' });
    const ctx = await ctxOf(dana, w);
    const q = (s: string) => search(db, searchQuerySchema.parse({ q: s }), ctx);
    const r1 = await q('wombat');
    expect(r1.folders.map((f) => f.name)).toEqual(['Payments wombat']);
    expect(r1.captures.map((x) => [x.id, x.match?.field])).toEqual([[a.id, 'title']]);
    expect((await q('quokka')).captures.map((x) => [x.id, x.match?.field, x.match?.snippet])).toEqual([[b.id, 'comment', 'I saw a quokka on the form']]);
    expect((await q('pangolin')).captures.map((x) => [x.id, x.match?.field])).toEqual([[c.id, 'transcript']]);
    expect((await q(`http://localhost:3106/c/${c.id}?t=4`)).captures[0]).toMatchObject({ id: c.id, match: { field: 'id' } });
    const people = await q('Sam M');
    expect(people.members.map((m) => m.userId)).toEqual([sam.id]);
    expect(people.captures.map((x) => x.id).sort()).toEqual([b.id, c.id].sort()); // author name matches
    expect((await recent(db, 5, ctx)).length).toBe(3);
    // J-241: text references count as linked issues
    await db.update(schema.recording).set({ description: 'Tracked in acme/shop#77' }).where(eq(schema.recording.id, b.id));
    const [bRow] = await db.select().from(schema.recording).where(eq(schema.recording.id, b.id));
    expect((await linkedIssuesOf(db, bRow!)).map((i) => i.key)).toEqual(['acme/shop#77']);
    expect((await q('acme/shop#77')).captures.map((x) => x.id)).toContain(b.id);
    expect((await search(db, searchQuerySchema.parse({ q: '', hasIssue: 'true' }), ctx)).captures.map((x) => x.id)).toEqual([b.id]);
  });

  it('J-167, J-223, J-017, J-126: recording links list with uses, retarget, presets, and turn off', async () => {
    const f = await createFolder(db, ws, dana.id, { name: 'Inbox', private: false });
    const l = await createLink(db, ws, sam.id, { name: 'Support', refUrl: 'https://github.com/acme/shop/issues/9' });
    const [dto] = await toLinks(db, [l]);
    const token = dto!.url.split('/rl/')[1]!;
    expect(dto).toMatchObject({ name: 'Support', status: 'active', uses: 0, folder: null, ref: { tracker: 'github', key: 'acme/shop#9' } });
    expect(await recorderInfo(db, token, { title: 'Checkout broke', mic: '1' })).toMatchObject({ name: 'Support', workspaceName: 'Shop', ownerName: 'Sam Maker', title: 'Checkout broke', mic: true });
    await updateLink(db, l, { name: 'Support desk', folderId: f.id });
    const made = await recorderCreate(db, token, { clientId: uuidv7(), kind: 'link', startedAt: Date.now(), note: 'it froze', folder: 'inbox' });
    expect(made.uploadToken).toMatch(/^tb_upl_/);
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.id, made.id));
    expect(rec).toMatchObject({ folderId: f.id, source: 'recording-link', recordingLinkId: l.id, authorUserId: null, status: 'uploading' });
    await db.update(schema.recording).set({ status: 'ready', finalizedAt: new Date() }).where(eq(schema.recording.id, made.id));
    const list = await listLinks(db, ws, { status: 'active', sort: 'most-used', limit: 10 }, await ctxOf(dana));
    expect(list.items[0]).toMatchObject({ id: l.id, name: 'Support desk', uses: 1, folder: { id: f.id, name: 'Inbox' } });
    await updateLink(db, (await linkByToken(db, token))!, { revoked: true });
    await fails(linkByToken(db, token), 'revoked');
    await fails(recorderCreate(db, token, { clientId: uuidv7(), kind: 'link', startedAt: Date.now() }), 'revoked');
    expect((await listLinks(db, ws, { status: 'revoked', sort: 'newest', limit: 10 }, await ctxOf(dana))).items.map((x) => x.id)).toEqual([l.id]);
    await fails(linkByToken(db, 'x'.repeat(22)), 'not_found');
  });

  it('J-222, J-173, J-249: seats change, the last admin stays, and a member who leaves keeps their captures there', async () => {
    const w = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Seats', domainJoin: false })).id;
    await db.insert(schema.member).values({ organizationId: w, userId: sam.id, role: 'viewer' });
    expect((await changeSeat(db, w, dana.id, sam.id, 'creator')).role).toBe('creator');
    await fails(changeSeat(db, w, dana.id, dana.id, 'viewer'), 'last_admin');
    await changeSeat(db, w, dana.id, sam.id, 'admin');
    expect((await changeSeat(db, w, sam.id, dana.id, 'creator')).role).toBe('creator');
    await changeSeat(db, w, sam.id, dana.id, 'admin');
    const cap = await mkCapture({ organizationId: w, authorUserId: sam.id });
    await removeMember(db, w, sam.id, sam.id, 'admin'); // leave
    expect((await listMembers(db, w)).map((m) => m.userId)).toEqual([dana.id]);
    const [still] = await db.select().from(schema.recording).where(eq(schema.recording.id, cap.id));
    expect(still!.deletedAt).toBeNull();
    const log = await listAudit(db, w, { limit: 20 });
    expect(log.items.map((e) => e.action)).toEqual(expect.arrayContaining(['member.role_changed', 'member.removed']));
    await fails(removeMember(db, w, dana.id, dana.id, 'admin'), 'last_admin');
  });

  it('J-120, J-156, J-178: workspace settings save, mirror default access for server-core, and auto-delete old captures', async () => {
    const w = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Settings', domainJoin: false })).id;
    const d = await updateWorkspace(db, w, dana.id, { name: 'Settings 2', defaultLinkAccess: 'workspace', aiEnabled: false, autoDeleteDays: 30 });
    expect(d).toMatchObject({ name: 'Settings 2', settings: { defaultLinkAccess: 'workspace', aiEnabled: false, autoDeleteDays: 30 } });
    const [o] = await db.select().from(schema.organization).where(eq(schema.organization.id, w));
    expect(JSON.parse(o!.metadata!)).toMatchObject({ defaultLinkAccess: 'workspace' });
    // J-120: new captures take the default; J-156: the AI switch is readable by other areas
    const made = await createCaptureRecord(db, { organizationId: w, clientId: uuidv7(), kind: 'screenshot', page: { url: 'http://x/', title: 'x' }, startedAt: Date.now(), source: 'extension', author: await authorSnapshot(db, dana.id) });
    const [mr] = await db.select().from(schema.recording).where(eq(schema.recording.id, made.id));
    expect(mr!.access).toBe('workspace');
    expect(await aiAllowed(db, w)).toBe(false);
    expect(await aiAllowed(db, ws)).toBe(true);
    const old = await mkCapture({ organizationId: w, createdAt: new Date(Date.now() - 40 * 86_400_000) });
    const fresh = await mkCapture({ organizationId: w });
    expect(await autoDelete(db)).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(schema.recording).where(eq(schema.recording.organizationId, w));
    expect(rows.find((r) => r.id === old.id)!.deletedAt).not.toBeNull();
    expect(rows.find((r) => r.id === fresh.id)!.deletedAt).toBeNull();
    expect((await listAudit(db, w, { limit: 20 })).items.map((e) => e.action)).toEqual(expect.arrayContaining(['workspace.updated', 'capture.deleted']));
    await patchSettings(db, w, { autoDeleteDays: null });
  });

  it('J-142: webhooks deliver signed capture events, and failures retry with a logged attempt', async () => {
    const w = (await createWorkspace(db, { userId: dana.id, email: dana.email, name: 'Hooks', domainJoin: false })).id;
    const ok = await listen(() => ({ status: 200 }));
    const bad = await listen(() => ({ status: 500 }));
    try {
      const good = await createHook(db, w, dana.id, { url: `${ok.url}/in`, events: ['capture.created'] });
      const failing = await createHook(db, w, dana.id, { url: `${bad.url}/in`, events: ['capture.created', 'capture.deleted'] });
      expect(good.secret).toMatch(/^whsec_/);
      const cap = await mkCapture({ organizationId: w, title: 'Hooked', authorUserId: dana.id, authorName: 'Dana Owner', pageUrl: 'http://localhost:5173/' });
      await sweepNotices(db);
      const [d1] = (await listDeliveries(db, good.webhook.id, { limit: 10 })).items;
      expect(d1).toBeTruthy();
      const r = await attempt(db, d1!.id);
      expect(r).toMatchObject({ status: 'ok', attempts: 1, responseStatus: 200 });
      const got = ok.seen.at(-1)!;
      expect(verify(good.secret, got.body, String(got.headers[WEBHOOK_SIGNATURE_HEADER]))).toBe(true);
      expect(JSON.parse(got.body)).toMatchObject({ event: 'capture.created', workspaceId: w, data: { capture: { id: cap.id, title: 'Hooked', source: 'extension', url: expect.stringContaining(`/c/${cap.id}`) } } });
      const [f1] = (await listDeliveries(db, failing.webhook.id, { limit: 10 })).items;
      const r2 = await attempt(db, f1!.id);
      expect(r2).toMatchObject({ status: 'pending', attempts: 1, responseStatus: 500, error: 'HTTP 500' });
      expect(r2!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      const queued = await db.select().from(schema.job).where(and(eq(schema.job.type, 'webhook-deliver'), isNull(schema.job.doneAt)));
      expect(queued.some((j) => (j.payload as { deliveryId: string }).deliveryId === f1!.id && j.runAt.getTime() > Date.now())).toBe(true);
      // the same capture is not announced twice
      expect((await sweepNotices(db)).created).toBe(0);
      const sent = await dispatch(db, w, 'comment.created', { capture: JSON.parse(got.body).data.capture });
      expect(sent).toEqual([]); // nobody subscribed to comments
    } finally {
      await ok.close();
      await bad.close();
    }
  });

  it('J-139, J-140, J-137, J-138, J-242, J-251: GitHub through a token files a full issue, Slack posts, and connections stay in their workspace', async () => {
    const issues: { title: string; body: string; labels?: string[]; assignees?: string[] }[] = [];
    let down = false;
    const gh = await listen((req, body) => {
      if (down) return { status: 502, json: { message: 'bad gateway' } };
      if (req.headers.authorization !== 'Bearer ghp_test_token_123') return { status: 401, json: { message: 'Bad credentials' } };
      if (req.url === '/user') return { status: 200, json: { login: 'dana-gh' } };
      if (req.url!.startsWith('/user/repos')) return { status: 200, json: [{ id: 1, full_name: 'acme/shop' }, { id: 2, full_name: 'acme/api' }] };
      if (req.url!.startsWith('/repos/acme/shop/labels')) return { status: 200, json: [{ name: 'bug', color: 'd73a4a' }] };
      if (req.url!.startsWith('/repos/acme/shop/assignees')) return { status: 200, json: [{ login: 'sam-gh', avatar_url: null }] };
      if (req.url!.startsWith('/repos/acme/shop/milestones')) return { status: 200, json: [{ number: 3, title: 'v1' }] };
      if (req.method === 'POST' && req.url === '/repos/acme/shop/issues') {
        issues.push(JSON.parse(body));
        return { status: 201, json: { html_url: 'https://github.com/acme/shop/issues/42', number: 42, title: JSON.parse(body).title } };
      }
      return { status: 404, json: { message: 'Not Found' } };
    });
    const sl = await listen(() => ({ status: 200 }));
    try {
      await fails(connect(db, ws, dana.id, { type: 'github', token: 'wrong_token_xyz', baseUrl: gh.url }), 'integration_failed');
      const g = await connect(db, ws, dana.id, { type: 'github', token: 'ghp_test_token_123', baseUrl: gh.url, defaultRepo: 'acme/shop' });
      expect(g).toMatchObject({ type: 'github', account: 'dana-gh', defaultTarget: 'acme/shop', status: 'ok' });
      expect(JSON.stringify(await db.select().from(schema.integration))).not.toContain('ghp_test_token_123');
      const row = await integrationById(db, g.id);
      expect(await options(db, row, {})).toEqual({
        repos: [{ id: '1', fullName: 'acme/shop' }, { id: '2', fullName: 'acme/api' }],
        labels: [{ name: 'bug', color: '#d73a4a' }],
        assignees: [{ login: 'sam-gh', name: null, avatarUrl: null }],
        milestones: [{ id: '3', title: 'v1' }],
      });
      const cap = await mkCapture({
        organizationId: ws,
        title: 'Submit order does nothing',
        description: 'The button spins forever.',
        pageUrl: 'http://localhost:5173/checkout',
        authorUserId: sam.id,
        env: { ua: 'Chrome', browser: { name: 'Chrome', version: '141' }, os: { name: 'Linux' }, viewport: { w: 1280, h: 720 }, dpr: 1, tz: 'UTC', connection: { effectiveType: '4g' } },
      });
      const issue = await sendCapture(db, cap, row, { labels: ['bug'], assignees: ['sam-gh'], milestone: '3' }, sam.id);
      expect(issue).toMatchObject({ type: 'github', key: 'acme/shop#42', url: 'https://github.com/acme/shop/issues/42' });
      expect(issues[0]).toMatchObject({ title: 'Submit order does nothing', labels: ['bug'], assignees: ['sam-gh'], milestone: 3 });
      for (const want of ['The button spins forever.', `/c/${cap.id}`, 'http://localhost:5173/checkout', '| Browser | Chrome 141 |', '| Viewport | 1280 x 720 @1x |', '| Network speed | 4g |'])
        expect(issues[0]!.body).toContain(want);
      expect((await linkedIssuesOf(db, cap)).map((i) => i.key)).toContain('acme/shop#42');
      const ctx = await ctxOf(dana);
      expect((await listCaptures(db, listQ({ hasIssue: 'true' }), ctx)).items.map((c) => c.id)).toContain(cap.id);
      // remembered values for next time (J-140)
      const [s] = await db.select().from(schema.userSettings).where(eq(schema.userSettings.userId, sam.id));
      expect((s!.settings as { editor: { recentFields: Record<string, unknown> } }).editor.recentFields[g.id]).toMatchObject({ repo: 'acme/shop', labels: ['bug'] });
      // finalize destination (J-137) goes through the same path
      const cap2 = await mkCapture({ organizationId: ws, title: 'From the draft', authorUserId: sam.id });
      expect((await destinationHandler(db, cap2, { type: 'integration', integrationId: g.id, fields: {} }, 'http://x')).key).toBe('acme/shop#42');
      // tracker down: a clear error and the connection marked (the capture itself is saved by finalize)
      down = true;
      await fails(sendCapture(db, cap2, row, {}, sam.id), 'integration_failed');
      expect((await integrationById(db, g.id)).config).toMatchObject({ status: 'error' });
      down = false;
      // J-251: another workspace's capture cannot use this connection
      const other = await mkCapture({ organizationId: ws2, authorUserId: dana.id });
      await fails(sendCapture(db, other, row, {}, dana.id), 'forbidden');
      // Slack incoming webhook
      const s2 = await connect(db, ws, dana.id, { type: 'slack', webhookUrl: `${sl.url}/hook`, channelLabel: '#bugs' });
      await sendCapture(db, cap, await integrationById(db, s2.id), { message: 'please look' }, dana.id);
      expect(JSON.parse(sl.seen.at(-1)!.body).text).toContain('please look');
      expect(JSON.parse(sl.seen.at(-1)!.body).text).toContain(`/c/${cap.id}|Submit order does nothing>`);
    } finally {
      await gh.close();
      await sl.close();
    }
  });

  itMail('J-017, J-136: a recording through a link emails its owner unless they turned that email off', async () => {
    const l = await createLink(db, ws, dana.id, { name: `Mail test ${run}` });
    const token = (await toLinks(db, [l]))[0]!.url.split('/rl/')[1]!;
    const made = await recorderCreate(db, token, { clientId: uuidv7(), kind: 'link', startedAt: Date.now() });
    await db.update(schema.recording).set({ status: 'processing', finalizedAt: new Date(), metadata: { note: 'the total is wrong' } }).where(eq(schema.recording.id, made.id));
    await sweepNotices(db);
    expect(await mailTo(dana.email, new RegExp(`New recording from "Mail test ${run}"`))).not.toBeNull();
    expect(await emailAllowed(db, dana.id, 'recordingLinkUsed')).toBe(true);
    await patchRawSettings(db, dana.id, { notifications: { allOff: true } });
    expect(await emailAllowed(db, dana.id, 'recordingLinkUsed')).toBe(false);
    await patchRawSettings(db, dana.id, { notifications: { allOff: false, recordingLinkUsed: false } });
    expect(await emailAllowed(db, dana.id, 'recordingLinkUsed')).toBe(false);
    await patchRawSettings(db, dana.id, { notifications: { recordingLinkUsed: true } });
  });

  it('J-169, J-175: onboarding steps tick as setup happens; profile names and role hint save', async () => {
    const u = await mkUser('Olga New');
    const w = (await createWorkspace(db, { userId: u.id, email: u.email, name: 'Solo', domainJoin: false })).id;
    let ob = await onboarding(db, u.id, w);
    expect(ob.steps.map((s) => s.done)).toEqual([false, false, false, false]);
    // trackers paused by default (D-170): the step names webhooks, not the hidden integrations page
    expect(ob.steps.at(-1)).toMatchObject(env.features.trackers ? { href: '/settings/integrations' } : { label: 'Add a webhook', href: '/settings/webhooks' });
    await mkCapture({ organizationId: w, authorUserId: u.id });
    await db.insert(schema.member).values({ organizationId: w, userId: sam.id, role: 'creator' });
    ob = await onboarding(db, u.id, w);
    expect(ob.steps.find((s) => s.id === 'capture')!.done).toBe(true);
    expect(ob.steps.find((s) => s.id === 'invite')!.done).toBe(true);
    const me = await updateProfile(db, u.id, { firstName: 'Olga', lastName: 'Novak', roleHint: 'qa' });
    expect(me).toMatchObject({ name: 'Olga Novak', firstName: 'Olga', lastName: 'Novak', roleHint: 'qa' });
  });

  it('J-225, J-249: deleting an account erases solo workspaces, leaves shared ones, and is blocked for a sole admin', async () => {
    const solo = await mkUser('Solo Sue');
    const own = (await createWorkspace(db, { userId: solo.id, email: solo.email, name: 'Sue only', domainJoin: false })).id;
    const shared = (await createWorkspace(db, { userId: solo.id, email: solo.email, name: 'Sue shared', domainJoin: false })).id;
    await db.insert(schema.member).values({ organizationId: shared, userId: sam.id, role: 'creator' });
    await db.insert(schema.member).values({ organizationId: ws, userId: solo.id, role: 'creator' });
    let plan = await deletionPlan(db, solo.id);
    expect(plan.blocked.map((w) => w.id)).toEqual([shared]);
    await fails(deleteAccount(db, solo.id), 'last_admin');
    await changeSeat(db, shared, solo.id, sam.id, 'admin');
    plan = await deletionPlan(db, solo.id);
    expect(plan.erase.map((w) => w.id)).toEqual([own]);
    expect(plan.leave.map((w) => w.id).sort()).toEqual([shared, ws].sort());
    const gone = await mkCapture({ organizationId: own, authorUserId: solo.id });
    const kept = await mkCapture({ organizationId: shared, authorUserId: solo.id });
    await db.insert(schema.comment).values({ recordingId: kept.id, authorUserId: solo.id, authorName: 'Solo Sue', body: 'hi' });
    expect(await deleteAccount(db, solo.id)).toEqual([own]);
    expect(await db.select().from(schema.recording).where(eq(schema.recording.id, gone.id))).toEqual([]);
    const [k] = await db.select().from(schema.recording).where(eq(schema.recording.id, kept.id));
    expect(k).toMatchObject({ deletedAt: null, authorUserId: null });
    const [c] = await db.select().from(schema.comment).where(eq(schema.comment.recordingId, kept.id));
    expect(c!.authorName).toBe('Deleted account');
    expect(await db.select().from(schema.organization).where(eq(schema.organization.id, own))).toEqual([]);
    void audit;
  });

  it('J-020: an uploaded MP4 becomes a video capture with no logs, converted to WebM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tb-up-'));
    const mp4 = join(dir, 'clip.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-t', '1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', mp4]);
    const file = new File([readFileSync(mp4)], 'clip.mp4', { type: 'video/mp4' });
    const r = await uploadVideo(db, {} as RequestEvent, { file, workspaceId: ws, folderId: null, title: null, userId: sam.id });
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.id, r.id));
    expect(rec).toMatchObject({ source: 'upload', kind: 'video', status: 'processing', title: 'clip', authorUserId: sam.id });
    const chunks = await db.select().from(schema.recordingChunk).where(eq(schema.recordingChunk.recordingId, r.id));
    expect(chunks.length).toBeGreaterThan(0);
    const [st] = await db.select().from(schema.recordingStream).where(eq(schema.recordingStream.recordingId, r.id));
    expect(st).toMatchObject({ name: 'video', contentType: expect.stringContaining('webm') });
    const big = new File([new Uint8Array(1)], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 201 * 1024 * 1024 });
    await fails(uploadVideo(db, {} as RequestEvent, { file: big, workspaceId: ws, folderId: null, title: null, userId: sam.id }), 'too_large');
  }, 60_000);
});
