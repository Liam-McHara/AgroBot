import { describe, expect, it } from 'vitest';
import { createTranslator, renderMessage, translate } from './t.js';
import { catalogs, MESSAGE_KEYS, isMessageKey } from './catalog.js';
import { LANGUAGES } from '../enums.js';

describe('catalogues', () => {
  it('has the same keys in every language (ADR-0007)', () => {
    const reference = [...MESSAGE_KEYS].sort();
    for (const language of LANGUAGES) {
      expect([...Object.keys(catalogs[language])].sort(), language).toEqual(reference);
    }
  });

  it('recognises its own keys', () => {
    expect(isMessageKey('common.loading')).toBe(true);
    expect(isMessageKey('nope.not.a.key')).toBe(false);
  });

  it('leaves no placeholder untranslated between languages', () => {
    const placeholders = (value: unknown): string[] =>
      typeof value === 'string' ? [...value.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort() : [];
    for (const key of MESSAGE_KEYS) {
      expect(placeholders(catalogs.es[key]), key).toEqual(placeholders(catalogs.ca[key]));
    }
  });
});

describe('translate', () => {
  it('returns the message for the requested language', () => {
    expect(translate('ca', 'common.loading')).toBe('Carregant…');
    expect(translate('es', 'common.loading')).toBe('Cargando…');
  });

  it('interpolates named parameters', () => {
    expect(translate('ca', 'bot.start.member', { name: 'Marta' })).toContain('Hola, Marta!');
    expect(translate('es', 'bot.start.member', { name: 'Marta' })).toContain('¡Hola, Marta!');
  });

  it('leaves a placeholder alone when no parameter is given', () => {
    expect(translate('ca', 'bot.start.member')).toContain('Hola, {name}!');
  });

  it('formats numbers per locale', () => {
    expect(translate('ca', 'error.INSUFFICIENT_AVAILABILITY', { available: 2.5 })).toContain('2,5');
  });

  it('binds a language with createTranslator', () => {
    const t = createTranslator('es');
    expect(t('common.retry')).toBe('Vuelve a intentarlo');
  });

  it('falls back to the key when it is unknown at runtime', () => {
    // @ts-expect-error — deliberately not a MessageKey; `pnpm i18n:check` is the real guard.
    expect(translate('ca', 'does.not.exist')).toBe('does.not.exist');
  });
});

describe('renderMessage', () => {
  it('selects the plural form from `count`', () => {
    const message = { one: '{count} oferta', other: '{count} ofertes' };
    expect(renderMessage('ca', message, { count: 1 })).toBe('1 oferta');
    expect(renderMessage('ca', message, { count: 4 })).toBe('4 ofertes');
    expect(renderMessage('ca', message, { count: 0 })).toBe('0 ofertes');
  });

  it('falls back to `other` when no count is given', () => {
    expect(renderMessage('es', { one: 'uno', other: 'varios' })).toBe('varios');
  });

  it('formats numbers with an explicit fraction-digit limit', () => {
    expect(renderMessage('ca', '{q, number, 1} kg', { q: 2.46 })).toBe('2,5 kg');
    expect(renderMessage('es', '{q, number} kg', { q: 1234.5 })).toBe('1234,5 kg');
  });

  it('formats money from integer cents in EUR', () => {
    // Intl separates the amount from the symbol with a non-breaking space.
    expect(renderMessage('ca', '{p, money}', { p: 120 }).replace(/\s/gu, ' ')).toBe('1,20 €');
  });

  it('formats dates and times in Europe/Madrid', () => {
    const at = new Date('2026-09-17T12:05:00Z'); // 14:05 in Madrid (CEST)
    expect(renderMessage('ca', '{d, date}', { d: at })).toBe('17/09/2026');
    expect(renderMessage('ca', '{d, time}', { d: at })).toBe('14:05');
    expect(renderMessage('ca', '{d, datetime}', { d: at })).toContain('14:05');
  });

  it('renders an empty string for null and undefined parameters', () => {
    expect(renderMessage('ca', 'a{x}b', { x: null })).toBe('ab');
    expect(renderMessage('ca', 'a{x}b', { x: undefined })).toBe('ab');
  });
});
