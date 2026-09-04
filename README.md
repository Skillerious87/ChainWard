# Chainward

Chainward is a third-party Torn faction chain operations platform. Operational
screens show verified Torn API data or an explicit unavailable state; they do
not fall back to demonstration records.

> Chainward is an independent community tool and is not affiliated with or
> endorsed by Torn.

## Run locally

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`. The in-app connection screen validates
   a restricted key directly; a shared server-wide Torn key is deliberately
   never accepted as a browser identity. A production
   deployment must set separate `SESSION_SECRET` and
   `API_KEY_ENCRYPTION_SECRET` values; local development can leave both empty
   and use stable, separate machine-private secrets in AppData.
3. Run `npm run dev`.
4. Open `http://localhost:3000/dashboard`.
5. Connect the Torn API. The temporary testing database is created
   automatically in the project when PostgreSQL is not configured.

### Fully offline test mode

After dependencies are installed, Chainward can exercise its complete local
connection, licence, navigation, chain, member, reward, and payout flows without
internet access or a Torn key:

1. Run `npm run dev:offline`.
2. Open `http://localhost:3000/connect`.
3. Choose **Faction tester** to submit an unlock request.
4. Disconnect, return to the offline test panel, and choose **Owner reviewer**
   to approve that request in Administration.
5. Reconnect as **Faction tester**. The previously locked operational pages are
   now available with deterministic, clearly labelled fixture data.

Offline identity buttons exist only in the development server. A production
build ignores `CHAINWARD_OFFLINE_TEST_MODE`, so the fixture cannot become an
authentication or owner-access bypass after deployment. No Google-hosted font
or other runtime asset is required for local rendering.

Local test mode creates a real SQLite file at `data/chainward-local.sqlite` by
default. Set `CHAINWARD_LOCAL_DB_PATH` to choose another location. No Docker
installation is required for this single-device mode.

The `/connect` form validates a key directly against Torn. In local mode it
stores the encrypted key in `%LOCALAPPDATA%\Chainward\credentials.sqlite`, not
inside the repository. The browser receives only a random, HTTP-only, SameSite
session token. Users can opt into a temporary 12-hour session instead, and
**Disconnect Torn API** revokes remembered sessions and credentials. Never
prefix `SESSION_SECRET` or `API_KEY_ENCRYPTION_SECRET` with `NEXT_PUBLIC_`, and never commit
`.env.local`.

## Storage and backups

Chainward supports two storage modes:

- **Local SQLite** is created automatically during local testing. The project
  file stores unlock requests and licences, reward schemes, workspace settings,
  and immutable paid-chain acknowledgements. Encrypted Torn credentials are
  kept separately in the operating-system AppData directory so recreating the
  test database does not remove the remembered login.
- **PostgreSQL** is the shared/hosted option and also supports platform-wide
  licensing and administration records. Open **Settings → PostgreSQL** to enter
  and test a local or hosted server, then copy the generated `DATABASE_URL`.
  The password is kept only in the current tab and is never written to browser
  storage. To start the included Docker service, run `npm run db:local`, add the
  copied value to `.env.local`, run `npm run db:push`, and restart Chainward.

**Settings → Live operations** controls automatic refresh frequency and the
active-chain timeout warning. Background refresh continues while Chainward
remains open and online; active chains use an uncached 5-second check, and
manual refresh also requests a fresh Torn chain snapshot.

## Device notifications

Users can enable standards-based Web Push under **Settings → Device alerts**.
Permission is requested only after the user presses **Enable device
notifications**. Android and desktop browsers can subscribe directly. On iOS
and iPadOS 16.4 or later, install Chainward with Safari's **Add to Home Screen**
first and enable notifications from that installed web app.

The once-per-minute authenticated worker sends chain-warning and final-minute
critical alerts to the current scheduled primary/backup watcher, or to all
subscribed operators when no watch slot is active. Authorised faction managers
can also receive critical-only or full member-review alerts, with watch-list,
expired-holiday, quiet-hour, deduplication, reminder, and interval controls.
The service worker can show these alerts while Chainward is closed, provided
the browser or installed web app is still permitted to run notifications.

Hosted deployments require HTTPS, PostgreSQL, and a scheduler
for `/api/notifications/dispatch`; `vercel.json` configures a one-minute Vercel
cron. `CRON_SECRET` is strongly recommended; a durable one-run-per-minute
database reservation bounds safe operation when it is absent. Push endpoints
and browser key material are encrypted at rest. Delivery
event keys are stored separately to suppress duplicates across cron retries.
Every member dispatch rechecks stored faction roles before including member
activity. Each current roster member also has a
source-labelled personnel report at `/members/{tornUserId}`. Authorised member
managers can add append-only faction or leadership reports and assign/revoke
recognition badges; Torn roster facts remain visually separate from these
Chainward-authored records.

Every verified roster check also reconciles a durable inactivity-period log.
A period qualifies after 24 continuous hours without a Torn action and retains
the inferred start, first and last observation, return timestamp, peak duration,
and any holiday/watch context. The member workspace summarises repeat members,
average and longest gaps, and typical start weekdays; the complete period log
can be exported as CSV and each personnel report carries its own timeline. This
fixed 24-hour history is intentionally independent of the changeable owner alert
threshold, so policy changes do not rewrite prior patterns.

The Members route is split into focused **Overview**, **Roster**, **Patterns**,
and **Controls** views. Long roster, period, pattern, and management-history
lists are paginated, while notification links open the relevant roster filter
directly.

Settings can download and restore portable faction-configuration backups. The
JSON file contains reward schemes and selected workspace settings. It excludes
API credentials, licence records, payment acknowledgements, audit records, and
cached Torn responses. Restore imports missing scheme versions without
overwriting paid-chain history.

When Chainward is hosted remotely, “local” means the server that runs the app;
a website cannot write a database onto an unrelated visitor’s computer. When
you run Chainward on your own device, the server and device are the same.

## Production deployment

Before exposing Chainward to other users:

1. Configure shared PostgreSQL with `DATABASE_URL`, run `npm run db:push`, and
   do not use the local SQLite backend across multiple instances.
2. Generate separate random values of at least 32 bytes for `SESSION_SECRET`,
   `API_KEY_ENCRYPTION_SECRET`, and `CRON_SECRET`.
3. Set `CHAINWARD_PUBLIC_ORIGIN` to the canonical HTTPS origin and list every
   accepted browser origin in `CHAINWARD_ALLOWED_ORIGINS`. Vercel can derive
   the canonical origin from its system environment when the explicit value is
   absent, but setting it remains recommended for portable deployments.
4. Keep `CHAINWARD_OFFLINE_TEST_MODE=false`. Enable
   `CHAINWARD_TRUST_PROXY_HEADERS` only when the trusted proxy overwrites those
   headers and direct origin access is blocked.
5. Add provider/WAF rate limits in front of the application and run
   `npm run check:full` against the exact release commit.

The local backend uses Node's release-candidate `node:sqlite` API and can emit
an `ExperimentalWarning` in development. Chainward loads that module only when
local SQLite is actually opened, so a PostgreSQL deployment does not activate
the local-only runtime. See [`docs/abuse-protection.md`](docs/abuse-protection.md)
for the application and edge-rate-limit boundary.

For a complete PostgreSQL snapshot, including licensing and payout history:

```powershell
npm run db:backup
npm run db:restore -- -BackupPath .\backups\chainward-full-YYYYMMDD-HHMMSS.dump
```

Full PostgreSQL restore is destructive, accepts only `.dump` files inside the
workspace `backups` directory, and requires typing `RESTORE` unless `-Force` is
supplied.

## Quality checks

```bash
npm run check           # lint, TypeScript, unit tests, production build
npm run verify:offline  # 90 end-to-end assertions with no network access
npm run check:full      # both of the above
```

`npm run verify:offline` starts its own development server on port 3123 in a
separate build directory, so it can run while `npm run dev` is already open. It
opens offline member and owner sessions, checks that the licence gate blocks an
unlicensed faction, grants access through the real licensing store, then
requests every operational route and asserts the offline data labelling,
telemetry API, and request hardening. It resets only the fixture faction's
records, so a connected real faction is untouched.

Architecture and current Torn API findings are documented in
[`docs/architecture.md`](docs/architecture.md) and
[`docs/torn-api.md`](docs/torn-api.md). The complete licensing and reward-payment
procedure is in [`docs/owner-operations.md`](docs/owner-operations.md). The
local-to-release unlock walkthrough is in
[`docs/unlock-release-walkthrough.md`](docs/unlock-release-walkthrough.md), and
the latest security findings and residual risks are in
[`docs/security-audit.md`](docs/security-audit.md). The API, efficiency, and
interface review is in
[`docs/api-and-efficiency-audit.md`](docs/api-and-efficiency-audit.md).
