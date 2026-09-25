# M6 launch evidence

M6 is **not complete** until every operational row below has real evidence. Repository
implementation and fixture-based tests do not demonstrate a live production deployment.
Keep personal rosters and credentials in the group's private records, linking only access-safe
evidence here. Use UTC timestamps and immutable commit/version ids.

## Verified baseline, 2026-09-25

- M5 base: `00211badbc758cdf9d742acb86fbca72a21cfd6c` on `main`.
- [M5 workflow 35525035052](https://github.com/Liam-McHara/AgroBot/actions/runs/35525035052):
  the production deploy failed at migration because `DATABASE_URL` was missing. This is not
  evidence that 2.0 is deployed. The `production` GitHub Environment exists, but its variables
  and secrets lists were empty when inspected. Repository-level credentials, if configured
  later, must be verified with the deployment owner rather than inferred from local dev files.
- The local test environment uses a disposable Postgres 16 database, fake Telegram and CSV
  fixtures; its success does not satisfy the real-sheet, real-members or platform-budget rows.

## Operator record

| Acceptance item | Status | Evidence to record |
|---|---|---|
| Production resources and secrets | Pending owner configuration | Worker, Neon branch and Hyperdrive ids, origin, plan limits; never secret values |
| Real `Productes` tab and service-account access | Pending | Sheet identifier, approved sharing check, sync id/status and count |
| Admins and complete group roster approved | Pending | Private roster verification by group owner, counts and UTC time |
| Deploy and smoke test | Pending | CI run, SHA, Worker version, `/health`, `/status`, two-party flow results |
| Worker rollback rehearsal | Pending | Before/after version ids, reservation/data checks, recovery deployment |
| Neon timestamp restore against staging | Pending | T, source/restored branch ids, before/after marker checks, Hyperdrive switch and return |
| 1.0 stopped before 2.0 webhook registration | Pending | Original process/host record, stop time, restart disabled, webhook verification time |
| 1.0 rollback rehearsal | Pending | Delete-webhook then polling procedure per ADR-0019, original MongoDB/host retained |
| Onboarding message delivered by group admin | Pending | Date, audience and language; draft in shared `launch.onboarding` key |
| Seven-day pilot | Not started / not evidenced | Start and end dates, daily feedback issue links and owners |
| Free-plan metrics below launch thresholds | Pending pilot | Peak daily figures, measurement definitions, Neon monthly projection, actual plan limits |
| No open P1 after the week | Pending pilot | Issue query and triage sign-off at pilot end |
| CI green on released `main`, e2e included | Pending merge/deploy | Successful workflow for the actual release SHA |
| Legacy removal and `v2.0.0` | Deferred until stable week | `v1-legacy` tag, removal commit, version bump, release tag |

Procedures: [runbook.md](runbook.md). Reproduction and flake policy: [testing.md](testing.md).
Dependency findings: [dependency-review.md](dependency-review.md).
