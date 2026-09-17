import { expect, it, vi } from 'vitest';
import { createCsvCatalogSource } from './csv-catalog.js';

it('reads BOM, commas, quoted newlines and blank rows without losing row positions', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response('\ufeffProduct,Unit,Price\r\n"Col, verda",kg,"1,20"\r\n\r\n"Nom\nllarg",unit,2'),
    );
  const rows = await createCsvCatalogSource('https://example.test/prices', fetcher).fetchRows();
  expect(rows).toEqual([
    ['Product', 'Unit', 'Price'],
    ['Col, verda', 'kg', '1,20'],
    [''],
    ['Nom\nllarg', 'unit', '2'],
  ]);
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
});
it('rejects HTTP failures and malformed CSV without returning a partial document', async () => {
  await expect(
    createCsvCatalogSource(
      'https://example.test',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })),
    ).fetchRows(),
  ).rejects.toThrow();
  await expect(
    createCsvCatalogSource(
      'https://example.test',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('Product,Unit,Price\n"unfinished')),
    ).fetchRows(),
  ).rejects.toThrow();
});
