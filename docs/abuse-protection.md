# Abuse protection

Last reviewed: 1 September 2026

## Threat model

Chainward accepts a small public credential-validation request and several
authenticated operations that can consume Torn quota, database connections,
CPU, memory, or disk I/O. The application therefore treats rate limiting as one
layer in a wider resource-consumption boundary, alongside same-origin mutation
checks, strict schemas, bounded request bodies, upstream timeouts, response
caching, and concurrent Torn-request coalescing.

## Application controls

The in-process limiter uses a token bucket. A route may accept a small burst,
then tokens return continuously instead of resetting at a fixed-window edge.
Bucket keys are SHA-256 hashes, so API keys, actor IDs, and client addresses are
not retained in the limiter map. Expired buckets are pruned and the map is
capped at 10,000 entries.

Costly routes use two layers where identity is available. Database connection
tests, backups, restores, and local-database creation also have explicit
in-process concurrency caps, released in `finally` blocks:

| Operation | Early partition | Verified partition |
| --- | --- | --- |
| Torn API-key validation | Client address plus process-wide burst/sustained limits | API-key fingerprint |
| Fresh live-chain telemetry | Client address plus process-wide limit | Torn actor |
| Member activity monitor | Client address | Torn actor |
| PostgreSQL connection test | Client address plus process-wide limit | Platform owner |
| Workspace backup/restore | Client address | Authorised actor |
| Local database creation | Client address | Platform owner |
| Session revocation | Client address plus process-wide limit | — |

Denied requests return HTTP 429, `Cache-Control: no-store`, and a numeric
`Retry-After`. Torn requests have a ten-second default timeout, an 8 MB response
ceiling, and a five-second cap on upstream retry delays. They retry only
transient failures, cache responses by credential and endpoint, and share
identical in-flight requests. Fresh chain polling is limited above its expected
twelve-request-per-minute active cadence but below a rate that would make it a
general upstream request pump.

## Trusted proxy boundary

`CHAINWARD_TRUST_PROXY_HEADERS` remains off by default. Turn it on only if a
trusted proxy overwrites `X-Real-IP` or `X-Forwarded-For` and direct access to
the Next.js origin is blocked. Values are accepted only when they are valid IPv4
or IPv6 addresses; malformed and oversized values share a fallback bucket.

Without trusted proxy headers, direct/local clients intentionally share one
address bucket. This is safe for the single-device deployment model and avoids
letting a caller rotate a forged forwarding header.

## Hosted deployment requirement

Node processes do not share memory, and an application handler is too late to
absorb a volumetric request flood. A hosted, multi-instance deployment must add
a durable edge/WAF or shared-store limiter. Start with conservative edge limits
for `/api/onboarding/validate-key`, `/api/telemetry/live-chain`, and `/api/data/*`,
observe legitimate traffic, and tune by route rather than applying one blanket
number. Block direct origin access before enabling proxy-header trust.

Edge rules complement the actor and credential limits in the application; they
do not replace authorization, payload bounds, timeouts, or upstream quotas.

## Research basis

- [OWASP API4:2023 — Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
  recommends route-specific limits and explicit bounds for payload size,
  execution time, memory, concurrent operations, and third-party spending.
- [Torn API documentation](https://www.torn.com/api.html) documents a per-user
  request ceiling, temporary IP bans for invalid-key abuse, response caching,
  and the `timestamp` cache bypass used only by deliberate fresh-chain checks.
- [Next.js backend-for-frontend guidance](https://nextjs.org/docs/app/guides/backend-for-frontend)
  treats route handlers as public endpoints and recommends pairing application
  checks with the hosting provider's rate-limiting controls.
- Edge products such as [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)
  and [Cloudflare rate-limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)
  can reject floods before they consume an application worker. The exact rule
  must match the eventual host and traffic profile.
