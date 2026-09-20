import { UNITS, type UnitCode } from './enums.js';

/**
 * Quantities (PRD §3 "Unit", US-3.1, Q5). The rules live here so the Mini App's forms and the
 * server's domain services validate a quantity identically.
 */

/** `numeric(10,2)` in the schema (ARCH §5): eight integer digits at most. */
export const QUANTITY_MAX = 99_999_999.99;

/** Fraction digits a quantity of this unit may carry: one for `kg`/`litre`, none otherwise. */
export function quantityDecimals(unitCode: UnitCode): number {
  return UNITS[unitCode].allowsDecimals ? 1 : 0;
}

/**
 * PRD US-3.1: a quantity respects its unit's step — integers for `unit`/`box`/`bunch`/`dozen`,
 * one decimal for `kg`/`litre`. Zero is on every step: publishing needs more than zero, but
 * US-3.2 lets a producer lower an offer down to what is held, which may be nothing.
 */
export function isQuantityOnStep(quantity: number, unitCode: UnitCode): boolean {
  if (!Number.isFinite(quantity) || quantity < 0 || quantity > QUANTITY_MAX) return false;
  return Number(quantity.toFixed(quantityDecimals(unitCode))) === quantity;
}

/** The HTML `step` attribute for a quantity input of this unit. */
export function quantityStep(unitCode: UnitCode): string {
  return UNITS[unitCode].step.toString();
}

/** Postgres returns `numeric` as text; the API speaks numbers. */
export function parseQuantity(value: string | number): number {
  return typeof value === 'number' ? value : Number(value);
}

/**
 * PRD US-4.6, US-5.1: a reservation's total, in integer cents, from its quantity and the unit
 * price it snapshotted; `null` while the product's price is pending (PRD US-2.2). Half cents
 * round away from zero, as a till would.
 */
export function totalCents(quantity: number, unitPriceCents: number | null): number | null {
  if (unitPriceCents === null) return null;
  return Math.round(quantity * unitPriceCents);
}
