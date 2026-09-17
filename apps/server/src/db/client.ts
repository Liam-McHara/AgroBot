import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly sql: postgres.Sql;
  close(): Promise<void>;
}

export interface DatabaseOptions {
  /** Keep the pool small: one instance, a hundred members (ADR-0002, PRD §12). */
  max?: number;
  /** Migrations and one-shot scripts want a single connection and a quick exit. */
  maxLifetimeSeconds?: number;
}

export function createDatabase(url: string, options: DatabaseOptions = {}): DatabaseHandle {
  const sql = postgres(url, {
    max: options.max ?? 10,
    ...(options.maxLifetimeSeconds === undefined
      ? {}
      : { max_lifetime: options.maxLifetimeSeconds }),
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
