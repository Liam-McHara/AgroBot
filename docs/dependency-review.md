# M6 dependency and escaping review

Reviewed 2026-09-25, with the workspace lockfile. `legacy/` remains outside tooling.

`pnpm audit --json` reported **one moderate**, zero high and zero critical advisories:

| Path | Finding | Disposition |
|---|---|---|
| `drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild` | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99), development server CORS; fixed in esbuild ≥0.25 | Accepted for this release: this transitive CLI loader uses transformation, not `esbuild.serve`. It is excluded from the Worker bundle. Do not expose Drizzle Studio or an esbuild dev server. Review again when upgrading drizzle-kit; avoid forcing a breaking esbuild version into its old loader. |

The deployed runtime dependencies had no findings in that audit. Sentry's Cloudflare SDK is
locked in `pnpm-lock.yaml`; no browser tracking was added. It runs only when configured and
removes request content, identities and arbitrary error text before sending. Errors retain
stack locations, release and correlation metadata; tracing, logs and metrics are disabled.

Audit reports are time-sensitive: run `pnpm audit` again at release and inspect the separate
CI audit job's summary. Do not treat this file as a perpetual clean bill of health.

All Telegram HTML renderers N1–N12, `/start`, and edited quick-action outcomes were inspected:
member names, usernames, product names, notes, reasons and chat previews pass through the
single `escapeHtml` helper before interpolation. `/status` and `/sync` use plain text.
Buttons carry validated ids in callback data or URL-encoded start parameters. Existing helper
and renderer tests cover markup in names, products, cancellation reasons and chat previews.
The hardening suite also tests byte limits before parsing/auth, exact member counters,
thread-scoped counters, retry headers and private error envelopes.
