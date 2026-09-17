import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * `column in ('a', 'b', …)` as a check constraint.
 *
 * The schema stores these unions as `text` rather than Postgres enums: adding a status is
 * then a one-line constraint change instead of an `ALTER TYPE` dance, and the allowed values
 * stay generated from `packages/shared/src/enums.ts`, which is where they are decided.
 *
 * The values are inlined rather than bound, because drizzle-kit renders a check constraint
 * into the migration file, where a placeholder would have nothing to bind to.
 */
export function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} in ${sql.raw(`(${literals})`)}`;
}
