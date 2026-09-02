# Chainward architecture

Last reviewed: 8 August 2026

## Product boundary

Chainward is a third-party, multi-tenant faction operations service. Torn is the
source of truth for chain and membership facts. Chainward is the source of truth
for faction-specific reward policy, calculation snapshots, payout workflow,
licensing, roles, inactivity observations, and audit events.

The application never claims that marking a payout paid transfers an item or
currency in Torn. Chainward's selected Torn endpoints are read-only.

## Runtime shape

```text
Next.js server components / route handlers
  ├─ authorization + tenant context
  ├─ application services
  │    ├─ FactionSyncService
  │    ├─ ChainProcessingService
  │    ├─ RewardEngine
  │    └─ LicensingService
  ├─ TornClient (server only)
  └─ Prisma 7 + PostgreSQL
```

React components do not call Torn directly. Persistent credentials are decrypted
only immediately before a server-side request. The Torn client sends them in the
`Authorization: ApiKey …` header, validates responses with Zod, deduplicates
concurrent reads, applies endpoint-specific cache durations, and translates
upstream errors into safe application states.

## Tenant isolation

Faction-owned rows contain a required `factionId` wherever direct scoping is
useful. A request must establish all three of the following server-side:

1. an authenticated user;
2. an active membership in the selected faction;
3. the permission required by the operation.

Resource identifiers never replace tenant predicates. For example, a payout
lookup is conceptually `where: { id: payoutId, factionId: context.factionId }`,
not `where: { id: payoutId }` followed by client-side filtering. Platform
administration is a separate user capability rather than a faction role.

## Reward invariants

- Tier bounds are inclusive.
- An upper bound of `null` means infinity.
- Enabled ranges may not overlap.
- A tier may carry multiple reward definitions.
- The calculation service is deterministic and contains no database or network
  access.
- Completion creates one final reward snapshot plus payout ledger rows.
- Scheme edits create a new version; they do not mutate completed snapshots.
- Explicit recalculation supersedes, but does not delete, the former snapshot and
  must create an audit event.

## Credential security

- Torn API keys are encrypted with AES-256-GCM.
- A unique 96-bit nonce is generated per encryption.
- The authentication tag is appended to the ciphertext.
- Duplicate detection uses an HMAC fingerprint, not plaintext.
- Only the last four characters are retained for display.
- Plaintext keys must not be logged, serialized to clients, placed in URLs, or
  included in telemetry.
- `API_KEY_ENCRYPTION_SECRET` is independent from `SESSION_SECRET` and should be
  supplied by a managed secret store in production.

## Data retention

Completed Torn records are stored locally and synchronized idempotently using
the `(factionId, tornChainId)` unique key. Financial history is protected by
restrictive deletion behavior. Membership or scheme deletion therefore cannot
cascade through finalized payouts.

Member inactivity history is reconciled from verified `last_action` timestamps.
One open setting per faction member prevents duplicate concurrent periods; a
newer source timestamp closes that record and archives it under an immutable
period identifier. Gaps qualify after a fixed 24 hours, while the separately
stored owner-alert threshold controls escalation only. This preserves pattern
comparability when a faction changes its policy. First/last observation times
remain separate from the source-derived inactivity start and return times.

## Data-integrity mode

There is no silent demonstration-data fallback. Only a validated, encrypted
connection session activates browser-request data access; a shared server-wide
Torn key is never treated as a visitor identity. Missing, invalid, paused,
insufficient, or failed connections return an unavailable state with empty
data collections. An explicitly enabled development-only offline fixture is
visually labelled on every workspace screen and is disabled in production.
Safe DTOs contain only mapped Torn fields and derived values whose inputs are
explicitly present in the API response. API keys and raw payloads never cross
the server/client boundary.

The `/connect` form validates the submitted key and defaults to a 30-day
database session. In single-device mode the AES-GCM encrypted credential and
opaque session record are stored in the operating-system AppData directory,
separate from the project SQLite database. In hosted mode they are stored in
PostgreSQL. The browser receives only a random, HTTP-only, SameSite token whose
hash is stored server-side. A user can choose a temporary encrypted 12-hour
session instead. Disconnect revokes the remembered session and credential.
There is no deployment-key authentication fallback because it would give every
visitor the same player's faction and platform privileges.

## Delivery status

Implemented in the foundation:

- application shell and primary operational screens;
- Prisma relational schema without fabricated seed records;
- Torn API v2 schemas, client, caching, deduplication, retry, and error mapping;
- key/faction onboarding validation boundary and disclosure;
- credential encryption helpers;
- reward calculation, validation, and snapshot creation;
- RBAC, tenant assertion, and licence decision helpers;
- tests for critical foundation invariants.

Next application-service slice:

- remembered-session rotation and multi-device session controls;
- transactional onboarding persistence;
- idempotent live/history sync jobs;
- transactional chain finalization and payout creation;
- persistent reward scheme and payout application services;
- durable distributed cache/rate coordination for horizontally scaled workers.
