import { describe, expect, it } from 'vitest';
import { EnvError, devAuthBypassId, parseEnv } from './env.js';

const MINIMAL = {
  BOT_TOKEN: '123:abc',
  BOT_USERNAME: 'AgroBot',
  MINIAPP_SHORT_NAME: 'app',
  BOT_MODE: 'polling',
  DATABASE_URL: 'postgres://localhost/agrobot',
  CATALOG_SOURCE: 'csv',
  CATALOG_CSV_URL: 'https://example.test/catalog.csv',
} satisfies NodeJS.ProcessEnv;

function problemsOf(source: NodeJS.ProcessEnv): string[] {
  try {
    parseEnv(source);
    return [];
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
}

describe('parseEnv', () => {
  it('applies the defaults of ARCH §13', () => {
    const env = parseEnv(MINIMAL);
    expect(env.PORT).toBe(8080);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DEFAULT_LOCALE).toBe('ca');
    expect(env.TZ).toBe('Europe/Madrid');
    expect(env.GOOGLE_SHEET_RANGE).toBe('Productes!A:E');
    expect(env.ADMIN_TELEGRAM_IDS).toEqual([]);
  });

  it('lists every missing required variable at once', () => {
    const problems = problemsOf({});
    expect(problems.join('\n')).toContain('BOT_TOKEN');
    expect(problems.join('\n')).toContain('DATABASE_URL');
    expect(problems.length).toBeGreaterThan(2);
  });

  it('parses ADMIN_TELEGRAM_IDS as a comma-separated list', () => {
    expect(parseEnv({ ...MINIMAL, ADMIN_TELEGRAM_IDS: ' 111 , 222 ' }).ADMIN_TELEGRAM_IDS).toEqual([
      '111',
      '222',
    ]);
  });

  it('refuses an ADMIN_TELEGRAM_IDS entry that is not a Telegram id', () => {
    expect(problemsOf({ ...MINIMAL, ADMIN_TELEGRAM_IDS: '@marta' }).join()).toContain(
      'ADMIN_TELEGRAM_IDS',
    );
  });

  it('requires PUBLIC_URL and a webhook secret in webhook mode', () => {
    const problems = problemsOf({ ...MINIMAL, BOT_MODE: 'webhook' });
    expect(problems.join('\n')).toContain('PUBLIC_URL');
    expect(problems.join('\n')).toContain('TELEGRAM_WEBHOOK_SECRET');
  });

  it('requires a webhook secret long enough to be a secret (ARCH §13)', () => {
    const problems = problemsOf({
      ...MINIMAL,
      BOT_MODE: 'webhook',
      PUBLIC_URL: 'https://agrobot.test',
      TELEGRAM_WEBHOOK_SECRET: 'short',
    });
    expect(problems.join('\n')).toContain('TELEGRAM_WEBHOOK_SECRET');
  });

  it('accepts a complete webhook configuration', () => {
    const env = parseEnv({
      ...MINIMAL,
      BOT_MODE: 'webhook',
      PUBLIC_URL: 'https://agrobot.test',
      TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
    });
    expect(env.BOT_MODE).toBe('webhook');
  });

  it('requires the sheet variables in sheets mode', () => {
    const problems = problemsOf({
      ...MINIMAL,
      CATALOG_SOURCE: 'sheets',
      CATALOG_CSV_URL: undefined,
    });
    expect(problems.join('\n')).toContain('GOOGLE_SHEET_ID');
    expect(problems.join('\n')).toContain('GOOGLE_SERVICE_ACCOUNT_JSON');
  });

  it('requires the CSV url in csv mode', () => {
    expect(problemsOf({ ...MINIMAL, CATALOG_CSV_URL: undefined }).join('\n')).toContain(
      'CATALOG_CSV_URL',
    );
  });

  it('refuses the dev auth bypass in production (ARCH §4)', () => {
    const problems = problemsOf({
      ...MINIMAL,
      NODE_ENV: 'production',
      DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001',
    });
    expect(problems.join('\n')).toContain('DEV_AUTH_BYPASS_TELEGRAM_ID');
  });
});

describe('devAuthBypassId', () => {
  it('is the configured id outside production', () => {
    const env = parseEnv({ ...MINIMAL, DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001' });
    expect(devAuthBypassId(env)).toBe('900000001');
  });

  it('is undefined when nothing is configured', () => {
    expect(devAuthBypassId(parseEnv(MINIMAL))).toBeUndefined();
  });
});
