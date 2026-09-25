# Verification and flaky-test policy

Use Node from `.nvmrc`, `pnpm install --frozen-lockfile`, and a dedicated Postgres 16 database
whose name ends in `_test`. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then
`pnpm e2e` are required. CI sets `CI=1`, so unavailable Postgres is a failure, never a skip.
Locally set `TEST_DATABASE_URL` for a database other than Docker's default. Do not run the
integration and e2e suites concurrently: both reset the test database.

The full Playwright suite runs in CI on every PR and push to `main`/`staging`, on the built
Mini App served by workerd with a real hub, a fresh database and a fake Telegram API. Coverage
includes membership and last-admin protection, catalogue proposals and sync, live offers,
reservations and bot quick actions, chat and notifications, and runtime admin settings.

The scenarios deliberately share a database and run with one worker. Membership approves the
requester that offers/reservations/chat use; thread builds on reservations. Run `pnpm e2e`
to reproduce the full setup. The admin settings spec restores its settings in `finally`.

Retries are **zero** locally and in CI. A retry after a partial mutation would reuse dirty
state and could hide a failure. `failOnFlakyTests` is enabled in CI as a second guard against
future retry overrides. CI retains every report and any failure traces for seven days;
traces contain test identities only, never production initData or tokens.

When a test flakes:

1. Keep its first failure and trace. Record the commit, failing assertion, runtime version and
   reproduction in a GitHub issue. Inspect with `pnpm exec playwright show-trace <trace.zip>`.
2. Reproduce the whole suite from its fresh database and hub. Distinguish application races
   from test readiness assumptions. Use observable states and Playwright assertions, not sleeps.
3. Fix the underlying race or readiness check in the same PR with relevant regression coverage.
   An unexplained passing rerun is not evidence that the failure is fixed.
4. Do not add retries, silently skip coverage, or raise timeouts simply to merge. An exceptional
   quarantine needs an owner, issue, expiry date and equivalent verified coverage, reviewed by
   the maintainer. P1 launch paths cannot be quarantined for release.

`pnpm audit` remains a separate non-blocking CI report. Review new findings before each release;
record affected paths and actual exposure in [dependency-review.md](dependency-review.md).
