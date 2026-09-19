import { describe, expect, it } from 'vitest';
import {
  QUANTITY_MAX,
  isQuantityOnStep,
  parseQuantity,
  quantityDecimals,
  quantityStep,
} from './quantity.js';

describe('quantity steps (PRD US-3.1, Q5)', () => {
  it('accepts integers for countable units and refuses fractions', () => {
    for (const unit of ['unit', 'box', 'bunch', 'dozen'] as const) {
      expect(isQuantityOnStep(3, unit), unit).toBe(true);
      expect(isQuantityOnStep(0, unit), unit).toBe(true);
      expect(isQuantityOnStep(2.5, unit), unit).toBe(false);
      expect(quantityDecimals(unit)).toBe(0);
      expect(quantityStep(unit)).toBe('1');
    }
  });

  it('accepts one decimal for weighable units and refuses two', () => {
    for (const unit of ['kg', 'litre'] as const) {
      expect(isQuantityOnStep(2.5, unit), unit).toBe(true);
      expect(isQuantityOnStep(0.1, unit), unit).toBe(true);
      expect(isQuantityOnStep(2.55, unit), unit).toBe(false);
      expect(isQuantityOnStep(0.1 + 0.2, unit), unit).toBe(false);
      expect(quantityDecimals(unit)).toBe(1);
      expect(quantityStep(unit)).toBe('0.1');
    }
  });

  it('refuses negatives, infinities and anything numeric(10,2) cannot hold', () => {
    expect(isQuantityOnStep(-1, 'kg')).toBe(false);
    expect(isQuantityOnStep(Number.NaN, 'kg')).toBe(false);
    expect(isQuantityOnStep(Number.POSITIVE_INFINITY, 'unit')).toBe(false);
    expect(isQuantityOnStep(QUANTITY_MAX, 'unit')).toBe(false);
    expect(isQuantityOnStep(QUANTITY_MAX + 1, 'kg')).toBe(false);
    expect(isQuantityOnStep(99_999_999, 'unit')).toBe(true);
  });

  it('reads the numeric text Postgres returns', () => {
    expect(parseQuantity('12.50')).toBe(12.5);
    expect(parseQuantity(3)).toBe(3);
  });
});
