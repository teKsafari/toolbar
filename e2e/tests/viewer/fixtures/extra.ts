// Extra captures for the viewer e2e suite, on top of the seed (apps/server/scripts/seed.ts):
//   d1 no requests and no user events (J-231)       d2 recording-link capture without logs (J-206)
//   d3 desktop recording across two tabs (J-224)   d4 instant replay with a DOM recording (J-100, J-229)
// Run after the seed: node e2e/tests/viewer/fixtures/extra.ts (reads the worktree .env).
import { gzipSync } from 'node:zlib';
import { createEmitter, STREAM_CONTENT_TYPES, type CaptureEvent } from '@toolbar/shared';
import { db, sqlClient } from '../../../../apps/server/src/lib/server/db/index.ts';
import * as t from '../../../../apps/server/src/lib/server/db/schema/index.ts';
import { keys, putObject } from '../../../../apps/server/src/lib/server/s3.ts';
import { fixtureEnv, FIXTURE_T0, LAB } from '../../../../apps/server/fixtures/events.ts';

const u = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
export const EXTRA = { empty: u(0xd1), link: u(0xd2), desktop: u(0xd3), replay: u(0xd4) };
const WS = u(0xa1);
const DANA = u(0x1);
const RL = u(0x91);
const C1 = u(0xc1);
const C2 = u(0xc2);

function timeline(t0: number) {
  let now = t0;
  const em = { top: createEmitter('top', () => now), sw: createEmitter('sw', () => now), off: createEmitter('off', () => now) };
  const out: CaptureEvent[] = [];
  return {
    at: (ms: number) => void (now = t0 + ms),
    emit: (c: keyof typeof em, kind: CaptureEvent['kind'], data: unknown) => void out.push(em[c](kind as never, data as never) as CaptureEvent),
    out,
  };
}

async function main() {
  const ids = Object.values(EXTRA);
  await sqlClient.unsafe('delete from recording where id = any($1::uuid[])', [ids]);
  const base = {
    organizationId: WS,
    status: 'ready' as const,
    authorUserId: DANA,
    authorName: 'Dana Reviewer',
    authorEmail: 'dana@nib.test',
  };
  const putEvents = async (id: string, events: CaptureEvent[]) => {
    await putObject(keys.final(id, 'events.json.gz'), gzipSync(JSON.stringify(events)), 'application/gzip');
    await db.insert(t.recordingStream).values({ recordingId: id, name: 'events', contentType: STREAM_CONTENT_TYPES.events, lastSeq: 0, totalBytes: 1, completedAt: new Date(), finalKey: keys.final(id, 'events.json.gz') });
  };
  const reuseVideo = (id: string) =>
    db.insert(t.recordingStream).values({ recordingId: id, name: 'video', contentType: 'video/webm', lastSeq: 7, totalBytes: 1, completedAt: new Date(), finalKey: keys.final(C1, 'video.webm') });

  // d1: a screenshot with nothing but the page load
  {
    const t0 = FIXTURE_T0 + 9_000_000;
    const tl = timeline(t0);
    tl.emit('top', 'env', fixtureEnv(`${LAB}/canvas`, 'Canvas - Lab shop'));
    tl.emit('top', 'nav', { type: 'load', url: `${LAB}/canvas`, title: 'Canvas - Lab shop' });
    await db.insert(t.recording).values({ ...base, id: EXTRA.empty, clientId: u(0xe0d1), kind: 'screenshot', title: 'Quiet canvas page', pageUrl: `${LAB}/canvas`, startedAt: new Date(t0), createdAt: new Date(t0 + 1000), updatedAt: new Date(t0 + 1000), env: tl.out[0]!.data });
    await putEvents(EXTRA.empty, tl.out);
    await db.insert(t.asset).values({ recordingId: EXTRA.empty, kind: 'screenshot', s3Key: keys.asset(C2, u(0xe2)), contentType: 'image/png', width: 1280, height: 720, bytes: 1 });
  }

  // d2: a recording-link capture: video only, no logs
  await db.insert(t.recording).values({ ...base, id: EXTRA.link, clientId: u(0xe0d2), kind: 'video', title: 'Customer recording from the support link', pageUrl: `${LAB}/checkout`, recordingLinkId: RL, durationMs: 8000, startedAt: new Date(FIXTURE_T0 + 9_100_000), createdAt: new Date(FIXTURE_T0 + 9_110_000), updatedAt: new Date(FIXTURE_T0 + 9_110_000), authorUserId: null, authorName: 'Guest', authorEmail: null });
  await reuseVideo(EXTRA.link);

  // d3: desktop recording, requests from two tabs, one to the lab's real 500 endpoint
  {
    const t0 = FIXTURE_T0 + 9_200_000;
    const tl = timeline(t0);
    tl.emit('top', 'env', fixtureEnv(`${LAB}/`, 'Lab'));
    tl.emit('off', 'media', { stream: 'screen', op: 'start', mime: 'video/webm', width: 1280, height: 720 });
    tl.at(400);
    tl.emit('top', 'net.req', { rid: 'a-0', method: 'GET', url: `${LAB}/api/ok`, initiator: 'fetch', source: 'page', tabId: 101 });
    tl.at(520);
    tl.emit('top', 'net.res', { rid: 'a-0', status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"ok":true}', contentType: 'application/json', timing: { start: t0 + 400, end: t0 + 520 }, source: 'page' });
    tl.at(2000);
    tl.emit('top', 'net.req', { rid: 'b-0', method: 'POST', url: `${LAB}/api/fail`, headers: { 'content-type': 'application/json', cookie: '[redacted]' }, body: '{"cart":42}', initiator: 'fetch', source: 'page', tabId: 102 });
    tl.at(2100);
    tl.emit('top', 'net.res', { rid: 'b-0', status: 500, statusText: 'Internal Server Error', headers: { 'content-type': 'application/json' }, body: '{"error":"database_unavailable","detail":"connection refused to db:5432"}', contentType: 'application/json', timing: { start: t0 + 2000, end: t0 + 2100 }, source: 'page' });
    tl.at(7900);
    tl.emit('off', 'media', { stream: 'screen', op: 'stop' });
    await db.insert(t.recording).values({ ...base, id: EXTRA.desktop, clientId: u(0xe0d3), kind: 'screen', title: 'Desktop recording across two tabs', pageUrl: `${LAB}/`, durationMs: 8000, startedAt: new Date(t0), createdAt: new Date(t0 + 9000), updatedAt: new Date(t0 + 9000), env: tl.out[0]!.data });
    await putEvents(EXTRA.desktop, tl.out);
    await reuseVideo(EXTRA.desktop);
  }

  // d4: instant replay with an rrweb stream (no video)
  {
    const t0 = FIXTURE_T0 + 9_300_000;
    const tl = timeline(t0);
    tl.emit('top', 'env', fixtureEnv(`${LAB}/`, 'Lab'));
    tl.emit('top', 'nav', { type: 'load', url: `${LAB}/`, title: 'Lab' });
    tl.at(1500);
    tl.emit('top', 'user', { type: 'click', target: { selector: '#boom', tag: 'button', text: 'Throw', elId: 'boom', rect: { x: 40, y: 120, w: 120, h: 40 } }, x: 100, y: 140 });
    tl.at(1520);
    tl.emit('top', 'error', { type: 'error', name: 'Error', message: 'Boom from the lab', stack: `Error: Boom from the lab\n    at onclick (${LAB}/_app/x.js:1:1)` });
    tl.at(5000);
    tl.emit('top', 'console', { level: 'log', args: ['still here'] });
    const el = (id: number, tagName: string, attributes: Record<string, string>, childNodes: unknown[]) => ({ type: 2, tagName, attributes, childNodes, id });
    const text = (id: number, textContent: string) => ({ type: 3, textContent, id });
    const rr = [
      { type: 4, timestamp: t0, data: { href: `${LAB}/`, width: 1280, height: 720 } },
      {
        type: 2,
        timestamp: t0 + 10,
        data: {
          initialOffset: { left: 0, top: 0 },
          node: {
            type: 0,
            id: 1,
            childNodes: [
              { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
              el(3, 'html', {}, [
                el(4, 'head', {}, []),
                el(5, 'body', { style: 'font-family: sans-serif; margin: 40px; background: #fff' }, [
                  el(6, 'h1', {}, [text(7, 'Lab replay page')]),
                  el(8, 'button', { id: 'boom', style: 'padding: 10px 20px; font-size: 18px' }, [text(9, 'Throw')]),
                  el(10, 'p', { id: 'status' }, [text(11, 'Waiting')]),
                ]),
              ]),
            ],
          },
        },
      },
      { type: 3, timestamp: t0 + 500, data: { source: 1, positions: [{ x: 300, y: 300, id: 5, timeOffset: 0 }] } },
      { type: 3, timestamp: t0 + 1200, data: { source: 1, positions: [{ x: 100, y: 140, id: 8, timeOffset: 0 }] } },
      { type: 3, timestamp: t0 + 1500, data: { source: 2, type: 2, id: 8, x: 100, y: 140 } },
      { type: 3, timestamp: t0 + 1600, data: { source: 0, texts: [{ id: 11, value: 'Something broke' }], attributes: [], removes: [], adds: [] } },
      { type: 3, timestamp: t0 + 4000, data: { source: 1, positions: [{ x: 600, y: 400, id: 5, timeOffset: 0 }] } },
      { type: 3, timestamp: t0 + 6000, data: { source: 0, texts: [{ id: 11, value: 'Done' }], attributes: [], removes: [], adds: [] } },
    ];
    await db.insert(t.recording).values({ ...base, id: EXTRA.replay, clientId: u(0xe0d4), kind: 'replay', title: 'Instant replay of the throw button', pageUrl: `${LAB}/`, durationMs: 6000, startedAt: new Date(t0), createdAt: new Date(t0 + 9000), updatedAt: new Date(t0 + 9000), env: tl.out[0]!.data });
    await putEvents(EXTRA.replay, tl.out);
    const body = gzipSync(rr.map((e) => JSON.stringify(e)).join('\n') + '\n');
    const key = keys.chunk(EXTRA.replay, 'rrweb', 0);
    await putObject(key, body, 'application/gzip');
    await db.insert(t.recordingStream).values({ recordingId: EXTRA.replay, name: 'rrweb', contentType: STREAM_CONTENT_TYPES.rrweb, lastSeq: 0, totalBytes: body.length, completedAt: new Date() });
    await db.insert(t.recordingChunk).values({ recordingId: EXTRA.replay, stream: 'rrweb', seq: 0, s3Key: key, bytes: body.length, sha256: '0'.repeat(64) });
  }
  console.log('[extra] captures', ids.join(' '));
}

try {
  await main();
} finally {
  await sqlClient.end();
}
