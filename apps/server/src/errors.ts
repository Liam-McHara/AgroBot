import {
  ERROR_STATUS,
  translate,
  type ErrorCode,
  type ErrorBody,
  type Language,
  type MessageKey,
  type MessageParams,
} from '@agrobot/shared';

/**
 * The one error type the whole server throws (ARCH §11).
 *
 * The HTTP status is derived from the code, and the message is rendered in the reader's
 * language at the edge — never baked in at the throw site, which does not know who is asking.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly params: MessageParams;
  readonly details: unknown;

  constructor(
    code: ErrorCode,
    options: { params?: MessageParams; details?: unknown; cause?: unknown } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.params = options.params ?? {};
    this.details = options.details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  get messageKey(): MessageKey {
    return `error.${this.code}` as MessageKey;
  }

  body(language: Language, extraParams: MessageParams = {}): ErrorBody {
    const message = translate(language, this.messageKey, { ...extraParams, ...this.params });
    return {
      error: {
        code: this.code,
        message,
        ...(this.code === 'INTERNAL'
          ? { requestId: String(extraParams['requestId'] ?? '') }
          : this.details === undefined
            ? {}
            : { details: this.details }),
      },
    };
  }
}

export const unauthenticated = (details?: unknown): AppError =>
  new AppError('UNAUTHENTICATED', { details });
export const forbidden = (details?: unknown): AppError => new AppError('FORBIDDEN', { details });
export const notFound = (details?: unknown): AppError => new AppError('NOT_FOUND', { details });
export const conflict = (details?: unknown): AppError => new AppError('CONFLICT', { details });
export const validationFailed = (details?: unknown): AppError =>
  new AppError('VALIDATION', { details });
export const invalidTransition = (details?: unknown): AppError =>
  new AppError('INVALID_TRANSITION', { details });

export function isAppError(error: unknown, code?: ErrorCode): error is AppError {
  return error instanceof AppError && (code === undefined || error.code === code);
}
