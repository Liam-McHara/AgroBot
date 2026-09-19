import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { MyOfferView, ProductView } from '@agrobot/shared';
import Offers from './Offers.svelte';
import { ApiError } from '../lib/api/client.js';
import { fetchProducts } from '../lib/api/catalog.js';
import {
  confirmStillAvailable,
  editOffer,
  fetchMyOffers,
  publishOffer,
  withdrawOffer,
} from '../lib/api/offers.js';
import { setLanguage } from '../lib/i18n/index.svelte.js';
import { toasts } from '../lib/stores/toast.svelte.js';

vi.mock('../lib/api/catalog.js', () => ({ fetchProducts: vi.fn(), proposeProduct: vi.fn() }));
vi.mock('../lib/api/offers.js', () => ({
  fetchMyOffers: vi.fn(),
  publishOffer: vi.fn(),
  editOffer: vi.fn(),
  withdrawOffer: vi.fn(),
  confirmStillAvailable: vi.fn(),
}));

const eggs: ProductView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ous',
  nameEs: 'Huevos',
  unitCode: 'dozen',
  priceCents: 350,
  currency: 'EUR',
  category: null,
  status: 'active',
};
const tomato: ProductView = {
  ...eggs,
  id: '44444444-4444-4444-8444-444444444444',
  name: 'Tomàquet',
  nameEs: 'Tomate',
  unitCode: 'kg',
  priceCents: 235,
};

const mine = (over: Partial<MyOfferView> & { id: string }): MyOfferView => ({
  product: tomato,
  producer: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Marta' },
  quantity: 10,
  held: 2.5,
  available: 7.5,
  openReservations: 1,
  availableUntil: null,
  note: null,
  status: 'active',
  stale: false,
  nudgedAt: null,
  lastActivityAt: '2026-09-10T08:00:00.000Z',
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
  ...over,
});
const TOMATO = mine({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
const NUDGED = mine({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  product: eggs,
  quantity: 4,
  held: 0,
  available: 4,
  openReservations: 0,
  nudgedAt: '2026-09-17T07:00:00.000Z',
  stale: true,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchMyOffers).mockResolvedValue({ offers: [TOMATO, NUDGED] });
  vi.mocked(fetchProducts).mockResolvedValue({ products: [eggs] });
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

describe('My offers (PRD US-3.1, US-3.2, US-3.4)', () => {
  it('lists my offers with totals, held, available and the state that needs attention', async () => {
    render(Offers);
    const cards = await screen.findAllByTestId('my-offer');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.textContent).toContain('10 kg en total');
    expect(cards[0]!.textContent).toContain('2,5 kg reservats');
    expect(cards[0]!.textContent).toContain('7,5 kg disponibles');
    expect(cards[0]!.dataset['state']).toBe('active');
    expect(cards[1]!.dataset['state']).toBe('stale');
    expect(cards[1]!.textContent).toContain('Sense confirmar');
    expect(within(cards[1]!).getByRole('button', { name: 'Sí, encara disponible' })).toBeTruthy();
    expect(within(cards[0]!).queryByRole('button', { name: 'Sí, encara disponible' })).toBeNull();
  });

  it('publishes through the picker with the unit step enforced before the request', async () => {
    const created = mine({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      product: eggs,
      quantity: 3,
      held: 0,
      available: 3,
      openReservations: 0,
      note: 'Fresques',
    });
    vi.mocked(publishOffer).mockResolvedValue({ offer: created });
    render(Offers);
    await screen.findAllByTestId('my-offer');
    await fireEvent.click(screen.getByTestId('publish'));
    await fireEvent.click(await screen.findByRole('button', { name: /Ous/ }));

    const quantity = screen.getByLabelText('Quantitat (dotzena)');
    const submit = screen.getByRole('button', { name: 'Publica una oferta' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await fireEvent.input(quantity, { target: { value: '2.5' } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("La quantitat ha d'anar en passos de 1 dotzena.")).toBeTruthy();
    await fireEvent.input(quantity, { target: { value: '0' } });
    expect(submit.disabled).toBe(true);
    await fireEvent.input(quantity, { target: { value: '3' } });
    expect(submit.disabled).toBe(false);
    await fireEvent.input(screen.getByLabelText('Nota (opcional)'), {
      target: { value: ' Fresques ' },
    });
    await fireEvent.submit(submit.closest('form')!);
    await waitFor(() =>
      expect(publishOffer).toHaveBeenCalledWith({
        productId: eggs.id,
        quantity: 3,
        availableUntil: null,
        note: 'Fresques',
      }),
    );
    await waitFor(() => expect(screen.getAllByTestId('my-offer')).toHaveLength(3));
    expect(toasts.current?.message).toBe('Oferta publicada. Ho hem avisat al grup.');
  });

  it('edits down to what is held, and no further', async () => {
    vi.mocked(editOffer).mockResolvedValue({ offer: { ...TOMATO, quantity: 2.5, available: 0 } });
    render(Offers);
    const [card] = await screen.findAllByTestId('my-offer');
    await fireEvent.click(within(card!).getByRole('button', { name: 'Edita' }));
    const quantity = screen.getByLabelText('Quantitat (kg)') as HTMLInputElement;
    expect(quantity.value).toBe('10');
    const save = screen.getByRole('button', { name: 'Desa' }) as HTMLButtonElement;
    await fireEvent.input(quantity, { target: { value: '2' } });
    expect(save.disabled).toBe(true);
    expect(screen.getByText(/No pots baixar per sota de 2,5 kg/)).toBeTruthy();
    await fireEvent.input(quantity, { target: { value: '2.5' } });
    expect(save.disabled).toBe(false);
    await fireEvent.submit(save.closest('form')!);
    await waitFor(() =>
      expect(editOffer).toHaveBeenCalledWith(TOMATO.id, {
        quantity: 2.5,
        availableUntil: null,
        note: null,
      }),
    );
    const [updated] = await screen.findAllByTestId('my-offer');
    await waitFor(() => expect(updated!.dataset['state']).toBe('fully_reserved'));
  });

  it('opens the existing offer for editing when the product is already offered (409)', async () => {
    vi.mocked(fetchProducts).mockResolvedValue({ products: [tomato] });
    vi.mocked(publishOffer).mockRejectedValue(
      new ApiError(409, 'OFFER_ALREADY_ACTIVE', "Ja tens una oferta activa d'aquest producte.", {
        offerId: TOMATO.id,
      }),
    );
    render(Offers);
    await screen.findAllByTestId('my-offer');
    await fireEvent.click(screen.getByTestId('publish'));
    await fireEvent.click(await screen.findByRole('button', { name: /Tomàquet/ }));
    await fireEvent.input(screen.getByLabelText('Quantitat (kg)'), { target: { value: '1' } });
    await fireEvent.submit(screen.getByTestId('offer-form'));
    await waitFor(() =>
      expect((screen.getByLabelText('Quantitat (kg)') as HTMLInputElement).value).toBe('10'),
    );
    expect(screen.getByRole('button', { name: 'Desa' })).toBeTruthy();
    expect(toasts.current).toMatchObject({ kind: 'error' });
  });

  it('confirms before withdrawing, warns about open reservations, and answers the nudge', async () => {
    vi.mocked(withdrawOffer).mockResolvedValue({ offer: { ...TOMATO, status: 'withdrawn' } });
    vi.mocked(confirmStillAvailable).mockResolvedValue({
      offer: { ...NUDGED, stale: false, nudgedAt: null },
    });
    render(Offers);
    const cards = await screen.findAllByTestId('my-offer');
    await fireEvent.click(within(cards[0]!).getByRole('button', { name: 'Retira' }));
    const confirm = screen.getByTestId('withdraw-confirm');
    expect(confirm.textContent).toContain("Vols retirar l'oferta de Tomàquet?");
    expect(confirm.textContent).toContain('Té 1 reserva oberta');
    await fireEvent.click(within(confirm).getByRole('button', { name: 'Retira' }));
    await waitFor(() => expect(withdrawOffer).toHaveBeenCalledWith(TOMATO.id));
    await waitFor(() => expect(screen.getAllByTestId('my-offer')).toHaveLength(1));

    await fireEvent.click(screen.getByRole('button', { name: 'Sí, encara disponible' }));
    await waitFor(() => expect(confirmStillAvailable).toHaveBeenCalledWith(NUDGED.id));
    await waitFor(() => expect(screen.getByTestId('my-offer').dataset['state']).toBe('active'));
  });
});
