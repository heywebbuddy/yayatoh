# ADR 0002 — One command model (`defineCommand`) behind both transports: Server Actions and Hono `/v1`

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §3.3)

## Context
- Writes arrive from two transports: the Next.js web app (RSC and Server Actions) and the public API `api.yayatoh.com/v1` (Hono).
- The legacy `/api/v2` facade must also run the same business rules.
- Rules such as entitlements, authorization, idempotency and audit must never differ between transports.

## Decision
- Every write is declared with `defineCommand` and run by `executeCommand`. Reads use `defineQuery` / `executeQuery`.
- The web app never calls `/v1`. It uses Server Actions and RSC over the same commands.
- `/v1` routes and `/api/v2` handlers call the same commands. The facade holds no business logic.
- The pipeline runs in this order for every transport:
  1. Zod parse (validate)
  2. Entitlement check
  3. Authorization
  4. Step-up check
  5. Idempotency
  6. `withTenant` transaction
  7. Handler
  8. Outbox emit
  9. Audit row
  10. Allowlisted serializer
- Authorization lives in commands. `proxy.ts` is optimistic only (host → org, locale, rewrites).

## Alternatives
- **Web calls `/v1` over HTTP.** Rejected: an extra hop and a second auth path for the dashboard.
- **Separate logic per transport.** Rejected: rules would drift.

## Consequences
- One place to test each rule; transports are thin adapters.
- `check-modules` requires every command to declare a permission and an entitlement key.
- Generated isolation tests cover every command and query with two orgs.
- Idempotency keys are stored in `platform.idempotency_keys`; `/v1` requires `Idempotency-Key` on money, ticket, message and scan POSTs.

## Revisit when
- A transport needs behaviour the shared pipeline cannot express.
