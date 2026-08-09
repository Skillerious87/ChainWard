# Chainward

Chainward is a third-party Torn faction chain operations platform. Operational
screens show verified Torn API data or an explicit unavailable state; they do
not fall back to demonstration records.

> Chainward is an independent community tool and is not affiliated with or
> endorsed by Torn.

## Run locally

1. Run `npm install`.
2. Copy `.env.example` to `.env.local`. `TORN_API_KEY` is optional because the
   in-app connection screen validates a restricted key directly. A production
   deployment must replace `SESSION_SECRET`; local development can leave it
   empty and use the stable machine-private secret in AppData.
3. Run `npm run dev`.
4. Open `http://localhost:3000/dashboard`.
5. Connect the Torn API. The temporary testing database is created
   automatically in the project when PostgreSQL is not configured.

Local test mode creates a real SQLite file at `data/chainward-local.sqlite` by
default. Set `CHAINWARD_LOCAL_DB_PATH` to choose another location. No Docker
installation is required for this single-device mode.

The `/connect` form validates a key directly against Torn. In local mode it
stores the encrypted key in `%LOCALAPPDATA%\Chainward\credentials.sqlite`, not
inside the repository. The browser receives only a random, HTTP-only, SameSite
session token. Users can opt into a temporary 12-hour session instead, and
**Disconnect Torn API** revokes remembered sessions and credentials. Never
prefix `SESSION_SECRET` or `TORN_API_KEY` with `NEXT_PUBLIC_`, and never commit
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
or offline; manual refresh always requests a fresh Torn snapshot.

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
npm run check
```

Architecture and current Torn API findings are documented in
[`docs/architecture.md`](docs/architecture.md) and
[`docs/torn-api.md`](docs/torn-api.md). The complete licensing and reward-payment
procedure is in [`docs/owner-operations.md`](docs/owner-operations.md). The
local-to-release unlock walkthrough is in
[`docs/unlock-release-walkthrough.md`](docs/unlock-release-walkthrough.md).
