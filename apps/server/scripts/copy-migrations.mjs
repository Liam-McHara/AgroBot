#!/usr/bin/env node
/**
 * `tsc` emits JavaScript; the migrations are SQL plus drizzle's `meta/_journal.json`, so they
 * have to be copied next to the build. They run on boot (ARCH §15), which means a build
 * without them starts and then fails on the first connection.
 */
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(packageRoot, 'src/db/migrations');
const to = join(packageRoot, 'dist/db/migrations');

if (!existsSync(from)) {
  console.error(`No migrations at ${from}; run \`pnpm db:generate\` first.`);
  process.exit(1);
}

cpSync(from, to, { recursive: true });
console.log(`Copied migrations to ${to}`);
