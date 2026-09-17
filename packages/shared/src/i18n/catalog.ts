import ca from '../messages/ca.json' with { type: 'json' };
import es from '../messages/es.json' with { type: 'json' };
import { LANGUAGES, type Language } from '../enums.js';

/**
 * A message is either a plain string or a set of plural forms selected with `Intl.PluralRules`
 * from the `count` parameter. Catalan and Spanish both use `one`/`other`; the type allows the
 * full CLDR set so a third language (ADR-0007) is only a new JSON file.
 */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Message = string | PluralForms;

/** `ca.json` is the reference catalogue: its keys are *the* key set (ADR-0007). */
export type MessageKey = keyof typeof ca;

export type MessageCatalog = Record<MessageKey, Message>;

export const catalogs: { readonly [L in Language]: MessageCatalog } = {
  ca: ca as MessageCatalog,
  es: es as unknown as MessageCatalog,
};

export const MESSAGE_KEYS = Object.keys(ca) as MessageKey[];

export function isMessageKey(value: unknown): value is MessageKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ca, value);
}

export { LANGUAGES };
