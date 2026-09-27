# ADR 0008 — Outbox + single-leader relay + pg-boss; journeys on `scheduled_actions`

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §3.1, §3.3)

## Context
- Every side effect (emails, webhooks, realtime, projections, payouts) must happen exactly when the write commits, and never twice.
- Postgres is the system of record (roadmap §2, principle 4). Jobs should not need a second durable store.

## Decision
- **Transactional outbox.** A command writes its rows and `platform.domain_events` in the same transaction.
- **Single-leader relay** in `apps/worker`: leadership via an advisory lock on a **direct** (non-pooled) connection. The relay stamps a gap-free `seq` and enqueues pg-boss jobs.
- **pg-boss only** for jobs and schedules.
- Consumers: subscribers, projectors (metrics, CRM participation, marketplace listings, manifest deltas), realtime publisher, Svix, messaging adapters, payout release, revalidation.
- **Consumers are idempotent** (`processed_events`, `projector_cursors`). Event payloads are versioned contracts.
- **Journeys** run as `scheduled_actions.due_at` rows.
- Trace context is stored in outbox rows.
- Backfilled legacy events carry `replayed=true`; journeys ignore them.

## Alternatives
- **Inngest.** Runner-up if journeys need event-waits or branching beyond `scheduled_actions`.
- **Direct publishing from handlers.** Rejected: side effects could fire on rolled-back writes.

## Consequences
- M0.6 acceptance: consumers stay idempotent under replay.
- Tenant jobs must carry `orgId` (job guard in the isolation suite).
- Projector lag SLO: p95 under 10 s.
- The worker runs on Fly (ADR 0004), not serverless.

## Revisit when
- Journeys need event-waits or complex branching.
- Relay throughput limits projector lag.
