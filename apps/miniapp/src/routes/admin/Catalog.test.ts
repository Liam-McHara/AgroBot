import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { AdminCatalog, ProductView } from '@agrobot/shared';
import Catalog from './Catalog.svelte';
import { fetchCatalog, syncCatalog, renameProduct, rejectProduct } from '../../lib/api/catalog.js';
import { setLanguage } from '../../lib/i18n/index.svelte.js';
import { toasts } from '../../lib/stores/toast.svelte.js';

vi.mock('../../lib/api/catalog.js', () => ({
  fetchCatalog: vi.fn(),
  syncCatalog: vi.fn(),
  renameProduct: vi.fn(),
  rejectProduct: vi.fn(),
}));
const pending: ProductView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Tomàquet cor de bou',
  nameEs: null,
  unitCode: 'kg',
  priceCents: null,
  currency: 'EUR',
  category: null,
  status: 'pending',
};
const data: AdminCatalog = {
  products: [
    pending,
    {
      ...pending,
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Ous',
      status: 'active',
      priceCents: 320,
      unitCode: 'dozen',
    },
  ],
  counts: { active: 1, pending: 1, archived: 0 },
  sheetUrl: 'https://example.test/sheet',
  syncs: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      startedAt: '2026-09-17T10:00:00.000Z',
      finishedAt: '2026-09-17T10:00:01.000Z',
      status: 'partial',
      source: 'csv',
      rowsRead: 2,
      created: 1,
      updated: 0,
      archived: 0,
      resolvedPending: 0,
      errors: [{ row: 3, reason: 'unit', severity: 'error' }],
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('ca');
  toasts.dismiss();
  vi.mocked(fetchCatalog).mockResolvedValue(data);
});
afterEach(cleanup);

it('shows sync diagnostics by row, filters products and switches to Spanish', async () => {
  render(Catalog);
  expect(await screen.findByText('Unitat desconeguda.')).toBeTruthy();
  expect(within(screen.getByRole('table')).getByText('3')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Obre el full de productes' }).getAttribute('href')).toBe(
    data.sheetUrl,
  );
  await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'pending' } });
  expect(screen.getAllByTestId('catalog-product')).toHaveLength(1);
  setLanguage('es');
  await screen.findByText('Unidad desconocida.');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Catálogo');
});
it('copies the exact name and saves a renamed proposal', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  vi.mocked(renameProduct).mockResolvedValue({ product: { ...pending, name: 'Tomàquet' } });
  render(Catalog);
  await fireEvent.click(await screen.findByRole('button', { name: 'Copia el nom per al full' }));
  expect(writeText).toHaveBeenCalledWith(pending.name);
  await fireEvent.click(screen.getByRole('button', { name: 'Canvia el nom' }));
  await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Tomàquet' } });
  await fireEvent.submit(screen.getByRole('textbox').closest('form')!);
  await waitFor(() => expect(renameProduct).toHaveBeenCalledWith(pending.id, 'Tomàquet'));
});
it('confirms rejection and refreshes the list', async () => {
  vi.mocked(rejectProduct).mockResolvedValue(undefined);
  render(Catalog);
  await fireEvent.click(await screen.findByRole('button', { name: 'Rebutja' }));
  expect(rejectProduct).not.toHaveBeenCalled();
  vi.mocked(fetchCatalog).mockResolvedValue({ ...data, products: [] });
  const buttons = screen.getAllByRole('button', { name: 'Rebutja' });
  await fireEvent.click(buttons[1]!);
  await waitFor(() => expect(rejectProduct).toHaveBeenCalledWith(pending.id));
  await waitFor(() => expect(screen.queryByTestId('catalog-product')).toBeNull());
});
it('retains a failed sync report and shows retry after an initial load failure', async () => {
  vi.mocked(fetchCatalog).mockRejectedValueOnce(new Error('load failed'));
  render(Catalog);
  await fireEvent.click(await screen.findByRole('button', { name: 'Torna-ho a provar' }));
  await screen.findByText('Amb incidències');
  const failed = {
    ...data.syncs[0]!,
    status: 'failed' as const,
    errors: [{ row: 0, reason: 'empty' as const, severity: 'error' as const }],
  };
  vi.mocked(syncCatalog).mockResolvedValue({ sync: failed });
  vi.mocked(fetchCatalog).mockRejectedValueOnce(new Error('refresh failed'));
  await fireEvent.click(screen.getByRole('button', { name: 'Sincronitza ara' }));
  await screen.findByText('Cap fila vàlida: el catàleg s’ha conservat.');
  expect(toasts.current?.message).toBe('refresh failed');
});
