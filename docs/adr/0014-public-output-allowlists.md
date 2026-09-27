# ADR 0014 — Public output as allowlists: serializers, taint, canary leak tests

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §2 (13), §9)

## Context
- The legacy app returned ORM rows and leaked organiser bank, tax, token and private-info fields (roadmap §1.3, §1.3b).
- Output reaches many surfaces: pages, `/v1`, `/api/v2`, webhooks, scanner manifests, exports and projections.

## Decision
- **Public outputs are allowlists, never model dumps** (roadmap §2, principle 13).
- Every public response, page payload, webhook, export and projection goes through an explicit allowlist serializer (Zod output schema). **Never return ORM rows.**
- The serializer is the last step of `executeCommand` / `executeQuery` (ADR 0002).
- **React taint APIs** (`experimental.taint`) mark private values so they cannot cross into client components.
- Private columns are marked `@private`. Sensitive answers and secrets are envelope-encrypted with KMS.
- **Canary leak test (blocking CI gate):** `__CANARY_<field>__` values are seeded into every `@private` column, then all public routes, `/v1`, `/api/v2`, webhooks, manifests and exports are crawled. Any canary found fails the build.
- `/api/v2` returns only fields the apps read; leaked legacy fields are dropped (ADR 0007).
- Outbound webhooks use `payload_mode` full or thin; thin by default for PII events.

## Alternatives
- **Denylist / `$hidden` fields.** Rejected: a new column leaks by default.
- **Review-only enforcement.** Rejected: not reliable for an AI builder.

## Consequences
- `check-modules` fails if a public DTO lacks an allowlist serializer.
- A leaked canary field is one of the M0.5 gate canaries; M0.6 acceptance requires a planted leak to be caught.
- Adding a field to public output is an explicit, reviewable change.

## Revisit when
- A new output surface appears (it must join the canary crawl first).
