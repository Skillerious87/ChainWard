# Shared faction API capacity

Implemented: 20 October 2026.

## Deploy

Apply the updated Prisma schema before deploying this application version:

```sh
npm run db:generate
npm run db:pool
```

`db:pool` uses the same `.env.local` / `.env` configuration as Next.js and adds
only the broker table and expiry index. The existing full-schema `db:push`
workflow also includes this model when provisioning a complete database.

The new `TornApiBrokerState` table holds encrypted contribution grants, scoped
snapshots, refresh leases, short-lived presence, quota reservations and
cooldowns. Use the same PostgreSQL database and `API_KEY_ENCRYPTION_SECRET`
across every server instance. Keys are never stored in plaintext in this table.
The authenticated encrypted payload binds the key to its owner, faction,
revision and consent options; copying ciphertext or editing those options does
not create a valid contribution.
Normal portable workspace exports exclude broker state and credentials.

Local development uses a separate coordination table in the existing private
credential SQLite database. It supports local verification and does not replace
PostgreSQL for a hosted multi-instance deployment. Shared coordination errors
fail closed; the app does not fall back to unmetered upstream requests.
Keep server clocks synchronised across instances, as with the app's existing
session and licence expiry checks.

## Players

Open **Settings > Torn connection > Shared faction API capacity**. Create a
separate **Public Only** Torn API key and enter it there. Choose 1-10
contribution calls per minute, read the disclosure and explicitly accept it.
Limited, Full and Custom keys are rejected as contributions. A separate key
isolates access but does not increase a player's Torn quota.

By default, contributions require a visible, connected Chainward session.
Presence expires after 45 seconds without a heartbeat. Offline contributions
and background push monitoring each require an additional explicit choice.
Background permission also requires offline permission.

Existing users are unenrolled. No login key is automatically added to the pool.
Owners can view recent usage and remove their contribution without changing
their login. Removal deletes the encrypted contribution material and leaves a
revocation marker. Disconnect, login-key replacement, a changed faction, or a
confirmed roster departure also invalidate the grant. Work already dispatched
to Torn cannot be recalled.

## Behaviour

- Common faction identity, roster, chain, chain history and chain reports share
  snapshots across authorised viewers and instances. Permission-dependent and
  unknown fields are removed before shared storage.
- The identity of a viewer comes from their own verified session. Faction
  licence, assignment and current roster membership are checked before pooled
  data is returned. Donor permissions never become viewer permissions.
- Each viewer's own login key is independently revalidated at least every
  minute of pooled use. A valid donor cannot keep an invalid, paused or
  faction-mismatched login key working. Identity checks use the viewer's own
  allowance, never another player's key.
- Concurrent polls, manual sync and push reads share a durable refresh lease.
  An active chain needs at most one refresh every five seconds per faction.
  There is no foreground polling worker when nobody requests a feature.
- Eligible contributors are selected by usage relative to their cap, then last
  use. A donor's owner and faction are rechecked at least every 60 seconds of
  continued use. Each attempt checks current grant version and presence.
- Without an eligible contributor, a foreground request may use its own
  player's key under the same total budget. Background workers cannot borrow
  an arbitrary saved login key; they require a suitable contribution grant.
- Private battle stats, attacks, events and identity checks retain the owner's
  key. Pool keys are never forwarded to FFScouter or another service.
- Authenticated attempts reserve a shared rolling-minute allowance: 30
  Chainward calls per player across all their credentials, including at most
  their chosen contribution cap. The service also has a conservative aggregate
  allowance of 240 calls per minute. These are application limits, not promises
  about spare Torn quota or a published Torn IP allowance.
- Initial identity verification has a separate small bootstrap allowance until
  the key owner is known. Those attempts are then attributed to the player's
  usage; creating another key does not reset an identified player's budget.
- Player/daily limits cause owner-wide cooldowns. IP blocks stop all egress.
  Invalid and paused credentials stop being selected. Long `Retry-After`
  values are persisted; web workers do not sleep through them or retry early.
- The official HTTPS Torn API is the only permitted destination for coordinated
  requests; redirects are refused. Offline fixtures make no upstream calls.

Other tools and Torn PDA can still consume a player's shared Torn allowance.
When calls cannot be made, operational values become unavailable rather than
being represented as fresh. The authenticated shell and contribution removal
remain usable during a telemetry outage or cooldown.

## Storage and operations

Expired coordination records are pruned during use, with a short cleanup grace
period. Grants retain acceptance version/time and options until removal;
request counters retain only the recent minute's attempt times. No raw request
bodies, private responses or API keys belong in logs.

Verification calls count towards contribution allowances too. Very small
allowances can be spent on key/membership verification rather than a data
refresh; the default allowance of 10 leaves room for both. Cooldown records can
remain until the cooldown expires, even while their visible rolling counters
have returned to zero.

An ordinary portable workspace restore cannot revive a grant because broker
state is excluded. A full PostgreSQL disaster recovery restore includes broker
state: clear contribution grants and require new acceptance after restoring a
historical database, so a later revocation cannot be undone. Back up encryption
secrets separately and limit database/decryption access.

The initial pool intentionally excludes cross-faction public targets and bulk
historical jobs. Extending operations or audience requires a new consent policy
version and explicit acceptance.

## Verification

`src/lib/torn/api-pool.test.ts` exercises concurrent reservations, shared
refreshes, scope projections, revocation races, presence expiry, cooldowns,
donor routing and failure handling against isolated SQLite stores.
`src/app/api/settings/api-pool/route.test.ts` exercises session, origin, consent,
key ownership, access tier and opt-out boundaries. Torn responses are mocked;
no real player's quota is used.

Run `npm run verify:pool:postgres` against a configured PostgreSQL deployment
to check reservations and refresh leases across database connections. It uses
randomly prefixed verification records, removes those records afterwards, and
does not contact Torn or alter player grants/counters.
