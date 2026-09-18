import { sql } from 'drizzle-orm';
import { loadDotEnv } from '../dotenv.js';
import { createDatabase, type Database } from './client.js';
import { runMigrations } from './migrate.js';
import { seed } from './seed.js';

/**
 * Empty the data tables and re-seed the reference data (ARCH §16). Shared by the integration
 * tests, which call it between tests, and by the e2e boot, which runs it as a CLI before
 * starting `wrangler dev`. Dev members are seeded because the dev auth bypass signs in as them
 * (ARCH §14). Only ever pointed at a test database, which the CLI below enforces.
 */

/** Tables that hold test data, in an order safe for a single `TRUNCATE`. */
export const DATA_TABLES = [
  'notifications',
  'thread_reads',
  'messages',
  'reservations',
  'offers',
  'products',
  'catalog_syncs',
  'member_invites',
  'members',
] as const;

export async function resetTestData(db: Database): Promise<void> {
  await db.execute(sql.raw(`truncate table ${DATA_TABLES.join(', ')} restart identity cascade`));
  await seed(db, { includeDevMembers: true });
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }
  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    console.error(`Refusing to reset "${databaseName}": only databases named *_test are reset.`);
    process.exit(1);
  }
  const handle = createDatabase(url, { max: 1 });
  try {
    await runMigrations(handle.db);
    await resetTestData(handle.db);
    console.log(`Reset and seeded ${databaseName}.`);
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
