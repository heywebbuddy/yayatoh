# Security Compliance

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Security, privacy, compliance and accessibility for Yayatoh 2.0 (multi-tenant event platform handling payments and attendee PII)

# Security, Privacy, Compliance & Accessibility — Yayatoh 2.0

Grounding: the vision document requires strict per-organization data isolation, white-label custom domains, a stable mobile API, offline-capable check-in, a cross-event attendee CRM, and marketing across email/SMS/WhatsApp/push. Every one of those is a security or compliance surface. Assumed stack (from the wider plan): Next.js 16.x (docs currently at 16.3.6), Postgres, Stripe Connect, Vercel edge, native iOS/Android apps. Yayatoh is Maryland-based, serves EU attendees, and offers a 12-language UI.

## 1. Multi-tenant isolation (defense in depth)

Three independent layers; any single one failing must not expose another tenant.

**Layer 1 — tenant-scoped data model.** Every tenant-owned table carries `org_id uuid NOT NULL`. Child tables use composite foreign keys `(org_id, parent_id)` so a row can never reference a parent in another org. Public identifiers are prefixed, non-sequential (`org_…`, `evt_…`, `tkt_…`, UUIDv7 internally) so IDOR via enumeration is impossible. Uniqueness is scoped `(org_id, slug)`, never global, because Postgres unique/FK checks bypass RLS and a global unique violation leaks existence across tenants (PostgreSQL docs warn of this covert channel).

**Layer 2 — application scoping in a Data Access Layer.** Next.js' own guidance for new projects is a server-only DAL that performs authorization and returns minimal DTOs; only the DAL may import the DB client or read `process.env`. Enforce this with an ESLint restriction (`no-restricted-imports` for the db module outside `/data`). Every DAL function takes a `TenantContext` (org, actor, role) and every query builder is obtained via `db.forOrg(ctx)`; there is no un-scoped builder in application code. Server Actions delegate to the DAL and re-check auth inside each action, since Next.js treats them as publicly reachable POST endpoints and a page-level check does not cover them.

**Layer 3 — Postgres row-level security.** `ENABLE` and `FORCE ROW LEVEL SECURITY` on all tenant tables (owners bypass RLS unless forced). Policy: `org_id = (select current_setting('app.org_id', true))::uuid` — wrapping in `select` lets Postgres cache it per statement (Supabase's documented initPlan optimisation), and `org_id` must be indexed on every table or policies degrade to sequential scans. The app connects as a dedicated role with no `BYPASSRLS`, distinct from the migration/owner role. Tenant context is set with `SET LOCAL` inside the transaction so it cannot leak through a transaction-mode pooler. Drizzle ORM (`pgPolicy`, `withRLS`) keeps policies in the schema so they are code-reviewed and migrated.

**Common RLS bypass mistakes to design out:** (a) new tables default to RLS off — add a CI check that fails if any table in the tenant schema has `rowsecurity = false` or no `FORCE`; (b) views run as definer by default — create with `security_invoker = true` (PG15+); (c) `SECURITY DEFINER` functions with an unpinned `search_path` — always `SET search_path = ''` and never expose them via API roles; (d) service/superuser connections used by "convenience" scripts; (e) sub-selects in policies create race conditions — prefer immutable session settings; (f) caches outside Postgres (Next.js `unstable_cache`/`"use cache"` keys, ISR of tenant pages, search indexes, Redis) must include `org_id`/host in the key; (g) object storage — per-org prefixes with short-lived signed URLs, never public listing.

**Background jobs, crons, webhooks, admin tools.** Every job payload carries `org_id`; the worker wraps handlers in `withTenant(orgId)` that opens the transaction and sets the RLS context. Jobs with no tenant (billing rollups, purge) run under an explicit `system` role and must be allowlisted by name. Stripe webhooks resolve `account` → org before any data access. Staff "support sessions" are separate sessions with actor = staff, subject = org, reason, 60-minute TTL, read-only by default, written to the audit log, and RLS context = the viewed org only (never a global bypass).

**Automated cross-tenant test suite.** Fixtures create Org A and Org B with parallel data. A generated test walks the route manifest (pages, route handlers, server actions, `/api/v1`) calling each with A's credentials and B's identifiers, asserting 404/403 and zero B bytes in the response; a coverage manifest fails CI when a new endpoint has no test. Add pgTAP tests per table/role (Supabase's `supabase test db` pattern works on plain Postgres), plus a nightly "tenant canary" that counts rows visible under Org A's context against expected totals.

## 2. OWASP Top 10:2025 and Next.js-specific risks

The 2025 list (verified at top10.owasp.org): A01 Broken Access Control (now absorbs SSRF), A02 Security Misconfiguration, A03 Software Supply Chain Failures (new), A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging & Alerting Failures, A10 Mishandling of Exceptional Conditions (new — fail-open logic). Multi-tenant IDOR sits squarely in A01; §1 is the mitigation.

Next.js advisories that shape the design (all verified via CVE/GHSA records):

| Issue | Severity | Fixed in | Lesson for Yayatoh |
|---|---|---|---|
| CVE-2025-29927 middleware auth bypass via `x-middleware-subrequest` | 9.1 | 15.2.3 / 14.2.25 (Mar 2025) | Proxy is optimistic only; DAL is authoritative |
| CVE-2025-49826 cache-poisoning DoS (204 cached) | 7.5 | 15.1.8 | Self-hosted caches need Vary/status discipline |
| CVE-2025-49005 RSC payload served as HTML (missing Vary) | 3.7 | 15.3.3 | Redirect + middleware interplay must be tested |
| CVE-2025-57822 SSRF via middleware redirect handling | 6.5 | 14.2.32 / 15.4.7 | Never forward user headers on self-host |
| CVE-2025-57752 image optimizer cache-key confusion | 6.2 | 15.4.5 / 14.2.31 | Never serve auth-dependent images through `/_next/image` |
| CVE-2025-55173 image optimizer content injection | 4.3 | 15.4.5 | Strict `images.remotePatterns` |
| CVE-2025-55182 "React2Shell" RSC deserialization RCE (+ DoS follow-ups 55184, 67779, 2026-23864) | 10.0 | React 19.x.1 lines; Next 15.0.8/16.0.11 (Dec 2025) | 24-hour patch SLA is non-negotiable |
| CVE-2026-64642 proxy bypass (Turbopack, single locale) | 8.3 | 16.2.11 | Same lesson as 29927, again |
| CVE-2026-64645 SSRF in rewrites with user-controlled hostname | 8.3 | 15.5.21 / 16.2.11 | White-label host routing must never build hostnames from input |
| GHSA-2xp9-vwfh-vxw4 unauthenticated RCE in image optimizer (AVIF via libheif/sharp) | 9.5 | 15.5.24 / 16.3.3 (Aug 2026) | Isolate image processing from the web tier |

Controls: (1) Renovate with a critical-patch SLA of 24 hours, GitHub advisory subscription for `vercel/next.js` and `react-server-dom-*`. (2) Authorization in the DAL and inside every Server Action; `proxy.ts` (Next.js 16 renamed middleware and defaults to Node runtime) only resolves the tenant from `Host`, adds request ID and CSP nonce, and does a cookie-presence redirect. (3) Image pipeline: user uploads are re-encoded on ingest by an isolated worker into a per-org bucket; public pages use `remotePatterns` restricted to that bucket host; consider a dedicated image CDN instead of `/_next/image` for user content. (4) Outbound requests (organizer webhooks, integration URLs, ICS/RSS imports): resolve DNS, reject RFC1918/link-local/metadata ranges, no redirects to private ranges, egress through one module. (5) Caching: tenant pages render dynamically keyed by host; never cache responses that depend on cookies/authorization.

**CSP.** Next.js supports nonce-based strict CSP generated in `proxy.ts`, but this forces dynamic rendering and is incompatible with PPR. Use two profiles: dashboard/checkout/registration → nonce + `strict-dynamic`; public event pages → static rendering with the experimental SRI hashes and no `unsafe-inline` scripts. Stripe publishes exact directives (`js.stripe.com`, `*.js.stripe.com`, `hooks.stripe.com`, `api.stripe.com`); include them and nothing else on checkout. `frame-ancestors` is per-tenant so a white-label org can embed its own widget on its own domain.

**CSRF.** Browser surfaces use cookie sessions (`SameSite=Lax`, `Secure`, `HttpOnly`); Next.js already enforces Origin/Host matching on Server Actions — set `serverActions.allowedOrigins` when a CDN or proxy sits in front. Route handlers that accept cookies also require a double-submit token. The mobile/partner API (`/api/v1`) accepts only `Authorization: Bearer`, never cookies, never keys in query strings; that separation is what makes it CSRF-immune. Add HSTS (preload), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`.

**Supply chain (A03).** Lockfile + `npm ci`, Socket or Snyk in PR, GitHub Actions pinned by SHA, SBOM (CycloneDX) per release, provenance attestations, minimal server-side dependency count. OWASP ASVS 5.0.0 (30 May 2025) is the requirements/verification baseline; target Level 2.

## 3. Authentication hardening

**Library:** Better Auth (v1.7.6, 24 Sep 2026) with the organization, two-factor and passkey plugins; passkeys are built on SimpleWebAuthn v14. Rationale: first-class organizations/roles/invitations, TOTP, passkeys with conditional UI, DPoP and PKCE hardening in 1.7, self-hosted (no per-MAU cost for tens of thousands of attendees). Runner-up: Auth.js (thinner org/MFA story) and Clerk/WorkOS (per-MAU pricing punishes attendee-scale accounts; keep WorkOS in mind for enterprise SAML later).

**Passwords (NIST SP 800-63B-4, 26 Aug 2025):** minimum 15 characters when password-only, 8 with MFA; allow ≥64; no composition rules; no periodic rotation; blocklist every new password against HIBP Pwned Passwords (k-anonymity, no key, no rate limit, use `Add-Padding`); Argon2id; lock an authenticator after ≤100 consecutive failures with progressive delays, plus IP/ASN rate limits.

**MFA:** TOTP mandatory for org owners/admins and all Yayatoh staff; passkeys required for staff and offered to everyone (phishing-resistant, which NIST encourages at AAL2). SMS OTP is "restricted" under 63B-4 — use it only for attendee low-risk flows and recovery, and protect the send endpoint with Turnstile, per-number and per-IP limits, geo permissions and Twilio Fraud Guard, because SMS-pumping fraud turns OTP endpoints into a bill. Step-up (re-auth + MFA) before: payout/bank changes, API key creation, custom-domain changes, bulk exports, impersonation, ticket transfers after a recent credential change.

**Sessions:** opaque server-side sessions (Postgres/Redis), rotated on privilege change, absolute 24 h + 1 h idle for admin roles (AAL2), 30 days for attendees (AAL1), device list with remote revoke, alerts on new-device login. White-label domains split cookies by host, so authenticate on a central `auth.yayatoh.com` and hand the tenant domain a tenant-scoped session via redirect; register passkeys on the central rpID (passkeys are bound to the rpID and cannot roam across customer domains).

**Mobile and scanner devices:** OAuth 2.1 shape — 10–15 minute access tokens, rotating refresh tokens with reuse detection (revoke the whole family), PKCE for any browser step, tokens in Keychain/Keystore. Check-in devices get device-scoped, event-scoped tokens that expire 24 h after the event; devices are enrolled and revocable from the command center (which the vision wants to show "scanner/device status").

**Ticket-wallet account takeover:** email/password change → notify old address, require MFA, and freeze ticket transfers and payout changes for 24 h; transfers require recipient acceptance; magic links single-use, 10-minute TTL, bound to the requesting browser; uniform responses to prevent account enumeration.

## 4. QR / ticket anti-forgery and anti-sharing

Tokens are signed, not looked up blindly: payload `{ticket_id, event_id, type, key_version, issued_at}` signed with Ed25519 (per-event key pair). Scanners hold only public keys, so a stolen scanner cannot forge tickets, and offline validation works — the vision's requirement that entry keeps working when venue internet fails. Keep the DB status check as the second layer when online. No PII in the QR; opaque IDs only; do not encode a URL (phishing surface).

Anti-sharing: rotating barcodes (Ticketmaster's SafeTix model — an encrypted barcode that refreshes every few minutes, tied to the account) implemented as a TOTP-style code derived from a per-ticket secret held in the app/web wallet; scanners accept ±1 time step. Organizers choose per event whether static PDF tickets are allowed (lower trust tier, flagged in reports). Transfer or resale bumps `key_version`, invalidating the old QR.

Duplicate prevention: a unique constraint on `(ticket_id)` in `checkins` for single-entry events, idempotent scan submissions, and an offline manifest (hashed ticket IDs + status) downloaded at event start; offline scans sync with first-timestamp-wins and duplicates surfaced as "duplicate scan attempts" in the command center. Fraud signals: same ticket at two entrances within N minutes, scans before doors open, per-device velocity and failure rates — all feed the dashboard alerts the vision describes.

## 5. PII and privacy

**Roles.** For organizer-collected attendee data Yayatoh is the processor (organizer = controller). For its own accounts, the public marketplace (yayatoh.com discovery), fraud signals and analytics it is the controller. Stripe is an independent controller for payment data under its DPA.

**Laws in scope.** GDPR Article 3(2): offering services to people in the EU or monitoring them triggers GDPR regardless of payment — EU attendees registering for a US event count. DSARs: one month, extendable by two; breach notice to the authority within 72 h (controller) and processor → controller "without undue delay" — commit contractually to 24 h. UK GDPR mirrors this; transfers rely on the UK Addendum/IDTA or the UK Extension to the DPF. EU-US DPF adequacy (10 July 2023) remains the transfer mechanism; Vercel and Stripe are both certified — Yayatoh should self-certify and keep SCCs as the fallback in its DPA (the 2025 General Court challenge outcome: UNVERIFIED here). CCPA/CPRA: >$25M revenue (CPI-adjusted figure UNVERIFIED), 100k consumers, or 50% revenue from selling; 45 days + 45; new regulations on risk assessments, cybersecurity audits and ADMT are effective 1 Jan 2026 (phased deadlines UNVERIFIED). Maryland MODPA (effective 1 Oct 2025): 35,000 consumers, or 10,000 plus ≥20% revenue from sales; "strictly necessary" data minimization; sale of sensitive data prohibited; 45-day responses; AG enforcement. TCPA prior express written consent for marketing SMS, A2P 10DLC brand/campaign registration, WhatsApp explicit opt-in naming the business, CAN-SPAM (10-business-day opt-out, physical address, penalties up to $53,088 per email).

**Consent at registration.** Per-purpose, unchecked-by-default checkboxes (organizer marketing, Yayatoh marketing, SMS, WhatsApp) with a `consents` table storing timestamp, IP, form version and exact text; honor Global Privacy Control; geo-gated cookie CMP; double opt-in as an org setting. The organizer form builder must flag sensitive fields (dietary, accessibility, health, religion — common at galas) as special-category: explicit consent, field-level encryption, shorter retention.

**Cross-event CRM scoped per organization (vision §11) — analysis.** The CRM must be `contacts (org_id, email_normalized)`; the same person at Org A and Org B is two rows with no shared attributes, history or engagement. A global login `users` row may link to many contacts, but only so an attendee can see *their own* tickets across organizers (their own data). Merging profiles across tenants would make Yayatoh a controller running platform-wide profiling without a legal basis, breach the processor role under Art. 28, and sell out one organizer's customer list to another. The only cross-tenant signals allowed are platform fraud/abuse attributes (device fingerprint, chargeback history) held by Yayatoh as controller under legitimate interest, stored separately, never exposed to organizers as attendee attributes. RLS on `contacts` enforces this mechanically; merges and dedup jobs run inside a tenant context.

**DSAR handling across tenants.** A privacy console lets any person export/delete account-level data self-service. For organizer-held data, Yayatoh (processor) routes the verified request to each org's admins as a task with SLA tracking, exports JSON/CSV per org per contact, and deletes by pseudonymizing the contact while keeping orders/tickets for financial records (7 years) under a legal-hold flag. Identity verification via the registered email loop.

**Retention (defaults, org-tunable within bounds):** attendee PII 24 months post-event; check-in logs 12 months; marketing engagement 24 months; audit logs 12 months hot/7 years cold; payment records 7 years; backups 30–35 days; automated purge jobs.

**DPA and sub-processors.** Click-through DPA at org creation with Art. 28 clauses (instructions, confidentiality, Art. 32 security, sub-processor authorization with 30-day notice, DSAR assistance, deletion/return, audit rights). Initial sub-processor list: Vercel (hosting, DPF-certified, SOC 2/ISO 27001), Postgres provider (Neon/Supabase), AWS (storage/KMS), Stripe, email provider, Twilio, Meta (WhatsApp), Cloudflare (if used), Upstash, Sentry (with PII scrubbing), analytics, job runner, any LLM vendor. Privacy notices translated into all 12 UI languages; assess whether an EU/UK representative (Art. 27) is needed once EU volume is material.

## 6. Payments (PCI DSS)

Stripe Checkout, Payment Element and the mobile SDKs host card inputs in Stripe iframes/SDKs so card data never touches Yayatoh servers; Stripe states these, including Connect platforms, qualify for SAQ A. Store only Stripe IDs, brand, last4, expiry. Vercel provides an SAQ-D service-provider AOC and a responsibility matrix via its Trust Center. PCI DSS v4.0.1 requirements 6.4.3 (script inventory) and 11.6.1 (tamper detection) were removed from SAQ A in early 2025 but replaced by an eligibility criterion that the merchant confirms its checkout page is not susceptible to script attacks (PCI SSC FAQ exists; exact wording UNVERIFIED) — meet it with the strict CSP profile, SRI, a documented script inventory, and zero third-party scripts on checkout routes. Verify webhook signatures, enforce idempotency keys, record processed event IDs.

Connect configuration: use Stripe-hosted (or embedded) onboarding so Stripe collects KYC and beneficial-owner data, and choose controller settings where Stripe is responsible for negative balances and requirement collection — Stripe's recommended default for SaaS platforms new to embedded payments — with Express dashboard or embedded components. Use direct charges on the connected account (organizer is merchant of record, matching "its own payment configuration") with an application fee. Stripe Radar handles transaction risk; enable Radar's bot-abuse, fraudulent-merchant and fraudulent-website signals for connected accounts. Payout-account changes are the highest-value ATO target: step-up, notify all org admins, 24-hour hold.

## 7. Audit logging, secrets, encryption, backups

**Audit log:** append-only `audit_events` (monthly partitions): actor (user/API key/system/staff), on_behalf_of, org_id, action (`event.publish`, `payout.account.update`), target, redacted before/after, IP, UA, request_id, occurred_at; written in the same transaction by a DAL hook; the app role has no UPDATE/DELETE; nightly export to object-lock (WORM) storage with a hash chain; streamed to a SIEM via Vercel log drains. Organizations get their own audit-log UI (an enterprise expectation and SOC 2 CC7 evidence). Buy option: WorkOS Audit Logs (30-day default retention, up to 10 years, SIEM streams) — lost to build because an extra vendor for a table you must write anyway.

**Impersonation:** support sessions as in §1, with owner notification, optional owner approval for enterprise orgs, and a persistent UI banner.

**Secrets:** Infisical (open-source, self-hostable, secret scanning) or Doppler as source of truth, synced into Vercel sensitive environment variables; Stripe restricted keys per service, periodic rotation per Stripe's guidance, `gitleaks` pre-commit plus GitHub push protection. Stripe IP allowlisting only becomes possible with Vercel Secure Compute/static egress IPs (Enterprise).

**Encryption at rest:** disk encryption from the DB/host provider (Vercel: AES-256) is not enough for integration OAuth tokens, SMTP/WhatsApp credentials, webhook secrets, TOTP seeds and sensitive registration answers. Use envelope encryption: a customer-managed KMS key, a per-org data key generated with `GenerateDataKey`, the encrypted DEK stored beside the ciphertext, AES-256-GCM with AAD `(org_id, column)`, `encryption context {org_id}` on KMS calls, annual rotation by re-wrapping DEKs. Yayatoh-issued API keys are stored hashed (SHA-256) with a `yk_live_` prefix and last4. "Bring your own key" per org is a later enterprise feature the design leaves room for.

**Backups and targets:** Postgres PITR (Neon instant restore to any timestamp/LSN within the plan's window; Supabase PITR add-on ~$100/month for 7 days) plus daily logical dumps to a separate account/region, object-storage versioning and cross-region replication; quarterly restore drills with measured RTO and a game day before each peak season. Targets: Tier 1 checkout/ticketing/check-in API — RPO ≤5 min, RTO ≤1 h (offline check-in covers event-day outages); Tier 2 dashboard/marketing — RPO 1 h, RTO 4 h; Tier 3 analytics — RPO/RTO 24 h.

## 8. SOC 2, ISO 27001 and questionnaire readiness

Enterprise, association and government buyers will ask before the RainFocus-class modules sell. Plan SOC 2 Type I around months 6–9 after 2.0 launch and Type II 9–12 months later after a 6-month observation window, on the Security, Availability and Confidentiality criteria (matching Vercel's report). Tooling: Vanta (recommended; broadest auditor network and integrations) with Drata as the runner-up — neither publishes prices; budget roughly $10–25k/year for the platform and $15–40k for the audit (UNVERIFIED market estimates), plus an annual penetration test. Prerequisites: ~20 policies, SSO+MFA everywhere, laptop MDM, background checks, vendor risk reviews, change management via PRs, vulnerability SLAs, incident and DR tests. ISO 27001:2022 (93 Annex A controls; the 2013 transition closed 31 Oct 2025) in year 2–3 for EU enterprise sales, reusing the same evidence. Questionnaire kit: Trust Center with the SOC 2 report, pen-test summary, DPA, sub-processor list, DPF listing, PCI SAQ A AOC, architecture and RLS description, pre-filled CAIQ/SIG Lite, and a VPAT/ACR.

## 9. Accessibility (WCAG 2.2 AA)

Standard: WCAG 2.2 (5 Oct 2023) — nine new criteria, 4.1.1 Parsing removed. Legal exposure: DOJ states the ADA applies to public-accommodation websites and points to WCAG without mandating a version (Title III); its Title II rule requires WCAG 2.1 AA of state/local governments — ada.gov currently shows 26 Apr 2027 / 26 Apr 2028 deadlines (originally 2026/2027; the shift is UNVERIFIED) — so universities and cities using Yayatoh will demand conformance from the vendor. The European Accessibility Act applies from 28 June 2025 to e-commerce and passenger-ticketing services; the microenterprise exemption (<10 staff and ≤€2M) may cover small organizers but not Yayatoh once it sells to EU consumers; harmonized standard EN 301 549 (an update was announced in Sept 2026; version UNVERIFIED).

Seat maps are the hard part. SC 2.5.7 Dragging Movements means the drag-and-drop seating editor needs single-pointer/keyboard alternatives (select seat → "move to table" menu, arrow-key nudging); SC 2.5.8 requires 24×24 CSS-pixel targets or spacing, so seat pickers need zoom and minimum hit areas. The public picker should be SVG with a parallel accessible list/table view (section, row, seat, price, accessible/companion seats as first-class data attributes), roving tabindex, ARIA live announcements, and status conveyed by pattern/icon not color alone; a canvas editor needs a DOM/ARIA shadow layer. Checkout: 3.3.7 Redundant Entry (do not re-ask known data), 3.3.8 Accessible Authentication (no CAPTCHA-only paths; Turnstile is WCAG 2.2 AA), 2.4.11 Focus Not Obscured (sticky headers), extendable ticket-hold timers (2.2.1). White-label theming must enforce ≥4.5:1 contrast in the brand color picker. Tooling: `eslint-plugin-jsx-a11y`, axe-core in Playwright gating critical issues, manual NVDA/VoiceOver passes on checkout, registration and seat finder each release, tagged PDF tickets, accessible email templates, RTL for Arabic, an accessibility statement per tenant, and a VPAT 2.5.

## 10. Abuse prevention

**Bots buying tickets:** on Vercel use BotID Deep Analysis (Kasada; $1 per 1,000 `checkBotId()` calls on Pro; Basic is free) on checkout/queue endpoints plus the Bot Protection managed ruleset; note Vercel documents that a reverse proxy such as Cloudflare in front degrades its bot detection, so pick one edge. Cloudflare's stack (Turnstile free for 20 widgets × 10 hostnames — white-label domains exceed that without Enterprise; Bot Management Enterprise-only; Waiting Room Business+) is the runner-up, best if self-hosting. Add purchase caps per account/card/device, hold timers, velocity limits, verified email before high-demand on-sales, and a Redis-backed virtual queue with signed queue tokens for launches.

**Fraudulent organizers and spam events:** Stripe-hosted onboarding (KYC) is mandatory before publishing a paid event; new organizers sit in a trust tier (manual review of the first paid event, Stripe-managed reserves), Radar's fraudulent-merchant/website signals feed a review queue, Stripe Identity (document + selfie; pricing UNVERIFIED) for high-risk cases, domain verification for white-label, per-day event limits on free tiers, heuristics (celebrity names, off-platform payment links), user reporting with a takedown SLA, and an automated text/image moderation pass with human review for the public marketplace.

## 11. Rate limiting, WAF, DDoS

Edge: Vercel's platform DDoS mitigation and Attack Mode are free on all plans; WAF custom rules (40 on Pro), IP blocking, and rate limiting (IP/JA4 keys, fixed window 10 s–10 min, regional counters, usage-based on Pro) cover the basics; OWASP Core Ruleset and token-bucket limits are Enterprise; mitigated traffic is not billed. Cloudflare comparison: Free managed ruleset only; Pro adds OWASP CRS; rate-limiting rules 1–2 (Free/Pro), 5 (Business), 100 (Enterprise); Cloudflare for SaaS gives 100 free custom hostnames then $0.10 each. Vercel for Platforms offers unlimited custom domains with automatic certificates on Pro, which fits the white-label requirement without Cloudflare. Application layer: `@upstash/ratelimit` sliding windows per user, org, API key and route (login 5/min/IP, OTP sends, password reset, checkout creation, organizer webhooks, marketing sends per org quota), 429 with `Retry-After`; Arcjet is the bundled alternative. A DDoS runbook: enable Attack Mode, challenge checkout, raise pooler limits, open the queue.

## 12. Incident response

Follow NIST SP 800-61 Rev. 3 (April 2025), organized around CSF 2.0 functions. Minimum plan: severity matrix (SEV1 = cross-tenant exposure, payment/key compromise, event-day check-in outage), on-call rotation, comms templates for organizers/attendees/regulators, the 72-hour GDPR clock and the 24-hour processor notice, state breach-notification laws, runbooks for Stripe key compromise, Next.js critical CVE (patch ≤24 h), ATO waves and DDoS, evidence preservation, a public status page, cyber-insurance and counsel contacts, two tabletop exercises a year, and blameless post-incident reviews.

## Security architecture (summary)

Edge (Vercel Firewall/WAF/BotID or Cloudflare) → `proxy.ts` (tenant resolution by host, request ID, CSP nonce, optimistic cookie check) → Next.js app (RSC, Server Actions, `/api/v1` bearer-only for mobile/partners) → DAL (authn/authz, zod validation, tenant context, DTOs) → Postgres (RLS + FORCE, app role, `SET LOCAL`) / Redis (rate limits, queue) / object storage (per-org prefixes, signed URLs) / KMS envelope encryption → workers with tenant context → Stripe Connect, Twilio, Meta, email → audit log, SIEM, error tracking with PII scrubbing.

## Controls checklist by phase

**Phase 0 (foundation, before feature code):** threat model and data classification; org-scoped schema conventions and composite FKs; RLS policy generator and CI checks; DAL and lint rules; Better Auth with organizations; secrets manager; CI gates (Socket/Snyk, gitleaks, axe); logging schema.

**Phase 1 (parity rebuild and migration):** RLS enforced on all tables; cross-tenant test suite; MFA for admins; Stripe Checkout/Elements SAQ A with strict checkout CSP; signed QR tokens and offline manifest; edge WAF + rate limits; audit log; PITR plus off-account backups and first restore drill; privacy notice, DPA, sub-processor page, consent capture; account-level DSAR self-service; WCAG 2.2 AA on public pages and checkout; mobile token model; incident plan and status page.

**Phase 2 (white-label and enterprise modules):** domain verification and per-tenant CSP/frame-ancestors; central auth domain with tenant sessions; passkeys; SAML/OIDC SSO; org-visible audit log; envelope encryption for integrations; org retention policies; BotID/queue on checkout; seat-map accessibility and VPAT; SOC 2 Type I; annual pen test; DPF self-certification.

**Phase 3 (marketing/CRM and scale):** preference center and suppression lists; 10DLC, TCPA and WhatsApp opt-in workflows; org-scoped CRM identity rules and dedup; SOC 2 Type II; ISO 27001 planning; DR game day; enterprise questionnaire kit; optional customer-managed keys.

## Compliance roadmap

Months 0–3: policies, threat model, DPA/sub-processor list, Stripe Connect controller decisions. Months 3–6: launch controls above, PCI SAQ A attestation, accessibility audit of checkout. Months 6–9: SOC 2 Type I, pen test, DPF certification, VPAT. Months 9–18: Type II observation and report, 10DLC/WhatsApp registrations before the marketing module ships. Months 18–30: ISO 27001:2022 certification, CCPA risk-assessment/cyber-audit obligations if thresholds are crossed. Annual: SAQ A, DPF recertification, pen test, restore drill, tabletop, policy review.


## Key recommendations

- Isolate tenants with three independent layers: org_id + composite FKs on every table, a server-only Data Access Layer that is the only code allowed to touch the DB, and Postgres RLS with FORCE and SET LOCAL context — plus a CI-generated cross-tenant test that calls every route/action with Org A's session and Org B's IDs.
- Treat Next.js proxy.ts as optimistic only; authorization lives in the DAL and inside every Server Action (CVE-2025-29927 and CVE-2026-64642 both bypassed middleware). Adopt a 24-hour patch SLA for critical Next.js/React advisories (React2Shell CVE-2025-55182 was CVSS 10.0).
- Move user-image processing off the web tier: re-encode uploads in an isolated worker, restrict images.remotePatterns to your own bucket, and consider a dedicated image CDN instead of /_next/image (AVIF RCE GHSA-2xp9-vwfh-vxw4, cache-key confusion CVE-2025-57752).
- Use Better Auth 1.7.x (organizations, TOTP, passkeys via SimpleWebAuthn 14) with NIST SP 800-63B-4 password rules, HIBP breach checks, mandatory TOTP for org admins/staff, passkeys for staff, step-up for payout/domain/API-key/impersonation changes, and rotating refresh tokens with reuse detection for the mobile apps.
- Sign QR tickets with per-event Ed25519 keys so scanners verify offline with public keys only; add SafeTix-style rotating barcodes in the app/wallet, bump key_version on transfer, and enforce single-entry with a unique constraint plus offline-manifest sync rules.
- Keep the attendee CRM strictly per organization: contacts keyed (org_id, email); never merge or expose profiles across tenants; only platform-level fraud signals may be cross-tenant and only as Yayatoh's own controller data.
- Ship a click-through Art. 28 DPA, a public sub-processor list with 30-day notice, per-purpose consent capture with stored proof, GPC support, default retention schedules with automated purge, and a privacy console that routes DSARs to each organizer as processor.
- Stay in PCI SAQ A: Stripe Checkout/Payment Element/mobile SDKs only, no third-party scripts on checkout routes, strict nonce CSP with SRI, documented script inventory; use Stripe-hosted Connect onboarding with Stripe responsible for negative balances and requirement collection, direct charges with application fees.
- Build an append-only, WORM-exported audit log written in the same transaction as each mutation, with explicit support-session (impersonation) records and an org-facing audit UI; stream to a SIEM via Vercel log drains.
- Use envelope encryption (KMS customer-managed key, per-org data keys, AES-256-GCM with org_id AAD) for OAuth tokens, integration credentials, TOTP seeds and sensitive registration answers; store Yayatoh API keys hashed; keep secrets in Infisical/Doppler synced to Vercel sensitive env vars.
- Set RPO ≤5 min / RTO ≤1 h for checkout and check-in (PITR + off-account daily dumps + quarterly restore drills); rely on offline check-in mode for event-day resilience.
- Pick one edge: on Vercel use Firewall + WAF rate limiting + Bot Protection ruleset + BotID Deep Analysis on checkout and Vercel for Platforms for unlimited white-label domains; use Cloudflare (Waiting Room, Bot Management, Cloudflare for SaaS) only if self-hosting, because a proxy in front of Vercel degrades its bot detection.
- Meet WCAG 2.2 AA on public pages, registration, checkout and the seat finder: non-drag alternatives and 24px targets in seat maps, an accessible list view of seats with accessible-seat attributes, axe in CI, manual screen-reader passes, and a VPAT — driven by ADA Title III exposure, Title II government buyers, and the EAA in the EU.
- Plan SOC 2 Type I at months 6–9 and Type II 9–12 months later on Vanta (Drata runner-up), ISO 27001:2022 in year 2–3, DPF self-certification, annual pen test, and a Trust Center kit for security questionnaires.
- Write the incident response plan against NIST SP 800-61r3 with SEV definitions that include cross-tenant exposure and event-day outages, a 24-hour processor-to-organizer breach notice, Stripe key and Next.js CVE runbooks, and twice-yearly tabletops.


## Data model implications

- Every tenant-owned table has org_id uuid NOT NULL, an index on org_id, composite foreign keys (org_id, parent_id) to parents, and uniqueness constraints scoped by org_id; RLS enabled and forced on all of them.
- Prefixed, non-sequential public identifiers (org_, evt_, tkt_, ord_, contact_) backed by UUIDv7; no integer IDs exposed externally.
- organizations, memberships (user_id, org_id, role), roles/permissions, invitations, api_keys (hashed secret, prefix, last4, scopes, expiry, last_used_at), custom_domains (host, verification_token, status, cert_status, csp_frame_ancestors).
- users (global login identity) separate from contacts (org_id, email_normalized, attributes); contacts.user_id nullable link; consents (org_id, contact_id, purpose, granted_at, ip, form_version, text_hash, source); suppressions (org_id, channel, address, reason).
- sessions (user_id, org_id context, device_id, created_at, last_seen, absolute_expiry), devices, refresh_token_families for mobile, scanner_devices (event scope, expiry, revoked_at), mfa_factors (encrypted TOTP secret, passkey credentials with rpID).
- tickets carry key_version, issued_at, wallet_secret (encrypted) for rotating barcodes; event_signing_keys (event_id, public_key, private_key encrypted, version); checkins with unique (ticket_id) for single-entry, entrance_id, device_id, scanned_at, synced_at, offline flag; scan_attempts for duplicates/invalid scans.
- audit_events append-only partitioned table: actor_type, actor_id, on_behalf_of, org_id, action, target_type, target_id, diff (redacted), ip, user_agent, request_id, occurred_at; support_sessions (staff_id, org_id, reason, ticket_ref, expires_at, read_only).
- Encrypted-column pattern: value_ciphertext, dek_ciphertext, key_version, aad fields for integration_credentials, org_settings secrets, and sensitive registration answers; field-level classification tags (pii, sensitive, financial) in schema metadata to drive retention, export and log scrubbing.
- retention_policies (org_id nullable for platform defaults, data_class, days), legal_holds (org_id, subject_id, reason), dsar_requests (subject, verified_at, org_id routing, status, due_at, export_uri), data_subject_exports.
- sub_processors and dpa_acceptances (org_id, version, accepted_by, accepted_at); privacy_notice_versions per locale.
- organizer_trust (org_id, tier, kyc_status from Stripe requirements, review_state, reserve_policy), moderation_flags for events/listings, abuse_reports.
- Seat-map model needs accessibility attributes: seats.is_accessible, seats.is_companion, sections.accessible_route; plus a list/table projection for the non-visual seat picker.
- Consent and channel registration records for SMS/WhatsApp: phone_consents with TCPA proof, whatsapp_optins with business name shown, 10DLC campaign_id per org or per platform.


## Risks

- A single un-scoped query or a new table without RLS exposes another organization's attendees; without the CI RLS check and cross-tenant test suite this will happen during rapid feature work.
- Relying on proxy.ts for authorization: two separate middleware-bypass CVEs (2025 and 2026) show this pattern fails; Server Actions are public POST endpoints.
- Image optimization and RSC deserialization have produced unauthenticated RCEs (CVSS 9.5–10.0) within the last year; slow patching on a payments platform is an existential risk.
- White-label domains fragment cookies, passkey rpIDs, CSP and Turnstile hostname limits; retrofitting a central auth domain later is expensive — decide it in Phase 0.
- Cross-tenant profile merging in the CRM would breach Yayatoh's processor role under GDPR Art. 28, expose organizer customer lists, and likely violate MODPA's strictly-necessary standard.
- SMS OTP endpoints are targets for SMS-pumping fraud that can generate large Twilio bills within hours.
- Payout-account changes after account takeover are the highest-value fraud path; without step-up, notification and holds, losses land on the platform.
- PCI SAQ A eligibility now depends on the checkout page's resistance to script attacks; any marketing/analytics script added to checkout routes can push the platform toward SAQ A-EP.
- Accessibility litigation (ADA Title III) is common against ticketing sites; drag-only seat maps and CAPTCHA-only gates are explicit WCAG 2.2 failures.
- SOC 2 Type II needs 6–12 months of evidence; starting after the first enterprise deal is lost costs a sales cycle.
- Offline check-in sync conflicts can double-admit or wrongly reject attendees if merge rules are not deterministic and tested.
- Putting Cloudflare in front of Vercel degrades Vercel's bot detection; mixing both edges yields the worst of each.
- Several legal details are UNVERIFIED in this report (CPRA CPI-adjusted revenue threshold, CCPA phased audit deadlines, DOJ Title II date shift, DPF litigation status, PCI SAQ A wording, Stripe Identity pricing, SOC 2 cost ranges) and must be confirmed with counsel/vendors before policies are finalized.


## Open questions

- Which organizations does Yayatoh sell to first (EU organizers, US governments/universities, Maryland nonprofits)? This determines whether GDPR representative appointment, Title II/Section 508 conformance and SOC 2 timing are launch requirements or year-2 items.
- Will organizers be merchants of record via their own Stripe Connect accounts (direct charges) or will Yayatoh take payments and pay out (destination charges)? This changes dispute liability, refund flows, tax reporting and the DPA's processor/controller mapping.
- Should Stripe be responsible for negative balances and requirement collection (recommended default) even though it limits some dashboard/account-link options, or does Yayatoh want to own risk and KYC review?
- How many EU/UK attendees and organizers does the current platform have, and does Yayatoh have any EU establishment? (Drives DPF self-certification, Art. 27 representative, and where EU data should be hosted.)
- Is the existing Laravel QR scheme a random lookup code or signed? Must the new scanners accept old-format tickets during migration, and for how long?
- Which existing mobile-app auth flow is in use (long-lived API tokens?) and how quickly can the apps be updated to rotating refresh tokens without stranding users at live events?
- Do any current organizers already collect sensitive data (dietary, accessibility, health, religion) that will need encryption and consent retrofits at migration?
- What retention has Yayatoh applied so far to attendee data and check-in logs, and are there contractual or tax reasons to keep data longer than the proposed defaults?
- Is the check-in device fleet organizer-owned phones, Yayatoh-managed hardware, or both? (Affects device enrollment, MDM and offline key distribution.)
- Which edge does Yayatoh want to standardize on — Vercel-native (Firewall, BotID, Platforms) or Cloudflare — and is self-hosting on the table?
- Is there budget and appetite for SOC 2 Type I within the first 9 months after launch, and which frameworks (SOC 2 only, or also ISO 27001/GDPR modules) should the compliance platform contract cover?
- Will staff impersonation require org-owner approval (stronger, slower support) or notification only?
- Which SMS/WhatsApp sending model is intended — Yayatoh-registered 10DLC brand/campaigns on behalf of all organizers, or per-organizer registration and WhatsApp Business accounts?


## Sources

- https://top10.owasp.org/2025 (OWASP Top 10:2025 categories)
- https://top10.owasp.org/2025/0x00_2025-Introduction/ (changes vs 2021)
- https://github.com/OWASP/ASVS/releases (ASVS 5.0.0, 30 May 2025)
- https://vercel.com/blog/postmortem-on-next-js-middleware-bypass (CVE-2025-29927)
- https://cveawg.mitre.org/api/cve/CVE-2025-29927
- https://cveawg.mitre.org/api/cve/CVE-2025-49826
- https://cveawg.mitre.org/api/cve/CVE-2025-57822
- https://cveawg.mitre.org/api/cve/CVE-2025-55173
- https://github.com/advisories/GHSA-r2fc-ccr8-96c4 (CVE-2025-49005)
- https://github.com/advisories/GHSA-g5qg-72qw-gw5v (CVE-2025-57752)
- https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components (CVE-2025-55182 and follow-ups)
- https://github.com/vercel/next.js/security/advisories (2026 advisory list)
- https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4 (AVIF RCE)
- https://github.com/vercel/next.js/security/advisories/GHSA-p9j2-gv94-2wf4 (CVE-2026-64645 SSRF in rewrites)
- https://github.com/vercel/next.js/security/advisories/GHSA-6gpp-xcg3-4w24 (CVE-2026-64642 proxy bypass)
- https://nextjs.org/docs/app/guides/data-security
- https://nextjs.org/docs/app/guides/content-security-policy
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://vercel.com/kb/guide/application-authentication-on-vercel
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://orm.drizzle.team/docs/rls
- https://pages.nist.gov/800-63-4/sp800-63b.html (NIST SP 800-63B-4, Aug 2025)
- https://haveibeenpwned.com/API/v3#PwnedPasswords
- https://simplewebauthn.dev/
- https://www.better-auth.com/docs/plugins/passkey
- https://www.better-auth.com/docs/plugins/organization
- https://github.com/better-auth/better-auth/releases (v1.7.6)
- https://www.twilio.com/docs/verify/preventing-toll-fraud
- https://business.ticketmaster.com/safetix/
- https://gdpr-info.eu/art-3-gdpr/
- https://gdpr-info.eu/art-12-gdpr/
- https://gdpr-info.eu/art-28-gdpr/
- https://gdpr-info.eu/art-33-gdpr/
- https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/eu-us-data-transfers_en
- https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/international-transfers-a-guide/
- https://oag.ca.gov/privacy/ccpa
- https://cppa.ca.gov/regulations/ccpa_updates.html
- https://mgaleg.maryland.gov/mgawebsite/Legislation/Details/sb0541?ys=2024RS (Maryland Online Data Privacy Act)
- https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in
- https://developers.facebook.com/docs/whatsapp/pricing
- https://docs.stripe.com/security/guide
- https://stripe.com/guides/pci-compliance
- https://www.pcisecuritystandards.org/faq/articles/Frequently_Asked_Question/are-saq-a-merchants-required-to-meet-requirements-6-4-3-and-11-6-1/ (FAQ index referencing SAQ A script eligibility criteria)
- https://docs.stripe.com/connect/identity-verification
- https://docs.stripe.com/connect/hosted-onboarding
- https://docs.stripe.com/connect/design-an-integration
- https://docs.stripe.com/radar
- https://docs.stripe.com/identity
- https://docs.stripe.com/keys-best-practices
- https://stripe.com/legal/dpa
- https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html
- https://infisical.com/docs/documentation/getting-started/introduction
- https://workos.com/docs/audit-logs
- https://neon.com/docs/introduction/branch-restore
- https://supabase.com/docs/guides/platform/backups
- https://vercel.com/docs/security/compliance
- https://vercel.com/docs/vercel-firewall
- https://vercel.com/docs/vercel-firewall/vercel-waf
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
- https://vercel.com/docs/vercel-firewall/vercel-waf/managed-rulesets
- https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing
- https://vercel.com/docs/vercel-firewall/attack-mode
- https://vercel.com/docs/bot-management
- https://vercel.com/docs/botid
- https://vercel.com/docs/platforms
- https://vercel.com/docs/platforms/multi-tenant-platforms/limits
- https://developers.cloudflare.com/waf/managed-rules/
- https://developers.cloudflare.com/waf/rate-limiting-rules/
- https://developers.cloudflare.com/bots/get-started/pro/
- https://developers.cloudflare.com/bots/get-started/bot-management/
- https://developers.cloudflare.com/turnstile/
- https://developers.cloudflare.com/turnstile/plans/
- https://developers.cloudflare.com/waiting-room/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://upstash.com/docs/redis/sdks/ratelimit-ts/overview
- https://docs.arcjet.com/get-started
- https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
- https://www.ada.gov/resources/web-guidance/
- https://www.ada.gov/resources/2024-03-08-web-rule/
- https://eur-lex.europa.eu/eli/dir/2019/882/oj (European Accessibility Act)
- https://commission.europa.eu/strategy-and-policy/policies/justice-and-fundamental-rights/disability/union-equality-strategy-rights-persons-disabilities-2021-2030/european-accessibility-act_en
- https://www.vanta.com/pricing
- https://drata.com/pricing
- https://www.iso.org/standard/27001
- https://csrc.nist.gov/pubs/sp/800/61/r3/final (NIST SP 800-61 Rev. 3, April 2025)
- /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx (vision document)
