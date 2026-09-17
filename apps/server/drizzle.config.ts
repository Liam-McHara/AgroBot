import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit only needs a connection string to diff against; `pnpm db:generate` writes the
 * SQL into `src/db/migrations`, which is committed (ARCH §3).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://agrobot:agrobot@localhost:5432/agrobot',
  },
  strict: true,
  verbose: true,
});
