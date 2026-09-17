import {
  DEFAULT_LANGUAGE,
  createTranslator,
  languageFromTelegram,
  type Language,
  type MessageKey,
  type MessageParams,
} from '@agrobot/shared';
import { initTelegram } from '../telegram.js';

/**
 * ARCH §12: the UI language is the member's choice from `GET /me`, and Telegram's
 * `language_code` until that arrives. One catalogue for the bot and the app (ADR-0007).
 *
 * The current language is reactive state, so every `t()` in a template re-renders the moment
 * it changes — which is what PRD US-1.5 asks of the language switch in Settings.
 */
let current = $state<Language>(DEFAULT_LANGUAGE);

export function initLanguage(): Language {
  current = languageFromTelegram(initTelegram().languageCode);
  return current;
}

export function language(): Language {
  return current;
}

export function setLanguage(next: Language): void {
  current = next;
}

export function t(key: MessageKey, params?: MessageParams): string {
  return createTranslator(current)(key, params);
}
