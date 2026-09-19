import { Bot, InlineKeyboard, type Context } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import {
  createTranslator,
  languageFromTelegram,
  type MessageKey,
  type Translator,
} from '@agrobot/shared';
import type { User, UserFromGetMe } from 'grammy/types';
import type { Member } from '../db/schema/index.js';
import type { TelegramIdentity } from '../domain/members/rules.js';
import type { IdentifyResult } from '../domain/members/service.js';
import type { Env } from '../env.js';
import { APP_VERSION, gitCommit } from '../version.js';
import { isAppError } from '../errors.js';
import type { AppDeps } from '../http/context.js';
import { miniAppLink, parseQuickAction } from './deep-links.js';
import { escapeHtml } from './html.js';

export const WEBHOOK_PATH = '/telegram/webhook';

export type BotContext = Context;

/** Telegram answers in seconds or not at all; a request handler has no time to wait longer. */
const TELEGRAM_TIMEOUT_SECONDS = 20;

/**
 * What grammY would otherwise fetch with `getMe` on the first update of every isolate. The
 * bot's id is the first half of its token and its username is configuration (ARCH §13), so
 * the call, one Telegram subrequest per cold start, is not needed.
 */
export function botInfoFor(env: Pick<Env, 'BOT_TOKEN' | 'BOT_USERNAME'>): UserFromGetMe {
  const id = Number(env.BOT_TOKEN.split(':')[0]);
  return {
    id: Number.isSafeInteger(id) ? id : 0,
    is_bot: true,
    first_name: 'AgroBot',
    username: env.BOT_USERNAME,
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: true,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}

function identityOf(from: User): TelegramIdentity {
  return {
    id: from.id,
    username: from.username ?? null,
    firstName: from.first_name || null,
    lastName: from.last_name ?? null,
    language: languageFromTelegram(from.language_code),
  };
}

/**
 * The grammY bot (ADR-0001, ADR-0013). The chat is for greetings, notifications and quick
 * actions only (PRD §4 principle 1): `/start` tells the person where they stand, `/help`
 * points at the app, and the callback buttons run the same domain actions the API does.
 */
export function createBot(deps: AppDeps): Bot {
  const bot = new Bot(deps.env.BOT_TOKEN, {
    botInfo: botInfoFor(deps.env),
    client: { timeoutSeconds: TELEGRAM_TIMEOUT_SECONDS },
  });

  // Telegram answers a flood with 429 + `retry_after`; the transformer waits it out for us.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const openAppKeyboard = (t: Translator) =>
    new InlineKeyboard().url(t('bot.button.open_app'), miniAppLink(deps.env));

  /** PRD US-1.1: which of the five `/start` answers this person gets. */
  function startMessage(result: IdentifyResult): { key: MessageKey; openApp: boolean } {
    const { member, created } = result;
    switch (member.status) {
      case 'approved':
        return { key: 'bot.start.member', openApp: true };
      case 'rejected':
        return { key: 'bot.start.rejected', openApp: false };
      case 'suspended':
        return { key: 'bot.start.suspended', openApp: false };
      case 'pending':
        return { key: created ? 'bot.start.applicant' : 'bot.start.waiting', openApp: false };
    }
  }

  const privateChats = bot.chatType('private');

  privateChats.command('start', async (ctx) => {
    const result = await deps.members.identify(identityOf(ctx.from));
    const t = createTranslator(result.member.language);
    const { key, openApp } = startMessage(result);
    await ctx.reply(t(key, { name: escapeHtml(result.member.displayName) }), {
      parse_mode: 'HTML',
      ...(openApp ? { reply_markup: openAppKeyboard(t) } : {}),
    });
  });

  privateChats.command('help', async (ctx) => {
    const { member } = await deps.members.identify(identityOf(ctx.from));
    await replyHelp(ctx, member);
  });

  for (const command of ['sync', 'status'] as const) {
    privateChats.command(command, async (ctx) => {
      const { member } = await deps.members.identify(identityOf(ctx.from));
      const t = createTranslator(member.language);
      try {
        if (command === 'sync') {
          // ARCH §10: the sync runs in the hub, on its CPU budget; the reply waits for it.
          const sync = await deps.hub.runJob('catalog.sync', {
            trigger: 'command',
            actorId: member.id,
          });
          await ctx.reply(
            `${t(`catalog.sync.${sync.status}`)}\n${t('catalog.sync.summary', {
              rows: sync.rowsRead,
              created: sync.created,
              updated: sync.updated,
              archived: sync.archived,
              resolved: sync.resolvedPending,
            })}`,
            {
              reply_markup: new InlineKeyboard().url(
                t('catalog.title'),
                miniAppLink(deps.env, 'a_catalog'),
              ),
            },
          );
        } else {
          const status = await deps.catalog.status(member);
          const sync = status.lastSync
            ? `${t('catalog.last_sync', { when: status.lastSync.startedAt.toISOString() })} · ${t(`catalog.sync.${status.lastSync.status}`)}`
            : t('catalog.never_synced');
          await ctx.reply(
            t('bot.status', {
              version: APP_VERSION,
              commit: gitCommit(deps.env),
              members: status.members,
              offers: status.offers,
              reservations: status.reservations,
              sync,
            }),
          );
        }
      } catch (error) {
        if (!isAppError(error)) throw error;
        await ctx.reply(error.body(member.language).error.message);
      }
    });
  }

  // ADR-0013: people arrive with 1.0 habits (typing orders at the bot). Anything that is not
  // a command we know gets the same short orientation as /help.
  privateChats.on('message:text', async (ctx) => {
    const { member } = await deps.members.identify(identityOf(ctx.from));
    await replyHelp(ctx, member);
  });

  async function replyHelp(ctx: Context, member: Member): Promise<void> {
    const t = createTranslator(member.language);
    await ctx.reply(t('bot.help'), {
      parse_mode: 'HTML',
      ...(member.status === 'approved' ? { reply_markup: openAppKeyboard(t) } : {}),
    });
  }

  /**
   * PRD §9 quick actions: `approve:<memberId>` / `reject:<memberId>` from N1, `still:<offerId>`
   * / `withdraw:<offerId>` from N10. Idempotent and authorized in the domain; a stale button
   * explains itself and the message loses its buttons so it visibly stops being one (ARCH §8
   * step 4).
   */
  bot.on('callback_query:data', async (ctx) => {
    const { member: actor } = await deps.members.identify(identityOf(ctx.from));
    const t = createTranslator(actor.language);
    const parsed = parseQuickAction(ctx.callbackQuery.data);
    if (!parsed) {
      await ctx.answerCallbackQuery({ text: t('quick_action.unknown') });
      return;
    }
    if (parsed.action === 'still' || parsed.action === 'withdraw') {
      await offerQuickAction(ctx, actor, parsed.action, parsed.entityId);
      return;
    }

    const target = await deps.members.getById(parsed.entityId);
    if (!target) {
      await ctx.answerCallbackQuery({ text: t('quick_action.not_found') });
      await stripButtons(ctx);
      return;
    }

    try {
      const updated = await deps.members.act(actor, target.id, parsed.action);
      await ctx.answerCallbackQuery({
        text: t(parsed.action === 'approve' ? 'quick_action.approved' : 'quick_action.rejected', {
          name: updated.displayName,
        }),
      });
      await appendOutcome(
        ctx,
        t(
          parsed.action === 'approve'
            ? 'notification.N1.done.approved'
            : 'notification.N1.done.rejected',
          { actor: escapeHtml(actor.displayName) },
        ),
      );
    } catch (error) {
      if (isAppError(error, 'INVALID_TRANSITION')) {
        const status = t(`member.status.${target.status}` as MessageKey);
        await ctx.answerCallbackQuery({ text: t('quick_action.already_decided', { status }) });
        await appendOutcome(ctx, `— ${escapeHtml(status)}`);
        return;
      }
      if (
        isAppError(error, 'FORBIDDEN') ||
        isAppError(error, 'NOT_APPROVED') ||
        isAppError(error, 'SUSPENDED')
      ) {
        await ctx.answerCallbackQuery({ text: t('quick_action.not_admin'), show_alert: true });
        return;
      }
      if (isAppError(error, 'NOT_FOUND')) {
        await ctx.answerCallbackQuery({ text: t('quick_action.not_found') });
        return;
      }
      throw error;
    }
  });

  /**
   * PRD US-3.4 / N10: *Yes, still available* resets the nudge counter; *Withdraw* hides the
   * offer. Same domain calls as the API, so the producer check and the status guard are shared.
   */
  async function offerQuickAction(
    ctx: Context,
    actor: Member,
    action: 'still' | 'withdraw',
    offerId: string,
  ): Promise<void> {
    const t = createTranslator(actor.language);
    try {
      const record =
        action === 'still'
          ? await deps.offers.stillAvailable(actor, offerId)
          : await deps.offers.withdraw(actor, offerId);
      const product =
        actor.language === 'es'
          ? record.product.nameEs || record.product.name
          : record.product.name;
      await ctx.answerCallbackQuery({
        text: t(action === 'still' ? 'quick_action.still_available' : 'quick_action.withdrawn', {
          product,
        }),
      });
      await appendOutcome(
        ctx,
        t(action === 'still' ? 'notification.N10.done.still' : 'notification.N10.done.withdrawn'),
      );
    } catch (error) {
      if (isAppError(error, 'INVALID_TRANSITION')) {
        const current = await deps.offers.get(actor, offerId).catch(() => null);
        const status = current
          ? t(`offer.status.${current.offer.status}` as MessageKey)
          : t('quick_action.not_found');
        await ctx.answerCallbackQuery({ text: t('quick_action.offer_not_active', { status }) });
        await appendOutcome(ctx, `— ${escapeHtml(status)}`);
        return;
      }
      if (isAppError(error, 'FORBIDDEN')) {
        await ctx.answerCallbackQuery({ text: t('quick_action.not_producer'), show_alert: true });
        return;
      }
      if (isAppError(error, 'NOT_APPROVED') || isAppError(error, 'SUSPENDED')) {
        await ctx.answerCallbackQuery({ text: error.body(actor.language).error.message });
        return;
      }
      if (isAppError(error, 'NOT_FOUND')) {
        await ctx.answerCallbackQuery({ text: t('quick_action.offer_not_found') });
        await stripButtons(ctx);
        return;
      }
      throw error;
    }
  }

  /** Re-send the original text (escaped: we switch to HTML) with the outcome under it. */
  async function appendOutcome(ctx: Context, outcome: string): Promise<void> {
    const original = ctx.callbackQuery?.message;
    if (!original || !('text' in original) || typeof original.text !== 'string') return;
    try {
      await ctx.editMessageText(`${escapeHtml(original.text)}\n\n${outcome}`, {
        parse_mode: 'HTML',
      });
    } catch (error) {
      // "message is not modified" or a message too old to edit: the answer already reached
      // the admin; the stale text is a cosmetic loss, not a failure.
      deps.logger.warn({ err: error }, 'could not edit quick-action message');
    }
  }

  async function stripButtons(ctx: Context): Promise<void> {
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (error) {
      deps.logger.warn({ err: error }, 'could not strip quick-action buttons');
    }
  }

  bot.catch((error) => {
    deps.logger.error({ err: error.error, updateId: error.ctx.update.update_id }, 'bot error');
  });

  return bot;
}
