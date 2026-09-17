import { InlineKeyboard } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { createTranslator, type Language, type Translator } from '@agrobot/shared';
import type { Env } from '../../env.js';
import type {
  ImplementedNotificationKind,
  NotificationPayloads,
} from '../../domain/notifications/payloads.js';
import { escapeHtml } from '../html.js';
import { miniAppLink, quickActionData, type StartParam } from '../deep-links.js';

/**
 * ARCH §8 step 2: turn an outbox row into the Telegram message the recipient reads, in their
 * language, with the quick actions of PRD §9. Everything that came from a member passes
 * through `escapeHtml` — messages are sent with `parse_mode: 'HTML'` (ARCH §17).
 */
export interface RenderedNotification {
  text: string;
  replyMarkup?: InlineKeyboardMarkup;
}

export interface RenderContext {
  language: Language;
  t: Translator;
  /** A deep link into the Mini App (ARCH §4). */
  link: (startParam?: StartParam) => string;
}

export type Renderer<K extends ImplementedNotificationKind> = (
  payload: NotificationPayloads[K],
  ctx: RenderContext,
) => RenderedNotification;

type RendererRegistry = { readonly [K in ImplementedNotificationKind]: Renderer<K> };

function nameWithUsername(name: string, username: string | null): string {
  return username ? `${escapeHtml(name)} (@${escapeHtml(username)})` : escapeHtml(name);
}

export const renderers: RendererRegistry = {
  /** PRD N1: new applicant → all admins, with Approve · Reject. */
  N1: (payload, { t }) => ({
    text: t('notification.N1.text', {
      name: nameWithUsername(payload.name, payload.username),
    }),
    replyMarkup: new InlineKeyboard()
      .text(t('notification.N1.approve'), quickActionData('approve', payload.applicantId))
      .text(t('notification.N1.reject'), quickActionData('reject', payload.applicantId)),
  }),

  /** PRD N2: approved (with Open AgroBot) or rejected → the applicant. */
  N2: (payload, { t, link }) =>
    payload.decision === 'approved'
      ? {
          text: t('notification.N2.approved', { name: escapeHtml(payload.name) }),
          replyMarkup: new InlineKeyboard().url(t('bot.button.open_app'), link()),
        }
      : { text: t('notification.N2.rejected') },
};

export function isRenderableKind(kind: string): kind is ImplementedNotificationKind {
  return Object.prototype.hasOwnProperty.call(renderers, kind);
}

export function renderNotification<K extends ImplementedNotificationKind>(
  env: Pick<Env, 'BOT_USERNAME' | 'MINIAPP_SHORT_NAME'>,
  kind: K,
  payload: NotificationPayloads[K],
  language: Language,
): RenderedNotification {
  const ctx: RenderContext = {
    language,
    t: createTranslator(language),
    link: (startParam) => miniAppLink(env, startParam),
  };
  return renderers[kind](payload, ctx);
}
