/* eslint-disable no-console -- this is the one place that is allowed to write to the console */

/**
 * Structured JSON logs (PRD §12 Observability, ARCH §3).
 *
 * One JSON object per line on the console, which Workers Logs ingests with the level taken
 * from the console method used. The shape follows what the rest of the code already expects:
 * `logger.info({ some: 'context' }, 'message')`, `logger.error({ err }, 'message')`, and
 * `logger.child({ requestId })` for a logger that stamps every line.
 *
 * Secrets never reach the logs: `env.ts` values are not logged, and the keys below are
 * redacted defensively wherever they appear in a log object.
 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogContext = Readonly<Record<string, unknown>>;

export interface LogMethod {
  (context: LogContext, message?: string): void;
  (message: string): void;
}

export interface Logger {
  readonly level: LogLevel;
  trace: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  fatal: LogMethod;
  /** A logger that adds `bindings` to every line, e.g. the request id. */
  child(bindings: LogContext): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Stamped on every line, under the service name. */
  bindings?: LogContext;
  /** Where lines go; the console by default. Tests pass a collector. */
  sink?: (level: LogLevel, line: string) => void;
  now?: () => Date;
}

const REDACTED_KEYS = new Set([
  'authorization',
  'cookie',
  'token',
  'bot_token',
  'x-telegram-bot-api-secret-token',
  'telegram_webhook_secret',
  'google_service_account_json',
  'sentry_dsn',
  'database_url',
  'connectionstring',
]);

const MAX_DEPTH = 6;

function serializeError(error: Error, depth: number): Record<string, unknown> {
  const result: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
  for (const [key, value] of Object.entries(error)) {
    if (!(key in result)) result[key] = sanitize(value, depth + 1);
  }
  if (error.cause !== undefined) result['cause'] = sanitize(error.cause, depth + 1);
  return result;
}

/** Redact secret-looking keys, expand errors, and stop at a depth so a cycle cannot hang. */
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth]';
  if (value instanceof Error) return serializeError(value, depth);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return result;
  }
  return value;
}

function consoleSink(level: LogLevel, line: string): void {
  if (level === 'error' || level === 'fatal') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level === 'debug' || level === 'trace') console.debug(line);
  else console.log(line);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const threshold = LOG_LEVELS.indexOf(level);
  const sink = options.sink ?? consoleSink;
  const now = options.now ?? (() => new Date());
  const bindings = options.bindings ?? {};

  const write = (lineLevel: LogLevel, context: LogContext | string, message?: string): void => {
    if (LOG_LEVELS.indexOf(lineLevel) < threshold || level === 'silent') return;
    const [fields, msg] =
      typeof context === 'string' ? [{}, context] : [sanitize(context) as LogContext, message];
    const line = {
      level: lineLevel,
      time: now().toISOString(),
      service: 'agrobot',
      ...bindings,
      ...fields,
      ...(msg === undefined ? {} : { msg }),
    };
    sink(lineLevel, JSON.stringify(line));
  };

  const method = (lineLevel: LogLevel): LogMethod =>
    ((context: LogContext | string, message?: string) =>
      write(lineLevel, context, message)) as LogMethod;

  return {
    level,
    trace: method('trace'),
    debug: method('debug'),
    info: method('info'),
    warn: method('warn'),
    error: method('error'),
    fatal: method('fatal'),
    child(extra) {
      return createLogger({
        level,
        bindings: { ...bindings, ...(sanitize(extra) as LogContext) },
        sink,
        now,
      });
    },
  };
}

/** For tests and scripts that want no output at all. */
export const silentLogger: Logger = createLogger({ level: 'silent' });
