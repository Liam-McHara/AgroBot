import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, type Browser } from '@playwright/test';
import { E2E_PORT, IDS } from '../playwright.config.js';

const fixture = join(tmpdir(), `agrobot-e2e-catalog-${E2E_PORT}.csv`);
async function openAs(browser: Browser, id: string, path: string) {
  const context = await browser.newContext();
  await context.addInitScript(
    (telegramId) => localStorage.setItem('agrobot.devTelegramId', telegramId),
    id,
  );
  const page = await context.newPage();
  await page.goto(path);
  return { page, context };
}

test('catalogue imports, resolves a member proposal, reports row errors and preserves an empty sync', async ({
  browser,
}) => {
  const farmer = await openAs(browser, '900000001', '/#/offers');
  const admin = await openAs(browser, IDS.admin, '/#/admin/catalog');
  try {
    await expect(admin.page.getByRole('heading', { level: 1 })).toHaveText('Catàleg');
    // The picker opens from *Publish an offer* (M3); proposing is its empty-search action.
    await farmer.page.getByTestId('publish').click();
    await farmer.page.getByRole('searchbox').fill('tomàquet cor de bou');
    await farmer.page.getByRole('button', { name: 'Proposa «tomàquet cor de bou»' }).click();
    await expect(farmer.page.getByText('Preu pendent')).toBeVisible();
    await admin.page.reload();
    let proposal = admin.page
      .getByTestId('catalog-product')
      .filter({ hasText: 'tomàquet cor de bou' });
    await expect(proposal).toContainText('Pendent');
    writeFileSync(
      fixture,
      'Producte,Unitat,Preu\nOus,dotzena,3.10\nTomàquet cor de bou,kg,"2,40"\nCarbassó,sac,1\n',
    );
    await admin.page.getByRole('button', { name: 'Sincronitza ara' }).click();
    await expect(admin.page.getByText('Unitat desconeguda.')).toBeVisible();
    const errorRow = admin.page.getByRole('row').filter({ hasText: 'Unitat desconeguda.' });
    await expect(errorRow.getByRole('cell').first()).toHaveText('4');
    proposal = admin.page.getByTestId('catalog-product').filter({ hasText: 'Tomàquet cor de bou' });
    await expect(proposal).toContainText('Actiu');
    await expect(proposal).toContainText(/2,40\s*€/);
    await farmer.page.reload();
    await farmer.page.getByTestId('publish').click();
    await farmer.page.getByRole('searchbox').fill('cor de bou');
    await expect(farmer.page.getByRole('button', { name: /Tomàquet cor de bou/ })).toContainText(
      /2,40\s*€/,
    );
    writeFileSync(fixture, 'Producte,Unitat,Preu\nTomàquet cor de bou,kg,2.75\n');
    await admin.page.getByRole('button', { name: 'Sincronitza ara' }).click();
    await expect(proposal).toContainText(/2,75\s*€/);
    await expect(
      admin.page.getByTestId('catalog-product').filter({ hasText: 'Ous' }),
    ).toContainText('Arxivat');
    writeFileSync(fixture, 'Producte,Unitat,Preu\n');
    await admin.page.getByRole('button', { name: 'Sincronitza ara' }).click();
    await expect(admin.page.getByText('Cap fila vàlida: el catàleg s’ha conservat.')).toBeVisible();
    await expect(proposal).toContainText(/2,75\s*€/);
  } finally {
    await farmer.context.close();
    await admin.context.close();
  }
});
