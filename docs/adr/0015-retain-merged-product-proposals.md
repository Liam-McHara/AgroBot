# ADR-0015: Archive proposals resolved into an existing sheet product

- Status: Accepted
- Date: 2026-09-17

## Context
US-2.2 lets an admin rename a pending product to match a sheet row. That row may already
have been imported as a different active product. The normalized name is unique, and PRD
§12 forbids hard deletion except for explicitly rejected products.

## Decision
Renaming to an existing active sheet product resolves into that existing product. Transfer
references through the catalogue lifecycle hook and archive the original proposal, retaining
its original name and slug. Notify the proposer and affected open-reservation requesters with
N5 in the same transaction. Renaming to a pending or archived name remains a conflict.

M2 has no offer publication or reservations, so its merge hook rejects referenced proposals
safely. M3 implements reference transfer and must refuse conflicting active offers from the
same producer rather than silently combining their quantities, notes or dates. M4 adds price
resolution for open reservations.

## Consequences
- The picker has one active product and existing product ids remain stable.
- The admin list retains the original archived proposal; sync never revives it accidentally
  unless a row with its original name actually appears in the sheet.
- A typo cannot be proposed again while its archived record owns that normalized name.

## Alternatives considered
- Delete the merged proposal: violates the data-retention principle for a resolved product.
- Refuse every active-name collision: prevents the common typo-correction workflow in US-2.2.
- Combine offers automatically: quantity, note and expiry semantics are not specified and
  must not be invented during a catalogue correction.
