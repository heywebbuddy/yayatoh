# Yayatoh 2.0 — The Event Operating System: Full Build Plan

Prepared 2026-09-26. Builder: Claude Code. Product owner and reviewer: the Yayatoh owner.

**Precedence when documents disagree:** owner decisions (§1.4) > accepted ADRs > this plan > research reports.

---

## 1. Context

### 1.1 Why this project exists
Yayatoh.com is a live, US-based ticketing platform run by Pani Digital Services, LLC (Beltsville, MD). It has native iOS and Android apps and a 13-locale UI.

The owner wants a Next.js/TypeScript rebuild. The goal is not a port. It is an **Event Operating System**:
- Multi-tenant and white-label.
- API-first, so the mobile apps keep working.
- Modular by event type.
- Enterprise conference features (RainFocus-class).
- A strong wedding and gala experience (SeatFound/Venued-class).
- An Event Command Center with automatic alerts.
- Unified marketing across email, SMS, WhatsApp, push and in-app.
- Offline-capable check-in and flagship visual seating.
- An org-level attendee CRM.
- A clean public API with integrations.

The lifecycle it must cover: `Create → Promote → Register → Sell → Manage → Seat → Communicate → Engage → Check In → Analyze`.

**Outcome:** a modern, scalable, secure, maintainable platform. Every existing capability is preserved or deliberately improved. Organizers, attendees, tickets, links and apps move across without breaking.

### 1.2 What research established about today's system

**Platform**
- Yayatoh is a customized **Eventmie Pro FullyLoaded** install: Classiebit Laravel 11, PHP 8.3, MySQL, Voyager admin, Vue 2, Sanctum.
- It has about 690 named routes, 1,461 UI label keys and 13 locale codes, including Arabic RTL.
- So this rebuild is a migration off a licensed vendor product plus custom overlays. The code is read only to write specs and test vectors ("clean room").

**Tenants and apps**
- Tenancy today means separate installs. `yayatoh.com` and `abc.yayatoh.com` (All Bamileke Convention Chicago 2026) have separate databases with overlapping IDs. There is also a staging host.
- Two store apps ship in four listings:

| App | iOS | Android |
|---|---|---|
| Yayatoh | id6755224885 | `com.yayatoh.yayatohapp` |
| ABC Chicago 2026 | id6760401721 | `com.abcchicago.app` |

- Both apps call `/api/v2/*` with Sanctum bearer tokens. Both are probably React Native (UNVERIFIED).

**Features to preserve**
- Discovery with filters.
- Event pages: schedules, speakers, exhibitors, FAQ, gallery, reviews.
- Tiered ticketing with holds, promo codes, access codes and taxes.
- Image-based seat charts per ticket type.
- Ticket distribution, including WhatsApp send.
- Attendees and guest import.
- Public seat finder with OTP.
- Web camera and HID laser scanning with duplicate, unpaid and window checks.
- Sub-organizer roles: Manager, POS, Scanner.
- Private-info portal, 1:1 chat with moderation, announcements with push.
- AI event creation with purchasable credits.
- Venues, and a Voyager blog used as a CMS.

**Known defects to fix**
- No robots.txt, sitemap, canonical or hreflang.
- Relative `og:image`, and JSON-LD country emitted as an id.
- `/lang/{code}` and `/api/v2/hello-world` return 500.
- `/test-payment` is live in production, and dormant gateways are still routed.
- The iOS privacy URL points at staging, and the store privacy labels are inconsistent.

### 1.3 Live security finding
Verified 2026-09-26 with read-only requests (field names only; no values retrieved). A public endpoint on both installs returned organizer and attendee-private fields that must never be public. Details are kept out of this public repository (held privately by the owner); the fix is M0.0.

**Action:** hotfix Laravel first (**M0.0**). The new platform prevents this class of bug with principle 13.

### 1.3b Code audit findings (read-only audit of `legacy/abc-web-main`, 2026-09-26)
The audit found critical security issues in the live legacy app (authentication, payment confirmation, access control, data exposure, committed secrets and missing rate limits). The detailed findings are kept **out of this public repository** and held privately by the owner and their developer; they are fixed in M0.0. The new platform's design answers each class of issue (principles 1–13, §4.3, §9, §10).

**Facts that correct the plan:**
- **Payments today are not Yayatoh-as-merchant-of-record for connected organizers.**
  - Both Stripe options create Checkout Sessions as **direct charges on the organizer's Standard connected account**, with `application_fee_amount` = admin commission + admin tax.
  - Only organizers without a connected account are charged on the platform account and settled manually (`commissions.transferred`).
  - Onboarding uses `Account::create(type: standard, country: US)`. There is no OAuth.
  - **There are no refund API calls**; refunds are manual in the gateway dashboard.
  - PayPal uses the Omnipay v1 REST API. "Offline" is free text per event; there is no Zelle code.
  - Mesdoh is a hosted checkout at `api.jetcamer.com`. qPay, `/test-payment` and `hello-world` point at missing controllers and are dead.
- **Tickets and QR:**
  - The QR encodes the raw `order_number`, or JSON `{id, order_number}`. The scanner uses only `order_number`, which is `time()+rand` and not unique in the DB.
  - PDFs use dompdf. Apple Wallet uses `thenextweb/passgenerator`.
- **Bookings and check-in:**
  - Default is one booking row per person (qty 1, own `order_number`). "Distribute later" is one row with qty N plus N unassigned attendees. Multi-day tickets get one attendee per access date.
  - Check-in is **per booking per day** in `checkins` (no unique index). The scanner does not check `booking_cancel` or `access_dates`. There is **no offline scanning**.
  - Attendees have no email column; email is stored in `address`.
- **Seating:**
  - One chart image per ticket (per date for multi-day). Seats store `"Xpx,Ypx"` in natural image pixels. `seats.capacity` > 1 means a table.
  - Holds last 10–15 min: `failed_bookings.seats` plus `seat_statuses`, released by `tasks:run-scheduled` every minute.
- **Time.** `app.timezone` is overwritten at runtime from the `regional.timezone_default` setting, but PHP stays UTC. Event dates and times are local wall-clock DATE + TIME columns. Check-in times are stored as UTC time-of-day.
- **Mobile API shape.**
  - Most `/api/v2` responses are `{data: {…all view variables…}, status: true}` via the global `view()` override, with double nesting in some cases.
  - Error shapes vary: 422 `{message, errors}` only with `Accept: application/json`, `{errors:{error:[…]}}`, `{status:false,…}`, and 200 `{success:false}`.
  - Sanctum tokens expire after 48 h, with no refresh endpoint.
  - The RN app reads `API_URL = BASE_URL + '/api/v2'`.
  - There is no `/api/v2` private-info endpoint. The app probably reads `private_info` from the leaking event payload, so an authenticated `/api/v2` endpoint must ship **before** the leak is closed.
- **Messaging.**
  - Push already uses FCM HTTP v1 with a service account, but `apn_token` is wrongly sent through FCM.
  - WhatsApp uses Pani's own template gateway (`whatsapp.panitechnologies.com`), not Twilio or Meta directly. Twilio is SMS only.
  - Mail is synchronous SMTP from Voyager settings. The queue runs in `sync` mode.
- **AI credits are not implemented:** the balance is hard-coded to 10, and the purchase routes point to missing methods. There are no balances to migrate.
- **Guest lists** are organizer marketing email lists, with no import. Attendee import is headerless CSV: `name, email, phone, seat_labels, distributor_tag`.
- **Codebase shape.**
  - The vendored `eventmie-pro/` package has been **edited in place**, so a diff against pristine 3.0.0 is needed.
  - Both hosts share this one codebase, each with its own DB and settings.
  - A staging URL is hard-coded in `events/show.blade.php:806-822`.

### 1.4 Owner decisions (2026-09-26)

| Topic | Decision |
|---|---|
| Legacy access | The owner has the Laravel source, production DB and app source. **yayatoh.com and abc.yayatoh.com deploy from one codebase** (`gitlab.com/eventmie-pro/abc-web`, private) with different config and databases. The owner clones it to `legacy/abc-web`. This plan was built from the vision doc and public research; Phase 0 audits the real code and corrects the plan. |
| Builder | Claude Code, with the owner as product owner. Work is organized in small, verifiable increments. Humans own accounts, stores, DNS, legal and go/no-go calls. |
| Hosting | No preference. The recommendation is in §3.6. |
| Payments | Originally Yayatoh-as-MoR. **Revised after the code audit: keep today's hybrid.** Connected organizers stay merchant of record: direct charges on their Stripe account plus Yayatoh's application fee. Unconnected organizers are charged on Yayatoh's account and paid out by separate charges & transfers (SCT), automating today's manual settlement (§5.3). |
| Legacy security fixes | The owner's current developer fixes the critical holes in §1.3b. Claude Code hands over the exact fix list (M0.0). |
| Expansion order after parity + migration | **Command Center + marketing first**, then weddings & galas, then conference/enterprise. CRM depth, integrations, agency, virtual, advanced seating and billing follow by dependency. |
| Tenant sites | Separate apex (e.g. `{slug}.yayatoh.events`) until the tenant adds a custom domain. `abc.yayatoh.com` stays as a custom domain. |
| Mobile | Current apps keep working through a compatibility API. **Mobile apps are planned but not built in this build** (§8.3). Staff and guest features ship as the Scan PWA and mobile-first web pages. The M0.8 audit scores the app code for the future decision. |
| Pricing | **Keep the current per-ticket fee model at launch.** Plans, fee schedules and entitlements are modeled from day one and switched on later (M6.6) without feature-code changes. |

### 1.5 Source material
- `docs/vision.md` — the owner's vision document.
- `docs/research/` — 13 topic reports, 8 gap reports, the research map (`00-research-map.md`) and the coverage critique. Files superseded in part by this plan carry a banner saying which parts.
- `docs/legacy/code-audit-2026-09-26.md` — read-only audit of the legacy Laravel code (`gitlab.com/eventmie-pro/abc-web`, mirrored privately as `Pani-Digital-Services-LLC/yayatoh-legacy`).
- `docs/legacy/M0.0-security-hotfix.md` — the fix list for the owner's developer.

---

## 2. Guiding principles
1. **Modular monolith, one module pattern everywhere.** Each capability is a vertical-slice package with the same layout, created by a generator. Consistency is how an AI builder stays correct.
2. **Contract-first.** Zod generates OpenAPI 3.1, which generates the TS, Swift and Kotlin SDKs. Blocking CI checks: `oasdiff`, HAR replay, isolation and state-machine tests.
3. **Tenant isolation in depth.** The host or path gives the org. The org is checked against the actor's effective orgs, then `withTenant`, then forced Postgres RLS. Headers are never trusted, and no raw DB client exists outside `packages/db`.
4. **Postgres is the system of record** for inventory, seat holds, jobs, outbox, ledger, entitlements and devices. Redis, Ably, search and OLAP are derived and can be rebuilt.
5. **Every side effect goes through the transactional outbox.** Consumers are idempotent. Event payloads are versioned contracts.
6. **Every lifecycle is an explicit state machine.** Each is defined once, enforced with conditional `UPDATE … WHERE status = ANY(from)`, and every transition is logged.
7. **Money is an immutable double-entry ledger** in integer minor units, reconciled to Stripe daily.
8. **Entitlements decide capability; profiles decide presentation.** Code checks module keys, never plan or profile names.
9. **Degraded paths are designed.** Offline check-in, idempotency keys, retries, kill switches and a 426 upgrade handshake are part of the design, not afterthoughts.
10. **Vendors sit behind ports; deployables are containerizable.** Hosting is a deploy target.
11. **Compatibility is a product surface.** `/api/v2`, issued QR codes, URLs, Sanctum tokens and integer IDs have their own package, tests and sunset telemetry.
12. **Legible to an agent.** Generators, a CLAUDE.md per package, strict TypeScript, tests as gates, an ADR per decision.
13. **Public outputs are allowlists, never model dumps.** Typed serializers, React taint APIs and canary-leak tests enforce this (§9).

---

## 3. Target architecture

### 3.1 Stack

| Area | Pick | Runner-up |
|---|---|---|
| Runtime | Node 24 LTS, TypeScript 7 strict | — |
| Web | Next.js 16.3 App Router, React 19.2 + React Compiler, `proxy.ts`, `next/root-params`, `experimental.taint`. Cache Components only on public reads. | React Router 7 |
| API | Hono 4.13 + `@hono/zod-openapi` (OpenAPI 3.1). The web app never calls `/v1`; it uses Server Actions and RSC over the same commands. | NestJS 12 |
| Scanner / kiosk | Separate Vite + React PWA (Workbox) on `/v1` only. It shares `checkin-engine` and `ticket-crypto` with any future Expo app. | Next.js route group + Serwist |
| Monorepo | Turborepo 2.11 + pnpm 12 catalogs + `turbo gen` | Nx |
| Database | PostgreSQL 18 on Neon (aws-us-east-1): branch per PR, PgBouncer pooler, point-in-time recovery | Supabase / Aurora |
| ORM | Drizzle core query builder, moving to 1.0 at GA. RLS roles and policies live in the schema. One Postgres schema per module. | Prisma 7 |
| Contracts | Zod 4 in `packages/contracts` | Valibot |
| Jobs, schedules, journeys | **pg-boss only.** Jobs are enqueued by the outbox relay. Journeys run as `scheduled_actions.due_at` rows. | Inngest, if journeys need event-waits or branching beyond this |
| Realtime | Outbox relay → worker publisher → Ably (Standard $29 + usage) with scoped 1-hour tokens. SSE fallback. | Self-hosted Socket.IO on Fly |
| Cache / rate limit / host map | Upstash Redis + in-process LRU; `@upstash/ratelimit` | Vercel Global Config |
| Auth | Better Auth 1.7: organization, admin, api-key, bearer/jwt, magic-link, email-otp, passkey, two-factor; sso/scim plugins later. Argon2id rehash of Laravel `$2y$`. | WorkOS AuthKit |
| Authz | In-house typed evaluator over Better Auth access-control statements + event role assignments + agency grants. `scopeFilter()` returns a Drizzle `where`. | CASL, later OpenFGA |
| Payments | Stripe, **hybrid** (§5.3): `organizer_mor` direct charges + application fee for connected organizers; `platform_mor` PaymentIntents + SCT with transfer at release for unconnected ones. Radar. Stripe Tax behind a `TaxProvider` port. | Single model (all-platform or all-organizer MoR) |
| SaaS billing (dormant) | Stripe Billing + Entitlements + Billing Meters, enabled in M6.6 | Metronome |
| Email | Amazon SES v2 with Tenants + React Email | Postmark |
| SMS | Twilio behind an adapter | Telnyx |
| WhatsApp | Meta Cloud API as Tech Provider (Embedded Signup v4) + platform WABA. US traffic is utility/auth only. | Twilio / 360dialog |
| Push | FCM HTTP v1 + APNs `.p8` + web push (VAPID) | Expo Push |
| Webhooks out | Svix Cloud ($20/mo) behind a `WebhookPublisher` port | Own pg-boss delivery |
| Integrations | Nango + own sync workers (Phase 6) | Merge |
| Storage / images | Cloudflare R2 + Cloudflare Images. Uploads are re-encoded in the worker. | S3 |
| PDF | **Spiked in M0.5:** `@react-pdf/renderer` vs Gotenberg/Chromium for Arabic, Hindi and CJK shaping and tagged PDFs. Expected result: Gotenberg for tickets and reports. | — |
| Search | Postgres FTS + `pg_trgm`. Marketplace moves to Meilisearch fed from the public read model. | Typesense |
| Seating | Konva + react-konva editor and picker; SVG for print; accessible list mode always. Holds live in Postgres. | PixiJS for more than 50k seats |
| QR | Ed25519-signed compact binary → base32 → QR V7-M, with a per-org `kid` | HMAC (rejected: offline devices would need the secret) |
| UI | Tailwind 4, shadcn/ui on Base UI, React Hook Form, TanStack Table/Query, Recharts + ECharts, dnd-kit | Radix |
| i18n | next-intl + Tolgee. 13 codes: ar (RTL), de, en, es, fr, hi, it, ja, nl, pt, ru, zh_CN, zh_TW. | Lingui |
| Flags | OpenFeature with a DB provider, for release flags and kill switches only | Flagsmith |
| Testing | Vitest, Playwright, Testcontainers PG, fast-check, Schemathesis, Spectral + oasdiff, golden-HAR replay, axe, k6 | — |
| Lint | oxlint + Biome. Boundaries enforced by ESLint rules, `turbo boundaries` and a `check-modules` script. | — |
| Observability | OpenTelemetry → Sentry + Axiom. Trace context is stored in outbox rows. | Grafana Cloud |
| Secrets | Doppler + AWS KMS envelope encryption (per-org data key, AES-256-GCM) | Infisical |

### 3.2 Deployables and host map

| App | Hosts | Purpose |
|---|---|---|
| `apps/web` (Next.js) | `yayatoh.com`, `app.yayatoh.com`, `*.yayatoh.events`, custom domains incl. `abc.yayatoh.com` | Marketplace; organizer and agency dashboard on `app.yayatoh.com`; tenant public sites (event, checkout, RSVP, seat finder, kiosk/TV, guest site, order management); auth; legacy URLs; the `/api/v2` facade mount |
| `apps/api` (Hono) | `api.yayatoh.com` | `/v1`, Scalar docs, inbound provider webhooks, Apple PassKit web service, scanner sync |
| `apps/worker` | Fly.io `iad` (2 machines) | Outbox relay (leader via advisory lock on a **direct** connection), pg-boss consumers, projectors, alert evaluator, messaging, payout release, PDFs and exports, media re-encode, realtime publisher |
| `apps/scanner` | `scan.yayatoh.com` | Offline check-in PWA, kiosk mode, TV board |
| `apps/admin` | `admin.yayatoh.com` | Platform staff console. **Only admin and worker hold the `platform_reader` credential.** |
| `apps/mobile` | reserved | Empty; mobile build deferred (§8.3) |

After cutover, `yayatoh.com/dashboard*` returns 308 to `app.yayatoh.com`.

### 3.3 Core flows
```
tenant host ─► proxy.ts: strip x-tenant-*, host → org (LRU → Redis write-through of org_domains), locale
            ─► rewrite /t/[org]/[locale]/… ; 'use cache' only in public reads, keyed by root params, tagged org:{id}/event:{id}
            ─► RSC / Server Action ─► executeCommand ─► withTenant tx ─► Postgres (FORCE RLS)
api.yayatoh.com ─► auth (API key | user JWT | device JWT | portal/manage token | legacy Sanctum) ─► same commands
command tx writes rows + platform.domain_events ─► relay stamps gap-free seq and enqueues pg-boss jobs
   ─► subscribers | projectors (metrics, CRM participation, marketplace listings, manifest deltas)
   | realtime publisher → Ably | Svix | messaging adapters | payout release | worker → signed /api/internal/revalidate
```
**`executeCommand` / `executeQuery` run the same pipeline for both transports:**
1. Zod parse
2. Entitlement check
3. Authorization
4. Step-up check
5. Idempotency
6. `withTenant` transaction
7. Handler
8. Outbox emit
9. Audit row
10. Allowlisted serializer

**Marketplace isolation.** Cross-tenant reads come **only** from `marketplace.public_listings`. A projector writes it under `marketplace_writer`; the web reads it as `public_reader`. It contains no PII.

### 3.4 Monorepo layout
```
yayatoh/
├─ CLAUDE.md  AGENTS.md  docs/{vision.md, roadmap.md, research/, adr/, specs/, acceptance/, parity/, legacy/, runbooks/, demo/}
├─ apps/{web, api, worker, scanner, admin, mobile(reserved)}          each with CLAUDE.md (+ Dockerfile for api/worker)
├─ packages/
│  ├─ kernel/        Ctx, TypeID, DomainError codes, Money, tz rules, defineStateMachine, defineCommand/Query   [universal]
│  ├─ contracts/     Zod DTOs, event payloads, public serializers, legacy-v2 shapes                             [universal]
│  ├─ db/            client factory (internal), roles, tenantTable()/eventTable()/encrypted(), withTenant/withPublicReader/
│  │                 withPlatform, migrations, schema guard, seeds
│  ├─ auth/          Better Auth config, Laravel bcrypt/Sanctum/APP_KEY verifiers, device/portal/manage tokens
│  ├─ platform/      outbox, jobs, realtime, metrics, alerts, messaging, entitlements (+profiles, vocab, nav), authz,
│  │                 audit, crypto, storage, http (Hono kit), cache, flags, search, observability, privacy
│  ├─ modules/       one package per bounded context (§3.5)
│  ├─ legacy-v2/     /api/v2 facade (Hono sub-app), legacy URL handlers, compat_id allocator, Laravel envelopes
│  ├─ ui/ design-tokens/[universal] emails/ pdf/ i18n/[universal] floorplan-canvas/
│  ├─ api-client/[universal] sdk-swift/ sdk-kotlin/     generated
│  ├─ ticket-crypto/ checkin-engine/ seating-core/      [universal]
│  ├─ etl/           legacy ELT (pgloader config, transforms, validation, golden queries, reverse ETL)
│  ├─ legacy-contract/  legacy OpenAPI, golden HARs, normalizers, QR/auth test vectors, scan verdict corpus
│  ├─ testing/       factories, two-org + canary fixtures, isolation harness, fakes (Stripe/SES/Twilio/Ably/Svix)
│  └─ config/
├─ tools/{gen-module, check-modules, gen-sdks}    infra/{terraform, vercel, fly}    .github/workflows/
```
`[universal]` packages must run in browser, Node and React Native: no `node:*`, no DOM, no Next imports. They serve either mobile branch.

### 3.5 Modules, tiers and boundary rules

**Tiers** (a module imports only lower tiers):

| Tier | Modules |
|---|---|
| 0 | platform |
| 1 | tenancy, whitelabel, billing, crm (contacts), forms, content, venues |
| 2 | events, attendees |
| 3 | ticketing, seating, guests, sessions, speakers, exhibitors, sponsors, payments |
| 4 | orders, checkin, engagement |
| 5 | registration, badges |
| 6 | marketing, commandcenter, marketplace, integrations, ai |

**Rules**, enforced by `exports` maps, ESLint boundaries, `turbo boundaries` tags and `tools/check-modules`:
1. The public surface is `.`, `./events`, `./actions`, `./routes`, `./ui`, `./module` and `./testing`. `./schema` is private.
2. Each module owns one Postgres schema. No SQL touches another module's schema. Composite foreign keys may point only down the tiers.
3. Cross-module writes:
   - **Down:** call the lower module's command inside the caller's transaction.
   - **Up or sideways:** subscribe to events.
   - **Same tier:** use ports registered in each app's composition root. Example: seating's `OccupantDirectory` is implemented by guests and ticketing.
4. Cross-module read models (CRM participation, metrics, marketplace, agency snapshots) are projections. They are never runtime joins.
5. `check-modules` validates:
   - `dependsOn` against tiers
   - every table is a `tenantTable` or allowlisted as global
   - every command has a permission and an entitlement key
   - every public DTO uses an allowlist serializer

**Module recipe** (`pnpm gen:module <name>`):
- `MODULE.md`
- `module.ts` (manifest: tier, dependsOn, entitlement, permissions, commands, queries, routes, jobs, subscribers, projectors, metrics, alerts, widgets, nav, readinessRules, webhookEvents, ports)
- `src/schema.ts`
- `src/domain/` (pure state machines and policies)
- `src/commands/*`, `src/queries/*`, `src/events.ts`, `src/subscribers/`, `src/projectors/`, `src/jobs/`
- `src/serializers/`, `src/routes.ts`, `src/actions.ts`, `src/ui/`
- `tests/{unit, integration, isolation (generated), contract}`

### 3.6 Hosting recommendation and cost

**Recommended setup:**
- Vercel Pro (`iad1`) for web, api and admin; scanner as a static deploy.
- Fly.io `iad` for the worker (and Gotenberg).
- Neon, Upstash, R2 and Cloudflare Images, Ably.
- AWS for SES, KMS, and S3 Object Lock (audit WORM).
- Doppler, Sentry, Axiom.
- `yayatoh.events` DNS delegated to Vercel for wildcard certificates.
- Custom domains via the Vercel Domains API.
- **No Cloudflare proxy in front of Vercel**; Cloudflare DNS only, if it is used at all.

**Why this setup:**
- Preview deploys with a Neon branch per PR fit agent-driven work.
- Tenant domains carry no per-domain fee.
- Fly keeps long-running consumers off serverless limits.
- Dockerfiles keep a move to Fly or Fargate a deploy change.

**Launch fixed cost: about $380–700/mo.** This includes an always-on worker and Neon compute. It excludes pass-through costs: Stripe fees, Radar and Tax, SMS/WhatsApp usage, streaming, and compliance tooling.

| Phase | Platform services per month |
|---|---|
| 0 | $70–180 |
| 1 | $200–400 |
| 2 | $250–450, plus Laravel for 30 days |
| 3 | $400–700, plus usage and Vanta (~$800–2,000, UNVERIFIED) |
| 5 | $500–1,200 |
| 6 | $800–1,800, plus pass-through |

**One-off and annual costs:**
- Test hardware: $1,500–3,500 (laser scanner, rugged Android, iPad, Brother/Zebra printer).
- Apple developer: $99/yr per account.
- Tenant apex domain.
- Pen test: $5–15k.
- SOC 2 audit: $15–40k (UNVERIFIED).

---

## 4. Tenancy, white-label, profiles and entitlements

### 4.1 Organizations, roles and agencies

**`tenancy.organizations`:**
- `kind` ∈ organizer | agency | venue | platform
- `slug`, `status` (active | limited | suspended | terminated)
- `default_profile`, `default_locale`, `timezone`, `country`, `currency`
- `billing_account_id`, `powered_by_visible`
- `shard_key` (seam for a future dedicated database)
- `legacy_instance`, `handover_contact_email`

**Users and contacts:**
- Users are global (Better Auth).
- Attendees and customers are **org-scoped CRM contacts**, optionally linked to a user.
- There is never a global attendee record. The only cross-tenant data is a hashed person key used for fraud and suppression.

**Org roles** (Better Auth `member` and dynamic roles):
- owner, admin, manager, finance, marketing, box_office, scanner, viewer
- Profile presets add roles such as wedding `co_host`/`planner` and conference `registration_manager`.

**Event-scoped roles** (`event_role_assignments(org, event, user, role, scope{checkpoints, sessions, exhibitor, speaker}, expires_at)`):
- door_staff, seating_manager, session_scanner, event_manager
- exhibitor_admin, exhibitor_staff, speaker, sponsor_contact, kiosk_operator, venue_viewer
- Portal users (speakers, exhibitor reps, day-of staff) hold only event roles.

**Agencies:**
- Every client is a full org.
- `org_relationships(parent, child, kind agency_client|host_affiliate|venue_partner, commission_bps, billing_mode, payout_mode)` links them.
- `org_access_grants(relationship, grantee org|team|user, role, scopes, expires_at, revoked_at)` defines access.
- Effective orgs = memberships ∪ active grants. The cache is versioned per user, so a revoke takes effect at once.
- Money and billing tables add RESTRICTIVE policies requiring direct membership unless the client owner opts in.
- Cross-client reports read only from `agency_report_snapshots`.
- Detach is a state change.

**Host affiliates:** `host_affiliate` lets a host org's domain serve its child orgs' events. Example: other organizers' events on `abc.yayatoh.com`.

### 4.2 Hosts, sessions and canonical URLs

| Host | Resolves to |
|---|---|
| `yayatoh.com` | Marketplace, attendee account, legacy URLs, `/api/v2` (main instance) |
| `app.yayatoh.com` | Dashboard: org from path `/o/[org]`, verified against effective orgs |
| `{slug}.yayatoh.events` | Tenant site. Submit the apex to the Public Suffix List (PSL) in M0.1. |
| Custom domain | Exact `org_domains` match; non-primary domains 308 to the primary |
| `abc.yayatoh.com` | ABC org custom domain, plus `/api/v2` for the ABC app (`instance=abc`), plus affiliate events |
| `api.` / `admin.` / `scan.yayatoh.com` | Fixed |

**Sessions and login:**
- Each host uses its own `__Host-` cookie with no `Domain` attribute.
- Organizers log in on `app.yayatoh.com` (passkey rpID `yayatoh.com`). Tenant-host preview uses a 60-second single-use handoff code.
- Attendees use email OTP or magic link on the tenant host. Order management works through revocable `manage_token` links, so guest checkout needs no account.

**Canonical "home" URL for each event:**
1. Verified custom domain, else
2. Tenant apex, if the org has a tenant site, else
3. `yayatoh.com/events/{slug}`. This is the default for marketplace organizers and **all migrated yayatoh.com events**, which keeps SEO intact.

The marketplace shows copies only for listed events, with canonical pointing to the home URL. Wedding and private events are never listed. Locales are path-based with `as-needed` prefixes, so legacy English URLs keep working. Each host serves its own `robots.txt` and sitemap index.

### 4.3 RLS conventions and the isolation suite

**`tenantTable()`** adds:
- `org_id uuid NOT NULL` and `UNIQUE(org_id, id)`
- Composite foreign keys, and indexes that lead with `org_id`
- `ENABLE` + `FORCE ROW LEVEL SECURITY`
- Policy `org_id = (SELECT NULLIF(current_setting('app.org_id', true), '')::uuid)`. The `(SELECT…)` wrapper avoids a ~575× regression. `NULLIF` prevents a cast error on pooled connections where the setting is empty.

**`eventTable()`** adds a RESTRICTIVE event-scope policy for event-role-only actors.

**Money tables** add a RESTRICTIVE `app.direct_member` / money-access policy.

**Roles:**

| Role | Purpose |
|---|---|
| `app_user` | Runtime; NOBYPASSRLS |
| `migrator` | Schema owner; direct connection |
| `public_reader`, `marketplace_writer` | Marketplace schema only |
| `ledger_writer` | Owns `post_journal` |
| `platform_reader` | BYPASSRLS; admin and worker only; every use audited |

**Context** is set with `set_config(…, true)` inside the transaction. This is safe with PgBouncer transaction pooling. RDS Proxy is avoided.

**Isolation suite** (blocking merge gate):
1. Schema guard: RLS flags, canonical policy, org-leading indexes.
2. Role guard: runtime role cannot bypass RLS and does not own tables.
3. No-context test: 0 rows returned, and inserts fail.
4. Generated two-org tests for every command and query, plus raw SQL under `app_user` through the pooler.
5. Generated `/v1` tests from OpenAPI: a foreign ID returns 404. Covers a dual-org user and a delegated agency user.
6. Cache guard: same route for two tenants; lint on `use cache` functions without an org key.
7. Job guard: a tenant job without `orgId` is rejected.
8. Ably capability tests.
9. Presigned-URL org-prefix tests.
10. **Canary leak test** (§9).

### 4.4 White-label

**Themes:**
- Zod-validated tokens: primary, accent, surface, text, radius, font allowlist, logos, favicon, OG image, dark mode, email header and footer.
- Derived tokens are computed server-side with contrast ≥4.5:1.
- Delivered as cached CSS variables, per-org `icon.tsx` and `opengraph-image.tsx`, plus the same tokens for React Email, PDF and `design-tokens`.
- Hiding "Powered by" is an entitlement.

**Domains:**
- `org_domains(hostname, kind site|email|tracking|embed, is_primary, status pending_dns→verifying→active→failed, provider_ref, ssl_status, payment_method_domain_id)`.
- Onboarding job, in order:
  1. Vercel Domains API add (queued: 100/h).
  2. Verify.
  3. **Register the domain with Stripe Payment Method Domains**, so Apple Pay and Google Pay appear. This runs for custom domains **and for every `{slug}.yayatoh.events` subdomain at org creation**.
  4. Redis write-through.
- A readiness rule blocks checkout on an unregistered host.

**Email:**
- The platform sender (`mail.yayatoh.com` with the org's display name) is used from M1.10.
- Per-org SES tenant with delegated `mail.{orgdomain}` (Easy DKIM + custom MAIL FROM + DMARC check) comes in M3.5.
- The current Yayatoh sending domain is kept through cutover.

**Seller disclosure** (per `funds_flow`, §5.3):
- `organizer_mor` sales show "Sold by {Org}".
- `platform_mor` sales show "Sold by Pani Digital Services, LLC (Yayatoh) on behalf of {Org}".
- **Organizer-collected sales** (Zelle, cash, POS cash) use a separate receipt variant: "Payment collected by {Org}".
- The seller line cannot be removed. "Powered by" can.

### 4.5 Profiles, entitlements and vocabulary

**Profiles** live in the typed registry `platform/entitlements/profiles/*`: `wedding, gala, concert, conference, community, agency, other`. `community` covers churches, associations and diaspora conventions.

Each profile declares:
- Default modules, navigation and vocabulary overlay (`attendee→guest`, `registration→RSVP`).
- Default settings, onboarding checklist and readiness rules.
- Dashboard layouts by event mode, alert rules and role presets.

Orgs have a default profile. **Each event has its own profile**, because agencies mix weddings and galas.

| Profile | Navigation |
|---|---|
| Wedding | Guests \| RSVP \| Seating \| Seat Finder \| Gallery, plus Website \| Messages \| Day-of (extra tabs need owner OK, D19) |
| Concert | Tickets \| Marketing \| Check-In \| Sales |
| Conference | Registration \| Sessions \| Speakers \| Exhibitors \| Sponsors \| Badges \| Check-In \| Analytics |
| Community | Events \| Tickets & Registration \| Attendees \| Communications \| Donations \| Check-In \| Reports |
| Agency (org level) | Clients \| Events \| Marketing \| Reports |

**Entitlements** (`billing`):
- Tables: `plans`, `plan_prices`, `billing_accounts`, `platform_fee_schedules`, `org_module_entitlements`, `entitlement_overrides`, `usage_events`, `usage_counters`.
- `platform_fee_schedules` scopes: plan | org | event.
- `org_module_entitlements.source` ∈ plan | override | trial | event_addon.

**At launch:**
- Every org is on plan `launch_standard`, which grants all modules in use today.
- Fee schedules reproduce today's model: global commission %, per-event overrides, admin service-fee "taxes" as pass-on lines, organizer taxes, and absorb vs pass-on.
- Each order snapshots its fee schedule.

**Resolution:**
- `effective(org) = (plan ∪ overrides) − suspensions` (Redis 60 s, busted on write).
- `moduleActive(event, key) = effective(org).has(key) ∧ event_modules[event, key].enabled`.
- There are three separate states: **entitled** (commercial), **enabled** (organizer choice) and **visible** (permissions). A downgrade locks a module read-only; data is never deleted.

**Consulted by:**
- Nav composition and route guards (friendly "not enabled" page).
- `defineCommand`.
- `/v1` middleware (403 `module_not_enabled`).
- Widgets, alert rules, readiness rules and public page blocks.
- The webhook catalog and `/v1/mobile/config`.
- Journeys, before each send.
- Local quotas.

**Vocabulary:** base locale → profile overlay → tenant `translation_overrides`. A lint rule flags hard-coded term words.

---

## 5. Domain model

### 5.1 Key tables by module
**Conventions for every table:**
- UUIDv7 primary key; migrated rows use deterministic UUIDv5; the API exposes TypeIDs.
- `org_id` column.
- `timestamptz` for all timestamps.
- Money as `bigint` minor units plus currency.
- Tenant content as locale `jsonb`.
- Status as text with a CHECK constraint, changed only by commands.

| Module | Core tables (key columns) |
|---|---|
| tenancy | organizations, member/invitation/team/organizationRole (Better Auth), event_role_assignments, org_relationships, org_access_grants, agency_report_snapshots, legal_acceptances, onboarding_state, org_suspensions (pause_publishing, pause_checkout, pause_messaging), platform_staff, support_sessions |
| whitelabel | org_domains, themes/brand_kits, nav_overrides, translation_overrides, embed_domains |
| billing | plans, plan_prices, billing_accounts, platform_fee_schedules, org_module_entitlements, entitlement_overrides, subscriptions (dormant), usage_events, usage_counters |
| crm | contacts (email_norm citext unique per org, phone_e164, user_id?, merged_into), contact_channels, consents (channel, purpose, evidence), suppressions, contact_tags, **event_participation** (projection per contact × event: ticket types, has_seat, checked_in, rsvp_status, registered_at, spend), contact_timeline, contact_stats (LTV, RFM, engagement) |
| forms | forms (checkout_questions, registration, rsvp, session_feedback, survey, poll), form_versions (immutable JSON + JsonLogic), form_responses, form_answers (sensitive answers encrypted) |
| content / venues | pages, posts, menus, banners, legacy_redirects; places (global directory), venue_profiles (claimable), venue_layout_versions (immutable), venue_quote_requests |
| events | events (profile, slug, status draft/published/postponed/cancelled/completed/archived, visibility public/unlisted/private, marketplace_listing inherit/on/off, search_indexing, timezone, place/venue, currency, **event_series_id**, payout_org_id, template_id), event_series, event_occurrences (starts/ends/doors, tz), event_modules, event_translations, event_private_info (typed), content_sections, announcements, access_codes/code_uses, event_templates, categories, tags |
| attendees | attendees (event, contact, source ticket/registration/guest/import/comp, ticket_id?, registration_id?, guest_id?, answers, labels, seat_uuid?, status). This is the per-event participant record that the vision's "Attendees" module asks for. |
| ticketing | ticket_types (price, qty total/sold/held, min/max, sale window, early-bird, donation, access_mode, access_dates, transferable, fee_mode, requires_seat), addons, promo_codes/rules/redemptions, tickets (serial, short_code, status, holder_state, rev, attendee_id, seat_uuid, entitlement_bits), ticket_barcodes (format yy1/legacy_eventmie, instance, payload, active; unique on instance + payload), ticket_transfers, claim_links, distributions, waitlist_entries, signing_keys, wallet_passes, ticket_changes (manifest delta feed) |
| orders | orders (status, disputed/on_hold flags, totals, fee_schedule_snapshot, refund_policy_version, manage_token_hash, created_via web/app/pos/invoice/comp/import/offline/legacy, collected_by platform/organizer, acquisition_channel, purchase_host), order_items (ticket, addon, donation, platform_fee, tax, discount), inventory_holds, refund_policies, refund_requests, order_events (append-only), credit_notes |
| payments | payment_accounts (account_class legacy_standard/platform_controlled, capabilities, risk_tier, reserve_bps, release_policy), charges, settlement_batches, settlement_transfers, transfer_reversals, payouts (observed), holds, refunds, disputes (evidence packet), ledger_accounts/journal_entries/postings, tax_calculations, provider_events (unique) |
| seating | layouts (document in cm, checksum, source_layout_version_id), event_layouts (draft/published/locked), event_seats (seat_uuid, category, status, hold_id, hold_expires_at, ticket_id, channel, accessibility, quality_score), seat_assignments (guest/party/ticket/attendee → seat or table), seating_rules, auto_seat_jobs, seat_finder_configs |
| guests | parties (household, envelope, side, VIP, tags), guests (age class, placeholder plus-one, meal, dietary/accessibility encrypted, attendee_id), sub_events, invitations (guest × sub-event), rsvp_history, guest_sites, gallery_items, hosted_tables |
| checkin | entrances, checkpoints (entrance/session/table/zone/virtual), checkin_state (ticket × checkpoint), scan_events (append-only, monthly partitions), devices, device_tokens, sync_batches, fraud_signals, assistance_requests |
| sessions / speakers / exhibitors / sponsors | tracks, rooms, sessions (delivery_mode, in-person/virtual capacity and counters), session_groups, enrollments, favorites; speakers, speaker_tasks, cfp; exhibitors, booths (floor-plan ref), exhibitor_staff, lead_licenses, leads (consent); sponsor_packages (entitlements), sponsorships, deliverables |
| registration / badges / engagement | registration_types, admission_items, registrations, approvals, invoices (PO); badge_templates, print_jobs, printers; polls, qa_questions, networking_profiles (opt-in), meetings, chat_rooms/messages (legacy chat migrates here), engagement_events |
| platform | domain_events (outbox), projector_cursors, processed_events, idempotency_keys, audit_events (monthly partitions, hash chain → Object Lock), bulk_actions/bulk_action_items, media_assets; messages, message_events, message_templates, sending_domains, sender_identities, sms_registrations, whatsapp_accounts/templates, push_tokens, notification_inbox, notification_preferences; metric_snapshots, metric_timeseries, alert_rules, alert_instances |
| marketing / commandcenter / integrations / marketplace | segments, campaigns, campaign_recipients, journeys, scheduled_actions (due_at), tracking_links, link_clicks, attributions; dashboard_layouts, saved_views, exports, report_schedules, readiness_snapshots; api_keys, webhook_endpoints, inbound_webhook_events, integration_connections, field_mappings, sync_runs, external_id_map; public_listings, org_marketplace_enrollment |
| legacy | legacy_ref (instance, table, legacy_id ↔ new_id), compat_ids (instance, entity, integer id; new rows draw from a global sequence starting at 10,000,000 — verify legacy max < 10M in Phase 0), legacy_api_tokens (instance-scoped), legacy_credentials, legacy_settlements, ai_credit_ledger |

### 5.2 State machines
All state machines live in each module's `domain/` and are property-tested.

**Order**
- Main path: `cart → reserved` (holds 10 min, +5 min at payment start) `→ awaiting_payment → paid → partially_refunded → refunded`.
- Failure and expiry: `reserved|awaiting_payment → expired|cancelled`. `payment_failed → awaiting_payment|expired`.
- Offline and invoice: `draft → awaiting_offline_payment|awaiting_invoice → paid|void`. Comps go straight to `paid`.
- `paid → cancelled` voids all tickets and refunds in full.
- Flags: `disputed`, `on_hold`.
- `paid` is set only from a verified webhook, a comp, or an audited finance action.

**Ticket**
- Lifecycle: `active → transfer_pending → transferred`. Transfer is void-and-reissue: the new ticket gets a new barcode and wallet pass.
- `transfer_pending → active` on decline or expiry.
- `active → void{refunded|cancelled|fraud|organizer}` and `active → expired`.
- Holder: `unassigned → assigned → claimed`. `rev` bumps on holder or seat change.
- Admission is tracked in `checkin_state`, not on the ticket: `not_admitted → admitted ⇄ exited`. A reversal is a new event.

**Charge, settlement transfer, payout**
- Charge mirrors the Stripe PaymentIntent states.
- Settlement transfer: `scheduled → on_hold → releasable → submitted → paid → partially_reversed | reversed`. Also `submitted → failed → releasable`.
- Payout (observed from webhooks): `pending → in_transit → paid | failed | canceled`.

**Refund**
- `requested → approved | rejected` (policy engine: platform minimum > org > event > ticket type).
- `approved → pending → succeeded | failed → manual_resolution`.
- Recovery after the funds were transferred: `none → reversal_pending → reversed | receivable → collected | written_off`.

**Dispute**
- Stripe states. Internally: `evidence_draft → organizer_review → submitted`. Never auto-submitted.

**Registration**
- `submitted → pending_approval → approved → awaiting_payment → confirmed`. For approval flows the card is saved; `capture_method=manual` is used within 7 days.
- Other transitions: `denied`, `waitlisted → offered(ttl)`, `modified`, `substituted`, `cancelled`.

**RSVP invitation** (guest × sub-event)
- `invited → sent → viewed → responded(attending|declined|maybe)`. Responses are editable until the deadline, then `locked`. `no_response` is derived.
- Plus-one: `unnamed → named`. Every change is written to `rsvp_history` with its source.

**Session enrollment**
- Atomic `UPDATE sessions SET enrolled_x = enrolled_x + 1 WHERE id = $1 AND enrolled_x < capacity_x RETURNING`.
- `enrolled → attended | no_show | cancelled`.
- `waitlisted → offered(ttl) → enrolled | expired | declined`.
- Physical and virtual capacity are counted separately.

**Seat**
- `available → held` via one statement: `UPDATE event_seats SET status='held', hold_id=$h, hold_expires_at=$t WHERE event_id=$e AND seat_uuid = ANY($ids) AND status='available' RETURNING seat_uuid`, under a `lock_timeout`. The row count must equal n, otherwise roll back.
- `held → sold | available` (release or expiry). `available ⇄ blocked{channel|ada|kill}`. `sold → available` on void.
- A sweeper runs every 30 s. The layout locks after the first sale; `seat_uuid` is immutable.

**Device**
- `pending_enrollment` (5-min code) `→ enrolled → online ⇄ offline` (2 missed 30-second heartbeats).
- Then `wipe_requested → wiped`, or `revoked`. It expires 24 h after the event.

**Alert instance**
- `normal → pending → firing → acknowledged | snoozed → resolved`.
- Acknowledged alerts re-fire after 60 min, or 10 min if live-critical.
- The evaluator runs every 5 min in planning, 1 min pre-show, and 15–30 s live.

**Campaign and message**
- Campaign: `draft → scheduled → sending (snapshot) ⇄ paused → sent | partially_failed | canceled`.
- Message: `queued → held (quiet hours / throttle) | suppressed → sending → sent → delivered | bounced | failed | complained`, plus `failed → fallback` (a child message on the next channel).

### 5.3 Payments: hybrid funds flow (owner decision, keeps today's model)

**One `PaymentProvider` port, two funds flows.** The flow is chosen per org and recorded on every order as `funds_flow`.

| | `organizer_mor` (connected organizers, today's main path) | `platform_mor` (unconnected organizers, today's fallback) |
|---|---|---|
| Who is merchant | The organizer | Yayatoh (Pani Digital Services) |
| Charge | **Direct charge** on the organizer's connected account (`Stripe-Account` header), with `application_fee_amount` = platform fee + admin tax. Same model as legacy. | PaymentIntent on the platform account |
| Payout | Stripe pays the organizer on the connected account's own schedule | **Separate charges & transfers, transfer at release** (tiers below). Replaces today's manual "Transferred" settlement. |
| Refunds | Refund on the connected account. `refund_application_fee` follows the policy engine. | Refund on the platform. After transfer, create an explicit transfer reversal. |
| Disputes and losses | The organizer's (Standard accounts carry their own liability) | Yayatoh's, recovered from held funds, then the reserve, then a receivable |
| Radar / fraud | The connected account's Radar, plus Yayatoh's pre-checkout risk rules | Platform Radar Plus: block ≥75, review ≥65, 3DS step-up on high `yayatoh_risk` |
| Sales tax | The organizer's responsibility | Yayatoh as liable party via `TaxProvider` (counsel) |
| Receipt line | "Sold by {Org}" | "Sold by Pani Digital Services, LLC (Yayatoh) on behalf of {Org}" |

**Accounts**
- New organizers are offered embedded Connect onboarding. Once onboarded, they move to `organizer_mor`.
- Existing Standard accounts stay Standard. The country is no longer hard-coded to US; non-US organizers are inventoried in Phase 0.
- `payment_accounts` records `account_class`, capabilities, requirements and `funds_flow`.
- Every tenant domain is registered with Payment Method Domains **on the platform and on each connected account that sells on it**, because direct charges show wallets per connected account.

**Funds flow for `platform_mor`**
1. Sale: the platform keeps the funds. The ledger posts organizer proceeds to `org.payable_held`.
2. The Payout Release job moves funds to `payable_releasable` and `reserve` according to the org's release policy.
3. Yayatoh creates the **Transfer** (`source_transaction`, `transfer_group`).
4. Agency commission is a second transfer in the same group.

For `organizer_mor`, the ledger records the gross amount and the application fee as memo and revenue entries, reconciled against `application_fee` objects.

**Release tiers** (for `platform_mor`; defaults for owner and finance, D3):

| Tier | Release rule |
|---|---|
| Standard (default) | Event end + 5 business days. Today's site promises 5–7. 5% reserve until the dispute window closes (+60–120 days). |
| Trusted | Optional weekly advances up to a set % of settled past sales |
| New / high-risk | Manual release; capped sales before KYC |

Funds held on the platform must stay within Stripe's holding limit, reported as 2 years in the US but UNVERIFIED. Confirm in M0.1. The fallback for far-future events is partial advances.

**Refunds**
- **`organizer_mor`:** refund on the connected account (`Stripe-Account` header). Whether the application fee is refunded depends on the policy. Legacy refunds were manual in the dashboard; the new platform calls the API.
- **`platform_mor`**, before transfer: refund the platform charge; the ledger reverses `payable_held`.
- After transfer: refund the charge **and** create an explicit **transfer reversal** (`POST /v1/transfers/{id}/reversals`). `reverse_transfer` applies only to destination charges.
- If the reversal fails: the org gets a `receivable`, netted from future transfers. `debit_negative_balances` applies on platform-controlled accounts.
- Platform minimum: organizer cancellation, or postponement over 90 days with no new date, refunds 100% of face value plus the platform fee.
- The cancellation wizard previews the shortfall.

**Disputes**
- A hold is placed on org funds: held funds first, then the reserve, then a receivable.
- The evidence packet is built from check-in logs, access logs and messages, within 4.5 MB / 19 pages. A human always reviews it before submission.

**Organizer-collected sales** (Zelle, cash): no charge is created. The platform fee becomes an org receivable, netted from the next transfer or invoiced. These sales use the separate receipt variant in §4.4.

**Ledger**
- Double-entry, posted only through `ledger.post_journal` (SECURITY DEFINER, owner `ledger_writer`).
- Each journal balances to zero per currency and has a unique idempotency key. Entries are immutable; corrections are reversing entries.
- Accounts:
  - Platform: `stripe_cash`, `processing_fee_expense`, `platform_fee_deferred`, `platform_fee_revenue`, `sales_tax_payable:{jurisdiction}`, `dispute_*`.
  - Per org: `payable_held`, `payable_releasable`, `reserve`, `receivable`.
  - Per agency: `commission_held`.
- Fees are deterministic at checkout from the fee snapshot. Yayatoh absorbs any variance against actual Stripe fees.
- A daily three-way reconciliation compares the ledger, Stripe balance transactions, and transfers. Drift raises an alert.

**Counsel items (start in M0.1; they gate live money in M1.6):**
- Marketplace-facilitator sales tax and admissions/amusement tax in MD, DC, VA and others.
- 1099 form type (Stripe 1099 product).
- Money-transmission posture for held funds.
- ASC 606 gross vs net revenue.
- FTC all-in pricing rule (16 CFR 464).
- Organizer agreement: set-off, clawback, reserves, indemnity. Needed before the private beta.
- Card-network monitoring of Yayatoh's single account.
- International events stay out of scope; `funds_flow = organizer_mor` is a reserved seam.

**Legacy carry-over**
- The hybrid model matches today's code (§1.3b), so **connected organizers keep their commercial terms**.
- Unconnected organizers move from manual settlement to automated transfer-at-release. Their open `commissions` rows become owner-signed opening balances.
- Legacy direct-charge orders are refunded on the connected account with the `Stripe-Account` header. Their disputes stay the organizer's.
- **Legacy bugs are not carried over.** Old code retrieved sessions without the `stripe_account` header, and codes 2 and 5 disagreed on the "transferred" flag.
- Same Stripe account.
- Every migrated payment records its `charge_model` (legacy_platform, legacy_direct_connected, legacy_destination, paypal, offline, sct), so refunds route correctly, e.g. with the `Stripe-Account` header where needed.
- Cashier `cus_` IDs and `acct_` IDs carry over.

### 5.4 Offline check-in protocol

**Manifest** (per event, optionally scoped to a checkpoint), synced by `seq` delta. Each row holds:
- ticket id, short code, `rev`, status, ticket type, entitlements, seat label
- holder display name and phone last 4
- **per-event-salted hashes of the normalized email and E.164 phone**, for exact-match offline lookup
- hashes of legacy payloads
- The header carries public keys, checkpoints, rules and server time.

**Manifest protection:**
- Encrypted at rest (SQLCipher on native; the PWA can only obfuscate).
- Expires 24 h after the event.
- Remote wipe.

**Offline verdicts:**

| Scan | Verdict |
|---|---|
| Valid signature, `rev` equals manifest, active, not yet admitted locally | admit |
| Already admitted on this device | duplicate |
| `rev` lower than manifest | reject: superseded (transferred or reissued) |
| Valid signature, not in manifest, `issued_at` after the last sync | org policy (D17): default provisional admit, flagged for reconciliation |
| Not in manifest, issued before the last sync | reject |
| Bad signature | reject |

**Cross-device duplicates:**
- Online devices check with the server (p95 under 300 ms) and receive realtime scan pushes.
- Fully offline devices cannot see each other's scans. On reconnect, first-wins by corrected device time (`device_ts + clock_offset`). Losing scans become `duplicate_offline` and raise an alert **within 60 s of reconnect**.
- An optional LAN hub for all-offline venues is deferred (Phase 6).

**Sync:**
- Batches of up to 500 scans, with UUIDv7 `scan_id` and `ON CONFLICT DO NOTHING`.
- Heartbeat every 30 s reporting battery, queue depth and clock offset.

---

## 6. APIs, integrations, realtime and messaging

### 6.1 `/v1`
- **Base:** `api.yayatoh.com/v1`, OpenAPI 3.1 committed to the repo. Changes are additive only. `Deprecation`/`Sunset` headers. **oasdiff and Spectral are blocking gates.**
- **Auth:**
  - User JWT (15 min) with rotating 60-day refresh families (reuse detection, PKCE).
  - Org API keys `yy_live_`/`yy_test_` (hashed, scoped, optional event list). Test keys map to a linked sandbox org in Stripe test mode.
  - Device tokens, portal tokens and order-manage tokens.
  - OAuth client credentials for partners in Phase 6.
  - No cookies on `/v1`.
- **Org selection:** a `Yayatoh-Org` header, required when the user has several orgs.
- **Pagination:** cursor only (`limit` ≤ 100). Bracket filters, `expand[]` to depth 1, sparse fields.
- **Errors:** RFC 9457 problem+json with stable codes, mapped to UI text in 13 locales.
- **Idempotency:** `Idempotency-Key` required on money, ticket, message and scan POSTs. Kept 24 h and fingerprinted; 409 while in flight, 422 on mismatch.
- **Rate limits:** Upstash token buckets with `RateLimit` headers. Limits are **keyed to be tolerant of shared IPs** (venue Wi-Fi, CGNAT):

| Scope | Limit |
|---|---|
| Per API key | 600/min |
| Search | 60/min |
| Scanner batch | 3,000/min |
| Seat finder and code lookup | Per device cookie + event, 30/min, then a Turnstile challenge instead of a block |
| Login | Per account 5 per 15 min, plus per IP 100/min |
| OTP | Per destination |

- **Mobile:**
  - `X-Yayatoh-Client` header, which can trigger a 426.
  - `GET /v1/mobile/config`: minimum versions, flags, base URLs, QR public keys.
  - `/v1/me/*` and `/v1/me/organizations` (member or delegated).
  - Wallet passes, checkout sessions (PaymentSheet), seat map, RSVP, agenda.
- **Scanner:**
  - `devices:enroll`, `heartbeat`
  - `GET /events/{id}/manifest?since={seq}` in pages under 4.5 MB
  - `POST /scans:batch`, `POST /checkins`
  - `GET /events/{id}/lookup`
  - device commands (resync, wipe)
- **SDKs:** `@hey-api/openapi-ts` for TypeScript; openapi-generator for Swift 6 and Kotlin; Scalar docs.

### 6.2 Legacy `/api/v2` facade (`packages/legacy-v2`)
- **Mount:** a Hono sub-app at `apps/web/app/api/v2/[...route]`, plus legacy payment returns, `/stripe/webhook` and transactional URL handlers. **The instance comes from the Host header only** (`yayatoh` | `abc`).
- **Route coverage:** every route with app traffic, from `route:list --json` including unnamed routes, joined with access logs, app source and golden HARs:
  - Auth and profile: login, register, register-guest, logout, social-login, send-otp, forgot-password, email/resend, user, profile, profile/update, update-fcm-token.
  - Discovery: events, countries, banners, venues, organiser, organiser-mail, pages.
  - Buying: book-tickets, apply-promocode, seat_status, my-bookings, bookings/cancel, get-booking-details, invoice-download.
  - Organizer: myevents and organiser bookings CRUD.
  - Scanning: scan-ticket-camera, scan-ticket-laser, verify-checkin.
  - Event codes: event-code/*.
  - Messaging: messages, notifications, chats, `/api/chats/*`, block/unblock.
  - Private info and qPay: `/api/events/{id}/private-info`, qPay (if kept).
  - Payment returns.
  - The list is final at M0.8.
- **Legacy shapes are quirky (§1.3b).** Most responses are the `view()`-override envelope `{data: {...}, status: true}`, sometimes double-nested. Error shapes are mixed, and validation only returns 422 JSON when `Accept: application/json` is sent. The facade reproduces the exact shape per route from the golden HARs.
- **Wire compatibility is byte-level:**
  - Paths, methods, status codes and snake_case keys.
  - The exact paginator envelope.
  - Error bodies: `{"message":"Unauthenticated."}`, 422 `{message, errors}`, 429 + `Retry-After`, 500 `{"message":"Server Error"}`.
  - Decimals as strings, 0/1 flags, per-field date formats, the same nulls.
  - Diffs use strict-type semantic JSON.
- **Allowlist exception:** fields leaked today (§1.3) are dropped. Only fields the apps read (verified from source and HAR) are returned.
- **Integer IDs:** `compat_ids`, scoped by instance.
- **Sanctum:**
  - Split on the first `|`, look up `(instance, id)`, then `timingSafeEqual(sha256(rest), stored)`.
  - Enforce expiry and update `last_used_at` asynchronously.
  - `/api/v2/login` mints Sanctum-format tokens until sunset.
- **Behavior:** handlers call the same commands as `/v1`; there is no business logic in the facade.
- **Scanning:** scan endpoints accept legacy and yy1 payloads. If Phase 0 shows the old apps **draw the QR from IDs on the device**, new tickets also get an active `legacy_eventmie` barcode for as long as old app versions are live.
- **Telemetry and control:** per route × app version × instance, a kill switch per route, 426 and 410 per §7.5.

### 6.3 Webhooks and integrations
- **Outbound:** events marked `public` go through webhook serializers to Svix.
  - Standard Webhooks signatures, `whsec_` secrets, 5-minute tolerance.
  - `payload_mode` full or thin per endpoint; thin by default for PII events.
  - SSRF blocking at registration.
  - The event catalog is generated into the docs.
- **Inbound:** `/v1/inbound/{provider}/{connection?}` verifies the raw body, persists the event (unique provider event id), acks in under 1 s, and processes asynchronously.
- **Stripe** uses two endpoints: platform (`@self`: charges, transfers, refunds, disputes) and Connect (`@accounts`: `account.updated`, payouts).

**Integrations by phase:**

| Phase | Integrations |
|---|---|
| 1 | Stripe, Apple/Google Wallet, ICS, embeddable ticket widget |
| 6 | Zapier, Slack, Google Sheets live sync, HubSpot Marketing Events, Mailchimp, Klaviyo, Eventbrite importer; then Salesforce, SSO + SCIM (Better Auth plugins, runner-up Ory Polis, WorkOS for contracted enterprise), Make, n8n, Google Calendar, QuickBooks/Xero, Zoom |

### 6.4 Realtime and messaging
- **Realtime channels:**
  - `org:{o}:event:{e}:ops|scans|seats`
  - `org:{o}:user:{u}:inbox`
  - `device:{d}`
  - `public:event:{e}:seats` (subscribe-only)
- **Tokens:** minted from `Ctx`. Counters are aggregated every 2–3 s. Two inline sharded counters (16 slots) track checked-in counts.
- **Messaging pipeline:** `MessageIntent{orgId, templateKey, purpose, recipient, channels, dedupeKey}` → `messages` (unique `dedupeKey` such as `event+recipient+type`) → **policy gate** → render → `ChannelAdapter` → provider webhooks → `message_events` → domain events → `usage_events`.
- **The policy gate checks:**
  - consent and suppression
  - quiet hours in the recipient's timezone (federal plus state rules, e.g. TX, FL, OK)
  - frequency caps and the WhatsApp message category
  - the org kill switch
- **Also in the pipeline:**
  - Segment counting for GSM-7 and UCS-2; 6 of the 13 locales are UCS-2.
  - Fallbacks: WhatsApp → SMS after 30 min; push → email.
- **Sender tiers:**
  - Platform default: Yayatoh toll-free number + 10DLC campaign, platform WABA, `mail.yayatoh.com`.
  - Per-tenant sending domains, 10DLC and WABA on white-label tiers (M3.5).

---

## 7. Migration and mobile continuity

### 7.1 Ground rules
- **No production changes except M0.0.** Extraction runs from backups or a replica, never the live primary. Nothing touches `abc.yayatoh.com` until ABC's event end + 14 days.
- **Clean room.** Eventmie and Laravel code is read only to write behaviour specs and test vectors. No vendor code, templates or assets are copied. The owner confirms the license terms.
- **Data handling.** Production dumps live only in an isolated, encrypted `legacy-ref` environment. Development uses a deterministic masked dataset built with keyed hashes, which keeps duplicate structure intact. Secrets go into Doppler, never chat or git.
- **`legacy-ref` environment.** Docker compose with PHP 8.3 + Laravel per instance, MySQL at the production version, Postgres 18, mitmproxy and Playwright. It is the reference for every differential test.

### 7.2 Phase 0 audit steps and artifacts

| # | Step | Artifact | Milestone |
|---|---|---|---|
| 1 | Access and account ownership (Apple, Google, Firebase, Stripe incl. Connect, PayPal, Twilio, mail, OpenAI, Google OAuth, Apple Sign-in, DNS, SSH, GSC/GA, Eventmie license) | Access and ownership register | M0.1 |
| 2 | Source intake + reproducible `legacy-ref` for both instances (`artisan about`, `composer show`) | Environment + dependency inventory | M0.1 |
| 3 | Vendor diff against stock Eventmie at the exact version. Both instances share one codebase, so instance divergence is config, Voyager settings and data only; confirm the deployed commit on each host. | Custom-surface map + instance config/data divergence report | M0.2 |
| 4 | `route:list --json` per instance, joined with 90-day access logs by route × host × client | Route inventory + usage heatmap + dead routes | M0.2 |
| 5 | Business rules: checkout, commission and tax rounding, promo, cancel/refund, failed bookings, settlement; 200 generated cart quotes | Domain rules spec + quote fixtures + fee-settings export | M0.2 |
| 6 | Jobs and cron, every Mailable/Notification/SMS/WhatsApp/push path, FCM legacy vs v1, providers, SPF/DKIM/DMARC | Job and message catalog | M0.2 |
| 7 | Payments: code paths, Connect account types, charge-model matrix from a 12-month sample, webhook endpoints, disputes, **unsettled balances**, PayPal/mesdoh/qPay volumes, whether abc shares the Stripe account | Money-flow map + open-liabilities report | M0.2 |
| 8 | Auth artifacts: hash prefixes, Sanctum settings, active tokens, remember-me, magic links, OTP, social IDs, APP_KEYs into the vault | Auth compatibility spec + test vectors | M0.2 |
| 9 | Infra, DNS, TLS, media manifest (paths + SHA-256), freeze calendar (events, on-sales, ABC dates), history coverage for year-over-year metrics | Infra inventory, media manifest, freeze calendar, history report | M0.2 |
| 10 | Legacy API contract: Scramble in `legacy-ref`, quirks ledger, **golden HARs** from the real store builds on devices | Legacy OpenAPI + quirks + HAR set | M0.3 |
| 11 | Ticket credentials and scanner rules: decode 50 real tickets, where the QR is rendered, rule table, verdict corpus | Credential spec + verdict corpus | M0.3 |
| 12 | Mobile dossier ×2: RN version, shared codebase, base URLs, **certificate pinning**, token storage, Firebase projects, offline scanner storage, AASA, SDKs, license, Xcode 26 / API 36 build attempt | App dossier + gate scorecard | M0.3 |
| 13 | Content, SEO and URLs: Voyager export, GSC 16-month export, polite crawl, DB-derived URLs | URL inventory + redirect map v0 + protected list (top 200) | M0.3 |
| 14 | Schema and data profile for both instances: counts, zero dates, JSON validity, case duplicates, orphans, `app.timezone`, **cross-instance overlap** | Data dictionary + overlap report | M0.4 |
| 15 | Seat-chart spec (units, image sizes, hold TTL, per-date charts) + 3-chart import prototype | Seat import spec + visual fixtures | M0.4 |
| 16 | Mapping spec (YAML per table, Zod-validated JSON blobs) + R0 timed ELT | Mapping spec v1 + R0 timing | M0.4 |
| 17 | Findings, resolved UNVERIFIED items, mobile gate scoring, Stripe and counsel answers | **Phase 0 decision memo** | M0.8 |

### 7.3 Parity matrix
The matrix lives at `docs/parity/parity.yaml`, rendered to Markdown. Each row records:
- `id`, feature, surfaces, legacy evidence, `usage_90d` per instance
- disposition: **preserve / improve / replace / retire**
- target milestone, acceptance criteria, test IDs
- `cutover_blocking`, owner sign-off

**CI gate:** a blocking row without a passing test fails the cutover tag. Only features actually used on an instance gate that instance. Changing a disposition requires a `parity-change` PR approved by the owner.

**Seed rows:**

| Legacy feature | Disp. | Acceptance |
|---|---|---|
| Home, `/events` filters, event page (all sections, states, repetitive, online), `/e/{short}`, tag pages | Improve | Same result sets; visual review of top 30; valid JSON-LD; LCP ≤2.5 s |
| Root organizer URL, venues + quote, Voyager CMS | Replace/Preserve | 308 to `/o/{slug}`; slugs kept; leads delivered |
| 13 locales, RTL, per-user tz | Preserve | All keys ported; `/lang/{code}` works |
| Auth (bcrypt, remember-me, Google/Apple, verify, reset, OTP, magic, guest) | Preserve | 100% of test vectors pass |
| Sub-organizers + impersonation | Replace | Access equal or narrower; audited |
| Ticket types (all fields incl. `access_dates`, donation, early-bird, taxes, limits) | Preserve | 200 fixture carts quote identically to the cent |
| **Fees** (commission %, per-event override, service fee, organizer tax, absorb/pass-on) | Preserve exactly | 100% of historical bookings recompute; explained exceptions only |
| Checkout (multi-date, fields, promo, kids/seated/standing, hold timer, guest) | Improve | Timer = legacy default; all fields captured |
| Stripe Checkout direct charges + application fee (connected) / platform charge + manual settlement (unconnected) → hybrid `funds_flow` + ledger | Preserve model, Replace mechanism | Live $1 buy + refund on each flow; application fees reconcile; opening balances reconcile to the cent |
| PayPal, mesdoh, qPay, Zelle/offline, POS | Decided by usage | Kept items pass E2E |
| Dormant gateways, `/test-payment`, installer/BREAD/compass | Retire | Return 404/410 |
| Bookings lifecycle, failed-booking recovery, complimentary/bulk, resend | Preserve | Every state reachable |
| Ticket and invoice PDFs, download URLs, calendar link | Preserve | Legacy URLs resolve with the same auth |
| **Distribution** (buyer + organizer, WhatsApp, association tags, revoke, received tickets) | Preserve+ | E2E buy → distribute → claim → scan; association reports equal legacy |
| Attendees import/label/tag/seat/check-in/export; guest lists | Improve/Replace | Legacy sample files import unchanged |
| Image seat charts, per-date charts, holds, seat on ticket | Replace | Every booked seat resolves; no double sale |
| Attendee portal seat finder + printed posters | Preserve | `/events/{slug}/attendee` and poster QR codes resolve |
| Web/app scanning, One/All, rules, scanner dashboard | Improve | **Verdict corpus identical**; 100% of legacy QR vectors pass |
| **Fraud detection** (duplicate scans, unpaid block, window checks, chat reports, whatever Phase 0 finds) | Improve | Legacy signals reproduced + new ones (§ M1.9) |
| Sessions, speakers, exhibitors, sections, announcements (push), codes, private info, directory, chat | Preserve (lightweight) | Content and flows match; private info restricted to ticket holders |
| Emails, SMS, WhatsApp send, push tokens, newsletter + Mailchimp, contact organizer | Preserve/Improve | Every trigger mapped; no duplicate sends across cutover |
| Organizer and admin reports, commissions, exports | Improve | Golden queries equal |
| AI creation + purchasable credits | Preserve at cutover | Balances carry 1:1 |
| `/api/v2` for both apps | Preserve | 0 unexplained twin-snapshot diffs |
| `abc.yayatoh.com` branding + CMS + affiliate events | Replace | All abc URLs identical |

### 7.4 Coexistence
**No shared-MySQL write phase.** New modules talk only to Postgres. Differential testing on twin snapshots replaces the idea of "proving it on shared data."

**Front door: Next.js on Vercel.**
- `proxy.ts` reads a routing table (Redis/config): host + path pattern → next or legacy, with rollout %.
- Cookie overrides: `yy_canary=next`, `yy_legacy=1`.
- Anything not moved is externally rewritten to `origin-yay.` or `origin-abc.yayatoh.com`. nginx accepts those only with a secret header.

**Laravel changes behind the front door:**
- `TrustProxies` must be configured. Otherwise the `throttle` middleware sees one IP for all users and locks everyone out.
- Check `APP_URL`.
- Keep cookie names distinct.

**Gating spike (M2.4):** a 25 MB upload, a 150 s response and a 60 MB stream through the rewrite. If any fails and cannot move direct-to-storage, fall back to a Cloudflare Worker for the migration period only. **If Phase 0 finds certificate pinning**, no TLS change happens until the bridge build is adopted, and nginx on the Laravel box is the router until then.

| Stage | Moves | Source |
|---|---|---|
| A0 | yayatoh.com front door live at 100% pass-through; one-week soak | — |
| A1 | Marketing pages, `/blogs/*`, `/pages/*` (Voyager editing frozen for yayatoh.com), `robots.txt`, sitemap index | New CMS |
| A2 (optional) | `/`, `/events` listing, `/venues/*`, read server-side from Laravel's public JSON (after M0.0 hotfix, allowlisted, 60 s cache). `/events/{slug}` stays on Laravel because checkout lives there. | Laravel JSON |
| Beta tenants | Invite-only new orgs on `app.yayatoh.com` + `{slug}.yayatoh.events` with live payments (M2.1). Their tickets are not in the old apps; attendees use web and wallet passes. | Postgres |
| B-Y | yayatoh.com: **all stateful surfaces at once** (auth, event pages + checkout, bookings, distribution, portal, dashboard, seating, check-in, admin, `/api/v2`, webhooks, cron) | Postgres |
| B-A | abc.yayatoh.com: tenant import into the live DB + custom-domain attach | Postgres |

**Instance order: yayatoh.com first (B-Y), then abc (B-A).** Central login, the API host, Stripe webhooks and the marketplace live on yayatoh.com. That makes abc a pure "tenant import + custom domain" job, reusing a pipeline already proven in production. The Yayatoh app also has the smaller install base.

**Freeze rules:**
- **Hard rule:** no cutover within ±72 h of any event with sales or check-ins.
- **Soft rules:** avoid ±7 days of an on-sale or distribution push. Tuesday or Wednesday, 02:00–05:00 ET.
- **B-A window:** ≥21 days after B-Y, ≥30 days after ABC 2026's financial wrap (refunds processed, settlements recorded), ≥60 days before the ABC 2027 on-sale.
- **If no window exists,** abc stays on Laravel through ABC 2027.
- **Laravel code freeze** from T−30 d (hotfixes only).
- **Stripe between B-Y and B-A:** if both instances share the Stripe account, the new handler stores unknown-object events as `unmatched`, and events are deduplicated by `event.id`.

### 7.5 Data migration
**Pipeline:** `pnpm migrate:legacy --instance=yay|abc --mode=rehearsal|cutover`.
1. Dump from backup or replica, restore into MySQL at the production version.
2. pgloader into `legacy_{inst}.*`:
   - DATETIME becomes `timestamp` **without** time zone.
   - `tinyint(1)` becomes smallint; zero dates become null; unsigned becomes bigint.
   - TEXT stays as-is; JSON is parsed by `try_jsonb()`, and failures go to quarantine.
3. Versioned idempotent SQL transforms.
4. Validation.
5. Quarantine rules: money and ticket tables must quarantine **zero** rows; content tables may quarantine up to 0.5% with owner sign-off.
6. Masked-data rehearsals run nightly in CI.

**IDs.**
- Migrated rows get a **deterministic UUIDv7**: the timestamp comes from the row's `created_at`, and the remaining bits from `SHA-256(instance|table|legacy_id)`.
- Rehearsals are therefore reproducible, and index locality matches new rows.
- `legacy_ref` and `compat_ids` are scoped by instance.
- Raw legacy rows are kept for 12 months.

**Transform stages:**
- **T1 Identity**
  - Merge key: `lower(nfkc(trim(email)))` → one global user. Either instance's `$2y$` hash is accepted for 180 days, then rehashed to Argon2id.
  - **Pre-hijack guard:** a credential from a never-verified account with no paid booking is not carried into a merged account.
  - Conflicting Apple/Google IDs go to manual review.
  - Beta-tenant users with the same email are merged at cutover, and the verified 2.0 credential wins.
  - Platform staff come **only from an owner-approved list**. abc admins become ABC org admins.
- **T2 Orgs**
  - Each organizer on each instance becomes an org, with its owner membership.
  - Sub-organizers become memberships plus event roles (Manager → event_manager, POS → box_office, Scanner → door_staff).
  - The abc instance becomes the parent **ABC** org owning `abc.yayatoh.com`. Other abc organizers become `host_affiliate` child orgs.
  - Voyager settings become themes. Orphans go to an exceptions report and are never dropped.
- **T3 Catalog**
  - Venues become org venues or the platform directory.
  - Categories: yayatoh.com becomes the platform taxonomy; abc categories become org tags or mapped categories.
  - Events get typed sub-entities. **`event_series` is inferred** (same org + normalized title across years), with owner review, and editable in the UI.
- **T4 Commerce**
  - Bookings grouped by `(instance, order_number)` become orders, items and tickets (`compat_id` = legacy id). Attendees are created from each ticket.
  - Each payment carries its `charge_model`. Cancellations become refunds; failed bookings are archived; promo redemptions carry over.
  - `commissions` become `legacy_settlements`. **Unsettled amounts become owner-signed opening balances.**
  - The legacy fee schedule is migrated exactly.
- **T5 Operations**
  - Check-ins become `scan_events(source=legacy_import)` and `checkin_state`.
  - Also migrated: distributions (association, revoked), attendees, guest lists, codes, private info, sessions, speakers, exhibitors, sections, announcements.
- **T6 Communications history (full)**
  - Notifications, chats, reports and blocks carry over.
  - Newsletter subscribers become consents (`evidence=legacy_newsletter`).
  - **Consent is never invented.** Other buyers and attendees get `consent_status=unknown_legacy`, and the messaging policy gate decides per purpose and jurisdiction.
  - Mailchimp keys are envelope-encrypted.
- **T7 Content:** Voyager content becomes per-org CMS. yayatoh.com goes to the platform org; abc content goes to ABC.
- **T8 Auth artifacts**
  - Personal access tokens are migrated per instance.
  - Magic-login tokens are kept until expiry. Reset tokens are kept only if under 60 minutes old at freeze. OTPs are skipped.
- **T9 Derived data**
  - Contacts, `event_participation` and `contact_stats` are built.
  - Year-over-year `metric_timeseries` are backfilled.
  - `domain_events` are backfilled with **`replayed=true`**. Journeys and automations ignore these, so historic purchases never trigger emails.

**Time.**
- System timestamps use `AT TIME ZONE <app.timezone>` (America/New_York is likely; confirm). DST fall-back rows are logged.
- **Event wall-clock fields are venue-local**, stored as local time plus the event's IANA timezone derived from the venue location. ABC Chicago uses America/Chicago.
- A spot check covers 50 events. Legacy comparisons made against the server clock are recorded as known bugs; the fix uses venue time.

**JSON blobs** become typed rows, validated with Zod:
- `is_publishable`, `private_info`, `access_dates`, social links, video, images, attendee details, `tax_data`, user settings.

**Media.**
- `rclone copy --checksum` into R2 under `legacy/{inst}/…` one week ahead, with a delta copy during the freeze.
- `https://{host}/storage/*` is rewritten per host for at least 24 months.

**Legacy QR codes.**
- `ticket_barcodes` uniqueness is on `(instance, payload)`.
- The scanner checks the legacy format first, then yy1, using the event context.
- Issued codes are never regenerated.
- If a code is URL-based or signed with APP_KEY, that route or key is kept alive.
- Gate: 100% of active tickets resolve to exactly one ticket.

**Seat charts.**
- Each chart becomes `layout_v1`: the image as an underlay plus one seat point per legacy seat.
- `seat_uuid = uuidv5(ns, "{inst}:seat:{id}")`.
- Coordinates are converted to centimetres from the image's natural size; per-date charts become one layout per occurrence.
- Gates: every referenced seat exists, and the Playwright screenshot diff is within tolerance.

**Stripe and Connect.**
- `stripe_id` goes to `billing_customers`; `stripe_account_id` goes to `payment_accounts(legacy_standard)`, refreshed from the API.
- Connected organizers keep direct charges (hybrid model), so their terms don't change. The first new-platform charge per account is smoke-tested.
- If Standard accounts cannot receive transfers, **M2.6** re-onboards those organizers.

**AI credits** are not implemented in legacy (the balance is hard-coded to 10). There is nothing to migrate, and the AI drafting allowance is a new design (D12).

**Audit-derived transform specifics:**
- **QR codes.** The legacy QR payload is `order_number` (raw or JSON). The resolver matches `(instance, order_number)`. If an `order_number` is duplicated within an instance (it isn't unique in the DB), it is quarantined for owner review.
- **Check-ins.** `checkins` rows (per booking per day) become `scan_events` + `checkin_state`, with the time-of-day in UTC combined with the regional date.
- **Attendee email.** The email held in `attendees.address` becomes the contact email when it is valid.
- **Seat coordinates.** `"Xpx,Ypx"` (or legacy `{left, top}`) becomes centimetres, scaled from the chart image's natural size. `capacity` > 1 becomes a table.
- **Distributions.** Distributable parent bookings and `transfer` child bookings map to distribution records.

**Validation** (every rehearsal and T−0):

| Check | What it verifies | Pass condition |
|---|---|---|
| V1 | Row counts with split factors | — |
| V2 | Money per event × instance (net, commission, earning, tax, refunds) | Equal to the cent |
| V3 | Status distributions | — |
| V4 | Referential integrity | 0 orphans |
| V5 | Merged users vs distinct emails; approved staff list | — |
| V6 | QR, token, bcrypt, remember-me and signed-URL vectors | 100% pass |
| V7 | About 40 golden queries | 0 diff |
| V8 | Facade twin diff | 0 unexplained |
| V9 | Every inventoried URL returns its planned status | — |
| V10 | Checksums | — |
| V11 | RLS flags + two-org probe | — |
| V12 | Timezone spot checks | — |

**Rehearsals:**
- Nightly masked runs.
- R1 at M0.8, untimed.
- R2 at parity, timed.
- R3 at T−14 with the full runbook.
- R4 at T−5 on a fresh production snapshot, with device smoke tests.
- Go requires 3 consecutive green runs, and the last timed run must take ≤70% of the window.

**Rollback before the point of no return (PONR).**
- **Before the flip:** revert the routing table.
- **After the flip:** a tested reverse ETL copies post-cutover writes into MySQL using `compat_id` ≥ 10M, then the route flips back. New-only features stay flagged off until PONR.
- **Post-cutover SCT orders during this window:** no transfers are released before PONR. A runbook script refunds these orders directly in Stripe. R2 must rehearse refunding one after a rollback.
- **PONR = T+48 h, or the first payout-release run, whichever is earlier.** After that, fix forward only.

### 7.6 Mobile continuity
**Push.**
- `fcm_token` and `apn_token` move to `push_tokens(user, app yayatoh|abc, platform, firebase_project, source=legacy)`.
- FCM HTTP v1 needs a service account per Firebase project, and APNs needs the `.p8` key (owner provides both).
- Sends use the credentials of the app that issued the token.

> **Scope note (owner decision):** no mobile app is built in this build. The facade keeps the current store builds working, with no sunset date. Everything below from "Bridge build" through "Timeline" is the **plan for the future mobile build** (§8.3), kept so it is ready when that build is scheduled.

**Bridge build** (future; from the current codebase, if the M0.8 gate G1/G2 passes):
- Adds the `X-Yayatoh-Client` header.
- Handles 426 (iOS dialog; Android In-App Updates, immediate) and 503 with `Retry-After`.
- Calls `GET api.yayatoh.com/v1/mobile/config`.
- Removes or relaxes certificate pinning.
- Builds with the Xcode 26 / iOS 26 SDK and targets Android API 36.
- Store hygiene: move the privacy URL off staging, align privacy labels, fix the ABC in-app-purchase flag.
- Ships at T−45 d before B-Y. It is a **cutover gate only if pinning exists or current builds mishandle 503.**

**Pre-bridge builds** cannot handle 426. They are pushed to upgrade in-band:
- an "Update required" item in `/api/v2/banners`
- notifications and push
- email
- at enforcement, a login 422 whose `errors.email[0]` says to update, while authenticated calls return 401

**Mobile gate (M0.8)**, scored from audit step 12:

| # | Criterion |
|---|---|
| G1 | Source reproduces store builds 1.0.3 and 1.2.3 |
| G2 | Builds on Xcode 26 / API 36 with ≤5 days of dependency work |
| G3 | One TypeScript codebase with flavors and a single API client |
| G4 | ≤10% of dependencies stale for more than 18 months; New Architecture compatible |
| G5 | License allows modification and redistribution |
| G6 | Offline storage, runtime theming and deep links possible without rewriting more than half the screens |
| G7 | Crash-free sessions ≥99% |

- G1, G2 and G5 pass, plus ≥3 of G3/G4/G6/G7 → **Branch A: evolve the existing app** (add Expo modules and EAS, move screens to `/v1`).
- Otherwise → **Branch B: Expo SDK 57 rebuild in `apps/mobile`**, sharing the universal packages. The old codebase is frozen to bridge and security fixes.
- If G1 or G2 fails, skip the bridge build and rely on the facade plus in-band forcing.

**After the gate, both branches converge on the same apps:**
- **Yayatoh** (attendee container app, as an update to the existing listings).
- **Yayatoh Staff** mode or app (scanning, lookup, device management, Command Center lite).

**Keeping users logged in across the app upgrade.** The first new app release, under the same bundle IDs, reads the legacy Sanctum token from its old storage key. It calls `POST /v1/auth/legacy-exchange` to get a v1 refresh token, so users never re-login. Whether an Expo build can read the RN storage location is UNVERIFIED and is tested in the M0.8 spike.

**Push continuity caveat.** If Phase 0 shows Laravel still uses the legacy FCM server key (shut down July 2024), push is already broken today. The parity row becomes "restore", not "preserve".

**ABC.**
- ABC stays on its listings through the facade.
- The ABC app is a client-branded app under Pani Digital's developer account. That carries an **Apple 4.2.6 exposure**, and a Yayatoh-account branded variant would have the same problem.
- **Recommendation:** after ABC 2026, stop updating the ABC app and fold ABC into the Yayatoh container app (org picker, join by code, `abc.yayatoh.com` deep links). The ABC listing points to Yayatoh and is removed from sale at B-A + 90 d. Existing installs keep working through the facade until sunset.
- **Runner-up (paid branded tier):** transfer the listings to ABC's own developer accounts (ABC enrolls with a D-U-N-S number). Build from the Expo variant (D8).
- Any ABC Android fix after Nov 1 2026 needs the targetSdk 36 uplift.

**Timeline:**

| Point | Event |
|---|---|
| T−45 d | Bridge ships |
| B-Y | Facade serves yayatoh.com |
| B-A | Facade serves abc |
| ≥90% adoption (between T+45 and T+120) | `min_supported` = bridge version |
| B-A + 60–120 d | V1 apps on `/v1` |
| V1 ≥95% adoption **and** V1 + 90 d | `/api/v2` returns 410 |
| 30 days of zero traffic | Facade code deleted |

**Testing:**
1. Twin-snapshot differential test: the same MySQL snapshot runs Laravel in `legacy-ref`, and its ELT output runs the facade. Golden HARs plus Schemathesis requests are replayed against both, with type-strict diffs. The target is **0 unexplained**.
2. A contract gate in CI.
3. Source-built store tags run in the iOS Simulator and Android emulator.
4. **Actual store builds on physical devices** (owner), pointed at staging via a DNS override. Staging uses real certificates for the legacy hosts, issued via DNS-01 with `_acme-challenge` delegated.
5. k6 load test at 3× peak on the scan and booking endpoints.

### 7.7 SEO and URL continuity
- **Unchanged paths:**
  - `/events/{slug}`, `/events/{slug}/tag_{tag}`, `/events/{slug}/attendee` (kept indefinitely because of printed posters)
  - `/venues/{slug}`, `/blogs/{slug}`, `/pages/{slug}`
  - `/about-us`, `/features`, `/faq`, `/contact`, `/login`, `/register`, `/join-event`
  - `/e/{short}`, `/storage/*`
- **Changed paths:**
  - Root `/{organisation_url}` → 308 to `/o/{slug}`. The legacy slug list is frozen.
  - `/lang/{code}` sets the locale and returns 302 back (this fixes today's 500).
  - Dashboard paths → 308 to `app.yayatoh.com`.
- **Redirect storage:** `legacy_redirects(host, source, match, target, status, hits)`, served by `proxy.ts` and kept at least 12 months.
- **Transactional links** resolve by `(instance, legacy id)`: ticket, multi-ticket and invoice downloads; magic login until expiry; signed email verification with **that instance's APP_KEY**; in-flight resets; distribution links; unsubscribe. The same auth rules apply as legacy. Expired links land on a "send a new link" page.
- **Callbacks keep their paths:**
  - `/stripe/webhook`: same signing secret. Returns 503 during the freeze; Stripe retries for 3 days.
  - `/stripe/success|fail|response|app-response`: also complete legacy sessions; open sessions are expired at T−2 h.
  - `/connet/stripe/response`, PayPal callbacks, `/login/google/callback`, the Apple return URL.
  - New OAuth URIs are added **alongside** the old ones (owner registers them).
  - AASA and assetlinks are served byte-identical.
- **Additions:**
  - Per-host `robots.txt` and sitemap index with real `lastmod`.
  - Canonical rules per §4.2. ABC events are not added to the marketplace.
  - hreflang only for real translations.
  - JSON-LD fixes and absolute `og:image`.
  - A CI guard that production never sends `noindex`.
- **Monitoring:**
  - Rich Results Test on 20 pages.
  - Synthetic checks on the protected list every 15 min for 14 days.
  - Daily 404 report.
  - GSC alert when clicks drop more than 20% week over week.
  - Core Web Vitals.

### 7.8 Cutover runbook (per instance)

| When | Actions | Gate |
|---|---|---|
| T−30 d | Window confirmed; organizer email and banner drafted by Claude, sent by owner; Laravel code freeze; R3 scheduled | Parity gate green; current store builds pass the facade HAR suite; certificate pinning ruled out |
| T−14 d | R3 passes; k6 at 3× peak; security review; counsel/terms updates for the platform-MoR flow | Go/no-go signed |
| T−7 d | DNS TTL 60 s; for B-A, certificate pre-issued via TXT; webhook/OAuth/PayPal URIs registered; redirects and sitemaps loaded; attendee email ("tickets stay valid; update the app"); in-app banner; status page | 3 green rehearsals; facade diff 0; store-build smoke test; restore drill |
| T−5 d | R4 on a fresh snapshot | ≤70% of window |
| T−2 h | Checkout paused in Laravel; open Checkout Sessions expired; queues drained | — |
| **T−0** | Maintenance status posted. **Read-only freeze**: GETs still served by Laravel; writes and `/api/v2` writes return 503 + `Retry-After`. Scheduler and workers stopped. No writes confirmed (binlog position). Dump → ELT → V1–V12 → **go/no-go #1**. Media delta, reindex, cache warm. Smoke tests: bcrypt login for both instances, a real device's existing Sanctum token, a live $1 purchase + refund (owner's card), **a refund of one legacy order via its recorded charge path**, a legacy QR scanned in the old app and the PWA, seat finder, dashboard vs golden queries, email, push → **go/no-go #2**. Route flipped to 100%; MySQL made read-only; new scheduler on | Freeze target 45 min; **abort at 90 min** |
| T+2 h to T+1 d | Watch 4xx/5xx, app versions, deliveries, login rate; payment reconciliation; 404 review; support triage | — |
| T+48 h | **PONR**, or the first payout run if earlier | Owner confirms |
| T+7 / T+30 / T+90 d | Enable deferred features and retro / Laravel read-only period ends, first monthly fee reconciliation / upgrade enforcement decision and redirect review | — |

**Rollback triggers** (before PONR):
- Any cross-tenant exposure.
- A double charge.
- Payment failures above 2% for 15 min.
- Login failures above 3× baseline for 30 min.
- Facade 5xx above 1% for 15 min.
- Legacy QR false rejects above 0.5%.
- Any money validation discrepancy.

UI defects are fixed forward.

**B-A (tenant import mode):**
- Only `abc.yayatoh.com` is frozen.
- Transforms insert into live tables in batches and merge users against the live `users` table.
- The abc APP_KEY is loaded.
- The abc CNAME is switched to Vercel.
- Smoke test with the ABC store build; walkthrough with the ABC organizer.

### 7.9 Decommissioning
- **Read-only period.** From T+0 the MySQL user is read-only. Laravel admin reads stay available for 30 days behind VPN or basic auth.
- **Archive at T+30 d.** Servers stop. The final dump, media snapshot, code and encrypted `.env` go to cold storage in a separate account, kept 24 months. Payment records stay in Postgres for 7 years.
- **Staging.** `staging.yayatoh.com` is retired only after the iOS privacy URL has moved off it.
- **APP_KEYs**, one per instance, are kept for **13 months**, since remember-me cookies last 400 days. Retired after 30 days of zero use once 12 months have passed.
- **`/api/v2`** stays live until a future mobile build replaces the current apps (§8.3). It is then sunset per §7.6.
- **Leftover legacy data.** Redirects are reviewed at 12 months. `legacy_{inst}` schemas are dropped at 12 months. `legacy_ref`, `compat_ids` and `ticket_barcodes` stay as long as legacy tickets or apps exist.
- **Secrets.** Every legacy secret is rotated.

---

## 8. Phased roadmap

### 8.0 Planning model
**Increment.** One vertical slice, one PR of about 150–600 changed lines. It carries its own tests, sits behind a flag, and fits one Claude Code session.

**Sizes.** S ≤6 increments, M 7–14, L 15–24. Anything bigger gets split.

**Throughput.** 2–3 git worktrees give about 7–10 net increments per week after roughly 20% rework, **if**:
- the owner approves risk-tagged PRs within 1–2 business days, and
- the owner runs one demo per week.

PRs not tagged as risky auto-merge after green CI plus automated `/code-review`.

**External waits.** Store reviews and carrier, Meta or Zoom approvals start one milestone early.

**Every milestone delivers:**
- Merged code behind a flag.
- A spec with numbered acceptance criteria.
- Tests mapped to those criteria.
- ELT transforms and golden queries where legacy data is involved.
- An OpenAPI diff where APIs change.
- A demo checklist and an acceptance record.

**Verification codes:**

| Code | Meaning |
|---|---|
| U | unit |
| I | integration on real Postgres |
| ISO | tenant isolation |
| C | contract (oasdiff / HAR) |
| MIG | migration validation |
| E2E | Playwright |
| A11y | axe |
| L | k6 load |
| X | offline drill |
| D | owner demo |

**Indicative calendar** (start Oct 2026, ranges):

| Phase | Increments | Elapsed | Landmark (from kickoff) |
|---|---|---|---|
| 0 Discovery & foundations | ~60 | 6–10 wk | — |
| 1 Platform core + parity | ~230 | 23–32 wk | — |
| 2 Migration & cutover | ~50 | 6–10 wk to B-Y; B-A +2–6 wk; 6-month tail | yayatoh.com cutover month 9–12 |
| 3 Command Center + marketing | ~125 | 12–18 wk | Public launch month 11–14 |
| 4 Weddings & galas | ~70 | 7–10 wk | Complete month 14–18 |
| 5 Conference & enterprise | ~120 | 12–17 wk | Complete month 17–22 |
| 6 Expansion tracks | ~180 | 18–26 wk | Full vision month 21–28 |

**Biggest levers:** parity waivers for unused features (15–25% of Phase 1), a steady third worktree, and owner reviews within 24 h.

The gala and holiday season, and the blackout rule, may push B-Y into early 2028. The freeze calendar (audit step 9) sets the real date.

### Phase 0 — Discovery and foundations
**Exit:**
- Decision memo signed.
- Parity matrix triaged.
- Golden HARs and legacy contract captured.
- Mobile gate decided.
- Walking skeleton deployed: two themed tenants and a dashboard, with every CI gate blocking and gate self-tests passing.
- Nightly masked ELT green.
- Counsel and Stripe engaged.

**M0.0 Legacy security hotfix (M, first; scope from §1.3b)**
- The fix list (file and line references, order of work, verification checks) is kept **out of this public repository** and held by the owner and their developer, who implement and deploy it (owner decision).
- It covers the §1.3b findings, rotating the legacy secrets, reviewing records for abuse, closing the data leak in §1.3 (after an authenticated replacement ships for any field the store apps read), rate limits, and an audit of every unauthenticated route.
- **Acceptance:** a contract test over captured responses finds none of the sensitive fields, and both store apps still work (HAR spot-check on devices).
- **Who does it:** the owner's current developer. Claude Code supplies the private fix list and re-audits the patched code read-only.
- **Owner:** deployment, key rotation, abuse review, customer communication, legal assessment.

**M0.1 Access, accounts, environments and legal kickoff (S)**
- Audit steps 1–2.
- GitHub org with branch protection and merge queue.
- Accounts: Vercel, Neon (prod, staging, previews), Fly, Upstash, R2, Doppler, Sentry, Axiom, Ably, SES sandbox, Stripe test mode, Twilio test credentials.
- **Buy the tenant apex and submit it to the Public Suffix List.**
- DNS for `app.yayatoh.com`.
- Credential matrix: Claude Code gets dev, preview and staging access only.
- **Kick off counsel** (tax, 1099, money transmission, FTC, organizer agreement) **and Stripe** (hybrid model review, SCT for unconnected orgs, holding limit, wallet domains on connected accounts).
- **Acceptance:** every PR gets a preview deploy with its own Neon branch; a script proves no production credential is reachable.

**M0.2 Legacy audit and parity matrix (M)**
- Audit steps 3–9.
- **Deliverables:** `docs/legacy/*`, parity matrix v1, UNVERIFIED register.
- **Acceptance:** 100% of routes are inventoried; every table is mapped or marked archive/drop.
- **Owner:** triage rows; explain qPay/mesdoh, AI credit sales and fee arrangements.

**M0.3 Contract capture, credentials, mobile dossier and URLs (M)**
- Audit steps 10–13. Output goes to `packages/legacy-contract`.
- **Acceptance:** replay against `legacy-ref` passes 100%; every endpoint referenced in app source is covered.
- **Owner:** device HAR captures; test accounts; signing and console access.

**M0.4 Data audit and ELT harness (M)**
- Audit steps 14–16.
- `packages/etl` covering validation, quarantine and nightly masked runs. Timezone ADR.
- **Acceptance:** row counts match; ≥10 golden queries pass; re-runs are idempotent.
- **Owner:** run the masker against production dumps; refresh the snapshot monthly.

**M0.5 Monorepo, operating model and CI gates (M)**
- Layout per §3.4, generators, CLAUDE.md files, `.claude/` config (§9).
- Copy `docs/research/` and add superseded banners.
- ADR set, spec and PR templates, every CI gate, Renovate, gitleaks.
- **PDF spike:** Arabic, Hindi and Japanese tickets, plus tagged-PDF output.
- **Acceptance (gate canaries):** a deliberately bad PR for each gate is rejected — cross-module import, table without RLS, oasdiff break, axe violation, over-budget bundle, planted secret, leaked canary field.

**M0.6 Tenancy, outbox and entitlement kernel — walking skeleton (L)**
- Organizations and Better Auth memberships.
- `defineCommand`/`executeCommand`; `withTenant`; RLS emitters (`NULLIF`); roles.
- Schema guard, isolation harness, canary fixtures.
- Outbox with gap-free relay; pg-boss.
- `audit_events`, `idempotency_keys`.
- Entitlements with a `launch_standard` plan and legacy `platform_fee_schedules`.
- Profiles registry.
- `proxy.ts` host resolution and theme CSS variables.
- Admin shell.
- **Acceptance:**
  - Two orgs render distinctly themed sites.
  - A planted leak is caught.
  - RLS p95 overhead under 10% on a 1M-row table.
  - Revoking an entitlement hides the nav item and returns 403 with no deploy.
  - Consumers stay idempotent under replay.

**M0.8 Phase 0 decision gate (S)**
- Audit step 17: decision memo, mobile gate scorecard (§7.6), Stripe and counsel answers, first-round owner decisions, R1 rehearsal.
- Re-size the mobile milestones for the chosen branch.
- (M0.7 is intentionally unused; identity work lives in M1.2.)

### Phase 1 — Platform core and parity
**Exit:**
- Parity matrix 100% accepted on staging.
- Facade replay 100%.
- Scan verify p95 under 300 ms at 20 scans/s total.
- Checkout at 3× the legacy peak.
- Offline drill passed.
- axe clean on public, checkout and seat-picker pages.
- Restore drill done.
- Runbooks v1.

**M1.1 Design system, shell and i18n (M)**
- Tailwind tokens; shadcn on Base UI.
- Profile-driven navigation and vocabulary.
- next-intl with 13 locales and RTL.
- problem+json → UI messages.
- Empty, loading and error states.
- Notification-center shell.
- Drag alternatives.
- **Acceptance:**
  - **Owner-approved reference designs for ~8 key screens:** event page, checkout, dashboard home, attendee list, seat editor, scanner, Command Center, RSVP.
  - axe passes and visuals match in en and ar at **375, 768 and 1280 px, dashboard included**.
  - Switching profile swaps labels with no code change.
  - Lint blocks literal strings.
- **Owner:** choose a visual direction; name the translation owner. Optionally hire a contract designer for 1–2 weeks.

**M1.2 Identity, auth and roles (M)**
- Better Auth.
- Legacy bcrypt → Argon2id; Sanctum, remember-me and signed-URL verifiers.
- Google and Apple sign-in; OTP and magic link.
- TOTP for owners, admins and finance.
- Central login with handoff codes.
- Invites, roles and event roles; the authz evaluator.
- Impersonation (audited, 1 h, blocks money, export and delete).
- Turnstile; shared-IP-tolerant rate limits; guest checkout identity.
- **Acceptance:**
  - Legacy vectors log in and get rehashed.
  - A scanner cannot read orders.
  - An impersonator cannot refund.
  - A tenant cookie is valid only on its host.

**M1.3 Organizations, onboarding and platform admin (L)**
- Signup: invite-only until M3.11, with a profile picker.
- Setup checklist; brand kit with a contrast check; DPA/ToS click-wrap.
- Connect embedded onboarding (payouts only; required only once paid tickets exist).
- Domain lifecycle through Vercel and Payment Method Domains, including tenant-apex subdomains.
- Legal pages, locale, timezone and currency settings.
- Admin v1: tenants, kill switches, entitlement overrides, fee schedules, Connect status, payout holds.
- **Acceptance:**
  - End-to-end signup with Stripe test KYC.
  - A domain goes from pending to active.
  - "Pause checkout" takes effect within 60 s.

**M1.4 Events, venues and content (L)**
- Typed events and occurrences, including repetitive and multi-day events.
- **Event series.**
- Online events; private, coming-soon and sold-out states; short URLs.
- Three-screen wizard and readiness engine v1.
- Templates and duplicate-as-template.
- Venues: directory, org-owned venues, quote requests.
- Categories and tags; private-info portal; custom sections; announcements; access codes.
- Lightweight sessions, speakers, exhibitors and sponsors.
- Media pipeline.
- Tenant CMS; reviews.
- AI drafting with the migrated credits ledger.
- **Acceptance:**
  - Duplicating an event never copies orders.
  - Blob transforms pass the golden queries.
  - An SVG with script is neutralized.

**M1.5 Ticketing, checkout, tickets, contacts and attendees (L)**
- Ticket types: tiers, sale windows, early-bird, limits, donation, `access_dates`.
- Promo codes; legacy fees and taxes via fee snapshots.
- Postgres inventory; holds with a sweeper.
- Payment Element with Apple Pay and Google Pay on both funds flows (direct charge on the connected account, or platform charge).
- Guest checkout with OTP.
- **Forms engine v1** for checkout questions, including kids/seated/standing counts.
- **Contacts core + consents**, created at checkout.
- **Attendees** created at ticket issue.
- Offline/Zelle and POS sales with a separate receipt.
- Per-event currency.
- Tickets: PDF, Ed25519 QR + short code, Apple and Google Wallet; legacy payloads stored.
- **All-in price display.**
- **Acceptance:**
  - 200 concurrent buyers for 10 tickets never oversell.
  - The fee snapshot is immutable.
  - The QR verifies with only the public key.
  - Duplicate or out-of-order webhooks fulfil once.
  - **Every displayed price includes mandatory fees:** event page, listing, widget and API (FTC).
- **Owner:** Apple Pass Type ID; Google Wallet issuer; counsel opinion before live money.

**M1.6 Payments operations and payouts (M)**
- Inbound webhook gateway.
- Double-entry ledger with daily reconciliation.
- Settlement batches and **transfer at release** by tier, with reserves.
- Refunds (full, partial, per line); **explicit transfer reversals**; receivables.
- Refund policy engine with the platform minimum.
- Disputes and the evidence packet.
- Settlement view replacing the legacy "Transferred" checkbox, with migrated settlements.
- Radar rules; 1099 setup.
- **Acceptance:**
  - Property test: ledger totals equal charges minus refunds, fees and transfers.
  - Refund-after-transfer scenarios pass with Stripe test clocks.
  - A dispute places the hold.
- **Owner:** D3; Stripe live activation; accountant sign-off.

**M1.7 Seating and tables (L)**
- `@yayatoh/floorplan` in centimetres with stable `seat_uuid`.
- Sections, tables, rows and seats, plus stage, booth, entrance, exit, dance floor and custom objects; VIP sections.
- Konva editor: snap, rotate, multi-select, undo, autosave, templates, image underlay.
- Event layouts that lock after the first sale.
- **Postgres holds.**
- Buyer picker with an **accessible list mode**; per-date charts; seat printed on the ticket.
- Organizer assignment: **drag a guest, party or attendee onto a table or seat**, with a list/keyboard alternative and an unseated queue.
- **Public interactive venue map** showing entrances, stage and booths.
- Public seat finder (name/email lookup, OTP, poster).
- Availability over Ably with SSE fallback; `seating_rules` schema; legacy import.
- **Acceptance:**
  - Every migrated seat exists.
  - A seat race produces one winner.
  - A 5,000-seat map runs at ≥50 fps on an iPad profile.
  - Keyboard-only assignment works end to end.

**M1.8 Attendees, guest lists, distribution, bulk actions and search (L)**
- Attendee list with server-side filters, labels and tags.
- **Global search / command palette:** find an order, attendee or ticket by name, email or code across events.
- Import pipeline: map, preview, job, failure report, undo.
- Guest lists with bulk email.
- **Bulk-action framework:** ids or filter, registry, progress, partial failures, undo window, audit.
- Distribution: claim links, association tags, email/SMS/WhatsApp as legacy does, revoke.
- Magic-link attendee self-service.
- Contact timeline v1.
- Exports as jobs.
- **Acceptance:**
  - A 5k-row import finishes in ≤60 s with ≥97% accepted.
  - Assigning 1,000 seats in bulk shows progress, and undo restores it.
  - A claimed ticket's old QR is rejected.

**M1.9 Check-in and onsite v1 — Scan PWA (L)**
- `checkin-engine`; camera (zxing-wasm) and HID input; Auto/Manual; One/All modes.
- Offline protocol per §5.4.
- Rules: unpaid, time window, event-day-only, access dates.
- Lookup by name, phone or email (hashed offline).
- Manual check-in and undo.
- Entrances and checkpoints.
- Device enrollment, heartbeat and wipe.
- Legacy QR support; scan history; scanner dashboard with live counts.
- **Fraud signals:**
  - duplicate and invalid bursts
  - the same ticket at two entrances within N seconds
  - device velocity anomalies
  - signature failures
  - transfer churn (many transfers or rapid chains)
  - card-testing and purchase-velocity flags from checkout
  - chat abuse reports
  - each surfaced as an alert and on the order timeline
- **Acceptance:**
  - Drill: 3 devices, Wi-Fi off, 300 scans including 20 cross-device duplicates, 10 invalid and 5 unpaid.
  - **Zero lost scans. Zero same-device double admissions. Every cross-device duplicate flagged within 60 s of reconnect.**
  - p95 under 300 ms at 20 scans/s total.
  - No email or full phone number in the manifest.
- **Owner:** D17; test hardware; a physical drill.

**M1.10 Notifications and messaging core (M)**
- Platform senders: SES, Twilio toll-free/10DLC, WhatsApp as legacy does.
- FCM v1 and APNs with migrated tokens; web push.
- React Email templates with org and locale overrides.
- In-app inbox and preferences.
- Announcement push.
- Organizer↔customer messaging.
- 1:1 chat at parity, with report and block.
- Per-order message log; reminder idempotency; one-click unsubscribe.
- **Acceptance:**
  - All templates render in 13 locales, RTL included.
  - A duplicated job sends once.
  - A migrated token receives push.
- **Owner:** SES production access and DKIM; **start toll-free verification, 10DLC and Meta business verification now**; FCM service account; APNs key.

**M1.11 Marketplace, tenant sites and SEO (L)**
- `yayatoh.com`: home, listings, event page, `/o/{slug}`, venues, blog, pages.
- Tenant sites.
- The `public_listings` projection; canonical rules (§4.2).
- JSON-LD; sitemaps, robots and hreflang; per-org OG images.
- `legacy_redirects`; `/e/{short}`; legacy transactional URLs.
- Org-tagged caching.
- Embeddable ticket widget.
- **Acceptance:**
  - The top GSC URLs return 200 or 308.
  - Rich Results pass on 20 pages.
  - Cache guard green.
  - Lighthouse performance ≥90.
  - The canary crawler finds nothing.

**M1.12 Reports and organizer dashboard v1 (M)**
- Metric registry with `as_of`.
- Organizer and event totals, net revenue, booking search, complimentary and failed bookings, code stats, check-ins, sales breakdowns.
- Admin commission report.
- Exports to R2.
- **Acceptance:** totals equal the golden queries; a 50k-row export completes.

**M1.13 `/v1` core and `/api/v2` facade (L)**
- `/v1` per §6.1; mobile auth; `/v1/mobile/config`; scanner endpoints.
- The facade per §6.2.
- Scalar docs; the TypeScript SDK.
- **Acceptance:**
  - 100% of HARs match for both apps.
  - Migrated tokens work without re-login.
  - oasdiff is clean.
  - Store builds complete login → buy → ticket → scan on staging.

**M1.14 Security, privacy and ops readiness (M)**
- Two CSP profiles; WAF and BotID; rate limits; org-facing audit view.
- PITR plus off-account dumps, with a restore drill.
- Status page, on-call rota, runbooks v1, SLO alerts.
- Privacy notice, sub-processor list, DPA; DSAR tooling; retention jobs.
- k6 load tests; ZAP; accessibility audit; threat model.
- **Acceptance:** restore RTO ≤1 h; zero high ZAP findings; k6 thresholds met.

**M1.15 Mobile continuity without a mobile build (S)** — *mobile apps are planned but not built in this build (owner decision; §8.3)*
- The `/api/v2` facade (M1.13) keeps the current store builds working indefinitely.
- `/v1` exposes the mobile-ready endpoints (auth, tickets, wallet, check-in, RSVP, agenda) with generated TS/Swift/Kotlin SDKs, so a future app build starts from a stable contract.
- App-version telemetry per route on the facade.
- **Owner, metadata only (no new binaries):** move the iOS privacy URL off staging, correct privacy labels, resolve the ABC IAP flag.
- **Acceptance:** current Yayatoh and ABC store builds pass the full golden-HAR suite against the new backend; the telemetry dashboard shows traffic by app version.

### Phase 2 — Migration and cutover
**Exit:**
- Both hosts served by the new platform.
- Laravel read-only, then archived.
- 30 days with no SEV1 and SLOs met.
- `/api/v2` sunset progressing on telemetry.

| Milestone | Scope and acceptance |
|---|---|
| **M2.1 Private beta and first live events** (S + event support; starts after M1.14) | 1–2 invite-only organizers as new tenants on the apex with live payments (prefer a seated gala or concert of 200–1,000 people). Organizer agreement signed. Acceptance: zero lost scans, zero oversells, payout per policy, debrief turned into ADRs and fixes. |
| **M2.2 Migration completeness** (M) | Transforms T1–T9 at 100%; user dedupe; affiliates; series inference; media. Acceptance: V1–V12 pass for both instances; full run ≤60 min. |
| **M2.3 Parity UAT on migrated data** (M) | Twin-snapshot journeys (buy → distribute → claim → check-in → seat finder → refund); owner UAT per matrix row; 2–3 friendly organizers on staging. Acceptance: every blocking row passes; zero open P0/P1. |
| **M2.4 Front door and read surfaces** (S) | Front-door spike; A0–A2 per §7.4. Acceptance: one-week soak with no regressions; Core Web Vitals and 404s watched. |
| **M2.5 Cutover tooling and rehearsals** (M) | `make cutover`; read-only freeze mode; reverse ETL; comms templates; R2–R4. Acceptance: freeze ≤45 min (abort at 90); rollback rehearsed in ≤15 min, including refunding an SCT order after rollback. |
| **M2.6 Payout-account readiness** (S, conditional) | If Standard accounts cannot receive transfers: re-onboard affected organizers to platform-controlled accounts, with comms from T−30. Acceptance: 100% of organizers with future events are payout-ready. |
| **M2.7 yayatoh.com cutover (B-Y)** | Per §7.8. Acceptance: go/no-go smoke set passes; 14-day 404/GSC watch. |
| **M2.8 abc.yayatoh.com cutover (B-A)** | Tenant-import mode per §7.8. Acceptance: ABC app HAR replay passes against production; history present; ABC sign-off. |
| **M2.9 Hypercare and decommission** (S + tail) | Per §7.9. **The `/api/v2` facade stays live** until a future mobile build replaces the current apps (§8.3). |

### Phase 3 — Command Center + marketing and communications (owner priority 1)
Phase 3 starts after B-Y is stable. M3.1 plumbing may start during Phase 2 waiting periods if the owner approves (D28).

**Exit:**
- Command Center live mode used at ≥2 real events.
- A segmented campaign and the five-step journey running with attribution.
- Public launch.

**M3.1 Event pipeline and realtime platform (M)**
- Projectors into `metric_snapshots` and `metric_timeseries`; sharded counters.
- Generalized realtime publisher.
- Analytics sink interface.
- **Acceptance:** projector lag p95 ≤2 s at 20 scans/s; cross-org channel attach is denied.

**M3.2 Command Center v1 — planning and pre-show (L)**
- Widget registry (module, role, profile, mode).
- Role layouts: owner, ops, finance, door, marketing.
- **Event modes:** planning → pre_show (T−24 h) → live (doors −2 h to end +2 h, venue timezone) → wrap (+7 d).
- Readiness score. Alert engine with states, grouping and ack timeout.
- **Rules for modules that exist now:**
  - unseated attendees; undistributed tickets (≥10 or ≥5%)
  - failed or stuck payments; refund surge
  - devices offline, low battery, queue backlog
  - capacity 95/100%; sell-out 90%; sales pace ≤70%
  - readiness blockers; domain/SSL; Connect requirements past due
  - deliverability; automation failures
- Alerts route in-app, by email and by SMS, with a deep link into the relevant bulk action.
- **Acceptance:**
  - Fixtures produce exactly "37 attendees do not have seats", "120 purchased tickets have not been distributed", "14 payments failed" and "Three check-in devices are offline", and each resolves when fixed.
  - The door layout shows no revenue.

**M3.3 Command Center live mode (M)**
- Live feed; check-in speed per entrance and device; entry locations.
- Duplicate and invalid monitor; device board; venue capacity gauges; staff presence.
- **Guest assistance queue** (a "Need help" button in the seat finder, plus staff scanner requests).
- TV mode; live-critical escalation.
- **Acceptance:** tiles ≤3 s p95 under simulated load; offline alert within 90 s.

**M3.4 Staff mode in the Scan PWA (M)** — replaces a native Staff app for this build
- Command Center lite (live counts, device board, alerts) inside `apps/scanner`, installable to the home screen.
- Web push alerts to staff; kiosk and supervisor modes.
- **No lead retrieval** — that is M5.6, also in the PWA.
- **Acceptance:** 600 offline scans sync exactly once; feedback in ≤300 ms on a mid-tier Android in Chrome and on iOS Safari.

**M3.5 Messaging platform and compliance (L)**
- Consent ledger with evidence; suppressions; preference center.
- Policy gate: quiet hours incl. state rules, caps, WhatsApp category.
- Per-org SES tenant and sending domain; optional per-tenant 10DLC.
- **WhatsApp Cloud API** (utility templates, Embedded Signup); fallback chains.
- Provider webhooks; usage metering; deliverability auto-pause.
- **Messaging cost recovery before plans exist:** per-org included quotas with admin-set limits.
- **Acceptance:**
  - SMS without consent is blocked with a reason.
  - Texas Sunday quiet hours are respected.
  - A complaint rate above 0.3% auto-pauses the org.
- **Owner:** D16; TCPA counsel.

**M3.6 CRM core, audiences and campaigns (L)**
- `event_participation` and `contact_profile` projections.
- Segment DSL → SQL with a builder.
- **The vision's three audiences as templates:**
  - VIPs who bought but have not selected seats
  - last year's attendees not registered this year (series-relative)
  - registered but not checked in
- Block editor with brand kit; test sends; schedules; recipient snapshot; per-tenant throttles.
- **Acceptance:** the three audiences return exact fixture results; a 50k send stays fair across tenants.

**M3.7 Automations and journeys (M)**
- pg-boss `scheduled_actions` journeys.
- Triggers: purchase, check-in, time relative to the event (RSVP trigger added in M4.1).
- **Vision journey template:** purchase → confirmation; T−7 d reminder; T−24 h SMS/WhatsApp; event-day push; post-event survey.
- Cancellation hooks; reschedule on date change; run history; failure alerts.
- **Acceptance:**
  - A time-travel test sends 5 messages at the right offsets.
  - A date change reschedules pending steps.
  - Retries never duplicate sends.
  - Backfilled `replayed` events never trigger a journey.

**M3.8 Attribution and marketing analytics (M)**
- Link redirector on tenant domains.
- UTM plus a signed click ID; first- and last-touch attribution.
- Campaign → registrations and revenue tiles.
- Deliverability alerts.
- **Acceptance:** an end-to-end click → purchase is attributed.

**M3.9 Surveys v1 (S)**
- Post-event survey and session feedback on the forms engine.
- Signed single-use links.
- Journey step "After event → Survey".
- Response reporting and NPS.
- **Acceptance:** the vision journey collects responses; reminders stop once answered; one response per person.

**M3.10 Orders and support console (L)**
- Unified order timeline.
- Ticket transfers with claim step (void + reissue + wallet update).
- Waitlists with timed offers; return-to-waitlist.
- Refund-request queue with SLA; refund policy editor (tighten only for future orders; policy text snapshotted).
- Cancel/postpone wizard with financial preview and resumable mass refunds.
- Credit notes; dispute queue; support macros.
- **Acceptance:** cancelling an event with 1,000 orders refunds in a resumable batch, skips disputed charges and reconciles.

**M3.11 Public launch (S)**
- Open self-serve signup under the current fee model.
- Pricing/fees page, help center, marketing site, status page, launch comms, on-call rota.
- SOC 2 Type I kickoff.
- **Gate:** 30 days stable after B-Y, ≥2 live events on the new platform, and M3.2 + M3.5 + M3.6 shipped.

### Phase 4 — Weddings, galas and social (owner priority 2)
**Exit:** a real wedding or gala runs end to end — RSVP → seating → seat finder/kiosk → check-in — without the organizer seeing enterprise screens.

**M4.1 Guests, parties and RSVP (L)**
- Party → guest model; placeholder plus-ones; groups, tags, side.
- Import from paste, CSV/XLSX, or a one-time Google Sheet.
- **Contact collector:** a public form where guests submit their own address and contact details to the host.
- Sub-events with an invitation matrix.
- RSVP by party magic link or QR, strict name lookup, or PIN; household RSVP.
- Conditional questions; deadline reminders via journeys.
- Paper/manual entry recorded with its source; response history.
- **Acceptance:**
  - A guest not invited to a sub-event cannot RSVP to it.
  - Name lookup never exposes the guest list (enumeration test).

**M4.2 Social profiles and workspace (M)**
- Wedding navigation (D19).
- Gala tabs: Tables & Sponsors and Tickets.
- Vocabulary; checklists and templates.
- Guest ↔ ticket link.
- Hosted tables with sponsor naming.
- Co-host and planner roles.
- **Acceptance:** a wedding user sees no conference or ticketing modules unless enabled.

**M4.3 Guest seating (M)**
- Three-pane editor; unseated queue reacting to RSVP and meal changes.
- Party-to-table drag; "can't fit" warnings.
- VIP zones; group assignment.
- Place, escort and table cards; exports.
- **Acceptance:** keyboard-only path; plus-one changes update the queue in realtime.

**M4.4 Seat finder, kiosk and day-of (M)**
- Permanent QR; map highlight; tablemates; PIN.
- **Kiosk/display mode** with offline snapshot and PIN exit.
- A–Z TV board.
- Guest check-in by name or party, with labels.
- Day-of host view: arrivals, unseated guests, meal counts.
- **Acceptance:** the kiosk keeps working after the network is cut.

**M4.5 Guest website, program and gallery (M)**
- Guest site in all locales: program, travel, registry links, FAQ, password.
- Photo **and video** uploads:
  - photos are re-encoded
  - short videos are transcoded via Cloudflare Stream, or links only (D19)
- Moderation, quotas, live slideshow.
- **Acceptance:** the per-event storage cap is enforced.

**M4.6 Social Command Center pack (S)**
- RSVP-pending alerts at deadline −7 d and −1 d ("42 guests have not responded to RSVP").
- Unseated guests; meal and dietary counts; arrivals.

**M4.7 Mobile-web guest experience (S)**
- Seat finder, RSVP, tickets and Apple/Google Wallet passes delivered as mobile-first web pages, no app install needed. Native app versions are deferred (§8.3).

### Phase 5 — Conference and enterprise (owner priority 3)
**Exit:** a conference of ≥500 attendees runs with registration types, agenda, session check-in, badges and lead retrieval, and a SOC 2 Type I report is in hand.

| Milestone | Scope |
|---|---|
| **M5.1 Advanced registration** (L) | Registration types × admission items; custom multi-page forms with conditional questions; group and +1; approval with bulk actions; invoice/PO/pay-later; per-type capacity; waitlist |
| **M5.2 Agenda, sessions and enrollment** (L) | Tracks, rooms, slots; included vs optional sessions; session groups; availability by admission item; personal schedule with conflict prompts; ICS; atomic enrollment and waitlist promotion. Acceptance: no oversell under concurrency, and waitlist promotion never loops. |
| **M5.3 Speaker portal and CFP** (M) | Magic-link portal; tasks and reminders; CFP review scores |
| **M5.4 Exhibitors and sponsors** (M) | Exhibitor portal (profile, booth on floor plan, staff, tasks, lead licenses); sponsor packages as entitlements with deliverables; sponsor and exhibitor activity metrics |
| **M5.5 Badges and printing** (M) | Badge designer; batch PDF; AirPrint, then PrintNode or Zebra; print log; kiosk self-print; printer alerts |
| **M5.6 Session check-in and lead retrieval** (M) | Session checkpoints with three gates + override; scan in/out; lead capture (QR, offline queue, qualifiers, notes, consent, export, auto-disable after the event) |
| **M5.7 Live engagement** (M) | Server-authoritative polls and moderated Q&A; participant, moderator, presenter and big-screen views; session feedback; engagement score |
| **M5.8 Networking and chat** (M) | Opt-in directory; connections; meeting slots, locations and requests; chat replaces legacy 1:1 chat |
| **M5.9 Conference Command Center pack** (S) | Alerts: session ≥95% capacity, zero-lead exhibitors, overdue speaker tasks, rooms smaller than enrollment, printers offline; session attendance; exhibitor and sponsor activity |
| **M5.10 Mobile-web conference features** (M) | Agenda, personal schedule, polls/Q&A as mobile-first web pages; lead retrieval in the Scan PWA. Native versions deferred (§8.3). |
| **M5.11 Enterprise readiness** (S) | Claude automates evidence collection; owner runs Vanta, the pen test, the VPAT and the Data Privacy Framework (DPF) |

### Phase 6 — Expansion tracks
Order: CRM (M6.1–6.2), then API and integrations (M6.3–6.5), then billing and agency (M6.6–6.8), then virtual (M6.9–6.10). Advanced seating and AI (M6.11–6.12) can run in parallel or be pulled forward for a large reserved-seating customer.

| Milestone | Scope and acceptance |
|---|---|
| **M6.1 Event CRM v2** (L) | Merge/dedupe UI; person timeline; `contact_stats` (LTV, RFM, engagement, no-show propensity); org stats; DSAR propagation. Acceptance: the vision's John Doe fixture — attended A, VIP at B, registered for C, 4 sessions, opened campaigns, $1,800 lifetime — reproduces exactly. |
| **M6.2 Analytics platform** (M) | ClickHouse or Tinybird via CDC; cross-event and attribution analytics; Cube explorer; organizer-authored alert rules; scheduled PDF reports |
| **M6.3 Public API and webhooks GA** (M) | Self-serve API keys, sandbox orgs, Svix portal, published SDKs (TS/Swift/Kotlin), public docs |
| **M6.4 Integrations wave 1** (L) | Nango + field-mapping UI; Zapier, Slack, Google Sheets live sync, HubSpot, Mailchimp, Klaviyo, Eventbrite importer. Owner: Zapier and Google OAuth verification. |
| **M6.5 Enterprise integrations** (L) | Salesforce, SSO/SCIM, Google Calendar, Make, n8n, QuickBooks/Xero |
| **M6.6 Subscription billing** (M) | Activate plans, Entitlement Features and Meters (messaging, AI, devices); in-app plan changes; dunning degrades to read-only; Stripe Tax; nonprofit discount; legacy fees grandfathered; AI credits folded into allowances. Acceptance: a plan change alters modules via webhook sync alone, **with no feature-code change**. |
| **M6.7 Agency v1** (M) | Org switcher with "via Agency" badge; grants the client can revoke; clients pay for themselves; Clients \| Events \| Marketing \| Reports from snapshots |
| **M6.8 Agency v2** (L) | Agency pays for clients; commission transfers; publish templates and brand kits downward; per-client campaign fan-out; handover/detach; team and day-of grants |
| **M6.9 Virtual and hybrid v1** (L) | Delivery and access modes; Mux signed playback with grants; heartbeat watch time; virtual checkpoint; Zoom registrants and reports; CE credits. Owner: start Zoom Marketplace review at M6.4. |
| **M6.10 Virtual v2** (M) | Create Zoom webinars; join/leave webhooks; Cloudflare Stream as a second provider; RTMP overflow |
| **M6.11 Advanced seating** (M) | Best-available; ADA engine; channels and allotments; layout revisions; underlay tracing; venue layout library |
| **M6.12 Intelligent seating and AI** (L) | Rules ("keep association together", "VIP nearest stage"); tabu search in a Web Worker producing editable proposals; CP-SAT service later; AI drafting v2 and audience suggestions; pgvector matchmaking. Acceptance: 400 guests seated in ≤5 s, no hard-rule violations, manual placements never overwritten. |
| **M6.13 Branded tenant apps** | **Deferred** with the mobile build (§8.3) |
| **M6.14 Marketplace and venues v2** (M) | Meilisearch geo and facets; recommendations; listing moderation; venue portal and shared layouts; promoted placements; optional LAN hub for all-offline venues |

**Continuous compliance:** SOC 2 Type I at 6–9 months after launch, then Type II. Annual pen test. VPAT. DPF.

### 8.3 Deferred: mobile apps (planned, not built in this build)
**Owner decision:** plan the apps now, build them later.

**What this build does for mobile:**
- The `/api/v2` facade serves the current Yayatoh and ABC store builds unchanged, with no forced upgrade and no sunset.
- `/v1` is mobile-ready, with generated TS, Swift and Kotlin SDKs.
- Staff features ship in the Scan PWA (M1.9, M3.4, M5.6). Guest features ship as mobile-first web pages plus Wallet passes (M4.7, M5.10).

**Future mobile build (when scheduled):**
1. **Gate.** Use the M0.8 scorecard (G1–G7, §7.6) to decide between upgrading the existing React Native app and an Expo rebuild in `apps/mobile`. The audit found a React Native app (`src/config/services.ts`, `API_URL = BASE_URL + '/api/v2'`).
2. **Apps.**
   - A **Yayatoh** attendee container app, released as an update to the existing bundle IDs. It has an org picker, offline tickets, Wallet, RSVP, seat finder, agenda, polls and an inbox.
   - A **Yayatoh Staff** app with native offline scanning (SQLCipher), lead retrieval and Command Center lite.
3. **Continuity.**
   - The legacy token exchange (`/v1/auth/legacy-exchange`) keeps users signed in across the upgrade.
   - A 426 handshake enforces minimum versions.
   - `/api/v2` is sunset only after adoption thresholds are met (§7.6 timeline).
4. **ABC app.** Fold it into the Yayatoh app, or transfer the listing to ABC's own developer account (Apple 4.2.6).
5. **Branded tenant apps** (former M6.13) come as a premium tier.
6. **Sizing.** Roughly 2 L-sized milestones, plus store review lead time. Existing web modules are reused through the SDK.

**Constraint to track meanwhile:** new store submissions need Xcode 26 and Android API 36. Any **emergency fix to the current apps** needs that toolchain upgrade first. The facade avoids needing one.

### 8.1 Critical path and early human tasks
```
M0.0 ─ M0.1 ─┬─ M0.2 ─┐
             ├─ M0.3 ─┼─ M0.8 gate ─ M1.13 facade + M1.15 (current apps keep working; no mobile build)
             ├─ M0.4 ─┘      (ELT transforms accrue in every Phase-1 milestone) ─ M2.2 ─ M2.3 ─ M2.5 ─ M2.7 ─ M2.8
             └─ M0.5 ─ M0.6 ─ M1.1/M1.2 ─ M1.3 ─ M1.4 ─ M1.5 ─ M1.6 ─┬─ M1.7 ─┐
                                                   M1.8 ─ M1.9 ─ M1.10 ┼─ M1.11 ┼─ M1.12 ─ M1.13 ─ M1.14 ─ M2.1 beta
Phase 3 after B-Y: M3.1 → M3.2 → M3.3 ; M3.4 (after M3.1) ; M3.5 → M3.6 → M3.7 → M3.8 → M3.9 ; M3.10 ; → M3.11 launch
Phase 4 → Phase 5 → Phase 6 (M6.1–6.2 → M6.3–6.5 → M6.6–6.8 → M6.9–6.10; M6.11–6.12 in parallel)
```
**Engineering critical path:** M0.1 → M0.5 → M0.6 → M1.2 → M1.3 → M1.4 → M1.5 → M1.6 → M1.9 → M1.13 → M2.2 → M2.3 → M2.5 → M2.7.

**Human lead-time items:**

| Item | When |
|---|---|
| PSL submission | M0.1 |
| Counsel and Stripe questions | M0.1 |
| Organizer agreement | Before M2.1 |
| Apple Pass Type ID + Google Wallet issuer | M1.5 |
| SES production access, toll-free, 10DLC, Meta verification | M1.10 |
| App-store privacy metadata fixes (no new binary) | M1.15 |
| Zapier and Google OAuth verification | Before M6.4 |
| Zoom review | M6.4 |
| Vanta | At M3.11 |

### 8.2 Launch plan and event-day readiness
1. **Private beta (M2.1):** new tenants with live payments while Laravel still serves yayatoh.com. Onboard 4 or more weeks before their event. Payouts per policy.
2. **First live event.** Checklists at T−7, T−1 and T−0:
   - readiness score ≥90
   - test purchase and refund
   - manifests pre-synced
   - printed fallback list with short codes
   - spare hotspot
   - charged devices
3. **Migration of existing organizers (M2.7, M2.8):**
   - comms at T−30, T−14, T−7 and T−1
   - fees unchanged
   - "what's new" walkthrough
   - two weeks of office hours
4. **Public launch (M3.11).**

**Event-day operations:**
- **On-call is human.** The owner is primary, with a contracted backup. Claude Code supports through read-only observability, and fixes go through PRs unless a runbook says otherwise.
- **SEV1** = cross-tenant exposure, check-in outage, payment outage, or key compromise.
- **Runbooks:**
  - scanner offline or venue Wi-Fi down
  - Stripe outage (door comps, reconcile later)
  - realtime outage (SSE fallback)
  - database restore
  - email/SMS failure
  - domain certificate failure
  - suspected tenant leak (72 h GDPR clock)
  - rollback
- **Pre-authorized admin actions:** pause checkout, extend the check-in window, force offline mode, bulk comps, pause messaging.
- **Offline drill** before every event over 1,000 attendees, following M1.9's acceptance.
- **Post-event review** within 72 h.

---

## 9. Claude Code operating model

**Where Claude Code runs: cloud sessions (Claude Code on the web)**

*Repositories*
- **GitHub is required.** Create a private GitHub repo `yayatoh` for the new platform and install the Claude GitHub App on it.
- Cloud sessions cannot clone GitLab. **Mirror the legacy `abc-web` into a separate private GitHub repo `yayatoh-legacy`** as a read-only reference, and rotate its committed secrets first (§1.3b).

*Environment (set once at claude.ai/code)*
- **Setup script:** install Node 24 (the image ships Node 22) and pnpm; pull the `postgres:18` and `redis` Docker images. It must finish in about 5 minutes to be cached.
- **Network:** a Custom allowlist on top of Trusted — Neon, Vercel, Stripe test API, Upstash, Ably, Svix, Sentry.
- **Secrets:** only dev and test keys, stored as API credentials on Pro/Max plans. Never production keys.

*How sessions work*
- **Parallel work:** each milestone lane runs as its own cloud session on its own branch and opens a PR. Auto-fix handles CI failures and review comments. This replaces local git worktrees.
- **Hardware:** each session VM has 4 vCPU and 16 GB RAM, and runs Docker (Postgres 18 for integration and isolation tests) and Playwright. The full k6 load tests and nightly suites run in GitHub Actions, not in sessions.
- **Config comes from the repo only.** User-level `~/.claude` settings don't reach the cloud, so commit `CLAUDE.md`, `.claude/` (settings, hooks, commands, agents) and `.mcp.json`.
- **Save work often.** Sessions stop when idle; commit and push frequently.

*What stays local or human*
- **Local-only work:**
  - Masking production dumps
  - Rehearsals on real data (the isolated `legacy-ref` host or the owner's machine)
  - Device testing of the store apps
  - Anything needing interactive login or SSH
- **Production data never enters a cloud session.** Only masked snapshots do.

**Repo docs**
- Vision, roadmap and research
- ADRs and specs
- Acceptance records and parity matrix
- Legacy notes, runbooks and demo scripts
- `docs/owner-inbox.md`: owner tasks, each with the milestone that needs it
- `docs/decisions.md`: decision log

**Root CLAUDE.md** (kept under about 300 lines):
- **Purpose and pointers.**
- **Precedence rule:** owner decisions > ADRs > roadmap > research. Superseded research carries a banner.
- **Commands:** `pnpm dev | verify | test | test:int | test:isolation | e2e | e2e:offline | db:generate (never push) | seed --profile=… [--scale=large] | contracts:check | legacy:replay | etl:run --instance=`.
- **Module recipe and boundary rules.**
- **Non-negotiable tenancy rules:**
  - Every tenant table uses `tenantTable`.
  - All data access goes through `withTenant`.
  - The tenant comes only from root params or the session.
  - Cache keys include the org.
  - Every new table is registered in the isolation fixtures.
- **Authorization** lives in commands. `proxy.ts` is optimistic only.
- **Money:** minor units, idempotency keys, the `PaymentProvider` port, test mode only.
- **Contracts:** `/v1` changes are additive; the facade is frozen unless a HAR update is owner-approved.
- **UI:** tokens, i18n keys, logical CSS, drag alternatives, 24 px targets.
- **Time:** the timezone ADR.
- **Workflow:** spec → failing tests → implement → `pnpm verify` → PR template → progress note.
- **When to stop and ask the owner:** the spec is ambiguous, a decision is open, a migration is destructive, a legacy contract diff appears, or a cost exceeds budget.

**Per-module files.** Each module has a `CLAUDE.md` or `MODULE.md` stating its invariants. Examples:
- `scan_events` is append-only
- the layout locks after sale
- transfers use void and reissue
- refunds after transfer create an explicit reversal

**`.claude/` configuration**
- **Deny list:**
  - production DB hosts and DSNs
  - `vercel --prod`
  - Stripe live keys
  - force-push to main
  - `drizzle-kit push`
  - reading `.env.production*`
  - `rm -rf` outside the workspace
- **Hooks:**
  - PreToolUse blocks production hosts and `DROP`/`TRUNCATE` outside local DBs.
  - PostToolUse formats files.
  - Stop reminds to run `pnpm verify`.
- **Commands:** `/spec`, `/increment`, `/verify`, `/demo`, `/adr`, `/parity-check`, `/migration-review`.
- **Reviewer subagents:** tenancy, security, migration, a11y.

**Spec template:**
- Goal and users; references to the vision and parity matrix; scope in and out.
- `touches:` paths.
- Data model with RLS notes; API diff; events; entitlements and flags; ELT impact.
- Acceptance criteria as Given/When/Then with IDs, and the test mapped to each.
- Security and privacy; performance budget; rollout plan.
- Increment breakdown, demo checklist, owner tasks.

**Increment loop**
1. Spec slice approved. The owner approves user-facing and risk-tagged work.
2. Write failing tests.
3. Implement.
4. Run `pnpm verify`.
5. Open a PR with an acceptance checklist, screenshots, preview URL and risk tags.
6. CI runs, plus automated review: `/code-review`, and `/security-review` on risk tags.
7. Merge behind a flag.
8. Acceptance is recorded at the weekly demo.

**Risk tags that require owner approval:** `db-migration`, `auth`, `payments`, `tenancy`, `infra`, `mobile-contract`, `legal-copy`.

**CI gates.** All block merges unless marked nightly.
- Format and lint; boundaries and `check-modules`; typecheck; unit tests.
- Integration on real Postgres 18, with migrations applied from zero.
- Schema guard and the isolation suite.
- **Canary leak test:** `__CANARY_<field>__` values are seeded into every `@private` column, then all public routes, `/v1`, `/api/v2`, webhooks, manifests and exports are crawled. Any canary found fails the build.
- Spectral and oasdiff; HAR replay; Schemathesis (nightly).
- Masked ELT with golden queries (nightly).
- Playwright on the preview: critical journeys per profile at 375, 768 and 1280 px, `ar`/RTL, and an offline drill.
- axe: zero serious or critical findings.

| Bundle budget | Limit |
|---|---|
| Public and event pages, first-load JS | ≤150 KB gz |
| Checkout, excluding Stripe.js | ≤200 KB gz |
| Dashboard route | ≤250 KB gz |
| Seat-map chunk | Lazy-loaded, ≤120 KB gz |
| Scanner shell | ≤250 KB gz, WASM lazy |

- Lighthouse: performance ≥90 and LCP ≤2.5 s on event pages.
- gitleaks, dependency review, CodeQL, SBOM, license check.
- k6 smoke test (nightly).

**Preview environments**
- Each preview has its own Vercel preview, Neon branch seeded from fixtures (never production), Ably namespace, Stripe test mode with test clocks, and a mail catcher.
- Previews are noindex.
- Tenant routing uses a `preview-tenant` cookie, which is ignored in production.
- Role logins use one-time links from seed users.

**Seeds**
- Deterministic profile fixtures, always with at least 2 orgs: `concert-ga-2k`, `gala-seated-400`, `wedding-180-3-subevents`, `conference-1500-60-sessions`, `community-recurring`, `agency-3-clients`, `abc-like-convention`, `two-org-adversarial`, `load-20k`, `legacy-anon`.
- Fixtures deliberately include the vision's alert conditions.

**Flags.** Release flags are set per org or by percentage. Each has an owner and a removal milestone; stale flags fail CI. Entitlements and ops kill switches are kept separate from release flags.

**Parallel work**
- At most 3 worktrees, each with its own lane, Neon branch and port.
- **Single migration lane:** only one open PR with a DB migration at a time.
- Shared packages change in isolated PRs.
- A merge queue re-runs all gates.
- A coordinator session owns `status.md`.

**Guardrails**
- No secrets in the repo.
- Claude Code holds no production credentials.
- **No production data or writes** without the owner's written approval for the specific operation. Even then, only via reviewed runbook scripts, read-only by default, with credentials entered by the owner.
- Snapshots are masked before they enter the workspace.
- Migrations: expand/contract, `lock_timeout`, concurrent indexes, owner approval.
- Never weaken tests or gates; CODEOWNERS covers CI and harness files.
- A new major dependency requires an ADR note.
- 24-hour patch SLA for critical CVEs.
- Production deploys only from `main`, with approval.
- **Recommended human safety net:** 4–8 h of external senior review at M0.6, M1.2, M1.6, M1.9 and M2.5.

---

## 10. Security, compliance and quality

**Controls by phase**

*Phase 0*
- M0.0 hotfix.
- Isolation suite, allowlist serializers with taint, and canary tests.
- Audit log with hash chain.
- KMS envelope encryption for OAuth and integration tokens, TOTP seeds, signing keys and sensitive answers.
- Hashed API keys and tokens.
- Doppler and gitleaks.

*Phase 1*
- **Authentication:**
  - Argon2id and NIST 800-63B-4 password rules with a breached-password check.
  - TOTP for org owners, admins and finance; passkeys for staff.
  - Step-up for payouts, domains, API keys, bulk export, large refunds and grants.
  - A 24 h hold on payout-destination changes.
- **Request protection:**
  - Two CSP profiles: nonce plus `strict-dynamic` for the dashboard and checkout; static plus SRI for public pages.
  - `serverActions.allowedOrigins`.
  - Rate limits and Turnstile.
  - SSRF blocking; an isolated image worker.
  - WAF and BotID; waiting room or Queue-it for large on-sales.

*Launch*
- OWASP ASVS 5.0 L2 checklist, ZAP scan, optional pen test.
- Incident response per NIST 800-61r3.

**Privacy**
- Yayatoh is the processor for organizer data. It is the controller for its own accounts, the marketplace and fraud data.
- Click-through Art. 28 DPA. Sub-processor list with 30 days' notice.
- Per-purpose unchecked consents with evidence. GPC honored.
- Sensitive-field flags.
- DSAR export and delete that also cleans exports and analytics.
- In scope: GDPR, CCPA/CPRA, Maryland MODPA, CAN-SPAM, TCPA and 10DLC.

| Retention default | Period |
|---|---|
| Attendee PII | 24 months after the event |
| Check-in logs | 12 months |
| Audit log | 12 months hot + 7 years WORM |
| Payment records | 7 years |

**Payments.** Stripe hosted elements keep the platform in SAQ A scope. Counsel items are in §5.3.

**Accessibility**
- WCAG 2.2 AA is a merge gate.
- List mode and non-drag alternatives on every canvas; extendable hold timers.
- Tagged PDFs (per the M0.5 spike).
- NVDA and VoiceOver pass before each phase exit.
- VPAT 2.5.

**SLOs**

| SLO | Target |
|---|---|
| Checkout success, excluding declines | ≥99.5% |
| `/v1` and `/api/v2` availability | 99.9% |
| Scan verify online | p95 <300 ms |
| Scan verify offline | ≤100 ms |
| Live Command Center tiles | ≤3 s p95 |
| Other dashboard data | ≤60 s |
| Projector lag | p95 <10 s |
| Campaign send lag | p95 <5 min |
| Transactional email enqueue → provider | p95 <60 s |
| Webhook first attempt | p95 <60 s |
| RPO/RTO: checkout and check-in | ≤5 min / ≤1 h (offline covers event day) |
| RPO/RTO: other | 1 h / 4 h |

Burning the error budget freezes feature deploys.

**Performance budgets**
- Public event page, p75 on mobile: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1.
- API p95: reads ≤200 ms, writes ≤400 ms.
- Checkout hold → PaymentIntent: ≤800 ms p95.
- 5k-seat map renders in ≤1 s on iPad.
- 20k-ticket manifest syncs in <30 s at 10 Mbps.

**Compliance roadmap**
- Launch: DPA and sub-processor list.
- SOC 2 Type I at 6–9 months after launch (Vanta), then Type II.
- ISO 27001 in year 2–3.
- App-store privacy metadata fixes in M1.15 (owner).

---

## 11. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | Cross-tenant leak, including agent-introduced | No exported DB client; forced RLS with `NULLIF`; generated isolation, cache, token and canary tests as merge blockers; `platform_reader` only in admin/worker; CODEOWNERS |
| 2 | Breaking a shipped app | Contract from 4 sources; byte-compatible facade tested on twin snapshots; store builds via DNS override; facade kept live with no sunset until a future mobile build; telemetry-gated sunset |
| 3 | Platform liability on `platform_mor` orders; two funds flows to build and support (cancellations, disputes, failed reversals) | Transfer at release; reserves; tiers; receivables; organizer agreement; kill switches; dispute-ratio alert; secondary-PSP seam |
| 4 | Tax and regulatory exposure as seller | Counsel from M0.1 gates live money; `TaxProvider`; US-only; `organizer_mor` seam |
| 5 | Migration defects (timezone, duplicates, blobs, overlapping IDs, identity merge) | Deterministic ELT; quarantine; V1–V12; golden queries; 3 green rehearsals; pre-hijack guard; reverse ETL before PONR |
| 6 | Legacy QR/seat identity unknown | Verbatim `ticket_barcodes` keyed by instance; verdict corpus; stable seat UUIDs; codes never reissued |
| 7 | Oversell under load | Conditional updates and locks; sweeper; atomic enrollment; k6 at 3×; waiting room |
| 8 | Offline check-in limits | Documented cross-device duplicate semantics; provisional-admit policy; drills; device alerts; runbooks |
| 9 | SEO loss | URL parity; canonical rules keep migrated events on yayatoh.com; redirect map; protected list; monitoring |
| 10 | Messaging compliance | Policy gate; consent ledger; approvals started at M1.10; SMS fallback for US WhatsApp marketing pause |
| 11 | Boundary erosion and scope creep | Three-way enforcement; `check-modules`; parity acceptance; profiles gate what ships |
| 12 | Framework CVEs and library churn | Pinned catalogs; Renovate; 24 h SLA; authz in commands |
| 13 | Owner review bandwidth | Risk-tag-only approvals; weekly demos; parity waivers; external reviews at 5 points |
| 14 | Live events disrupted during migration (ABC) | Backups-only extraction; freeze calendar; ±72 h rule; read-only freeze mode |
| 15 | Vendor licensing / PII exposure | Clean-room rule; masked data; isolated `legacy-ref` |

---

## 12. Decisions still needed from the owner

| # | Decision | Recommendation | By |
|---|---|---|---|
| D1 | Hosting and vendors | §3.6 | M0.1 |
| D2 | Tenant apex name; `app.yayatoh.com` | `yayatoh.events` if available | M0.1 |
| D3 | Hybrid specifics: release tiers and reserves for unconnected orgs, application-fee refund policy, refund minimum, whether new organizers must connect Stripe before selling | §5.3 defaults | M1.6 |
| D4 | Parity triage: PayPal, mesdoh/qPay, dormant gateways, reviews | Keep Stripe + offline; decide others by usage | M0.2 |
| D5 | Mobile build: when, and upgrade vs Expo rebuild | Deferred (§8.3); M0.8 scores the code so the decision is ready | Later |
| D6 | Forced-upgrade window | N/A until a mobile build exists | Later |
| D7 | Migration shape and front door | No shared DB; Next.js front door; Worker/nginx fallbacks | M0.8 |
| D8 | Instance order, windows, ABC app future | yayatoh.com first; ABC per freeze formula; fold ABC app into the Yayatoh container app (or transfer listings to ABC's own developer account as a paid tier) | M2.5 |
| D9 | abc org shape | ABC parent + affiliate child orgs | M2.2 |
| D10 | Platform staff list | Owner-approved list only | M2.2 |
| D11 | History scope and retention | Full history; 24-month attendee PII; archive 24 months | M0.4 |
| D12 | AI credits | Legacy credits were never implemented. Launch AI drafting with a small free allowance per org; metered at M6.6 | M1.4 |
| D13 | Marketplace defaults | Existing listings stay public; opt-in for new orgs; weddings/private never listed; no marketplace fee | M1.11 |
| D14 | Security policy | TOTP for admins; impersonation reason + org notice; minimal offline PII | M1.2 |
| D15 | Beta organizers | Seated gala or concert, 200–1,000 | M1.9 |
| D16 | Sender of record; WhatsApp priority; messaging cost recovery | Platform senders default; WhatsApp utility-only in US; quotas until M6.6 | M1.10 / M3.5 |
| D17 | Offline policy (provisional admit, Secure Ticket rotating QR) | Provisional admit on by default; no rotating QR at launch | M1.9 |
| D18 | Seating: ADA enforce/warn, tablet editing, seat ceiling | Warn; tablet yes; Konva to 20k | M1.7 |
| D19 | Wedding nav extras; gallery video | Accept Website/Messages/Day-of; short video via Cloudflare Stream | M4.2 |
| D20 | Conference target | Associations/conventions 500–5,000; per-exhibitor lead licenses; BYO printers | M5.1 |
| D21 | Public API exposure; webhook payloads | Private until M6.3; thin payloads for PII | M1.13 |
| D22 | Subscription tiers (research: $0/$29/$99/$249/Enterprise) | Decide with 3–6 months of launch data | M6.6 |
| D23 | Agency defaults | Clients pay first | M6.7 |
| D24 | Streaming resale | Metered at markup | M6.9 |
| D25 | Python CP-SAT service | Yes, later | M6.12 |
| D26 | SOC 2 timing and budget | Vanta; Type I 6–9 months after launch | M3.11 |
| D27 | Translation ownership and launch locales | All 13 for UI and transactional email; reports en/es/fr/ar first | M1.1 |
| D28 | Start Phase 3 plumbing (M3.1) during Phase 2 waits | Yes, if review capacity allows | M2.2 |

---

## 13. Verification plan
- **Per increment:** all CI gates (§9), plus a preview demo checked against Given/When/Then.
- **Per milestone:** owner demo with sign-off, parity matrix updated, golden queries at zero diff on `legacy-anon`.

**Suites:**
1. **Tenant isolation plus canary leak test.** Every PR.
2. **Legacy contract.** Twin-snapshot Schemathesis and golden-HAR replay for both apps, the verdict corpus, and store builds on devices.
3. **End-to-end journeys per profile.**
   - Core flow: create → sell (GA and seated) → distribute → claim → transfer → check in (online and offline) → seat finder → refund → dashboard numbers → alert fires.
   - Weddings add: RSVP → seating → kiosk.
   - Conferences add: approval → enrollment → session scan → lead capture.
4. **Money.**
   - Stripe test clocks.
   - Out-of-order webhooks.
   - Refund before and after transfer, with explicit reversal.
   - Dispute flow.
   - Daily ledger reconciliation on a seeded month.
   - SCT refund after a cutover rollback.
5. **Load (k6).**
   - 500 buyers for 100 tickets.
   - 50 checkouts/s.
   - 220 scans/min sustained and 20 scans/s burst, total across devices.
   - 50k-row export.
   - 50k-recipient campaign.
6. **Offline drill** (M1.9 acceptance). Repeated on site before doors at every beta and at every event over 1,000 attendees.
7. **Accessibility and i18n.**
   - axe on every template.
   - Manual NVDA and VoiceOver passes.
   - RTL screenshot diffs.
   - Responsive runs at 375, 768 and 1280.
8. **Migration.**
   - V1–V12 on every rehearsal.
   - R1–R4.
   - Reverse-ETL round trip.
   - Go/no-go smoke set.
9. **Real-world proof.** Beta events, then B-Y and B-A, then ≥2 events on the new platform before public launch.

---

## 14. Traceability: vision → milestones

| Vision item | Milestones |
|---|---|
| Lifecycle | Create M1.4 · Promote M1.11, M3.6 · Register M1.5, M4.1, M5.1 · Sell M1.5, M1.6 · Manage M1.8, M3.10 · Seat M1.7, M4.3 · Communicate M1.10, M3.5–M3.7 · Engage M3.9, M5.7, M5.8 · Check In M1.9, M3.3, M5.6 · Analyze M1.12, M3.2, M6.1, M6.2 |
| §1 Rebuild better | Preserve: M0.2–M0.4 + parity matrix · performance, UX, design, nav, mobile responsiveness: M1.1, M1.14 · security: M0.0, M0.6, M1.2, M1.14 · DB and API: M0.4, M0.6, M1.13 · realtime: M1.9, M3.1 · reporting: M1.12, M6.2 · integrations: M1.13, M6.3–M6.5 |
| §2 Multi-tenant (users, events, attendees, customers, branding, settings, campaigns, reports, integrations, payment config; small orgs to agencies, churches, planners) | M0.6, M1.2, M1.3, M1.5, M1.6, M1.12, M3.6, M6.4, community profile §4.5, agencies M6.7/M6.8 |
| §3 White-label (logo, colors, event and registration pages, emails, custom domain, nav, templates) | M0.6, M1.1, M1.3, M1.4, M1.10, M1.11, M3.5, M5.1, M6.13 |
| §4 Mobile apps | Kept working: M0.3, M1.13, M1.15. Mobile-ready API: M1.13. Web/PWA stand-ins: M3.4, M4.7, M5.10. Native build planned, deferred: §8.3 |
| §5 Enterprise (registration, conditional forms, agenda, tracks, sessions, capacity, session check-in, exhibitors, sponsors, packages, portals, badges, lead retrieval, engagement, surveys, polls, networking, analytics) | M5.1–M5.11, M3.9 (surveys), M6.2, M6.9 |
| §6 Weddings/galas (guest lists, RSVP, plus-ones, groups, import, floor plans, drag-drop, tables, seats, sections, VIP, assignments, QR seat finder, name lookup, Find My Seat, venue map, program, gallery, info, kiosk, simplicity) | M1.7, M1.8, M4.1–M4.7 |
| §7 Command Center (revenue … event readiness, 6 example alerts, event-day live metrics, guest assistance, realtime) | M1.12, M3.1–M3.3, M3.8, M4.6, M5.9 |
| §8 Marketing (email, SMS, WhatsApp, push, in-app; audiences; the 3 example segments; the 5-step automation; campaign analytics) | M1.10, M3.5–M3.9 |
| §9 Check-in (QR, name/phone/email lookup, manual, duplicate, fraud, multiple entrances and devices, realtime, history, offline) | M1.9, M3.3, M3.4, M5.6 |
| §10 Seating (tables, seats, sections, stages, booths, entrances, dance floors, custom objects, drag-drop, guest and group assignment, lookup, interactive maps, intelligent seating) | M1.7, M4.3, M4.4, M6.11, M6.12 |
| §11 CRM (history across events, sessions, campaigns, spend) | M1.5, M1.8, M3.6, M6.1 |
| §12 Event types without complexity | M0.6, M1.1, M4.2, M5.x navs, M6.7 |
| §13 Modules | M0.5, M0.6 (entitlements), every module milestone |
| §14 APIs and integrations (mobile, partners, Stripe, WhatsApp, SMS, email, Salesforce, HubSpot, Sheets, Zoom, webhooks) | M1.5, M1.6, M1.10, M1.13, M3.5, M6.3–M6.5, M6.9 |
| §15 UX (navigation, design, speed, mobile, forms, search, filtering, bulk actions, reports, notifications, guided workflows, onboarding, errors, event creation, consistency) | M1.1, M1.3, M1.4, M1.8, M1.10, M1.12, M3.2, M3.11 |
| Implied gaps | Pricing/billing M0.6 + M6.6 · refunds/support M1.6, M3.10 · virtual M6.9–M6.10 · marketplace/venues M1.11, M6.14 · timezone ADR M0.4 · capacity M1.14, M2.3 · super-admin M1.3 · accessibility/i18n M1.1, M1.14 |

---

## 15. Immediate next steps after approval
1. **M0.0.** Give the owner the hotfix spec for the public events endpoint leak. The owner applies it now, or Claude applies it as soon as code access exists.
2. **Workspace (cloud-ready).** Owner creates a private GitHub repo `yayatoh` and installs the Claude GitHub App, then configures the cloud environment (§9). Push `/Users/ratnesh/dev/yayatoh` to it, excluding `legacy/`. Mirror the legacy code to a private `yayatoh-legacy` GitHub repo after its secrets are rotated. Add:
   - `docs/research/` with superseded banners
   - `docs/vision.md`
   - this plan as `docs/roadmap.md`
   - the Phase 0 access checklist and `docs/owner-inbox.md`
3. **Owner provides:**
   - Laravel repos and deployed trees for both instances
   - dumps (to be masked)
   - 90-day access logs
   - both app repos
   - the stock Eventmie package
   - viewer access to Stripe, Search Console and the app stores
   - Legacy material lives under a git-ignored `legacy/` folder or the isolated `legacy-ref` host.
4. **Parallel start.**
   - M0.1: accounts, apex + PSL, counsel and Stripe questions.
   - M0.5: repo and CI gates.
   - M0.2: audit, once access lands.
   - First ADRs: monolith and modules, tenancy/RLS, hybrid payments, migration shape, hosting (D1).
