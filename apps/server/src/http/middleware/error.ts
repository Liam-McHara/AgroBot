import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import { ERROR_STATUS, type ErrorCode } from '@agrobot/shared';
import { AppError } from '../errors.js';
import type { AppContext } from '../context.js';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'VALIDATION',
  422: 'VALIDATION',
  429: 'RATE_LIMITED',
};

/**
 * ARCH §11: every error leaves as `{ error: { code, message, details? } }`, localized.
 * Anything we did not classify is logged with the request id and reported as `INTERNAL`
 * carrying that id, so the toast the member sees is something they can quote back to us.
 */
export function errorHandler(error: unknown, c: Context<AppContext>): Response {
  const language = c.get('language') ?? 'ca';
  const requestId = c.get('requestId') ?? '';

  if (error instanceof AppError) {
    if (error.status >= 500) {
      c.get('logger')?.error({ err: error, code: error.code }, 'app error');
      c.get('reportError')?.(error, { requestId, operation: 'http' });
    }
    return c.json(error.body(language, { requestId }), error.status as 400);
  }

  if (error instanceof HTTPException) {
    const code = STATUS_TO_CODE[error.status] ?? 'INTERNAL';
    const appError = new AppError(code);
    if (code === 'INTERNAL') {
      c.get('logger')?.error({ err: error }, 'http error');
      c.get('reportError')?.(error, { requestId, operation: 'http' });
    }
    return c.json(
      appError.body(language, { requestId }),
      (error.status === 413 ? 413 : ERROR_STATUS[code]) as 400,
    );
  }

  c.get('logger')?.error({ err: error }, 'unhandled error');
  c.get('reportError')?.(error, { requestId, operation: 'http' });
  const internal = new AppError('INTERNAL');
  return c.json(internal.body(language, { requestId }), 500);
}

/** Hono's `notFound` hook, so a wrong path answers in the same shape as everything else. */
export function notFoundHandler(c: Context<AppContext>): Response {
  const appError = new AppError('NOT_FOUND');
  return c.json(appError.body(c.get('language') ?? 'ca'), 404);
}
