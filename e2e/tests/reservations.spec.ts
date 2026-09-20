import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import {
  E2E_BASE_URL,
  E2E_PORT,
  E2E_TELEGRAM_URL,
  E2E_WEBHOOK_SECRET,
  IDS,
} from '../playwright.config.js';

/**
 * M4 definition of done (roadmap): requester reserves → producer gets N6 (fake Telegram) and
 * confirms from its quick action, which arrives at the real webhook → requester sees the status
 * live → producer marks delivered → the offer's quantity is reduced accordingly. Then a second
 * reservation goes pending → delivered through *confirm and mark delivered* (ADR-0014), leaving
 * both timestamps and exactly one delivered notification. Two browser contexts through the dev
 * bypass (ARCH §4); every notification travels outbox → hub alarm → dispatcher → the fake Bot
 * API of start-server.mjs, whose recorded messages the spec reads at `GET /messages`.
 */
// Each flow chains several notification round trips through the hub's alarm (~1 s each).
test.describe.configure({ mode: 'serial', timeout: 90_000 });

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
  callback_data?: string;
  url?: string;
}

interface SentMessage {
  chat_id: number | string;
  text: string;
  reply_markup?: { inline_keyboard: InlineButton[][] };
}

const sentTo = async (request: APIRequestContext, telegramId: string): Promise<SentMessage[]> => {
  const all = (await (await request.get(`${E2E_TELEGRAM_URL}/messages`)).json()) as SentMessage[];
  return all.filter((m) => String(m.chat_id) === telegramId);
};

/** Tap a quick action the way Telegram would: a callback_query update to the webhook. */
async function tapQuickAction(
  request: APIRequestContext,
  from: string,
  message: SentMessage,
  data: string,
): Promise<void> {
  const response = await request.post(`${E2E_BASE_URL}/telegram/webhook`, {
    headers: { 'x-telegram-bot-api-secret-token': E2E_WEBHOOK_SECRET },
    data: {
      update_id: Date.now(),
      callback_query: {
        id: String(Date.now()),
        chat_instance: 'e2e',
        from: { id: Number(from), is_bot: false, first_name: 'Marta' },
        data,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(from), type: 'private', first_name: 'Marta' },
          text: message.text,
        },
      },
    },
  });
  expect(response.ok()).toBe(true);
}

test('a reservation goes pending → confirmed from the quick action → delivered, and deducts from the offer', async ({
  browser,
  request,
}) => {
  // The specs share one catalogue and catalog.spec leaves "Ous" archived: put it back with its
  // price through the same CSV fixture and *Sync now*, so the totals below are real money.
  const admin = await openAs(browser, IDS.admin, '/#/admin/catalog');
  writeFileSync(
    join(tmpdir(), `agrobot-e2e-catalog-${E2E_PORT}.csv`),
    'Producte,Unitat,Preu\nOus,dotzena,3.10\nTomàquet cor de bou,kg,2.75\n',
  );
  await admin.getByRole('button', { name: 'Sincronitza ara' }).click();
  await expect(admin.getByTestId('catalog-product').filter({ hasText: 'Ous' })).toContainText(
    'Actiu',
  );
  await admin.context().close();

  const producer = await openAs(browser, IDS.producer, '/#/offers');
  const requester = await openAs(browser, IDS.admin, '/');
  try {
    // The producer publishes 6 dozen eggs ("Ous", 3,10 € from the sheet).
    await expect(producer.getByRole('heading', { level: 1 })).toHaveText('Ofertes');
    await producer.getByTestId('publish').click();
    await producer.getByRole('searchbox').fill('Ous');
    await producer.getByRole('button', { name: /^Ous/ }).click();
    await producer.getByLabel('Quantitat (dotzena)').fill('6');
    await producer.getByRole('button', { name: 'Publica una oferta' }).click();
    // The specs share one database: offers.spec left an offer of its own on both screens.
    const mine = producer.getByTestId('my-offer').filter({ hasText: 'Ous' });
    await expect(mine).toContainText('6 dotzena en total');

    // The requester reserves 2 from the board's detail sheet (US-4.1).
    const row = requester
      .getByTestId('board-group')
      .filter({ hasText: 'Ous' })
      .getByTestId('offer');
    await expect(row).toContainText('6 dotzena disponibles');
    await row.click();
    const sheet = requester.getByRole('dialog');
    await sheet.getByLabel('Quantitat a reservar (dotzena)').fill('2');
    await expect(sheet.getByTestId('reserve-total')).toContainText('6,20');
    await sheet.getByTestId('reserve').click();

    // She lands on the reservation, pending; the producer sees it held.
    await expect(requester.getByRole('heading', { level: 1 })).toHaveText('Reserva');
    const detail = requester.getByTestId('reservation-detail');
    await expect(detail).toHaveAttribute('data-status', 'pending');
    await expect(detail).toContainText('A Marta (dev)');
    await expect(detail).toContainText('6,20');
    const reservationId = (await requester.evaluate(() => window.location.hash)).replace(
      '#/reservations/',
      '',
    );
    expect(reservationId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(mine).toContainText('2 dotzena reservats');
    await expect(mine).toContainText('4 dotzena disponibles');

    // N6 reached the producer's Telegram with Confirm · Reject · Open.
    await expect
      .poll(
        async () =>
          (await sentTo(request, IDS.producer)).filter((m) => m.text.includes('vol reservar')),
        { timeout: 20_000 },
      )
      .toHaveLength(1);
    const n6 = (await sentTo(request, IDS.producer)).find((m) => m.text.includes('vol reservar'))!;
    expect(n6.text).toContain('vol reservar 2 dotzena de Ous');
    const buttons = n6.reply_markup!.inline_keyboard.flat();
    expect(buttons.map((b) => b.text)).toEqual(['✅ Confirma', '❌ Rebutja', 'Obre la reserva']);
    const confirm = buttons.find((b) => b.callback_data === `confirm:${reservationId}`);
    expect(confirm).toBeTruthy();
    expect(buttons[2]!.url).toContain(`startapp=r_${reservationId}`);

    // The producer confirms from the quick action; the requester's screen moves without a reload.
    await tapQuickAction(request, IDS.producer, n6, confirm!.callback_data!);
    await expect(detail).toHaveAttribute('data-status', 'confirmed', { timeout: 15_000 });
    await expect(detail).toContainText('Confirmada');
    await expect
      .poll(
        async () =>
          (await sentTo(request, IDS.admin)).filter((m) => m.text.includes('ha confirmat')),
        {
          timeout: 20_000,
        },
      )
      .toHaveLength(1);

    // The producer marks it delivered from the Mini App (US-4.4).
    await producer.goto(`/#/reservations/${reservationId}`);
    const producerDetail = producer.getByTestId('reservation-detail');
    await expect(producerDetail).toHaveAttribute('data-status', 'confirmed');
    await expect(producerDetail).toContainText(`Reservada per Telegram ${IDS.admin}`);
    await producer.getByRole('button', { name: 'Marca com a lliurada' }).click();
    await producer
      .getByTestId('action-confirm')
      .getByRole('button', { name: 'Marca com a lliurada' })
      .click();
    await expect(producerDetail).toHaveAttribute('data-status', 'delivered');
    await expect(detail).toHaveAttribute('data-status', 'delivered', { timeout: 15_000 });
    await expect
      .poll(
        async () => (await sentTo(request, IDS.admin)).filter((m) => m.text.includes('lliurada')),
        {
          timeout: 20_000,
        },
      )
      .toHaveLength(1);

    // ARCH §5: delivered deducts. The offer now stands at 4 in total, nothing held.
    await producer.goto('/#/offers');
    const after = producer.getByTestId('my-offer').filter({ hasText: 'Ous' });
    await expect(after).toContainText('4 dotzena en total');
    await expect(after).toContainText('4 dotzena disponibles');
    await expect(after).not.toContainText('reservats');

    // The closed tab shows it on both sides (US-4.6).
    await requester.goto('/#/reservations');
    await requester.getByRole('tab', { name: 'Fetes' }).click();
    await requester.getByRole('radio', { name: 'Tancades' }).click();
    await expect(requester.getByTestId('reservation')).toHaveAttribute('data-status', 'delivered');
  } finally {
    await producer.context().close();
    await requester.context().close();
  }
});

test('a second reservation is confirmed and delivered in one Mini App action, with one notification (ADR-0014)', async ({
  browser,
  request,
}) => {
  const requester = await openAs(browser, IDS.admin, '/');
  const producer = await openAs(browser, IDS.producer, '/#/reservations');
  try {
    const before = (await sentTo(request, IDS.admin)).length;

    const row = requester
      .getByTestId('board-group')
      .filter({ hasText: 'Ous' })
      .getByTestId('offer');
    await expect(row).toContainText('4 dotzena disponibles');
    await row.click();
    const sheet = requester.getByRole('dialog');
    await sheet.getByLabel('Quantitat a reservar (dotzena)').fill('1');
    await sheet.getByTestId('reserve').click();
    const detail = requester.getByTestId('reservation-detail');
    await expect(detail).toHaveAttribute('data-status', 'pending');

    // The producer's incoming tab shows it live; the one-tap handover is on the detail.
    const incoming = producer
      .getByTestId('reservation')
      .filter({ hasText: 'Pendent de confirmar' });
    await expect(incoming).toHaveCount(1);
    await incoming.click();
    const producerDetail = producer.getByTestId('reservation-detail');
    await expect(producerDetail).toHaveAttribute('data-status', 'pending');
    await producer.getByRole('button', { name: 'Confirma i marca com a lliurada' }).click();
    await producer
      .getByTestId('action-confirm')
      .getByRole('button', { name: 'Confirma i marca com a lliurada' })
      .click();

    // Same records as the two-step path: both timestamps, delivered, on both sides.
    await expect(producerDetail).toHaveAttribute('data-status', 'delivered');
    await expect(producerDetail.getByTestId('confirmed-at')).toBeVisible();
    await expect(producerDetail.getByTestId('delivered-at')).toBeVisible();
    await expect(detail).toHaveAttribute('data-status', 'delivered', { timeout: 15_000 });
    await expect(detail.getByTestId('confirmed-at')).toBeVisible();

    // Exactly one notification for it: delivered, and never a "confirmed" one.
    await expect
      .poll(async () => (await sentTo(request, IDS.admin)).slice(before), { timeout: 20_000 })
      .toHaveLength(1);
    const [only] = (await sentTo(request, IDS.admin)).slice(before);
    expect(only!.text).toContain('lliurada');
    expect(only!.text).not.toContain('confirmat');

    await producer.goto('/#/offers');
    await expect(producer.getByTestId('my-offer').filter({ hasText: 'Ous' })).toContainText(
      '3 dotzena en total',
    );
  } finally {
    await requester.context().close();
    await producer.context().close();
  }
});
