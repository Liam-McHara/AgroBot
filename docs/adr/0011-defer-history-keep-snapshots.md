# ADR-0011: Defer history/reporting but snapshot prices and keep records

- Status: Accepted
- Date: 2026-09-17

## Context
Reporting (per-farmer totals, settlement, CSV) was considered and deferred to keep 2.0 small.
Adding it later is cheap only if the data is already there.

## Decision
2.0 ships **no history or reporting screens** beyond the last 30 days of closed reservations
in *My reservations*. The data model nevertheless **snapshots `unit_price_cents`** on every
reservation, keeps every reservation, message and notification row (status-based, no hard
deletes except admin-rejected pending products), and records `closed_by`, timestamps and
reasons.

## Consequences
- Reports and settlement can be built on existing data without migration.
- Storage growth is negligible at this scale.
- Users see a simple app now.

## Alternatives considered
- **Include personal history and a settlement view in 2.0.** Valuable, but pushes the first
  usable release later; explicitly on the backlog ([prd.md §11](../prd.md#11-out-of-scope-for-20-backlog)).
