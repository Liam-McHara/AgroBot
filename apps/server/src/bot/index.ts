import { Bot, type Context } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { createTranslator, languageFromTelegram, type Language } from '@agrobot/shared';
import type { AppDeps } from '../http/context.js';
import { escapeHtml } from './html.js';

export const WEBHOOK_PATH = '/telegram/webhook';

/**
 * The grammY bot (ADR-0001, ADR-0013).
 *
 * M0 gives it the one command the definition of done asks for; M1 replaces the placeholder
 * with the full `/start` behaviour (applicant, repeat, pre-approved, admin bootstrap) and
 * adds the quick-action callbacks.
 */
export function createBot(deps: AppDeps): Bot {
  const bot = new Bot(deps.env.BOT_TOKEN);

  // Telegram answers a flood with 429 + `retry_after`; the transformer waits it out for us.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  bot.command('start', async (ctx) => {
    const from = ctx.from;
    if (!from) return;

    let language: Language = languageFromTelegram(from.language_code);
    let name = from.first_name || from.username || '';

    try {
      const { member } = await deps.members.identify({
        id: from.id,
        username: from.username ?? null,
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        language,
      });
      language = member.language;
      name = member.displayName;
    } catch (error) {
      // A greeting is worth sending even if we could not write the row; the next /start or
      // the Mini App will create it.
      deps.logger.error({ err: error, telegramId: from.id }, 'could not upsert member on /start');
    }

    const t = createTranslator(language);
    await ctx.reply(t('bot.start.placeholder', { name: escapeHtml(name) }), {
      parse_mode: 'HTML',
    });
  });

  bot.catch((error) => {
    deps.logger.error({ err: error.error, updateId: error.ctx.update.update_id }, 'bot error');
  });

  return bot;
}

export type BotContext = Context;
