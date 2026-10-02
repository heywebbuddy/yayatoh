# Phase 6 plan — Expansion tracks

Status: **approved by the owner** (2026-10-02): all thirteen decisions (P6-1 to P6-13) accepted as recommended; Wave 1 starts as cloud slots free (Phases 4 and 5 keep first claim). Roadmap: `docs/roadmap.md` Phase 6 (M6.1–M6.14). Roadmap order: CRM, then API and integrations, then billing and agency, then virtual. Advanced seating and AI can run in parallel. M6.13 (branded tenant apps) stays deferred with the mobile build (§8.3).

Prices marked UNVERIFIED are from memory or old research. Check them before signing anything.

## 1. What I'm asking you to decide

| # | Decision | Recommendation |
|---|---|---|
| P6-1 | **When to build.** Phase 6 builds on merged code: CRM contacts, audiences, `/v1`, the outbox, ticketing, seating, the AI port. Like P3-1, P4-1 and P5-1, it needs no cutover. | Build it in development now, **behind flags**, in cloud slots that Phases 4 and 5 leave free (they keep first claim). Anything that charges money or talks to a real third party is built against fakes and switched on per org once you have the account. |
| P6-2 | **Analytics store** (M6.2: "ClickHouse or Tinybird via CDC; Cube explorer"). | Put an `AnalyticsWarehouse` port in front of today's M3.1a sink, with two adapters: **Postgres rollups** (default, no new vendor) and **Tinybird** (managed ClickHouse, events API fed from the outbox, no Kafka). Tinybird is switched on when an org's volume needs it. Every row carries `org_id`, and queries go through per-org tokens/row filters (an isolation test proves it). **No Cube at first**: a curated explorer covering events, channels, cohorts and attribution, built in the app. Cube is revisited if organizers ask for free-form pivots. |
| P6-3 | **Public API GA** (D21: "private until M6.3"). | Open `/v1` to every org. **Self-serve API keys per org with scopes**, rate limits per plan entitlement, and **sandbox orgs** (fake payments, seeded data). Webhooks go through **Svix** (~$20/mo at launch, UNVERIFIED) with its customer portal. Payloads stay thin for PII (D21). Public docs are generated from OpenAPI. **TypeScript SDK published to npm**; Swift/Kotlin are generated in CI and published with the mobile build. `/v1` stays additive-only. |
| P6-4 | **Integrations platform and order** (M6.4). | **Nango** (Cloud) behind an `IntegrationAuth` port for OAuth and token refresh; our own sync workers on pg-boss; one field-mapping UI for every connector; an "integration errors" inbox. **Order by customer value:** (1) **Eventbrite importer** (wins switchers), (2) **Zapier** (covers the long tail), (3) **Google Sheets** live sync, (4) **Mailchimp** and **HubSpot**, (5) **Slack** notifications, (6) **Klaviyo**. Tokens are encrypted with KMS and never logged. A sync never loops: origin stamps plus last-writer rules. |
| P6-5 | **SSO and SCIM** (M6.5). | **In-house** on Better Auth's SSO (SAML + OIDC) and SCIM plugins, behind the `enterprise` entitlement. **WorkOS** only if a signed enterprise customer requires it (per-connection pricing, UNVERIFIED). Admins and staff keep TOTP (D14). |
| P6-6 | **Accounting sync** (M6.5: QuickBooks/Xero). | **Daily summary journal entries** (sales, fees, refunds, payouts, donations per account) rather than one entry per order, so books stay readable and API limits are safe. Both QuickBooks Online and Xero through Nango. Mapping UI to the org's chart of accounts. |
| P6-7 | **Subscription billing** (M6.6; D12, D16, D22). | Build **Stripe Billing + Entitlements + Meters** fully but **dormant**. Plans map to module keys through Stripe Entitlement Features synced by webhook (the roadmap acceptance: a plan change alters modules with **no feature-code change**). Meters for messaging (D16), AI (D12) and devices. In-app plan changes. Dunning degrades to **read-only**, never data loss. Stripe Tax. A nonprofit discount. **Legacy per-ticket fees grandfathered.** The tiers ($0/$29/$99/$249/Enterprise from research) are seeded as placeholders and switched off. **You set real prices with launch data (D22).** |
| P6-8 | **Agency** (M6.7/6.8; D23 "clients pay first"). | **v1 now:** the org switcher with a "via Agency" badge; grants the client can revoke at any time; clients pay for themselves; the agency's Clients \| Events \| Marketing \| Reports read only from snapshots (§4.1). Money and billing tables still require direct membership unless the client opts in. **v2 behind a flag:** the agency pays for clients; **commission as a second transfer** in the same transfer group (§5.3; explicit reversals, never `reverse_transfer`); templates and brand kits published downward; per-client campaign fan-out; handover/detach. Live commission money waits for live Stripe. |
| P6-9 | **Virtual and hybrid** (M6.9/6.10; D24 "metered at markup"). | **Mux** for video (signed playback tokens tied to the attendee's grant, heartbeat watch time feeding a virtual checkpoint and CE credits). **Zoom** for live webinars (registrant sync, reports, join/leave webhooks). Cloudflare Stream as a second provider in v2. RTMP overflow in v2. Streaming is **metered and resold at a markup** you set (D24). **You start the Zoom Marketplace app review early**: it takes weeks. |
| P6-10 | **AI in Phase 6** (M6.12; D25). | Seating rules ("keep association together", "VIP nearest stage") with a **tabu-search solver in a Web Worker** that produces editable proposals and never overwrites manual placements. The **CP-SAT Python service stays later** (D25): we build it only if a customer's rooms beat the Worker. AI drafting v2 and audience suggestions on the existing `AiDrafter` port, with **Claude** as the production provider (fake in CI). **pgvector** matchmaking for M5.8 networking (opt-in profiles only). AI usage counts against the AI meter (P6-7). |
| P6-11 | **Marketplace v2 search** (M6.14). | **Meilisearch Cloud** (~$30/mo starter, UNVERIFIED) behind a `SearchIndex` port, fed from the public read model only (no private data can leak). Geo search and facets, recommendations, listing moderation, venue portal with shared layouts, promoted placements (priced later). **The offline LAN hub is out of scope** (the Scan PWA's offline mode covers venues today). |
| P6-12 | **Out of scope for Phase 6.** | Branded tenant apps and native apps (M6.13, §8.3); the CP-SAT service (D25, later); the LAN hub; silent/live auctions (P4-17 said later); SOC 2 Type II (continuous compliance, yours to run). |
| P6-13 | **Paid or free.** | Every Phase 6 capability gets an **entitlement key now**, modelled like P4-4 and P5-11, so prices switch on later with no code change: `api_access`, `integrations`, `enterprise` (SSO/SCIM), `agency`, `virtual`, `advanced_seating`, `ai_seating`, `analytics_pro`. In beta they are free within quotas, except pass-through costs (streaming, SMS, AI), which are metered from day one. |

## 2. Starting point

**Already built and merged (or in the batches being merged):**
- CRM contacts, consent ledger, `event_participation` and `contact_profile` projections (M3.6a), saved segments, the segment DSL, audience export.
- `/v1` with org resources, keyset paging, ETags, deprecation headers, Spectral and oasdiff gates, and a generated TypeScript SDK. Webhooks out through a `WebhookPublisher` port (Svix fake). API keys exist for internal use.
- Metrics pipeline and analytics sink (M3.1a), realtime publisher (M3.1b), alert engine (M3.2b), marketing analytics (M3.8a/b).
- Payments: hybrid funds flow (§5.3), the fake provider, refunds, payouts, reconciliation (M1.6e); donations are being built (M4.8a).
- Seating: Konva editor, holds, ADA warnings (D18), sub-event charts (M4.1c), guest seating (M4.3, Phase 4).
- Tenancy: `org_relationships` (agency_client, host_affiliate, venue_partner), `org_access_grants`, `agency_report_snapshots` (tables exist; no UI), the `agency` profile.
- The AI drafting port with a fake and the per-org credits ledger (M1.4f).
- Messaging providers (M3.5b), journeys (M3.7a), campaigns (M3.6b).
- Program, registration, engagement modules (Phase 5), which virtual and networking AI extend.

**Not built:** dedupe/merge UI, contact stats, DSAR propagation across modules, a warehouse, self-serve keys and sandbox orgs, any third-party connector, SSO/SCIM, billing activation, the agency UI, video, solver-based seating, marketplace search.

## 3. Increments

30 increments in four waves plus a hardening pass. Each is sized for one agent session and tested end to end (keyboard, axe, Arabic RTL) like Phases 1 and 3–5, in the design v2 system. A wave starts when the one before it is merged; increments inside a wave run in parallel. Every connector runs against a recorded fake in CI. Real accounts are switched on per org from the admin app.

New modules (tiers per §3.5; M6.1a writes the layout ADR):
- `analytics` (tier 6): warehouse port, rollups, explorer, scheduled reports.
- `integrations` (tier 6): connections, mappings, sync runs, errors.
- `billing` grows (tier 1, already exists dormant).
- `agency` (tier 5).
- `virtual` (tier 4).
- `crm` grows (merge, stats, DSAR).
- `seating` grows (solver, channels).
- `marketplace` grows.

### Wave 1 — on merged code, no new vendor
| Increment | Scope | Acceptance |
|---|---|---|
| **M6.1a** CRM merge and timeline | Duplicate detection (email, phone, fuzzy name + company), a merge/dedupe UI with field-by-field choice and undo, the person timeline (orders, check-ins, sessions, campaigns, messages, donations, RSVPs) from projections | A merge moves every reference exactly once and can be undone; the timeline never shows another org's data |
| **M6.1b** Contact stats | `contact_stats`: lifetime value, RFM, engagement score (reusing M5.7b), no-show propensity (a documented, explainable formula); org stats | **The vision's John Doe fixture** (attended A, VIP at B, registered for C, 4 sessions, opened campaigns, $1,800 lifetime) reproduces exactly |
| **M6.1c** DSAR propagation | One request exports or erases a person across every module, projection, file and connector hook, with a signed receipt, legal holds (orders and tax records kept per D11) and an audit trail | The canary person is gone from every table and projection except legally held rows, which are listed in the receipt |
| **M6.3a** API keys and sandbox orgs | Self-serve keys per org with scopes and expiry, key rotation, a usage page, rate limits per entitlement, sandbox orgs with seeded data and the fake payment provider | A key cannot exceed its scopes or its org; a sandbox org can never take real money |
| **M6.3b** Webhooks GA and docs | Event catalog, Svix customer portal (fake in CI), retries and replay; public docs site generated from OpenAPI with guides; the SDK publish pipeline (npm for TS; Swift/Kotlin generated, not published) | Every public event has a documented, versioned schema; a payload never carries PII beyond D21's thin set |
| **M6.6a** Billing foundation (dormant) | Products, prices and Entitlement Features in Stripe test mode; a webhook sync from features to module keys; a plan page; legacy-fee grandfathering flags | **A plan change alters modules through the webhook alone**, with no feature-code change |
| **M6.11a** Best-available and ADA | Best-available selection (contiguous, price-ordered, holds aware), the ADA engine (companion seats, enforce or warn per D18) | Best-available never splits a party when a contiguous block exists; ADA rules are enforced in the command |
| **M6.11b** Channels and layouts | Seat channels and allotments (box office, sponsors, promoters), layout revisions with diff and rollback, image underlay tracing, a venue layout library | A seat in one channel can never be sold through another; restoring a revision keeps sold seats |

### Wave 2 — warehouse, integrations, meters, agency v1, solver
| Increment | Scope | Acceptance |
|---|---|---|
| **M6.2a** Warehouse | `AnalyticsWarehouse` port, Postgres rollups, Tinybird adapter fed from the outbox, backfill, cross-event dashboards | Two orgs' data never mix (isolation test through the warehouse); dashboards match Postgres totals to the cent |
| **M6.2b** Attribution, explorer, reports | Multi-touch attribution (first, last, linear), a curated explorer, organizer-authored alert rules on the M3.2b engine, scheduled PDF reports by email in the org timezone | A fixture campaign's attributed revenue matches the hand-computed numbers; a scheduled report arrives once per period |
| **M6.4a** Integrations framework | Nango port, the connections page, field mapping, the sync engine (pull/push, cursors, retries, loop guards), the errors inbox, per-connector entitlement | A sync replayed twice writes once; a revoked connection stops within one run; tokens never appear in logs |
| **M6.4b** Eventbrite importer and Google Sheets | Import events, ticket types, orders and attendees from Eventbrite; live two-way Google Sheets sync of attendee lists | An import into a fresh org reproduces the fixture account's counts; sheet edits round-trip without duplicates |
| **M6.4c** Zapier and Slack | A Zapier app (triggers from webhooks, actions on `/v1`), Slack alerts and daily digests | Each Zapier trigger and action passes Zapier's test harness against the fake; Slack messages carry no PII beyond names |
| **M6.4d** Mailchimp, HubSpot, Klaviyo | Audience and contact sync honouring consent; HubSpot marketing events and attendance | An unsubscribed contact is never pushed; consent changes propagate both ways |
| **M6.6b** Meters and plan changes | Meters (messaging, AI, devices), usage pages, in-app upgrade/downgrade with proration, dunning to read-only, Stripe Tax, nonprofit discount | A failed renewal makes the org read-only, never deletes data; meters match usage events exactly |
| **M6.7a** Agency v1 | Org switcher, the "via Agency" badge, client-revocable grants, client-pays, Clients \| Events \| Marketing \| Reports from snapshots | A revoked grant cuts access on the next request; an agency user never reads a client's money tables without the client's opt-in |
| **M6.12a** Seating rules and solver | Rule builder; tabu search in a Web Worker producing editable proposals; accept per table or all | **400 guests seated in ≤ 5 s with no hard-rule violations; manual placements are never overwritten** |

### Wave 3 — enterprise, agency v2, virtual v1, AI v2
| Increment | Scope | Acceptance |
|---|---|---|
| **M6.5a** SSO and SCIM | SAML and OIDC per org (Better Auth plugins), domain verification, just-in-time provisioning, SCIM users and groups to roles | A deprovisioned SCIM user loses access on the next request; SSO cannot bypass TOTP for platform staff |
| **M6.5b** Salesforce | Contacts/leads, campaign members per event, sponsor opportunities | Round-trip sync of the fixture org without duplicates; field mapping respected |
| **M6.5c** Calendar, Make, n8n | Google Calendar push of sessions and personal schedules, Make and n8n apps over `/v1` and webhooks | A moved session updates every subscribed calendar once |
| **M6.5d** Accounting | Daily summary journals to QuickBooks Online and Xero, account mapping, re-posting on correction | A day's journal equals the ledger memo entries to the cent |
| **M6.8a** Agency v2 money | Agency pays for clients; commission as a second transfer; explicit transfer reversals on refund | A refund reverses the commission proportionally; no `reverse_transfer` on separate charges & transfers |
| **M6.8b** Agency v2 operations | Templates and brand kits published downward, per-client campaign fan-out, handover/detach, team and day-of grants | Detaching a client leaves the client with all its data and none of the agency's templates' private parts |
| **M6.9a** Virtual v1 | Delivery modes (in person, virtual, hybrid) and access modes per ticket type, Mux signed playback, heartbeat watch time, the virtual checkpoint | A playback token works only for its attendee and session; watch time counts once per minute |
| **M6.9b** Zoom and CE credits | Zoom registrant sync and attendance reports, CE credit rules per session, certificates (PDF, all locales) | A fixture attendee's CE certificate reproduces exactly from scans and watch time |
| **M6.12b** AI v2 | AI drafting v2 (campaigns, pages, agendas) with a tone and brand kit, audience suggestions, pgvector matchmaking for opted-in networking profiles | Matchmaking never includes someone not opted in; AI usage meters exactly |

### Wave 4 — virtual v2, marketplace v2, hardening
| Increment | Scope | Acceptance |
|---|---|---|
| **M6.10a** Virtual v2 | Create Zoom webinars from Yayatoh, join/leave webhooks, Cloudflare Stream as a second provider, RTMP overflow | Switching provider keeps grants and watch-time history |
| **M6.14a** Marketplace search | Meilisearch geo and facets, recommendations, listing moderation | Search returns only public listings (leak crawler); weddings and private events never appear (D13) |
| **M6.14b** Venues | Venue portal, shared layouts with organizers, promoted placements (priced later) | A venue sees only its own layouts and the events that use them |
| **M6.x** Hardening | Journeys per track end to end, load tests (API rate limits, sync throughput, warehouse ingest), an OAuth token and SSO security review, leak-crawler coverage for every new table and connector payload, docs | E2E, k6 and crawler gates green |

## 4. Timing

30 sessions in 4 waves of about 5–8 hours each at 10 parallel slots. That is roughly 70–100 agent-hours plus 12–20 hours of merging, or **about 4–6 days of calendar time** behind Phases 4 and 5. Wave 1 needs no new vendor and can start as soon as you approve and slots free up. Real connectors only go live when your accounts and app reviews are done (section 5). The weekly usage limit is the main pace risk: 10 slots use it quickly.

## 5. What waits for you

**Decisions:** P6-1 to P6-13 above. P6-7 (prices, D22), P6-8 (commission defaults) and P6-9 (streaming markup, D24) are yours alone.

**Accounts and app reviews** (start the slow ones early; reviews take weeks):
- **Zoom Marketplace** app review (slow; start now if virtual matters).
- **Google OAuth verification** for Sheets and Calendar scopes (weeks; may need a security assessment).
- **Zapier** partner app review.
- **Intuit (QuickBooks)** production app review; **Xero** app registration.
- HubSpot, Mailchimp, Klaviyo, Salesforce (Connected App) and Slack app registrations.
- Svix, Nango, Tinybird (when volume needs it), Mux, Meilisearch Cloud, and an Anthropic API key for production AI.
- Stripe Billing, Tax and Entitlements settings on the live account (with live Stripe).

**Legal** (`legal-copy`, for your counsel):
- API terms and acceptable use.
- Updated DPA and subprocessor list (each new vendor).
- Integration privacy disclosures.
- Agency agreement terms (grants, commission).
- CE credit wording (the accrediting body is the customer's).

**Monthly cost** (roadmap §3.6): about **$800–1,800/mo for platform services in Phase 6**, plus pass-through (streaming, SMS, AI, Stripe Tax). Most vendors here have free or cheap starter tiers until real volume (UNVERIFIED).

## 6. Risks

| Risk | Mitigation |
|---|---|
| Third-party app reviews take weeks and block "live" | Everything is built and tested against recorded fakes; reviews start now; each connector is switched on per org when approved |
| OAuth tokens are high-value secrets | KMS envelope encryption, never logged, scoped per connection, rotation, revocation on disconnect, a security review in M6.x |
| Cross-tenant leaks through the warehouse, search or connectors | `org_id` on every warehouse row with per-org tokens; search fed only from the public read model; the leak crawler covers connector payloads |
| Sync loops and duplicates | Origin stamps, idempotency keys per external ID, last-writer rules, replay tests |
| Agency money rules (commission, refunds) | v2 behind a flag; transfer-group tests; explicit reversals only; live money waits for live Stripe |
| Billing mistakes upset legacy organizers | Legacy fees grandfathered; billing dormant until you set prices; dunning never deletes data |
| Scope creep (auctions, native apps, CP-SAT) | P6-12 lists what is out |
