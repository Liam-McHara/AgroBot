import { describe, expect, it } from 'vitest';
import {
  createReservationSchema,
  reservationActionBodySchema,
  reservationsQuerySchema,
} from './reservations.js';
import { totalCents } from '../quantity.js';

describe('reservation contracts (PRD §8, ARCH §11)', () => {
  it('bounds the quantity of a reservation and leaves the unit step to the domain', () => {
    const offerId = '11111111-1111-4111-8111-111111111111';
    expect(createReservationSchema.safeParse({ offerId, quantity: 2.5 }).success).toBe(true);
    expect(createReservationSchema.safeParse({ offerId, quantity: 0 }).success).toBe(false);
    expect(createReservationSchema.safeParse({ offerId, quantity: -1 }).success).toBe(false);
    expect(createReservationSchema.safeParse({ offerId: 'x', quantity: 1 }).success).toBe(false);
  });

  it('accepts an optional trimmed reason of at most 200 characters', () => {
    expect(reservationActionBodySchema.parse({})).toEqual({});
    expect(reservationActionBodySchema.parse({ reason: '  ja no en tinc ' })).toEqual({
      reason: 'ja no en tinc',
    });
    expect(reservationActionBodySchema.parse({ reason: null })).toEqual({ reason: null });
    expect(reservationActionBodySchema.safeParse({ reason: 'x'.repeat(201) }).success).toBe(false);
    expect(reservationActionBodySchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('defaults the list to the active tab and refuses an unknown side', () => {
    expect(reservationsQuerySchema.parse({ side: 'incoming' })).toEqual({
      side: 'incoming',
      state: 'active',
    });
    expect(reservationsQuerySchema.safeParse({ side: 'mine' }).success).toBe(false);
    expect(reservationsQuerySchema.safeParse({}).success).toBe(false);
  });

  it('totals in integer cents and stays null while the price is pending', () => {
    expect(totalCents(2.5, 235)).toBe(588);
    expect(totalCents(3, 310)).toBe(930);
    expect(totalCents(1, null)).toBeNull();
  });
});
