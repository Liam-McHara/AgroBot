import { InlineKeyboard } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { createTranslator, unitName, type Language, type Translator } from '@agrobot/shared';
import type { Env } from '../../env.js';
import type {
  ImplementedNotificationKind,
  NotificationPayloads,
  OfferProductPayload,
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

/** The product in the reader's language (PRD US-3.3), escaped, with its unit. */
function productParams(payload: OfferProductPayload, language: Language) {
  const name =
    language === 'es' ? payload.productNameEs || payload.productName : payload.productName;
  return { product: escapeHtml(name), unit: unitName(language, payload.unitCode) };
}

export const renderers: RendererRegistry = {
  /** PRD N3: a new or re-published offer → every other member, with *Open offer*. */
  N3: (payload, { t, link, language }) => ({
    text: t(payload.republished ? 'notification.N3.republished' : 'notification.N3.text', {
      ...productParams(payload, language),
      producer: escapeHtml(payload.producerName),
      quantity: payload.quantity,
    }),
    replyMarkup: new InlineKeyboard().url(t('notification.N3.open'), link(`o_${payload.offerId}`)),
  }),

  /** PRD N10: "still available?" → the producer, with *Yes* · *Withdraw* (US-3.4). */
  N10: (payload, { t, link, language }) => ({
    text: t('notification.N10.text', {
      ...productParams(payload, language),
      quantity: payload.quantity,
    }),
    replyMarkup: new InlineKeyboard()
      .text(t('notification.N10.still'), quickActionData('still', payload.offerId))
      .text(t('notification.N10.withdraw'), quickActionData('withdraw', payload.offerId))
      .row()
      .url(t('notification.N3.open'), link(`o_${payload.offerId}`)),
  }),

  /** PRD N11: withdrawn with open reservations → the producer, with the list to resolve. */
  N11: (payload, { t, link, language }) => {
    const { product, unit } = productParams(payload, language);
    const lines = payload.reservations
      .map((r) =>
        t('notification.N11.line', {
          name: escapeHtml(r.requesterName),
          quantity: r.quantity,
          unit,
        }),
      )
      .join('\n');
    return {
      text: `${t('notification.N11.text', { product, count: payload.reservations.length })}\n${lines}`,
      replyMarkup: new InlineKeyboard().url(
        t('notification.N11.open'),
        link(`o_${payload.offerId}`),
      ),
    };
  },

  N4: (payload, { t, link }) => ({
    text: t('notification.N4.text', { name: escapeHtml(payload.name) }),
    replyMarkup: new InlineKeyboard().url(t('catalog.title'), link('a_catalog')),
  }),
  N5: (payload, { t, link }) => ({
    text: t(`notification.N5.${payload.decision}`, { name: escapeHtml(payload.name) }),
    replyMarkup: new InlineKeyboard().url(t('bot.button.open_app'), link()),
  }),
  N12: (_payload, { t, link }) => ({
    text: t('notification.N12.text'),
    replyMarkup: new InlineKeyboard().url(t('catalog.title'), link('a_catalog')),
  }),
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
