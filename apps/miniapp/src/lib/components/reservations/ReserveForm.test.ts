import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { OfferView, ReservationDetailView } from '@agrobot/shared';
import ReserveForm from './ReserveForm.svelte';
import { ApiError } from '../../api/client.js';
import { createReservation } from '../../api/reservations.js';
import { setLanguage } from '../../i18n/index.svelte.js';
import { toasts } from '../../stores/toast.svelte.js';

vi.mock('../../api/reservations.js', () => ({ createReservation: vi.fn() }));

const offer: OfferView = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  product: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Tomàquet',
    nameEs: 'Tomate',
    unitCode: 'kg',
    priceCents: 235,
    currency: 'EUR',
    category: 'Horta',
    status: 'active',
  },
  producer: { id: '22222222-2222-4222-8222-222222222222', displayName: 'Marta' },
  available: 3,
  availableUntil: null,
  note: null,
  status: 'active',
  stale: false,
  createdAt: '2026-09-19T08:00:00.000Z',
  updatedAt: '2026-09-19T08:00:00.000Z',
};

const reserved = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } as ReservationDetailView;

beforeEach(() => {
  vi.mocked(createReservation).mockReset();
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

describe('ReserveForm (PRD US-4.1)', () => {
  it('checks the step, zero and what is available before asking the server, and previews the total', async () => {
    render(ReserveForm, { offer, onreserved: vi.fn() });
    const input = screen.getByLabelText('Quantitat a reservar (kg)');
    const submit = screen.getByTestId('reserve') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Disponibles: 3 kg')).toBeTruthy();

    await fireEvent.input(input, { target: { value: '1.25' } });
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("La quantitat ha d'anar en passos de 0.1 kg.")).toBeTruthy();
    await fireEvent.input(input, { target: { value: '0' } });
    expect(screen.getByText('La quantitat ha de ser més gran que zero.')).toBeTruthy();
    await fireEvent.input(input, { target: { value: '3.5' } });
    expect(screen.getByText('Només en queden 3 kg.')).toBeTruthy();
    expect(submit.disabled).toBe(true);

    await fireEvent.input(input, { target: { value: '2.5' } });
    expect(submit.disabled).toBe(false);
    expect(screen.getByTestId('reserve-total').textContent).toMatch(/Total: 5,88\s*€/);
  });

  it('says the total is pending while the product has no price', () => {
    render(ReserveForm, {
      offer: { ...offer, product: { ...offer.product, priceCents: null } },
      onreserved: vi.fn(),
    });
    expect(screen.getByText(/Preu pendent/)).toBeTruthy();
    expect(screen.queryByTestId('reserve-total')).toBeNull();
  });

  it('reserves and hands the reservation to the parent', async () => {
    vi.mocked(createReservation).mockResolvedValue({ reservation: reserved });
    const onreserved = vi.fn();
    render(ReserveForm, { offer, onreserved });
    await fireEvent.input(screen.getByLabelText('Quantitat a reservar (kg)'), {
      target: { value: '2' },
    });
    await fireEvent.submit(screen.getByTestId('reserve-form'));
    await waitFor(() =>
      expect(createReservation).toHaveBeenCalledWith({ offerId: offer.id, quantity: 2 }),
    );
    await waitFor(() => expect(onreserved).toHaveBeenCalledWith(reserved));
    expect(toasts.current?.message).toBe('Reserva feta. Hem avisat el productor.');
  });

  it('offers what is left when someone else got there first (409), and nothing when nothing is', async () => {
    vi.mocked(createReservation)
      .mockRejectedValueOnce(
        new ApiError(409, 'INSUFFICIENT_AVAILABILITY', 'Només en queden 1.', { available: 1 }),
      )
      .mockResolvedValueOnce({ reservation: reserved });
    const onreserved = vi.fn();
    render(ReserveForm, { offer, onreserved });
    const input = screen.getByLabelText('Quantitat a reservar (kg)') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '2' } });
    await fireEvent.submit(screen.getByTestId('reserve-form'));

    const conflict = await screen.findByTestId('reserve-conflict');
    expect(conflict.textContent).toContain('només en queden 1 kg');
    await fireEvent.click(screen.getByRole('button', { name: "Sí, reserva'n 1 kg" }));
    await waitFor(() =>
      expect(createReservation).toHaveBeenLastCalledWith({ offerId: offer.id, quantity: 1 }),
    );
    await waitFor(() => expect(onreserved).toHaveBeenCalledWith(reserved));
    expect(input.value).toBe('1');

    cleanup();
    vi.mocked(createReservation).mockRejectedValueOnce(
      new ApiError(409, 'INSUFFICIENT_AVAILABILITY', 'Ja no en queda.', { available: 0 }),
    );
    render(ReserveForm, { offer, onreserved: vi.fn() });
    await fireEvent.input(screen.getByLabelText('Quantitat a reservar (kg)'), {
      target: { value: '1' },
    });
    await fireEvent.submit(screen.getByTestId('reserve-form'));
    expect((await screen.findByTestId('reserve-conflict')).textContent).toContain(
      'ja no en queda res',
    );
    expect(screen.queryByRole('button', { name: /Sí, reserva/ })).toBeNull();
  });
});
