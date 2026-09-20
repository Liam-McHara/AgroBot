import { describe, expect, it } from 'vitest';
import { checkReserveQuantity, statusTone } from './reservations.js';

describe('reserve form checks (PRD US-4.1)', () => {
  it('accepts a positive quantity on the unit step, up to what is available', () => {
    expect(checkReserveQuantity(2, 'dozen', 4)).toEqual({ ok: true, reason: null });
    expect(checkReserveQuantity(4, 'dozen', 4)).toEqual({ ok: true, reason: null });
    expect(checkReserveQuantity(2.5, 'kg', 3)).toEqual({ ok: true, reason: null });
  });

  it('refuses nothing, off-step, zero and more than is left, in that order of blame', () => {
    expect(checkReserveQuantity(null, 'kg', 3)).toEqual({ ok: false, reason: 'empty' });
    expect(checkReserveQuantity(Number.NaN, 'kg', 3)).toEqual({ ok: false, reason: 'empty' });
    expect(checkReserveQuantity(1.5, 'dozen', 4)).toEqual({ ok: false, reason: 'step' });
    expect(checkReserveQuantity(0, 'kg', 3)).toEqual({ ok: false, reason: 'zero' });
    expect(checkReserveQuantity(3.1, 'kg', 3)).toEqual({ ok: false, reason: 'over' });
  });
});

describe('status tones (PRD US-4.6)', () => {
  it('groups the six statuses into four looks', () => {
    expect(statusTone('pending')).toBe('pending');
    expect(statusTone('confirmed')).toBe('active');
    expect(statusTone('delivered')).toBe('done');
    for (const status of ['rejected', 'cancelled', 'expired'] as const) {
      expect(statusTone(status)).toBe('off');
    }
  });
});
