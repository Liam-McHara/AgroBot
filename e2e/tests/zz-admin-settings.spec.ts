import { expect, test } from '@playwright/test';
import { IDS } from '../playwright.config.js';

test('admin saves validated settings and members see the runtime values', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext();
  await context.addInitScript((id) => localStorage.setItem('agrobot.devTelegramId', id), IDS.admin);
  const page = await context.newPage();
  const headers = { authorization: `dev ${IDS.admin}` };
  const before = await request.get('/api/admin/settings', { headers });
  expect(before.ok()).toBe(true);
  const original: unknown = await before.json();
  try {
    await page.goto('/#/admin/settings');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Configuració del grup');
    const nudge = page.getByLabel('Dies abans de recordar una oferta', { exact: true });
    const save = page.getByRole('button', { name: 'Desa', exact: true });
    await nudge.fill('0');
    await expect(save).toBeDisabled();
    await nudge.fill('5');
    await page.getByLabel('Notifica les ofertes noves').uncheck();
    await save.click();
    await expect(save).toBeDisabled();
    await page.reload();
    await expect(nudge).toHaveValue('5');
    await expect(page.getByRole('checkbox')).not.toBeChecked();
    const memberHeaders = { authorization: `dev ${IDS.producer}` };
    expect((await request.get('/api/admin/settings', { headers: memberHeaders })).status()).toBe(
      403,
    );
    const me = await request.get('/api/me', { headers: memberHeaders });
    expect(await me.json()).toMatchObject({
      settings: { offer_nudge_days: 5, notify_new_offer: false },
    });
  } finally {
    const restore = await request.patch('/api/admin/settings', { headers, data: original });
    expect(restore.ok()).toBe(true);
    await context.close();
  }
});
