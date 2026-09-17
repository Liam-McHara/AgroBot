import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { members, notifications } from '../src/db/schema/index.js';
import { enqueueNotification } from '../src/domain/notifications/outbox.js';
import { dispatchNotifications } from '../src/jobs/notifications-dispatch.js';
import { TelegramSendError, type SendMessageInput } from '../src/integrations/telegram-api.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

const env = { BOT_USERNAME: 'AgroBotTest', MINIAPP_SHORT_NAME: 'app' };

/** A Telegram that records what it is asked and answers what the test scripted. */
function fakeTelegram(script: Array<Error | number> = []) {
  const sent: SendMessageInput[] = [];
  let calls = 0;
  return {
    sent,
    sender: {
      async sendMessage(input: SendMessageInput) {
        const outcome = script[calls] ?? calls + 1;
        calls += 1;
        if (outcome instanceof Error) throw outcome;
        sent.push(input);
        return { messageId: outcome };
      },
    },
  };
}

async function member(telegramId: number, language: 'ca' | 'es') {
  const [row] = await database!.db
    .insert(members)
    .values({ telegramId, displayName: `Member ${telegramId}`, language, status: 'approved' })
    .returning();
  return row!;
}

suite('notifications.dispatch (ARCH §8)', () => {
  const logger = pino({ level: 'silent' });

  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('sends queued rows in the recipient language and records the message id', async () => {
    const ca = await member(1, 'ca');
    const es = await member(2, 'es');
    await enqueueNotification(database!.db, {
      memberId: ca.id,
      kind: 'N2',
      payload: { decision: 'approved', name: 'Marta' },
    });
    await enqueueNotification(database!.db, {
      memberId: es.id,
      kind: 'N2',
      payload: { decision: 'approved', name: 'Jordi' },
    });

    const telegram = fakeTelegram();
    const report = await dispatchNotifications({
      db: database!.db,
      env,
      sender: telegram.sender,
      logger,
    });

    expect(report).toEqual({ sent: 2, retried: 0, failed: 0 });
    expect(telegram.sent.map((m) => m.chatId)).toEqual([1, 2]);
    expect(telegram.sent[0]?.text).toContain('Benvingut/da');
    expect(telegram.sent[1]?.text).toContain('Bienvenido/a');

    const rows = await database!.db.select().from(notifications);
    expect(rows.every((row) => row.status === 'sent' && row.telegramMessageId !== null)).toBe(true);
    expect(rows.every((row) => row.attempts === 1)).toBe(true);
  });

  it('is quiet when nothing is due, and leaves future rows alone', async () => {
    const m = await member(3, 'ca');
    await database!.db.insert(notifications).values({
      memberId: m.id,
      kind: 'N2',
      payload: { decision: 'rejected', name: 'x' },
      nextAttemptAt: new Date(Date.now() + 60_000),
    });
    const telegram = fakeTelegram();
    const report = await dispatchNotifications({
      db: database!.db,
      env,
      sender: telegram.sender,
      logger,
    });
    expect(report).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(telegram.sent).toHaveLength(0);
  });

  it('backs off 1 m, 5 m, 30 m and then gives up', async () => {
    const m = await member(4, 'ca');
    await enqueueNotification(database!.db, {
      memberId: m.id,
      kind: 'N2',
      payload: { decision: 'rejected', name: 'x' },
    });
    const failing = fakeTelegram([
      new TelegramSendError('boom', 500, null),
      new TelegramSendError('boom', 500, null),
      new TelegramSendError('boom', 500, null),
      new TelegramSendError('boom', 500, null),
    ]);

    let clock = new Date(Date.now() + 1_000);
    const now = () => clock;
    const run = () =>
      dispatchNotifications({ db: database!.db, env, sender: failing.sender, logger, now });
    const row = async () => (await database!.db.select().from(notifications))[0]!;

    expect(await run()).toMatchObject({ retried: 1 });
    expect((await row()).nextAttemptAt.getTime() - clock.getTime()).toBe(60_000);
    expect((await row()).attempts).toBe(1);

    // Not due yet: nothing happens.
    expect(await run()).toEqual({ sent: 0, retried: 0, failed: 0 });

    clock = new Date(clock.getTime() + 60_000);
    expect(await run()).toMatchObject({ retried: 1 });
    expect((await row()).nextAttemptAt.getTime() - clock.getTime()).toBe(5 * 60_000);

    clock = new Date(clock.getTime() + 5 * 60_000);
    expect(await run()).toMatchObject({ retried: 1 });
    expect((await row()).nextAttemptAt.getTime() - clock.getTime()).toBe(30 * 60_000);

    clock = new Date(clock.getTime() + 30 * 60_000);
    expect(await run()).toMatchObject({ failed: 1 });
    expect(await row()).toMatchObject({ status: 'failed', attempts: 4, error: 'boom' });
  });

  it('honours retry_after on a 429 without spending an attempt', async () => {
    const m = await member(5, 'ca');
    await enqueueNotification(database!.db, {
      memberId: m.id,
      kind: 'N2',
      payload: { decision: 'rejected', name: 'x' },
    });
    const throttled = fakeTelegram([new TelegramSendError('Too Many Requests', 429, 17)]);
    const clock = new Date(Date.now() + 1_000);
    const report = await dispatchNotifications({
      db: database!.db,
      env,
      sender: throttled.sender,
      logger,
      now: () => clock,
    });
    expect(report).toMatchObject({ retried: 1 });
    const [row] = await database!.db.select().from(notifications);
    expect(row?.attempts).toBe(0);
    expect(row?.nextAttemptAt.getTime()).toBe(clock.getTime() + 17_000);
  });

  it('fails at once when the recipient blocked the bot', async () => {
    const m = await member(6, 'ca');
    await enqueueNotification(database!.db, {
      memberId: m.id,
      kind: 'N2',
      payload: { decision: 'rejected', name: 'x' },
    });
    const blocked = fakeTelegram([
      new TelegramSendError('Forbidden: bot was blocked by the user', 403, null),
    ]);
    const report = await dispatchNotifications({
      db: database!.db,
      env,
      sender: blocked.sender,
      logger,
    });
    expect(report).toMatchObject({ failed: 1 });
    const [row] = await database!.db.select().from(notifications);
    expect(row).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('skips a duplicate dedupe_key at enqueue time (ARCH §8 step 3)', async () => {
    const m = await member(7, 'ca');
    const first = await enqueueNotification(database!.db, {
      memberId: m.id,
      kind: 'N2',
      payload: { decision: 'approved', name: 'x' },
      dedupeKey: 'chat:r1:m1',
    });
    const second = await enqueueNotification(database!.db, {
      memberId: m.id,
      kind: 'N2',
      payload: { decision: 'approved', name: 'x' },
      dedupeKey: 'chat:r1:m1',
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(
      await database!.db.select().from(notifications).where(eq(notifications.memberId, m.id)),
    ).toHaveLength(1);
  });
});
