import { describe, expect, it } from 'vitest';
import {
  availableOf,
  compareBoardEntries,
  groupBoard,
  isRepublish,
  isReservable,
  matchesSearch,
  statusAfterEdit,
  type BoardEntry,
  type OfferSnapshot,
} from './rules.js';

const TODAY = '2026-09-19';
const active = (over: Partial<OfferSnapshot> = {}): OfferSnapshot => ({
  status: 'active',
  quantity: 10,
  held: 0,
  availableUntil: null,
  ...over,
});

describe('availability (ARCH §5)', () => {
  it('is quantity minus held, rounded to the two decimals the schema stores', () => {
    expect(availableOf({ quantity: 10, held: 2.5 })).toBe(7.5);
    expect(availableOf({ quantity: 3, held: 2.9 })).toBe(0.1);
    expect(availableOf({ quantity: 2, held: 2 })).toBe(0);
  });

  it('an offer is reservable when active, with something left and not past its date', () => {
    expect(isReservable(active(), TODAY)).toBe(true);
    expect(isReservable(active({ availableUntil: TODAY }), TODAY)).toBe(true);
    expect(isReservable(active({ availableUntil: '2026-09-18' }), TODAY)).toBe(false);
    expect(isReservable(active({ held: 10 }), TODAY)).toBe(false);
    expect(isReservable(active({ quantity: 0 }), TODAY)).toBe(false);
    expect(isReservable(active({ status: 'withdrawn' }), TODAY)).toBe(false);
    expect(isReservable(active({ status: 'expired' }), TODAY)).toBe(false);
  });
});

describe('edits (PRD US-3.2, ARCH §6)', () => {
  it('leaves the calendar to decide the status after an edit', () => {
    expect(statusAfterEdit(null, TODAY)).toBe('active');
    expect(statusAfterEdit(TODAY, TODAY)).toBe('active');
    expect(statusAfterEdit('2026-09-18', TODAY)).toBe('expired');
  });

  it('detects a re-publish when an edit puts the offer back on the board', () => {
    expect(isRepublish(active({ quantity: 0 }), active({ quantity: 4 }), TODAY)).toBe(true);
    expect(isRepublish(active({ held: 10 }), active({ held: 10, quantity: 12 }), TODAY)).toBe(true);
    expect(
      isRepublish(
        active({ status: 'expired', availableUntil: '2026-09-01' }),
        active({ availableUntil: '2026-09-30' }),
        TODAY,
      ),
    ).toBe(true);
    expect(isRepublish(active({ status: 'withdrawn' }), active(), TODAY)).toBe(true);
    // Still visible before and after: an edit, not a re-publish.
    expect(isRepublish(active(), active({ quantity: 20 }), TODAY)).toBe(false);
    // Still invisible after: nothing to announce.
    expect(isRepublish(active({ quantity: 0 }), active({ quantity: 0 }), TODAY)).toBe(false);
    expect(
      isRepublish(active({ status: 'withdrawn' }), active({ availableUntil: '2026-09-01' }), TODAY),
    ).toBe(false);
  });
});

describe('board search, order and grouping (PRD US-3.3, US-3.4)', () => {
  const entry = (
    product: string,
    producer: string,
    over: Partial<BoardEntry> & { nameEs?: string | null; category?: string | null } = {},
  ): BoardEntry => ({
    stale: over.stale ?? false,
    product: {
      id: `p-${product}`,
      slug: product.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(),
      name: product,
      nameEs: over.nameEs ?? null,
      category: over.category ?? null,
    },
    producer: { id: `m-${producer}`, displayName: producer },
  });

  it('matches product names in both languages, producers and categories, ignoring accents', () => {
    const e = entry('Tomàquet', 'Marta Puig', { nameEs: 'Tomate', category: 'Hortalisses' });
    expect(matchesSearch(e, '')).toBe(true);
    expect(matchesSearch(e, 'TOMAQUET')).toBe(true);
    expect(matchesSearch(e, 'tomate')).toBe(true);
    expect(matchesSearch(e, 'puig')).toBe(true);
    expect(matchesSearch(e, 'hortalisses')).toBe(true);
    expect(matchesSearch(e, 'ous')).toBe(false);
  });

  it('sorts stale offers last, then by product and producer', () => {
    const sorted = [
      entry('Pastanaga', 'Anna', { stale: true }),
      entry('Tomàquet', 'Pere'),
      entry('Albergínia', 'Marta'),
      entry('Tomàquet', 'Anna'),
    ].sort(compareBoardEntries);
    expect(sorted.map((e) => `${e.product.name}/${e.producer.displayName}`)).toEqual([
      'Albergínia/Marta',
      'Tomàquet/Anna',
      'Tomàquet/Pere',
      'Pastanaga/Anna',
    ]);
  });

  it('groups by product with the Spanish name, or by producer, sinking stale-only groups', () => {
    const entries = [
      entry('Albergínia', 'Marta', { nameEs: 'Berenjena' }),
      entry('Tomàquet', 'Anna'),
      entry('Tomàquet', 'Pere'),
      entry('Pastanaga', 'Anna', { stale: true }),
    ].sort(compareBoardEntries);

    const byProduct = groupBoard(entries, 'product');
    expect(byProduct.map((g) => [g.name, g.nameEs, g.offers.length])).toEqual([
      ['Albergínia', 'Berenjena', 1],
      ['Tomàquet', null, 2],
      ['Pastanaga', null, 1],
    ]);

    const byProducer = groupBoard(entries, 'producer');
    expect(byProducer.map((g) => [g.name, g.offers.map((o) => o.product.name)])).toEqual([
      ['Anna', ['Tomàquet', 'Pastanaga']],
      ['Marta', ['Albergínia']],
      ['Pere', ['Tomàquet']],
    ]);
    expect(byProducer.every((g) => g.nameEs === null)).toBe(true);
  });
});
