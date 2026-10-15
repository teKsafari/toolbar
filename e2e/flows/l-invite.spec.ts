// Flow L: invite a teammate. Dashboard header Invite, type an email, keep the seat, then
// "Copy invite link": the server sends no mail (docs/scope.md, invites by link), so the inviter
// passes the person's own link on. With FEATURE_EMAIL on the button says Invite and the link
// arrives by mail (Mailpit). The teammate opens it in a browser of their own, signs in through
// the identity provider and joins in one click. The inviter's members page lists them.
import { chromium } from '@playwright/test';
import { SERVER, api, clipboard, expect, featureOn, hydrated, linkIn, mailTo, newEmail, saveShot, signInOidc, test } from './fixture.ts';

test('L: header Invite, email, copy the invite link; the link joins the teammate; members lists them', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SERVER}/`);
  await hydrated(page);
  const wsId = (await api<{ activeId: string }>(context, 'GET', '/api/v1/workspaces')).body.activeId;
  const mailOn = await featureOn('email');

  const mate = newEmail('mate');
  await page.getByTestId('invite-button').click();
  const dlg = page.getByTestId('invite-dialog');
  await dlg.getByLabel('Email address').fill(mate);
  await expect(dlg.getByLabel('Seat')).toHaveValue('creator');
  const submit = dlg.getByTestId('invite-submit');
  await expect(submit).toHaveText(mailOn ? 'Invite' : 'Copy invite link');
  await submit.click();
  await expect(dlg.getByText(mate)).toBeVisible(); // listed as pending
  await page.screenshot({ path: saveShot('l-invite-dialog') });
  let join: string;
  if (mailOn) join = linkIn((await mailTo(context, mate, /invited you/)).text, `${SERVER}/invite/`);
  else {
    await expect(page.getByRole('status').filter({ hasText: `Invite link for ${mate} copied` })).toBeVisible();
    await expect.poll(() => clipboard(), { timeout: 10_000 }).toMatch(new RegExp(`^${SERVER}/invite/`));
    join = clipboard();
  }
  await page.keyboard.press('Escape');

  // the teammate: a fresh browser, no session
  const browser = await chromium.launch();
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(join);
    await hydrated(p);
    await expect(p.getByRole('heading', { name: /^Join / })).toBeVisible();
    await p.getByRole('link', { name: 'Sign in to join' }).click();
    await p.waitForURL(/\/login/);
    await signInOidc(p, SERVER, mate, { next: new URL(join).pathname });
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
