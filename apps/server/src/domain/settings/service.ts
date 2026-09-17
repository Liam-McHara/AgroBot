import { DEFAULT_SETTINGS, SETTING_KEYS, type Settings } from '@agrobot/shared';
import type { Executor } from '../../db/client.js';
import { settings } from '../../db/schema/index.js';

/**
 * PRD §10 group settings, read at run time so a change needs no restart (ARCH §5).
 * A key missing from the table falls back to its default, so a fresh database behaves like a
 * seeded one; a value of the wrong type is ignored the same way rather than trusted.
 */
export async function loadSettings(db: Executor): Promise<Settings> {
  const rows = await db.select().from(settings);
  const result: Record<string, number | boolean> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (!(SETTING_KEYS as readonly string[]).includes(row.key)) continue;
    if (typeof result[row.key] === typeof row.value) {
      result[row.key] = row.value as number | boolean;
    }
  }
  return result as unknown as Settings;
}
