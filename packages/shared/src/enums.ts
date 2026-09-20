/**
 * Every enumerated value AgroBot 2.0 knows about.
 *
 * This file is the single source of truth shared by the server, the bot and the Mini App.
 * Values mirror PRD §3, §9, §10 and ARCH §5, §6, §11 — when one of those documents changes,
 * this file changes in the same commit.
 */

/** Helper: turn a readonly tuple into a zod-friendly union type. */
type Values<T extends readonly unknown[]> = T[number];

// ---------------------------------------------------------------------------
// Language (ADR-0007)
// ---------------------------------------------------------------------------

export const LANGUAGES = ['ca', 'es'] as const;
export type Language = Values<typeof LANGUAGES>;

/** PRD US-1.5: `es*` → `es`, anything else → `ca`. */
export const DEFAULT_LANGUAGE: Language = 'ca';

export function languageFromTelegram(languageCode: string | null | undefined): Language {
  return languageCode?.toLowerCase().startsWith('es') ? 'es' : DEFAULT_LANGUAGE;
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Members (PRD §2, ARCH §6 member machine)
// ---------------------------------------------------------------------------

export const MEMBER_STATUSES = ['pending', 'approved', 'rejected', 'suspended'] as const;
export type MemberStatus = Values<typeof MEMBER_STATUSES>;

export const MEMBER_ROLES = ['member', 'admin'] as const;
export type MemberRole = Values<typeof MEMBER_ROLES>;

// ---------------------------------------------------------------------------
// Units (PRD §3, US-3.1; Q5: per-unit constants, not settings)
// ---------------------------------------------------------------------------

export const UNIT_CODES = ['kg', 'unit', 'box', 'bunch', 'dozen', 'litre'] as const;
export type UnitCode = Values<typeof UNIT_CODES>;

export interface UnitDefinition {
  readonly code: UnitCode;
  readonly nameCa: string;
  readonly nameEs: string;
  /** Whether quantities may have a fractional part at all. */
  readonly allowsDecimals: boolean;
  /** Input/validation step. Quantities must be a positive multiple of it. */
  readonly step: number;
  readonly sortOrder: number;
}

/**
 * PRD US-3.1: integers for `unit`/`box`/`bunch`/`dozen`, one decimal for `kg`/`litre`.
 * The server seeds the `units` table from this table, so both sides validate identically.
 */
export const UNITS: { readonly [C in UnitCode]: UnitDefinition } = {
  kg: { code: 'kg', nameCa: 'kg', nameEs: 'kg', allowsDecimals: true, step: 0.1, sortOrder: 1 },
  unit: {
    code: 'unit',
    nameCa: 'unitat',
    nameEs: 'unidad',
    allowsDecimals: false,
    step: 1,
    sortOrder: 2,
  },
  box: {
    code: 'box',
    nameCa: 'caixa',
    nameEs: 'caja',
    allowsDecimals: false,
    step: 1,
    sortOrder: 3,
  },
  bunch: {
    code: 'bunch',
    nameCa: 'manat',
    nameEs: 'manojo',
    allowsDecimals: false,
    step: 1,
    sortOrder: 4,
  },
  dozen: {
    code: 'dozen',
    nameCa: 'dotzena',
    nameEs: 'docena',
    allowsDecimals: false,
    step: 1,
    sortOrder: 5,
  },
  litre: {
    code: 'litre',
    nameCa: 'litre',
    nameEs: 'litro',
    allowsDecimals: true,
    step: 0.1,
    sortOrder: 6,
  },
} as const;

export const UNIT_LIST: readonly UnitDefinition[] = UNIT_CODES.map((code) => UNITS[code]);

export function isUnitCode(value: unknown): value is UnitCode {
  return typeof value === 'string' && (UNIT_CODES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Products (PRD §6, ARCH §6 product machine)
// ---------------------------------------------------------------------------

export const PRODUCT_STATUSES = ['active', 'archived', 'pending'] as const;
export type ProductStatus = Values<typeof PRODUCT_STATUSES>;

export const PRODUCT_SOURCES = ['sheet', 'member'] as const;
export type ProductSource = Values<typeof PRODUCT_SOURCES>;

// ---------------------------------------------------------------------------
// Offers (PRD §7, ARCH §6 offer machine)
// ---------------------------------------------------------------------------

export const OFFER_STATUSES = ['active', 'withdrawn', 'expired'] as const;
export type OfferStatus = Values<typeof OFFER_STATUSES>;

// ---------------------------------------------------------------------------
// Reservations (PRD §8, ARCH §6 reservation machine)
// ---------------------------------------------------------------------------

export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'delivered',
  'rejected',
  'cancelled',
  'expired',
] as const;
export type ReservationStatus = Values<typeof RESERVATION_STATUSES>;

/** Statuses that hold quantity on an offer (ARCH §5 derived rules). */
export const RESERVATION_HOLDING_STATUSES = ['pending', 'confirmed'] as const;

/** PRD US-4.6: the *active* tab. */
export const RESERVATION_ACTIVE_STATUSES = ['pending', 'confirmed'] as const;

/** PRD US-4.6: the *closed* tab. */
export const RESERVATION_CLOSED_STATUSES = [
  'delivered',
  'rejected',
  'cancelled',
  'expired',
] as const;

export const RESERVATION_SIDES = ['incoming', 'outgoing'] as const;
export type ReservationSide = Values<typeof RESERVATION_SIDES>;

/** PRD US-4.6: the two tabs of *My reservations*. */
export const RESERVATION_STATES = ['active', 'closed'] as const;
export type ReservationState = Values<typeof RESERVATION_STATES>;

/** PRD US-4.6: the *closed* tab shows the last 30 days. */
export const RESERVATION_CLOSED_WINDOW_DAYS = 30;

/**
 * ARCH §6 reservation machine: what a party can ask for. `confirm-and-deliver` is the top row
 * travelled in one transaction, a Mini App action only (ADR-0014).
 */
export const RESERVATION_ACTIONS = [
  'confirm',
  'reject',
  'cancel',
  'deliver',
  'confirm-and-deliver',
] as const;
export type ReservationAction = Values<typeof RESERVATION_ACTIONS>;

/** ARCH §6: the transitions that write a system line into the thread (PRD US-5.1). */
export const RESERVATION_EVENTS = [
  'created',
  'confirmed',
  'rejected',
  'cancelled',
  'delivered',
  'expired',
] as const;
export type ReservationEvent = Values<typeof RESERVATION_EVENTS>;

// ---------------------------------------------------------------------------
// Threads (PRD US-5.1, ARCH §5 messages)
// ---------------------------------------------------------------------------

export const MESSAGE_KINDS = ['text', 'system'] as const;
export type MessageKind = Values<typeof MESSAGE_KINDS>;

/** PRD US-5.1: text messages are 1–2000 characters. */
export const MESSAGE_MAX_LENGTH = 2000;

/** PRD N9: how much of the first message of a burst the Telegram notification quotes. */
export const MESSAGE_PREVIEW_LENGTH = 120;

/** PRD US-3.1 / US-4.2: notes and reasons are at most 200 characters. */
export const NOTE_MAX_LENGTH = 200;
export const REASON_MAX_LENGTH = 200;

/** PRD US-1.5: display names are 2–40 characters. */
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 40;

// ---------------------------------------------------------------------------
// Notifications (PRD §9, ARCH §8)
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  'N1',
  'N2',
  'N3',
  'N4',
  'N5',
  'N6',
  'N7',
  'N8',
  'N9',
  'N10',
  'N11',
  'N12',
] as const;
export type NotificationKind = Values<typeof NOTIFICATION_KINDS>;

/** Readable aliases for the PRD §9 table, so code does not read like a bingo card. */
export const NotificationKinds = {
  NewApplicant: 'N1',
  MembershipDecided: 'N2',
  NewOffer: 'N3',
  ProductProposed: 'N4',
  ProductResolved: 'N5',
  ReservationCreated: 'N6',
  ReservationExpiring: 'N7',
  ReservationClosed: 'N8',
  NewChatMessage: 'N9',
  OfferNudge: 'N10',
  OfferWithdrawnWithReservations: 'N11',
  CatalogSyncFailed: 'N12',
} as const satisfies Record<string, NotificationKind>;

export const NOTIFICATION_STATUSES = ['queued', 'sent', 'failed'] as const;
export type NotificationStatus = Values<typeof NOTIFICATION_STATUSES>;

/** ARCH §8 step 2: exponential backoff, then `failed`. Minutes. */
export const NOTIFICATION_RETRY_DELAYS_MINUTES = [1, 5, 30] as const;

// ---------------------------------------------------------------------------
// Catalogue sync (PRD §6, ARCH §10)
// ---------------------------------------------------------------------------

export const CATALOG_SOURCES = ['sheets', 'csv'] as const;
export type CatalogSource = Values<typeof CATALOG_SOURCES>;

export const CATALOG_SYNC_STATUSES = ['ok', 'partial', 'failed'] as const;
export type CatalogSyncStatus = Values<typeof CATALOG_SYNC_STATUSES>;

export const CATALOG_SYNC_TRIGGERS = ['schedule', 'manual', 'command'] as const;
export type CatalogSyncTrigger = Values<typeof CATALOG_SYNC_TRIGGERS>;

// ---------------------------------------------------------------------------
// Group settings (PRD §10)
// ---------------------------------------------------------------------------

export const SETTING_KEYS = [
  'reservation_expiry_hours',
  'reservation_reminder_hours_before_expiry',
  'offer_nudge_days',
  'offer_stale_days_after_nudge',
  'thread_readonly_days_after_close',
  'notify_new_offer',
] as const;
export type SettingKey = Values<typeof SETTING_KEYS>;

export interface Settings {
  reservation_expiry_hours: number;
  reservation_reminder_hours_before_expiry: number;
  offer_nudge_days: number;
  offer_stale_days_after_nudge: number;
  thread_readonly_days_after_close: number;
  notify_new_offer: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  reservation_expiry_hours: 48,
  reservation_reminder_hours_before_expiry: 12,
  offer_nudge_days: 7,
  offer_stale_days_after_nudge: 3,
  thread_readonly_days_after_close: 7,
  notify_new_offer: true,
};

// ---------------------------------------------------------------------------
// Errors (ARCH §11 "Error handling")
// ---------------------------------------------------------------------------

export const ERROR_CODES = [
  'VALIDATION',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_APPROVED',
  'SUSPENDED',
  'NOT_FOUND',
  'CONFLICT',
  'OFFER_ALREADY_ACTIVE',
  'INSUFFICIENT_AVAILABILITY',
  'OFFER_QUANTITY_BELOW_HELD',
  'INVALID_TRANSITION',
  'LAST_ADMIN',
  'THREAD_READONLY',
  'CATALOG_SYNC_FAILED',
  'RATE_LIMITED',
  'INTERNAL',
] as const;
export type ErrorCode = Values<typeof ERROR_CODES>;

/** ARCH §11: "HTTP status follows the code". One table, no guessing at the call site. */
export const ERROR_STATUS: { readonly [C in ErrorCode]: number } = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_APPROVED: 403,
  SUSPENDED: 403,
  THREAD_READONLY: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OFFER_ALREADY_ACTIVE: 409,
  INSUFFICIENT_AVAILABILITY: 409,
  OFFER_QUANTITY_BELOW_HELD: 422,
  INVALID_TRANSITION: 422,
  LAST_ADMIN: 422,
  CATALOG_SYNC_FAILED: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

// ---------------------------------------------------------------------------
// Miscellaneous constants
// ---------------------------------------------------------------------------

/** ARCH §13: display timezone. Storage is always UTC. */
export const DISPLAY_TIMEZONE = 'Europe/Madrid';

/** PRD §12: EUR everywhere; money is integer cents in code. */
export const CURRENCY = 'EUR';

/** The unit's name in the member's language, e.g. `caixa` / `caja`. */
export function unitName(locale: Language, code: UnitCode): string {
  return locale === 'es' ? UNITS[code].nameEs : UNITS[code].nameCa;
}
