# ADR-0010: Authentication via Telegram `initData`, no own accounts

- Status: Accepted
- Date: 2026-09-17

## Context
Members must never manage a password, and non-members must see nothing
([prd.md §4](../prd.md#4-principles-product-constitution)). Telegram Mini Apps receive
`initData` signed by Telegram with the bot token, which identifies the user reliably.

## Decision
Every API request carries `Authorization: tma <initDataRaw>`. The server validates the HMAC,
rejects `auth_date` older than 24 h, and maps the Telegram user to a `members` row, creating an
*applicant* if unknown. Membership status and role are checked server-side on every request.
Quick actions from the bot are authorized from `callback_query.from.id` through the same
domain guards. A dev-only bypass exists for local development and e2e tests and is disabled
in production.

## Consequences
- Zero account management; identity is as trustworthy as the user's Telegram account.
- Sessions are implicit: `initData` is re-issued by Telegram when the Mini App opens.
- The bot token becomes the root secret for both the bot and API auth; it is only in env.
- The Mini App is unusable outside Telegram except with the dev bypass, which is intended.

## Alternatives considered
- **Own sessions/JWT after a Telegram login widget.** Extra moving parts for no gain inside a
  Mini App.
- **Trusting `user` from the client.** Trivially spoofable.
