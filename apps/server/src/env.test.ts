import { describe, expect, it } from 'vitest';
import {
  EnvError,
  allowedSocketOrigins,
  devAuthBypassId,
  parseEnv,
  telegramClientOptions,
} from './env.js';

const MINIMAL = {
  BOT_TOKEN: '123:abc',
  BOT_USERNAME: 'AgroBot',
  MINIAPP_SHORT_NAME: 'app',
  PUBLIC_URL: 'https://agrobot.test',
  TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
  CATALOG_SOURCE: 'csv',
  CATALOG_CSV_URL: 'https://example.test/catalog.csv',
} satisfies Record<string, string>;

function problemsOf(source: Record<string, unknown>): string[] {
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
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DEFAULT_LOCALE).toBe('ca');
    expect(env.TZ).toBe('Europe/Madrid');
    expect(env.GOOGLE_SHEET_RANGE).toBe('Productes!A:E');
    expect(env.GIT_COMMIT).toBe('dev');
    expect(env.ADMIN_TELEGRAM_IDS).toEqual([]);
  });

  it('lists every missing required variable at once', () => {
    const problems = problemsOf({});
    expect(problems.join('\n')).toContain('BOT_TOKEN');
    expect(problems.join('\n')).toContain('PUBLIC_URL');
    expect(problems.join('\n')).toContain('TELEGRAM_WEBHOOK_SECRET');
    expect(problems.length).toBeGreaterThan(3);
  });

  it('ignores the bindings that share the object with the variables', () => {
    const env = parseEnv({
      ...MINIMAL,
      HYPERDRIVE: { connectionString: 'postgres://secret' },
      HUB: { idFromName: () => 'x' },
    });
    expect(env.BOT_TOKEN).toBe('123:abc');
    expect(env).not.toHaveProperty('HYPERDRIVE');
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

  it('requires a webhook secret long enough to be a secret (ARCH §13)', () => {
    const problems = problemsOf({ ...MINIMAL, TELEGRAM_WEBHOOK_SECRET: 'short' });
    expect(problems.join('\n')).toContain('TELEGRAM_WEBHOOK_SECRET');
  });

  it('requires PUBLIC_URL to be a URL', () => {
    expect(problemsOf({ ...MINIMAL, PUBLIC_URL: 'agrobot' }).join('\n')).toContain('PUBLIC_URL');
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

  it('never carries a variable value in its problems', () => {
    const problems = problemsOf({ ...MINIMAL, BOT_TOKEN: '', PUBLIC_URL: 'not a url' });
    expect(problems.join('\n')).not.toContain('not a url');
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

describe('allowedSocketOrigins (ARCH §7, §17)', () => {
  it('is only PUBLIC_URL in production', () => {
    const env = parseEnv({ ...MINIMAL, NODE_ENV: 'production' });
    expect(allowedSocketOrigins(env)).toEqual(['https://agrobot.test']);
  });

  it('adds the local dev servers outside production, without duplicates', () => {
    const origins = allowedSocketOrigins(
      parseEnv({ ...MINIMAL, PUBLIC_URL: 'http://localhost:8080' }),
    );
    expect(origins[0]).toBe('http://localhost:8080');
    expect(origins).toContain('http://localhost:5173');
    expect(new Set(origins).size).toBe(origins.length);
  });

  it('points grammY at a fake Bot API outside production only (ARCH §13, §16)', () => {
    const dev = parseEnv({ ...MINIMAL, TELEGRAM_API_ROOT: 'http://127.0.0.1:8089' });
    expect(telegramClientOptions(dev, 20)).toEqual({
      timeoutSeconds: 20,
      apiRoot: 'http://127.0.0.1:8089',
    });
    expect(telegramClientOptions(parseEnv(MINIMAL), 20)).toEqual({ timeoutSeconds: 20 });
    expect(
      problemsOf({ ...MINIMAL, NODE_ENV: 'production', TELEGRAM_API_ROOT: 'http://127.0.0.1:1' }),
    ).toEqual(['TELEGRAM_API_ROOT: must not be set in production (ARCH §13)']);
    expect(problemsOf({ ...MINIMAL, TELEGRAM_API_ROOT: 'not a url' })).toHaveLength(1);
  });
});
