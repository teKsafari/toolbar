// Flow G: comment at a moment in the video. Seek with the seek bar, click the composer, type,
// Ctrl+Enter. The comment carries the time and shows as a bubble on the timeline.
import { SERVER, api, expect, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

test('G: seek, type, Ctrl+Enter adds a timed comment and a timeline bubble', async ({ nib, context }) => {
  const made = await recordLabErrors(nib);
  const page = await context.newPage();
  await page.goto(made.shareUrl); // a member is sent on to the capture page
  await page.waitForURL(new RegExp(`${SERVER}/c/${made.id}`));
  await page.locator('[data-hydrated]').waitFor();
  const video = page.getByTestId('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThan(0);

  const bar = (await page.getByTestId('seekbar').boundingBox())!;
  await page.mouse.click(bar.x + bar.width * 0.4, bar.y + bar.height / 2);
  await expect(page.getByTestId('send')).toContainText(/at 0:0\d/);
  const at = ((await page.getByTestId('send').textContent()) ?? '').match(/0:0\d/)![0];

  const input = page.getByTestId('comment-input');
  await input.click();
  const body = `Flow G: the order fails here ${Date.now().toString(36)}`;
  await page.keyboard.type(body);
  const t0 = Date.now();
  await page.keyboard.press('Control+Enter');
  await expect(input).toHaveValue('');
  console.log('G: composer cleared after', Date.now() - t0, 'ms');
  const c = page.getByTestId('comment').filter({ hasText: body });
  await expect(c).toBeVisible();
  await expect(c.getByTestId('comment-time')).toHaveText(at);
  await expect(page.getByTestId('marker-comment').first()).toBeVisible();

  const list = await api<{ items: { body: string; tMs: number | null }[] }>(context, 'GET', `/api/v1/recordings/${made.id}/comments`);
  const saved = (list.body.items ?? (list.body as unknown as { body: string; tMs: number | null }[])).find((x) => x.body === body);
  expect(saved, JSON.stringify(list.body).slice(0, 300)).toBeTruthy();
  expect(saved!.tMs).toBeGreaterThan(0);
  await page.close();
});
