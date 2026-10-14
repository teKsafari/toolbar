// Flow L: invite a teammate. Dashboard header Invite, type an email, keep the seat, Invite
// (2 clicks and typing). The mail arrives (Mailpit); the teammate opens it in a browser of
// their own, signs in with a new password and joins in one click. The inviter's members page
// lists them.
import { chromium } from '@playwright/test';
import { PASSWORD, SERVER, api, expect, hydrated, linkIn, mailTo, newEmail, saveShot, test } from './fixture.ts';

test('L: header Invite, email, Invite; the mail joins the teammate; members lists them', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SERVER}/`);
  await hydrated(page);
  const wsId = (await api<{ activeId: string }>(context, 'GET', '/api/v1/workspaces')).body.activeId;

  const mate = newEmail('mate');
  await page.getByTestId('invite-button').click();
  const dlg = page.getByTestId('invite-dialog');
  await dlg.getByLabel('Email address').fill(mate);
  await expect(dlg.getByLabel('Seat')).toHaveValue('creator');
  await dlg.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(dlg.getByText(mate)).toBeVisible(); // listed as pending
  await page.screenshot({ path: saveShot('l-invite-dialog') });
  await page.keyboard.press('Escape');

  const mail = await mailTo(context, mate, /invited you/);
  const join = linkIn(mail.text, `${SERVER}/invite/`);

  // the teammate: a fresh browser, no session
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(join);
    await hydrated(p);
    await expect(p.getByRole('heading', { name: /^Join / })).toBeVisible();
    await p.getByRole('link', { name: 'Sign in to join' }).click();
    await p.waitForURL(/\/login/);
    await hydrated(p);
    await expect(async () => {
      if (!(await p.getByLabel('Password').isVisible())) await p.getByRole('button', { name: 'Use a password instead' }).click({ timeout: 2000 });
      await expect(p.getByLabel('Password')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await p.getByLabel('Work email').fill(mate);
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Continue', exact: true }).click();
    await p.waitForURL(/\/invite\//);
    await hydrated(p);
    await p.getByRole('button', { name: /^Join / }).click();
    await p.waitForURL(/joined=1/);
    await hydrated(p);
    const mine = (await (await p.request.get(`${SERVER}/api/v1/workspaces`)).json()) as { items: { id: string; role: string }[]; activeId: string };
    expect(mine.items.find((w) => w.id === wsId)).toMatchObject({ role: 'creator' });
    expect(mine.activeId).toBe(wsId);
    await p.screenshot({ path: saveShot('l-joined') });
  } finally {
    await browser.close();
  }

  await page.goto(`${SERVER}/settings/members`);
  await hydrated(page);
  await expect(page.getByTestId('member-table')).toContainText(mate);
  await page.close();
});
