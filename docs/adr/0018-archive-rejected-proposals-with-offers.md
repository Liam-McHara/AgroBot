# ADR-0018: Archive rejected proposals that offers reference, delete the rest

- Status: Accepted
- Date: 2026-09-19

## Context
PRD US-2.2 lets an admin reject a pending product; PRD §12 makes that the one case of hard
deletion, and ARCH §6 wrote it as `pending → (deleted)` with the product's offers withdrawn
and its reservations cancelled. From M3 a member can publish an offer on their own pending
product before an admin looks at it, and from M4 others can reserve it. Those rows reference
the product with `ON DELETE RESTRICT`, so the delete cannot happen while they exist, and
deleting them too would erase the reservations and threads of real people, which PRD §12
keeps status-based.

## Decision
Rejecting a pending product withdraws its active offers (M3) and cancels its open reservations
(M4), notifies everybody involved (N5), and then:

- **deletes** the product when nothing references it, as before;
- **archives** it otherwise, under a tombstone slug (`<slug> [rejected <id prefix>]`) that no
  sheet row can ever match. Its name and Spanish name are kept, so the withdrawn offers and
  the cancelled reservations still show what they were about; its normalized name is free
  again, so the same proposal can be made once more, corrected or not.

## Consequences
- A rejection never loses a record that a member can still open; the admin list shows the
  archived proposal like any archived product.
- The sync cannot revive a rejected product by accident: its slug is not a normalized name.
- The tombstone is visible in the slug only, which the API does not expose.
- ARCH §6's product machine gains `pending → archived (rejected, referenced)` next to the
  merge case of ADR-0015; PRD §12 says "hard-deleted when unreferenced".

## Alternatives considered
- **Cascade-delete offers, reservations and messages with the product.** Simplest, and what
  the original wording implied, but it deletes other people's history for an admin decision
  about a name.
- **Always archive, never delete.** One path instead of two, but an unreferenced typo would
  then block its own normalized name forever (the ADR-0015 caveat) with nothing to show for it.
- **Keep the slug and archive.** Blocks the corrected re-proposal of the same name, which is
  the common reason to reject in the first place.
