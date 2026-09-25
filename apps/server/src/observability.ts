import { captureException, type CloudflareOptions, type ErrorEvent } from '@sentry/cloudflare';
import { APP_VERSION } from './version.js';
import { validSentryDsn, type Bindings } from './env.js';

export type ErrorReporter = (
  error: unknown,
  context: { requestId?: string; operation: string },
) => void;

/** Only diagnostic structure leaves the service: no request, SQL values, chat or identities. */
export function privateErrorEvent(event: ErrorEvent): ErrorEvent {
  return {
    type: event.type,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp !== undefined ? { timestamp: event.timestamp } : {}),
    platform: 'javascript',
    level: 'error',
    ...(event.release ? { release: event.release } : {}),
    ...(event.environment ? { environment: event.environment } : {}),
    tags: { requestId: event.tags?.['requestId'], operation: event.tags?.['operation'] },
    exception: {
      values: (event.exception?.values ?? []).map((exception) => ({
        type: /^[\w.]+$/.test(exception.type ?? '') ? exception.type! : 'Error',
        value: 'Unexpected server error; correlate with the request id in Workers Logs',
        stacktrace: {
          frames: (exception.stacktrace?.frames ?? []).map((frame) => ({
            filename: frame.filename?.split(/[?#]/)[0]?.split('/').pop() ?? 'worker.js',
            ...(frame.lineno !== undefined ? { lineno: frame.lineno } : {}),
            ...(frame.colno !== undefined ? { colno: frame.colno } : {}),
            ...(frame.in_app !== undefined ? { in_app: frame.in_app } : {}),
          })),
        },
      })),
    },
  };
}

export function sentryOptions(bindings: Bindings): CloudflareOptions {
  const raw = bindings['SENTRY_DSN'];
  const dsn = typeof raw === 'string' && validSentryDsn(raw) ? raw : undefined;
  return {
    dsn,
    enabled: Boolean(dsn),
    release: `agrobot@${APP_VERSION}+${String(bindings['GIT_COMMIT'] ?? 'dev')}`,
    environment: String(bindings['NODE_ENV'] ?? 'development'),
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    defaultIntegrations: false,
    tracesSampleRate: 0,
    tracePropagationTargets: [],
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    beforeSend: privateErrorEvent,
  };
}

export const reportError: ErrorReporter = (error, context) => {
  captureException(error, { tags: context });
};
