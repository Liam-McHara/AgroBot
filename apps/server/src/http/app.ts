import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { DEFAULT_LANGUAGE } from '@agrobot/shared';
import { WEBHOOK_PATH } from '../bot/index.js';
import { requestId } from './middleware/request-id.js';
import { requestLogging } from './middleware/logging.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { healthRoutes } from './routes/health.js';
import { catalogRoutes } from './routes/catalog.js';
import { meRoutes } from './routes/me.js';
import { adminMemberRoutes } from './routes/admin-members.js';
import type { AppContext, AppDeps } from './context.js';

export interface AppOptions {
  /** Mounted at `POST /telegram/webhook` when the bot runs in webhook mode (ARCH §4). */
  bot?: Bot;
  /** Where the built Mini App lives, relative to the process working directory (ARCH §15). */
  publicDir?: string;
}

/**
 * The whole HTTP surface of ARCH §1: the bot webhook, the Mini App's REST API, `/health`,
 * and the built Mini App itself on everything else.
 */
export function createApp(deps: AppDeps, options: AppOptions = {}): Hono<AppContext> {
  const app = new Hono<AppContext>();
  const publicDir = options.publicDir ?? 'public';
  const indexHtml = resolve(process.cwd(), publicDir, 'index.html');
  const hasMiniApp = existsSync(indexHtml);

  app.onError(errorHandler);
  app.notFound(async (c) => {
    // The Mini App is a single-page app: unknown non-API paths are its routes, not misses.
    if (hasMiniApp && !c.req.path.startsWith('/api') && !c.req.path.startsWith('/telegram')) {
      return c.html(await readFile(indexHtml, 'utf8'));
    }
    return notFoundHandler(c);
  });

  app.use('*', requestId);
  app.use('*', async (c, next) => {
    c.set('language', deps.env.DEFAULT_LOCALE ?? DEFAULT_LANGUAGE);
    await next();
  });
  app.use('*', requestLogging(deps.logger));

  app.route('/', healthRoutes());

  if (options.bot) {
    // grammY verifies `X-Telegram-Bot-Api-Secret-Token` itself (ARCH §4, §17).
    app.post(
      WEBHOOK_PATH,
      webhookCallback(options.bot, 'hono', {
        secretToken: deps.env.TELEGRAM_WEBHOOK_SECRET ?? '',
      }),
    );
  }

  app.route('/api', meRoutes(deps));
  app.route('/api', adminMemberRoutes(deps));
  app.route('/api', catalogRoutes(deps));

  if (hasMiniApp) {
    app.use('/*', serveStatic({ root: join('.', publicDir) }));
  }

  return app;
}
