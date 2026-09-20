import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { ReservationDetailView } from '@agrobot/shared';
import ReservationDetail from './ReservationDetail.svelte';
import { actOnReservation, fetchReservation } from '../lib/api/reservations.js';
import { setLanguage } from '../lib/i18n/index.svelte.js';
import { toasts } from '../lib/stores/toast.svelte.js';

vi.mock('../lib/api/reservations.js', () => ({
  fetchReservation: vi.fn(),
  actOnReservation: vi.fn(),
}));

const marta = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Marta', username: null };
const jordi = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Jordi',
  username: 'jordi',
};
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const detail = (over: Partial<ReservationDetailView> = {}): ReservationDetailView => ({
  id: ID,
  offerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  product: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ous',
    nameEs: 'Huevos',
    unitCode: 'dozen',
    priceCents: null,
    currency: 'EUR',
    category: null,
    status: 'pending',
  },
  quantity: 2,
  unitPriceCents: null,
  currency: 'EUR',
  totalCents: null,
  status: 'pending',
  side: 'incoming',
  requester: jordi,
  producer: marta,
  counterpart: jordi,
  reason: null,
  expiresAt: '2026-09-21T08:00:00.000Z',
  createdAt: '2026-09-19T08:00:00.000Z',
  confirmedAt: null,
  deliveredAt: null,
  closedAt: null,
  updatedAt: '2026-09-19T08:00:00.000Z',
  actions: ['confirm', 'reject', 'confirm-and-deliver'],
  offer: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'active',
    note: 'Collits avui',
    availableUntil: null,
    available: 4,
  },
  ...over,
});

beforeEach(() => {
  vi.mocked(fetchReservation).mockReset();
  vi.mocked(actOnReservation).mockReset();
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

describe('Reservation detail (PRD US-4.2–4.4, ADR-0014)', () => {
  it('shows the header with price pending and the producer actions while pending', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    render(ReservationDetail, { params: { id: ID } });
    const card = await screen.findByTestId('reservation-detail');
    expect(card.dataset['status']).toBe('pending');
    expect(card.textContent).toContain('Ous');
    expect(card.textContent).toContain('2 dotzena');
    expect(card.textContent).toContain('Preu pendent');
    expect(card.textContent).toContain('Reservada per Jordi');
    expect(card.textContent).toContain("Nota de l'oferta: Collits avui");
    expect(card.textContent).toContain('Reservada el 19/09/2026');
    const actions = screen.getByTestId('reservation-actions');
    expect(
      within(actions)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Confirma', 'Rebutja', 'Confirma i marca com a lliurada']);
    expect(actions.textContent).toContain('una sola acció, un sol avís');
    expect(fetchReservation).toHaveBeenCalledWith(ID);
  });

  it('confirms in one tap and shows the new state and actions', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    vi.mocked(actOnReservation).mockResolvedValue({
      reservation: detail({
        status: 'confirmed',
        expiresAt: null,
        confirmedAt: '2026-09-19T09:00:00.000Z',
        actions: ['deliver', 'cancel'],
      }),
    });
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByTestId('reservation-detail');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirma' }));
    await waitFor(() => expect(actOnReservation).toHaveBeenCalledWith(ID, 'confirm', {}));
    await waitFor(() =>
      expect(screen.getByTestId('reservation-detail').dataset['status']).toBe('confirmed'),
    );
    expect(screen.getByTestId('confirmed-at').textContent).toContain('Confirmada el 19/09/2026');
    expect(
      within(screen.getByTestId('reservation-actions'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Marca com a lliurada', 'Cancel·la la reserva']);
    expect(toasts.current?.message).toBe('Reserva confirmada. Ho hem avisat.');
  });

  it('asks before rejecting, takes an optional reason, and sends it trimmed', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    vi.mocked(actOnReservation).mockResolvedValue({
      reservation: detail({
        status: 'rejected',
        reason: 'Ja no en tinc',
        closedAt: '2026-09-19T09:00:00.000Z',
        actions: [],
      }),
    });
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByTestId('reservation-detail');
    await fireEvent.click(screen.getByRole('button', { name: 'Rebutja' }));
    const confirm = screen.getByTestId('action-confirm');
    expect(confirm.textContent).toContain('Vols rebutjar aquesta reserva?');
    await fireEvent.input(within(confirm).getByLabelText('Motiu (opcional)'), {
      target: { value: '  Ja no en tinc  ' },
    });
    await fireEvent.click(within(confirm).getByRole('button', { name: 'Rebutja' }));
    await waitFor(() =>
      expect(actOnReservation).toHaveBeenCalledWith(ID, 'reject', { reason: 'Ja no en tinc' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('reservation-detail').dataset['status']).toBe('rejected'),
    );
    expect(screen.getByTestId('reservation-detail').textContent).toContain('Motiu: Ja no en tinc');
    expect(screen.queryByTestId('reservation-actions')).toBeNull();
  });

  it('confirm and deliver asks once and lands on delivered with both timestamps (ADR-0014)', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    vi.mocked(actOnReservation).mockResolvedValue({
      reservation: detail({
        status: 'delivered',
        expiresAt: null,
        confirmedAt: '2026-09-19T09:00:00.000Z',
        deliveredAt: '2026-09-19T09:00:00.000Z',
        closedAt: '2026-09-19T09:00:00.000Z',
        actions: [],
      }),
    });
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByTestId('reservation-detail');
    await fireEvent.click(screen.getByRole('button', { name: 'Confirma i marca com a lliurada' }));
    const confirm = screen.getByTestId('action-confirm');
    expect(confirm.textContent).toContain('no es pot desfer');
    expect(within(confirm).queryByLabelText('Motiu (opcional)')).toBeNull();
    await fireEvent.click(
      within(confirm).getByRole('button', { name: 'Confirma i marca com a lliurada' }),
    );
    await waitFor(() =>
      expect(actOnReservation).toHaveBeenCalledWith(ID, 'confirm-and-deliver', {}),
    );
    await waitFor(() =>
      expect(screen.getByTestId('reservation-detail').dataset['status']).toBe('delivered'),
    );
    expect(screen.getByTestId('confirmed-at')).toBeTruthy();
    expect(screen.getByTestId('delivered-at')).toBeTruthy();
  });

  it('the requester sees their side, only cancel while pending, and the withdrawn-offer note', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({
      reservation: detail({
        side: 'outgoing',
        counterpart: marta,
        actions: ['cancel'],
        offer: { ...detail().offer, status: 'withdrawn' },
      }),
    });
    setLanguage('es');
    render(ReservationDetail, { params: { id: ID } });
    const card = await screen.findByTestId('reservation-detail');
    expect(card.textContent).toContain('A Marta');
    expect(card.textContent).toContain('La oferta se ha retirado del tablón');
    expect(
      within(screen.getByTestId('reservation-actions'))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Cancelar la reserva']);
  });
});
