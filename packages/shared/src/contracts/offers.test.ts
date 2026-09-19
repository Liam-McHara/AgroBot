import { describe, expect, it } from 'vitest';
import { boardQuerySchema, editOfferSchema, publishOfferSchema } from './offers.js';

const PRODUCT = '11111111-1111-4111-8111-111111111111';

describe('offer contracts (PRD US-3.1, US-3.2)', () => {
  it('publishing needs a product and a positive quantity; date and note are optional', () => {
    expect(publishOfferSchema.safeParse({ productId: PRODUCT, quantity: 2.5 }).success).toBe(true);
    expect(publishOfferSchema.safeParse({ productId: PRODUCT, quantity: 0 }).success).toBe(false);
    expect(publishOfferSchema.safeParse({ productId: 'x', quantity: 1 }).success).toBe(false);
    expect(
      publishOfferSchema.safeParse({
        productId: PRODUCT,
        quantity: 1,
        availableUntil: '2026-09-31',
      }).success,
    ).toBe(false);
    const parsed = publishOfferSchema.parse({
      productId: PRODUCT,
      quantity: 1,
      availableUntil: '2026-09-30',
      note: '  Collits avui  ',
    });
    expect(parsed.note).toBe('Collits avui');
    expect(
      publishOfferSchema.safeParse({ productId: PRODUCT, quantity: 1, note: ' ' }).success,
    ).toBe(false);
    expect(
      publishOfferSchema.safeParse({ productId: PRODUCT, quantity: 1, note: 'x'.repeat(201) })
        .success,
    ).toBe(false);
  });

  it('editing needs at least one field, allows zero quantity and clearing with null', () => {
    expect(editOfferSchema.safeParse({}).success).toBe(false);
    expect(editOfferSchema.safeParse({ quantity: 0 }).success).toBe(true);
    expect(editOfferSchema.safeParse({ quantity: -1 }).success).toBe(false);
    expect(editOfferSchema.safeParse({ availableUntil: null }).success).toBe(true);
    expect(editOfferSchema.safeParse({ note: null }).success).toBe(true);
  });

  it('the board query defaults to grouping by product with no filters', () => {
    expect(boardQuerySchema.parse({})).toEqual({ group: 'product', q: '', category: '' });
    expect(boardQuerySchema.parse({ group: 'producer', q: ' ous ' })).toMatchObject({
      group: 'producer',
      q: 'ous',
    });
    expect(boardQuerySchema.safeParse({ group: 'price' }).success).toBe(false);
  });
});
