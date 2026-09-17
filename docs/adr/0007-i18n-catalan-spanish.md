# ADR-0007: Catalan and Spanish from day one through one message catalogue

- Status: Accepted
- Date: 2026-09-17

## Context
1.0 hard-coded Catalan strings across files. Members of the group speak Catalan and Spanish;
notifications, quick actions and screens must all be understandable to everyone, and adding a
language later is painful if strings are scattered.

## Decision
All user-facing strings, for the bot and the Mini App, live in **one message catalogue** in
`packages/shared/src/messages/{ca,es}.json` with typed keys and a tiny `t(key, params)` using
`Intl.PluralRules`/`Intl.NumberFormat`/`Intl.DateTimeFormat`. Each member has a `language`
(`ca`/`es`), defaulted from Telegram's `language_code`. A build step fails when the catalogues
diverge or a key is missing.

## Consequences
- Both languages are always complete; no "real" language in code.
- Server renders notifications and API error messages in the recipient's language; the Mini
  App renders its UI from the same files.
- Adding a third language is adding one JSON file.
- A small custom `t()` instead of a framework keeps the toolchain simple; if ICU message
  complexity grows, swapping to a library is localized to one module.

## Alternatives considered
- **Catalan only.** Excludes part of the group.
- **@grammyjs/i18n + a separate frontend i18n lib.** Two catalogues to keep in sync.
- **Paraglide / typesafe-i18n.** Good tools, but compile steps and framework coupling for
  ~200 strings is more than needed.
