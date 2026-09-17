# AgroBot 1.0 review

_Read this to understand where 2.0 comes from. It is a record of the prototype under
[`../legacy/`](../legacy/), the problems found, and the lessons the 2.0 specification builds on._

## What 1.0 did

| Area | Behaviour in 1.0 |
|---|---|
| Client | Telegram bot only (Telegraf 4), commands + inline keyboards, Catalan strings hard-coded in `src/msgs.ts`. |
| Storage | MongoDB via Mongoose. `User` documents embed the user's `offers`; `Order` documents reference producer, recipient and the embedded offer id. |
| Registration | Anyone who typed the word `registre` was created as a user. The "you are not on the list" message existed but nothing enforced a list. |
| Offers | `/o <product> <amount>`: free-text product name, integer amount, amount `0` deleted the offer. No units, no prices, no expiry. |
| Board | One "main message" per user in their private chat with the bot, listing all offers grouped by producer, with two buttons: *Oferir* and *Demanar*. On every change the bot **deleted and re-sent** the main message to **every** user. |
| Ordering | In-memory `orderSteps[tgId]` wizard: pick producer → pick product → type amount. The order decremented the producer's offer, saved an `Order`, and notified both parties with `tg://user?id=` links so they could DM each other natively. |
| Housekeeping | Every incoming message was deleted after 3 seconds; bot replies auto-deleted after 15–30 seconds to keep the chat clean. |
| Hosting | Long polling from a Node process; a half-finished Netlify Function (`netlify/functions/update.ts`) that only answers `/start`. |

## What worked and is worth keeping

- **Telegram as the front door.** Farmers already have it, identity is free, notifications are free.
- **A single always-current view of what is available.** The idea of one board everybody sees is the core of the product.
- **Reserving decrements availability immediately.** Prevents two people counting on the same crate.
- **Notify both sides and let them talk.** The hand-off to a private conversation is the right moment to stop automating.
- **Keeping the chat clean** (temporary messages) shows care for the user; 2.0 achieves the same by moving the UI into a Mini App instead of juggling message deletions.

## Problems found

1. **No access control.** The allowlist was never implemented; `registre` registered anyone.
2. **Wizard state in memory.** `orderSteps` is a process-global array indexed by Telegram id. A restart, a second instance, or a serverless cold start loses every in-progress order. `orderSteps.splice(tgId, 1)` also removes the wrong element (it treats the id as an array index).
3. **O(users) Telegram calls per change.** Every offer edit deletes and re-sends one message per registered user. That is 2·N API calls, hits Telegram rate limits at a few dozen users, and spams everyone's chat.
4. **Free-text products.** "tomàquets", "Tomaquets" and "tomates" are three products. No unit, no price, no way to link to the price list the group already maintains.
5. **No reservation lifecycle.** An order is final the moment it is created: no confirmation, no cancellation, no delivered state, nothing happens if the producer never answers.
6. **Chat depends on Telegram privacy settings.** `tg://user?id=` links only work if the other person allows it; otherwise the notification is a dead end and nothing about the conversation is recorded.
7. **Silent failures.** Most handlers catch errors and `console.error` them (one catch logs an empty string), so the user sees nothing when something breaks.
8. **No tests, no lint, `strict: false`, no README**, `.env` conventions undocumented, compiled `update.js` committed next to its source.
9. **MarkdownV2 escaping done by hand** across several files, a common source of "can't parse entities" failures.
10. **Deployment story unresolved.** Long polling and a webhook stub coexisted; neither was documented.

## Lessons carried into 2.0

| Lesson | Where 2.0 applies it |
|---|---|
| Identity via Telegram, UI elsewhere | Mini App for all screens; the bot only greets, notifies and offers quick actions. [ADR-0001](adr/0001-telegram-bot-plus-mini-app.md) |
| Persist every bit of state | All state in Postgres; the server is stateless apart from live SSE connections. [ADR-0002](adr/0002-single-node-service-postgres.md) |
| Push only what changed, to whom it concerns | Targeted notifications through an outbox; the board is pulled on demand and refreshed over SSE. [ADR-0009](adr/0009-notification-outbox-and-sse.md) |
| Shared catalogue with units and prices | Products come from the group's Google Sheet; farmers pick, never type, product names. [ADR-0003](adr/0003-google-sheet-catalog-source.md) |
| Reservations are a process, not an event | Explicit state machine with confirmation, cancellation, delivery and expiry. [ADR-0004](adr/0004-reservation-lifecycle.md) |
| Conversation belongs to the reservation | In-app thread per reservation, native DM as an optional shortcut. [ADR-0005](adr/0005-in-app-chat-per-reservation.md) |
| Errors must reach the user | Typed error codes on the API, localized error toasts, structured server logs. [architecture.md](architecture.md#error-handling) |
| Engineering hygiene from day one | Strict TypeScript, lint, unit + integration + e2e tests, CI, one documented deployment path. [roadmap.md](roadmap.md#m0--foundation) |
