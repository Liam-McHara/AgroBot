import { serve, type ServerType } from '@hono/node-server';
import { loadDotEnv } from './dotenv.js';
import { EnvError, isProduction, parseEnv } from './env.js';
import { createLogger } from './logger.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './http/app.js';
import { createMembersService } from './domain/members/service.js';
import { createBot, registerCommands, WEBHOOK_PATH } from './bot/index.js';
import { grammySender } from './integrations/telegram-api.js';
import { createScheduler } from './jobs/scheduler.js';
import { DISPATCH_EVERY_MS, dispatchNotifications } from './jobs/notifications-dispatch.js';
import { LANGUAGES } from '@agrobot/shared';
import { APP_VERSION, GIT_COMMIT } from './version.js';

/**
 * Bootstrap: environment, database, migrations, bot, HTTP, then listen (ARCH §1, §15).
 * Migrations finish before the first request is served; a shutdown signal drains in order.
 */
async function main(): Promise<void> {
  loadDotEnv();

  const env = (() => {
    try {
      return parseEnv();
    } catch (error) {
      if (error instanceof EnvError) {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
      }
      throw error;
    }
  })();

  const logger = createLogger(env);
  const database = createDatabase(env.DATABASE_URL);
  const members = createMembersService({
    db: database.db,
    adminTelegramIds: env.ADMIN_TELEGRAM_IDS,
  });
  const deps = { db: database.db, env, logger, members };

  logger.info({ version: APP_VERSION, commit: GIT_COMMIT, mode: env.BOT_MODE }, 'starting');

  await runMigrations(database.db);
  logger.info('migrations up to date');

  const bot = createBot(deps);
  const app = createApp(deps, env.BOT_MODE === 'webhook' ? { bot } : {});

  // ARCH §9: the in-process jobs. Only the outbox dispatcher exists yet (ADR-0009).
  const scheduler = createScheduler(logger);
  const sender = grammySender(bot.api);
  scheduler.add({
    name: 'notifications.dispatch',
    everyMs: DISPATCH_EVERY_MS,
    run: () => dispatchNotifications({ db: database.db, env, sender, logger }),
  });

  const server: ServerType = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info({ port: info.port }, 'http listening');
  });

  if (env.BOT_MODE === 'polling') {
    // `bot.start()` resolves only when the bot stops, so it is deliberately not awaited — but
    // a bot that cannot start (a wrong token, a webhook already registered on it per
    // ADR-0013) must bring the process down rather than leave a half-working deployment up.
    void bot
      .start({
        onStart: (me) => logger.info({ username: me.username }, 'bot polling'),
        drop_pending_updates: false,
      })
      .catch((error: unknown) => {
        logger.fatal({ err: error }, 'bot could not start');
        // In production a bot that cannot start is a broken deployment, not a warning. In
        // development it usually means BOT_TOKEN is still the placeholder, and the API and
        // the Mini App are worth keeping up while you go and ask @BotFather for one.
        if (isProduction(env)) process.exit(1);
      });
  } else {
    const url = `${env.PUBLIC_URL!.replace(/\/$/, '')}${WEBHOOK_PATH}`;
    await bot.init();
    await bot.api.setWebhook(url, {
      secret_token: env.TELEGRAM_WEBHOOK_SECRET!,
      allowed_updates: ['message', 'callback_query'],
    });
    logger.info({ url, username: bot.botInfo.username }, 'webhook registered');
  }

  scheduler.start();
  registerCommands(bot, LANGUAGES).catch((error: unknown) => {
    logger.warn({ err: error }, 'could not register the command menu');
  });

  /**
   * A restart must lose nothing (PRD §12): stop taking requests, let the bot finish the
   * update it is holding, close the pool. All of it on a deadline — a platform that sends
   * SIGTERM sends SIGKILL a few seconds later, and hanging until then helps nobody.
   */
  const SHUTDOWN_DEADLINE_MS = 10_000;
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const httpClosed = new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    const jobsStopped = scheduler.stop();
    const botStopped =
      env.BOT_MODE === 'polling'
        ? bot.stop().catch((error: unknown) => logger.warn({ err: error }, 'bot stop failed'))
        : Promise.resolve();
    const deadline = new Promise<'deadline'>((resolveDeadline) => {
      setTimeout(() => resolveDeadline('deadline'), SHUTDOWN_DEADLINE_MS).unref();
    });

    const outcome = await Promise.race([
      Promise.all([httpClosed, botStopped, jobsStopped]).then(() => 'drained' as const),
      deadline,
    ]);
    if (outcome === 'deadline') logger.warn('shutdown deadline reached, exiting anyway');

    await database.close().catch((error: unknown) => logger.warn({ err: error }, 'db close'));
    logger.info('bye');
    // pino buffers; `process.exit` would throw away the very lines that explain the exit.
    await new Promise<void>((resolveFlush) => logger.flush(() => resolveFlush()));
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

try {
  await main();
} catch (error) {
  process.stderr.write(`AgroBot failed to start: ${String(error)}\n`);
  process.exit(1);
}
