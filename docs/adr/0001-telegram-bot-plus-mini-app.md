# ADR-0001: Telegram bot + Telegram Mini App as the only client

- Status: Accepted
- Date: 2026-09-17

## Context
The farmers already use Telegram; 1.0 proved that identity and notifications through the bot
work well. It also proved that building forms and lists out of inline keyboards and
self-deleting messages is fragile (see [legacy-review.md](../legacy-review.md)). We need
richer screens (board with filters, forms with validation, a chat) without asking anyone to
install an app or create an account.

## Decision
Keep Telegram as the front door and add a **Telegram Mini App** (web view served by our
server, opened from the bot) for every screen. The bot chat is reduced to: `/start`
onboarding, notifications with quick-action buttons, two admin commands.

## Consequences
- Full UI freedom (Svelte) while keeping zero-install and free identity.
- We must validate `initData` on every request ([ADR-0010](0010-auth-via-telegram-initdata.md))
  and serve the Mini App over HTTPS from a public URL.
- Mini Apps run inside Telegram's web view: we design mobile-first and follow Telegram's theme.
- The bot must stay thin; any temptation to add multi-step conversations in chat is refused.

## Alternatives considered
- **Pure bot, rebuilt properly.** Simplest infra, but the UI ceiling is low and every list is a
  paginated keyboard; chat inside the bot mixes conversations.
- **Standalone PWA.** Full control but we would own auth, push notifications and onboarding.
- **WhatsApp.** Business API approval, per-message cost, template constraints; no Mini App
  equivalent.
