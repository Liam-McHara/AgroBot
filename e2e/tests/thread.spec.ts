import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { E2E_PORT, E2E_TELEGRAM_URL, IDS } from '../playwright.config.js';

/**
 * M5 definition of done (roadmap): two browser contexts on the same reservation exchange
 * messages that appear on the other side without a reload; when one party has closed the app,
 * three messages earn it exactly one N9 (fake Telegram); coming back, the Reservations tab and
 * the row carry the count, and opening the thread clears it. Along the way a transition from
 * the header shows up as a system line on the other side. Runs last (alphabetically), on the
 * offer and the catalogue the earlier specs leave behind, and publishes its own offer when
 * there is none.
 */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function openAs(browser: Browser, telegramId: string, path: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((id) => {
    window.localStorage.setItem('agrobot.devTelegramId', id);
  }, telegramId);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

interface InlineButton {
  text: string;
  url?: string;
}

interface SentMessage {
  chat_id: number | string;
  text: string;
  reply_markup?: { inline_keyboard: InlineButton[][] };
}

/** The N9 rows that reached one member's Telegram. */
const chatPings = async (request: APIRequestContext, telegramId: string) => {
  const all = (await (await request.get(`${E2E_TELEGRAM_URL}/messages`)).json()) as SentMessage[];
  return all.filter((m) => String(m.chat_id) === telegramId && m.text.includes("t'ha escrit"));
};

async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel('Missatge').fill(text);
  await page.getByTestId('send').click();
  // Acknowledged: the pending bubble was replaced by the server's copy.
  await expect(
    page.getByTestId('message').filter({ hasText: text }).and(page.locator('[data-pending]')),
  ).toHaveCount(0);
  await expect(page.getByTestId('message').filter({ hasText: text })).toHaveCount(1);
}

test('the two parties chat live, an absent party gets one notification per burst, and opening the thread clears the badge', async ({
  browser,
  request,
}) => {
  // The catalogue the earlier specs leave behind may have archived "Ous": put it back.
  const admin = await openAs(browser, IDS.admin, '/#/admin/catalog');
  writeFileSync(
    join(tmpdir(), `agrobot-e2e-catalog-${E2E_PORT}.csv`),
    'Producte,Unitat,Preu\nOus,dotzena,3.10\n',
  );
  await admin.getByRole('button', { name: 'Sincronitza ara' }).click();
  await expect(admin.getByTestId('catalog-product').filter({ hasText: 'Ous' })).toContainText(
    'Actiu',
  );
  await admin.context().close();

  const producer = await openAs(browser, IDS.producer, '/#/offers');
  const requester = await openAs(browser, IDS.admin, '/');
  let producerBack: Page | null = null;
  try {
    // An Ous offer to reserve from: the one reservations.spec left, or a fresh one.
    await expect(producer.getByRole('heading', { level: 1 })).toHaveText('Ofertes');
    await expect(requester.getByRole('heading', { level: 1 })).toHaveText('Tauler');
    const row = requester
      .getByTestId('board-group')
      .filter({ hasText: 'Ous' })
      .getByTestId('offer');
    if ((await row.count()) === 0) {
      await producer.getByTestId('publish').click();
      await producer.getByRole('searchbox').fill('Ous');
      await producer.getByRole('button', { name: /^Ous/ }).click();
      await producer.getByLabel('Quantitat (dotzena)').fill('6');
      await producer.getByRole('button', { name: 'Publica una oferta' }).click();
    }
    await expect(row).toBeVisible();
    await row.click();
    const sheet = requester.getByRole('dialog');
    await sheet.getByLabel('Quantitat a reservar (dotzena)').fill('1');
    await sheet.getByTestId('reserve').click();

    // The requester lands on the reservation with its thread; the producer opens the same one.
    await expect(requester.getByRole('heading', { level: 1 })).toHaveText('Reserva');
    await expect(requester.getByTestId('system-line')).toContainText('ha fet la reserva');
    const reservationId = (await requester.evaluate(() => window.location.hash)).replace(
      '#/reservations/',
      '',
    );
    expect(reservationId).toMatch(/^[0-9a-f-]{36}$/);
    await producer.goto(`/#/reservations/${reservationId}`);
    await expect(producer.getByTestId('thread')).toBeVisible();
    await expect(producer.getByTestId('open-in-telegram')).toHaveCount(0); // no username, US-5.2

    // Messages appear on the other side without a reload, both ways (US-5.1).
    await send(requester, 'Hola! Demà a les 10?');
    await expect(
      producer.getByTestId('message').filter({ hasText: 'Hola! Demà a les 10?' }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      producer.getByTestId('message').filter({ hasText: 'Hola! Demà a les 10?' }),
    ).toHaveAttribute('data-mine', 'false');
    await send(producer, 'Bon dia, perfecte');
    await expect(
      requester.getByTestId('message').filter({ hasText: 'Bon dia, perfecte' }),
    ).toBeVisible({ timeout: 2_000 });

    // A transition from the header is a system line on the other side.
    await producer.getByRole('button', { name: 'Confirma', exact: true }).click();
    await expect(
      requester.getByTestId('system-line').filter({ hasText: 'ha confirmat la reserva' }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(requester.getByTestId('reservation-detail')).toHaveAttribute(
      'data-status',
      'confirmed',
    );

    // Both were looking: no chat notification travelled so far.
    const pingsBefore = (await chatPings(request, IDS.producer)).length;

    // The producer closes the app; three messages earn exactly one N9, quoting the first.
    await producer.context().close();
    await send(requester, 'Un: porto la caixa');
    await send(requester, 'Dos');
    await send(requester, 'Tres');
    await expect
      .poll(async () => (await chatPings(request, IDS.producer)).length, { timeout: 20_000 })
      .toBe(pingsBefore + 1);
    const ping = (await chatPings(request, IDS.producer)).at(-1)!;
    expect(ping.text).toContain('«Un: porto la caixa»');
    expect(ping.text).toContain('1 dotzena de Ous');
    const [button] = ping.reply_markup!.inline_keyboard.flat();
    expect(button).toMatchObject({ text: 'Obre la conversa' });
    expect(button!.url).toContain(`startapp=r_${reservationId}`);
    // The dispatcher had time for the other two: still one.
    await requester.waitForTimeout(3_000);
    expect(await chatPings(request, IDS.producer)).toHaveLength(pingsBefore + 1);

    // Back: the tab and the row count the three; opening the thread clears them (US-4.6).
    producerBack = await openAs(browser, IDS.producer, '/#/reservations');
    await expect(producerBack.getByTestId('nav-unread')).toHaveText('3');
    const incoming = producerBack
      .getByTestId('reservation')
      .filter({ has: producerBack.getByTestId('reservation-unread') });
    await expect(incoming).toHaveCount(1);
    await expect(incoming.getByTestId('reservation-unread')).toHaveText('3');
    await incoming.click();
    await expect(producerBack.getByTestId('message').filter({ hasText: 'Tres' })).toBeVisible();
    await expect(producerBack.getByTestId('nav-unread')).toHaveCount(0);

    // Looking again: a fourth message arrives live and earns no notification.
    await send(requester, 'Quatre');
    await expect(producerBack.getByTestId('message').filter({ hasText: 'Quatre' })).toBeVisible({
      timeout: 2_000,
    });
    await requester.waitForTimeout(3_000);
    expect(await chatPings(request, IDS.producer)).toHaveLength(pingsBefore + 1);
    await expect(producerBack.getByTestId('nav-unread')).toHaveCount(0);
  } finally {
    await requester.context().close();
    await producerBack?.context().close();
  }
});
