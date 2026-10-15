// Flow C: instant replay of something that already happened. One-time setup in the popup
// (menu, settings, switch), then the bug, then the replay chord and create.
import { expect, test } from './fixture.ts';
import { instantReplay } from './journeys.ts';

test('C: settings switch, the bug happens, replay chord, create gives a link to the replay', async ({ tb }) => {
  const made = await instantReplay(tb);
  expect(made.shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
});
