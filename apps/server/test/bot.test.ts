import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import { eq } from 'drizzle-orm';
import { members } from '../src/db/schema/index.js';
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
  const bot = createBot(testDeps(database!));
  bot.botInfo = BOT_INFO;
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    return { ok: true, result: { message_id: sent.length } } as never;
  });
  return { bot, sent };
}

function startUpdate(from: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}): Update {
  return {
    update_id: from.id,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: { id: from.id, type: 'private', first_name: from.first_name },
      from: { is_bot: false, ...from },
      text: '/start',
      entities: [{ type: 'bot_command', offset: 0, length: 6 }],
    },
  } as Update;
}

suite('bot', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('answers /start in Catalan to a Catalan client', async () => {
    const { bot, sent } = botUnderTest();
    await bot.handleUpdate(startUpdate({ id: 7001, first_name: 'Marta', language_code: 'ca' }));

    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe('sendMessage');
    expect(sent[0]?.payload['text']).toContain('Hola, Marta!');
    expect(sent[0]?.payload['parse_mode']).toBe('HTML');
  });

  it('answers /start in Spanish to an es-* client (PRD US-1.5)', async () => {
    const { bot, sent } = botUnderTest();
    await bot.handleUpdate(startUpdate({ id: 7002, first_name: 'Jordi', language_code: 'es-ES' }));

    expect(sent[0]?.payload['text']).toContain('¡Hola, Jordi!');
  });

  it('records the person as an applicant, once, however often they press Start', async () => {
    const { bot } = botUnderTest();
    const update = startUpdate({ id: 7003, first_name: 'Pau', username: 'pau' });
    await bot.handleUpdate(update);
    await bot.handleUpdate({ ...update, update_id: 2 });

    const rows = await database!.db.select().from(members).where(eq(members.telegramId, 7003));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.username).toBe('pau');
  });

  it('escapes a display name that looks like markup (ARCH §17)', async () => {
    const { bot, sent } = botUnderTest();
    await bot.handleUpdate(startUpdate({ id: 7004, first_name: '<b>Pau</b>' }));

    expect(sent[0]?.payload['text']).toContain('&lt;b&gt;Pau&lt;/b&gt;');
    expect(sent[0]?.payload['text']).not.toContain('<b>Pau</b>');
  });
});
