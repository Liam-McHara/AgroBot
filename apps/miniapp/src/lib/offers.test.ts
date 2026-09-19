import { describe, expect, it } from 'vitest';
import type { OfferDetailView } from '@agrobot/shared';
import { checkQuantity, isMine, myOfferState, productLabel, todayOnFarm } from './offers.js';

describe('offer helpers', () => {
  it('names the product in the member language with a fallback', () => {
    expect(productLabel({ name: 'Tomàquet', nameEs: 'Tomate' }, 'es')).toBe('Tomate');
    expect(productLabel({ name: 'Tomàquet', nameEs: null }, 'es')).toBe('Tomàquet');
    expect(productLabel({ name: 'Tomàquet', nameEs: 'Tomate' }, 'ca')).toBe('Tomàquet');
  });

  it('ranks what the producer must know about an offer (PRD US-3.2, US-3.4)', () => {
    const base = { status: 'active' as const, available: 3, stale: false, nudgedAt: null };
    expect(myOfferState(base)).toBe('active');
    expect(myOfferState({ ...base, nudgedAt: '2026-09-10T07:00:00.000Z' })).toBe('nudged');
    expect(myOfferState({ ...base, stale: true, nudgedAt: '2026-09-10T07:00:00.000Z' })).toBe(
      'stale',
    );
    expect(myOfferState({ ...base, available: 0, stale: true })).toBe('fully_reserved');
    expect(myOfferState({ ...base, status: 'expired', available: 0 })).toBe('expired');
    expect(myOfferState({ ...base, status: 'withdrawn' })).toBe('withdrawn');
  });

  it('tells the producer view of a detail from another member view', () => {
    const detail = {
      quantity: 4,
      held: 1,
      openReservations: 1,
    } as unknown as OfferDetailView;
    expect(isMine(detail)).toBe(true);
    expect(isMine({ ...detail, quantity: null, held: null, openReservations: null })).toBe(false);
  });

  it('checks a quantity the way the server will (PRD US-3.1, US-3.2)', () => {
    expect(checkQuantity(2.5, 'kg', { held: 0, publishing: true })).toEqual({
      ok: true,
      reason: null,
    });
    expect(checkQuantity(2.5, 'dozen', { held: 0, publishing: true }).reason).toBe('step');
    expect(checkQuantity(0, 'kg', { held: 0, publishing: true }).reason).toBe('zero');
    expect(checkQuantity(0, 'kg', { held: 0, publishing: false }).ok).toBe(true);
    expect(checkQuantity(1, 'kg', { held: 2.5, publishing: false }).reason).toBe('below_held');
    expect(checkQuantity(2.5, 'kg', { held: 2.5, publishing: false }).ok).toBe(true);
    expect(checkQuantity(Number.NaN, 'kg', { held: 0, publishing: true }).reason).toBe('step');
  });

  it('reads today on the farm', () => {
    expect(todayOnFarm(new Date('2026-09-19T23:30:00Z'))).toBe('2026-09-20');
  });
});
