import { expect, it } from 'vitest';
import { privateErrorEvent, sentryOptions } from './observability.js';
import type { Bindings } from './env.js';

it('disables Sentry when absent and enables error-only reporting when configured', () => {
  expect(sentryOptions({} as Bindings).enabled).toBe(false);
  expect(
    sentryOptions({ SENTRY_DSN: 'https://key@example.test/1' } as unknown as Bindings),
  ).toMatchObject({
    enabled: true,
    dataCollection: expect.objectContaining({ userInfo: false, httpBodies: [] }),
    tracesSampleRate: 0,
    defaultIntegrations: false,
  });
});
it('keeps correlation and frames but drops requests, identities, SQL and chat contents', () => {
  const event = privateErrorEvent({
    type: undefined,
    event_id: 'id',
    request: { url: 'https://host/?secret', headers: { authorization: 'secret' }, data: 'secret' },
    user: { id: 'secret' },
    extra: { sql: 'secret' },
    breadcrumbs: [{ message: 'secret' }],
    tags: { requestId: 'id', operation: 'http', secret: 'secret' },
    exception: {
      values: [
        {
          type: 'Error',
          value: 'secret',
          stacktrace: {
            frames: [{ filename: 'worker.js?secret', lineno: 12, vars: { token: 'secret' } }],
          },
        },
      ],
    },
  });
  expect(JSON.stringify(event)).not.toContain('secret');
  expect(event.tags).toEqual({ requestId: 'id', operation: 'http' });
  expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]).toMatchObject({
    filename: 'worker.js',
    lineno: 12,
  });
});
