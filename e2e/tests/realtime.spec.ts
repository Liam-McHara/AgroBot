import { expect, test, type Browser, type Page } from '@playwright/test';
import { IDS } from '../playwright.config.js';

/**
 * M2.5 (roadmap): `me.changed` on `PATCH /me` proves the realtime path end to end — ticket,
 * WebSocket upgrade through the Worker, hibernating socket in the hub, `publish` after the
 * commit, and the Mini App refetching `/me` without a reload (ARCH §7).
 */
async function openAs(browser: Browser, telegramId: string, path: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((id) => {
    window.localStorage.setItem('agrobot.devTelegramId', id);
  }, telegramId);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test('a profile change in one Mini App reaches the same member’s other Mini App live', async ({
  browser,
}) => {
  const watcher = await openAs(browser, IDS.admin, '/#/settings');
  const actor = await openAs(browser, IDS.admin, '/#/settings');
  try {
    await expect(watcher.getByRole('heading', { level: 1 })).toHaveText('Ajustos');

    await actor.getByRole('radio', { name: 'Castellà' }).click();
    await expect(actor.getByRole('heading', { level: 1 })).toHaveText('Ajustes');
    // No reload, no click: the watcher's socket got `me.changed` and the store refetched.
    await expect(watcher.getByRole('heading', { level: 1 })).toHaveText('Ajustes');

    await actor.getByRole('radio', { name: 'Catalán' }).click();
    await expect(watcher.getByRole('heading', { level: 1 })).toHaveText('Ajustos');
  } finally {
    await watcher.context().close();
    await actor.context().close();
  }
});
