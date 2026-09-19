import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { InlineKeyboardMarkup, Update, UserFromGetMe } from 'grammy/types';
import { eq } from 'drizzle-orm';
import { members, notifications, offers, products } from '../src/db/schema/index.js';
import { createBot } from '../src/bot/index.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { testDeps } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

const BOT_INFO: UserFromGetMe = {
  id: 1,
  is_bot: true,
  first_name: 'AgroBot',
  username: 'AgroBotTest',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

const ADMIN_ID = 7000;

interface SentCall {
  method: string;
  payload: Record<string, unknown>;
}

/**
 * Drives the bot without Telegram: outgoing API calls are captured by a transformer
 * (ARCH §16 "Bot: Vitest + grammY test transformer").
 */
function botUnderTest() {
  const sent: SentCall[] = [];
  const deps = testDeps(
    database!,
    { ADMIN_TELEGRAM_IDS: String(ADMIN_ID) },
    {
      source: {
        kind: 'csv',
        sheetUrl: 'https://example.test/catalog.csv',
        fetchRows: async () => [
          ['Product', 'Unit', 'Price'],
          ['Tomàquet', 'kg', '2.35'],
        ],
      },
    },
  );
  const bot = createBot(deps);
  bot.botInfo = BOT_INFO;
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: sent.length } } as never;
  });
  const last = (method: string) => sent.filter((call) => call.method === method).at(-1);
  return { bot, sent, last, hub: deps.hub, deps };
}

interface From {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

let updateId = 0;

function textUpdate(from: From, text: string): Update {
  updateId += 1;
  const command = text.startsWith('/') ? text.split(' ')[0]! : null;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from.id, type: 'private', first_name: from.first_name },
      from: { is_bot: false, ...from },
      text,
      ...(command
        ? { entities: [{ type: 'bot_command', offset: 0, length: command.length }] }
        : {}),
    },
  } as Update;
}

function callbackUpdate(from: From, data: string, messageText = 'Nova sol·licitud'): Update {
  updateId += 1;
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      chat_instance: 'x',
      from: { is_bot: false, ...from },
      data,
      message: {
        message_id: 99,
        date: Math.floor(Date.now() / 1000),
        chat: { id: from.id, type: 'private', first_name: from.first_name },
        text: messageText,
      },
    },
  } as Update;
}

const start = (from: From) => textUpdate(from, '/start');
const ADMIN: From = { id: ADMIN_ID, first_name: 'Guillem', language_code: 'ca' };
const MARTA: From = { id: 7001, first_name: 'Marta', last_name: 'Puig', username: 'marta_hort' };

function buttons(call: SentCall | undefined) {
  const markup = call?.payload['reply_markup'] as InlineKeyboardMarkup | undefined;
  return markup?.inline_keyboard.flat() ?? [];
}

async function memberByTelegramId(telegramId: number) {
  const [row] = await database!.db.select().from(members).where(eq(members.telegramId, telegramId));
  return row;
}

suite('bot', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('limits /sync and /status to admins and replies with real catalogue counts', async () => {
    const { bot, last } = botUnderTest();
    await bot.handleUpdate(textUpdate(MARTA, '/sync'));
    expect(last('sendMessage')?.payload['text']).toContain('encara no està aprovat');
    await bot.handleUpdate(textUpdate(ADMIN, '/status'));
    expect(last('sendMessage')?.payload['text']).toContain('Encara no s’ha sincronitzat');
    await bot.handleUpdate(textUpdate(ADMIN, '/sync'));
    expect(last('sendMessage')?.payload['text']).toContain('Creats: 1');
    await bot.handleUpdate(textUpdate(ADMIN, '/status'));
    expect(last('sendMessage')?.payload['text']).toContain('Última sincronització');
  });

  describe('/start (PRD US-1.1)', () => {
    it('bootstraps a configured admin and greets them with the Open AgroBot button', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      const reply = last('sendMessage');
      expect(reply?.payload['text']).toContain('Hola, Guillem!');
      expect(reply?.payload['parse_mode']).toBe('HTML');
      const [button] = buttons(reply);
      expect(button?.text).toBe("Obre l'AgroBot");
      expect('url' in button! && button.url).toBe('https://t.me/AgroBotTest/app');
      expect(await memberByTelegramId(ADMIN_ID)).toMatchObject({
        role: 'admin',
        status: 'approved',
      });
    });

    it('tells a stranger the request was sent and queues N1 for the admins', async () => {
      const { bot, last, hub } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));

      expect(last('sendMessage')?.payload['text']).toContain('He enviat la teva sol·licitud');
      expect(buttons(last('sendMessage'))).toHaveLength(0);
      const marta = await memberByTelegramId(MARTA.id);
      expect(marta).toMatchObject({ status: 'pending', displayName: 'Marta Puig' });

      const admin = (await memberByTelegramId(ADMIN_ID))!;
      const queued = await database!.db
        .select()
        .from(notifications)
        .where(eq(notifications.memberId, admin.id));
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ kind: 'N1', payload: { applicantId: marta!.id } });
      // ARCH §8 step 2: the commit that enqueued N1 woke the hub.
      expect(hub.wakes).toBe(1);
    });

    it('repeats the waiting message on a second /start without a second N1', async () => {
      const { bot, sent } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));
      await bot.handleUpdate(start(MARTA));
      expect(sent.at(-1)?.payload['text']).toContain('encara està pendent');
      expect(await database!.db.select().from(notifications)).toHaveLength(1);
    });

    it('answers in Spanish to an es-* client (PRD US-1.5)', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start({ id: 7002, first_name: 'Jordi', language_code: 'es-ES' }));
      expect(last('sendMessage')?.payload['text']).toContain('He enviado tu solicitud');
    });

    it('lets a pre-approved username straight in (US-1.3)', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      const deps = testDeps(database!, { ADMIN_TELEGRAM_IDS: String(ADMIN_ID) });
      await deps.members.createInvite((await memberByTelegramId(ADMIN_ID))!, '@Marta_Hort');

      await bot.handleUpdate(start(MARTA));
      expect(last('sendMessage')?.payload['text']).toContain('Benvingut/da');
      expect(await memberByTelegramId(MARTA.id)).toMatchObject({ status: 'approved' });
    });

    it('tells rejected and suspended people where they stand', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));
      const deps = testDeps(database!, { ADMIN_TELEGRAM_IDS: String(ADMIN_ID) });
      const admin = (await memberByTelegramId(ADMIN_ID))!;
      const marta = (await memberByTelegramId(MARTA.id))!;

      await deps.members.reject(admin, marta.id);
      await bot.handleUpdate(start(MARTA));
      expect(last('sendMessage')?.payload['text']).toContain('no ha estat acceptada');

      await deps.members.approve(admin, marta.id);
      await deps.members.suspend(admin, marta.id);
      await bot.handleUpdate(start(MARTA));
      expect(last('sendMessage')?.payload['text']).toContain('està suspès');
    });

    it('escapes a display name that looks like markup (ARCH §17)', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start({ id: 7004, first_name: '<b>Pau</b>' }));
      expect(last('sendMessage')?.payload['text']).toContain('&lt;b&gt;Pau&lt;/b&gt;');
    });
  });

  describe('/help and stray text (ADR-0013)', () => {
    it('orients anyone who types at the bot, with the app button for members', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(textUpdate(ADMIN, '/help'));
      expect(last('sendMessage')?.payload['text']).toContain('/help');
      expect(buttons(last('sendMessage'))).toHaveLength(1);

      await bot.handleUpdate(textUpdate(MARTA, '/o tomàquets 3'));
      expect(last('sendMessage')?.payload['text']).toContain('/help');
      expect(buttons(last('sendMessage'))).toHaveLength(0);
    });
  });

  describe('quick actions approve:<id> / reject:<id> (PRD §9, US-1.2)', () => {
    async function applicantId() {
      return (await memberByTelegramId(MARTA.id))!.id;
    }

    it('approves from the button, edits the message and queues N2', async () => {
      const { bot, last, hub } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));
      const id = await applicantId();

      await bot.handleUpdate(callbackUpdate(ADMIN, `approve:${id}`));

      expect(await memberByTelegramId(MARTA.id)).toMatchObject({ status: 'approved' });
      expect(last('answerCallbackQuery')?.payload['text']).toBe('Marta Puig ja és membre.');
      const edited = last('editMessageText');
      expect(edited?.payload['text']).toBe('Nova sol·licitud\n\n✅ Aprovada per Guillem');
      expect(edited?.payload['reply_markup']).toBeUndefined();

      const n2 = await database!.db
        .select()
        .from(notifications)
        .where(eq(notifications.memberId, id));
      expect(n2).toHaveLength(1);
      expect(n2[0]).toMatchObject({ kind: 'N2', payload: { decision: 'approved' } });
      // N1 and N2 each woke the hub; the approval also told Marta's open Mini App.
      expect(hub.wakes).toBe(2);
      expect(hub.published).toContainEqual({ memberIds: [id], event: { type: 'me.changed' } });
    });

    it('rejects from the button', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));
      await bot.handleUpdate(callbackUpdate(ADMIN, `reject:${await applicantId()}`));
      expect(await memberByTelegramId(MARTA.id)).toMatchObject({ status: 'rejected' });
      expect(last('editMessageText')?.payload['text']).toContain('❌ Rebutjada per Guillem');
    });

    it('explains a stale button instead of failing silently', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));
      const id = await applicantId();
      await bot.handleUpdate(callbackUpdate(ADMIN, `approve:${id}`));
      await bot.handleUpdate(callbackUpdate(ADMIN, `reject:${id}`));
      expect(last('answerCallbackQuery')?.payload['text']).toBe(
        'Aquesta sol·licitud ja està resolta: aprovat/da.',
      );
      expect(last('editMessageText')?.payload['text']).toContain('— aprovat/da');
    });

    it('refuses a tap from someone who is not an admin', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(MARTA));
      const other: From = { id: 7005, first_name: 'Pere' };
      await bot.handleUpdate(start(other));
      await bot.handleUpdate(callbackUpdate(other, `approve:${await applicantId()}`));
      expect(last('answerCallbackQuery')?.payload['text']).toBe(
        'Només els administradors poden fer això.',
      );
      expect(await memberByTelegramId(MARTA.id)).toMatchObject({ status: 'pending' });
    });

    it('answers unknown and dangling callback data', async () => {
      const { bot, last } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(callbackUpdate(ADMIN, 'confirm:whatever'));
      expect(last('answerCallbackQuery')?.payload['text']).toBe('Aquest botó ja no fa res.');
      await bot.handleUpdate(callbackUpdate(ADMIN, 'approve:00000000-0000-4000-8000-000000000000'));
      expect(last('answerCallbackQuery')?.payload['text']).toBe('No trobo aquesta sol·licitud.');
    });
  });

  describe('quick actions still:<offerId> / withdraw:<offerId> (PRD US-3.4, N10)', () => {
    async function nudgedOffer(from: From) {
      const { bot, deps, last, sent } = botUnderTest();
      await bot.handleUpdate(start(ADMIN));
      await bot.handleUpdate(start(from));
      if (from.id !== ADMIN_ID) {
        await deps.members.approve(
          (await memberByTelegramId(ADMIN_ID))!,
          (await memberByTelegramId(from.id))!.id,
        );
      }
      const producer = (await memberByTelegramId(from.id))!;
      const [product] = await database!.db
        .insert(products)
        .values({ slug: 'ous', name: 'Ous', nameEs: 'Huevos', unitCode: 'dozen', priceCents: 300 })
        .returning();
      const { offer } = await deps.offers.publish(producer, {
        productId: product!.id,
        quantity: 4,
      });
      await database!.db
        .update(offers)
        .set({ stale: true, nudgedAt: new Date() })
        .where(eq(offers.id, offer.id));
      return { bot, deps, last, sent, producer, offer };
    }

    it('"still available" resets the nudge and marks the message', async () => {
      const { bot, last, offer } = await nudgedOffer(ADMIN);
      await bot.handleUpdate(callbackUpdate(ADMIN, `still:${offer.id}`, 'Encara tens 4 dotzena?'));
      expect(last('answerCallbackQuery')?.payload['text']).toBe(
        "Perfecte: l'oferta de Ous continua disponible.",
      );
      expect(last('editMessageText')?.payload['text']).toBe(
        'Encara tens 4 dotzena?\n\n✅ Encara disponible',
      );
      const [row] = await database!.db.select().from(offers).where(eq(offers.id, offer.id));
      expect(row).toMatchObject({ stale: false, nudgedAt: null, status: 'active' });
    });

    it('"withdraw" hides the offer, in the producer language, and a second tap is explained', async () => {
      const es: From = { id: 7006, first_name: 'Jordi', language_code: 'es' };
      const { bot, last, offer } = await nudgedOffer(es);
      await bot.handleUpdate(callbackUpdate(es, `withdraw:${offer.id}`));
      expect(last('answerCallbackQuery')?.payload['text']).toBe('Oferta de Huevos retirada.');
      expect(last('editMessageText')?.payload['text']).toContain('🗑 Retirada');
      expect((await database!.db.select().from(offers))[0]?.status).toBe('withdrawn');

      await bot.handleUpdate(callbackUpdate(es, `still:${offer.id}`));
      expect(last('answerCallbackQuery')?.payload['text']).toBe(
        'Esta oferta ya no está activa: retirada.',
      );
      expect(last('editMessageText')?.payload['text']).toContain('— retirada');
    });

    it('refuses a tap from someone who is not the producer, and answers a missing offer', async () => {
      const { bot, last, offer } = await nudgedOffer(ADMIN);
      await bot.handleUpdate(start(MARTA));
      const deps = testDeps(database!, { ADMIN_TELEGRAM_IDS: String(ADMIN_ID) });
      await deps.members.approve(
        (await memberByTelegramId(ADMIN_ID))!,
        (await memberByTelegramId(MARTA.id))!.id,
      );
      await bot.handleUpdate(callbackUpdate(MARTA, `withdraw:${offer.id}`));
      expect(last('answerCallbackQuery')?.payload['text']).toBe(
        "Només qui ha publicat l'oferta pot fer això.",
      );
      expect((await database!.db.select().from(offers))[0]?.status).toBe('active');
      await bot.handleUpdate(
        callbackUpdate(ADMIN, 'withdraw:00000000-0000-4000-8000-000000000000'),
      );
      expect(last('answerCallbackQuery')?.payload['text']).toBe('No trobo aquesta oferta.');
    });
  });
});
