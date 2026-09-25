import { createBot } from './bot/index.js';
import { withSentry, instrumentDurableObjectWithSentry } from '@sentry/cloudflare';
import { reportError, sentryOptions } from './observability.js';
import { AgroBotHub as HubClass } from './realtime/hub.js';
import { createServices, openDatabase } from './deps.js';
import { EnvError, parseEnv, type Bindings } from './env.js';
import { AppError } from './errors.js';
import { createApp } from './http/app.js';
import type { AppDeps } from './http/context.js';
import { createLogger, type Logger } from './logger.js';
import { createHubClient, hubStub } from './realtime/client.js';

/**
 * The Worker entry (ARCH §1, §3; ADR-0016).
 *
 * `fetch` builds the dependencies for this one request — validated environment, a postgres.js
 * client over Hyperdrive, the domain services, the hub client — mounts the Hono app and closes
 * the database client after the response has gone out. `scheduled` is the 15-minute heartbeat
 * that keeps the hub's alarm armed (ARCH §9). The hub class itself is exported for the runtime.
 */
export const AgroBotHub = instrumentDurableObjectWithSentry<Bindings, HubClass, typeof HubClass>(
  sentryOptions,
  HubClass,
);

function configurationFailed(error: EnvError, logger: Logger): Response {
  const requestId = crypto.randomUUID();
  // Names of the offending variables only; never their values (ARCH §17).
  logger.fatal({ problems: error.problems, requestId }, 'invalid configuration');
  reportError(error, { requestId, operation: 'configuration' });
  const body = new AppError('INTERNAL').body('ca', { requestId });
  return Response.json(body, { status: 500, headers: { 'X-Request-Id': requestId } });
}

const worker: ExportedHandler<Bindings> = {
  async fetch(request, bindings, ctx) {
    const logger = createLogger({
      level: typeof bindings['LOG_LEVEL'] === 'string' ? (bindings['LOG_LEVEL'] as never) : 'info',
    });
    let env;
    try {
      env = parseEnv(bindings);
    } catch (error) {
      if (error instanceof EnvError) return configurationFailed(error, logger);
      throw error;
    }

    const database = openDatabase(bindings);
    const hub = createHubClient(bindings.HUB, (promise) => ctx.waitUntil(promise), logger);
    const deps: AppDeps = {
      db: database.db,
      env,
      logger,
      reportError,
      hub,
      ...createServices({ db: database.db, env, hub }),
    };
    const app = createApp(deps, { bot: createBot(deps) });

    try {
      return await app.fetch(request, bindings, ctx);
    } finally {
      // The response is on its way; the client closes in the background (ARCH §3).
      ctx.waitUntil(
        database.close().catch((error: unknown) => {
          logger.warn({ err: error }, 'database close failed');
        }),
      );
    }
  },

  async scheduled(_controller, bindings) {
    // ARCH §9: a liveness check, not a scheduler. It reads only the hub's own storage.
    await hubStub(bindings.HUB).ensureArmed();
  },
};

export default withSentry<Bindings, unknown, unknown, ExportedHandler<Bindings>>(
  sentryOptions,
  worker,
);
