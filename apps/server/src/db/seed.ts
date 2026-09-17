import { eq, sql } from 'drizzle-orm';
import { DEFAULT_SETTINGS, UNIT_LIST, type SettingKey } from '@agrobot/shared';
import { loadDotEnv } from '../dotenv.js';
import { createDatabase, type Database } from './client.js';
import { members, settings, units } from './schema/index.js';

export interface SeedReport {
  units: number;
  settings: number;
  admins: number;
  devMembers: number;
}

/** Dev-only fixtures so two browser tabs can play both sides of a reservation (ARCH §14). */
const DEV_MEMBERS = [
  { telegramId: 900000001, displayName: 'Marta (dev)', language: 'ca' as const },
  { telegramId: 900000002, displayName: 'Jordi (dev)', language: 'es' as const },
];

export interface SeedOptions {
  /** Telegram ids bootstrapped as approved admins (ARCH §13 `ADMIN_TELEGRAM_IDS`). */
  adminTelegramIds?: readonly string[];
  /** Adds the fixtures above. Never do this in production. */
  includeDevMembers?: boolean;
}

/**
 * Idempotent: running it twice leaves the same rows. Units and settings are brought in line
 * with the code; members are only created, never overwritten, so a seed cannot demote a real
 * admin or rename a real person.
 */
export async function seed(db: Database, options: SeedOptions = {}): Promise<SeedReport> {
  const report: SeedReport = { units: 0, settings: 0, admins: 0, devMembers: 0 };

  for (const unit of UNIT_LIST) {
    await db
      .insert(units)
      .values({
        code: unit.code,
        nameCa: unit.nameCa,
        nameEs: unit.nameEs,
        allowsDecimals: unit.allowsDecimals,
        step: unit.step.toFixed(2),
        sortOrder: unit.sortOrder,
      })
      .onConflictDoUpdate({
        target: units.code,
        set: {
          nameCa: unit.nameCa,
          nameEs: unit.nameEs,
          allowsDecimals: unit.allowsDecimals,
          step: unit.step.toFixed(2),
          sortOrder: unit.sortOrder,
        },
      });
    report.units += 1;
  }

  // Defaults only: an admin who changed a setting in the Mini App keeps their value.
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .insert(settings)
      .values({ key: key as SettingKey, value })
      .onConflictDoNothing({ target: settings.key });
    report.settings += 1;
  }

  for (const rawId of options.adminTelegramIds ?? []) {
    const telegramId = Number(rawId);
    const existing = await db.select().from(members).where(eq(members.telegramId, telegramId));
    if (existing.length > 0) continue;
    await db.insert(members).values({
      telegramId,
      displayName: `Admin ${rawId}`,
      role: 'admin',
      status: 'approved',
      approvedAt: sql`now()`,
    });
    report.admins += 1;
  }

  if (options.includeDevMembers) {
    for (const member of DEV_MEMBERS) {
      const existing = await db
        .select()
        .from(members)
        .where(eq(members.telegramId, member.telegramId));
      if (existing.length > 0) continue;
      await db.insert(members).values({
        telegramId: member.telegramId,
        displayName: member.displayName,
        firstName: member.displayName.split(' ')[0] ?? member.displayName,
        language: member.language,
        status: 'approved',
        approvedAt: sql`now()`,
      });
      report.devMembers += 1;
    }
  }

  return report;
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required to seed.');
    process.exit(1);
  }
  const isProduction = process.env['NODE_ENV'] === 'production';
  const adminTelegramIds = (process.env['ADMIN_TELEGRAM_IDS'] ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d+$/.test(part));

  const handle = createDatabase(url, { max: 1 });
  try {
    const report = await seed(handle.db, { adminTelegramIds, includeDevMembers: !isProduction });
    console.log(
      `Seeded: ${report.units} units, ${report.settings} settings, ` +
        `${report.admins} admin(s), ${report.devMembers} dev member(s).`,
    );
  } finally {
    await handle.close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
