import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

/** What `db.transaction()` hands its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Anything a query can run on: the pool or a transaction. Domain services take this so a
 * caller decides the transaction boundary (ARCH §2 "receives ports as parameters").
 */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  readonly db: Database;
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /**
   * Connections this client may open. On the Worker it is one client per invocation over
   * Hyperdrive, which holds the real pool (ARCH §3); the CLI scripts want a single one.
   */
  max?: number;
  /** Migrations and one-shot scripts want a single connection and a quick exit. */
  maxLifetimeSeconds?: number;
  /** Skip the type round trip on connect; the schema only uses types the driver knows. */
  fetchTypes?: boolean;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    ...(options.maxLifetimeSeconds === undefined
      ? {}
      : { max_lifetime: options.maxLifetimeSeconds }),
    ...(options.fetchTypes === undefined ? {} : { fetch_types: options.fetchTypes }),
    onnotice: () => {},
  });
  return {
    db: drizzle(sql, { schema }),
    sql,
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

export { schema };
