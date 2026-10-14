// Editor e2e: instant-replay drafts (J-009 draft side, J-240, J-085, J-197). The capture area
// stores the rrweb slice as NDJSON; the editor shows it as a DOM replay with play and trim.
import { expect, test, LAB_URL } from '../../fixtures/extension.ts';
import { startMock, type MockState } from './mock-server.ts';
import { MOCK_PORT, openEditorInPage, seedDraft, signIn, tabIdOf, type DraftHooks } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

declare const __tbDrafts: DraftHooks;

let mock: MockState;
test.beforeAll(async () => {
  mock = await startMock(MOCK_PORT);
});
test.afterAll(async () => {
  await mock.close();
});

/** A hand-built rrweb recording: a page whose heading reads "Step N" at N seconds, for 40 s. */
function rrwebEvents(t0: number) {
  const node = {
    type: 0,
    id: 1,
    childNodes: [
      { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
      {
        type: 2,
        tagName: 'html',
        attributes: {},
        id: 3,
        childNodes: [
          { type: 2, tagName: 'head', attributes: {}, childNodes: [], id: 4 },
          {
            type: 2,
            tagName: 'body',
            attributes: { style: 'margin:0;background:#fff;font:32px sans-serif' },
            id: 5,
            childNodes: [{ type: 2, tagName: 'h1', attributes: {}, id: 6, childNodes: [{ type: 3, textContent: 'Step 0', id: 7 }] }],
          },
        ],
      },
    ],
  };
  const ev: unknown[] = [
    { type: 4, timestamp: t0, data: { href: 'http://localhost:5173/', width: 1200, height: 700 } },
    { type: 2, timestamp: t0 + 1, data: { node, initialOffset: { left: 0, top: 0 } } },
  ];
  for (let s = 1; s <= 40; s++) {
    ev.push({ type: 3, timestamp: t0 + s * 1000 - 100, data: { source: 0, texts: [{ id: 7, value: `Step ${s}` }], attributes: [], removes: [], adds: [] } });
  }
  return ev;
}

test('replay draft: DOM replay with play and trim (last 30 s), no tools; create uploads streams first and keeps the trim (J-009, J-240, J-085, J-197)', async ({ context, sw }) => {
  await signIn(sw, mock.url);
  mock.finalizes.length = 0;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(LAB_URL);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  const tabId = await tabIdOf(sw, page);
  const t0 = Date.now() - 60_000;
  const id = await seedDraft(sw, {
    tabId,
    kind: 'replay',
    recordingId: null,
    rrweb: rrwebEvents(t0),
    startedAt: t0,
    durationMs: 40_000,
    trim: { startMs: 10_000, endMs: 40_000 },
  });
  // the capture area's stream upload hook: record that it ran, and when
  await sw.evaluate(() => {
    const g = globalThis as unknown as { __streams: { id: string; at: number }[]; __closed: string[] };
    g.__streams = [];
    g.__closed = [];
    (globalThis as unknown as { __realBridge: unknown }).__realBridge = __tbDrafts.setCaptureBridge({
      uploadStreams: async (_d, recordingId) => void g.__streams.push({ id: recordingId, at: Date.now() }),
      draftClosed: async (draftId, how) => void g.__closed.push(`${draftId}:${how}`),
    });
  });

  const f = await openEditorInPage(sw, page, id);
  await expect(f.getByTestId('tool-pill')).toHaveCount(0);
  await expect(f.getByTestId('length')).toHaveText('30 seconds');
  const replay = f.getByTestId('draft-replay');
  await expect(replay).toBeVisible();
  const heading = replay.frameLocator('iframe').locator('h1');
  // the replay sits at the left grip: 10 s in
  await expect(heading).toHaveText('Step 10');
  // it fits the preview: the scaled viewport is no wider than the stage
  const stage = (await replay.boundingBox())!;
  const frame = (await replay.locator('iframe').boundingBox())!;
  expect(frame.width).toBeLessThanOrEqual(stage.width + 1);
  expect(frame.height).toBeLessThanOrEqual(stage.height + 1);

  // play advances the page
  await f.getByTestId('play').click();
  await expect.poll(async () => Number((await heading.textContent())?.replace('Step ', '')), { timeout: 8000 }).toBeGreaterThanOrEqual(12);
  // a click on the replay pauses
  await replay.click();
  await expect(f.getByTestId('play')).toBeVisible();

  // clicking the bar at 75 percent seeks to 30 s
  const track = (await f.getByTestId('trim-track').boundingBox())!;
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  await expect(heading).toHaveText('Step 30');

  // widen the trim to the start: one drag, the length follows
  const g = (await f.getByTestId('grip-start').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + 1, g.y + g.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(f.getByTestId('length')).toHaveText('40 seconds');
  await expect(heading).toHaveText('Step 0');

  const before = Date.now();
  await f.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  const elapsed = Date.now() - before;
  console.log('replay create to finalize', elapsed, 'ms');
  expect(elapsed).toBeLessThan(budget(4000));
  const fin = mock.finalizes[0]!;
  expect((fin.body as { trim: { startMs: number } }).trim.startMs).toBeLessThan(500);
  // the capture was created with the replay's own start time, and streams went up before finalize
  expect(mock.recordings.get(fin.id)?.body.startedAt).toBe(t0);
  const streams = await sw.evaluate(() => (globalThis as unknown as { __streams: { id: string }[] }).__streams);
  expect(streams).toEqual([{ id: fin.id, at: expect.any(Number) }]);
  // and the capture session hears that the draft is done
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __closed: string[] }).__closed)).toEqual([`${id}:created`]);
  // put the worker's real bridge back: later suites in this worker reopen drafts through it
  await sw.evaluate(() => __tbDrafts.setCaptureBridge((globalThis as unknown as { __realBridge: never }).__realBridge));
  await page.close();
});
