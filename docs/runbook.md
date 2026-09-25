# AgroBot 2.0 operations and launch

Use the same commit and commands in staging before production. This runbook is a procedure,
not evidence that a production deployment, restore or pilot has happened. Record actual
results in [launch-checklist.md](launch-checklist.md). Owner: the group's deployment admin.

## Configuration and first deployment

Follow README's first-time setup and ARCH §13. Keep separate bots, Hyperdrives and Neon branches
for staging and production. Use Node from `.nvmrc`. Keep credentials in GitHub Environment
secrets or git-ignored environment files, never in command arguments, screenshots or issues.

1. Create the Neon `production` branch and staging branch in the selected region. Retain the
   direct connection string for migrations and the pooled one for Hyperdrive. In the Cloudflare
   dashboard create each Hyperdrive and **disable query caching** so settings, membership and
   availability reads cannot be served stale. Record non-secret resource ids in the checklist.
   See [Hyperdrive caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/).
2. Configure the `production` and `staging` GitHub Environments per README. Bootstrap the agreed
   admins with `ADMIN_TELEGRAM_IDS`. Create/share the real `Productes` tab per PRD §6, giving
   the service account read-only access. Set `GOOGLE_SHEET_ID` and `GOOGLE_SHEET_RANGE`.
3. Run all checks in [testing.md](testing.md). Protect `main` with the check job. Require the
   production Environment's deployment approval for the first cutover: CI registers the bot's
   webhook automatically, and must not run that step while 1.0 still consumes the token.
4. Staging first: merge the reviewed commit to `staging`; CI builds, migrates, deploys and
   registers the throwaway bot. Seed units and missing settings once using the direct staging
   database and production mode (no dev members):

   ```bash
   SKIP_DOTENV=1 NODE_ENV=production pnpm db:seed
   ```

   Supply `DATABASE_URL` and `ADMIN_TELEGRAM_IDS` from the protected environment. Seeding keeps
   existing settings and members. First deployment needs units before the catalogue can sync.
5. For a manual deployment, load the intended environment into the shell or use the ignored
   file for this script; neither command registers the Telegram webhook:

   ```bash
   pnpm build
   pnpm deploy:worker --env-file .env.staging --dry-run
   SKIP_DOTENV=1 pnpm db:migrate
   pnpm deploy:worker --env-file .env.staging
   ```

   Migrations use the shell's direct `DATABASE_URL`, not the deploy script's env-file option.
   For production use `.env.production` and the production resource ids. Custom domains are
   attached in Cloudflare and `PUBLIC_URL` must match the HTTPS origin, including socket origin.
6. Open `/health` and verify the commit. On the throwaway bot `/start`, `/status`, `/sync` must
   work; open the Mini App, publish/reserve/chat/deliver as two staging members. Confirm the
   real sheet sync result and notification delivery. Record version ids, UTC time and results.

## Worker rollback drill

In staging record the current and previous compatible Worker versions. From `apps/server`:

```bash
pnpm exec wrangler deployments list --name agrobot-staging
pnpm exec wrangler rollback --name agrobot-staging
```

Confirm the selected version before accepting the CLI prompt. Verify `/health` commit,
`/status`, an existing reservation/thread, and a notification; then redeploy the intended
commit and repeat. Record both versions and outcomes. Production uses `--name agrobot`.
Rollback changes Worker code, not Postgres data or migrations. Migrations stay forward-only;
check schema compatibility first. See [Cloudflare rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/).

## Staging point-in-time restore drill

Never rehearse on production or with the live bot. In staging record a UTC timestamp T and
counts/ids of representative members, products, offers, reservations and messages. Make an
identifiable test change after T. Within the configured restore window (ARCH §15 assumes six
hours), create a **new Neon branch from staging at T** using the Neon console, leaving the
source branch intact. Verify the pre-T records exist and the later change does not on the
restored branch. Record branch ids and T, never connection strings.

Pause staging traffic and its deployment workflow while switching. In Cloudflare's staging
Hyperdrive configuration change the origin to the restored branch's pooled connection,
keeping query caching disabled. Restart open Mini Apps and verify `/status`, catalogue counts,
an existing thread and a reservation operation against the restored data. The hub's schedule
is not part of Postgres restore: save a valid setting to wake deadlines, then `/sync` to re-arm
the periodic schedule. Check outbox rows before waking: restored `queued` rows can resend a
notification, which is why the drill uses the throwaway bot.

Re-point staging Hyperdrive to its original branch, wake/re-sync again, and verify it. Retain
the restored branch only as long as needed to review evidence and account for its storage.
If the timestamp is no longer recoverable, record a failed drill and repeat inside the actual
window; never mark the restore task done from a local database test.

## Production bot cutover and rollback to 1.0

Preserve the original 1.0 host, MongoDB, environment and startup command through the pilot.
Rehearse with the throwaway identity first. ADR-0019 corrects ADR-0013's rollback detail: the
preserved 1.0 bot polls; its incomplete Netlify function cannot restore the application.

1. Prepare the production Worker, database, units and real catalogue, and register the Mini App
   short name on the **existing** bot in BotFather with the production `PUBLIC_URL`. Verify
   the planned member roster and admins. Stage the onboarding text from `launch.onboarding`
   in both shared catalogues with the real app link; the group admin sends it at launch.
2. Stop the 1.0 process on its original host and disable its automatic restart. Record evidence
   that it is stopped. Then release the gated production deploy or, with the production
   secrets loaded and dotenv disabled, run `SKIP_DOTENV=1 pnpm bot:set-webhook` once.
3. Verify webhook delivery, `/start` for an admin and a member, approval, the real sheet sync,
   and the two-party offer/reservation/chat/delivery flow. Verify `/status` counts and version.
   Approve only the roster agreed by the group, using Members or pre-approvals.
4. If cutover fails, freeze new 2.0 activity and disable automatic production deploys. Remove
   the Worker's `BOT_TOKEN` secret in Cloudflare to stop its API and hub dispatch while retaining
   the token in the operator's protected environment. Do not delete the hub or database.
5. Delete the webhook **without dropping updates**, then start the original 1.0 polling process:

   ```bash
   node --env-file=.env.production --input-type=module <<'JS'
   const token = process.env.BOT_TOKEN;
   if (!token) throw new Error('BOT_TOKEN is required');
   const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
     method: 'POST', headers: { 'content-type': 'application/json' },
     body: JSON.stringify({ drop_pending_updates: false }),
   });
   const result = await response.json();
   if (!result.ok) throw new Error('Webhook deletion failed; inspect Telegram status');
   console.log('Webhook deleted; start the original polling consumer now.');
   JS
   ```

   Verify a 1.0 command on the original host; re-point or remove the Mini App entry while 2.0
   is unavailable. Record unresolved 2.0 reservations for manual reconciliation, not deletion.
   Returning to 2.0 requires stopping 1.0 again, restoring Worker secrets and registering the
   webhook. Record the rehearsal and the actual cutover separately.

## Rotate a bot token or webhook secret

Freeze deployments and stop the current consumer. Revoke/regenerate the token in BotFather;
put the replacement in the correct GitHub Environment secret and protected operator file.
Deploy the Worker secrets with `pnpm deploy:worker`, then `pnpm bot:set-webhook`. No old process
may restart with the replacement. Existing initData was signed by the old token: members must
close and reopen the Mini App. Verify `/health`, `/start`, `/status`, a fresh Mini App session
and an outbox delivery. For webhook-secret rotation, update the Worker secret first and
register the same value with Telegram next; expect retries during that short gap.

To disable optional Sentry, delete `SENTRY_DSN` with Wrangler/Cloudflare and remove it from CI;
omitting it from a deployment file alone does not remove an existing Worker secret.

## Catalogue and notifications

Use Admin → Catalogue → Sync now or `/sync`. Inspect persisted row diagnostics; correct the
sheet or its permissions and retry. A failed/empty sync preserves the previous catalogue.
Use `/status` for member, offer, pending-reservation counts, last sync and version. An unexpected
API error shows a reference in its toast and `error.requestId`; search Workers Logs for it.

For a stuck notification inspect only its id, kind, status, attempts, next attempt and error
in Neon's SQL editor. A Telegram 429 is already retried at `retry_after`; do not override it.
A 403 needs the recipient to unblock/start the bot before a retry. Fix token/network/rendering
failures first. Outbox delivery is at least once: a send can succeed just before a DB failure.
Never blindly requeue sent rows. To retry one confirmed failed row:

```sql
BEGIN;
SELECT id, kind, status, attempts, next_attempt_at, error
FROM notifications WHERE id = '<reviewed notification uuid>' FOR UPDATE;
UPDATE notifications SET status = 'queued', attempts = 0,
  next_attempt_at = now(), error = NULL
WHERE id = '<reviewed notification uuid>' AND status = 'failed';
COMMIT;
```

Then use Admin → Settings to change a reminder value and save, and restore its previous value
and save. Both commits call `hub.wake()`; this does not change existing expiry timestamps.
Confirm a `notifications.dispatch` log and the row becoming sent, retaining the dedupe key.
Record the id and reason for the manual retry without copying notification bodies into issues.

## Re-arm the hub

The 15-minute cron calls `ensureArmed()` and never queries Postgres. Check that the cron and
the single `AgroBotHub` binding exist. `/sync` runs in the hub and arms its next alarm in
`finally`; a settings save wakes all deadline jobs. Use these supported paths and inspect the
subsequent job logs. A changed reminder should not remain scheduled at its old time. If jobs
continue failing, fix the named configuration/database error; do not repeatedly force retries.
Never delete/recreate the hub to clear a fault: that loses tickets, counters and schedule state.

## Pilot and weekly budgets

Run a seven-day pilot after the recorded production cutover. Admins gather feedback daily and
triage into GitHub issues: P1 means incorrect availability/data loss, access-control failure,
or an unusable core flow; assign an owner and reproduce immediately. Record a private roster
approval check, successful real-sheet sync, deploy/rollback/restore evidence and daily metrics
in the checklist. Do not put the roster, bot credentials or private chats in public issues.

Use Cloudflare analytics for Worker request totals and CPU time, Durable Object requests and
duration, Hyperdrive query totals; use Neon usage for CU-hours and storage. Check each pilot
day, then weekly; include the peak day, not only averages. Exclude free static-asset requests.
The launch acceptance thresholds derived from ARCH §15 are:

| Metric | Launch threshold |
|---|---|
| Worker requests | <25,000/day |
| Worker CPU | <2.5 ms per request for measured core flows, with peak/p95 recorded against the 10 ms cap |
| Hub requests | <25,000/day |
| Hub duration | <3,250 GB-s/day |
| Hyperdrive queries | <25,000/day |
| Neon compute | Pilot projection <25 CU-hours/month (and comfortably below 100) |
| Neon storage | <0.125 GB |

Record the actual plan limits from the dashboards too; if a provider changed its plan, update
ARCH §15 and the launch thresholds explicitly. Project compute as usage per pilot day × days
in the billing month, including idle time. Investigate frequent wakeups first. At a quarter
of a cap, triage and pause launch acceptance; the owner may choose the documented Workers Paid
escape hatch, which changes the zero-cost requirement and must be an explicit decision.

After a stable week, no open P1, and every acceptance item evidenced: tag the last commit with
`legacy/` as `v1-legacy`, remove that folder in its own reviewed commit, bump all workspace
versions consistently to `2.0.0`, run every check, merge and tag the release `v2.0.0`. Keep the
original 1.0 operational backup until rollback retention is explicitly ended. Do not create
either tag or delete legacy merely because repository tests pass.
