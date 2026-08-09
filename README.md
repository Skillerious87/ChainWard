# Chainward

Chainward is a third-party Torn faction chain operations platform. Operational
screens show verified Torn API data or an explicit unavailable state; they do
not fall back to demonstration records.

> Chainward is an independent community tool and is not affiliated with or
> endorsed by Torn.

## Run locally

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and replace `SESSION_SECRET` with at
   least 32 random characters. `TORN_API_KEY` is optional because the in-app
   connection screen can validate a restricted key directly.
3. Run `npm run dev`.
4. Open `http://localhost:3000/dashboard`.
5. Connect the Torn API, then open **Settings → Storage & backups** and press
   **Create local database**.

That button creates a real SQLite file at `data/chainward-local.sqlite` by
default. Set `CHAINWARD_LOCAL_DB_PATH` to choose another server-side location.
No Docker installation is required for this single-device mode.

The `/connect` form validates a key directly against Torn. By default it stores
the key encrypted at rest on the server for 30 days and gives the browser only
a random, HTTP-only, SameSite session token. Users can opt into a temporary
12-hour session instead, and **Disconnect Torn API** revokes remembered sessions
and credentials. Never prefix `SESSION_SECRET` or `TORN_API_KEY` with
`NEXT_PUBLIC_`, and never commit `.env.local`.

## Storage and backups

Chainward supports two storage modes:

- **Local SQLite** is created when remembered access or local workspace storage
  is first requested. It stores encrypted remembered credentials, reward
  schemes, their versions, workspace settings, and immutable paid-chain
  acknowledgements on the machine running Chainward.
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
procedure is in [`docs/owner-operations.md`](docs/owner-operations.md).
