import { and, eq, lte, sql } from 'drizzle-orm';
import { NOTIFICATION_RETRY_DELAYS_MINUTES } from '@agrobot/shared';
import type { Database } from '../db/client.js';
import { members, notifications } from '../db/schema/index.js';
import type { Env } from '../env.js';
import type { Logger } from '../logger.js';
import { TelegramSendError, type TelegramSender } from '../integrations/telegram-api.js';
import { isRenderableKind, renderNotification } from '../bot/notifications/render.js';
import type { JobReport } from './types.js';

/**
 * ARCH §8 step 2, ADR-0009: the only code that turns outbox rows into Telegram messages.
 *
 * Batches of 20 (under the 50 subrequests a free-plan invocation may make, ADR-0017) are
 * locked with `FOR UPDATE SKIP LOCKED`, rendered in the recipient's language and sent one by
 * one; the hub runs it again at once when a batch was full. A send that fails is retried with exponential backoff
 * (1 m, 5 m, 30 m) and then marked `failed`; a 429 waits exactly what Telegram asked and does
 * not count as an attempt; a recipient who blocked the bot is `failed` at once.
 */
export const DISPATCH_BATCH_SIZE = 20;

export interface DispatchDeps {
  db: Database;
  env: Pick<Env, 'BOT_USERNAME' | 'MINIAPP_SHORT_NAME'>;
  sender: TelegramSender;
  logger: Logger;
  now?: () => Date;
}

export interface DispatchReport extends JobReport {
  sent: number;
  retried: number;
  failed: number;
}

function retryDelayMs(attemptsSoFar: number): number | null {
  const minutes = NOTIFICATION_RETRY_DELAYS_MINUTES[attemptsSoFar - 1];
  return minutes === undefined ? null : minutes * 60_000;
}

export async function dispatchNotifications(deps: DispatchDeps): Promise<DispatchReport> {
  const now = deps.now ?? (() => new Date());
  const report: DispatchReport = { sent: 0, retried: 0, failed: 0 };

  await deps.db.transaction(async (tx) => {
    const batch = await tx
      .select({
        notification: notifications,
        telegramId: members.telegramId,
        language: members.language,
      })
      .from(notifications)
      .innerJoin(members, eq(members.id, notifications.memberId))
      .where(and(eq(notifications.status, 'queued'), lte(notifications.nextAttemptAt, now())))
      .orderBy(notifications.createdAt)
      .limit(DISPATCH_BATCH_SIZE)
      .for('update', { of: notifications, skipLocked: true });

    for (const { notification, telegramId, language } of batch) {
      const at = now();

      if (!isRenderableKind(notification.kind)) {
        await tx
          .update(notifications)
          .set({ status: 'failed', error: `no renderer for ${notification.kind}` })
          .where(eq(notifications.id, notification.id));
        report.failed += 1;
        continue;
      }

      let rendered;
      try {
        rendered = renderNotification(
          deps.env,
          notification.kind,
          notification.payload as never,
          language,
        );
      } catch (error) {
        deps.logger.error({ err: error, notificationId: notification.id }, 'render failed');
        await tx
          .update(notifications)
          .set({ status: 'failed', error: `render: ${String(error)}` })
          .where(eq(notifications.id, notification.id));
        report.failed += 1;
        continue;
      }

      try {
        const { messageId } = await deps.sender.sendMessage({
          chatId: telegramId,
          text: rendered.text,
          ...(rendered.replyMarkup ? { replyMarkup: rendered.replyMarkup } : {}),
        });
        await tx
          .update(notifications)
          .set({
            status: 'sent',
            sentAt: at,
            telegramMessageId: messageId,
            attempts: sql`${notifications.attempts} + 1`,
            error: null,
          })
          .where(eq(notifications.id, notification.id));
        report.sent += 1;
      } catch (error) {
        const sendError =
          error instanceof TelegramSendError
            ? error
            : new TelegramSendError(String(error), null, null, { cause: error });

        if (sendError.retryAfter !== null) {
          // Telegram said when; asking earlier only earns another 429.
          await tx
            .update(notifications)
            .set({
              nextAttemptAt: new Date(at.getTime() + sendError.retryAfter * 1000),
              error: sendError.message,
            })
            .where(eq(notifications.id, notification.id));
          report.retried += 1;
          continue;
        }

        const attempts = notification.attempts + 1;
        const delay = sendError.isPermanent ? null : retryDelayMs(attempts);
        if (delay === null) {
          deps.logger.warn(
            { notificationId: notification.id, attempts, err: sendError },
            'notification failed for good',
          );
          await tx
            .update(notifications)
            .set({ status: 'failed', attempts, error: sendError.message })
            .where(eq(notifications.id, notification.id));
          report.failed += 1;
        } else {
          await tx
            .update(notifications)
            .set({
              attempts,
              nextAttemptAt: new Date(at.getTime() + delay),
              error: sendError.message,
            })
            .where(eq(notifications.id, notification.id));
          report.retried += 1;
        }
      }
    }
  });

  return report;
}
