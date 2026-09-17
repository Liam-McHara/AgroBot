import { GrammyError, type Api } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';

/**
 * The one door to the Telegram Bot API for outgoing notifications (ARCH §2 `integrations/`).
 * The dispatcher job depends on this interface, so the integration tests drive it with a
 * fake and the real one wraps grammY's `Api`, which already carries the auto-retry plugin.
 */
export interface SendMessageInput {
  chatId: number;
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export interface TelegramSender {
  sendMessage(input: SendMessageInput): Promise<{ messageId: number }>;
}

/** What Telegram answered, reduced to what the retry policy needs. */
export class TelegramSendError extends Error {
  constructor(
    message: string,
    readonly errorCode: number | null,
    /** Seconds Telegram asked us to wait (429 `retry_after`). */
    readonly retryAfter: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TelegramSendError';
  }

  /**
   * The recipient blocked the bot, deleted their account or never started a chat: retrying
   * cannot help (403, and Telegram's 400 "chat not found").
   */
  get isPermanent(): boolean {
    return this.errorCode === 403 || this.errorCode === 400;
  }
}

export function grammySender(api: Api): TelegramSender {
  return {
    async sendMessage(input) {
      try {
        const message = await api.sendMessage(input.chatId, input.text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
        });
        return { messageId: message.message_id };
      } catch (error) {
        if (error instanceof GrammyError) {
          throw new TelegramSendError(
            error.description,
            error.error_code,
            error.parameters.retry_after ?? null,
            { cause: error },
          );
        }
        throw new TelegramSendError(String(error), null, null, { cause: error });
      }
    },
  };
}
