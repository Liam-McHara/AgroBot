import { serve, type ServerType } from '@hono/node-server';
import { loadDotEnv } from './dotenv.js';
import { EnvError, parseEnv } from './env.js';
import { createLogger } from './logger.js';
import { createDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { createApp } from './http/app.js';
import { createBot, WEBHOOK_PATH } from './bot/index.js';
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
  const deps = { db: database.db, env, logger };

  logger.info({ version: APP_VERSION, commit: GIT_COMMIT, mode: env.BOT_MODE }, 'starting');

  await runMigrations(database.db);
  logger.info('migrations up to date');

  const bot = createBot(deps);
  const app = createApp(deps, env.BOT_MODE === 'webhook' ? { bot } : {});

  const server: ServerType = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info({ port: info.port }, 'http listening');
  });

  if (env.BOT_MODE === 'polling') {
    // `bot.start()` resolves only when the bot stops, so it is deliberately not awaited.
    void bot.start({
      onStart: (me) => logger.info({ username: me.username }, 'bot polling'),
      drop_pending_updates: false,
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

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const closed = new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    if (env.BOT_MODE === 'polling') await bot.stop();
    await closed;
    await database.close();
    logger.info('bye');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled rejection');
  });
}

await main();
