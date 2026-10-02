# Architecture Decision Records

One file per decision, named `NNNN-short-title.md`. Each file has these sections: **Context**, **Decision**, **Alternatives**, **Consequences**, **Revisit when**.

- A PR must not contradict an accepted ADR. To change a decision, write a new ADR that supersedes the old one, with owner approval.
- These ADRs were written in M0.5, with the rationale taken from `docs/roadmap.md`:

| # | Title | Roadmap |
|---|---|---|
| [0001](0001-modular-monolith.md) | Modular monolith: package per module, tiers, ports, Postgres schema per module | §3.5 |
| [0002](0002-one-command-model.md) | One command model (`defineCommand`) behind both transports: Server Actions and Hono `/v1` | §3.3 |
| [0003](0003-tenancy-shared-db-force-rls.md) | Tenancy: shared DB, `org_id`, FORCE RLS, `withTenant`, DB roles, isolation suite as merge gate | §4.3 |
| [0004](0004-hosting.md) | Hosting: Vercel + Fly worker + Neon + Upstash + R2 + AWS SES/KMS; Claude Code cloud sessions | §3.6, §9 |
| [0005](0005-hybrid-funds-flow-and-ledger.md) | Hybrid funds flow (`organizer_mor` / `platform_mor`), double-entry ledger, daily reconciliation | §5.3 |
| [0006](0006-migration-postgres-first-cutover.md) | Migration: Postgres-first, no shared-MySQL writes, Next.js front door, rehearsed per-instance cutover | §7.4 |
| [0007](0007-legacy-api-v2-facade.md) | Legacy `/api/v2` facade: frozen, allowlisted, host-namespaced, no sunset while mobile is deferred | §6.2, §8.3 |
| [0008](0008-outbox-relay-pg-boss.md) | Outbox + single-leader relay + pg-boss; journeys on `scheduled_actions` | §3.1, §3.3 |
| [0009](0009-realtime-ably.md) | Realtime via Ably behind `RealtimePublisher`, SSE fallback | §6.4 |
| [0010](0010-auth-and-authz.md) | Auth (Better Auth + legacy bcrypt/Sanctum/APP_KEY compat) and in-house authz | §3.1, §4.1 |
| [0011](0011-qr-format-and-offline-check-in.md) | QR format (Ed25519) and offline check-in protocol | §5.4 |
| [0012](0012-seating-layout-and-holds.md) | Seating: layout document + `event_seats`, Postgres holds, lock after first sale | §5.2 |
| [0013](0013-profiles-entitlements-vocabulary.md) | Profiles, entitlements, vocabulary; plans dormant until M6.6 | §4.5 |
| [0014](0014-public-output-allowlists.md) | Public output as allowlists: serializers, taint, canary leak tests | §2 (13), §9 |
| [0015](0015-timezone-rules.md) | Timezone rules | §9 (Time), M0.4 |
| [0016](0016-i18n-and-accessibility-gates.md) | i18n (13 locales, RTL) and accessibility gates | §3.1, §10 |
| [0017](0017-pdf-engine.md) | PDF engine: Gotenberg (Chromium) behind `packages/pdf` (spike done) | §3.1 |
| [0018](0018-design-system-superpower-style.md) | Design system: Superpower style | §3.1 |
| [0019](0019-typescript-6-until-tooling-supports-7.md) | TypeScript 6.0 until tooling supports 7 | §3.1 |
| [0020](0020-coexistence-front-door.md) | Coexistence front door: proxy.ts decides and forwards with `fetch`; Cloudflare Worker only as fallback (proposed, M2.4a) | §7.4 |
| [0021](0021-conference-module-layout.md) | Conference module layout: `registration`/`badges` (tier 5), `engagement` (tier 4), program grows unsplit; registration cells are managed ticket types | §3.5 |
| [0022](0022-phase-6-module-layout.md) | Phase 6 module layout: `analytics`/`integrations` (6), `agency` (5), `virtual` (4); crm grows; contact reference owners move a person's rows in one merge transaction; the timeline is a crm projection fed by its owners | §3.5 |
