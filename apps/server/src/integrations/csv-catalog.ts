import { parse } from 'csv-parse/sync';
import type { CatalogSource } from '../domain/catalog/source.js';

export function createCsvCatalogSource(url: string, fetcher: typeof fetch = fetch): CatalogSource {
  return {
    kind: 'csv',
    sheetUrl: url,
    async fetchRows() {
      const response = await fetcher(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error('Catalogue source unavailable');
      // Keep empty records: row numbers must match the sheet, including blank rows.
      return parse(await response.text(), { bom: true, relax_column_count: true }) as unknown[][];
    },
  };
}
