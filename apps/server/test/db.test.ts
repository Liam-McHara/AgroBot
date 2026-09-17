import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_SETTINGS, UNIT_LIST, type MemberStatus } from '@agrobot/shared';
import { members, settings, units } from '../src/db/schema/index.js';
import { seed } from '../src/db/seed.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

suite('migrations and seed', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  it('seeds every unit of the shared table', async () => {
    const rows = await database!.db.select().from(units);
    expect(rows).toHaveLength(UNIT_LIST.length);
    const kg = rows.find((row) => row.code === 'kg');
    expect(kg?.allowsDecimals).toBe(true);
    expect(Number(kg?.step)).toBe(0.1);
  });

  it('seeds a default for every group setting (PRD §10)', async () => {
    const rows = await database!.db.select().from(settings);
    expect(rows.map((row) => row.key).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('is idempotent: seeding twice changes nothing', async () => {
    await seed(database!.db, { adminTelegramIds: ['555'] });
    await seed(database!.db, { adminTelegramIds: ['555'] });
    const admins = await database!.db.select().from(members).where(eq(members.telegramId, 555));
    expect(admins).toHaveLength(1);
    expect(admins[0]?.role).toBe('admin');
    expect(admins[0]?.status).toBe('approved');
  });

  it('never overwrites a member that already exists', async () => {
    await seed(database!.db, { adminTelegramIds: ['555'] });
    await database!.db
      .update(members)
      .set({ displayName: 'Marta', role: 'member' })
      .where(eq(members.telegramId, 555));
    await seed(database!.db, { adminTelegramIds: ['555'] });
    const [row] = await database!.db.select().from(members).where(eq(members.telegramId, 555));
    expect(row?.displayName).toBe('Marta');
    expect(row?.role).toBe('member');
  });

  it('refuses a status outside the enum (check constraint)', async () => {
    await expect(
      database!.db.insert(members).values({
        telegramId: 4242,
        displayName: 'Nobody',
        // Deliberately outside MemberStatus: the database is the guard of last resort, and
        // this asserts that the check constraint of the migration is really there.
        status: 'banished' as MemberStatus,
      }),
    ).rejects.toThrow();
  });

  it('refuses a second member with the same Telegram id', async () => {
    await database!.db.insert(members).values({ telegramId: 4243, displayName: 'One' });
    await expect(
      database!.db.insert(members).values({ telegramId: 4243, displayName: 'Two' }),
    ).rejects.toThrow();
  });
});
