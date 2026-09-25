import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  settingsSchema,
  updateSettingsSchema,
  type Settings,
} from '@agrobot/shared';
import { eq } from 'drizzle-orm';
import type { Database, Executor, Transaction } from '../../db/client.js';
import { members, settings, type Member } from '../../db/schema/index.js';
import { notFound, validationFailed } from '../../errors.js';
import { assertAdmin } from '../members/service.js';
import { noopHub, type HubPort } from '../ports.js';

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
    const parsed = settingsSchema.shape[row.key].safeParse(row.value);
    if (parsed.success) result[row.key] = parsed.data;
  }
  return result as unknown as Settings;
}

export function createSettingsService(deps: { db: Database; hub?: HubPort; now?: () => Date }) {
  async function authorize(tx: Transaction, actor: Member): Promise<void> {
    const [fresh] = await tx.select().from(members).where(eq(members.id, actor.id)).for('share');
    if (!fresh) throw notFound();
    assertAdmin(fresh);
  }
  return {
    async get(actor: Member): Promise<Settings> {
      return deps.db.transaction(async (tx) => {
        await authorize(tx, actor);
        return loadSettings(tx);
      });
    },
    async update(actor: Member, input: unknown): Promise<Settings> {
      const result = await deps.db.transaction(async (tx) => {
        await authorize(tx, actor);
        const parsed = updateSettingsSchema.safeParse(input);
        if (!parsed.success) throw validationFailed({ issues: parsed.error.issues });
        const updatedAt = (deps.now ?? (() => new Date()))();
        // Stable ordering also prevents two multi-key writes locking rows in opposite order.
        for (const key of SETTING_KEYS) {
          const value = parsed.data[key];
          if (value === undefined) continue;
          await tx
            .insert(settings)
            .values({ key, value, updatedAt, updatedBy: actor.id })
            .onConflictDoUpdate({
              target: settings.key,
              set: { value, updatedAt, updatedBy: actor.id },
            });
        }
        return loadSettings(tx);
      });
      (deps.hub ?? noopHub).wake();
      return result;
    },
  };
}
