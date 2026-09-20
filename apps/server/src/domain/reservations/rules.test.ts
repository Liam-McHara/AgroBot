import { describe, expect, it } from 'vitest';
import { RESERVATION_ACTIONS, RESERVATION_STATUSES } from '@agrobot/shared';
import {
  allowedActions,
  canAct,
  expiresAtFor,
  isExpiryDue,
  isReminderDue,
  otherParty,
  partyMayEver,
  partyOf,
  reminderAtFor,
  stateOf,
  statusAfter,
  whyNotReservable,
} from './rules.js';

const marta = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const jordi = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const pere = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const reservation = { requesterId: jordi, producerId: marta };

describe('reservation guards (ARCH §6 table)', () => {
  it('knows the parties and nobody else', () => {
    expect(partyOf(reservation, marta)).toBe('producer');
    expect(partyOf(reservation, jordi)).toBe('requester');
    expect(partyOf(reservation, pere)).toBeNull();
    expect(otherParty('producer')).toBe('requester');
    expect(otherParty('requester')).toBe('producer');
  });

  it('confirm and reject: producer, pending only', () => {
    for (const action of ['confirm', 'reject'] as const) {
      expect(canAct('pending', 'producer', action)).toBe(true);
      expect(canAct('pending', 'requester', action)).toBe(false);
      for (const status of RESERVATION_STATUSES.filter((s) => s !== 'pending')) {
        expect(canAct(status, 'producer', action)).toBe(false);
      }
    }
  });

  it('cancel: requester while pending or confirmed, producer while confirmed (they reject instead)', () => {
    expect(canAct('pending', 'requester', 'cancel')).toBe(true);
    expect(canAct('confirmed', 'requester', 'cancel')).toBe(true);
    expect(canAct('pending', 'producer', 'cancel')).toBe(false);
    expect(canAct('confirmed', 'producer', 'cancel')).toBe(true);
    for (const status of ['delivered', 'rejected', 'cancelled', 'expired'] as const) {
      expect(canAct(status, 'requester', 'cancel')).toBe(false);
      expect(canAct(status, 'producer', 'cancel')).toBe(false);
    }
  });

  it('deliver: either party, confirmed only', () => {
    expect(canAct('confirmed', 'requester', 'deliver')).toBe(true);
    expect(canAct('confirmed', 'producer', 'deliver')).toBe(true);
    for (const status of RESERVATION_STATUSES.filter((s) => s !== 'confirmed')) {
      expect(canAct(status, 'requester', 'deliver')).toBe(false);
      expect(canAct(status, 'producer', 'deliver')).toBe(false);
    }
  });

  it('confirm-and-deliver: producer, pending only (ADR-0014)', () => {
    expect(canAct('pending', 'producer', 'confirm-and-deliver')).toBe(true);
    expect(canAct('pending', 'requester', 'confirm-and-deliver')).toBe(false);
    expect(canAct('confirmed', 'producer', 'confirm-and-deliver')).toBe(false);
  });

  it('lists what each party sees on the screen, and nothing on a closed reservation', () => {
    expect(allowedActions('pending', 'producer')).toEqual([
      'confirm',
      'reject',
      'confirm-and-deliver',
    ]);
    expect(allowedActions('pending', 'requester')).toEqual(['cancel']);
    expect(allowedActions('confirmed', 'producer')).toEqual(['deliver', 'cancel']);
    expect(allowedActions('confirmed', 'requester')).toEqual(['deliver', 'cancel']);
    for (const status of ['delivered', 'rejected', 'cancelled', 'expired'] as const) {
      expect(allowedActions(status, 'producer')).toEqual([]);
      expect(allowedActions(status, 'requester')).toEqual([]);
    }
  });

  it('tells a wrong actor from a stale button', () => {
    expect(partyMayEver('requester', 'confirm')).toBe(false);
    expect(partyMayEver('requester', 'reject')).toBe(false);
    expect(partyMayEver('requester', 'confirm-and-deliver')).toBe(false);
    expect(partyMayEver('producer', 'confirm')).toBe(true);
    for (const action of RESERVATION_ACTIONS) expect(partyMayEver('producer', action)).toBe(true);
    expect(partyMayEver('requester', 'cancel')).toBe(true);
    expect(partyMayEver('requester', 'deliver')).toBe(true);
  });

  it('maps actions to statuses and statuses to tabs', () => {
    expect(statusAfter('confirm')).toBe('confirmed');
    expect(statusAfter('reject')).toBe('rejected');
    expect(statusAfter('cancel')).toBe('cancelled');
    expect(statusAfter('deliver')).toBe('delivered');
    expect(statusAfter('confirm-and-deliver')).toBe('delivered');
    expect(stateOf('pending')).toBe('active');
    expect(stateOf('confirmed')).toBe('active');
    for (const status of ['delivered', 'rejected', 'cancelled', 'expired'] as const) {
      expect(stateOf(status)).toBe('closed');
    }
  });
});

describe('what can be reserved (PRD US-4.1)', () => {
  const offer = {
    status: 'active' as const,
    availableUntil: null,
    producerId: marta,
    producerStatus: 'approved' as const,
  };
  const today = '2026-09-19';

  it('accepts an active, dated-or-not offer of an approved producer, by someone else', () => {
    expect(whyNotReservable(offer, jordi, today)).toBeNull();
    expect(whyNotReservable({ ...offer, availableUntil: today }, jordi, today)).toBeNull();
    expect(whyNotReservable({ ...offer, availableUntil: '2026-12-31' }, jordi, today)).toBeNull();
  });

  it('refuses my own offer, a withdrawn or expired one, a past date and a suspended producer', () => {
    expect(whyNotReservable(offer, marta, today)).toBe('own_offer');
    expect(whyNotReservable({ ...offer, status: 'withdrawn' }, jordi, today)).toBe(
      'offer_not_active',
    );
    expect(whyNotReservable({ ...offer, status: 'expired' }, jordi, today)).toBe(
      'offer_not_active',
    );
    expect(whyNotReservable({ ...offer, availableUntil: '2026-09-18' }, jordi, today)).toBe(
      'offer_past_date',
    );
    expect(whyNotReservable({ ...offer, producerStatus: 'suspended' }, jordi, today)).toBe(
      'producer_not_approved',
    );
  });
});

describe('deadlines (PRD US-4.1, US-4.5)', () => {
  const at = new Date('2026-09-19T10:00:00Z');

  it('expires after the configured hours, fractions included, and reminds before that', () => {
    expect(expiresAtFor(at, 48).toISOString()).toBe('2026-09-21T10:00:00.000Z');
    expect(expiresAtFor(at, 1 / 60).toISOString()).toBe('2026-09-19T10:01:00.000Z');
    expect(reminderAtFor(new Date('2026-09-21T10:00:00Z'), 12).toISOString()).toBe(
      '2026-09-20T22:00:00.000Z',
    );
  });

  it('is due for a reminder once inside the window, once only, while pending', () => {
    const expiresAt = new Date('2026-09-19T20:00:00Z');
    const pending = { status: 'pending' as const, remindedAt: null, expiresAt };
    expect(isReminderDue(pending, new Date('2026-09-19T07:59:00Z'), 12)).toBe(false);
    expect(isReminderDue(pending, new Date('2026-09-19T08:00:00Z'), 12)).toBe(true);
    expect(isReminderDue({ ...pending, remindedAt: at }, at, 12)).toBe(false);
    expect(isReminderDue({ ...pending, status: 'confirmed', expiresAt: null }, at, 12)).toBe(false);
  });

  it('is due for expiry at expires_at, while pending', () => {
    const expiresAt = new Date('2026-09-19T10:00:00Z');
    expect(isExpiryDue({ status: 'pending', expiresAt }, new Date('2026-09-19T09:59:59Z'))).toBe(
      false,
    );
    expect(isExpiryDue({ status: 'pending', expiresAt }, at)).toBe(true);
    expect(isExpiryDue({ status: 'confirmed', expiresAt: null }, at)).toBe(false);
    expect(isExpiryDue({ status: 'expired', expiresAt }, at)).toBe(false);
  });
});
