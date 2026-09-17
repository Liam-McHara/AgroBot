import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { members } from '../src/db/schema/index.js';
import { signInitData } from '../src/http/init-data.js';
import { openTestDatabase, resetDatabase } from './helpers/database.js';
import { TEST_BOT_TOKEN, testApp } from './helpers/app.js';

const database = await openTestDatabase();
const suite = database ? describe : describe.skip;

function initDataFor(user: Record<string, unknown>, authDate = new Date()): string {
  return signInitData(
    {
      user: JSON.stringify(user),
      auth_date: String(Math.floor(authDate.getTime() / 1000)),
    },
    TEST_BOT_TOKEN,
  );
}

const MARTA = { id: 5551, first_name: 'Marta', last_name: 'Puig', username: 'marta' };

suite('HTTP API', () => {
  beforeEach(async () => {
    await resetDatabase(database!);
  });

  afterAll(async () => {
    await database?.close();
  });

  describe('GET /health', () => {
    it('answers without credentials and without touching the database', async () => {
      const response = await testApp(database!).request('/health');
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body.version).toBeTypeOf('string');
      expect(body.commit).toBeTypeOf('string');
      expect(response.headers.get('x-request-id')).toBeTruthy();
    });
  });

  describe('GET /api/me', () => {
    it('refuses a request without credentials, in the shape of ARCH §11', async () => {
      const response = await testApp(database!).request('/api/me');
      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error.code).toBe('UNAUTHENTICATED');
      expect(body.error.message).toBe(
        "No hem pogut verificar qui ets. Torna a obrir l'AgroBot des del Telegram.",
      );
    });

    it('refuses initData with a tampered hash', async () => {
      const raw = initDataFor(MARTA);
      const tampered = raw.replace(
        /hash=(\w)/,
        (_match, first: string) => `hash=${first === 'a' ? 'b' : 'a'}`,
      );
      const response = await testApp(database!).request('/api/me', {
        headers: { authorization: `tma ${tampered}` },
      });
      expect(response.status).toBe(401);
    });

    it('refuses initData whose auth_date is older than the window', async () => {
      const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const response = await testApp(database!).request('/api/me', {
        headers: { authorization: `tma ${initDataFor(MARTA, old)}` },
      });
      expect(response.status).toBe(401);
    });

    it('creates a stranger as an applicant and answers the gate screen', async () => {
      const response = await testApp(database!).request('/api/me', {
        headers: { authorization: `tma ${initDataFor(MARTA)}` },
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        telegramId: '5551',
        username: 'marta',
        displayName: 'Marta Puig',
        status: 'pending',
        role: 'member',
      });

      const rows = await database!.db.select().from(members).where(eq(members.telegramId, 5551));
      expect(rows).toHaveLength(1);
    });

    it('keeps Telegram identity in step without creating a second member', async () => {
      const app = testApp(database!);
      await app.request('/api/me', { headers: { authorization: `tma ${initDataFor(MARTA)}` } });
      const renamed = { ...MARTA, username: 'marta_hort', last_name: 'Puig i Roca' };
      const response = await app.request('/api/me', {
        headers: { authorization: `tma ${initDataFor(renamed)}` },
      });

      expect(response.status).toBe(200);
      expect((await response.json()).username).toBe('marta_hort');
      const rows = await database!.db.select().from(members).where(eq(members.telegramId, 5551));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.lastName).toBe('Puig i Roca');
      // The display name is the member's to choose (PRD US-1.5), not Telegram's to overwrite.
      expect(rows[0]?.displayName).toBe('Marta Puig');
    });

    it('answers in the member language: es for an es-* Telegram client', async () => {
      const response = await testApp(database!).request('/api/me', {
        headers: {
          authorization: `tma ${initDataFor({ id: 5552, first_name: 'Jordi', language_code: 'es' })}`,
        },
      });
      expect((await response.json()).language).toBe('es');
    });

    it('accepts the dev bypass when it is configured (ARCH §4)', async () => {
      const app = testApp(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001' });
      const response = await app.request('/api/me', {
        headers: { authorization: 'dev 900000001' },
      });
      expect(response.status).toBe(200);
      expect((await response.json()).displayName).toBe('Marta (dev)');
    });

    it('lets the dev bypass impersonate any seeded member (ARCH §14)', async () => {
      const app = testApp(database!, { DEV_AUTH_BYPASS_TELEGRAM_ID: '900000001' });
      const response = await app.request('/api/me', {
        headers: { authorization: 'dev 900000002' },
      });
      expect((await response.json()).displayName).toBe('Jordi (dev)');
    });

    it('ignores the dev bypass when it is not configured', async () => {
      const response = await testApp(database!).request('/api/me', {
        headers: { authorization: 'dev 900000001' },
      });
      expect(response.status).toBe(401);
    });
  });

  describe('unknown routes', () => {
    it('answer with the error envelope under /api', async () => {
      const response = await testApp(database!).request('/api/nope');
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('NOT_FOUND');
    });
  });
});
