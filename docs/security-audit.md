# Chainward security audit

Last reviewed: 11 August 2026

## Scope

The review covered public and platform routes, route handlers, Server Actions,
Torn credential/session storage, faction authorization, licence enforcement,
local SQLite and PostgreSQL boundaries, backup/restore validation, navigation,
security headers, dependency advisories, and the network-free local test path.

## Remediated findings

| Severity | Finding | Resolution |
| --- | --- | --- |
| Critical | A server-wide `TORN_API_KEY` could act as the identity for any browser request, allowing visitors to inherit one player's faction and potentially platform-owner privileges. | Browser data access now requires an encrypted per-browser connection session. There is no shared-key authentication fallback. |
| High | Licence checks were visible in the interface but absent from operational page reads and some mutations. Direct URLs could open features before activation. | Every operational page and permission-protected mutation now repeats an active faction-licence check on the server. Telemetry API reads are also licence-gated. |
| High | Shared layouts could stream live chain values before a nested page redirect completed. | Inactive and pending workspaces retain only faction identity; chain values and member alerts are redacted before shell props are serialized. |
| Medium | Session encryption and stored API credentials reused one secret. | Stored credentials now use `API_KEY_ENCRYPTION_SECRET`; legacy local/PostgreSQL credentials migrate after successful authenticated decryption. |
| Medium | JSON mutation routes did not consistently check request origin or bound streamed request bodies. | Same-origin/fetch-metadata checks and bounded JSON readers now protect onboarding, disconnect, database test/create, and restore routes. |
| Medium | API-key validation was unthrottled and unexpected server errors could be returned to the client. | Per-address plus process-wide throttles were added, and unexpected failures now return a generic message. |
| Low | Browser hardening headers were absent. | CSP, frame denial, MIME sniffing protection, referrer policy, permissions policy, opener isolation, and production HSTS are configured globally. |
| Low | The API-key field allowed characters and lengths rejected by the server. | Client and server now both require exactly 16 alphanumeric characters. |

`npm audit` reports no known advisories across the current production and
development dependency tree.

## Deliberate offline boundary

`npm run dev:offline` enables deterministic local Torn responses and member/
owner test identities. It requires an explicit flag set by the script, is
disabled whenever `NODE_ENV=production`, uses an encrypted HTTP-only temporary
session, never exposes its marker key to browser code, and labels fixture data
throughout the shell. The normal local SQLite approval transaction remains the
source of truth for unlocking the fixture faction.

## Residual risks before deployment

- The in-process rate limiter is appropriate for one local instance. A hosted,
  multi-instance release should enforce durable limits at a trusted reverse
  proxy or shared store.
- The CSP permits inline scripts/styles required by the current Next.js render
  path. A future hosted release can adopt per-request nonces for a stricter
  `script-src` policy.
- Platform-owner access ultimately depends on possession of Skillerious's Torn
  API key. Protect and rotate that key, and add independent operator
  authentication before accepting high-value or multi-operator workflows.
- The PostgreSQL connection tester intentionally accepts self-signed TLS while
  testing an owner-supplied server. Production application connections should
  validate the database certificate.
- Local SQLite is a single-device test backend, not a safe multi-instance
  production store. Hosted releases should use PostgreSQL, HTTPS, managed
  secrets, centralized logs, backups, and an external penetration test.
- Licence payment matching remains a manual owner attestation; Chainward does
  not prove or perform Torn transfers.

## Verification

The repository passes `npm run check` (lint, TypeScript, 62 tests, and optimized
production build), `git diff --check`, and a full `npm audit`. Local HTTP checks
also cover anonymous redirects, locked shell redaction, licence-gated telemetry,
cross-site mutation rejection, security headers, payload size limits, offline
member/owner identities, and active-licence access to every operational route.
