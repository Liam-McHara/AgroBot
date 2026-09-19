# AgroBot 2.0 — Product Requirements

| | |
|---|---|
| Status | **Draft for implementation** (decisions taken 2026-09-17, hosting revised 2026-09-18, see [ADRs](adr/README.md)) |
| Owner | Guillem (product), implementation via Claude Code sessions |
| Related | [architecture.md](architecture.md) · [roadmap.md](roadmap.md) · [legacy-review.md](legacy-review.md) |

## 1. Vision

A private tool for a group of farmers to share their surplus with each other.
At any moment a member can see **what the others are offering and how much is left**,
**reserve part or all of it**, and **talk privately with the producer** to arrange delivery.
Prices are not negotiated in the app: they come from the price list the group already
maintains in a Google Sheet.

AgroBot lives inside Telegram. Members never install anything: the bot greets them and
notifies them, and a Telegram Mini App (a web view inside Telegram) provides the screens.

### Goals for 2.0

1. Replace the 1.0 prototype with something the group can rely on daily.
2. Make the board trustworthy: consistent product names, units and prices; availability that
   is always correct, even when two people reserve at the same time.
3. Make reservations a clear process with a beginning and an end (confirmed, delivered,
   cancelled, expired), so nobody is left guessing.
4. Keep the conversation about a delivery attached to the reservation it concerns.
5. Give admins the few tools they need: who is in, sync the catalogue, resolve pending
   products, tune a handful of settings.

### Non-goals for 2.0 (explicitly deferred, see §11)

Payments, settlement or balances; history and reports; several independent groups; photos;
ratings; anything outside Telegram.

## 2. Users and roles

| Role | Who | Can |
|---|---|---|
| **Applicant** | Anyone who opened the bot and pressed *Start* but is not approved | See a "waiting for approval" screen. Nothing else. |
| **Member** | An approved farmer | Everything in §5–§8: browse, offer, reserve, chat, manage own settings. |
| **Admin** | A member with the admin role | Everything a member can, plus §9: approve members, sync catalogue, resolve pending products, edit settings, promote other admins. |
| **Suspended** | A member an admin has suspended | Same as applicant. Their existing offers are hidden; open reservations continue to be visible to the other party until closed. |

There is exactly **one group** per deployment. The first admins are bootstrapped from
configuration (`ADMIN_TELEGRAM_IDS`).

## 3. Glossary

| Term | Meaning |
|---|---|
| **Product** | A catalogue entry: name (Catalan, optional Spanish), unit, price per unit, optional category. Comes from the Google Sheet, or is *pending* when proposed by a member and not yet in the sheet. |
| **Unit** | How a product is measured: `kg`, `unit`, `box`, `bunch`, `dozen`, `litre`. Each unit says whether decimals are allowed and the input step. |
| **Offer** | "I, producer X, have Q units of product P available" plus an optional *available until* date and a note. |
| **Available quantity** | Offer quantity minus quantities currently held by *pending* and *confirmed* reservations on it. |
| **Reservation** | A member (the *requester*) asks the *producer* for a quantity of an offer. It holds that quantity from creation until it reaches a terminal state. |
| **Thread** | The private conversation attached to one reservation, between requester and producer only. |
| **Board** | The screen listing all currently reservable offers. |
| **Quick action** | A button on a Telegram notification that performs one action (confirm, reject, still available…) without opening the Mini App. |

## 4. Principles (product constitution)

These are not features. Any feature that violates one needs an ADR.

1. **Telegram is the identity; the Mini App is the UI.** No separate login, no passwords. The bot chat is for greetings, notifications and quick actions, never for multi-step forms.
2. **Availability is never wrong.** All quantity changes happen in a database transaction. If the board says 3 kg are available, reserving 3 kg cannot fail because someone else got there first without the UI saying so.
3. **Every reservation ends.** Pending ones expire; nothing lingers indefinitely.
4. **Nobody outside the group sees anything.** Every request is authenticated with Telegram's signed init data; non-members get a closed door, not a read-only view.
5. **Prices are facts, not fields.** Members never type a price. The sheet is the source of truth; reservations snapshot the price at the moment of reserving.
6. **Speak the member's language.** Every user-facing string exists in Catalan and Spanish. No language is the "real" one in code.
7. **Notify the concerned, not everyone.** Group-wide pings only for new offers. Everything else goes to the two people involved.
8. **Small group, boring tech.** Around a hundred members, a few hundred offers. One service, one database, no queues, no microservices.

## 5. Onboarding and membership

### US-1.1 Apply to join
**As** a farmer who received the bot link, **I** press *Start* **so that** I can ask to be let in.

- Given the user is unknown, pressing *Start* creates them as *applicant*, replies in the
  language of their Telegram client (`ca` or `es`, default `ca`) that the request has been
  sent, and notifies all admins with *Approve* / *Reject* quick actions. Opening the Mini App
  directly (for example from a forwarded deep link) applies the same way: the applicant is
  created, admins are notified once, and the app shows the "waiting" screen.
- Given the user is already an applicant, *Start* repeats the "waiting" message; no new
  notification to admins.
- Given the user's Telegram id or `@username` is in the pre-approved list (US-1.3) or in
  `ADMIN_TELEGRAM_IDS`, they are approved immediately (and made admin in the second case).
  This also applies to an applicant who is still waiting when the list or the configuration
  starts covering them. It never re-approves someone rejected or suspended: those decisions
  belong to an admin (US-1.2, US-1.4).
- Given the user is a member, *Start* shows the welcome message with an *Open AgroBot* button.
- Given the user was rejected or is suspended, *Start* says so briefly and points to the
  group's admins. `/help` (and any other text sent to the bot) explains that everything
  happens in the Mini App.

### US-1.2 Approve or reject applicants
**As** an admin **I** review applicants **so that** only farmers of the group get in.

- Admin sees pending applicants in the Mini App (name, username, applied at) and in the
  notification's quick actions.
- Approving sends the applicant a welcome message with the *Open AgroBot* button.
- Rejecting sends a polite message; the record is kept so a repeat *Start* does not re-notify
  admins (the applicant sees "your request was not accepted").

### US-1.3 Pre-approve by username or id
**As** an admin **I** add `@username` or a Telegram id **so that** a known farmer is approved
the moment they press *Start*.

- Usernames are matched case-insensitively, with or without the `@`. Each pre-approval is
  consumed by the first person it matches and is then shown as used.
- If the person is already waiting as an applicant, adding them approves them at once (with
  the welcome message, N2). If they are already a member, the addition is refused.

### US-1.4 Suspend, reinstate, promote
**As** an admin **I** can suspend a member, reinstate them, or make them admin.
- Suspending hides their offers from the board and blocks all their API calls with a
  "suspended" screen. Their open reservations stay visible to the counterpart, who can cancel.
- The last approved admin cannot be suspended or demoted, by themself or by anyone; the
  group is never left without an admin. Promotion requires an approved member.

### US-1.5 Language and profile
**As** a member **I** pick my language (`ca`/`es`) and my display name **so that** the app and
notifications speak to me the way I want.
- Default language from Telegram's `language_code` (`es*` → `es`, anything else → `ca`).
- Display name defaults to Telegram first + last name; editable; 2–40 characters.

## 6. Catalogue (products and prices)

### US-2.1 Catalogue synced from the group's Google Sheet
**As** an admin **I** connect the group's price sheet once **so that** products and prices in
the app are always the ones the group agreed on.

- The group keeps one tab named **`Productes`** with the columns below, shared **read-only with
  the server's Google service account** (`GOOGLE_SERVICE_ACCOUNT_JSON`). A published-CSV URL with
  the same columns is a supported fallback (`CATALOG_SOURCE=csv`) for groups that would rather not
  manage a key; it makes the sheet readable by anyone holding the URL.
- The server reads the configured sheet **hourly** and whenever an admin taps **Sync now**.
- Expected columns (header row, order free, headers accepted in Catalan, Spanish or English):

  | Column | Required | Rules |
  |---|---|---|
  | `Producte` / `Producto` / `Product` | yes | 2–60 chars. Trimmed. Case- and accent-insensitive uniqueness. |
  | `Unitat` / `Unidad` / `Unit` | yes | One of the unit codes or their `ca`/`es` names (`kg`, `unitat`/`unidad`, `caixa`/`caja`, `manat`/`manojo`, `dotzena`/`docena`, `litre`/`litro`). |
  | `Preu` / `Precio` / `Price` | yes | Decimal, `,` or `.` separator, in EUR, ≥ 0. |
  | `Categoria` / `Categoría` / `Category` | no | Free text, 1–40 chars. |
  | `Producto (es)` / `Nom es` / `Name es` | no | Spanish name shown to `es` members; falls back to the main name. |

- Prices have at most two decimal places (no thousands separators), up to EUR 21,474,836.47
  (the integer-cent storage limit). Optional Spanish names follow the main name length rules.
- Duplicate normalized names invalidate every occurrence; duplicate aliases for one header
  reject the sheet. Blank rows are ignored but still count toward sheet row numbers.
- Rows with errors are skipped and reported (row number + reason); valid rows are still
  applied. A sheet with **zero** valid rows is rejected entirely (protects against a broken
  sheet wiping the catalogue). A recognizable name on an invalid row preserves that existing
  product unchanged; only names absent from the sheet are archived.
- Products present in the app but missing from the sheet are **archived**: hidden from the
  product picker, but existing offers and reservations keep working and show the product.
  Re-adding the row un-archives it.
- Price or unit changes apply to new reservations only; existing reservations keep their
  snapshot. Changing the unit of a product that has active offers is reported as a warning.
- Repeating unchanged input preserves validation errors and performs no product writes.
  Pending proposals must still be resolved even if the sheet content has not changed.
- Each sync is logged (when, rows read, created/updated/archived, errors) and the last result
  is visible to admins.

### US-2.2 Propose a product that is not in the sheet
**As** a member **I** offer a product the sheet does not have yet **so that** I do not have to
wait for an admin before publishing surplus.

- In the product picker, when the search finds nothing, "Propose «tomàquet cor de bou»"
  creates a **pending** product with the unit I choose and **no price**.
- Offers on pending products appear on the board with a "price pending" badge instead of a
  price. They can be reserved; the reservation's price snapshot is empty until the product is
  resolved, at which point open (pending/confirmed) reservations receive the price.
- Admins are notified once per proposal, with the exact name to paste into the sheet. A
  repeated proposal by its owner returns the same product; a name already used by another
  product is a conflict (including another member's pending proposal).
- On the next sync, a sheet row whose normalized name equals the pending product's name
  resolves it (status active, price set). An admin can also **rename** a pending product to
  match a sheet row, or **reject** it (offers on it are withdrawn, their reservations
  cancelled, everybody involved notified). Renaming to an existing active sheet product
  resolves the proposal into that product and archives the original proposal (ADR-0015).
  A name belonging to another pending or archived
  product is a conflict. Renaming to a new name stays pending until the next matching sync.

## 7. Offers and the board

### US-3.1 Publish an offer
**As** a producer **I** publish "Q of product P" **so that** the others can reserve it.

- Fields: product (search in active + my pending products), quantity (> 0, respects the unit's
  step: integers for `unit`/`box`/`bunch`/`dozen`, one decimal for `kg`/`litre`), optional
  *available until* (date, today or later), optional note (≤ 200 chars).
- One **active** offer per (producer, product). Publishing again for the same product opens
  the existing offer for editing instead.
- Publishing notifies every other member (US-6.1) unless the group setting
  `notify_new_offer` is off.

### US-3.2 Edit or withdraw an offer
- Quantity can be raised freely and lowered down to the currently held quantity (pending +
  confirmed). Lower than that is refused with a clear message.
- Date and note editable any time. Removing the date is allowed.
- **Withdraw** hides the offer immediately. Open reservations on it stay valid and must be
  resolved one by one; the producer is reminded of them at withdrawal time.
- An offer whose available quantity reaches 0 is shown to its producer as *fully reserved*
  and disappears from the others' board; it comes back if quantity is raised or a reservation
  is cancelled/rejected/expired. Raising the quantity of a fully-reserved or expired offer
  back above 0 counts as a re-publish and notifies the group again.

### US-3.3 Browse the board
**As** a member **I** open the app **so that** I see everything I can reserve right now.

- Lists offers from **other** members that are active, not expired, and have available
  quantity > 0. My own offers are in *My offers*, not on the board.
- Each row: product name (in my language), available quantity + unit, price per unit (or
  *price pending*), producer display name, *available until* if set, a *stale* marker if the
  offer is unconfirmed (US-3.4).
- Group by product (default) or by producer; text search; filter by category.
- Refreshes live while open (WebSocket, ADR-0017); pull-to-refresh as fallback.

### US-3.4 Offers do not go stale silently
- Offers past their *available until* date become **expired** at the start of the next day
  (Europe/Madrid) and leave the board. Open reservations on them stay valid.
- Offers **without** a date that have not been created, edited or confirmed for
  `offer_nudge_days` (default 7) trigger a nudge to the producer: "Still available?" with quick
  actions *Yes, still available* / *Withdraw*. *Yes* resets the counter.
- If there is no answer after `offer_stale_days_after_nudge` (default 3), the offer is marked
  **stale**: still reservable, but sorted last and badged, so requesters know to ask first.
  The nudge repeats weekly while stale.

## 8. Reservations and chat

### US-4.1 Reserve
**As** a member **I** reserve a quantity of someone else's offer **so that** it is set aside
for me.

- Quantity > 0, ≤ available, respects the unit step. Cannot reserve my own offer, an offer
  from a suspended producer, or an expired/withdrawn offer.
- Creating the reservation holds the quantity atomically. If someone else took it first, the
  API returns the new available quantity and the UI offers to reserve that instead.
- The reservation starts **pending**, snapshots the unit price, and gets an `expires_at` of now
  + `reservation_expiry_hours` (default 48).
- The producer is notified with *Confirm* / *Reject* / *Open* quick actions. The requester
  sees the reservation in *My reservations → outgoing* and its thread opens.

### US-4.2 Confirm or reject (producer)
- Only while pending. Confirming moves to **confirmed** and clears `expires_at`. Rejecting
  (optional reason, ≤ 200 chars) moves to **rejected** and releases the quantity.
- Both actions notify the requester and add a system line to the thread.

### US-4.3 Cancel (either party)
- Requester: while pending or confirmed. Producer: while confirmed (while pending they reject
  instead). Optional reason. Releases the quantity, notifies the other party, system line.

### US-4.4 Deliver (either party)
- Only while confirmed. Marks **delivered** (terminal), deducts the quantity permanently from
  the offer (so it stops being "held" and becomes "gone"), notifies the other party.
- **Confirm and deliver in one action (producer, Mini App only).** On the reservation screen a
  producer holding a *pending* reservation can *confirm and mark delivered* for a handover that
  already happened face to face. It runs both transitions in one transaction, writes both system
  lines and sends the requester a single delivered notification. The bot quick actions stay
  *Confirm* / *Reject* / *Open*: a one-tap irreversible delivery from a notification is too easy
  to hit by accident.

### US-4.5 Pending reservations expire
- `reservation_reminder_hours_before_expiry` (default 12) before `expires_at`, the producer is
  reminded with the same quick actions.
- At `expires_at`, still-pending reservations become **expired**, release the quantity, notify
  both parties.

### US-4.6 See my reservations
- Two tabs: **incoming** (I am the producer) and **outgoing** (I am the requester); each split
  into *active* (pending, confirmed) and *closed* (delivered, rejected, cancelled, expired,
  last 30 days). Rows show product, quantity, price snapshot and total, counterpart, status,
  unread messages badge.

### US-5.1 Chat inside the reservation
**As** either party **I** exchange messages in the reservation's thread **so that** we agree on
when and where, with the details always in front of us.

- Header always shows: product, quantity + unit, unit price and total (or *price pending*),
  status, counterpart's display name, and the reservation's actions available to me.
- Text messages, 1–2000 chars. Sent messages appear instantly for both if both are online
  (WebSocket); otherwise the recipient gets **one** Telegram notification per unread burst (no new
  notification until they open the thread), with an *Open* button that deep-links to the thread.
- Status changes appear as system lines in the thread ("Marta confirmed the reservation").
- The thread is writable while the reservation is active and for `thread_readonly_days_after_close`
  (default 7) days after it closes; then read-only.
- Admins **cannot** read threads.

### US-5.2 Optional native Telegram conversation
- If the counterpart has a public `@username`, the header shows **Open in Telegram**
  (`https://t.me/<username>`). Otherwise the button is not shown (tg://user links are
  unreliable without a username and were a dead end in 1.0).

## 9. Notifications (through the bot)

All notifications are sent in the recipient's language, are short, and carry a button that
opens the relevant screen of the Mini App.

| # | Event | Recipients | Quick actions |
|---|---|---|---|
| N1 | New applicant | all admins | Approve · Reject |
| N2 | Approved / rejected | applicant | Open AgroBot (on approval) |
| N3 | New offer published or re-published | all members except the producer (if `notify_new_offer`) | Open offer |
| N4 | Product proposed | all admins | Open pending products |
| N5 | Product resolved / rejected | proposer, plus requesters of open reservations on it | Open |
| N6 | Reservation created | producer | Confirm · Reject · Open |
| N7 | Reservation about to expire | producer | Confirm · Reject · Open |
| N8 | Reservation confirmed / rejected / cancelled / delivered / expired | the other party (both on expiry) | Open |
| N9 | New chat message (throttled, US-5.1) | the other party | Open thread |
| N10 | Offer nudge "still available?" | producer | Yes · Withdraw |
| N11 | Offer withdrawn with open reservations | producer (reminder list) | Open reservations |
| N12 | Catalogue sync failed (zero valid rows / unreachable) | all admins | Open catalogue |

Quick actions are idempotent and verify the actor's permission server-side; a stale button
(e.g. confirming an already-cancelled reservation) answers with a short explanation instead of
failing silently.

## 10. Admin area (Mini App tab visible to admins)

- **Members**: applicants (approve/reject), members (suspend/reinstate/promote/demote),
  pre-approvals (add/remove `@username` or id).
- **Catalogue**: last sync status and errors, *Sync now*, list of products with status,
  pending products with *rename* / *reject* and the exact text to paste in the sheet, link to
  the sheet.
- **Settings** (group-wide, with defaults):

  | Key | Default | Meaning |
  |---|---|---|
  | `reservation_expiry_hours` | 48 | Pending reservations expire after this. |
  | `reservation_reminder_hours_before_expiry` | 12 | Producer reminder before expiry. |
  | `offer_nudge_days` | 7 | Days of inactivity before "still available?". |
  | `offer_stale_days_after_nudge` | 3 | Days without answer before marking stale. |
  | `thread_readonly_days_after_close` | 7 | Chat stays writable this long after closing. |
  | `notify_new_offer` | true | Group-wide ping on new offers. |

- Emergency bot commands for admins only: `/sync` (run catalogue sync, reply with result) and
  `/status` (members count, active offers, pending reservations, last sync, app version).

## 11. Out of scope for 2.0 (backlog)

Kept in the data model where cheap (price snapshots, timestamps) so they can be added later:

- History and reporting: personal history beyond 30 days, per-farmer totals, settlement
  view, CSV export.
- Daily digest instead of instant new-offer alerts.
- Photos on offers; voice notes in threads.
- Several groups in one deployment.
- Multiple offers of the same product per producer (e.g. different qualities).
- Member-to-member direct chat outside a reservation.
- Auto-expiring stale offers (2.0 only badges them).
- Migration of 1.0 data (decided: start clean).

## 12. Non-functional requirements

| Area | Requirement |
|---|---|
| Scale | ≤ 100 members, ≤ 500 active offers, ≤ 50 reservations/day. Request-driven Worker plus exactly one Durable Object instance for jobs and realtime (ADR-0017). |
| Latency | Board and reservation actions < 500 ms server time on the target hosting, excluding the database wake-up after five idle minutes (about 0.5–1 s on Neon's free plan, ADR-0016); chat message fan-out < 1 s. |
| Availability | Best effort. A deploy loses nothing: all state in Postgres, sockets reconnect, alarms persist, Telegram retries webhooks. |
| Cost | Zero. Every component runs within the Workers Free plan and Neon's Free plan (ADR-0016); the runbook checks the daily caps and the Workers Paid plan is the documented escape hatch. |
| Security | Mini App requests authenticated via Telegram `initData` HMAC with the bot token, `auth_date` ≤ 24 h. Webhook protected by secret token. Realtime socket opened with a single-use 30 s ticket, never with `initData` in a URL. All authorization server-side. Secrets only as Worker secrets or the local `.env`. |
| Privacy | Stored personal data: Telegram id, username, first/last name, chosen display name, language. Threads visible only to the two parties. No analytics trackers. |
| i18n | `ca` and `es` complete at every release; missing key fails the build. Dates and numbers formatted per locale; timezone Europe/Madrid for display; UTC in storage. Currency EUR. |
| Accessibility / UX | Mobile-first, follows Telegram theme colours (light/dark), touch targets ≥ 44 px, works on the Telegram desktop client too. |
| Observability | Structured JSON logs with request ids in Workers Logs (3 days of retention on the free plan), `/health` endpoint, error tracking hook (Sentry-compatible, optional). |
| Quality | Strict TypeScript, lint, unit tests for domain rules, integration tests against real Postgres, e2e tests of the main flows against the real runtime (`wrangler dev`), CI required on every PR. |
| Data | Nothing is hard-deleted except by explicit admin action on rejected products that nothing references yet (a rejected product with offers or reservations is archived instead, ADR-0018); everything else is status-based. Backups are Neon's point-in-time restore, a six-hour window on the free plan and no off-site copy (ADR-0016); the M6 restore drill proves it. |

## 13. Open questions

**None open.** Q1–Q6 were answered on 2026-09-17; each answer now lives in the section it
governs, and the rows were deleted per the workflow in `docs/README.md`. Where to find them:

| # | Question | Answer, and where it lives |
|---|---|---|
| Q1 | Exact Google Sheet: id, tab name, columns. | New tab `Productes` with the columns in §6. Id is deployment config (`GOOGLE_SHEET_ID`, ARCH §13). |
| Q2 | Sheet access: service account or published CSV. | Service account; CSV kept as fallback. §6, ARCH §11. |
| Q3 | Hosting provider. | Cloudflare Workers + one Durable Object, Neon Postgres through Hyperdrive, all on free plans. ARCH §15, ADR-0016 (supersedes ADR-0012), ADR-0017. |
| Q4 | Bot username and Mini App short name. | Reuse AgroBot 1.0's bot and token; 1.0 stops before 2.0 goes live. ARCH §13, ADR-0013. |
| Q5 | Quantity steps: constants or configurable. | Per-unit constants, as specified in §7 US-3.1. |
| Q6 | Producer *confirm and deliver* in one tap. | Yes, but only in the Mini App. §8 US-4.4, ARCH §6, ADR-0014. |

New questions are added back to this section with a default, and resolved the same way.
