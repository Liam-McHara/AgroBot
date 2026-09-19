import { expect, test, type Browser, type Page } from '@playwright/test';
import { IDS } from '../playwright.config.js';

/**
 * M1 definition of done (roadmap): applicant → admin approves → applicant sees the board
 * shell. Two browser contexts sign in as two Telegram ids through the dev bypass (ARCH §4).
 */
test.describe.configure({ mode: 'serial' });

async function openAs(browser: Browser, telegramId: string, path = '/'): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((id) => {
    window.localStorage.setItem('agrobot.devTelegramId', id);
  }, telegramId);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test('a stranger waits at the gate until an admin approves them', async ({ browser }) => {
  const applicant = await openAs(browser, IDS.applicant);
  const gate = applicant.getByTestId('gate');
  await expect(gate).toHaveAttribute('data-status', 'pending');
  await expect(applicant.getByRole('heading')).toHaveText('Sol·licitud enviada');
  await expect(applicant.getByRole('navigation')).toHaveCount(0);

  const admin = await openAs(browser, IDS.admin, '/#/admin/members');
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Membres');
  const row = admin.getByTestId('applicant');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(`id ${IDS.applicant}`);
  await row.getByRole('button', { name: 'Aprova' }).click();
  await expect(admin.getByTestId('applicant')).toHaveCount(0);
  await expect(admin.getByText('No hi ha cap sol·licitud pendent.')).toBeVisible();

  // No click: the approval reached the applicant's socket as `me.changed` (ARCH §7).
  await expect(applicant.getByRole('heading', { level: 1 })).toHaveText('Tauler');
  await expect(applicant.getByRole('searchbox')).toBeVisible();
  const nav = applicant.getByRole('navigation');
  await expect(nav.getByRole('link')).toHaveCount(4);
  for (const name of ['Tauler', 'Ofertes', 'Reserves', 'Ajustos']) {
    await expect(nav.getByRole('link', { name })).toBeVisible();
  }
  // No Admin tab for a plain member (ARCH §12).
  await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
});

test('a member switches language and it sticks across the app', async ({ browser }) => {
  const admin = await openAs(browser, IDS.admin, '/#/settings');
  await admin.getByRole('radio', { name: 'Castellà' }).click();
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Ajustes');
  await expect(admin.getByRole('navigation').getByRole('link', { name: 'Tablón' })).toBeVisible();

  // Persisted server-side: a relaunch comes back in Spanish.
  await admin.reload();
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Ajustes');
  await admin.getByRole('radio', { name: 'Catalán' }).click();
  await expect(admin.getByRole('heading', { level: 1 })).toHaveText('Ajustos');
});

test('the last admin cannot demote themself', async ({ browser }) => {
  const admin = await openAs(browser, IDS.admin, '/#/admin/members');
  await admin.getByRole('tab', { name: /Membres/ }).click();
  const me = admin.getByTestId('member').filter({ hasText: '(tu)' });
  await me.getByRole('button', { name: "Treu-li l'admin" }).click();
  await expect(admin.getByRole('alert')).toContainText('sense cap administrador');
});
