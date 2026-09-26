# Yayatoh 2.0 — The Event Operating System

Yayatoh 2.0 rebuilds [yayatoh.com](https://yayatoh.com) as a multi-tenant, white-label platform. It covers the full event lifecycle:

**Create → Promote → Register → Sell → Manage → Seat → Communicate → Engage → Check In → Analyze**

## Status
Phase 0 (Discovery and foundations). This repository holds the plan and project docs, and the monorepo lands in milestone M0.5.

## Documents

| Document | What it is |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | The full build plan: architecture, domain model, migration, phased milestones, decisions |
| [docs/vision.md](docs/vision.md) | The owner's vision and goals |
| [docs/decisions.md](docs/decisions.md) | Decision log |
| [docs/owner-inbox.md](docs/owner-inbox.md) | Tasks only the owner can do, with the milestone that needs each one |
| [docs/legacy/M0.0-security-hotfix.md](docs/legacy/M0.0-security-hotfix.md) | **Urgent:** security fixes for the live Laravel app |
| [docs/legacy/code-audit-2026-09-26.md](docs/legacy/code-audit-2026-09-26.md) | Audit of the legacy code |
| [docs/cloud-environment.md](docs/cloud-environment.md) | How to set up Claude Code cloud sessions for this repo |
| [docs/research/](docs/research/) | Background research reports |

## Planned stack (roadmap §3)
- **App:** Next.js 16 and TypeScript, with a Hono `/v1` API, in a Turborepo + pnpm modular monolith.
- **Data:** Postgres 18 on Neon, with row-level security.
- **Hosting:** Vercel, plus a Fly.io worker.
- **Services:** Stripe (hybrid funds flow), SES, Twilio, Ably, Cloudflare R2.
