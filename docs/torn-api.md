# Torn API integration findings

Verified against Torn's official API documentation and OpenAPI document on
9 August 2026.

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
| `timeout` | **Seconds remaining** before the chain drops. Reset by every hit. | The only unambiguous liveness signal, and the countdown source. |
| `cooldown` | **Seconds remaining** of cooldown after a chain ends. | Selects the cooldown state and its countdown. |
| `max` | The next chain bonus target. | Labelled "next bonus at", never a faction ceiling. |

`timeout` and `cooldown` are durations, not timestamps. Treating `cooldown` as a
unix time made the cooldown state unreachable, and deciding liveness from `end`
reported live chains as idle while their hit count was still climbing.

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

1. **Torn serves this endpoint from a roughly thirty second cache.** `timeout`
   holds a value then steps, rather than counting down smoothly. A reading can
   therefore be up to a full cache window old, and how old is unknowable.
2. **The `Date` header advances in real time even while the body is stale**, so
   it cannot be used to age the response.
3. **`end` was a non-zero timestamp while the chain was live** (`1786492818`
   alongside `timeout` 76), confirming that `end` must not be used to decide
   whether a chain is running. `timeout` is the only reliable signal.

Because staleness is unknowable and varies per request, a reported `timeout` is
an **upper bound** on the time actually remaining, never an exact measure. The
countdown therefore tracks the lowest bound it has seen: it adopts any lower
reading in full, ignores higher ones as staleness, and treats only a large
increase as a hit restarting the window. That also errs the safe way — better to
show less time than there really is than more.

Polling faster than the cache window cannot make a reading fresher, but it does
reduce how long a new snapshot goes unseen. Ten seconds was stable in testing;
eight seconds produced repeated `code 17` backend errors, so the floor in
`polling-policy.ts` is not a formality.

### Polling limits

Torn's guidance for the `chain` selection is to poll no faster than once every 5
to 30 seconds; going below that risks an API key cooldown or a temporary ban.
`src/lib/torn/polling-policy.ts` holds the app to that floor and is the single
place those numbers are defined. Chainward polls every 10 seconds while a chain
is running and returns to the saved workspace preference when it is not.

The chain response cache is deliberately **shorter** than the poll interval. If
the two are equal, a poll can arrive while the previous response is still valid,
return that cached copy, and push the next real refresh out by another full
interval — so a hit that restarted the timeout could go unnoticed for twice as
long as intended.

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

- at least 30 seconds for live-chain reads;
- 30 seconds for faction basic data and member lists used by operational screens;
- 60 seconds for completed-chain lists and key identity data;
- local permanent storage for finalized chain reports;
- request coalescing for concurrent identical calls;
- exponential retry for only rate-limit and transient availability failures.

Normal polling deliberately does not add a unique `timestamp` parameter. An
explicit user-triggered **Sync now** request uses Torn's documented `timestamp`
parameter once to request an uncached operational snapshot, then replaces the
canonical local cache entry with that response.

## Error handling

Important current codes include incorrect key (2), too many requests (5),
incorrect ID/entity relation (7), API disabled (9), inactive key (13), access
level too low (16), backend error (17), paused key (18), and temporarily closed
(24). Invalid and paused credentials are not retried as if they were transient.

## Terms and launch constraint

Torn requires a conspicuous API-use disclosure wherever a user submits a key
when keys or retrieved data are stored/shared. Chainward's onboarding disclosure
covers data retention, audience, purpose, key storage, and exact access scope.

Torn's documentation also tells service owners to contact Torn staff before
charging users for usage. The in-game licensing workflow remains configurable
and disabled by default. The owner must obtain guidance from Torn before publicly
launching a paid arrangement.
