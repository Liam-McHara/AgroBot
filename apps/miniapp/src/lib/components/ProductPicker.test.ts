import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ProductView } from '@agrobot/shared';
import ProductPicker from './ProductPicker.svelte';
import { fetchProducts, proposeProduct } from '../api/catalog.js';
import { setLanguage } from '../i18n/index.svelte.js';
import { toasts } from '../stores/toast.svelte.js';

vi.mock('../api/catalog.js', () => ({ fetchProducts: vi.fn(), proposeProduct: vi.fn() }));
const product: ProductView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Tomàquet',
  nameEs: 'Tomate',
  unitCode: 'kg',
  priceCents: 235,
  currency: 'EUR',
  category: null,
  status: 'active',
};
beforeEach(() => {
  vi.resetAllMocks();
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

it('renders localized names and integer-cent money, switching languages instantly', async () => {
  vi.mocked(fetchProducts).mockResolvedValue({ products: [product] });
  const onpick = vi.fn();
  render(ProductPicker, { onpick });
  const button = await screen.findByRole('button', { name: /Tomàquet/ });
  expect(button.textContent).toMatch(/2,35\s*€ \/ kg/);
  await fireEvent.click(button);
  expect(onpick).toHaveBeenCalledWith(product);
  setLanguage('es');
  await screen.findByRole('button', { name: /Tomate/ });
  expect(screen.getByLabelText('Busca un producto')).toBeTruthy();
});
it('proposes the exact trimmed name and chosen unit only after a successful empty search', async () => {
  vi.mocked(fetchProducts).mockResolvedValue({ products: [] });
  vi.mocked(proposeProduct).mockResolvedValue({
    product: {
      ...product,
      name: 'tomàquet cor de bou',
      nameEs: null,
      status: 'pending',
      priceCents: null,
      unitCode: 'box',
    },
  });
  render(ProductPicker);
  await fireEvent.input(screen.getByRole('searchbox'), {
    target: { value: ' tomàquet cor de bou ' },
  });
  const propose = await screen.findByRole('button', { name: 'Proposa «tomàquet cor de bou»' });
  await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'box' } });
  await fireEvent.submit(propose.closest('form')!);
  expect(proposeProduct).toHaveBeenCalledWith({ name: 'tomàquet cor de bou', unitCode: 'box' });
  await screen.findByText('Preu pendent');
});
it('does not turn a failed search into a proposal and offers retry', async () => {
  vi.mocked(fetchProducts)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue({ products: [] });
  render(ProductPicker);
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'Producte nou' } });
  const retry = await screen.findByRole('button', { name: 'Torna-ho a provar' });
  expect(screen.queryByRole('button', { name: /Proposa/ })).toBeNull();
  await fireEvent.click(retry);
  await screen.findByRole('button', { name: /Proposa/ });
});
it('ignores stale search results that arrive after a newer query', async () => {
  let oldResult!: (response: { products: ProductView[] }) => void;
  vi.mocked(fetchProducts)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          oldResult = resolve;
        }),
    )
    .mockResolvedValue({ products: [] });
  render(ProductPicker);
  await waitFor(() => expect(fetchProducts).toHaveBeenCalledTimes(1));
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'New product' } });
  await screen.findByRole('button', { name: /Proposa/ });
  oldResult({ products: [product] });
  await waitFor(() => expect(screen.queryByText('Tomàquet')).toBeNull());
});
