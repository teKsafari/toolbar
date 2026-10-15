// Flow B: tab video with the lab's error cases, to a link. Record chord, reproduce the bugs on
// the page, record chord again, title, Ctrl+Enter.
import { expect, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

test('B: record chord, the lab error cases, record chord, Ctrl+Enter gives a link to a ready video', async ({ tb }) => {
  const made = await recordLabErrors(tb);
  expect(made.shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]+$/);
});
