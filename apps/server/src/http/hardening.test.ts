import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { translate } from '@agrobot/shared';
import { createApp } from './app.js';
import { authenticate } from './middleware/auth.js';
import { requestId } from './middleware/request-id.js';
import { API_BODY_BYTES, boundedBody } from './middleware/limits.js';
import { errorHandler } from './middleware/error.js';
import { threadRoutes } from './routes/threads.js';
import type { AppContext, AppDeps } from './context.js';
import { silentLogger } from '../logger.js';
import { parseEnv } from '../env.js';

function fixture() {
  const member = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'approved',
    role: 'member',
    language: 'es',
  };
  const counts = new Map<string, number>();
  const hit = vi.fn(async (key: string, limit: number) => {
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterMs: 12_500 };
  });
  const deps = {
    logger: silentLogger,
    env: parseEnv({
      BOT_TOKEN: 'test',
      BOT_USERNAME: 'test',
      MINIAPP_SHORT_NAME: 'app',
      PUBLIC_URL: 'https://example.test',
      TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(32),
      CATALOG_SOURCE: 'csv',
      CATALOG_CSV_URL: 'https://example.test/catalog',
      DEV_AUTH_BYPASS_TELEGRAM_ID: '1',
    }),
    members: { identify: vi.fn(async () => ({ member })) },
    hub: { hit },
    threads: { post: vi.fn() },
    reportError: vi.fn(),
  } as unknown as AppDeps;
  return { deps, member, hit };
}
describe('HTTP hardening (ARCH §17)', () => {
  it('bounds Telegram updates before the webhook parser', async () => {
    const { deps } = fixture();
    const response = await createApp(deps).request('/telegram/webhook', {
      method: 'POST',
      body: 'x'.repeat(64 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });
  it.each([undefined, '1', String(API_BODY_BYTES + 1)])(
    'rejects oversized bodies before auth, Content-Length=%s',
    async (length) => {
      const { deps } = fixture();
      const response = await createApp(deps).request('/api/me', {
        method: 'PATCH',
        body: 'é'.repeat(API_BODY_BYTES),
        headers: { ...(length ? { 'content-length': length } : {}), authorization: 'dev 1' },
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION' } });
      expect(deps.members.identify).not.toHaveBeenCalled();
    },
  );
  it('preserves bounded JSON and allows the exact byte boundary', async () => {
    const app = new Hono<AppContext>();
    app.use('*', boundedBody(4));
    app.post('/', async (c) => c.text(await c.req.text()));
    const response = await app.request('/', { method: 'POST', body: 'éé' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('éé');
  });
  it('counts mutations exactly once despite repeated auth guards, leaves reads free, and returns Retry-After', async () => {
    const { deps, hit } = fixture();
    const app = new Hono<AppContext>();
    app.onError(errorHandler);
    app.use('*', authenticate(deps), authenticate(deps));
    app.all('/', (c) => c.json({ ok: true }));
    for (let i = 0; i < 65; i++)
      expect((await app.request('/', { headers: { authorization: 'dev 1' } })).status).toBe(200);
    expect(hit).not.toHaveBeenCalled();
    for (let i = 0; i < 60; i++)
      expect(
        (await app.request('/', { method: 'POST', headers: { authorization: 'dev 1' } })).status,
      ).toBe(200);
    const blocked = await app.request('/', {
      method: 'DELETE',
      headers: { authorization: 'dev 1' },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('13');
    expect(await blocked.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', message: translate('es', 'error.RATE_LIMITED') },
    });
    expect(hit).toHaveBeenCalledTimes(61);
  });
  it('limits message attempts per member and thread before the domain write', async () => {
    const { deps, hit, member } = fixture();
    hit.mockImplementation(async (key) => ({
      allowed: !key.startsWith('thread:'),
      remaining: 0,
      retryAfterMs: 5000,
    }));
    const app = new Hono<AppContext>();
    app.onError(errorHandler);
    app.route('/api', threadRoutes(deps));
    const id = '22222222-2222-4222-8222-222222222222';
    const response = await app.request(`/api/reservations/${id}/messages`, {
      method: 'POST',
      headers: { authorization: 'dev 1', 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Hello' }),
    });
    expect(response.status).toBe(429);
    expect(hit).toHaveBeenCalledWith(`thread:${id}:${member.id}`, 20, 60_000);
    expect(deps.threads.post).not.toHaveBeenCalled();
  });
  it('fails closed if counters fail and correlates the private error in response, logs and reporting', async () => {
    const { deps, hit } = fixture();
    hit.mockRejectedValue(new Error('secret upstream details'));
    const response = await createApp(deps).request('/api/events/ticket', {
      method: 'POST',
      headers: { authorization: 'dev 1', 'x-request-id': 'attacker supplied secret' },
    });
    const id = response.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'INTERNAL',
        requestId: id,
        message: translate('es', 'error.INTERNAL', { requestId: id! }),
      },
    });
    expect(deps.reportError).toHaveBeenCalledWith(expect.any(Error), {
      requestId: id,
      operation: 'http',
    });
  });
  it('generates distinct request ids', async () => {
    const app = new Hono<AppContext>();
    app.use('*', requestId);
    app.get('/', (c) => c.text('ok'));
    const a = await app.request('/');
    const b = await app.request('/');
    expect(a.headers.get('x-request-id')).not.toBe(b.headers.get('x-request-id'));
  });
});
