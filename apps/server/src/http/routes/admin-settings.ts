import { Hono } from 'hono';
import { updateSettingsSchema } from '@agrobot/shared';
import { createSettingsService } from '../../domain/settings/service.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { parseBody } from '../validate.js';
import type { AppContext, AppDeps } from '../context.js';

export function adminSettingsRoutes(deps: AppDeps): Hono<AppContext> {
  const app = new Hono<AppContext>();
  const settings = createSettingsService(deps);
  app.use('/admin/settings', authenticate(deps), requireAdmin);
  app.get('/admin/settings', async (c) => c.json(await settings.get(c.get('member')!)));
  app.patch('/admin/settings', async (c) =>
    c.json(await settings.update(c.get('member')!, await parseBody(c, updateSettingsSchema))),
  );
  return app;
}
