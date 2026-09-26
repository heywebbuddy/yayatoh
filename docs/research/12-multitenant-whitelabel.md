# Multitenant Whitelabel

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Multi-tenant + white-label SaaS architecture in Next.js (Yayatoh 2.0)

# Multi-tenant + white-label architecture for Yayatoh 2.0 (Next.js)

Research date: 2026-09-26. Grounded in the vision doc (§2 multi-tenant, §3 white-label, §4 mobile API, §12 per-event-type UX, §13 modules, §14 APIs).

## 0. Platform baseline (verified)

- **Next.js 16.3** is current stable (released 2026-08-03; docs build 16.3.6). App Router is the only actively developed router; Pages Router is in maintenance. Relevant 16.x facts: `middleware.ts` is **deprecated and renamed `proxy.ts`** (v16.0, runs on Node.js runtime only; codemod `npx @next/codemod@canary middleware-to-proxy`); Cache Components / `use cache` are stable (v16.0); **`next/root-params`** (v16.3) exposes root dynamic segments to any Server Component and is automatically part of `use cache` keys. Turbopack default; React 19.2.
- **Postgres**: 18 is current GA; 19 is at Beta 4 (2026-09-24), GA expected by end of October 2026. Build on 18, plan to move to 19 for `REPACK CONCURRENTLY`.
- **Drizzle ORM** 0.45.3 (2026-09-21) is latest stable; 1.0.0-rc.4 is pre-release. **Prisma ORM 7** (2025-11-19) is production; Prisma 8 ("Prisma Next", TypeScript-native rewrite) is early access and *replaces client extensions* — churn risk for anything built on `$extends`.

## 1. Tenancy data model

**Recommendation: one shared Postgres, `org_id` on every tenant-owned row, Postgres RLS as the enforced backstop, app-level scoping as the primary path.** Design (but do not build) a per-org `shard_key`/connection-routing seam so a future "dedicated database" enterprise tier is a routing change, not a rewrite.

Why over the alternatives:
- **Schema-per-tenant** — rejected. Migrations fan out per schema (real-world failure mode: migration applied to 4,800 of 5,000 schemas), catalog bloat and `pg_dump` slow past ~5k schemas, and `SET search_path` does not survive transaction-mode pooling (PgBouncer lists `SET` as never supported in transaction mode), which forces schema-qualified SQL everywhere. Yayatoh's target (small organizers → agencies → enterprises) is many small tenants, the worst case for this model.
- **Database-per-tenant** — rejected as default: connection-pool fan-out (one pool per DB), N× migrations, no cross-tenant discovery (`/events` marketplace needs cross-org queries), and the platform Command Center needs cross-org analytics. Keep as premium option only.
- **Nile** (Postgres with built-in "virtual tenant DBs", `SET nile.tenant_id`) is a credible managed alternative that removes hand-written policies, but it is a vendor lock-in on the database itself; RLS on vanilla Postgres runs anywhere (Neon, Supabase, RDS, self-hosted).

### RLS implementation pattern (works with transaction pooling)

```sql
CREATE ROLE app_user NOSUPERUSER NOBYPASSRLS NOCREATEROLE LOGIN;  -- runtime role, NOT the table owner
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;                        -- owner is also constrained
CREATE POLICY tenant_isolation ON events TO app_user
  USING      (org_id = (SELECT current_setting('app.org_id', true)::uuid))
  WITH CHECK (org_id = (SELECT current_setting('app.org_id', true)::uuid));
```

Non-negotiables learned from the sources: (a) wrap `current_setting()` in `(SELECT …)` so it is an InitPlan, not re-evaluated per row — the naive form turned index scans into seq scans (~575× regression on a 10M-row table); (b) every index on tenant tables leads with `org_id` (`(org_id, created_at DESC)`, `(org_id, status)`); (c) `FORCE ROW LEVEL SECURITY` plus a non-owner runtime role, otherwise the owner bypasses policies; (d) composite FKs `(org_id, parent_id)` so a row can never reference a parent in another org; (e) functions used inside policies must be `STABLE`/`LEAKPROOF` or the planner will not push them into index scans; (f) migrations run as the owner over a **direct** (non-pooled) connection (Neon explicitly requires this).

Set the context **inside the transaction** with `set_config('app.org_id', $1, true)` (the `true` = transaction-local). Because a transaction is bound to one server connection for its duration, this is safe under PgBouncer transaction mode, Neon's pooler (PgBouncer, up to 10,000 client connections) and Supabase Supavisor transaction mode — even though those docs only say session-level `SET` is unsupported. UNVERIFIED as an explicit statement in pooler docs; it is safe by construction and is the pattern the Prisma RLS extension and tenantwell use.

**RDS Proxy is the exception.** AWS docs list `SET` and `set_config` as pinning triggers for PostgreSQL; pinning turns multiplexing into session pooling. The docs state `SET LOCAL` does not pin (the sentence sits in the MySQL section — UNVERIFIED for Postgres). If you must use RDS Proxy, use literal `SET LOCAL app.org_id = '<validated uuid>'` (it does not accept bind parameters, so validate the UUID before interpolation) and watch `DatabaseConnectionsCurrentlySessionPinned`. Prefer a PgBouncer sidecar or Neon/Supabase poolers, which do not have this problem.

### Drizzle vs Prisma for RLS

**Recommend Drizzle** (0.45.x). RLS is first-class in the schema: `pgRole()`, `pgPolicy()` with `using`/`withCheck`, `pgTable(...).withRLS()`, `.link()` for policies on external tables, `crudPolicy()` helper for Neon, and `drizzle.config.ts → entities.roles` so drizzle-kit migrates roles and policies. Tenant wrapper:

```ts
export const withOrg = <T>(orgId: string, fn: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
```

**Runner-up: Prisma 7** (Rust-free, `@prisma/adapter-pg` mandatory, up to 3.4× faster, ~1.6 MB bundle). The official `row-level-security` client extension wraps every query in `$transaction([$executeRaw set_config(..., TRUE), query])`, but the README states that **explicit `$transaction()` on the extended client "may not work as intended"** because each query is already wrapped — a serious limitation for order/ticket/seat workflows that are inherently transactional. Prisma 8 replacing extensions adds migration risk. Prisma does not manage policies; you would keep them in hand-written SQL migrations.

Operational roles: `app_user` (runtime, RLS-bound), `migrator` (owner, direct connection), `platform_reader` (`BYPASSRLS`, used only by the super-admin console and cross-org analytics, every use logged), and a `jobs` path that always calls `withOrg(job.orgId, …)` — every queue payload carries `org_id`.

## 2. Tenant resolution in Next.js 16

Two surfaces, resolved differently:

1. **Organizer app** (`app.yayatoh.com`): org comes from the session/URL (`/o/[orgSlug]/…`), never from the host. No custom domains needed here.
2. **Tenant public surface** (event pages, registration, seat finder, RSVP): host-based. `proxy.ts` (Node runtime) reads `host`, resolves the tenant, **deletes any inbound `x-tenant-*` headers** (Vercel's docs stress this — clients can forge them), then **rewrites** to an internal tree `app/t/[org]/…` and forwards `x-tenant-id` via `NextResponse.next({ request: { headers } })` (not `response.headers`, which leaks to the browser).

Resolution order: exact custom-domain match → `<slug>.<tenant-apex>` → 404/redirect. Lookup store: on Vercel, **Global Config** (Edge Config was renamed Global Config on 2026-07-29; `@vercel/global-config`, ~1 ms reads, 1 MB per store on all plans) keyed `domain_<host>`; self-hosted, Redis/Upstash (the Platforms Starter Kit uses Upstash Redis with `subdomain:<name>` keys) plus a short in-process LRU. Domain changes write through to the store.

Why rewrite to `/t/[org]/…` rather than only setting a header: the tenant becomes a **root param** (`import { org } from 'next/root-params'`, v16.3), so `use cache` entries are keyed by tenant automatically. Reading tenant from `headers()` inside anything cached throws `next-request-in-use-cache`, and reading it in a page makes the whole route dynamic.

**Caching pitfalls (verified against docs and issues):**
- `use cache` cannot call `headers()`/`cookies()`; pass tenant id as an argument or use root params.
- `revalidatePath` operates on the **rewritten internal path**, not the public URL; a middleware/proxy rewrite is not applied to on-demand ISR revalidation requests. Prefer `cacheTag(\`org:${id}\`)` + `revalidateTag/updateTag` on every tenant mutation.
- With the default in-memory handler on serverless, `use cache` entries do not survive across instances; use `'use cache: remote'` or a Redis `cacheHandlers` config for tenant theme/nav lookups.
- Proxy runs on every route including RSC prefetches; keep the matcher tight and never rely on it for authorization — Server Functions are POSTs to their page route and silently lose proxy coverage when matchers change (Next docs). Authorize inside every Server Function.
- Subdomain cookie leakage: `tenant1.yayatoh.com` can set `Domain=yayatoh.com` cookies visible to every tenant and the dashboard. Vercel recommends submitting the shared suffix to the **Public Suffix List** and, until merged, hosting the dashboard/auth on a **different apex** and using `__Host-` prefixed cookies with no `Domain` attribute. Recommendation: put tenant subdomains on a dedicated apex (e.g. `*.yayatoh.events` — availability UNVERIFIED) and keep `yayatoh.com` for the marketplace, dashboard and auth.

## 3. Custom domains and TLS

| Option | Verified facts | Fit |
|---|---|---|
| **Vercel Domains API** | Custom domains: 50 on Hobby, "unlimited" on Pro/Enterprise (soft limits 100,000 / 1,000,000 per project). No published per-domain fee. Let's Encrypt certs auto-issued/renewed after verification; TXT verification only when the domain is already on Vercel. SDK: `projectsAddProjectDomain`, `projectsVerifyProjectDomain`, `projectsRemoveProjectDomain`. Wildcard `*.apex` requires Vercel nameservers or delegating `_acme-challenge`. **Rate limits: 100 domain additions/hour/team, 50 verifications/hour, 100 removals/hour.** Custom SSL upload and per-tenant preview URLs are Enterprise-only. | Best when hosting on Vercel. |
| **Cloudflare for SaaS** | 100 custom hostnames included on every plan, **$0.10/hostname/month** beyond, 50,000 max on self-serve; wildcard custom hostnames Enterprise-only; customers CNAME to your `customers.yayatoh.com`; traffic goes to a proxied *fallback origin*. **Host-header override is Enterprise-only** in Origin Rules, so in front of Vercel (which routes by Host and 404s unassigned hostnames — well-known behavior, UNVERIFIED in docs) you would still have to add every domain to Vercel, defeating the purpose. | Best when the origin is yours (Cloudflare Workers via OpenNext/vinext, or containers). |
| **Caddy on-demand TLS** | Cert obtained during first TLS handshake; mandatory `ask` endpoint (your API answers "is this hostname a known tenant?"); internal limit 10 attempts/10 s per ACME account; shared storage = automatic cluster. Let's Encrypt limits: 50 certs/registered domain/week, 300 new orders/account/3 h, 5 duplicates/week, 5 failed validations/identifier/hour; overrides take weeks. | Best for self-hosted containers/K8s ingress. cert-manager works (one Certificate per Ingress TLS block) but offers no guidance at thousands of hosts and needs a Certificate object per tenant. |

**By scale:** 100 tenants — Vercel Domains API, zero infra. 1,000 tenants — still Vercel; queue domain provisioning to stay under 100 adds/hour during onboarding bursts; cost is hosting, not domains. 10,000 tenants — Vercel remains within the 100k soft limit and is the cheapest domain-wise; if you leave Vercel, Cloudflare for SaaS (~$990/month at 10k hostnames) in front of your own origin, or a Caddy cluster with one ACME account. Decide by hosting platform, not by domain count. Note the 50-certs/registered-domain/week limit only bites when issuing per-subdomain certs on your own apex — use a wildcard cert for `*.yayatoh.events` (Vercel issues per-subdomain certs on the fly from its own account, so it does not hit your quota).

Domain lifecycle to model: `pending_dns → verifying → active → failed`, verification TXT token, primary-domain flag, www/apex redirect pair, canonical URL to avoid duplicate-content SEO between `slug.yayatoh.events` and `events.org.com`.

## 4. Theming and white-label surface

- **Design tokens**: store a per-org `theme` JSON (`{ primary, onPrimary, surface, radius, fontFamily, logoUrl, faviconUrl, darkMode }`) validated with a schema; the root layout for `/t/[org]` renders a cached (`use cache` + `cacheTag('org:…')`) inline `<style>:root{--color-primary:…}</style>`. Tailwind v4 theme variables map to those CSS custom properties, so components never reference brand colors directly. Compute contrast-safe derived tokens server-side (e.g., `--on-primary`) rather than trusting user input.
- **Logo/favicon/OG**: `generateMetadata` and `app/t/[org]/icon.tsx` / `opengraph-image.tsx` (`ImageResponse`) read the org via root params; event OG images pull tenant tokens and logo. Store assets in per-org S3/R2 prefixes with content-addressed names.
- **Fonts**: `next/font` is build-time, so offer a curated allowlist (10–15 Google/self-hosted families bundled via `next/font`) and, for custom uploads, a `<link rel="preload">` path with `font-display: swap`. Avoid arbitrary runtime `@import` of third-party CSS.
- **Email theming**: React Email (or MJML) templates take the same token object plus per-org header/footer blocks, sender name and reply-to; render server-side per send; preview in the dashboard. Keep a platform-default template set and an override table keyed by `(org_id, template_key, locale)` — 12 locales already exist.
- **Editable navigation**: `org_navigation` JSON (label, href, visibility) and per-org **module flags** (vision §12/§13) drive which nav items and dashboard cards render; a wedding org never sees Sessions/Exhibitors.
- **Copy/branding**: "Powered by Yayatoh" toggle by plan; legal pages (terms, privacy) per org; support email per org.

## 5. Per-tenant email sending domains

Pattern: **subdomain delegation**. Ask the org to delegate `mail.<theirdomain>` (or `events.<theirdomain>`) rather than touching their root SPF/DMARC; the platform sends `From: name@mail.org.com` with `Reply-To` their real mailbox. Until verified, send from `orgslug@mail.yayatoh.com` with the org's display name. DMARC on their root stays their responsibility, but show a DMARC check in the wizard.

Provider APIs (verified):
- **Amazon SES v2**: 10,000 verified identities/Region (raise via account manager); Easy DKIM = 3 CNAMEs, 2048-bit; custom MAIL FROM needs MX+SPF; **Tenants** (2025-08-01) give per-tenant reputation metrics and automated pause policies (Standard/Strict/None), 10,000 tenants by default (blog claims increasable to 300,000 — UNVERIFIED). Deterministic Easy DKIM (DEED, Dec 2024) lets replica identities in other Regions reuse the same DNS records — useful if you later send from multiple Regions, not a single-CNAME delegation scheme. API is throttled at 1 request/second for non-send actions — queue identity creation.
- **Postmark**: Domains API returns DKIM host/value, Return-Path CNAME → `pm.mtasv.net`, `verifyDkim`, `verifyReturnPath`, `rotatedkim`; no published limit on domains.
- **Resend**: create-domain returns DKIM TXT, SPF/MX for `send.` return path, tracking CNAME; regions; **domain caps: Free 3, Pro 10, Scale 1,000, +100 domains for $20/month** — a hard ceiling for white-label at scale.

**Recommend SES v2 with Tenants** (one tenant per org for reputation isolation; cheapest at volume). Runner-up Postmark (best tooling and unlimited domains, no per-tenant reputation isolation, higher unit cost). Resend loses on domain caps. Model `org_email_domains` with provider ids, DNS record set, verification status, and `dkim_rotated_at`.

## 6. Payments (pointer)

Stripe Connect, one connected account per org (`org_payment_accounts`). For new platforms Stripe now directs you to the **Accounts v2 API**; the SaaS-shaped choice is direct charges on the connected account with an application fee, Stripe-hosted or embedded onboarding, and (initially) Stripe responsible for negative balances. Owned by the payments researcher.

## 7. Platform admin vs tenant admin

- Separate surface (`admin.yayatoh.com`, separate root layout and route group), separate `platform_staff` table with roles (`support`, `billing`, `superadmin`), MFA required, IP allowlist optional.
- **Impersonation**: short-lived session flagged `impersonated_by` (Better Auth admin plugin: `impersonateUser`, default 1 hour, `stopImpersonating`, admins cannot impersonate admins without explicit permission; Clerk uses an `act` claim, 30-minute max, 10-minute idle, 5 free/month; WorkOS requires a stated reason, 60-minute expiry, emits `session.created` with the impersonator). Yayatoh policy: reason required, `impersonation_sessions` audit row (actor, target user, org, reason, start/end, IP), persistent banner, block payouts/refunds/exports/deletions while impersonating, optional email to org owner.
- Cross-org reads by staff go through the `platform_reader` role with structured audit logging; never by muting RLS in app code.

## 8. Org membership, invitations, roles

- `users` are global (one login, many orgs). `memberships(user_id, org_id, role, status)`; `invitations(org_id, email, role, token, expires_at, invited_by)`; optional `teams`; session carries `active_org_id`.
- Roles: `owner`, `admin`, `member` defaults plus **custom permission sets** per org (resource × action), and **event-scoped grants** (`event_grants(user_id, event_id, role)`) for check-in staff, speakers and exhibitors who must see one event only. Vision's agency persona ("Clients | Events") implies an org hierarchy or "agency manages child orgs" relationship — model `org_relationships(parent_org_id, child_org_id, kind)` from day one.
- **Recommend Better Auth** (v1.7.6 latest; release dates UNVERIFIED) with the `organization` plugin (organization/member/invitation/team tables, `createAccessControl`, `activeOrganizationId`, invitations expire in 48 h by default, `membershipLimit` default 100 — raise it, dynamic roles stored in `organizationRole`, before/after hooks) and the `admin` plugin for impersonation and bans. It is self-hosted, so no per-org or per-domain fees and full control over cookies on tenant domains. Runner-up **Clerk**: fastest to ship, but 100 monthly-active-orgs included then $1/MAO with the $100/month Enhanced B2B add-on, **satellite domains $10/month each and registered manually** — unworkable for arbitrary tenant custom domains. WorkOS is strong for enterprise SSO later.
- **Sessions across custom domains**: cookies cannot span apexes. Attendee/guest sessions on `events.org.com` use a handoff: tenant domain → central login on `yayatoh.com` → single-use, 60-second, host-bound code → `events.org.com/auth/callback` exchanges it server-side and sets a `__Host-session` cookie. Better Auth's `trustedOrigins` must be dynamic (function form) to accept every verified tenant domain — UNVERIFIED that it accepts a function; if not, validate origins in a wrapper.
- Two user populations: organizer **users** vs org-owned **contacts/attendees** (vision §11 Event CRM). Keep `contacts` per org (PII belongs to the org, RLS-scoped) with an optional link to a global user id; do not make attendees global user records.

## 9. Data isolation testing

- Two-tenant fixture, run **through the app role and the pooled connection path** (a superuser test connection hides broken policies).
- `tenant-isolation` suite (vitest or pgTAP, as in tenantwell): as org A, read B's ids → empty; update/delete B's rows → 0 rows; insert with forged `org_id` → `42501`; child referencing B's parent → `23503` via composite FK. An **adversarial raw-SQL** suite that assumes SQL injection as the app role and still expects isolation.
- API/E2E suite: a user who is a member of both orgs, session bound to A, calls every list endpoint (B absent), every detail/update/delete with B's ids (404), every create with B's parent id (rejected). Generate it from the route manifest so new endpoints are covered automatically.
- Schema guard: a CI test that every table with an `org_id` column has `relrowsecurity` and `relforcerowsecurity` true and at least one policy, and that `app_user` has `NOBYPASSRLS`.
- Cache guard: a test that renders the same path for two tenants and asserts differing branding (catches missing tenant in cache keys).
- Treat these like auth tests: CI gate, no merge on red.

## 10. White-label mobile

- **One app, tenant login/picker (recommended).** Apple 4.2.6 rejects template-generated apps unless submitted by the content owner themselves, and explicitly blesses a **single binary hosting all client content in an aggregated/picker model** ("an event app with separate entries for each client event"). Google Play's repetitive-content policy plus its white-label guidance (unique listings, and a separate developer account per client to isolate suspension risk) make per-tenant builds an operational business, not a feature. The app fetches org branding after org selection (QR/link/org code) and themes at runtime; the existing Yayatoh app keeps its identity.
- **Per-tenant builds** as a premium tier only: Expo EAS dynamic `app.config.ts` + `APP_VARIANT` gives distinct bundle ids/icons/names per profile, but each tenant needs its own Apple/Google developer account, review cycle and release train.
- **Deep links pitfall**: iOS associated domains need each apex listed in the entitlement (`applinks:`), so a new custom domain requires an app update; wildcard subdomains (`applinks:*.yayatoh.events`) are supported per Apple docs but one fetch summary contradicted this — UNVERIFIED, test. Mitigation: deep links always point at `*.yayatoh.events` or a link domain and custom domains redirect; serve `/.well-known/apple-app-site-association` and `assetlinks.json` from the proxy for every tenant host.
- **API**: versioned `/api/v1` for the existing apps (frozen contract, adapter layer over the new domain model), `/api/v2` tenant-aware (org id from token claims, never from a header the client controls). Push notifications are per-app, so tokens are keyed `(user, org, device)`.

## Recommended architecture (summary)

Vercel-hosted Next.js 16.3 (Node proxy, Cache Components) → Global Config/Redis host map → `/t/[org]` rewrite with root params → Drizzle + Postgres 18 with `org_id` + RLS (transaction-scoped `set_config`, `FORCE RLS`, non-owner role, PgBouncer/Neon transaction pooling) → Better Auth (org + admin plugins) with central login and domain handoff → Vercel Domains API for custom domains (Cloudflare for SaaS or Caddy only if the origin moves off Vercel) → SES v2 Tenants for per-org sending domains → Stripe Connect per org. Tenant public sites on a dedicated apex, dashboard/auth on `yayatoh.com`, PSL submission filed early.



## Key recommendations

- Use one shared Postgres with org_id on every tenant table and Postgres RLS (FORCE RLS, non-owner app role with NOBYPASSRLS, transaction-scoped set_config, (SELECT current_setting()) wrapper, org_id-leading indexes, composite FKs); keep a connection-routing seam for a future dedicated-DB enterprise tier, reject schema-per-tenant.
- Choose Drizzle ORM (0.45.x) over Prisma 7 because RLS roles/policies are declared in the schema and migrated by drizzle-kit and transactions stay explicit; Prisma's RLS extension breaks explicit $transaction and Prisma 8 replaces client extensions.
- Run runtime traffic through a transaction-mode pooler (PgBouncer/Neon/Supavisor) with every tenant query inside a transaction; avoid RDS Proxy (set_config pins connections) or use literal SET LOCAL with a validated UUID; run migrations over a direct connection as the owner role.
- Resolve tenants in Next.js 16 proxy.ts (Node runtime): host -> Global Config/Redis lookup -> delete inbound x-tenant-* headers -> rewrite to /t/[org]/... so the tenant is a root param and automatically part of use cache keys; tag caches with org:<id> and revalidate by tag, never by public path.
- Serve tenant public sites from a dedicated apex (e.g. *.yayatoh.events) and keep dashboard/auth on yayatoh.com with __Host- cookies; submit the tenant apex to the Public Suffix List.
- Provision custom domains through the Vercel Domains API (unlimited on Pro, no per-domain fee, LE certs auto-issued) behind a queue that respects 100 additions/50 verifications per hour; move to Cloudflare for SaaS ($0.10/hostname/mo after 100) or a Caddy on-demand-TLS cluster only if the origin leaves Vercel, since Cloudflare's Host-header override is Enterprise-only.
- Store a validated per-org theme token object and render it as cached CSS variables in the /t/[org] root layout; map Tailwind v4 theme to those variables; generate favicon/OG images per org via icon.tsx/opengraph-image.tsx; theme React Email templates from the same tokens; drive navigation and dashboard cards from per-org module flags.
- Use Amazon SES v2 with Tenants (one SES tenant per org for reputation isolation, 10,000 identities per Region) and a subdomain-delegation onboarding wizard (mail.<org-domain>: Easy DKIM CNAMEs + custom MAIL FROM MX/SPF); fall back to orgslug@mail.yayatoh.com until verified. Postmark is the runner-up; Resend's domain caps (1,000 on Scale) disqualify it.
- Adopt Better Auth (organization + admin plugins) self-hosted: global users, memberships, invitations (48h), custom permission sets, event-scoped grants, impersonation with impersonatedBy, reason, audit row, UI banner and blocked financial actions; implement a one-time-code login handoff for sessions on tenant custom domains. Clerk loses on $10/mo per satellite domain and MAO pricing.
- Ship a CI-gated isolation suite: two-tenant vitest/pgTAP tests through the app role and pooled path, adversarial raw-SQL test, generated API tests for a dual-org user (other org's ids -> 404), a schema guard asserting RLS enabled/forced on every org_id table, and a cache guard rendering the same route for two tenants.
- Keep a single mobile app with an org picker and runtime theming (Apple 4.2.6 aggregated model, Google Play repetitive-content policy); offer per-tenant builds only as a premium tier under the client's own developer accounts; keep deep links on the platform link domain because iOS associated domains must list each apex and require an app update.
- Freeze the existing mobile contract as /api/v1 with an adapter over the new domain model and add tenant-aware /api/v2 where org comes from token claims; key push tokens by (user, org, device).


## Data model implications

- organizations: id, slug, name, plan, type (concert|conference|wedding|agency|...), settings jsonb, theme jsonb, default_locale (12 supported), powered_by_visible, status
- org_domains: org_id, hostname, kind (subdomain|custom), is_primary, verification_status (pending_dns|verifying|active|failed), verification_token, provider_ref (Vercel/Cloudflare id), ssl_status, redirect_to, created_at
- org_modules: org_id, module_key (events, ticketing, registration, seating, checkin, sessions, speakers, exhibitors, sponsors, marketing, notifications, analytics, integrations, white_label), enabled, limits jsonb
- org_navigation: org_id, items jsonb (label, href, visibility); org_email_templates: (org_id, template_key, locale) -> overrides
- users (global identity) vs memberships(user_id, org_id, role, status, created_at) vs invitations(org_id, email, role, token, expires_at, invited_by, accepted_at); optional teams; session.active_org_id
- org_roles / permission sets (org_id, name, permissions jsonb) plus event_grants(user_id, event_id, role) for event-scoped staff (check-in, speaker, exhibitor portals)
- org_relationships(parent_org_id, child_org_id, kind) to support agencies managing client organizations
- contacts/attendees are org-owned CRM records (org_id, email, phone, optional user_id link, consent flags) — not global user rows
- platform_staff(user_id, platform_role) and impersonation_sessions(actor_id, target_user_id, org_id, reason, started_at, ended_at, ip) plus a general audit_log(org_id nullable, actor, action, entity, before/after)
- org_email_domains(org_id, provider, provider_identity_id, ses_tenant_name, domain, dkim_records jsonb, mail_from_domain, status, verified_at, dkim_rotated_at)
- org_payment_accounts(org_id, stripe_account_id, controller_config jsonb, onboarding_status, default_currency)
- Every tenant-owned table: org_id uuid NOT NULL, composite FK (org_id, parent_id) to parents, indexes leading with org_id, RLS enabled + forced with tenant_isolation policy; optional shard_key/database_ref on organizations for a future dedicated-DB tier
- device_push_tokens(user_id, org_id, device_id, platform, token) and api_clients/tokens scoped to org for /api/v2


## Risks

- RLS performance regressions if current_setting() is not wrapped in (SELECT ...) or indexes do not lead with org_id — up to ~575x slowdowns reported on large tables.
- Cross-tenant cache bleed if tenant identity is read from headers instead of route/root params, or if revalidatePath is used against public (pre-rewrite) paths; proxy does not run for on-demand ISR requests.
- Connection pinning on RDS Proxy when using set_config, silently collapsing pool efficiency; SET LOCAL behaviour for Postgres is only implied in AWS docs (UNVERIFIED).
- Cookie leakage between tenant subdomains and the dashboard until the tenant apex is on the Public Suffix List; mitigation requires a separate apex and __Host- cookies from day one.
- Vercel Domains API rate limits (100 adds/hour per team) can stall bulk onboarding or migrations of existing Yayatoh organizers; requires a provisioning queue.
- Cloudflare for SaaS cannot sit in front of Vercel without Enterprise (Host-header override), so a later hosting move changes the whole custom-domain strategy.
- Prisma 8 (Prisma Next) replaces client extensions; any RLS built on $extends will need rework — a reason to pick Drizzle, whose 1.0 is itself still in RC (0.45.x is stable).
- Better Auth is a fast-moving OSS library (1.7.x); trustedOrigins handling for thousands of tenant domains and multi-domain session handoff are custom code the team must own and security-test.
- Email deliverability: shared sending reputation across tenants can be poisoned by one abusive organizer; SES Tenants/automated pause policies mitigate but require per-tenant monitoring and abuse controls.
- App Store policy: per-tenant white-label apps require the tenant's own developer account (Apple 4.2.6) and unique listings (Google Play); a single-app model constrains how far branding can go on mobile.
- Impersonation and platform_reader bypass are high-value attack surfaces; without mandatory reasons, audit rows and blocked financial actions they become a compliance liability.
- Migrating existing Laravel organizers, events and attendees into org-scoped tables requires assigning every legacy row an org_id; orphaned or shared records (venues, global attendees) need explicit ownership decisions.


## Open questions

- Hosting decision: commit to Vercel (Domains API, Global Config) or plan for self-hosting/Cloudflare from the start? This determines the custom-domain and TLS strategy.
- Is a dedicated apex for tenant sites acceptable (e.g. *.yayatoh.events or *.yayatoh.site), or must tenant subdomains live under yayatoh.com (which then needs a PSL submission and stricter cookie hygiene)?
- Which white-label tier gets custom domains, custom email domains and 'Powered by Yayatoh' removal, and what is the price point? (Affects whether per-domain costs matter.)
- Should venues remain a shared, platform-level directory (as today at /venues) or become org-owned? Same question for the public /events marketplace: opt-in per org, per event, or always listed?
- Agencies: do they need to manage multiple client organizations under one login (org hierarchy), and can a client org later be 'detached' from the agency?
- Which enterprise customers, if any, will demand a dedicated database or region; is a dedicated-DB tier needed in the first 18 months?
- Attendee identity: should ticket buyers have one global Yayatoh account that works across organizers (marketplace behaviour), or org-scoped accounts only on white-label domains?
- Mobile: will tenants be offered their own branded apps (their developer accounts, premium tier), or is a single Yayatoh app with an org picker sufficient for the next 2 years?
- Email provider preference or existing AWS/Postmark/Resend relationships, and whether all orgs send under Yayatoh's domain by default until they verify their own.
- Data residency and compliance requirements (GDPR for EU organizers, PCI scope via Stripe, SOC 2 timeline) that would change the isolation model or logging requirements.
- How many current Yayatoh organizers/events/attendees exist, to size the domain-provisioning queue and the org_id backfill migration?
- What are the current mobile apps' API endpoints and auth scheme, to decide how long /api/v1 must remain frozen?


## Sources

- https://nextjs.org/blog
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://nextjs.org/docs/app/api-reference/directives/use-cache
- https://nextjs.org/docs/app/api-reference/functions/next-root-params
- https://nextjs.org/docs/app/guides/multi-tenant
- https://vercel.com/docs/platforms
- https://vercel.com/docs/platforms/multi-tenant-platforms/concepts
- https://vercel.com/docs/platforms/multi-tenant-platforms/limits
- https://vercel.com/docs/platforms/multi-tenant-platforms/configuring-domains
- https://vercel.com/docs/platforms/multi-tenant-platforms/middleware-and-routing
- https://vercel.com/changelog/edge-config-is-now-global-config
- https://github.com/vercel/platforms
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/
- https://developers.cloudflare.com/rules/origin-rules/
- https://caddyserver.com/docs/automatic-https
- https://letsencrypt.org/docs/rate-limits/
- https://cert-manager.io/docs/usage/ingress/
- https://orm.drizzle.team/docs/rls
- https://github.com/drizzle-team/drizzle-orm/releases
- https://neon.com/docs/guides/rls-drizzle
- https://neon.com/docs/connect/connection-pooling
- https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security
- https://www.prisma.io/docs/orm/v7/prisma-client/client-extensions
- https://www.prisma.io/blog/announcing-prisma-orm-7-0-0
- https://www.prisma.io/blog/prisma-next-roadmap
- https://www.pgbouncer.org/features.html
- https://www.pgbouncer.org/faq.html
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html
- https://richyen.com/postgres/2026/03/12/rds_proxy_pinning.html
- https://www.thenile.dev/docs/tenant-virtualization/tenant-isolation
- https://mvpfactory.io/blog/postgresql-row-level-security-without-the-performance-tax-policies-indexes-and
- https://www.bytebase.com/blog/postgres-row-level-security-footguns/
- https://planetscale.com/blog/approaches-to-tenancy-in-postgres
- https://github.com/dallascrilley/tenantwell
- https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- https://www.postgresql.org/about/news/postgresql-19-beta-4-released-3386/
- https://resend.com/docs/api-reference/domains/create-domain
- https://resend.com/pricing
- https://postmarkapp.com/developer/api/domains-api
- https://postmarkapp.com/support/article/adding-sender-signatures
- https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim-easy.html
- https://docs.aws.amazon.com/ses/latest/dg/quotas.html
- https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-ses-tenant-isolation-automated-reputation-policies
- https://aws.amazon.com/about-aws/whats-new/2024/12/amazon-simple-email-services-deterministic-easy-dkim/
- https://docs.stripe.com/connect/design-an-integration
- https://www.better-auth.com/docs/plugins/organization
- https://www.better-auth.com/docs/plugins/admin
- https://registry.npmjs.org/better-auth/latest
- https://clerk.com/pricing
- https://clerk.com/docs/guides/dashboard/dns-domains/satellite-domains
- https://clerk.com/docs/guides/users/impersonation
- https://workos.com/docs/user-management/impersonation
- https://developer.apple.com/app-store/review/guidelines/
- https://developer.apple.com/documentation/xcode/supporting-associated-domains
- https://support.google.com/googleplay/android-developer/answer/15884185?hl=en
- https://docs.expo.dev/tutorial/eas/multiple-app-variants/
- https://opennext.js.org/cloudflare
- https://github.com/vercel/next.js/issues/59825
- https://dev.to/ai_changewatch/a-middlewarets-rewrite-silently-disables-isr-in-nextjs-155-2d37
