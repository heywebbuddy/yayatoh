# ADR 0004 — Hosting: Vercel + Fly worker + Neon + Upstash + R2 + AWS SES/KMS; Claude Code cloud sessions

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §3.6, §9)

## Context
- The owner had no hosting preference and accepted the recommendation by default (decision log 2026-09-26; confirm as D1).
- The builder is Claude Code working in parallel lanes. Each PR needs its own preview and database branch.
- Long-running consumers (outbox relay, pg-boss, messaging) do not fit serverless limits.
- The owner decided to build in Claude Code cloud sessions (decision log 2026-09-26).

## Decision
- **Vercel Pro (`iad1`)** for web, api and admin; the scanner as a static deploy.
- **Fly.io `iad`** for the worker (2 machines) and Gotenberg.
- **Neon** Postgres 18 (branch per PR, PgBouncer pooler, point-in-time recovery).
- **Upstash** Redis, **Cloudflare R2** and Cloudflare Images, **Ably**.
- **AWS** for SES, KMS and S3 Object Lock (audit WORM).
- Doppler, Sentry, Axiom.
- `yayatoh.events` DNS delegated to Vercel for wildcard certificates; custom domains via the Vercel Domains API.
- **No Cloudflare proxy in front of Vercel.** Cloudflare DNS only, if used at all.
- **Build environment:** Claude Code cloud sessions on GitHub (`heywebbuddy/yayatoh`). Each lane is its own session and branch. Config comes from the repo only (`CLAUDE.md`, `.claude/`, `.mcp.json`). Only dev and test keys; production data never enters a session.

## Alternatives
- Supabase or Aurora instead of Neon.
- Grafana Cloud instead of Sentry + Axiom; Infisical instead of Doppler.
- Local worktrees instead of cloud sessions.

## Consequences
- Launch fixed cost about $380–700/mo, excluding pass-through (Stripe, SMS/WhatsApp, streaming, compliance tooling).
- Phase 0 platform services about $70–180/mo; budgets per phase are in roadmap §3.6.
- Tenant domains carry no per-domain fee.
- Dockerfiles for api and worker keep a move to Fly or Fargate a deploy change.
- Masking dumps, real-data rehearsals, device tests and anything needing SSH stay local or human.
- Full k6 load tests and nightly suites run in GitHub Actions, not in sessions.

## Revisit when
- Costs exceed the roadmap §3.6 budget.
- A vendor limit blocks a milestone (e.g. the M2.4 rewrite spike fails).
