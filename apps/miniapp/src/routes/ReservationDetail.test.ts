import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import {
  DEFAULT_SETTINGS,
  NO_UNREAD,
  type Me,
  type MessageView,
  type ReservationDetailView,
} from '@agrobot/shared';
import ReservationDetail from './ReservationDetail.svelte';
import { ApiError } from '../lib/api/client.js';
import { actOnReservation, fetchReservation } from '../lib/api/reservations.js';
import { fetchMessages, postMessage, readThread } from '../lib/api/threads.js';
import { setLanguage } from '../lib/i18n/index.svelte.js';
import { meStore } from '../lib/stores/me.svelte.js';
import { realtime } from '../lib/stores/realtime.svelte.js';
import { toasts } from '../lib/stores/toast.svelte.js';

vi.mock('../lib/api/reservations.js', () => ({
  fetchReservation: vi.fn(),
  actOnReservation: vi.fn(),
}));
vi.mock('../lib/api/threads.js', () => ({
  fetchMessages: vi.fn(),
  postMessage: vi.fn(),
  readThread: vi.fn(),
}));

const marta = { id: '22222222-2222-4222-8222-222222222222', displayName: 'Marta', username: null };
const jordi = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Jordi',
  username: 'jordi',
};
const ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The viewer is Marta, the producer. */
const ME: Me = {
  id: marta.id,
  telegramId: '900000001',
  username: null,
  displayName: 'Marta',
  language: 'ca',
  role: 'member',
  status: 'approved',
  settings: DEFAULT_SETTINGS,
  unread: NO_UNREAD,
};

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
  unread: 0,
  offer: {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'active',
    note: 'Collits avui',
    availableUntil: null,
    available: 4,
  },
  thread: { writable: true, writableUntil: null },
  ...over,
});

const line = (over: Partial<MessageView> & { id: string }): MessageView => ({
  reservationId: ID,
  kind: 'text',
  body: '',
  sender: jordi,
  mine: false,
  meta: null,
  createdAt: '2026-09-19T08:05:00.000Z',
  ...over,
});
const CREATED = line({
  id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  kind: 'system',
  body: 'created',
  sender: null,
  meta: { event: 'created', actorId: jordi.id, actorName: 'Jordi', reason: null, cause: null },
  createdAt: '2026-09-19T08:00:00.000Z',
});
const HOLA = line({ id: 'cccccccc-cccc-4ccc-8ccc-000000000002', body: 'Hola! Demà a les 10?' });
const BON_DIA = line({
  id: 'cccccccc-cccc-4ccc-8ccc-000000000003',
  body: 'Bon dia, perfecte',
  sender: marta,
  mine: true,
  createdAt: '2026-09-18T18:00:00.000Z',
});

beforeEach(() => {
  vi.mocked(fetchReservation).mockReset();
  vi.mocked(actOnReservation).mockReset();
  vi.mocked(fetchMessages).mockReset();
  vi.mocked(postMessage).mockReset();
  vi.mocked(readThread).mockReset();
  vi.mocked(fetchMessages).mockResolvedValue({ messages: [CREATED], hasMore: false });
  vi.mocked(readThread).mockResolvedValue({ unread: NO_UNREAD });
  meStore.me = ME;
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
    // The transition wrote a system line: the thread is fetched again.
    await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(2));
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

describe('Thread (PRD US-5.1, US-5.2; ADR-0005)', () => {
  it('shows system lines in my language, their messages on the left, mine on the right, and marks the thread read', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    vi.mocked(fetchMessages).mockResolvedValue({
      messages: [CREATED, BON_DIA, HOLA],
      hasMore: false,
    });
    vi.mocked(readThread).mockResolvedValue({ unread: { total: 1, incoming: 1, outgoing: 0 } });
    render(ReservationDetail, { params: { id: ID } });
    const thread = await screen.findByTestId('thread');
    await within(thread).findByText('Hola! Demà a les 10?');
    expect(within(thread).getByTestId('system-line').textContent).toContain(
      'Jordi ha fet la reserva',
    );
    const bubbles = within(thread).getAllByTestId('message');
    expect(bubbles.map((b) => [b.dataset['mine'], b.textContent?.includes('Jordi')])).toEqual([
      ['true', false],
      ['false', true],
    ]);
    expect(bubbles[1]!.textContent).toContain('Hola! Demà a les 10?');
    expect(within(thread).queryByText('Encara no hi ha missatges', { exact: false })).toBeNull();
    // Read on open: the badges take what the server answered (PRD US-4.6).
    await waitFor(() => expect(readThread).toHaveBeenCalledWith(ID));
    await waitFor(() => expect(meStore.me?.unread.total).toBe(1));
  });

  it('sends optimistically, replaces the pending bubble with the server copy and clears the box', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    let resolve!: (value: { message: MessageView }) => void;
    vi.mocked(postMessage).mockReturnValue(new Promise((r) => (resolve = r)));
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByTestId('thread');
    expect(screen.getByText('Encara no hi ha missatges', { exact: false })).toBeTruthy();
    const box = screen.getByLabelText('Missatge') as HTMLTextAreaElement;
    const send = screen.getByTestId('send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await fireEvent.input(box, { target: { value: '  A les 10 al mercat  ' } });
    expect(send.disabled).toBe(false);
    await fireEvent.click(send);

    expect(postMessage).toHaveBeenCalledWith(ID, 'A les 10 al mercat');
    const pending = screen.getByTestId('message');
    expect(pending.dataset['pending']).toBe('true');
    expect(pending.textContent).toContain('A les 10 al mercat');
    expect(pending.textContent).toContain('Enviant…');
    expect(box.value).toBe('');

    resolve({
      message: line({
        id: 'cccccccc-cccc-4ccc-8ccc-000000000009',
        body: 'A les 10 al mercat',
        sender: marta,
        mine: true,
      }),
    });
    await waitFor(() => expect(screen.getByTestId('message').dataset['pending']).toBeUndefined());
    expect(screen.getByTestId('message').dataset['mine']).toBe('true');
    expect(screen.getAllByTestId('message')).toHaveLength(1);
  });

  it('gives the text back and toasts when sending fails; a closed thread reloads the reservation', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    vi.mocked(postMessage).mockRejectedValue(
      new ApiError(403, 'THREAD_READONLY', 'Aquesta conversa ja està tancada.'),
    );
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByTestId('thread');
    const box = screen.getByLabelText('Missatge') as HTMLTextAreaElement;
    await fireEvent.input(box, { target: { value: 'Massa tard' } });
    await fireEvent.click(screen.getByTestId('send'));
    await waitFor(() =>
      expect(toasts.current).toMatchObject({
        kind: 'error',
        message: 'Aquesta conversa ja està tancada.',
      }),
    );
    expect(box.value).toBe('Massa tard');
    expect(screen.queryByTestId('message')).toBeNull();
    await waitFor(() => expect(fetchReservation).toHaveBeenCalledTimes(2));
  });

  it('is read-only with a banner once the window closed, and names the deadline while it is open', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({
      reservation: detail({
        status: 'delivered',
        actions: [],
        closedAt: '2026-09-10T09:00:00.000Z',
        thread: { writable: false, writableUntil: '2026-09-17T09:00:00.000Z' },
      }),
    });
    render(ReservationDetail, { params: { id: ID } });
    const banner = await screen.findByTestId('thread-readonly');
    expect(banner.textContent).toContain('Conversa tancada');
    expect(banner.textContent).toContain('7 dies');
    expect(screen.queryByLabelText('Missatge')).toBeNull();
    cleanup();

    vi.mocked(fetchReservation).mockResolvedValue({
      reservation: detail({
        status: 'delivered',
        actions: [],
        closedAt: '2026-09-19T09:00:00.000Z',
        thread: { writable: true, writableUntil: '2026-09-26T09:00:00.000Z' },
      }),
    });
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByLabelText('Missatge');
    expect(screen.getByText('Podeu escriure-hi fins al 26/09/2026', { exact: false })).toBeTruthy();
    expect(screen.queryByTestId('thread-readonly')).toBeNull();
  });

  it('offers Open in Telegram only when the counterpart has a username (US-5.2)', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    render(ReservationDetail, { params: { id: ID } });
    const link = await screen.findByTestId('open-in-telegram');
    expect(link.getAttribute('href')).toBe('https://t.me/jordi');
    expect(link.textContent).toBe('Obre a Telegram');
    cleanup();

    vi.mocked(fetchReservation).mockResolvedValue({
      reservation: detail({ side: 'outgoing', counterpart: marta, actions: ['cancel'] }),
    });
    render(ReservationDetail, { params: { id: ID } });
    await screen.findByTestId('reservation-detail');
    expect(screen.queryByTestId('open-in-telegram')).toBeNull();
  });

  it('tells the socket which thread is open, refetches on message.new, and leaves quietly', async () => {
    vi.mocked(fetchReservation).mockResolvedValue({ reservation: detail() });
    const setViewing = vi.spyOn(realtime, 'setViewing').mockImplementation(() => {});
    const handlers: Array<() => void> = [];
    const on = vi.spyOn(realtime, 'on').mockImplementation((type, handler) => {
      if (type === 'message.new') {
        handlers.push(() => handler({ type: 'message.new', reservationId: ID }));
        handlers.push(() =>
          handler({ type: 'message.new', reservationId: '99999999-9999-4999-8999-999999999999' }),
        );
      }
      return () => {};
    });
    try {
      const { unmount } = render(ReservationDetail, { params: { id: ID } });
      await screen.findByTestId('thread');
      expect(setViewing).toHaveBeenCalledWith(ID);
      await waitFor(() => expect(fetchMessages).toHaveBeenCalledTimes(1));
      vi.mocked(fetchMessages).mockResolvedValue({ messages: [CREATED, HOLA], hasMore: false });
      for (const fire of handlers) fire();
      await screen.findByText('Hola! Demà a les 10?');
      // Only the frame about this thread counted.
      expect(fetchMessages).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(readThread).toHaveBeenCalledTimes(2));
      unmount();
      expect(setViewing).toHaveBeenLastCalledWith(null);
    } finally {
      on.mockRestore();
      setViewing.mockRestore();
    }
  });
});
