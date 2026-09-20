import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import type { BoardView, OfferView } from '@agrobot/shared';
import Board from './Board.svelte';
import { fetchBoard } from '../lib/api/offers.js';
import { setLanguage } from '../lib/i18n/index.svelte.js';
import { boardStore } from '../lib/stores/board.svelte.js';
import { realtime } from '../lib/stores/realtime.svelte.js';
import { toasts } from '../lib/stores/toast.svelte.js';

vi.mock('../lib/api/offers.js', () => ({ fetchBoard: vi.fn() }));
vi.mock('../lib/api/reservations.js', () => ({ createReservation: vi.fn() }));

const offer = (over: Partial<OfferView> & { id: string }): OfferView => ({
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
  available: 12.5,
  availableUntil: null,
  note: null,
  status: 'active',
  stale: false,
  createdAt: '2026-09-19T08:00:00.000Z',
  updatedAt: '2026-09-19T08:00:00.000Z',
  ...over,
});

const ONE = offer({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', note: 'Collits avui' });
const TWO = offer({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  producer: { id: '33333333-3333-4333-8333-333333333333', displayName: 'Pere' },
  available: 3,
  availableUntil: '2026-09-30',
  stale: true,
});

const byProduct: BoardView = {
  group: 'product',
  groups: [{ key: ONE.product.id, name: 'Tomàquet', nameEs: 'Tomate', offers: [ONE, TWO] }],
  categories: ['Horta'],
  total: 2,
};

beforeEach(() => {
  vi.mocked(fetchBoard).mockReset();
  vi.mocked(fetchBoard).mockResolvedValue(byProduct);
  boardStore.params = { group: 'product', q: '', category: '' };
  boardStore.data = null;
  setLanguage('ca');
  toasts.dismiss();
});
afterEach(cleanup);

describe('Board (PRD US-3.3, US-3.4)', () => {
  it('lists the groups with availability, price, producer, date and the stale marker', async () => {
    render(Board);
    const group = await screen.findByTestId('board-group');
    expect(within(group).getByRole('heading', { level: 2 }).textContent).toBe('Tomàquet');
    const rows = within(group).getAllByTestId('offer');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('Marta');
    expect(rows[0]!.textContent).toContain('12,5 kg disponibles');
    expect(rows[0]!.textContent).toMatch(/2,35\s*€ \/ kg/);
    expect(rows[0]!.textContent).toContain('Collits avui');
    expect(rows[1]!.textContent).toContain('Fins al 30/09/2026');
    expect(rows[1]!.textContent).toContain('Sense confirmar fa dies');
    expect(fetchBoard).toHaveBeenCalledWith({ group: 'product', q: '', category: '' });
  });

  it('opens the detail sheet with the reserve form, enabled once a quantity is typed (US-4.1)', async () => {
    render(Board);
    const [row] = await screen.findAllByTestId('offer');
    await fireEvent.click(row!.closest('button')!);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('reserve')).toHaveProperty('disabled', true);
    expect(within(dialog).getByText('Disponibles: 12,5 kg')).toBeTruthy();
    await fireEvent.input(within(dialog).getByLabelText('Quantitat a reservar (kg)'), {
      target: { value: '2.5' },
    });
    expect(within(dialog).getByTestId('reserve')).toHaveProperty('disabled', false);
    expect(within(dialog).getByTestId('reserve-total').textContent).toMatch(/Total: 5,88\s*€/);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Tanca' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('searches after a pause, regroups by producer and filters by category', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(Board);
      await screen.findByTestId('board-group');
      await fireEvent.input(screen.getByRole('searchbox'), { target: { value: ' tom ' } });
      expect(fetchBoard).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchBoard).toHaveBeenLastCalledWith({ group: 'product', q: 'tom', category: '' });

      await fireEvent.click(screen.getByRole('radio', { name: 'Per productor/a' }));
      expect(fetchBoard).toHaveBeenLastCalledWith({ group: 'producer', q: 'tom', category: '' });

      const chip = screen.getByRole('button', { name: 'Horta' });
      await fireEvent.click(chip);
      expect(fetchBoard).toHaveBeenLastCalledWith({
        group: 'producer',
        q: 'tom',
        category: 'Horta',
      });
      await fireEvent.click(chip);
      expect(fetchBoard).toHaveBeenLastCalledWith({ group: 'producer', q: 'tom', category: '' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refetches on board.changed and shows the empty state in the member language', async () => {
    const handlers: Array<() => void> = [];
    const on = vi.spyOn(realtime, 'on').mockImplementation((type, handler) => {
      if (type === 'board.changed') handlers.push(() => handler({ type: 'board.changed' }));
      return () => {};
    });
    try {
      render(Board);
      await screen.findByTestId('board-group');
      vi.mocked(fetchBoard).mockResolvedValue({ ...byProduct, groups: [], total: 0 });
      for (const fire of handlers) fire();
      await screen.findByTestId('board-empty');
      expect(fetchBoard).toHaveBeenCalledTimes(2);
      setLanguage('es');
      await waitFor(() =>
        expect(screen.getByTestId('board-empty').textContent).toContain(
          'no hay nada para reservar',
        ),
      );
    } finally {
      on.mockRestore();
    }
  });
});
