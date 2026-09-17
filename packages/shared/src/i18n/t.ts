import { DEFAULT_LANGUAGE, DISPLAY_TIMEZONE, CURRENCY, type Language } from '../enums.js';
import { catalogs, type Message, type MessageKey } from './catalog.js';

/**
 * Values a message placeholder can be given. `Date`/number/string cover everything the
 * catalogues need today; anything else is a bug caught by the type checker.
 */
export type MessageParam = string | number | boolean | Date | null | undefined;
export type MessageParams = Record<string, MessageParam>;

/** BCP-47 tags for the languages of ADR-0007. */
const LOCALE_TAG: { readonly [L in Language]: string } = {
  ca: 'ca-ES',
  es: 'es-ES',
};

/**
 * `{name}`                 → the raw value
 * `{count, number}`        → Intl.NumberFormat
 * `{quantity, number, 1}`  → Intl.NumberFormat with at most 1 fraction digit
 * `{price, money}`         → integer cents → "1,20 €"
 * `{when, date}`           → 17/09/2026 (Europe/Madrid)
 * `{when, datetime}`       → 17/09/2026, 14:05
 * `{when, time}`           → 14:05
 */
const PLACEHOLDER = /\{(\w+)(?:\s*,\s*([a-z]+)(?:\s*,\s*([a-zA-Z0-9]+))?)?\}/g;

function formatNumber(locale: Language, value: number, maxFractionDigits?: number): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    maximumFractionDigits: maxFractionDigits ?? 2,
  }).format(value);
}

function formatMoney(locale: Language, cents: number): string {
  return new Intl.NumberFormat(LOCALE_TAG[locale], {
    style: 'currency',
    currency: CURRENCY,
  }).format(cents / 100);
}

function toDate(value: MessageParam): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatDate(
  locale: Language,
  value: MessageParam,
  style: 'date' | 'datetime' | 'time',
): string {
  const date = toDate(value);
  if (!date) return String(value ?? '');
  const options: Intl.DateTimeFormatOptions = { timeZone: DISPLAY_TIMEZONE };
  if (style !== 'time') {
    options.day = '2-digit';
    options.month = '2-digit';
    options.year = 'numeric';
  }
  if (style !== 'date') {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], options).format(date);
}

function selectPlural(locale: Language, message: Message, params: MessageParams): string {
  if (typeof message === 'string') return message;
  const count = params['count'];
  if (typeof count !== 'number') return message.other;
  const category = new Intl.PluralRules(LOCALE_TAG[locale]).select(count);
  return message[category] ?? message.other;
}

function interpolate(locale: Language, template: string, params: MessageParams): string {
  return template.replace(PLACEHOLDER, (match, name: string, kind?: string, arg?: string) => {
    if (!(name in params)) return match;
    const value = params[name];
    if (value === null || value === undefined) return '';
    switch (kind) {
      case undefined:
        return String(value);
      case 'number':
        return typeof value === 'number'
          ? formatNumber(locale, value, arg === undefined ? undefined : Number(arg))
          : String(value);
      case 'money':
        return typeof value === 'number' ? formatMoney(locale, value) : String(value);
      case 'date':
      case 'datetime':
      case 'time':
        return formatDate(locale, value, kind);
      default:
        return String(value);
    }
  });
}

/** Render one catalogue entry: pick the plural form, then fill the placeholders. */
export function renderMessage(
  locale: Language,
  message: Message,
  params: MessageParams = {},
): string {
  return interpolate(locale, selectPlural(locale, message, params), params);
}

/**
 * Translate `key` into `locale`.
 *
 * A key missing from the requested catalogue falls back to the default language and, failing
 * that, to the key itself: a visible "offer.title" in the UI is better than a crash, and
 * `pnpm i18n:check` fails the build long before that can reach a member (ARCH §16).
 */
export function translate(locale: Language, key: MessageKey, params: MessageParams = {}): string {
  const message = catalogs[locale]?.[key] ?? catalogs[DEFAULT_LANGUAGE][key];
  if (message === undefined) return key;
  return renderMessage(locale, message, params);
}

export type Translator = (key: MessageKey, params?: MessageParams) => string;

/** `t()` bound to one member's language, as used by the bot, the API and the Mini App. */
export function createTranslator(locale: Language): Translator {
  return (key, params) => translate(locale, key, params);
}

export const formatters = {
  number: formatNumber,
  money: formatMoney,
  date: (locale: Language, value: MessageParam) => formatDate(locale, value, 'date'),
  datetime: (locale: Language, value: MessageParam) => formatDate(locale, value, 'datetime'),
  time: (locale: Language, value: MessageParam) => formatDate(locale, value, 'time'),
};
