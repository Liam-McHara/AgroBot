# ADR-0005: In-app chat per reservation, native DM as optional shortcut

- Status: Accepted
- Date: 2026-09-17

## Context
Coordinating a delivery is a conversation about one specific reservation. 1.0 sent
`tg://user?id=` links, which fail when the other person's privacy settings hide them, and
nothing about the arrangement was recorded next to the order.

## Decision
Every reservation owns a **private thread** inside the Mini App between requester and
producer, with the reservation context (product, quantity, price, status, actions) pinned in
the header and status changes inserted as system lines. New messages are pushed live over
SSE and, when the recipient is not looking, trigger one Telegram notification per unread
burst. If the counterpart has a public `@username`, an **Open in Telegram** button is offered
as a shortcut. Admins cannot read threads.

## Consequences
- The conversation and its context never separate; several reservations with the same person
  do not mix.
- We implement messaging (storage, read markers, SSE, throttled notifications), a moderate
  amount of work covered by roadmap M5.
- Threads become read-only some days after the reservation closes, so old conversations do
  not accumulate activity.
- Native DM remains available when it works, without being a dependency.

## Alternatives considered
- **Relay messages through the bot.** No Mini App needed for chat, but conversations mix in
  one chat window and quoting context is clumsy.
- **Deep link only (1.0).** Zero code, unreliable, nothing tracked.
