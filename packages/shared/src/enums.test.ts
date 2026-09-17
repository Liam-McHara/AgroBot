import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  ERROR_CODES,
  ERROR_STATUS,
  NOTIFICATION_KINDS,
  NotificationKinds,
  SETTING_KEYS,
  UNITS,
  UNIT_CODES,
  UNIT_LIST,
  isUnitCode,
  languageFromTelegram,
  unitName,
} from './enums.js';

describe('language', () => {
  it('maps Telegram language codes per PRD US-1.5', () => {
    expect(languageFromTelegram('es')).toBe('es');
    expect(languageFromTelegram('es-ES')).toBe('es');
    expect(languageFromTelegram('ca')).toBe('ca');
    expect(languageFromTelegram('en')).toBe('ca');
    expect(languageFromTelegram(null)).toBe('ca');
    expect(languageFromTelegram(undefined)).toBe('ca');
  });
});

describe('units', () => {
  it('allows decimals only for kg and litre (PRD US-3.1)', () => {
    const decimal = UNIT_CODES.filter((code) => UNITS[code].allowsDecimals);
    expect(decimal).toEqual(['kg', 'litre']);
  });

  it('steps at 1 for countable units and 0.1 for weighable ones', () => {
    for (const code of UNIT_CODES) {
      expect(UNITS[code].step, code).toBe(UNITS[code].allowsDecimals ? 0.1 : 1);
    }
  });

  it('lists units in sort order without gaps', () => {
    expect(UNIT_LIST.map((u) => u.sortOrder)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('names units in both languages', () => {
    expect(unitName('ca', 'box')).toBe('caixa');
    expect(unitName('es', 'box')).toBe('caja');
  });

  it('recognises unit codes', () => {
    expect(isUnitCode('kg')).toBe(true);
    expect(isUnitCode('kilo')).toBe(false);
  });
});

describe('notifications', () => {
  it('names every kind of the PRD §9 table exactly once', () => {
    const named = Object.values(NotificationKinds);
    expect([...named].sort()).toEqual([...NOTIFICATION_KINDS].sort());
    expect(new Set(named).size).toBe(NOTIFICATION_KINDS.length);
  });
});

describe('errors', () => {
  it('maps every error code to an HTTP status (ARCH §11)', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code], code).toBeGreaterThanOrEqual(400);
    }
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe('settings', () => {
  it('has a default for every key (PRD §10)', () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
  });
});
