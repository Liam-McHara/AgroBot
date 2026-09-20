import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { ReservationView } from '@agrobot/shared';
import Reservations from './Reservations.svelte';
import { fetchReservations } from '../lib/api/reservations.js';
import { setLanguage } from '../lib/i18n/index.svelte.js';
import { realtime } from '../lib/stores/realtime.svelte.js';
import { toasts } from '../lib/stores/toast.svelte.js';

vi.mock('../lib/api/reservations.js', () => ({ fetchReservations: vi.fn() }));

const marta = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Marta', username: null };
const jordi = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Jordi',
  username: 'jordi',
};

const reservation = (over: Partial<ReservationView> & { id: string }): ReservationView => ({
  offerId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  product: {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Ous',
    nameEs: 'Huevos',
    unitCode: 'dozen',
    priceCents: 310,
    currency: 'EUR',
    category: null,
    status: 'active',
  },
  quantity: 2,
  unitPriceCents: 310,
  currency: 'EUR',
  totalCents: 620,
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
  unread: 0,
  ...over,
});

const PENDING = reservation({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', unread: 2 });
const DELIVERED = reservation({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'delivered',
  side: 'outgoing',
  counterpart: marta,
  confirmedAt: '2026-09-19T09:00:00.000Z',
  deliveredAt: '2026-09-19T10:00:00.000Z',
  closedAt: '2026-09-19T10:00:00.000Z',
  actions: [],
});

beforeEach(() => {
  vi.mocked(fetchReservations).mockReset();
  vi.mocked(fetchReservations).mockImplementation(async (side, state) => ({
    reservations:
      side === 'incoming' && state === 'active'
        ? [PENDING]
        : side === 'outgoing' && state === 'closed'
          ? [DELIVERED]
          : [],
  }));
  window.location.hash = '';
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

describe('My reservations (PRD US-4.6)', () => {
  it('lists incoming active reservations with product, quantity, total, counterpart and status', async () => {
    render(Reservations);
    const [row] = await screen.findAllByTestId('reservation');
    expect(row!.dataset['status']).toBe('pending');
    expect(row!.textContent).toContain('Ous');
    expect(row!.textContent).toContain('2 dotzena');
    expect(row!.textContent).toMatch(/3,10\s*€ \/ dotzena/);
    expect(row!.textContent).toMatch(/6,20\s*€ en total/);
    expect(row!.textContent).toContain('Reservada per Jordi');
    expect(row!.textContent).toContain('Pendent de confirmar');
    expect(row!.textContent).toContain('Caduca el 21/09/2026');
    // PRD US-4.6: the unread messages badge of its thread (US-5.1).
    expect(screen.getByTestId('reservation-unread').textContent).toBe('2');
    expect(screen.getByTestId('reservation-unread').getAttribute('aria-label')).toBe(
      '2 missatges sense llegir',
    );
    expect(fetchReservations).toHaveBeenCalledWith('incoming', 'active');
  });

  it('switches side and state, shows the matching empty text, and opens a reservation', async () => {
    render(Reservations);
    await screen.findAllByTestId('reservation');
    await fireEvent.click(screen.getByRole('tab', { name: 'Fetes' }));
    await waitFor(() => expect(fetchReservations).toHaveBeenLastCalledWith('outgoing', 'active'));
    expect((await screen.findByTestId('reservations-empty')).textContent).toContain(
      'No tens cap reserva en curs',
    );
    await fireEvent.click(screen.getByRole('radio', { name: 'Tancades' }));
    await waitFor(() => expect(fetchReservations).toHaveBeenLastCalledWith('outgoing', 'closed'));
    const [row] = await screen.findAllByTestId('reservation');
    expect(row!.dataset['status']).toBe('delivered');
    expect(screen.queryByTestId('reservation-unread')).toBeNull();
    expect(row!.textContent).toContain('A Marta');
    expect(row!.textContent).toContain('Lliurada el 19/09/2026');
    await fireEvent.click(row!);
    expect(window.location.hash).toBe(`#/reservations/${DELIVERED.id}`);
  });

  it('refetches on reservation.changed and on message.new', async () => {
    const handlers: Array<() => void> = [];
    const on = vi.spyOn(realtime, 'on').mockImplementation((type, handler) => {
      if (type === 'reservation.changed') {
        handlers.push(() => handler({ type: 'reservation.changed', id: PENDING.id }));
      }
      if (type === 'message.new') {
        handlers.push(() => handler({ type: 'message.new', reservationId: PENDING.id }));
      }
      return () => {};
    });
    try {
      render(Reservations);
      await screen.findAllByTestId('reservation');
      vi.mocked(fetchReservations).mockResolvedValue({ reservations: [] });
      for (const fire of handlers) fire();
      await screen.findByTestId('reservations-empty');
      expect(fetchReservations).toHaveBeenCalledTimes(3);
    } finally {
      on.mockRestore();
    }
  });
});
