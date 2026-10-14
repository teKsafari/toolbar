// Gates other areas call into, run against a throwaway Postgres database with the server's own
// `db` module pointed at it (DATABASE_URL is set before the first import), Mailpit for mail and a
// local HTTP server standing in for an OpenAI-compatible model. Skips when Postgres is down.
//   J-136: first-view, mention and same-domain sign-up emails follow the notification settings.
//   J-156: the workspace AI switch stops ghost text (ai-draft route) and chapters (job).
//   J-177: the extension menu's problem report opens a recording link owned by the server admin.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { RequestEvent } from '@sveltejs/kit';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const name = `toolbar_gatestest_${process.pid}`;
const run = Date.now().toString(36);

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

async function mails(to: string, subject: RegExp, waitMs = 6000) {
  const until = Date.now() + waitMs;
  for (;;) {
    const r = (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((x) => x.json())) as { messages: { Subject: string }[] };
    const hits = (r.messages ?? []).filter((m) => subject.test(m.Subject));
    if (hits.length || Date.now() > until) return hits;
    await new Promise((res) => setTimeout(res, 250));
  }
}
/** Mail that must not arrive: give the sender a moment, then look. */
async function noMail(to: string, subject: RegExp) {
  await new Promise((res) => setTimeout(res, 1200));
  return (await mails(to, subject, 0)).length === 0;
}

describe.skipIf(!reachable)('gates (integration)', () => {
  let admin: postgres.Sql;
  // modules loaded after DATABASE_URL points at the test database
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    core: typeof import('../src/lib/server/dashboard/core.ts');
    notices: typeof import('../src/lib/server/dashboard/notices.ts');
    links: typeof import('../src/lib/server/dashboard/links.ts');
    ws: typeof import('../src/lib/server/auth/workspaces.ts');
    comments: typeof import('../src/lib/server/viewer/comments.ts');
    handlers: typeof import('../src/lib/server/jobs/handlers.ts');
    aiDraft: typeof import('../src/routes/api/v1/recordings/[id]/ai-draft/+server.ts');
  };
  let llm: { srv: Server; url: string; calls: number };
  const env0 = { ...process.env };

  const mkUser = async (who: string, domain = `gates${run}.test`) => {
    const [u] = await m.db.insert(m.schema.user).values({ name: who, email: `${who.toLowerCase().replace(/\s+/g, '.')}-${run}@${domain}`, emailVerified: true }).returning();
    return u!;
  };

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.SMTP_URL ??= 'smtp://localhost:1025';
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      core: await import('../src/lib/server/dashboard/core.ts'),
      notices: await import('../src/lib/server/dashboard/notices.ts'),
      links: await import('../src/lib/server/dashboard/links.ts'),
      ws: await import('../src/lib/server/auth/workspaces.ts'),
      comments: await import('../src/lib/server/viewer/comments.ts'),
      handlers: await import('../src/lib/server/jobs/handlers.ts'),
      aiDraft: await import('../src/routes/api/v1/recordings/[id]/ai-draft/+server.ts'),
    };
    // an OpenAI-compatible model that answers every prompt with draft text and two chapters
    llm = { srv: null as unknown as Server, url: '', calls: 0 };
    llm.srv = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        llm.calls++;
        const content = JSON.stringify({ title: 'Checkout fails on submit', summary: 'The order is not placed.', steps: ['Open checkout', 'Press submit'], result: 'A 500 error', chapters: [{ title: 'Open checkout', startSec: 0 }, { title: 'Submit', startSec: 15 }] });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
      });
    });
    await new Promise<void>((r) => llm.srv.listen(0, '127.0.0.1', () => r()));
    llm.url = `http://127.0.0.1:${(llm.srv.address() as { port: number }).port}`;
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    llm?.srv.close();
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('J-177: the problem-report link is a recording link of the first account, made once; the env var overrides or turns it off', async () => {
    const first = await mkUser('Ada Admin');
    const later = await mkUser('Bo Later');
    const w = await m.ws.createWorkspace(m.db, { userId: first.id, email: first.email, name: 'Admin home', domainJoin: false });
    await m.ws.createWorkspace(m.db, { userId: later.id, email: later.email, name: 'Later home', domainJoin: false });
    expect(await m.links.supportLinkUrl(m.db, 'off')).toBeNull();
    expect(await m.links.supportLinkUrl(m.db, 'https://support.example/rl/abc')).toBe('https://support.example/rl/abc');
    const u1 = await m.links.supportLinkUrl(m.db, '');
    expect(u1).toMatch(/\/rl\/[A-Za-z0-9_-]+$/);
    expect(await m.links.supportLinkUrl(m.db, '')).toBe(u1);
    const rows = await m.db.select().from(m.schema.recordingLink);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: w.id, createdBy: first.id, name: m.links.SUPPORT_LINK_NAME });
    // the link works for a signed-out recipient
    const info = await m.links.recorderInfo(m.db, u1!.split('/rl/')[1]!, {});
    expect(info).toMatchObject({ workspaceName: 'Admin home' });
    // turned off by the admin: the menu falls back to the issue tracker
    await m.db.update(m.schema.recordingLink).set({ revokedAt: new Date() });
    expect(await m.links.supportLinkUrl(m.db, '')).toBeNull();
  });

  it('J-136: the first view by someone else emails the author once, and not when they turned it off', async () => {
    const author = await mkUser('Fay Author');
    const viewer = await mkUser('Gus Viewer');
    const w = await m.ws.createWorkspace(m.db, { userId: author.id, email: author.email, name: 'Views', domainJoin: false });
    const mk = async (title: string) =>
      (await m.db.insert(m.schema.recording).values({ clientId: crypto.randomUUID(), organizationId: w.id, kind: 'video', status: 'ready', title, authorUserId: author.id, finalizedAt: new Date() }).returning())[0]!;
    const view = async (rec: { id: string; title: string; authorUserId: string | null }, actor: string, userId: string | null, who: string | null) => {
      await m.db
        .insert(m.schema.captureView)
        .values({ recordingId: rec.id, viewer: actor, userId })
        .onConflictDoUpdate({ target: [m.schema.captureView.recordingId, m.schema.captureView.viewer], set: { count: 2 } });
      return m.notices.notifyFirstView(m.db, rec, { actor, userId, name: who });
    };
    const rec = await mk(`Cart total wrong ${run}`);
    // the author's own view sends nothing
    expect(await view(rec, `u:${author.id}`, author.id, author.name)).toBeNull();
    // the first other viewer does
    expect(await view(rec, `u:${viewer.id}`, viewer.id, viewer.name)).toBe(author.email);
    expect(await mails(author.email, new RegExp(`Gus Viewer viewed "Cart total wrong ${run}"`))).toHaveLength(1);
    // a second view by them, and a later anonymous viewer, send nothing more
    expect(await view(rec, `u:${viewer.id}`, viewer.id, viewer.name)).toBeNull();
    expect(await view(rec, 'a:anon1', null, null)).toBeNull();
    // turned off: no mail
    const rec2 = await mk(`Second ${run}`);
    await m.core.patchRawSettings(m.db, author.id, { notifications: { firstView: false } });
    expect(await view(rec2, `u:${viewer.id}`, viewer.id, viewer.name)).toBeNull();
    expect(await noMail(author.email, new RegExp(`viewed "Second ${run}"`))).toBe(true);
    // turn-off-all wins over the single toggle
    const rec3 = await mk(`Third ${run}`);
    await m.core.patchRawSettings(m.db, author.id, { notifications: { firstView: true, allOff: true } });
    expect(await view(rec3, 'a:anon2', null, null)).toBeNull();
    await m.core.patchRawSettings(m.db, author.id, { notifications: { allOff: false } });
    const rec4 = await mk(`Fourth ${run}`);
    expect(await view(rec4, 'a:anon3', null, null)).toBe(author.email);
    expect(await mails(author.email, new RegExp(`Someone viewed "Fourth ${run}"`))).toHaveLength(1);
  });

  it('J-136: mention emails skip a member who turned mentions off; the in-app notice is still stored', async () => {
    const owner = await mkUser('Hal Owner');
    const on = await mkUser('Ivy On');
    const off = await mkUser('Jo Off');
    const w = await m.ws.createWorkspace(m.db, { userId: owner.id, email: owner.email, name: 'Mentions', domainJoin: false });
    await m.db.insert(m.schema.member).values([
      { organizationId: w.id, userId: on.id, role: 'member' },
      { organizationId: w.id, userId: off.id, role: 'member' },
    ]);
    await m.core.patchRawSettings(m.db, off.id, { notifications: { mentions: false } });
    const [rec] = await m.db.insert(m.schema.recording).values({ clientId: crypto.randomUUID(), organizationId: w.id, kind: 'video', status: 'ready', title: `Mention target ${run}`, authorUserId: owner.id, finalizedAt: new Date() }).returning();
    const ctx = { rec: rec!, user: { id: owner.id, name: owner.name, email: owner.email, image: null }, role: 'admin', share: null, anonKey: null, canEdit: true, canComment: true, actor: `u:${owner.id}` } as unknown as Parameters<typeof m.comments.notifyMentions>[0];
    await m.comments.notifyMentions(ctx, { id: crypto.randomUUID(), body: 'please look', tMs: null }, [on.id, off.id]);
    expect(await mails(on.email, /Hal Owner mentioned you/)).toHaveLength(1);
    expect(await noMail(off.email, /mentioned you/)).toBe(true);
    const notes = await m.db.select().from(m.schema.notification);
    expect(notes.filter((n) => n.type === 'mention').map((n) => n.userId).sort()).toEqual([on.id, off.id].sort());
  });

  it('J-136: the same-domain sign-up email goes only to admins who left it on', async () => {
    const domain = `corp${run}.example`;
    const a1 = await mkUser('Kim Admin', domain);
    const a2 = await mkUser('Lee Admin', domain);
    const w = await m.ws.createWorkspace(m.db, { userId: a1.id, email: a1.email, name: 'Corp', domainJoin: true });
    await m.db.insert(m.schema.member).values({ organizationId: w.id, userId: a2.id, role: 'admin' });
    await m.core.patchRawSettings(m.db, a2.id, { notifications: { domainSignup: false } });
    const joiner = await mkUser('Max Joiner', domain);
    expect(await m.ws.joinByDomain(m.db, joiner)).toEqual([w.id]);
    expect(await mails(a1.email, /Max Joiner .* joined Corp/)).toHaveLength(1);
    expect(await noMail(a2.email, /joined Corp/)).toBe(true);
  });

  it('J-156: with the workspace AI switch off there is no ghost text and no chapters; on, both come from the model', async () => {
    process.env.AI_PROVIDER = 'openai-compatible';
    process.env.AI_BASE_URL = llm.url;
    process.env.AI_MODEL = 'test-model';
    const u = await mkUser('Nia Maker');
    const w = await m.ws.createWorkspace(m.db, { userId: u.id, email: u.email, name: 'AI shop', domainJoin: false });
    const mk = async () =>
      (
        await m.db
          .insert(m.schema.recording)
          .values({ clientId: crypto.randomUUID(), organizationId: w.id, kind: 'video', status: 'ready', title: 'Checkout', authorUserId: u.id, durationMs: 40_000, finalizedAt: new Date() })
          .returning()
      )[0]!;
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:05.000\nI open the checkout page\n\n00:00:16.000 --> 00:00:22.000\nNow I press submit and it fails\n';
    const draft = (id: string) =>
      m.aiDraft.POST({ params: { id }, locals: { user: { id: u.id, name: u.name, email: u.email } }, request: new Request('http://x', { method: 'POST' }) } as unknown as RequestEvent<{ id: string }, '/api/v1/recordings/[id]/ai-draft'>);
    m.handlers.useDb(m.db);

    // switch off
    await m.ws.patchSettings(m.db, w.id, { aiEnabled: false } as never);
    expect(await m.core.aiAllowed(m.db, w.id)).toBe(false);
    const off = await mk();
    await m.db.insert(m.schema.transcript).values({ recordingId: off.id, stream: 'voice', provider: 'test', status: 'done', vtt });
    const calls0 = llm.calls;
    const r1 = await draft(off.id);
    expect(r1.status).toBe(503);
    expect(await r1.json()).toMatchObject({ error: 'unavailable', message: 'AI is off for this workspace' });
    await m.handlers._internal.chapters({ recordingId: off.id });
    expect((await m.db.select().from(m.schema.recording).where((await import('drizzle-orm')).eq(m.schema.recording.id, off.id)))[0]!.chapters).toBeNull();
    expect(llm.calls).toBe(calls0);

    // switch on
    await m.ws.patchSettings(m.db, w.id, { aiEnabled: true } as never);
    const on = await mk();
    await m.db.insert(m.schema.transcript).values({ recordingId: on.id, stream: 'voice', provider: 'test', status: 'done', vtt });
    const r2 = await draft(on.id);
    expect(r2.status).toBe(200);
    expect(await r2.json()).toMatchObject({ title: 'Checkout fails on submit' });
    await m.handlers._internal.chapters({ recordingId: on.id });
    const [row] = await m.db.select().from(m.schema.recording).where((await import('drizzle-orm')).eq(m.schema.recording.id, on.id));
    expect((row!.chapters as { title: string }[]).map((c) => c.title)).toEqual(['Open checkout', 'Submit']);
    expect(llm.calls).toBe(calls0 + 2);
  });
});
