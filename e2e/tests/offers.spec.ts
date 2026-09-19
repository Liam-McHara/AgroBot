import { expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_TELEGRAM_URL, IDS } from '../playwright.config.js';

/**
 * M3 definition of done (roadmap): producer publishes → requester's board updates without a
 * reload → N3 reaches the requester (fake Telegram) → producer lowers the quantity to 0 → the
 * offer leaves the board. Two browser contexts through the dev bypass (ARCH §4); the
 * notification travels outbox → hub alarm → dispatcher → the fake Bot API of start-server.mjs.
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

interface SentMessage {
  chat_id: number | string;
  text: string;
}

test('an offer reaches the board live, notifies the group, and leaves when nothing is left', async ({
  browser,
  request,
}) => {
  const requester = await openAs(browser, IDS.admin, '/');
  const producer = await openAs(browser, IDS.producer, '/#/offers');
  try {
    await expect(requester.getByRole('heading', { level: 1 })).toHaveText('Tauler');
    await expect(requester.getByTestId('board-empty')).toBeVisible();
    await expect(producer.getByRole('heading', { level: 1 })).toHaveText('Ofertes');

    // Publish: a product the sheet does not have yet, proposed from the picker (US-2.2), then
    // quantity and note (US-3.1). The price is pending until the sheet catches up.
    await producer.getByTestId('publish').click();
    await producer.getByRole('searchbox').fill('Carbassa violina');
    await producer.getByRole('button', { name: 'Proposa «Carbassa violina»' }).click();
    await producer.getByLabel('Quantitat (kg)').fill('12.5');
    await producer.getByLabel('Nota (opcional)').fill('Collides aquest matí');
    await producer.getByRole('button', { name: 'Publica una oferta' }).click();
    const mine = producer.getByTestId('my-offer');
    await expect(mine).toContainText('12,5 kg disponibles');
    await expect(mine).toHaveAttribute('data-state', 'active');

    // No reload, no click: `board.changed` reached the requester's socket (ARCH §7).
    const group = requester.getByTestId('board-group');
    await expect(group.getByRole('heading', { level: 2 })).toHaveText('Carbassa violina');
    const row = group.getByTestId('offer');
    await expect(row).toContainText('Marta (dev)');
    await expect(row).toContainText('12,5 kg disponibles');
    await expect(row).toContainText('Preu pendent');
    await expect(row).toContainText('Collides aquest matí');

    // N3 went through the outbox and the hub's dispatcher to the requester's Telegram.
    await expect
      .poll(
        async () => {
          const sent = (await (
            await request.get(`${E2E_TELEGRAM_URL}/messages`)
          ).json()) as SentMessage[];
          return sent.filter(
            (m) => String(m.chat_id) === IDS.admin && m.text.includes('ofereix 12,5 kg'),
          );
        },
        { timeout: 20_000 },
      )
      .toHaveLength(1);
    const sent = (await (
      await request.get(`${E2E_TELEGRAM_URL}/messages`)
    ).json()) as SentMessage[];
    const n3 = sent.find(
      (m) => String(m.chat_id) === IDS.admin && m.text.includes('ofereix 12,5 kg'),
    )!;
    expect(n3.text).toContain('Marta (dev) ofereix 12,5 kg de Carbassa violina');
    // The producer is not told about their own offer (PRD N3).
    expect(
      sent.filter((m) => String(m.chat_id) === IDS.producer && m.text.includes('ofereix')),
    ).toHaveLength(0);

    // The detail sheet: reserving waits for M4, visibly.
    await row.click();
    const sheet = requester.getByRole('dialog');
    await expect(sheet.getByTestId('reserve')).toBeDisabled();
    await sheet.getByRole('button', { name: 'Tanca' }).click();
    await expect(requester.getByRole('dialog')).toHaveCount(0);

    // Nothing left: the offer leaves the requester's board and is "fully reserved" for the
    // producer (US-3.2).
    await mine.getByRole('button', { name: 'Edita' }).click();
    await producer.getByLabel('Quantitat (kg)').fill('0');
    await producer.getByRole('button', { name: 'Desa' }).click();
    await expect(producer.getByTestId('my-offer')).toHaveAttribute('data-state', 'fully_reserved');
    await expect(requester.getByTestId('board-empty')).toBeVisible();

    // And back: raising it re-publishes (N3 again) and the board shows it again.
    await producer.getByRole('button', { name: 'Edita' }).click();
    await producer.getByLabel('Quantitat (kg)').fill('4');
    await producer.getByRole('button', { name: 'Desa' }).click();
    await expect(requester.getByTestId('board-group').getByTestId('offer')).toContainText(
      '4 kg disponibles',
    );
    await expect
      .poll(
        async () => {
          const all = (await (
            await request.get(`${E2E_TELEGRAM_URL}/messages`)
          ).json()) as SentMessage[];
          return all.filter(
            (m) => String(m.chat_id) === IDS.admin && m.text.includes('torna a oferir 4 kg'),
          );
        },
        { timeout: 20_000 },
      )
      .toHaveLength(1);
  } finally {
    await requester.context().close();
    await producer.context().close();
  }
});
