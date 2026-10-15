// Transcripts end to end on the server (D-087), against a throwaway Postgres database, the dev
// Garage bucket under a key prefix of its own and a local HTTP server standing in for an
// OpenAI-compatible `gpt-transcribe` endpoint. Covers a comment's voice note (upload, comment,
// job, transcript in the comment and at media/transcript-<assetId>), the capture's own voice
// track, the monthly cap and transcription switched off. Skips when Postgres is down; needs ffmpeg.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { and, eq } from 'drizzle-orm';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_sttest_${process.pid}`;
const run = Date.now().toString(36);
const FIX = new URL('../fixtures/transcribe/', import.meta.url).pathname;
const SW = new Uint8Array(readFileSync(`${FIX}fleurs-sw_ke-1999.webm`));
const EN = new Uint8Array(readFileSync(`${FIX}fleurs-en_us-1904.webm`));

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
const hasFfmpeg = (() => {
  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!reachable || !hasFfmpeg)('transcripts (integration)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    s3: typeof import('../src/lib/server/s3.ts');
    ws: typeof import('../src/lib/server/auth/workspaces.ts');
    upload: typeof import('../src/lib/server/upload/service.ts');
    comments: typeof import('../src/lib/server/viewer/comments.ts');
    detail: typeof import('../src/lib/server/viewer/detail.ts');
    handlers: typeof import('../src/lib/server/jobs/handlers.ts');
    proxy: typeof import('../src/lib/server/media/proxy.ts');
    run: typeof import('../src/lib/server/transcribe/run.ts');
  };
  const stt = { srv: null as unknown as Server, url: '', calls: 0, auth: [] as string[] };
  const env0 = { ...process.env };
  type Ctx = Parameters<typeof import('../src/lib/server/viewer/comments.ts').createComment>[0];
  let ctx: Ctx;
  let user: { id: string; name: string; email: string };
  let recId = '';

  const job = { id: 'x', type: 'transcribe', payload: {}, attempts: 1, max_attempts: 5 } as never;
  const transcriptRow = async (stream: string) =>
    (await m.db.select().from(m.schema.transcript).where(and(eq(m.schema.transcript.recordingId, recId), eq(m.schema.transcript.stream, stream))))[0];

  async function voiceNote(bytes: Uint8Array<ArrayBuffer>) {
    const a = await m.upload.storeAsset(m.db, { fields: { kind: 'voice' }, file: new File([bytes], 'note.webm', { type: 'audio/webm' }), recordingId: null, userId: user.id });
    return m.comments.createComment(ctx, { body: '', attachmentAssetIds: [a.id], mentions: [] });
  }

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `sttest-${run}/`;
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    // gpt-transcribe stand-in: one JSON text per request, no usage (billing falls back to chunk length)
    stt.srv = createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on('data', (d: Buffer) => parts.push(d));
      req.on('end', () => {
        stt.calls++;
        stt.auth.push(String(req.headers.authorization));
        const body = Buffer.concat(parts).toString('latin1');
        const json = /name="response_format"\r\n\r\njson/.test(body) && /name="model"\r\n\r\ngpt-transcribe/.test(body);
        res.writeHead(json ? 200 : 400, { 'content-type': 'application/json' });
        res.end(json ? JSON.stringify({ text: 'Bonyeza kitufe. Hakuna kinachotokea.', languages: [{ code: 'sw' }] }) : '{"error":{"message":"bad request"}}');
      });
    });
    await new Promise<void>((r) => stt.srv.listen(0, '127.0.0.1', () => r()));
    stt.url = `http://127.0.0.1:${(stt.srv.address() as { port: number }).port}/v1`;
    Object.assign(process.env, {
      TRANSCRIBE_PROVIDER: 'openai',
      TRANSCRIBE_BASE_URL: stt.url,
      TRANSCRIBE_API_KEY: 'sk-int-test',
      TRANSCRIBE_MODEL: 'gpt-transcribe',
      // 45 s a month: the 18 s note, an 11 s note and the 11 s track fit, the next 11 s does not
      TRANSCRIBE_MONTHLY_MINUTES: '0.75',
      FEATURE_AI: '',
    });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      s3: await import('../src/lib/server/s3.ts'),
      ws: await import('../src/lib/server/auth/workspaces.ts'),
      upload: await import('../src/lib/server/upload/service.ts'),
      comments: await import('../src/lib/server/viewer/comments.ts'),
      detail: await import('../src/lib/server/viewer/detail.ts'),
      handlers: await import('../src/lib/server/jobs/handlers.ts'),
      proxy: await import('../src/lib/server/media/proxy.ts'),
      run: await import('../src/lib/server/transcribe/run.ts'),
    };
    const [u] = await m.db.insert(m.schema.user).values({ name: 'Wanjiru', email: `wanjiru-${run}@stt.test`, emailVerified: true }).returning();
    user = u!;
    const w = await m.ws.createWorkspace(m.db, { userId: user.id, email: user.email, name: 'Voice notes', domainJoin: false });
    const [rec] = await m.db
      .insert(m.schema.recording)
      .values({ clientId: crypto.randomUUID(), organizationId: w.id, kind: 'video', status: 'ready', title: `Voice ${run}`, authorUserId: user.id, finalizedAt: new Date() })
      .returning();
    recId = rec!.id;
    ctx = { rec: rec!, user: { id: user.id, name: user.name, email: user.email, image: null }, role: 'admin', share: null, anonKey: null, canEdit: true, canComment: true, actor: `u:${user.id}` } as unknown as Ctx;
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    stt.srv?.close();
    await m?.s3.deletePrefix(`sttest-${run}/`).catch(() => 0);
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  let noteAsset = '';

  it('a voice note on a comment is queued, transcribed and shown with the comment', async () => {
    const c = await voiceNote(SW);
    expect(c.attachments).toEqual([]);
    expect(c.voice).toMatchObject({ contentType: 'audio/webm', transcript: { status: 'pending', text: null } });
    noteAsset = c.voice!.assetId;
    // the asset joined the capture, and a transcribe job waits for it
    const [a] = await m.db.select().from(m.schema.asset).where(eq(m.schema.asset.id, noteAsset));
    expect(a!.recordingId).toBe(recId);
    const jobs = await m.db.select().from(m.schema.job).where(eq(m.schema.job.type, 'transcribe'));
    expect(jobs.map((j) => j.payload)).toContainEqual({ recordingId: recId, assetId: noteAsset });

    await m.handlers._internal.transcribe({ recordingId: recId, assetId: noteAsset }, job);
    expect(stt.calls).toBe(1);
    expect(stt.auth[0]).toBe('Bearer sk-int-test');
    const row = await transcriptRow(`voice:${noteAsset}`);
    expect(row).toMatchObject({ status: 'done', provider: 'openai', model: 'gpt-transcribe', language: 'sw' });
    expect(row!.vtt).toMatch(/^WEBVTT\n\nNOTE Machine transcript \(gpt-transcribe, language sw\)/);

    const [thread] = await m.comments.listThreads(ctx);
    expect(thread!.voice!.transcript).toEqual({ status: 'done', language: 'sw', text: 'Bonyeza kitufe. Hakuna kinachotokea.', reason: null });

    const res = await m.proxy.serveMedia(m.db, ctx.rec, `transcript-${noteAsset}`, new Request('http://x/'));
    expect(res.headers.get('content-type')).toMatch(/text\/vtt/);
    const cues = (await res.text()).match(/-->/g) ?? [];
    expect(cues).toHaveLength(2);
    // the note is not the capture's transcript
    expect(await m.detail.transcriptCues(recId)).toEqual([]);
    const audio = await m.proxy.serveMedia(m.db, ctx.rec, noteAsset, new Request('http://x/'));
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/webm');
  }, 60_000);

  it('a note with no duration in its header (as MediaRecorder writes) is measured, not refused', async () => {
    // WebM written to a pipe has no duration, like a MediaRecorder file
    const piped = new Uint8Array(execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', `${FIX}fleurs-en_us-1904.webm`, '-c', 'copy', '-f', 'webm', 'pipe:1']));
    const c = await voiceNote(piped);
    await m.handlers._internal.transcribe({ recordingId: recId, assetId: c.voice!.assetId }, job);
    expect((await transcriptRow(`voice:${c.voice!.assetId}`))!.status).toBe('done');
    expect(await m.run.dbLedger(m.db).used(m.run.monthOf())).toBe(18 + 11);
  }, 60_000);

  it("the capture's voice track gets its own transcript", async () => {
    const key = m.s3.keys.final(recId, 'voice.webm');
    await m.s3.putObjectWith(key, EN, { contentType: 'audio/webm' });
    await m.db.insert(m.schema.recordingStream).values({ recordingId: recId, name: 'voice', contentType: 'audio/webm', finalKey: key } as never);
    await m.db.insert(m.schema.transcript).values({ recordingId: recId, stream: 'voice', provider: 'openai', status: 'pending' });
    await m.handlers._internal.transcribe({ recordingId: recId }, job);
    expect((await transcriptRow('voice'))!.status).toBe('done');
    const cues = await m.detail.transcriptCues(recId);
    expect(cues.map((c) => c.text)).toEqual(['Bonyeza kitufe.', 'Hakuna kinachotokea.']);
    expect(cues.at(-1)!.endMs).toBeLessThanOrEqual(10_600);
    // billed by chunk length, rounded up per request: 18 s, 11 s and 11 s
    expect(await m.run.dbLedger(m.db).used(m.run.monthOf())).toBe(18 + 11 + 11);
  }, 60_000);

  it('past the monthly cap the next note is skipped with the reason, and nothing is sent', async () => {
    const before = stt.calls;
    const c = await voiceNote(EN);
    await m.handlers._internal.transcribe({ recordingId: recId, assetId: c.voice!.assetId }, job);
    expect(stt.calls).toBe(before);
    const row = await transcriptRow(`voice:${c.voice!.assetId}`);
    expect(row).toMatchObject({ status: 'skipped' });
    expect(row!.error).toMatch(/monthly limit: TRANSCRIBE_MONTHLY_MINUTES=0.75/);
    const again = await m.comments.getComment(ctx, c.id);
    expect(again!.voice!.transcript).toMatchObject({ status: 'skipped', reason: expect.stringMatching(/monthly limit/) });
  }, 60_000);

  it('with transcription off a voice note says so and queues nothing', async () => {
    process.env.TRANSCRIBE_PROVIDER = 'none';
    try {
      const n = (await m.db.select().from(m.schema.job).where(eq(m.schema.job.type, 'transcribe'))).length;
      const c = await voiceNote(EN);
      expect(c.voice!.transcript).toMatchObject({ status: 'skipped', reason: 'transcription is off on this server' });
      expect((await m.db.select().from(m.schema.job).where(eq(m.schema.job.type, 'transcribe'))).length).toBe(n);
    } finally {
      process.env.TRANSCRIBE_PROVIDER = 'openai';
    }
  });

  it('a comment holds one voice note, and only audio is accepted as one', async () => {
    const up = (type: string) => m.upload.storeAsset(m.db, { fields: { kind: 'voice' }, file: new File([EN], 'n', { type }), recordingId: null, userId: user.id });
    await expect(up('text/html')).rejects.toThrow();
    const a = await up('audio/ogg');
    const b = await up('audio/webm');
    await expect(m.comments.createComment(ctx, { body: 'two', attachmentAssetIds: [a.id, b.id], mentions: [] })).rejects.toThrow(/one voice note/);
  });
});
