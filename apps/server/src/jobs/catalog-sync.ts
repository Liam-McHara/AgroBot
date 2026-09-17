import type { CatalogService } from '../domain/catalog/service.js';
import type { Scheduler } from './scheduler.js';

export const CATALOG_SYNC_EVERY_MS = 60 * 60 * 1000;
export function registerCatalogSync(scheduler: Scheduler, catalog: CatalogService): void {
  scheduler.add({
    name: 'catalog.sync',
    everyMs: CATALOG_SYNC_EVERY_MS,
    async run() {
      const sync = await catalog.sync({ trigger: 'schedule' });
      return {
        status: sync.status,
        rows: sync.rowsRead,
        created: sync.created,
        updated: sync.updated,
        archived: sync.archived,
      };
    },
  });
}
export async function syncCatalogOnBoot(
  scheduler: Scheduler,
  catalog: CatalogService,
): Promise<void> {
  if (!(await catalog.hasSynced())) await scheduler.runNow('catalog.sync');
}
