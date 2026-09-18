import { createDatabase, type DatabaseHandle } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { resetTestData } from '../../src/db/reset-test-database.js';

/**
 * Integration tests run against a real Postgres (ARCH §16). Locally that is the
 * `docker compose` database; in CI it is the service container. When neither is reachable the
 * suites skip with a warning — except in CI, where a missing database is a broken pipeline
 * and has to fail loudly.
 */
export const TEST_DATABASE_URL =
  process.env['TEST_DATABASE_URL'] ?? 'postgres://agrobot:agrobot@localhost:5432/agrobot_test';

let handle: DatabaseHandle | null | undefined;

export async function openTestDatabase(): Promise<DatabaseHandle | null> {
  if (handle !== undefined) return handle;
  try {
    const candidate = createDatabase(TEST_DATABASE_URL, { max: 4 });
    await candidate.sql`select 1`;
    await runMigrations(candidate.db);
    handle = candidate;
  } catch (error) {
    if (process.env['CI']) {
      throw new Error(
        `Integration tests need Postgres at ${TEST_DATABASE_URL} and CI provides one.`,
        { cause: error },
      );
    }
    process.stderr.write(
      `\n[integration] skipped: no Postgres at ${TEST_DATABASE_URL}.\n` +
        `             run \`docker compose up -d\` (or set TEST_DATABASE_URL) to run them.\n\n`,
    );
    handle = null;
  }
  return handle;
}

/** Empties the data tables and re-seeds the reference data between tests (ARCH §16). */
export async function resetDatabase(database: DatabaseHandle): Promise<void> {
  await resetTestData(database.db);
}
