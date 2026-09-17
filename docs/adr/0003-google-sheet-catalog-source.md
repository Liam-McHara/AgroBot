# ADR-0003: Google Sheet as catalogue source, members may propose products

- Status: Accepted
- Date: 2026-09-17

## Context
The group already keeps its agreed prices in a spreadsheet. Free-text product names in 1.0
fragmented the board ("tomàquets" vs "tomates") and prices were absent. Waiting for an admin
to add a product before publishing surplus would slow farmers down at the worst moment
(harvest day).

## Decision
The Google Sheet is the **source of truth** for products, units and prices. The server syncs it
hourly and on demand, archiving products that disappear rather than deleting them. Members
may **propose** a product missing from the sheet; it is usable immediately as *price pending*
and is resolved automatically when a matching row appears in the sheet (or by an admin
renaming/rejecting it).

## Consequences
- Farmers pick, never type, product names; the board groups cleanly.
- We depend on Google API availability for changes only; the app keeps working on the last
  synced catalogue.
- Requires a service account and sharing the sheet with it (or a published-CSV fallback).
- Pending products need a small admin workflow and a "price pending" state throughout
  (offers, reservations, notifications).
- Price snapshots on reservations make later price edits harmless.

## Alternatives considered
- **Admin-managed catalogue in the app.** Duplicates the sheet the group already maintains;
  two sources of truth.
- **Manual CSV upload.** No Google integration, but one manual step per price change; kept as
  the fallback mode rather than the primary one.
- **Free text with typed prices.** The 1.0 problem, plus price disputes.
