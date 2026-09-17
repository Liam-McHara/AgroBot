# ADR-0014: Confirm-and-deliver as one Mini App action, not a quick action

- Status: Accepted
- Date: 2026-09-17

## Context
ADR-0004's lifecycle assumes the confirmation and the handover happen at different times, which
is true when a reservation is arranged in advance. It is false for the common case these
farmers actually live: someone reserves two crates while standing at the stall and takes them
away thirty seconds later. The producer then confirms and delivers back to back, and PRD Q6
asked whether that should be one action.

## Decision
Add **confirm and deliver** as a single producer action on the reservation screen of the Mini
App, valid only while the reservation is *pending*. It performs the `confirm` and `deliver`
side effects in one transaction: both system lines are written, the quantity is deducted, and
the requester receives one delivered notification rather than two. The Telegram quick actions
on N6/N7 stay *Confirm* / *Reject* / *Open*.

This does **not** supersede ADR-0004. No state, guard or transition is removed, and no new edge
is added to the state machine: the reservation still passes through `confirmed`, just inside one
request.

## Consequences
- The face-to-face case takes one tap instead of two, in the place where the consequences are
  on screen.
- Delivery is terminal and deducts quantity. Keeping it out of the notification keyboard means
  it cannot be triggered by a thumb aimed at *Confirm* on a phone in a coat pocket — which is
  why this is a Mini App action and not a third button.
- One more compound path to test: the domain gets its own unit test, and the M4 e2e covers it
  next to the two-step path.
- Notification rendering gains a case (confirmed+delivered reads as delivered), so N8's
  renderer must not assume the previous status was `confirmed` at the time the outbox row was
  written.

## Alternatives considered
- **Two taps always** (the PRD's default). Simplest, and the state machine already supports it,
  but it makes the app slower than the transaction it is recording.
- **A third quick action on N6.** Fastest of all and the one most likely to deliver a crate that
  never moved; irreversible actions deserve a screen.
- **A new `pending → delivered` edge.** Would save a row in the transitions table and lose the
  `confirmed_at` timestamp that every reservation currently has.
