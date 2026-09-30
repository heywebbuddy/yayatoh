# ADR 0006 — Migration: Postgres-first, no shared-MySQL writes, Next.js front door, rehearsed per-instance cutover

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §7.4)

## Context
- Two live instances (yayatoh.com and abc.yayatoh.com) run one Laravel codebase with separate MySQL databases.
- Store apps, issued QR codes, URLs and tokens depend on them.
- A long period where old and new code write the same MySQL database would be fragile and hard to test.

## Decision
- **No shared-MySQL write phase.** New modules talk only to Postgres. Differential tests on twin snapshots replace "proving it on shared data".
- **Front door: Next.js on Vercel.** `proxy.ts` reads a routing table (host + path → next or legacy, with rollout %). Cookie overrides: `yy_canary=next`, `yy_legacy=1`. Anything not moved is rewritten to `origin-yay.` / `origin-abc.yayatoh.com`; nginx accepts only a secret header.
- Laravel behind the front door needs `TrustProxies`, a checked `APP_URL` and distinct cookie names.
- **Stages:** A0 pass-through soak → A1 content pages → A2 (optional) public reads → beta tenants → **B-Y** (yayatoh.com, all stateful surfaces at once) → **B-A** (abc as tenant import + custom domain).
- **Order:** yayatoh.com first, then abc.
- **Freeze rules:** no cutover within ±72 h of any event with sales or check-ins; B-A windows per roadmap §7.4; Laravel code freeze from T−30 d.
- **Data:** deterministic, idempotent ELT (`pnpm migrate:legacy`), from backups or a replica only, rehearsed nightly on masked data.

## Alternatives
- **Strangler over a shared MySQL database.** Rejected: dual writes and no clean test oracle.
- **Cloudflare Worker as front door.** Kept only as a fallback if the M2.4 spike fails (25 MB upload, 150 s response, 60 MB stream).
- **nginx on the Laravel box as router.** Used until the bridge build is adopted if Phase 0 finds certificate pinning.

## Consequences
- Each cutover is a rehearsed, timed runbook with go/no-go points (roadmap §7.8).
- abc reuses a pipeline already proven in production.
- If no B-A window exists, abc stays on Laravel through ABC 2027.
- If both instances share a Stripe account, unknown objects are stored as `unmatched` and deduplicated by `event.id`.

## Revisit when
- The M2.4 rewrite spike fails.
- Phase 0 finds certificate pinning or a freeze calendar with no window.
