# Chainward unlock: local testing and server release walkthrough

This guide explains the exact unlock lifecycle, which controls Skillerious can
see, and what changes when Chainward moves from one Windows development machine
to a hosted multi-user service.

## Short answer: who sees the administration controls?

Only the currently Torn-verified identity **Skillerious [3212954]** can see or
use the platform administration controls.

| Person | Unlock/status page | Administration navigation | `/admin` typed directly | Approve or reject request |
| --- | --- | --- | --- | --- |
| Skillerious [3212954] | Yes | Yes | Yes | Yes |
| Other connected Torn user | Yes, for their faction | No | Not found | Server rejects the action |
| Visitor without a valid connection | Connection-required state | No | Not found | Server rejects the action |

The hidden menu is only a convenience. The real boundary is on the server:

1. Chainward reads the encrypted remembered connection from an opaque browser
   session token.
2. The server calls Torn for the current profile.
3. The returned numeric Torn user ID must be exactly `3212954`.
4. The `/admin` page repeats this check before rendering.
5. Every review Server Action repeats it again before reading or changing a
   request.

Changing HTML, guessing an action URL, editing a cookie, or manually visiting
`/admin` does not grant owner access. The database `isPlatformAdmin` field is
not accepted on its own; the current Torn identity and the hard-coded owner ID
must agree.

## Local test mode (no PostgreSQL server)

"Without a server" here means no separate PostgreSQL database server. Next.js
still runs locally because it must keep the Torn key off the browser and perform
the authorization checks.

1. Copy `.env.example` to `.env.local`.
2. Leave `DATABASE_URL` empty and keep `CHAINWARD_LOCAL_TEST_MODE="true"`.
3. Run `npm install`, then `npm run dev`.
4. Open `http://localhost:3000/connect` and connect a supported Torn key.
5. Chainward automatically creates `data/chainward-local.sqlite` in the
   project. This is disposable test data and is ignored by Git.
6. The encrypted remembered Torn key is stored separately at
   `%LOCALAPPDATA%\Chainward\credentials.sqlite`. The browser holds only an
   opaque HTTP-only token. Recreating the project database therefore does not
   remove the remembered login.
7. Open **Unlock Chainward**, choose a plan, and reserve the request.
8. When connected as Skillerious, open **Administration**, review the local
   request, confirm its exact reference, tick the payment-matched confirmation,
   and activate it.
9. Refresh **Unlock Chainward**. It now shows the active term, activation date,
   expiry, and reference read from the local SQLite licence record.

Local approval uses the same owner check, exact-reference check, duplicate
licence check, expiry calculation, transaction, and audit event as PostgreSQL.
The storage engine is the intentional testing difference.

To start over, stop Chainward and remove `data/chainward-local.sqlite`. Do not
remove `%LOCALAPPDATA%\Chainward` unless the remembered login should also be
revoked. The in-app **Disconnect Torn API** action is the preferred way to
revoke it.

## What happens when a faction requests access?

1. **Identity validation.** A faction member submits a Torn API key on the
   connection page. The server validates the key with Torn and derives the
   player ID and faction ID from Torn responses, not form fields.
2. **Remembered connection.** With "Remember this browser" enabled, Chainward
   encrypts the key at rest and returns a random session token in an HTTP-only,
   SameSite cookie. The plaintext key is never returned to the page.
3. **Reference creation.** The unlock page creates a reference in the form
   `CW-{factionId}-{8 random characters}`. The server rejects a reference whose
   faction prefix does not match the currently verified faction.
4. **Request reservation.** The member selects a term and reserves it. A server
   transaction stores the faction, purchaser, term, expected Xanax amount,
   reference, and timestamp, then creates an audit event. It rejects a second
   open request or a faction that already has active access.
5. **Manual Torn transfer.** The member sends the displayed items to
   Skillerious and includes the exact reference. Chainward does not claim to
   read or perform Torn transfers automatically.
6. **Owner review.** Skillerious compares the sender, faction, item quantity,
   and reference against the Torn transfer evidence. The approval control also
   requires the exact reference to be typed and the payment check to be ticked.
7. **Transactional activation.** The server verifies Skillerious again, checks
   that the request is still open, resolves the stored plan, checks for a
   conflicting active licence, marks the request approved, creates or updates
   the licence, calculates its expiry from approval time, and writes the audit
   event in one transaction.
8. **Faction status update.** On refresh, users from that faction see the active
   access badge and licence details. They never receive the private owner note
   or administration queue.

## Releasing on a server

Use PostgreSQL for the released service. A project-local SQLite file belongs to
one machine and cannot safely coordinate multiple app instances, deployments,
or factions.

1. Provision PostgreSQL and set `DATABASE_URL` in the server's secret manager.
2. Set a strong, stable `SESSION_SECRET` in the secret manager. Do not use the
   example value and do not expose it with a `NEXT_PUBLIC_` prefix.
3. Run `npm run db:push` during the controlled deployment to apply the Prisma
   schema.
4. Build with `npm run build` and run with `npm run start` behind HTTPS.
5. Confirm the public base URL, reverse proxy, secure cookies, and backups.
6. Connect a non-owner test account and verify that Administration is absent,
   `/admin` returns not found, and a direct review attempt is rejected.
7. Connect Skillerious [3212954], submit a test request, and complete the owner
   approval path. Confirm the request, licence, reviewer, expiry, and audit event
   exist in PostgreSQL.
8. Back up PostgreSQL using the documented owner procedure before accepting
   real requests.

For remote users, a website cannot write into AppData on each visitor's PC.
Their encrypted remembered credentials live in the hosted PostgreSQL database;
their browser still stores only the opaque HTTP-only token. The AppData storage
described above is specifically for the single-device/local Chainward mode.

## Security and operational limits

- Skillerious access depends on possession of a valid Torn key for user ID
  `3212954`. Protect that Torn account and revoke/rotate the key if exposed.
- Approval is manual. The payment checkbox records Skillerious's verification;
  it is not automatic proof from Torn.
- Portable JSON workspace backups intentionally exclude credentials, licence
  approvals, private review notes, audit records, and paid-chain history.
- The local SQLite licence queue is for testing. Do not copy it into production
  as a substitute for the PostgreSQL licence register.
