import { pino, type Logger } from 'pino';
import type { Env } from './env.js';

/**
 * Structured JSON logs with request ids (PRD §12 Observability). Secrets never reach the
 * logs: `env.ts` values are not logged, and these paths are redacted defensively.
 */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'LOG_PRETTY' | 'NODE_ENV'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'agrobot' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-telegram-bot-api-secret-token"]',
        '*.token',
        '*.BOT_TOKEN',
      ],
      censor: '[redacted]',
    },
    ...(env.LOG_PRETTY ? { transport: { target: 'pino/file', options: { destination: 1 } } } : {}),
  });
}

export type { Logger };
