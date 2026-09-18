import { Hono } from 'hono';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { DEFAULT_LANGUAGE } from '@agrobot/shared';
import { WEBHOOK_PATH } from '../bot/index.js';
import { requestId } from './middleware/request-id.js';
import { requestLogging } from './middleware/logging.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { healthRoutes } from './routes/health.js';
import { catalogRoutes } from './routes/catalog.js';
import { eventsRoutes } from './routes/events.js';
import { meRoutes } from './routes/me.js';
import { adminMemberRoutes } from './routes/admin-members.js';
import type { AppContext, AppDeps } from './context.js';

export interface AppOptions {
  /** Mounted at `POST /telegram/webhook`; the tests leave it out and drive the bot directly. */
  bot?: Bot;
}

/**
 * Telegram gives a webhook about as long as a request may take; a catalogue sync from `/sync`
 * can be slow, and a retried update would run it twice.
 */
const WEBHOOK_TIMEOUT_MS = 25_000;

/**
 * The Worker's half of ARCH §1: the bot webhook, the Mini App's REST API, the realtime ticket
 * and upgrade, and `/health`. The Mini App itself is served by Static Assets before a request
 * ever reaches this code (`run_worker_first` in `wrangler.jsonc`), so an unknown path here is
 * a miss, in the error shape of ARCH §11.
 */
export function createApp(deps: AppDeps, options: AppOptions = {}): Hono<AppContext> {
  const app = new Hono<AppContext>();

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('language', deps.env.DEFAULT_LOCALE ?? DEFAULT_LANGUAGE);
    await next();
  });
  app.use('*', requestLogging(deps.logger));

  app.route('/', healthRoutes(deps));

  if (options.bot) {
    // grammY verifies `X-Telegram-Bot-Api-Secret-Token` itself (ARCH §4, §17).
    app.post(
      WEBHOOK_PATH,
      webhookCallback(options.bot, 'hono', {
        secretToken: deps.env.TELEGRAM_WEBHOOK_SECRET,
        timeoutMilliseconds: WEBHOOK_TIMEOUT_MS,
      }),
    );
  }

  app.route('/api', meRoutes(deps));
  app.route('/api', adminMemberRoutes(deps));
  app.route('/api', catalogRoutes(deps));
  app.route('/api', eventsRoutes(deps));

  return app;
}
