# Torn API integration findings

Verified against Torn's official API documentation and OpenAPI document on
14 August 2026.

## Specification

- OpenAPI: 3.1.0
- Torn API specification version: 6.6.1
- Base URL: `https://api.torn.com/v2`
- Authentication: `Authorization: ApiKey {key}` header
- API v2 remains under active development, so every payload is validated at the
  application boundary rather than trusted structurally.

Official sources:

- [Torn API documentation](https://www.torn.com/api.html)
- [Torn API v2 Swagger UI](https://www.torn.com/swagger.php)
- [Torn OpenAPI JSON](https://www.torn.com/swagger/openapi.json)

## Selected endpoints

| Purpose | Current endpoint | Key requirement | Response root |
| --- | --- | --- | --- |
| Key identity and selections | `GET /key/info` | Any key | `info` |
| Current player's basic profile | `GET /user/basic` | Public | `profile` |
| Current faction identity | `GET /faction/basic` | Public | `basic` |
| Specific faction identity | `GET /faction/{id}/basic` | Public | `basic` |
| Own current chain | `GET /faction/chain` | Public | `chain` |
| Specific current chain | `GET /faction/{id}/chain` | Public | `chain` |
| Own completed chains | `GET /faction/chains` | Public | `chains` |
| Specific completed chains | `GET /faction/{id}/chains` | Public | `chains` |
| Latest/ongoing own report | `GET /faction/chainreport` | Public | `chainreport` |
| Specific chain report | `GET /faction/{chainId}/chainreport` | Public | `chainreport` |
| Own faction members | `GET /faction/members` | Public | `members` |
| Specific faction members | `GET /faction/{id}/members` | Public | `members` |

An ongoing chain currently contains exactly `id`, `current`, `max`, `timeout`,
`modifier`, `cooldown`, `start`, and `end`. The service must not invent a target
or elapsed duration beyond what can be derived from those values.

### Chain field semantics

| Field | Meaning | How Chainward uses it |
| --- | --- | --- |
| `current` | Hits in the chain so far. | Chain progress, and part of the liveness test. |
| `timeout` | **Seconds remaining** before the chain drops. Hit 10 and each later hit reset it. | The unambiguous active-chain signal and countdown source. |
| `cooldown` | **Unix timestamp** at which post-chain cooldown ends. | Selects cooldown only while the timestamp is in the future; converted to a duration for the client. |
| `max` | The next chain bonus target. | Labelled "next bonus at", never a faction ceiling. |

The current official OpenAPI schema explicitly describes `timeout` as seconds
until the chain breaks and `cooldown` as a timestamp. Deciding active-chain
liveness from `end` still reports some live chains as idle, so `timeout > 0`
remains the active signal.

### Observed behaviour of the ongoing-chain endpoint

Measured against a live faction with `scripts/observe-chain-endpoint.mts`:

```
elapsed  current  timeout  server date
     0s        1       76  23:59:02
    10s        1       76  23:59:12
    20s        1       76  23:59:22
    30s        1       45  23:59:33   <- one step of 31s
    40s        1       45  23:59:43
    50s        1       45  23:59:53
```

Three findings, all load-bearing:

1. **Identical requests can be served from Torn's service cache for up to thirty
   seconds.** `timeout` then holds a value and steps rather than counting down.
2. **The `Date` header advances in real time even while the body is stale**, so
   it cannot be used to age the response.
3. **`end` was a non-zero timestamp while the chain was live** (`1786492818`
   alongside `timeout` 76), confirming that `end` must not be used to decide
   whether a chain is running. `timeout` is the only reliable signal.

Torn documents a `timestamp` query parameter as the supported way to make a
request unique and bypass this service cache. Chainward now uses it for active
chain checks. Reconciliation still treats a normal reading as an upper bound:
it adopts lower bounds immediately, ignores uncorroborated increases, and only
allows an upward reset when `current` has also increased at hit 10 or later.
This chain-count confirmation is load-bearing: the old duration-only threshold
mistook a repeated cached `300` response for a new hit every ten seconds.

The official chain rules also distinguish the warm-up: hits 1–10 share the
initial five-minute window. Hit 10 and each subsequent successful hit reset the
five-minute timer.

### Polling limits

Torn currently documents a ceiling of 100 individual requests per minute per
user across all keys, rather than a chain-specific polling interval. Chainward
uses a conservative ten-second active cadence (at most six unique chain calls
per minute) and a five-second application floor. It returns to the saved
workspace preference when no chain is active.

The local chain cache remains shorter than the poll interval so concurrent tabs
can share ordinary reads. Active checks deliberately force-refresh that local
entry and add a unique upstream timestamp. Faction identity keeps its normal
cache, so an active check consumes only one uncached Torn request.

A countdown cannot be corrected without knowing how stale its reading is, so
telemetry carries `dataAgeMs`: how long ago Torn answered, measured entirely
within the server's own clock. The browser subtracts it and projects the
remainder with `performance.now()`, a monotonic clock, so no two machines ever
have to agree about the time.

A completed-chain list item contains `id`, `chain`, `respect`, `start`, and
`end`. Contributor totals come from the report rather than the chain list.

A chain report identifies attackers by Torn user ID and supplies their respect
and attack breakdown. Names are joined from the faction members endpoint and
stored as snapshot display values.

## Key selection policy

Public, minimal, limited, and full keys can access the chosen public endpoints.
For custom keys, onboarding explicitly verifies these faction selections:

- `basic`
- `chain`
- `chains`
- `chainreport`
- `members`

The connection also uses `key/info` and `user/basic`. The UI should guide users
toward the narrowest custom key that works and never encourage full access.

## Limits and cache behavior

Torn currently documents a maximum of 100 individual requests per minute per
user across all their keys. The value may change without notice. Identical
requests can be served from Torn's service cache for up to 30 seconds, and cache
hits do not consume quota.

Chainward therefore defaults to:

- a unique current-chain check every 10 seconds while active, with an immediate
  check when the active view mounts;
- a 5-second local chain cache for ordinary/shared reads;
- 30 seconds for faction basic data and member lists used by operational screens;
- 60 seconds for completed-chain lists and key identity data;
- local permanent storage for finalized chain reports;
- request coalescing for concurrent identical calls;
- exponential retry for only rate-limit and transient availability failures.

Active polling and **Sync now** add Torn's documented `timestamp` parameter to
the chain request, then replace the canonical local cache entry. Idle polling
does not bypass the service cache.

## Error handling

Important current codes include incorrect key (2), too many requests (5),
incorrect ID/entity relation (7), API disabled (9), inactive key (13), access
level too low (16), backend error (17), paused key (18), and temporarily closed
(24). Invalid and paused credentials are not retried as if they were transient.

## Terms and launch constraint

Torn requires a conspicuous API-use disclosure wherever a user submits a key
when keys or retrieved data are stored/shared. Chainward renders this disclosure
directly below the key controls. It covers data retention, the faction and
leadership audiences, faction-operations and personnel-record purposes, the
temporary/remembered key-storage modes, and the exact access scope.

Member reports and awards are Chainward-authored faction records rather than
Torn profile data. They persist in the configured workspace database, retain
their author and timestamps, and are always labelled separately from live
roster facts returned by `GET /faction/members`. Reports may be faction-visible
or leadership-only; only operators with `members:manage` can create reports,
assign badges, or revoke an award. Revocation preserves the award history.

Torn's documentation also tells service owners to contact Torn staff before
charging users for usage. The in-game licensing workflow remains configurable
and disabled by default. The owner must obtain guidance from Torn before publicly
launching a paid arrangement.
