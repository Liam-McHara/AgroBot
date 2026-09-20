import { isQuantityOnStep, type ReservationStatus, type UnitCode } from '@agrobot/shared';

/** Pure helpers the reservation screens share (PRD §8). */

export interface ReserveCheck {
  ok: boolean;
  /** Why not: nothing entered, off the unit's step, not positive, or more than is left. */
  reason: 'empty' | 'step' | 'zero' | 'over' | null;
}

/**
 * PRD US-4.1: quantity > 0, ≤ available, on the unit's step — the same rules the server
 * applies, so the button is disabled rather than the request refused. Someone else may still
 * get there first, which is what the 409 and the "reserve what is left" offer are for.
 */
export function checkReserveQuantity(
  quantity: number | null,
  unitCode: UnitCode,
  available: number,
): ReserveCheck {
  if (quantity === null || Number.isNaN(quantity)) return { ok: false, reason: 'empty' };
  if (!isQuantityOnStep(quantity, unitCode)) return { ok: false, reason: 'step' };
  if (quantity <= 0) return { ok: false, reason: 'zero' };
  if (quantity > available) return { ok: false, reason: 'over' };
  return { ok: true, reason: null };
}

/** PRD US-4.6: the badge colour class of a status — attention, quiet, or over. */
export type StatusTone = 'pending' | 'active' | 'done' | 'off';

export function statusTone(status: ReservationStatus): StatusTone {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'confirmed':
      return 'active';
    case 'delivered':
      return 'done';
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return 'off';
  }
}

/** The actions that may carry a reason (PRD US-4.2, US-4.3). */
export const ACTIONS_WITH_REASON = ['reject', 'cancel'] as const;
