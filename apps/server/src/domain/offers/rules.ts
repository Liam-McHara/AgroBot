import {
  isDateBefore,
  normalizeProductName,
  type BoardGrouping,
  type OfferStatus,
} from '@agrobot/shared';

/**
 * The pure part of offers (PRD §7; ARCH §5 derived rules, §6 offer machine). No database, no
 * clock: these functions decide, `service.ts` applies them inside transactions.
 */

export interface OfferSnapshot {
  status: OfferStatus;
  quantity: number;
  held: number;
  /** `YYYY-MM-DD` on the farm's calendar, or none. */
  availableUntil: string | null;
}

/** ARCH §5: `quantity − held`, never stored. */
export function availableOf(offer: Pick<OfferSnapshot, 'quantity' | 'held'>): number {
  // Both sides carry at most two decimals (numeric(10,2)); rounding keeps 3 − 2.9 from being
  // 0.10000000000000009 in a JSON body.
  return Math.round((offer.quantity - offer.held) * 100) / 100;
}

/**
 * ARCH §5 board rule for one offer: active, something left, and not past its date. Whether the
 * producer is approved is the query's business, since it needs their row.
 */
export function isReservable(offer: OfferSnapshot, today: string): boolean {
  return (
    offer.status === 'active' &&
    availableOf(offer) > 0 &&
    (offer.availableUntil === null || !isDateBefore(offer.availableUntil, today))
  );
}

/**
 * ARCH §6: a producer's edit keeps an offer `active`, brings an `expired` or `withdrawn` one
 * back, and cannot make an offer active on a day its date has already passed: the calendar
 * decides, the same way the nightly job would the moment it ran.
 */
export function statusAfterEdit(availableUntil: string | null, today: string): OfferStatus {
  return availableUntil !== null && isDateBefore(availableUntil, today) ? 'expired' : 'active';
}

/**
 * PRD US-3.2, ARCH §6: an edit that puts an offer (back) on the board is a re-publish and
 * notifies the group again (N3). Lowering to zero and raising again, fixing the date of an
 * expired offer, re-activating a withdrawn one: all the same event.
 */
export function isRepublish(before: OfferSnapshot, after: OfferSnapshot, today: string): boolean {
  return !isReservable(before, today) && isReservable(after, today);
}

/** What the board needs of an offer to search, sort and group it. */
export interface BoardEntry {
  stale: boolean;
  product: {
    id: string;
    slug: string;
    name: string;
    nameEs: string | null;
    category: string | null;
  };
  producer: { id: string; displayName: string };
}

/** PRD US-3.3 text search: product (either language), producer or category, accent-blind. */
export function matchesSearch(entry: BoardEntry, query: string): boolean {
  const needle = normalizeProductName(query);
  if (needle === '') return true;
  return [
    entry.product.slug,
    normalizeProductName(entry.product.nameEs ?? ''),
    normalizeProductName(entry.producer.displayName),
    normalizeProductName(entry.product.category ?? ''),
  ].some((haystack) => haystack.includes(needle));
}

const collator = new Intl.Collator('ca', { sensitivity: 'base' });

/** PRD US-3.4: stale offers sort last; otherwise by product, then by producer. */
export function compareBoardEntries(a: BoardEntry, b: BoardEntry): number {
  if (a.stale !== b.stale) return a.stale ? 1 : -1;
  return (
    collator.compare(a.product.name, b.product.name) ||
    collator.compare(a.producer.displayName, b.producer.displayName)
  );
}

export interface BoardGroupOf<T extends BoardEntry> {
  key: string;
  name: string;
  nameEs: string | null;
  offers: T[];
}

/**
 * PRD US-3.3: group by product (default) or by producer. Entries arrive sorted; groups keep
 * that order, and a group made only of stale offers sinks to the end so "sorted last" holds
 * for the list the member actually scans.
 */
export function groupBoard<T extends BoardEntry>(
  entries: readonly T[],
  grouping: BoardGrouping,
): BoardGroupOf<T>[] {
  const groups = new Map<string, BoardGroupOf<T>>();
  for (const entry of entries) {
    const key = grouping === 'product' ? entry.product.id : entry.producer.id;
    let group = groups.get(key);
    if (!group) {
      group =
        grouping === 'product'
          ? { key, name: entry.product.name, nameEs: entry.product.nameEs, offers: [] }
          : { key, name: entry.producer.displayName, nameEs: null, offers: [] };
      groups.set(key, group);
    }
    group.offers.push(entry);
  }
  return [...groups.values()].sort((a, b) => {
    const aStale = a.offers.every((offer) => offer.stale);
    const bStale = b.offers.every((offer) => offer.stale);
    if (aStale !== bStale) return aStale ? 1 : -1;
    return collator.compare(a.name, b.name);
  });
}
