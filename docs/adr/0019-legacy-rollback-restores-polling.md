# ADR-0019: Restore polling when rolling back to the preserved 1.0 bot

- Status: Accepted
- Date: 2026-09-25
- Supersedes the rollback mechanism in [ADR-0013](0013-reuse-the-1-0-bot-identity.md).

## Context
ADR-0013 says to roll back by pointing the webhook at 1.0. The preserved implementation
calls `bot.launch()` without webhook options (`legacy/src/globals.ts`), and its Netlify
function implements only `/start`. Registering that function would not restore ordering.

## Decision
The default rollback stops 2.0 consumption and notification dispatch, deletes the Telegram
webhook without dropping pending updates, then starts the preserved 1.0 polling process on
its original host and MongoDB. If the actual deployed 1.0 differs, record and rehearse that
deployment's working procedure before cutover. Never run both consumers together.

## Consequences
- The rollback needs the original 1.0 host, environment and MongoDB, retained through the pilot.
- The incomplete Netlify function is not a rollback target.
- 2.0 reservations remain in Postgres for reconciliation; no reverse data migration is implied.
- ADR-0013's shared identity and stop-before-start rules remain unchanged.

## Alternatives considered
- Point at the preserved Netlify function: it cannot handle the farmers' orders.
- Add webhook support to 1.0: extends frozen legacy code, outside the rewrite's scope.
