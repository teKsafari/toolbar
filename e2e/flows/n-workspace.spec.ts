// Flow N: create a workspace. Workspace menu, "Create or join a workspace", a name, keep the
// same-domain box, Next (2 clicks and typing, then Next). The new workspace is active; the menu
// switches back, so the flows after this one keep the first workspace.
import { SERVER, api, expect, hydrated, saveShot, test } from './fixture.ts';

type Ws = { items: { id: string; name: string; role: string; isOwner: boolean }[]; activeId: string };

test('N: workspace menu, create, name, Next; the new workspace is active; switch back from the menu', async ({ context }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SERVER}/`);
  await hydrated(page);
  const before = (await api<Ws>(context, 'GET', '/api/v1/workspaces')).body;
  const first = before.items.find((w) => w.id === before.activeId)!;

  try {
    await page.getByTestId('workspace-menu').click();
    await page.getByRole('menuitem', { name: 'Create or join a workspace' }).click();
    await hydrated(page);
    await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
    await expect(page.getByRole('checkbox')).toBeChecked();
    const name = `Flows N ${Date.now().toString(36)}`;
    await page.getByLabel('Workspace name').fill(name);
    await page.screenshot({ path: saveShot('n-create') });
    await page.getByRole('button', { name: 'Next' }).click();
    await page.waitForURL(/\/\?created=1/);
    await hydrated(page);
    await expect(page.getByTestId('workspace-menu')).toContainText(name);
    const after = (await api<Ws>(context, 'GET', '/api/v1/workspaces')).body;
    const made = after.items.find((w) => w.name === name);
    expect(made).toMatchObject({ role: 'admin', isOwner: true });
    expect(after.activeId).toBe(made!.id);
    await page.screenshot({ path: saveShot('n-created') });
  } finally {
    // back to the first workspace from the menu
    await page.getByTestId('workspace-menu').click();
    await page.getByRole('menuitem', { name: new RegExp(first.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
    await expect(page.getByTestId('workspace-menu')).toContainText(first.name);
    expect((await api<Ws>(context, 'GET', '/api/v1/workspaces')).body.activeId).toBe(first.id);
  }
  await page.close();
});
