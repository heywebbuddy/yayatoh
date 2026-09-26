# Platform Stack Devex

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** CASL, Inngest-first, tRPC/hc for web. See docs/roadmap.md §3.1.


## Topic

Core technology stack, repository structure, and developer experience for Yayatoh 2.0 (verified as of 2026-09-26)

# Yayatoh 2.0 — Core Stack, Repo Structure, and Developer Experience

Grounded in the vision doc (`Yayatoh.com Rebuild - Project Vision and Goal.docx`): multi-tenant, white-label, stable mobile API, modular feature packaging per event type, real-time Command Center, marketing automations, offline-tolerant check-in. Versions below were checked against primary sources on 2026-09-26. Note: GitHub release pages omit the year for current-year releases; where the fetcher printed "2024" for a release that is clearly the newest (e.g. Hono 4.13.9, tRPC 11.19, Vitest 5.0.2), the correct year is 2026.

## 1. Next.js version and App Router features

**Pick: Next.js 16.3 (Aug 3, 2026) on Node.js 24 (Active LTS; Node 26 is Current, 22 in maintenance), TypeScript 7 for `next build` type-checking.**

Rely on:
- **RSC + Server Actions** as the web-internal data path (reads in Server Components, mutations via Server Actions). Stable since v14.
- **Cache Components** (`cacheComponents: true`, `partialPrefetching: true`): the `'use cache'` directive + PPR. Still opt-in in 16.3 but Vercel states it "will become the default in a future major", and everything else (`experimental.ppr`, `dynamicIO`) was removed in 16.0. Enable from day one so the caching model is explicit: default is dynamic at request time; cache only public event pages, venue pages, discovery listings with `cacheLife` profiles; use `updateTag()` in Server Actions for read-your-writes and `revalidateTag(tag, 'max')` for SWR. Never cache tenant-scoped dashboard data.
- **`proxy.ts`** (renamed from `middleware.ts` in 16.0; Node.js runtime) for tenant/domain resolution (`events.client.com` → org), locale negotiation (next-intl 4 already targets `proxy.ts`), and CSP nonces. Keep it thin: no DB calls beyond a cached domain→tenant lookup.
- **Turbopack** (default; build FS cache on by default in 16.3), **React Compiler** stable (Babel path; Rust port experimental), **Adapters API stable in 16.2** (keeps the door open to non-Vercel hosting).
- **Root params** (`next/root-params`, 16.3) for `[locale]` / `[tenant]` segments without prop-drilling; `catchError` boundaries with `retry()`; `experimental.useOffline` (16.3) is directly useful for the check-in PWA's poor-connectivity requirement.
- Breaking items to design around: async `params`/`cookies()`/`headers()`, `images.remotePatterns` (tenant logos from R2 need an allowlist), parallel routes need `default.js`, `next lint` removed.

Runner-up: Remix/React Router 7 — smaller ecosystem for RSC/PPR, no equivalent to Cache Components; not worth diverging from the stated Next.js target.

## 2. Backend shape

**Pick: a modular monolith in one TypeScript monorepo, with two thin transports over the same domain modules:**
1. `apps/web` (Next.js) — Server Actions/RSC for web-internal reads/writes.
2. `apps/api` (**Hono 4.13.x**) — versioned REST `/v1` with OpenAPI 3.1 for the existing mobile apps, white-label tenants, third parties, webhooks, and anything that needs long execution or WebSockets.

Why a separate API service and not only Route Handlers: the mobile apps and integrators need a stable, documented, versioned contract that does not change when the web app's rendering model changes; Vercel Functions cap at 800s (1800s beta), 4.5 MB request/response bodies, and WebSockets only reached public beta on 2026-06-22 — a separately deployable API/worker container removes those constraints when needed while still being deployable to Vercel Functions (Hono runs there) at launch.

Why Hono over NestJS 12.1 / Fastify 5.12 / AdonisJS 7.5: Hono is Web-standard, runs unchanged on Node, containers, Vercel, and Cloudflare; `@hono/zod-openapi` (`createRoute` + `OpenAPIHono`, `app.doc31()`) gives OpenAPI from the same Zod schemas; and the **Hono RPC client (`hc<AppType>`)** gives tRPC-style end-to-end types for the web app's client-side data fetching with zero codegen — which is why **tRPC is not needed** (tRPC 11.19 is the runner-up if the team prefers procedure-style routers; oRPC is still `@beta`). NestJS 12 (ESM, Standard Schema, `@nestjs/observe`, Vitest/oxlint defaults) is the runner-up for teams that want DI + decorators; it lost on ceremony and weight, not capability.

**Modular monolith.** Each domain module is a workspace package under `packages/modules/*`: `events`, `ticketing`, `registration`, `orders`, `payments`, `attendees` (CRM), `seating`, `checkin`, `sessions`, `speakers`, `exhibitors`, `sponsors`, `marketing`, `notifications`, `analytics`, `integrations`, `whitelabel`, `authz`, `tenancy`. Rules:
- A module exports only its `index.ts` public API (`package.json` `exports` map) — commands, queries, event types, and a `register()` for its Hono routes and job handlers. No cross-module table access; cross-module reads go through the other module's query API; cross-module writes go through domain events written to an **outbox table** in the same transaction and dispatched by the job runner.
- Enforce boundaries three ways: `eslint-plugin-boundaries` (flat config; element types = `module`, `app`, `shared`; deny `module→module` internals and `module→app`), **Turborepo Boundaries** (`turbo boundaries`, experimental in 2.11: tags in each package's `turbo.json`, allow/deny lists at the root; catches imports outside a package and undeclared dependencies), and package `exports` maps so deep imports fail at resolution. Note: oxlint 1.85 / Biome 2.5 are far faster, but boundary rules need ESLint; run oxlint for everything and a tiny ESLint config with only the boundaries plugin.
- Module enablement per tenant (the vision's "a wedding organizer should not see exhibitors") is data, not code: an `org_module_entitlements` table drives navigation, route guards, and API surface (see §14).

## 3. Monorepo

**Pick: Turborepo 2.11 (Sept 18, 2026) + pnpm 12.7 (Sept 25, 2026) with `catalog:` pinned versions.** Runner-up: Nx (heavier, more plugins than needed).

```
yayatoh/
├─ apps/
│  ├─ web/            Next.js 16.3 (public pages, org dashboard, white-label pages, check-in PWA)
│  ├─ api/            Hono /v1 + /legacy (Laravel-compatible facade for current mobile apps), OpenAPI, webhooks
│  ├─ worker/         Inngest handlers + BullMQ workers, PDF/report generation, imports (container)
│  ├─ admin/          (optional later) platform super-admin; start as /admin inside web behind platform role
│  └─ mobile/         (future) Expo app; existing native apps stay in their repos and consume packages/sdk-*
├─ packages/
│  ├─ db/             Drizzle schema, migrations, RLS policies, seed, test helpers (PGlite/Testcontainers)
│  ├─ contracts/      Zod 4 schemas shared by web, api, worker, sdk; OpenAPI metadata
│  ├─ modules/<name>/ one package per domain module (see §2)
│  ├─ auth/           Better Auth server config, plugins, legacy bcrypt verifier, session helpers
│  ├─ sdk/            generated TS client (@hey-api/openapi-ts) + hc<AppType> re-export
│  ├─ sdk-swift/ sdk-kotlin/  generated from OpenAPI (openapi-generator) for native apps
│  ├─ ui/             shadcn/ui (Base UI) components, design tokens, tenant theming
│  ├─ emails/         React Email templates consuming the same tokens
│  ├─ i18n/           ICU JSON messages (12 locales), RTL utilities, Tolgee sync
│  ├─ flags/          OpenFeature client + DB-backed provider (entitlements + flags)
│  ├─ jobs/           Inngest client, event catalog, queue names
│  ├─ observability/  OTel setup, logger, Sentry init
│  ├─ config/         eslint/oxlint, tsconfig, tailwind, vitest presets
│  └─ testing/        fixtures, tenant factories, isolation test harness
├─ infra/             Terraform/Pulumi (if/when on AWS), Dockerfiles, Cloudflare config
├─ docs/adr/          ADRs (see list)
└─ turbo.json, pnpm-workspace.yaml, .github/workflows
```

## 4. ORM and Postgres

**Pick: Drizzle ORM** — stable line 0.45.3 (Sept 21, 2026); 1.0 is at rc.4 (June 2026). Start on the 1.0 RC only if the team accepts churn; otherwise 0.45 and migrate when GA (relational queries v2 migration guide exists). Rationale: SQL-first (RLS policies and roles are declared in the schema via `pgPolicy`, `pgRole`, `pgTable.withRLS()`, plus `crudPolicy` helpers for Neon), no engine binary, small cold-start footprint, first-class Better Auth and pg-boss/BullMQ integrations, transaction-scoped `SET LOCAL` fits PgBouncer transaction mode. **Runner-up: Prisma** — 7.10 stable, 8.0 at rc.12 (Sept 24, 2026) with a genuinely better migration model (no shadow DB, no reset, verified steps) and Postgres FTS support; lost on RLS ergonomics and weight. Kysely is the fallback for hand-written SQL.

**Postgres provider at launch: Neon (Launch plan)** — pay-as-you-go $0.106/CU-hour, $0.35/GB-month storage, PITR $0.20/GB-month (7-day window), 10 branches included, autoscale to 16 CU, PgBouncer pooler (`-pooler` host, up to 10,000 client connections, transaction mode). Branch-per-PR is the killer feature for preview environments. Runner-ups: Supabase Pro ($25/mo, 8 GB, PITR $100/mo per 7 days) if you want bundled Realtime/Storage; Crunchy Bridge (Standard-4 $70/mo, $0.10/GB) for a more conventional managed Postgres; Aurora Serverless v2 / RDS when moving to AWS (Aurora storage $0.10/GB-mo verified; ACU hourly rate and RDS instance rates UNVERIFIED — roughly $0.12/ACU-hr and ~$47/mo for db.t4g.medium from memory). Target **PostgreSQL 18** (18.6 current; 19 is in beta 4; PG14 EOL Nov 12, 2026).

**Tenant isolation model:** `org_id` on every tenant-owned table; Postgres RLS on all of them; app sets `SET LOCAL app.org_id = ...` (and `app.actor_id`) inside every transaction through a `withTenant(orgId, fn)` helper in `packages/db`; a separate `platform` DB role bypasses RLS for admin/cross-tenant jobs and is only available to `apps/worker` and the super-admin surface. Transaction-mode pooling forbids session `SET`, `LISTEN/NOTIFY`, SQL-level `PREPARE` — `SET LOCAL` is fine; use a direct (non-pooled) connection for migrations and for any LISTEN-based worker.

## 5. Validation and contracts

- **Zod 4** (4.6 current; stable; Standard Schema; built-in JSON Schema conversion) in `packages/contracts` — one schema feeds Server Action input validation, Hono route validation, OpenAPI generation, and client forms.
- **OpenAPI 3.1** generated by `@hono/zod-openapi` (`app.doc31()`); `hono-openapi` (Standard Schema-based) is the runner-up but self-describes as "still in development".
- **SDKs**: `@hey-api/openapi-ts` for the TypeScript SDK; `openapi-generator` for Swift/Kotlin clients handed to the native app teams. Publish the spec at `api.yayatoh.com/v1/openapi.json` and a Scalar/Redoc page.
- **Versioning policy**: path-versioned `/v1`; additive-only within a version; `Deprecation`/`Sunset` headers; `oasdiff` in CI fails the build on breaking changes. Ship a `/legacy/*` facade that reproduces the current Laravel mobile endpoints (paths, payloads, auth) so shipped app versions keep working during cutover; sunset it after the new app versions on `/v1` reach adoption.

## 6. Authentication

**Pick: Better Auth 1.7.6 (Sept 24, 2026), self-hosted, Drizzle adapter.** Auth.js is now officially "part of Better Auth" and `next-auth` v5 still installs as `@beta`, so Auth.js is eliminated. Better Auth covers every listed requirement with first-party plugins:
- Email/password with **custom `password.hash`/`password.verify`** → verify Laravel `$2y$` bcrypt on first login, then re-hash to scrypt (default) transparently.
- Social (Google, Apple), `magic-link`, `passkey`, `two-factor`.
- `organization` plugin: multi-org membership, teams, `activeOrganizationId` on session, `createAccessControl()` for statically defined permissions, `dynamicAccessControl` for tenant-defined roles stored in DB.
- `api-key` plugin: org-owned keys, hashed at rest, expiry, per-key rate limits, permissions/metadata, "sessions from API keys" so Hono middleware treats key and session callers uniformly.
- `bearer` plugin for native apps (token via `set-auth-token` header) and the Expo client for a future RN app; `jwt` plugin so `apps/api` can verify sessions via JWKS without a DB roundtrip.
- `admin` plugin: `impersonateUser` (1-hour default, configurable), ban, session revocation.
- `sso` plugin: OIDC + SAML 2.0 (SP- and IdP-initiated, replay protection), per-organization providers, verified-domain routing, `provisionUser` hook; `scim` plugin (SCIM 2.0, per-connection tokens, Okta/Entra examples; requires an adapter with interactive transactions — Postgres is fine).

Runner-ups: **WorkOS AuthKit** (free to 1M MAU; SSO $125/connection/mo; SCIM $125/connection/mo) — zero-maintenance enterprise SSO but the per-connection cost has to be passed to each enterprise tenant and user data lives off-platform; **Clerk** (Pro $25/mo, B2B orgs add-on $100/mo, SAML $75/connection for 2–15) — best prebuilt UI, most lock-in, weakest fit for white-label domains; Lucia-style custom — more code for no gain now that Better Auth exists.

## 7. Authorization

**Pick: two-layer RBAC owned in `packages/modules/authz`, expressed with CASL for isomorphic checks.**
- Layer 1 (org): Better Auth org roles (`owner`, `admin`, `member` + dynamic roles like `finance`, `marketing`).
- Layer 2 (event): our own `event_role_assignments` (user × event × role such as `door_staff`, `seating_manager`, `session_scanner`, `exhibitor_rep`) with optional constraints (entrance, session). Door staff must be assignable per event without org-level rights — this is why it is not just org RBAC.
- `defineAbilityFor(actor)` builds a CASL ability from both layers; use it in Server Actions, Hono middleware, React (`<Can>`), and translate conditions into Drizzle `where` clauses for list endpoints (CASL version not re-verified: UNVERIFIED, v6.x). Permission checks are always in addition to RLS, never instead of it.
- Runner-up: **OpenFGA** (CNCF incubating, self-host container, Postgres store) when ReBAC hierarchies arrive (agency → client orgs, exhibitor companies → reps). Keep the `authz` module's interface (`can(actor, action, subject)`) stable so OpenFGA can replace the evaluator. Permit.io (free 1k MAU/20 tenants, then per-MAU) is a hosted alternative; per-MAU pricing is a poor fit for a ticketing platform with many low-value users.

## 8. Background jobs and scheduling

**Pick: Inngest** (OSS, self-hostable; Cloud free 50k executions/mo, Pro from $99/mo with 1M executions). Rationale: the vision's automations ("ticket purchased → confirmation; 7 days before → reminder; event day → push; after → survey") are literally event-driven durable functions with `step.sleepUntil`; per-tenant fairness via `concurrency: { key: "event.data.orgId" }`, throttle/debounce/batching for campaign fan-out, cron for rollups, and a local dev server. Steps execute inside `apps/api`/`apps/worker`, so the same handlers run on Vercel Functions or containers.

Runner-ups: **BullMQ 6.3.9** (Sept 25, 2026) — now has a production-ready **PostgreSQL backend** with full feature parity (flows, schedulers, rate limits, deduplication, OTel), ~1.5–2× lower throughput than Redis; the right choice if you want zero SaaS dependency and raw queue throughput (it is the fallback for high-volume sends). **pg-boss 12.34** (Node 22.12+, PG13+, cron/RRULE, DLQ, Drizzle transactional enqueue) — simplest Postgres-only option. **Trigger.dev v4.6** ($5/mo credits free; Pro $50/mo; Apache-2.0) — better for long CPU-heavy tasks on its own compute. **Vercel Workflow SDK** (`workflow`, Apache-2.0, self-hostable with a Postgres "world"; Vercel-managed at $0.02/1k events) — promising, but v5 is beta and multi-region needs `5.0.0-beta.33+`; revisit in 6–12 months. **Temporal** ($50→$25 per million actions) — overkill for this team size.

## 9. File storage, media, PDF

- **Object storage: Cloudflare R2** ($0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, **zero egress**, 10 GB free). S3-compatible presigned URLs for direct browser/mobile uploads (multipart above 100 MB). Runner-ups: S3 (egress ~$0.09/GB — UNVERIFIED current rate), Vercel Blob ($0.023/GB storage, $0.05/GB transfer in iad1 — fine but no presigned S3 API), UploadThing ($25/mo for 250 GB; nice DX, another vendor).
- **Images**: `next/image` with a custom loader against **Cloudflare Images transformations** (5k free, then $0.50/1k unique transformations) so tenant logos/galleries are optimized regardless of host; Vercel Image Optimization ($0.05–0.08 per 1k transformations) is the runner-up when fully on Vercel.
- **PDF**: `@react-pdf/renderer` v4 (Yoga flexbox, embedded fonts incl. Arabic/CJK, SVG for QR) for tickets, badges, and receipts — deterministic, no browser, fast in functions. **Gotenberg 8.x** (MIT Docker image: Chromium + LibreOffice) running in `apps/worker`'s environment for HTML-heavy reports and seating-chart exports. Runner-up: Playwright `page.pdf()` in the worker container (one engine for everything, but heavy); avoid Puppeteer inside Vercel Functions (250 MB bundle cap, slow cold starts).

## 10. Search

**Pick at launch: Postgres FTS + `pg_trgm`** — `tsvector` generated columns with GIN for event discovery (title, description, city, category, date range) and trigram indexes on attendee name/email/phone for door lookup; geo via `earthdistance` or PostGIS. Zero new infrastructure, RLS-safe. **Move discovery to Meilisearch 1.54** (Sept 21, 2026; Cloud from $20/mo, ~$30/mo for 100k docs/50k searches, or self-host) when typo tolerance, faceting, and geo ranking matter; Meilisearch tenant tokens scope white-label tenants. Runner-up: Typesense 30.x (scoped API keys, JOINs, vector search; cloud pricing only via calculator). Check-in lookup must also work offline, so the check-in PWA keeps a local index (IndexedDB) synced per event — search-engine choice does not change that.

## 11. i18n (12 languages, RTL)

**Pick: next-intl 4.14.7** (Sept 24, 2026): App Router + RSC, `proxy.ts`-based locale negotiation, **domain-based routing** (white-label domains can pin a default locale), ICU MessageFormat, typed messages. RTL: set `dir` on `<html>` from locale, use Tailwind v4 logical utilities (`ms-*`, `ps-*`, `text-start`) and the `rtl:` variant, run Playwright visual checks in `ar`. Tenant-editable copy (email templates, registration form labels) lives in the DB with per-locale JSON, not in message files. Translation management: **Tolgee** (free 30k words / 3 seats; Translate €58/mo; self-hostable; CLI sync into `packages/i18n`); Crowdin is the runner-up (pricing not retrievable — UNVERIFIED). Lingui/Paraglide lost on RSC maturity.

## 12. UI

- **Tailwind CSS 4.3** (May 2026; CSS-first `@theme`). Design tokens as CSS variables in `packages/ui`; tenant theming = a JSON theme (logo, palette, radius, fonts) rendered to `<style>` variable overrides in the tenant layout — no build per tenant.
- **shadcn/ui on Base UI** (shadcn made Base UI the default in July 2026; Base UI 1.8.0 Sept 2026; Radix still maintained — commits July 31, 2026 — and still selectable). Choose Base UI for a new codebase; it is where shadcn's new components (Questionnaire, data tables, charts, sidebar) land first. Use shadcn's private registry for the Yayatoh design system.
- Forms: **React Hook Form 7.89** + `@hookform/resolvers` (Zod 4); TanStack Form 1.x is the runner-up (2.0 is alpha). Tables: **TanStack Table 9.2** (headless, server-side pagination/filters). Charts: **Recharts 3.10** (shadcn charts build on it); ECharts/visx for the Command Center if Recharts hits limits. Data fetching on the client: TanStack Query 5.104 + Hono `hc` client.
- Drag-and-drop: **dnd-kit** — new modular `@dnd-kit/react` 0.5 (June 2026) for lists/kanban (guest → table assignment lists); the **visual floor-plan editor** (tables, seats, stage, booths, zoom/pan, thousands of nodes) should be a canvas, not DOM DnD: `react-konva` (Konva) is the recommendation (version UNVERIFIED), Pixi.js the runner-up for very large arenas.

## 13. Testing

- **Vitest 5.0.2** (Sept 25, 2026) for unit/integration; Drizzle query tests against **PGlite** for speed and **Testcontainers Postgres** for RLS/migration tests; Vitest projects per package via Turborepo `--affected`.
- **Playwright 1.63**: E2E for checkout, seating, check-in; `@next/playwright` `instant()` to guard navigation performance; virtual WebAuthn authenticator for passkey tests; named test locks for shared fixtures.
- **Contract tests**: OpenAPI snapshot + `oasdiff` breaking-change gate; replay recorded Laravel mobile traffic against `/legacy`; SDK smoke tests generated from the spec.
- **Tenant-isolation suite** (mandatory CI gate): for every table with `org_id`, create two orgs, exercise read/update/delete across the boundary through the app data layer and raw SQL under the app role, assert zero rows; property-based generation of module commands with mismatched org context.
- Accessibility (axe in Playwright) and RTL screenshot tests.

## 14. CI/CD, previews, flags, observability

- **CI: GitHub Actions** (2,000 free minutes; Linux $0.006/min) + Turborepo remote cache (Vercel-hosted, free with the Vercel team) + `turbo run --affected`. Pipeline: oxlint/Biome format → ESLint boundaries → typecheck (TS 7) → Vitest → build → Playwright on the preview → `oasdiff` → isolation suite (nightly + on `packages/db` changes).
- **Previews**: Vercel preview deployment per PR + **Neon branch per PR** (GitHub integration) + Inngest branch environments; seed with anonymized fixtures.
- **Feature flags / module entitlements**: DB-backed `org_module_entitlements` and `feature_flags` (per-tenant, per-event-type defaults, percentage rollouts) exposed through **OpenFeature** (CNCF incubating; Node/React/NestJS SDKs) with a custom in-process provider backed by a cached DB read. Entitlements must be in SQL because they drive billing, navigation, and API surface; OpenFeature keeps the evaluation API vendor-neutral so experiments can move to Flagsmith (self-host; Start-Up $45/mo for 1M requests) or PostHog (1M flag requests free) later. Unleash ($75/seat/mo cloud; OSS limited to 1 project) lost on price.
- **Observability**: OpenTelemetry JS SDK 2.11 (traces/metrics stable; logs still experimental) via `instrumentation.ts` in web and Hono OTel middleware in api; **Sentry** (Team $26/mo: 50k errors, 5M spans, 50 replays) for errors + traces; **Axiom** (Team $25/mo + 1 TB ingest) or Grafana Cloud (Pro $19/mo base) for logs/dashboards; Sentry Next.js SDK v10 exists but its Next.js 16/Turbopack support was not confirmed from the page fetched — UNVERIFIED, test in week 1.
- **SLOs / error budgets**: checkout success ≥ 99.5%, `/v1` availability 99.9%, check-in scan verify p95 < 300 ms, campaign delivery lag p95 < 5 min; burn-rate alerts in Grafana/Sentry; deploy freezes when budget is exhausted.

## 15. Hosting options and launch-scale cost (monthly, USD, ~2 seats)

| Option | Components | Estimate | Constraints |
|---|---|---|---|
| **A. Vercel + Neon + Upstash + R2 (recommended at launch)** | Vercel Pro $20/seat (1 TB transfer, 1M invocations, 4 h active CPU included) ≈ $40–60; Neon Launch ≈ $25–70; Upstash Redis PAYG ($0.20/100k cmds) ≈ $5–15; R2 ≈ $2–10; Inngest $0–99; Resend $20; Sentry $26; Axiom $25; Ably $0–29; Cloudflare Images $0–10 | **≈ $180–350** | Functions 300 s default / 800 s max (1800 s beta); 4.5 MB bodies (use presigned uploads); WebSockets public beta since 2026-06-22 and bound by max duration → use Ably/Pusher or a $2–8 Fly.io `ws` box for the live Command Center; OCI containers now run as Vercel Functions (Gotenberg/Chromium possible); Vercel Workflows/Queues are Vercel-only managed services; default region `iad1` (right for DC/Maryland); custom domains unlimited on Pro (soft 100k) via Domains API with auto-SSL |
| **B. AWS ECS Fargate + RDS/Aurora** | 2× web + 2× api tasks 1 vCPU/2 GB ≈ $115–145 (ARM $28.83/task); ALB ≈ $20; NAT ≈ $35; RDS db.t4g.medium ≈ $50 (UNVERIFIED) or Aurora Serverless v2 ≈ $45–90; ElastiCache ≈ $15; S3/CloudFront ≈ $10; CI/preview infra extra | **≈ $300–450** + significant ops time | No function limits; WebSockets/long jobs native; custom domains need Cloudflare for SaaS or ACM automation; previews require ephemeral stacks (Terraform); Next.js via Docker `next start` or OpenNext AWS (v3 documents Next 15 features; Next 16 support UNVERIFIED) |
| **C. Fly.io / Railway (Render UNVERIFIED)** | Fly: web+api+worker on shared-cpu (256 MB $1.94 … 1 GB $7.78) or performance-1x 2 GB $31 each; Fly Managed Postgres Basic $38 or Neon; egress $0.02/GB. Railway: $20 Pro + ~$10/GB RAM + ~$20/vCPU | **≈ $100–220** | Unlimited WebSockets/long jobs; regions incl. Ashburn; previews via Railway PR envs / Fly review apps (DIY); custom domains via **Cloudflare for SaaS** (100 hostnames free, then $0.10/hostname/mo; wildcard hostnames Enterprise-only) — do **not** put Cloudflare proxy in front of Vercel |
| D. Cloudflare Workers via OpenNext | $5/mo + $0.30/M requests | cheapest | OpenNext Cloudflare supports Next 16, PPR, `use cache`, but **Node middleware/proxy.ts is not supported** — disqualifying for domain-based tenancy today |

Recommendation: A for launch (fastest path, previews, Neon branching), with `apps/api` and `apps/worker` containerized from day one (Dockerfiles in repo) so moving them to Fly/Fargate is a deploy-target change, not a rewrite.

## 16. Security basics

- **Secrets**: Doppler (Developer free ≤3 users; Team $21/user/mo, SAML, rotation) or Infisical (MIT self-host; Pro $20/identity/mo) syncing to Vercel/GitHub; no `.env` in git; tenant integration credentials (Stripe Connect IDs, WhatsApp tokens) encrypted at rest with a KMS-held key.
- **Headers**: nonce-based CSP generated in `proxy.ts`, `frame-ancestors` allowlist per tenant for embeddable widgets, HSTS, `Permissions-Policy`, `Referrer-Policy`.
- **Rate limiting / abuse**: `@upstash/ratelimit` sliding windows keyed by IP, tenant, and API key on `/v1` and auth routes; **Arcjet** (free 10k req/mo; Individual $25; $5/M) as runner-up when bot detection/WAF/signup protection is needed in one SDK; Vercel WAF for edge rules.
- Payments never touch the app (Stripe Checkout/Elements + Connect); idempotency keys on order creation; signed webhooks (HMAC + timestamp); append-only `audit_log`; Better Auth handles hashed API keys, session revocation, and bcrypt→scrypt migration; Renovate + `pnpm audit` + Socket in CI; SSO-enforced platform admin; quarterly restore drills of Neon PITR.

## Recommended stack table

| Area | Pick | Why (one line) | Runner-up |
|---|---|---|---|
| Framework | Next.js 16.3 + Node 24 + TS 7 | Cache Components/PPR, proxy.ts, Turbopack, stable adapters | — |
| Backend | Modular monolith; Hono 4.13 API + Server Actions | Same modules, two transports; hc RPC replaces tRPC; OpenAPI native | NestJS 12.1 |
| Monorepo | Turborepo 2.11 + pnpm 12 | Boundaries, remote cache, `--affected`, catalogs | Nx |
| ORM | Drizzle 0.45 (→1.0 GA) | SQL-first, RLS in schema, light, pooler-friendly | Prisma 8 |
| Postgres | Neon Launch (PG18) | Branch-per-PR, autoscale, pooler | Supabase / Aurora |
| Contracts | Zod 4 + @hono/zod-openapi + hey-api | One schema → validation, OpenAPI, SDKs | hono-openapi |
| Auth | Better Auth 1.7 | Self-hosted; org/SSO/SCIM/API keys/impersonation/legacy bcrypt | WorkOS AuthKit |
| Authz | Org RBAC + event roles via CASL | Door-staff-per-event needs event scope; isomorphic checks | OpenFGA |
| Jobs | Inngest | Durable sleeps for automations; per-tenant concurrency; OSS | BullMQ 6 (Postgres backend) |
| Storage/PDF | R2 + Cloudflare Images; @react-pdf + Gotenberg | Zero egress; deterministic tickets; Chromium only where needed | S3 / Playwright PDF |
| Search | Postgres FTS + pg_trgm → Meilisearch 1.54 | No infra at launch; tenant tokens later | Typesense 30 |
| i18n | next-intl 4.14 + Tolgee | proxy.ts, domain routing, ICU, RTL via logical CSS | Lingui |
| UI | Tailwind 4.3, shadcn/ui (Base UI), RHF 7, TanStack Table 9, Recharts 3, dnd-kit + react-konva | Token-based theming; shadcn's current default | Radix |
| Testing | Vitest 5, Playwright 1.63, oasdiff, isolation suite | Covers unit→contract→tenant safety | — |
| CI/CD | GitHub Actions + Turbo cache + Vercel/Neon previews | Cheap, branch-per-PR DB | — |
| Flags | DB entitlements via OpenFeature | Modules are billing data; vendor-neutral API | Flagsmith |
| Observability | OTel 2.11 + Sentry + Axiom | Stable traces/metrics; cheap logs | Grafana Cloud |
| Hosting | Vercel + containers-ready api/worker | Speed now, portability later | Fly.io |
| Security | Doppler/Infisical, CSP nonces, Upstash Ratelimit | Standard, low-ops | Arcjet |

## ADR list (decisions to document in `docs/adr/`)

1. Modular monolith with package-per-module and outbox events (vs microservices).
2. Two transports (Server Actions + Hono `/v1`) over shared modules; no tRPC.
3. Tenant isolation: `org_id` + Postgres RLS via `SET LOCAL`, platform role for cross-tenant jobs.
4. Drizzle ORM and the 0.45→1.0 upgrade plan.
5. Neon at launch; migration criteria to Aurora/RDS or Crunchy.
6. Cache Components enabled from day one; what is cacheable (public pages only).
7. Better Auth with legacy bcrypt verification and rehash-on-login.
8. Authorization model: org roles + event role assignments, CASL evaluator, OpenFGA trigger conditions.
9. API versioning, `/legacy` facade for current mobile apps, sunset policy, `oasdiff` gate.
10. Inngest for jobs/automations; BullMQ/pg-boss fallback criteria; no Vercel-only workflow primitives yet.
11. R2 + presigned uploads; Cloudflare Images for transformations.
12. PDF strategy: @react-pdf for tickets/badges, Gotenberg for reports.
13. Search: Postgres first, Meilisearch adoption triggers (typo tolerance, facets, >N events).
14. i18n: next-intl, ICU JSON, Tolgee, tenant-editable copy in DB, RTL rules.
15. Design tokens and runtime tenant theming (no per-tenant builds); Base UI over Radix.
16. Module entitlements and flags via OpenFeature with DB provider.
17. Hosting: Vercel + containerized api/worker; realtime via Ably (or self-hosted ws); custom domains via Vercel Domains API (Cloudflare for SaaS if/when off Vercel).
18. Observability stack and SLO/error-budget policy.
19. Testing gates: tenant-isolation suite and contract tests as merge blockers.
20. Linting: oxlint/Biome for speed + ESLint solely for boundaries; Turborepo Boundaries adoption when stable.
21. Secrets management and encryption of tenant credentials.
22. Check-in offline architecture (PWA + local index + `useOffline`), to be detailed in its own topic.

## Sources
See the `sources` field (all primary vendor/docs pages fetched 2026-09-26).


## Key recommendations

- Build on Next.js 16.3 / Node 24 with Cache Components (`cacheComponents` + `partialPrefetching`) enabled from day one and `proxy.ts` (Node runtime) for domain→tenant and locale resolution; cache only public event/venue/discovery pages.
- Adopt a modular monolith: one package per domain module under packages/modules/*, public API via `exports` maps, cross-module writes only through an outbox/domain events, boundaries enforced by eslint-plugin-boundaries + Turborepo Boundaries.
- Expose two transports over the same modules: Server Actions/RSC for the web app and a Hono 4.13 `/v1` REST API with OpenAPI 3.1 (via @hono/zod-openapi) for mobile apps, white-label tenants, and third parties; use Hono's `hc` RPC client instead of tRPC for typed web-internal calls.
- Ship a `/legacy` facade in the Hono API that mirrors the current Laravel mobile endpoints so existing App Store/Play Store builds keep working during cutover, then migrate apps to `/v1` with generated Swift/Kotlin SDKs.
- Use Drizzle ORM (0.45 stable now, 1.0 when GA) on PostgreSQL 18 at Neon (Launch plan) with `org_id` on every tenant table and Postgres RLS enforced via `SET LOCAL` inside a `withTenant()` transaction helper; keep a separate platform role for cross-tenant jobs.
- Use Better Auth 1.7 self-hosted (Drizzle adapter) with organization, api-key, bearer/jwt, admin (impersonation), sso (SAML/OIDC), scim, magic-link, passkey plugins, and a custom password.verify that accepts Laravel bcrypt hashes and rehashes to scrypt on login; do not use Auth.js (v5 still beta, project now folded into Better Auth).
- Model authorization as org RBAC plus per-event role assignments (door staff, seating manager, session scanner) evaluated by an in-house authz module using CASL; keep the interface swappable for OpenFGA when agency→client hierarchies arrive.
- Run background work and marketing automations on Inngest (durable sleeps, per-tenant concurrency keys, cron, self-hostable); keep BullMQ 6 with its new Postgres backend as the fallback for raw throughput.
- Store files in Cloudflare R2 with presigned direct uploads, transform images via Cloudflare Images, generate tickets/badges with @react-pdf/renderer and HTML reports with a Gotenberg container.
- Start search on Postgres FTS + pg_trgm (events and door lookup); move discovery to Meilisearch with tenant tokens when typo tolerance/faceting is needed.
- Use next-intl 4.14 with ICU JSON in packages/i18n, Tolgee for translation management, and RTL via Tailwind v4 logical utilities; keep tenant-editable copy in the database.
- Build the UI on Tailwind 4.3 design tokens (runtime CSS-variable theming per tenant), shadcn/ui on Base UI, React Hook Form + Zod 4, TanStack Table 9, Recharts 3; use react-konva (canvas) for the visual seating designer and dnd-kit only for list/kanban interactions.
- Make the tenant-isolation test suite and OpenAPI breaking-change check (oasdiff) mandatory CI gates alongside Vitest 5 and Playwright 1.63 (including RTL and passkey tests).
- Host on Vercel Pro + Neon + Upstash + R2 at launch (~$180–350/mo) but containerize apps/api and apps/worker from day one; use Ably or a small self-hosted ws service for real-time Command Center updates because Vercel WebSockets are beta and duration-capped.
- Drive per-tenant module visibility from a DB entitlements table exposed through OpenFeature, and instrument everything with OpenTelemetry → Sentry (errors/traces) + Axiom (logs) with explicit SLOs and error budgets.


## Data model implications

- organization (tenant root: slug, plan, settings, default_locale, timezone) — every tenant-owned table carries org_id with RLS policies keyed on current_setting('app.org_id').
- user, session, account (Better Auth core) plus legacy_password_hash + hash_algorithm columns to support bcrypt→scrypt migration on first login.
- member (user×org with role), organization_role (dynamic tenant-defined roles/permissions), team/team_member, invitation — from the Better Auth organization plugin.
- event_role_assignment (user × event × role [door_staff, seating_manager, session_scanner, exhibitor_rep, finance], optional scope: entrance_id/session_id) — event-level authorization distinct from org roles.
- api_key (org-owned, hashed, prefix, permissions JSON, rate-limit config, expires_at) and sso_provider / scim_connection per organization (from Better Auth sso/scim plugins).
- tenant_domain (org_id, hostname, verified_at, ssl_status, default_locale, is_primary) and tenant_theme (org_id, logo_asset_id, color tokens JSON, fonts, radius, email header/footer) for white-label routing and runtime theming.
- org_module_entitlement (org_id, module_key, enabled, source: plan|override|trial, limits JSON) and feature_flag / flag_override (key, default, per-org/per-event-type rules, rollout %) — evaluated via OpenFeature provider.
- outbox_event (id, org_id, aggregate, type, payload, created_at, published_at) for cross-module domain events and Inngest dispatch; idempotency_key table for order/payment commands.
- audit_log (append-only: org_id, actor_id, impersonator_id, action, subject, diff, ip, at) — impersonation must be recorded with both actor and impersonator.
- media_asset (org_id, r2_key, content_type, size, width/height, checksum, visibility, uploaded_by) referenced by events, venues, tenant_theme, galleries, badges.
- integration_credential (org_id, provider, encrypted_payload, key_version) and webhook_endpoint / webhook_delivery (org_id, url, secret, events[], attempts, last_status) for tenant integrations.
- search_document / tsvector generated columns on event, venue, attendee (name, email, phone trigram indexes) with org_id filter; later mirrored into Meilisearch indexes with tenant-token filters.
- translation_override (org_id, locale, key, value) for tenant-editable copy and message_template (org_id, channel, locale, subject/body, version) separate from static ICU message files.
- event_type / workspace_preset (wedding, concert, conference, agency) that selects default module entitlements, navigation, and onboarding flow per organization.


## Risks

- Drizzle 1.0 is still a release candidate (rc.4); starting on 0.45 means a planned migration (relational queries v2) — budget time and avoid deep coupling to internals.
- Next.js Cache Components/Partial Prefetching are opt-in and still evolving toward a future major; APIs like `revalidateTag` signatures and `catchError` changed across 16.x minors — pin versions and upgrade deliberately.
- shadcn/ui's shift to Base UI (July 2026) splits the component ecosystem; third-party shadcn add-ons may still assume Radix.
- Vercel constraints (800 s max duration, 4.5 MB bodies, WebSockets in beta, Vercel-only Workflows/Queues) can bite the Command Center, imports, and PDF batches — mitigated by containerized api/worker and Inngest, but this must be enforced architecturally.
- Inngest execution-based pricing scales with step count; large campaign fan-outs modeled as one step per recipient could exceed 1M executions/month — batch sends per step and keep the BullMQ fallback ready.
- RLS adds per-query overhead and complicates connection pooling (transaction mode); mis-scoped transactions silently leak data — the tenant-isolation test suite is the control.
- Legacy bcrypt verification path must be carefully rate-limited and rehashed on success; a bug here locks out or exposes existing users at cutover.
- Mobile app continuity depends on faithfully reproducing undocumented Laravel endpoints in the /legacy facade; without recorded traffic and the current API surface this is the highest-uncertainty workstream.
- Putting Cloudflare's proxy in front of Vercel is discouraged; custom-domain strategy therefore differs by host (Vercel Domains API vs Cloudflare for SaaS) and must be decided before white-label launch.
- OpenNext for Cloudflare does not support Node middleware/proxy.ts, and OpenNext AWS's Next.js 16 support is unverified — non-Vercel hosting of the Next.js app should assume Docker `next start`.
- Several pricing figures (Render instances, RDS/Aurora hourly rates, S3 egress, Crowdin) and library details (CASL current version, Sentry SDK Next.js 16 support, Konva version) are UNVERIFIED and should be confirmed during week-1 spikes.
- Boundary enforcement relies on ESLint (eslint-plugin-boundaries) while the wider toolchain moves to oxlint/Biome; Turborepo Boundaries is still experimental, so the guardrail could erode if not wired into CI as a blocking step.


## Open questions

- What technology are the existing iOS/Android apps built with (native Swift/Kotlin, React Native, Flutter), and can we get the current Laravel API surface (routes, payloads, auth scheme) plus recorded production traffic to build and verify the /legacy facade?
- What is the expected launch scale: events per month, attendees per event, peak concurrent check-in scanners, and campaign email/SMS volume? (Drives Neon CU sizing, Inngest plan, and whether Redis is needed at launch.)
- Is there a hosting preference or existing credits (Vercel, AWS Activate, Cloudflare) and an approved monthly infrastructure budget?
- How large is the engineering team and what is its TypeScript/Next.js depth? (Affects Hono vs NestJS and how much ops burden containers vs Vercel are acceptable.)
- When are enterprise SSO/SAML and SCIM actually required by a paying tenant? (Self-hosted Better Auth is fine either way, but it changes early priorities.)
- How are payments structured today and in future — a single Yayatoh Stripe account, Stripe Connect per organization, or tenant-owned Stripe keys? (Affects tenancy, payouts, and PCI scope.)
- Which email/SMS/WhatsApp providers are already in use or preferred, and are there deliverability assets (domains, dedicated IPs, WhatsApp Business account) to carry over?
- Must existing public URLs (events, venues, blogs) be preserved for SEO, and is there a current sitemap/redirect map?
- Are there data-residency or compliance requirements (GDPR for EU attendees, PCI, SOC 2 expectations from enterprise tenants) that constrain region and vendor choices?
- Can we obtain a schema dump and row counts from the current Laravel database to design the migration and RLS policies, and is there a preferred cutover style (big-bang vs per-organization)?
- Who owns the translations today for the 12 UI languages, and should tenants be allowed to edit translated copy for their branded pages?
- Should the future mobile app be rebuilt in Expo inside this monorepo, or will the native apps continue in their own repositories consuming generated SDKs?


## Sources

- https://nextjs.org/blog
- https://nextjs.org/blog/next-16
- https://nextjs.org/blog/next-16-2
- https://nextjs.org/blog/next-16-3
- https://nodejs.org/en/about/previous-releases
- https://www.postgresql.org/
- https://orm.drizzle.team/docs/rls
- https://github.com/drizzle-team/drizzle-orm/releases
- https://orm.drizzle.team/docs/latest-releases
- https://github.com/prisma/prisma/releases
- https://www.prisma.io/blog
- https://neon.com/pricing
- https://neon.com/docs/connect/connection-pooling
- https://supabase.com/pricing
- https://www.crunchydata.com/pricing
- https://aws.amazon.com/rds/aurora/pricing/
- https://aws.amazon.com/fargate/pricing/
- https://www.better-auth.com/docs/plugins/organization
- https://www.better-auth.com/docs/plugins/sso
- https://www.better-auth.com/docs/plugins/scim
- https://www.better-auth.com/docs/plugins/api-key
- https://www.better-auth.com/docs/plugins/admin
- https://www.better-auth.com/docs/plugins/bearer
- https://www.better-auth.com/docs/integrations/expo
- https://www.better-auth.com/docs/authentication/email-password
- https://github.com/better-auth/better-auth/releases
- https://authjs.dev/getting-started/migrating-to-v5
- https://github.com/nextauthjs/next-auth/releases
- https://clerk.com/pricing
- https://workos.com/pricing
- https://openfga.dev/
- https://www.permit.io/pricing
- https://turborepo.dev/blog
- https://turborepo.dev/docs/reference/boundaries
- https://github.com/pnpm/pnpm/releases
- https://github.com/javierbrea/eslint-plugin-boundaries
- https://biomejs.dev/blog/
- https://github.com/oxc-project/oxc/releases
- https://github.com/honojs/hono/releases
- https://github.com/honojs/middleware/tree/main/packages/zod-openapi
- https://github.com/rhinobase/hono-openapi
- https://github.com/nestjs/nest/releases
- https://github.com/fastify/fastify/releases
- https://github.com/adonisjs/core/releases
- https://github.com/trpc/trpc/releases
- https://orpc.dev/docs/getting-started
- https://zod.dev/
- https://www.inngest.com/pricing
- https://trigger.dev/pricing
- https://docs.bullmq.io/
- https://docs.bullmq.io/guide/postgresql
- https://github.com/taskforcesh/bullmq/releases
- https://github.com/timgit/pg-boss
- https://github.com/timgit/pg-boss/releases
- https://temporal.io/pricing
- https://vercel.com/docs/workflows
- https://vercel.com/docs/workflows/pricing
- https://vercel.com/docs/queues
- https://vercel.com/docs/queues/pricing
- https://github.com/vercel/workflow
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/images/pricing/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://uploadthing.com/pricing
- https://vercel.com/docs/vercel-blob/usage-and-pricing
- https://vercel.com/docs/image-optimization/limits-and-pricing
- https://react-pdf.org/
- https://gotenberg.dev/
- https://www.meilisearch.com/pricing
- https://github.com/meilisearch/meilisearch/releases
- https://cloud.typesense.org/pricing
- https://github.com/typesense/typesense/releases
- https://github.com/amannn/next-intl/releases
- https://next-intl.dev/docs/routing/middleware
- https://tolgee.io/pricing
- https://crowdin.com/pricing
- https://tailwindcss.com/blog
- https://ui.shadcn.com/docs/changelog
- https://github.com/mui/base-ui/releases
- https://github.com/radix-ui/primitives/commits/main
- https://github.com/react-hook-form/react-hook-form/releases
- https://github.com/TanStack/form/releases
- https://github.com/TanStack/table/releases
- https://github.com/TanStack/query/releases
- https://github.com/recharts/recharts/releases
- https://github.com/clauderic/dnd-kit/releases
- https://github.com/vitest-dev/vitest/releases
- https://playwright.dev/docs/release-notes
- https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions
- https://openfeature.dev/
- https://www.flagsmith.com/pricing
- https://www.getunleash.io/pricing
- https://posthog.com/pricing
- https://opentelemetry.io/docs/languages/js/
- https://github.com/open-telemetry/opentelemetry-js/releases
- https://sentry.io/pricing/
- https://docs.sentry.io/platforms/javascript/guides/nextjs/
- https://axiom.co/pricing
- https://grafana.com/pricing/
- https://vercel.com/pricing
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/limits
- https://vercel.com/docs/multi-tenant
- https://vercel.com/changelog/websocket-support-is-now-in-public-beta
- https://vercel.com/kb/guide/does-vercel-support-docker-deployments
- https://opennext.js.org/cloudflare
- https://opennext.js.org/aws
- https://fly.io/pricing/
- https://railway.com/pricing
- https://ably.com/pricing
- https://pusher.com/channels/pricing/
- https://upstash.com/pricing/redis
- https://arcjet.com/pricing
- https://www.doppler.com/pricing
- https://infisical.com/pricing
- https://resend.com/pricing
- https://react.email/
- https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- https://www.infoq.com/news/2025/12/nextjs-16-release
