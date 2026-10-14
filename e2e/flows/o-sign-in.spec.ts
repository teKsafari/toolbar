// Flow O: sign in. The worker fixture already connected the extension through the popup and
// the auth window (connectExtension); this checks what the user sees afterwards.
import { SERVER, expect, hydrated, labPage, openPopup, test } from './fixture.ts';

test('O: the popup shows the account and the capture rows; settings lists this browser', async ({ nib, context }) => {
  const lab = await labPage(context);
  const popup = await openPopup(context, lab);
  await expect(popup.getByTestId('signed-in')).toContainText(nib.email);
  await expect(popup.getByTestId('signed-out')).toHaveCount(0);
  for (const name of [/Screenshot/, /Record this tab/, /Recording link/]) await expect(popup.getByRole('button', { name }).first()).toBeVisible();
  await popup.close();

  const web = await context.newPage();
  await web.goto(`${SERVER}/settings/browsers`);
  await hydrated(web);
  await expect(web.getByTestId('device-list')).toContainText(/on (Linux|macOS|Windows)/);
  await web.close();
  await lab.close();
});
