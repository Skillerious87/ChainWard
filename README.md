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

**Settings → Live operations** controls visible-tab refresh frequency and the
active-chain timeout warning. Background refresh pauses while the tab is hidden
or offline; active chains use an uncached 10-second check and manual refresh
also requests a fresh Torn chain snapshot.

## Member notifications

Faction Administrators and the platform owner can enable native notifications
under **Settings → Member alerts**. Permission is requested only after the user
presses **Enable Windows notifications**. The monitor supports critical-only or
full review alerts, watch-list and expired-holiday controls, quiet hours,
deduplicated reminders, and a five-to-sixty-minute check interval.

Hosted deployments must use HTTPS for notification permission and service
workers. Localhost is treated as a secure development context by supported
browsers. Monitoring continues when the Chainward tab is in the background,
but the browser must remain running with the site open; this is deliberately a
same-origin browser monitor, not a third-party push service that can wake a
closed browser. Every monitor request rechecks the active licence and the
operator's `members:manage` permission. Each current roster member also has a
source-labelled personnel report at `/members/{tornUserId}`. Authorised member
managers can add append-only faction or leadership reports and assign/revoke
recognition badges; Torn roster facts remain visually separate from these
Chainward-authored records.

Settings can download and restore portable faction-configuration backups. The
JSON file contains reward schemes and selected workspace settings. It excludes
API credentials, licence records, payment acknowledgements, audit records, and
cached Torn responses. Restore imports missing scheme versions without
overwriting paid-chain history.

When Chainward is hosted remotely, “local” means the server that runs the app;
a website cannot write a database onto an unrelated visitor’s computer. When
you run Chainward on your own device, the server and device are the same.

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
npm run verify:offline  # 65 end-to-end assertions with no network access
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
