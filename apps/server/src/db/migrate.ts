import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadDotEnv } from '../dotenv.js';
import { createDatabase, type Database } from './client.js';

export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Run every pending migration. Called by `pnpm db:migrate` and on boot (ARCH §15). */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }
  const handle = createDatabase(url, { max: 1 });
  try {
    await runMigrations(handle.db);
    console.log('Migrations applied.');
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
