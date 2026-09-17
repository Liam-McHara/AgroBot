# ADR-0013: Reuse AgroBot 1.0's bot token and username

- Status: Accepted
- Date: 2026-09-17

## Context
PRD Q4 left the bot username and Mini App short name to be created in @BotFather during M0.
But the group already talks to a bot: it is in their chat list, in their group's pinned
message, and in the habits of members who are not enthusiastic about apps. A new username means
every member must find and start a different bot on the day we cut over, and 1.0's chat history
stops being where the thing they use lives.

## Decision
2.0 runs as the **same Telegram bot as 1.0**: same username, same `BOT_TOKEN`. The Mini App is
registered as a new short name on that same bot in @BotFather. **1.0 is stopped before 2.0
starts** — one token can have exactly one consumer, and a webhook registration silently steals
updates from a polling process.

## Consequences
- Members do nothing on cutover day. The bot they already have starts answering with 2.0.
- No side-by-side pilot: 1.0 and 2.0 can never run at once, so the M6 deploy is a cutover with a
  rollback (re-point the webhook at 1.0), not a gradual migration. The runbook must say so.
- `BOT_TOKEN` is a live production secret from M0 onwards, not a throwaway. Development uses
  polling against a **separate** throwaway bot, never the group's token; the M6 runbook keeps a
  token-rotation procedure for the day it leaks.
- 1.0's old command handlers vanish the moment we cut over. `/start` in 2.0 must answer anyone
  who arrives with a stale mental model, including members whose last message to the bot was a
  1.0 order.
- ADR-0008 still governs deleting `legacy/`; this decision only shares the identity, never code.

## Alternatives considered
- **A new bot for 2.0.** Clean separation and a real side-by-side pilot, at the cost of asking
  every member to find and start a new bot — the group is small enough to do it and human
  enough to not.
- **New bot for the pilot, rename later.** Telegram lets a username be freed and re-taken, but
  the window between the two is exactly when someone else can take it. Not worth the risk.
