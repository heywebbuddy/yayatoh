# ADR 0001 — Modular monolith: package per module, tiers, ports, Postgres schema per module

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §3.5)

## Context
- Yayatoh 2.0 covers many bounded contexts: tenancy, events, ticketing, orders, payments, seating, check-in, marketing and more.
- The builder is Claude Code. An AI builder stays correct when every capability follows one pattern (roadmap §2, principle 1).
- The team is small. Separate services would add deploy, network and consistency cost with no benefit at this scale.

## Decision
- One deployable codebase (a modular monolith). Each bounded context is one package under `packages/modules/`.
- Every module is created by `pnpm gen:module <name>` and has the same layout (`module.ts` manifest, `src/schema.ts`, `src/domain/`, commands, queries, events, serializers, tests).
- **Tiers.** A module imports only lower tiers:
  - 0 platform
  - 1 tenancy, whitelabel, billing, crm, forms, content, venues
  - 2 events, attendees
  - 3 ticketing, seating, guests, sessions, speakers, exhibitors, sponsors, payments
  - 4 orders, checkin, engagement
  - 5 registration, badges
  - 6 marketing, commandcenter, marketplace, integrations, ai
- **Public surface:** `.`, `./events`, `./actions`, `./routes`, `./ui`, `./module`, `./testing`. `./schema` is private.
- **One Postgres schema per module.** No SQL touches another module's schema. Composite foreign keys point only down the tiers.
- **Cross-module writes:**
  - Down: call the lower module's command inside the caller's transaction.
  - Up or sideways: subscribe to versioned domain events.
  - Same tier: ports registered in each app's composition root (e.g. seating's `OccupantDirectory`).
- Cross-module read models are projections, never runtime joins.
- Enforcement: `exports` maps, ESLint boundaries, `turbo boundaries` tags and `tools/check-modules`.

## Alternatives
- **Microservices.** Rejected: operational cost and distributed consistency for a small team.
- **Unstructured monolith.** Rejected: no enforced boundaries; hard for an agent to keep correct.

## Consequences
- Boundary violations fail CI (a cross-module import is one of the M0.5 gate canaries).
- `check-modules` validates tiers, that every table is a `tenantTable` or allowlisted global, that every command has a permission and entitlement key, and that every public DTO uses an allowlist serializer.
- Vendors sit behind ports and apps are containerizable, so a module can be extracted later if needed.
- Some logic needs events or ports instead of a direct call. This is deliberate.

## Revisit when
- One module's load or release cadence clearly needs its own deployable.
- A tenant needs a dedicated database (`shard_key` is the seam).
