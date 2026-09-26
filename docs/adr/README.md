# Architecture Decision Records

One file per decision, named `NNNN-short-title.md`. Each file has these sections: **Context**, **Decision**, **Alternatives**, **Consequences**, **Revisit when**.

- A PR must not contradict an accepted ADR. To change a decision, write a new ADR that supersedes the old one, with owner approval.
- These ADRs are written in M0.5, with the rationale taken from `docs/roadmap.md`:

| # | Title | Roadmap |
|---|---|---|
| 0001 | Modular monolith: package per module, tiers, ports, Postgres schema per module | §3.5 |
| 0002 | One command model (`defineCommand`) behind both transports: Server Actions and Hono `/v1` | §3.3 |
| 0003 | Tenancy: shared DB, `org_id`, FORCE RLS, `withTenant`, DB roles, isolation suite as merge gate | §4.3 |
| 0004 | Hosting: Vercel + Fly worker + Neon + Upstash + R2 + AWS SES/KMS; Claude Code cloud sessions | §3.6, §9 |
| 0005 | Hybrid funds flow (`organizer_mor` / `platform_mor`), double-entry ledger, daily reconciliation | §5.3 |
| 0006 | Migration: Postgres-first, no shared-MySQL writes, Next.js front door, rehearsed per-instance cutover | §7.4 |
| 0007 | Legacy `/api/v2` facade: frozen, allowlisted, host-namespaced, no sunset while mobile is deferred | §6.2, §8.3 |
| 0008 | Outbox + single-leader relay + pg-boss; journeys on `scheduled_actions` | §3.1, §3.3 |
| 0009 | Realtime via Ably behind `RealtimePublisher`, SSE fallback | §6.4 |
| 0010 | Auth (Better Auth + legacy bcrypt/Sanctum/APP_KEY compat) and in-house authz | §3.1, §4.1 |
| 0011 | QR format (Ed25519) and offline check-in protocol | §5.4 |
| 0012 | Seating: layout document + `event_seats`, Postgres holds, lock after first sale | §5.2 |
| 0013 | Profiles, entitlements, vocabulary; plans dormant until M6.6 | §4.5 |
| 0014 | Public output as allowlists: serializers, taint, canary leak tests | §2 (13), §9 |
| 0015 | Timezone rules | §9 (Time), M0.4 |
| 0016 | i18n (13 locales, RTL) and accessibility gates | §3.1, §10 |
| 0017 | PDF engine (after the M0.5 spike: react-pdf vs Gotenberg) | §3.1 |
