# Marketing Comms

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Marketing, notifications and automation system (email, SMS, WhatsApp, push, in-app, segments, journeys, attribution, unified message layer, costs)

# Yayatoh 2.0 — Marketing, Notifications & Automation: Research Report

Date: 2026-09-26. Grounded in the vision document (sections 3 White-label, 8 Marketing & Communication, 11 Attendee/Customer Database, 13 Modules, 14 Integrations). Prices are list prices verified on vendor pages today unless marked UNVERIFIED (third-party or memory).

## 0. Executive recommendation

| Layer | Pick | Runner-up | One-line reason |
|---|---|---|---|
| Email infra | **Amazon SES v2** with Tenant Management (GA Aug 2025) | Resend | 5–10× cheaper, native per-tenant reputation isolation + tenant-level suppression, one-click unsubscribe, managed dedicated IPs when needed |
| Email templates | **React Email 5/6 + @react-email/tailwind** (code-owned) and a JSON block document rendered through the same components (tenant-authored) | MJML | Same React/TS toolchain as Next.js; MJML lost on separate toolchain and slower render, despite better legacy-Outlook coverage |
| SMS (US) | **Twilio** (Messaging Services, Trust Hub ISV profiles, scheduling, opt-out mgmt) | Telnyx | Twilio has the best multi-tenant 10DLC/toll-free compliance tooling and doubles as the WhatsApp Tech Provider path; Telnyx is ~half the per-segment price and is the volume-phase migration target |
| WhatsApp | **Meta Cloud API directly as a Tech Provider + Embedded Signup v4** (per-tenant WABA); platform WABA for Yayatoh-branded utility messages | Twilio WhatsApp (+$0.005/msg) or 360dialog partner platform | Zero markup, tenant owns/pays its WABA; US marketing templates are paused since 2025-04-01 anyway, so US use is utility/auth only |
| Push | **FCM HTTP v1 + APNs token-based (.p8) directly**, web push via VAPID | Expo Push (if apps are rebuilt on Expo), OneSignal | Free, no vendor limits, existing native apps already have tokens; OneSignal overlaps with our own segment builder |
| In-app center | **Build** (table + realtime channel already needed for Command Center) | Knock (best product; per-tenant branding is Enterprise-only), Novu self-host (MIT) | The unified message model makes in-app "just another adapter" |
| Journeys engine | **Inngest** as durable executor; journey state and `due_at` schedule kept in Postgres | Trigger.dev (self-hostable), pg-boss v12 (zero external deps) | Per-tenant concurrency keys, throttling, sleepUntil ≤1 yr, cancelOn, replay, runs inside Next.js; Temporal lost on ops weight, BullMQ on no durable multi-step semantics |
| Segments | **Normalized fact tables + per-tenant materialized `contact_profile`**, JSON segment DSL compiled to parameterized SQL | Pure ad-hoc SQL | Fast counts/previews and CRM views; facts stay source of truth for behavioral filters |

## 1. Email

### Provider comparison (verified 2026-09-26)

| | Amazon SES | Resend | Postmark | SendGrid | Customer.io / Loops |
|---|---|---|---|---|---|
| Price | $0.10/1k; free tier is $200 credit for 6 months | Free 3k/mo (100/day); Pro $20–35 (50k–100k); Scale $90–1,150 (100k–2.5M); overage $0.90→$0.46/1k | Basic $15/10k (+$1.80/1k), Pro $16.50 (+$1.30/1k), Platform $18 (+$1.20/1k) | Essentials $19.95/50k, Pro $89.95/100k (dedicated IP incl.); free plan removed, 60-day trial (third-party, Feb 2026 — UNVERIFIED on vendor page, which redirects) | Customer.io Essentials $100/mo (5k profiles, 1M emails), Premium ~$1,000/mo for multi-workspace (third-party); Loops $49/5k contacts → $399/100k contacts |
| Multi-tenant model | **Tenants** (up to 10k, 300k on request): per-tenant identities, config sets, reputation policy Standard/Strict/None, auto-pause, EventBridge events, **tenant-level suppression**; $0.005/tenant/mo + $0.005/1k | Domains API (`custom_return_path`, tracking subdomain, region); 10 domains on Pro, +$20/mo per 100 domains | Account-level Domains API (DKIM create/rotate, custom Return-Path); "servers" + message streams per customer; Platform plan = unlimited domains/streams | Subusers (per-tenant stats/IPs) | Single-workspace products; not multi-tenant infra |
| DKIM/SPF/DMARC API | Easy DKIM (3 CNAMEs) or BYODKIM; custom MAIL FROM (MX+TXT) for SPF alignment | Yes (create-domain returns DKIM TXT + return-path MX/TXT + tracking CNAME) | Yes (+ DMARC monitoring $14/domain/mo) | Yes (domain authentication) | n/a |
| Dedicated IP | Standard $24.95/IP/mo; **Managed** $15/mo/account + $0.08/1k (≤10M) auto-warmed | $30/mo on Scale, needs 3k+/day | $50/IP/mo, min 300k/mo, Pro+ | Included in Pro | n/a |
| Tracking | VDM $0.07/1k adds opens/clicks + dashboard; custom redirect domain per config set | open/click flags on domain; needs verified tracking subdomain | yes | yes | yes |
| Bounce/complaint | Config-set event destinations (SNS/EventBridge/Firehose); account + tenant suppression | 12 email webhook events incl. `bounced`, `complained`, `suppressed`; auto suppression | webhooks + suppression per stream | Event Webhook + suppression groups | n/a |
| Rate limits | Sending quota per account (after sandbox exit; request increases — default values UNVERIFIED) | **10 req/s per team** (raise by request); batch 100 emails/call, `scheduled_at`, `Idempotency-Key` (24h) | plan-based | plan-based | n/a |
| Marketing sends | Same API; subscription management adds `List-Unsubscribe`/`List-Unsubscribe-Post` and hosted preference page (one contact list per account) | Broadcasts priced **per contact** ($40/5k → $650/150k) — does not fit N tenants | Broadcast streams (unsubscribe link required — UNVERIFIED detail) | Marketing Campaigns $15/5k contacts, $60/10k | Their core product |

**Pick: SES.** Rationale: Yayatoh will be sending on behalf of hundreds of organizations; the August 2025 tenant feature is the only infrastructure-level answer to "one bad tenant pauses everyone" and gives per-tenant suppression scope. At 100k/mo SES ≈ $11 vs Resend $35–55, Postmark ~$115–135, SendGrid $90; at 5M/mo SES ≈ $500 vs Resend > $2,300. Runner-up **Resend** if the team values DX over cost during the first months — its domain/webhook/batch APIs are excellent and React Email is first-party — but the 10 rps limit, contact-priced marketing plans and lack of tenant reputation isolation are real gaps. Postmark remains the deliverability gold standard for pure transactional but is 12–18× SES per email. Customer.io/Loops are single-tenant marketing tools, not infrastructure; exclude.

### Per-tenant sending domains
- Default: every org sends as `noreply@mail.yayatoh.com` (or a per-tenant `org-slug.mail.yayatoh.com` subdomain identity) with `Reply-To` the organizer. White-label tenants (vision §3) verify their own subdomain (`mail.events.organization.com`): create SES identity → return Easy DKIM CNAMEs + MAIL FROM MX/TXT to the tenant's DNS page → poll verification → attach identity + config set to the SES tenant. Store DNS records, verification status and last-checked in `sending_domains`.
- Require tenants to publish DMARC `p=none` minimum: Gmail (≥5k/day), Yahoo and Outlook.com (from 2025-05-05) all require SPF+DKIM+DMARC alignment, one-click unsubscribe (RFC 8058) honored within 2 days, and spam rate < 0.3% (target < 0.1%).
- Custom click/open tracking domain per tenant (`links.events.organization.com` CNAME) via config-set custom redirect domain; otherwise `l.yayatoh.com`.
- Dedicated IPs: not before a consistent ~100k+/month (ideally 50k+/day); when needed use SES Managed dedicated IPs (auto warm-up). Keep transactional and marketing on separate config sets/IP pools.

### Templates
- React Email now supports Tailwind 4 with ~23× faster Tailwind rendering; render to HTML+text at send time, cache by template version + variables hash. Store tenant-authored campaigns as a JSON block document (hero/text/button/event-card/ticket-QR blocks) rendered through the same component library so the white-label header/footer/colors come from tenant branding. All 12 UI languages: template `locale` variants with fallback to `en`.

## 2. SMS

### Providers (US, per segment, list price + carrier pass-through)

| Provider | 10DLC out/in | Toll-free | Number/mo | Notes |
|---|---|---|---|---|
| Twilio | $0.0083 / $0.0083 (+carrier) | $0.0083 | $1.15 local, $2.15 TF | Messaging Services (sender pools, sticky sender), scheduling 15 min–35 days free (500k scheduled/subaccount), Trust Hub secondary customer profiles for ISVs, built-in STOP/HELP (error 21610 on opted-out — UNVERIFIED code), Lookup/Verify |
| Telnyx | $0.004 / $0.004 (+carrier ~$0.003–0.0045) | $0.0055 | $1.00 | Own network; 10DLC API; brand $4.50, campaign review $15, monthly $1.50 (low-volume mixed)–$10 (standard) — fee table dated 2025-07-22 |
| Plivo | $0.0077 / $0.0077 | $0.0079 | $0.50 local, $1.00 TF | Short code $1,500 setup |
| Sinch | ~$0.0078 (UNVERIFIED — pricing page 404; third-party) | — | — | Strong internationally |

Carrier surcharges are added to every provider: AT&T ~$0.003–0.0035, T-Mobile $0.003–0.0045, Verizon ~$0.0031–0.0045 per outbound SMS (Telnyx/Plivo tables).

**Pick: Twilio** for launch (compliance tooling, one vendor for SMS + WhatsApp Tech Provider + Verify), with the provider adapter designed so **Telnyx** can take over high-volume tenants (≈45% cheaper per segment; at 500k segments/mo the gap is ~$2k/mo).

### US registration realities (design constraints)
- **10DLC**: every sending business is a TCR *brand* ($4–4.50) with one or more *campaigns* ($15 vetting, $1.50–$10/mo each, billed 3 months upfront). Sole Proprietor (no EIN): 1 campaign, ~3,000 SMS/day (T-Mobile 1,000/day). Low-Volume Standard: ≤5 campaigns, ~6,000/day (T-Mobile 2,000/day). Standard: throughput scales with Trust Score. Brands with an EIN can no longer use Twilio's Starter/Sole-Prop path. Approval: hours to days for brands; campaign vetting typically days (UNVERIFIED).
- **Toll-free**: verification mandatory since 2023-11-08; a Business Registration Number (EIN) is required for new verifications from early 2026. No per-campaign monthly fee; fastest route for *platform-level* traffic.
- **Recommended tiering** (open question for the owner — see §12): (a) *Platform sender*: Yayatoh-branded transactional/utility SMS (ticket delivery, reminders) from a Yayatoh-verified toll-free number + a Yayatoh Standard 10DLC campaign; (b) *Tenant sender*: organizations that want branded marketing SMS get their own Trust Hub secondary customer profile → brand → campaign → dedicated number under a Twilio subaccount per tenant (Twilio's recommended ISV architecture). Automate this as an onboarding wizard and pass the TCR fees through.
- Segment math: GSM-7 160 chars / 153 per concatenated segment; UCS-2 (emoji, Arabic, Hindi, Chinese, Japanese, Russian — 6 of the 12 UI languages) 70 / 67. Show a live segment counter in the composer; bill/estimate per segment.
- **International**: prices vary 10× by country and alphanumeric sender IDs need pre-registration in many countries; treat non-US SMS as phase-2 with per-country enablement flags.

### TCPA / consent (compliance checklist for SMS)
1. Marketing texts need *prior express written consent*: unchecked checkbox at checkout/RSVP with disclosure (program name, frequency, "Msg & data rates may apply", STOP/HELP), stored with timestamp, IP/user-agent, source page, exact consent text.
2. Transactional/informational texts (ticket delivery, event-day logistics) need consent to the number but not marketing consent; keep the categories separate on every message (`purpose = transactional | marketing`).
3. Revocation "by any reasonable means" is effective since 2025-04-11: honor STOP/QUIT/END/CANCEL/UNSUBSCRIBE/REVOKE/OPT OUT and opt-outs via email, web form, or support; honor within 10 business days (we do it instantly); one clarification text within 5 minutes is allowed. The "revoke-all" cross-category rule has been delayed to Jan 2027 and the FCC circulated (Sept 2026) a narrower replacement — track it; design to support both scope-limited and global revocation.
4. Quiet hours: federal 8am–9pm *recipient local time*; FL/OK/WA 8am–8pm; TX (SB 140, 2025-09-01) 9am–9pm Mon–Sat, noon–9pm Sun, $5,000 statutory damages per text; OK max 3 marketing texts/24h. Derive timezone from phone area code with fallback to event timezone, and hold marketing sends outside the window (never hold transactional).
5. Keep STOP handling at the provider (Twilio blocks opted-out numbers per Messaging Service) *and* mirror to our `consents`/`suppressions` table via webhook, scoped per tenant (an opt-out from Org A does not silence Org B's transactional messages, but a platform-level STOP does).

## 3. WhatsApp

- **Pricing model**: per delivered template message since 2025-07-01 (conversation model ended). US rates: marketing $0.025, utility $0.004, authentication $0.0135 (Meta rate card values as quoted by a 2026 third-party guide — UNVERIFIED directly; Meta's rate-card page did not render). UK marketing $0.0592/utility $0.0171; India $0.0118/$0.0014; Mexico $0.0436/$0.0080; Brazil $0.0625/$0.0070. Utility/authentication get monthly volume tiers aggregated at business-portfolio level; marketing never discounts.
- **Upcoming (verified on Meta docs)**: 2026-10-01 — service (free-form) messages become paid at utility/auth rates, and utility templates inside the 24-hour window stop being free; 2026-08-01 — "Meta Business Agent" messages billed at $2/1M tokens. Free 72-hour entry point after Click-to-WhatsApp remains.
- **US marketing pause**: Meta has blocked *marketing* templates to +1 US numbers since 2025-04-01; still in force as of July 2026 with no end date. Utility, authentication, service-window replies and CTWA flows work. Practical consequence: in the US, WhatsApp is a **utility reminder/ticket-delivery channel** (vision: "24 hours before event → SMS/WhatsApp"), not a promotion channel. Meta also enforces per-user marketing frequency caps globally (error 131049).
- **Templates**: submitted via API per WABA, auto-reviewed up to 24h, statuses approved/rejected/paused/disabled, quality rating can pause a template; 250 templates/WABA unverified, 6,000 verified; each language is a separate template variant.
- **Messaging limits**: 250 unique users/24h for new portfolios → 2,000 (business verification or 2,000 delivered high-quality messages in 30 days) → 10k → 100k → unlimited, auto-scaling within 6h when 50% of the limit is used with high quality.
- **Integration options**: (1) **Direct Cloud API as a Meta Tech Provider** with Embedded Signup v4 (v2 deprecated 2026-10-15): tenant creates/links its own WABA inside our UI, pays Meta directly, zero markup; requires Meta app review (`whatsapp_business_messaging`, `whatsapp_business_management`) and Access Verification. (2) **Twilio**: same Tech Provider prerequisites plus Twilio Senders API; one subaccount = one WABA; +$0.005/msg both directions; unified billing with SMS. (3) **360dialog**: no markup on Meta fees; €49–99/mo per channel, or Partner Platform €250/€500/€1,000 per month + €49/€25/€15 per channel; 80 msg/s regular. (4) Infobip: enterprise; pricing UNVERIFIED.
- **Per-tenant vs platform WABA**: Meta's display-name/business policies tie a WABA to the business the recipient interacts with. Use a **platform WABA ("Yayatoh")** for Yayatoh-branded ticket delivery/reminders (non-white-label tenants), and **per-tenant WABAs** for white-label and marketing use. **Pick: direct Cloud API** (adapter handles both WABA kinds); **runner-up Twilio** if the owner wants single-vendor billing. Opt-in must be explicit per tenant (checkbox: "Send me event updates on WhatsApp"), logged like SMS consent.

## 4. Push

- **Pick: direct FCM HTTP v1 + APNs token auth**. FCM quota 600k messages/min/project (429 on excess; +25% increases on request, 15 days ahead for events). APNs: one .p8 key for all apps, JWT refreshed every 20–60 min, HTTP/2 `api.push.apple.com`. Cost $0. Keep a `device_tokens` table (platform, token, app_version, locale, last_seen, user/contact link, tenant scope) with invalid-token pruning from provider responses. Web push (organizer dashboard alerts, attendee PWA seat finder) via VAPID with the `web-push` npm library; store subscriptions in the same table.
- Runner-ups: **Expo Push** (free, 600 notifications/s per project, only worth it if the apps are rebuilt on Expo); **OneSignal** (free ≤1k MAU; Growth from $19 + $0.012/MAU mobile push, $0.004/web subscriber, email $1.50/1k) — good segmentation UI but duplicates our audience builder and splits data across systems; **Knock** for push+in-app (see §5).

## 5. In-app notification center

| | Knock | Novu | Courier | Build |
|---|---|---|---|---|
| Price | Free 10k msgs; Starter $250/50k, $0.005 overage; Enterprise for per-tenant branding/preferences, SAML, audit | Free 10k runs; Pro $30/30k (+$1.20/1k); Team $250/250k; **MIT self-host** (enterprise dirs proprietary) | Free 10k; $0.005/send | Engineering time |
| Tenants | First-class `tenant` on triggers; feed scoping; per-tenant branding is **Enterprise-only** | Multi-tenancy on all tiers | Multi-tenant on all tiers | Native |

**Pick: build.** The Command Center needs a realtime layer anyway (live check-ins, alerts). Add `notification_inbox` (user_id, tenant_id, category, title, body, link, read_at) written by an `in_app` adapter, delivered live over the same WebSocket/SSE channel, with a per-user `notification_preferences` matrix (category × channel × frequency: instant/digest/off). Operational alerts from the vision (unseated attendees, undistributed tickets, failed payments, offline scanners, session at 95%) are producers into this same pipeline. If the team prefers not to build preferences/inbox UI, self-host **Novu** (MIT) behind the adapter; **Knock** is the best hosted product but its per-tenant branding gate makes it Enterprise-priced for a white-label platform.

## 6. Audience / segment builder

- **Data design**: keep normalized, tenant-scoped fact tables (`orders`, `tickets`, `registrations`, `seat_assignments`, `checkins`, `rsvps`, `session_attendance`, `message_events`) as source of truth, plus a per-tenant **materialized `contact_profile`** row per contact (lifetime spend, orders count, events attended, last attended at, last email open/click, last checkin, tags, custom jsonb attributes, channel consent flags, timezone, locale). Refresh incrementally from the event outbox (Inngest function on `order.paid`, `checkin.created`, `email.opened`…), nightly full rebuild as safety net. GIN index on jsonb attributes; composite `(tenant_id, …)` indexes; Postgres RLS on `tenant_id`.
- **Segment DSL** (stored JSON): `{ all: [ {attr:"ticket_tier", op:"eq", value:"VIP", scope:{event_id}}, {behavior:"purchased", event_id}, {not:{behavior:"seat_assigned", event_id}} ] }` compiled server-side to parameterized SQL: profile predicates hit `contact_profile`; behavioral predicates compile to `EXISTS`/`NOT EXISTS` subqueries on fact tables; time-relative predicates (`within 30 days`, `event in series year N-1`) are parameters. Return a preview count (< 1s target with the profile table) and a sample.
- Vision examples: (1) *VIP purchased but no seat*: tickets.tier='VIP' AND status='issued' AND NOT EXISTS seat_assignment; (2) *attended last year, not registered this year*: EXISTS checkin for event_series year-1 AND NOT EXISTS registration/ticket for current event; (3) *registered, not checked in*: EXISTS ticket for event AND NOT EXISTS checkin — evaluated live on event day.
- Materialize membership into `campaign_recipients` at send time (snapshot with the consent check result per channel); automations evaluate the segment per contact at trigger time (dynamic). Optional a global `persons` identity (email/phone hash) is *not* shared across tenants for marketing — tenant data isolation (vision §2) means Org B never sees Org A's attendee, but the *platform* may use it for fraud/suppression.

## 7. Automation / journeys

| Engine | Model | Cost | Per-tenant control | Self-host |
|---|---|---|---|---|
| **Inngest** | Event-driven durable functions in your Next.js deploy; `step.sleepUntil` ≤ 1 yr (7 days on Free), 1,000 steps/run, `cancelOn`, replay | Free 50k exec/mo (5 concurrent); Pro $99 / 1M exec, 100+ concurrent | Concurrency keys, throttling, rate limit, debounce, priority, batching | No (proprietary control plane) |
| Trigger.dev | Tasks with `wait.for/until` (>60s checkpoints, no compute billed), `delay`, `idempotencyKey`, batch 1,000, TTL ≤14 days | Free $5 credit; Hobby $10; Pro $50 + $0.000025/run + compute | `concurrencyKey`, queue limits, override per run | Yes (Apache 2.0) |
| Temporal Cloud | Workflows/activities with worker fleet | $50/M actions PAYG (down to $25), no minimum; support $500/mo | Build yourself (worker-side limiters) | Yes (OSS) |
| BullMQ | Redis queues, delayed/repeatable jobs, flows | Redis hosting | Rate limiter per queue | Yes |
| pg-boss 12.34 (2026-09-23) | Postgres queue: cron/RRULE, deferral, retries w/ backoff, DLQ + redrive, singleton/throttle policies, LISTEN/NOTIFY | $0 | Queue policies | n/a (it's your DB) |

**Pick: Inngest** as the executor, with **journey definitions and schedule in Postgres**: `automations` (trigger: `ticket.purchased`, `rsvp.updated`, `checkin.created`, `time_relative_to_event`), `automation_runs`, and a `scheduled_actions` table with `due_at` computed from `event.starts_at ± offset`. A per-minute cron function claims due rows (`FOR UPDATE SKIP LOCKED`) and fans out; when an event is rescheduled, recompute `due_at` in one UPDATE instead of cancelling thousands of sleeping runs. Inngest supplies retries, idempotency (`event.id`), per-tenant concurrency (`key: event.data.tenant_id`), throttling to provider limits (SES quota, Resend 10 rps, WhatsApp tier, 10DLC MPS), and `cancelOn` for `contact.unsubscribed` / `ticket.refunded`. Lock-in is bounded: workflow *state* lives in our tables, Inngest only executes steps. **Runner-up Trigger.dev** if self-hosting becomes mandatory; **pg-boss** if the owner wants zero external services (then the step-orchestration layer is ~2 weeks of extra work). Temporal lost on operational weight for a small team; BullMQ lost because long delays tied to mutable event dates are fragile and it adds Redis.

Vision journey mapped: `ticket.purchased` → confirmation (transactional, instant) → `T-7d` reminder (email) → `T-24h` SMS/WhatsApp utility → `T-0 09:00 local` push → `T+1d` survey (email + in-app). Each step: channel policy with fallback (WhatsApp undelivered in 30 min → SMS; no device token → email), quiet-hours gate for marketing, consent gate per channel, holdout %.

## 8. Campaign analytics & attribution

- **Tracking links**: every URL in marketing content is rewritten to a redirector on the tenant's white-label domain (`links.events.organization.com/x/{id}`) or `l.yayatoh.com`; UTM auto-appended (`utm_source=<tenant-slug>`, `utm_medium=email|sms|whatsapp|push`, `utm_campaign=<campaign-slug>`, `utm_content=<variant|block>`) plus a signed `ytc` click id. `link_clicks` records contact, message, timestamp, UA. SMS/WhatsApp need short links (segment cost) — same redirector.
- **Conversion**: checkout/RSVP reads `ytc` (URL param → first-party cookie, 30-day) and writes `attributions` (order_id/registration_id, campaign_id, message_id, channel, model). Default *last-touch within 7 days* for reporting, store first-touch too; direct (no click) conversions among recipients shown separately as "reached, unattributed". Revenue per campaign = Σ paid orders with attribution; cost per campaign = Σ `messages.cost`; report sent/delivered/opened/clicked/converted/revenue/unsubscribed/complaints. Treat email opens as directional only (Apple Mail Privacy Protection inflates them); use clicks and conversions as the primary KPIs. Add automation holdout groups to measure lift.
- **Unsubscribe & consent compliance** (email): CAN-SPAM — accurate headers, ad identification, physical postal address (tenant's, stored in branding), working opt-out honored ≤10 business days, no fee, no extra data; up to $53,088 per email penalty. Gmail/Yahoo/Outlook bulk — SPF+DKIM+DMARC aligned, one-click `List-Unsubscribe` + `List-Unsubscribe-Post`, honor ≤2 days, spam < 0.3%. GDPR/PECR (EU/UK tenants) — consent or soft opt-in for existing customers with opt-out at collection and in every message; right to object; consent records (Art. 7); erasure must cascade to contacts while keeping a hashed suppression entry. CASL (Canada) — express or implied consent (existing business relationship), sender identification, unsubscribe working ≥60 days and honored ≤10 business days, penalties up to C$10M. Transactional emails (tickets, receipts) carry no unsubscribe; everything else does. Implement a per-tenant preference center with topics; a global platform suppression list for hard bounces/complaints; tenant-scoped marketing unsubscribes.

## 9. Unified message abstraction

```
Message { id, tenant_id, channel: email|sms|whatsapp|push|in_app, purpose: transactional|marketing,
  category (wa: utility|marketing|authentication), contact_id, to (address snapshot), locale,
  template_id, template_version, variables, rendered_hash, campaign_id?, automation_run_id?, step_id?,
  sender_identity_id, provider, provider_message_id, scheduled_at, status, cost_micros, currency,
  consent_check: {result, consent_id}, quiet_hours_hold_until?, fallback_of_message_id? }
MessageEvent { message_id, type: queued|sent|delivered|delayed|bounced|complained|failed|suppressed|opened|clicked|replied|read|unsubscribed, provider_payload, occurred_at }
ChannelAdapter { capabilities(): {batchSize, rps, scheduling, templatesRequired}, validate(to), send(msg) -> providerId, parseWebhook(req) -> MessageEvent[], sync?(templates) }
```
Pipeline: enqueue → render (React Email / text / WA template params / push payload) → policy gate (consent, suppression, quiet hours, frequency cap, WhatsApp category/US rules) → route (channel policy + fallback) → adapter send with per-(tenant,channel) token bucket → webhook ingest → events → profile/attribution updates. Adapters: `ses`, `resend` (dev/fallback), `twilio-sms`, `telnyx-sms`, `meta-whatsapp`, `twilio-whatsapp`, `fcm`, `apns`, `webpush`, `in_app`. Webhook verification per provider (SNS signature, Twilio signature, Meta HMAC) and idempotent event upsert on `(provider, provider_message_id, type)`.

## 10. Costs at 100k messages/month

Unit costs (US): email SES $0.0001 (+$0.005/tenant/mo), Resend ~$0.00035–0.0009, Postmark ~$0.0013, SendGrid ~$0.0009; SMS Twilio ≈ $0.0118 incl. ~$0.0035 carrier, Telnyx ≈ $0.0075, Plivo ≈ $0.0112; WhatsApp US utility $0.004 direct (+$0.005 via Twilio); push $0 (FCM/APNs) or OneSignal $0.012/MAU; in-app $0 built.

Illustrative blend (70k email / 20k SMS / 5k WhatsApp utility / 5k push): SES ≈ $8 + tenant fees ≈ $10; Twilio SMS ≈ $236 (Telnyx ≈ $150); WhatsApp ≈ $20 direct ($45 via Twilio); push $0; Inngest Pro $99 (≈500k step executions) or pg-boss $0; total **≈ $250–$370/month** plus fixed: Twilio numbers $1.15–2.15 each, 10DLC per tenant brand $4.50 + $15 + $1.50–10/mo, optional 360dialog. All-SMS worst case (100k segments): Twilio ≈ $1,180, Telnyx ≈ $750. All-email: SES ≈ $11, Resend $35–55 (+$20 domain add-on), Postmark ≈ $115–135, SendGrid ≈ $90. Hosted notification layers at 100k: Knock ≈ $500, Courier ≈ $500, Novu Cloud ≈ $114 — hence "build" for in-app.

## 11. Compliance checklist (consolidated)
1. Consent ledger per contact × channel × purpose × tenant with evidence; separate transactional vs marketing purposes.
2. Email: SPF/DKIM/DMARC per tenant domain, one-click unsubscribe headers on all non-transactional mail, honor ≤2 days (instant), postal address in footer, tenant + global suppression, complaint-rate monitoring with auto-pause (SES Standard policy).
3. SMS: 10DLC/toll-free registration per sender, consent disclosure text at capture, STOP/HELP handling + webhook mirror, quiet hours by recipient timezone and state, frequency caps (OK ≤3/day), segment-aware composer, audit log of every send.
4. WhatsApp: opt-in record, approved templates per language, category correctness (utility vs marketing), US marketing block awareness, quality-rating monitoring, per-user cap error handling with SMS fallback.
5. GDPR/PECR/CASL for non-US tenants: lawful basis selector per campaign, soft opt-in rules, DSAR export/erasure with hashed suppression retention, data residency note (SES tenants are per region).
6. Retention: message bodies 90 days by default (tenant-configurable), events 13 months for YoY segments, consent records for the statutory limitation period (TCPA 4 years).

## 12. Open points requiring the owner (see structured list)
Current providers/volumes, sender-of-record policy, mobile app stack, non-US tenants, usage rebilling, self-hosting appetite.


## Key recommendations

- Email: use Amazon SES v2 with Tenant Management (one SES tenant per organization, Standard reputation policy, tenant-level suppression, Easy DKIM + custom MAIL FROM per tenant subdomain, config-set event destinations to a webhook/queue); keep Resend as the dev/runner-up adapter. Do not buy dedicated IPs before ~100k+/month sustained; then use SES Managed dedicated IPs.
- Templates: React Email 5/6 + @react-email/tailwind for code-owned system/transactional emails; store tenant-authored campaigns as a JSON block document rendered through the same components with white-label branding; locale variants for all 12 languages; MJML not needed.
- SMS: launch on Twilio (Messaging Services, Trust Hub secondary customer profiles per tenant, scheduling, STOP handling) with a two-tier sender model: a Yayatoh-verified toll-free + Standard 10DLC campaign for platform transactional traffic, and per-tenant brand/campaign/number for organizations that want branded marketing SMS; design the adapter so Telnyx (~45% cheaper per segment) can take high-volume tenants later.
- Build TCPA compliance into the send pipeline, not the UI: consent ledger with evidence, purpose-separated messages, quiet hours by recipient timezone (federal 8-9, FL/OK/WA 8-8, TX 9-9 / Sun 12-9), OK 3/day cap, instant revocation via STOP or any channel, and tracking of the FCC's Sept-2026 revocation-rule revision.
- WhatsApp: integrate Meta Cloud API directly as a Tech Provider with Embedded Signup v4 (per-tenant WABA, tenant pays Meta, zero markup) plus a platform WABA for Yayatoh-branded utility messages; treat US WhatsApp as utility/authentication only while Meta's US marketing-template pause (since 2025-04-01, still active mid-2026) persists; budget for the 2026-10-01 change that makes service messages and in-window utility messages billable.
- Push: send directly via FCM HTTP v1 and APNs token-based auth (.p8) with a device_tokens registry and invalid-token pruning; add web push (VAPID) for organizer alerts and the attendee PWA; skip OneSignal/Expo unless the apps are rebuilt on Expo.
- In-app notification center: build it as an `in_app` adapter (notification_inbox + per-user preference matrix) on the same realtime channel the Command Center needs; use self-hosted Novu (MIT) only if the team wants to avoid building preferences/inbox UI; Knock is excellent but per-tenant branding is Enterprise-only.
- Segments: normalized tenant-scoped fact tables plus an incrementally refreshed per-tenant contact_profile table; a JSON segment DSL compiled to parameterized SQL (profile predicates on contact_profile, behavioral predicates as EXISTS/NOT EXISTS on facts); snapshot membership into campaign_recipients at send time for auditability and attribution.
- Automations: use Inngest as the durable executor (per-tenant concurrency keys, throttling, cancelOn, replay) while keeping journey definitions, runs and a due_at-based scheduled_actions table in Postgres so 'N days before event' steps are recomputed on event reschedule instead of cancelling sleeping runs; Trigger.dev is the self-hostable fallback, pg-boss the zero-dependency fallback.
- Implement one Message/MessageEvent model and a ChannelAdapter interface (capabilities, validate, send, parseWebhook) with a policy gate (consent, suppression, quiet hours, frequency caps, WhatsApp category rules), channel fallback (WhatsApp->SMS, push->email), per-(tenant,channel) token buckets, and idempotent webhook ingestion.
- Attribution: rewrite links through a redirector on the tenant's white-label domain with auto-UTMs and a signed click id carried into checkout/RSVP; store first- and last-touch attributions on orders/registrations; report revenue and conversions per campaign, treat email opens as directional (Apple MPP), and add holdout groups for automations.
- Compliance by default: one-click List-Unsubscribe headers on all non-transactional email (Gmail/Yahoo/Outlook bulk-sender rules), tenant postal address in footers (CAN-SPAM), per-tenant preference center with topics, global + tenant suppression lists, GDPR/PECR soft opt-in and erasure with hashed suppression retention, CASL express/implied consent tracking for Canadian tenants.


## Data model implications

- organizations (tenants) gain messaging settings: branding for email/SMS footers, postal address, default timezone/locale, ses_tenant_name, twilio_subaccount_sid, whatsapp mode (platform|own).
- contacts (tenant-scoped person) + contact_channels (email/phone/whatsapp/push token/web-push subscription; verification status; timezone; locale) and a global persons identity (hashed email/phone) used only for platform-level fraud and suppression, never cross-tenant marketing.
- consents: contact_channel_id, tenant_id, purpose (transactional|marketing), channel, status, source (checkout|rsvp|import|api), evidence (text shown, ip, user_agent, url, timestamp), revoked_at, revocation_method, scope (tenant|platform).
- suppressions: scope (global|tenant), address hash, reason (hard_bounce|complaint|unsubscribe|manual|stop), source provider, created_at; kept after GDPR erasure as hashed entries.
- sending_domains: tenant_id, domain, ses_identity_arn, dkim records + status, mail_from domain + status, tracking domain + status, dmarc_status, last_checked_at.
- sender_identities: tenant_id, type (email_from|sms_number|toll_free|whatsapp_phone), value, provider ids (messaging_service_sid, phone_number_id, waba_id), verification/registration status, throughput tier, quality_rating.
- sms_registrations: tenant_id, brand_type (sole_prop|low_volume_standard|standard), tcr_brand_id, trust_score, campaigns (use_case, campaign_id, status, monthly_fee), toll_free_verification status, fee ledger.
- whatsapp_accounts: tenant_id, waba_id, phone_number_id, display_name, business_verification status, messaging_limit_tier, quality_rating, embedded_signup token metadata; whatsapp_templates: name, language, category, status, components, last_synced_at.
- message_templates + message_template_versions: tenant_id (null = platform), channel, purpose, category, locale, subject, body document (React Email JSON blocks or WA template params mapping), variables schema, is_transactional; brand_kits per tenant for rendering.
- segments: tenant_id, name, definition (JSON DSL), last_count, last_evaluated_at; segment_snapshots for campaign audits; contact_profile: per-tenant materialized row per contact (lifetime_spend, orders_count, events_attended, last_attended_at, last_checkin_at, last_email_open_at, last_click_at, tags, attributes jsonb, channel consent flags, timezone, locale, updated_at).
- campaigns: tenant_id, event_id?, channel(s), template refs, segment_id, schedule (send_at, timezone mode), status, holdout_pct, budget/cost totals; campaign_recipients: snapshot of contact + address + consent_check result + message_id.
- automations: tenant_id, trigger (event name or time_relative_to_event with offset), steps (channel, template, delay, fallback, conditions), status; automation_runs; scheduled_actions: run_id, step_id, due_at, claimed_at, status (recomputed on event.starts_at change).
- messages and message_events as defined in the report (status timeline, provider ids, cost_micros, consent_check, quiet_hours_hold_until, fallback_of_message_id); indexes on (tenant_id, campaign_id), (provider, provider_message_id), (contact_id, created_at).
- tracking_links (tenant_id, message_id/campaign_id, target_url, short_code, utm set) and link_clicks (contact_id, message_id, ts, ua, ip hash); attributions on orders/registrations/rsvps: campaign_id, message_id, channel, model (first|last), clicked_at.
- device_tokens: contact_id/user_id, tenant scope, platform (ios|android|web), token/subscription, app_version, locale, last_seen_at, invalidated_at.
- notification_inbox (user_id, tenant_id, category, title, body, link, read_at, source event) and notification_preferences (user_id × category × channel × frequency); operational alerts from the Command Center produce into the same pipeline.
- Events outbox table for domain events (order.paid, ticket.issued, seat.assigned, checkin.created, rsvp.updated, event.rescheduled, contact.unsubscribed) consumed by Inngest functions; all tables carry tenant_id with Postgres RLS.


## Risks

- Meta's pause on WhatsApp marketing templates to US numbers (since 2025-04-01, still active July 2026) removes WhatsApp as a US promotion channel; plan on utility/auth only and SMS fallback.
- WhatsApp pricing changes on 2026-10-01 (service messages and in-window utility become billable) and per-user marketing caps (error 131049) will change unit economics and delivery rates; keep cost tracking per message and fallback logic.
- US 10DLC/toll-free registration per tenant adds cost ($4.50 + $15 + $1.50-10/mo), days of latency and support burden; small organizers without EIN are limited to sole-proprietor throughput (~1,000-3,000/day). Unregistered traffic is blocked or surcharged.
- TCPA litigation exposure: statutory damages per text ($500-1,500 federal, $5,000 Texas), quiet-hours class actions, and the moving FCC revocation rules (April 2025 rule, revoke-all delayed to Jan 2027, Sept 2026 proposed rewrite) — the send pipeline must be conservative by default.
- Shared-reputation contagion: one tenant importing purchased lists can degrade deliverability for all; SES tenant isolation and auto-pause mitigate but do not eliminate account-level enforcement risk; require import hygiene (double opt-in option, bounce-rate caps).
- White-label email requires tenants to publish DKIM/MAIL FROM/DMARC records on their own DNS; expect onboarding friction and a support workflow; fall back to Yayatoh subdomains until verified.
- Email open metrics are inflated by Apple Mail Privacy Protection; dashboards that lean on opens will mislead organizers — anchor on clicks/conversions.
- Inngest is a proprietary control plane (no self-host); mitigate by keeping journey state in Postgres and isolating the executor behind an interface; Trigger.dev/pg-boss are the exits.
- Provider price volatility (SendGrid +33% in 2024, Resend tier changes, carrier surcharge increases such as US Cellular 2026) — abstract providers and track cost per message.
- SES operational gaps vs Resend/Postmark: sandbox exit, quota increases, event plumbing (SNS/EventBridge), no template UI — budget engineering time; SES tenants are per-region (no cross-region replication).
- Unverified items: SendGrid list prices (vendor page redirected; third-party Feb 2026), Sinch US rates (page 404), Meta US rate card values (third-party quotes), Twilio exact 10DLC fee schedule (help page empty), Postmark broadcast-stream rules, Twilio opt-out error code and toll-free throughput defaults.


## Open questions

- Which email/SMS/push providers does the Laravel platform use today, at what monthly volumes, and are there existing sender domains, IP reputations, 10DLC brands or toll-free verifications to migrate?
- Who is the sender of record: should transactional messages (tickets, reminders) go out as 'Yayatoh' from platform-owned numbers/WABA/domains, or must every organization be its own registered sender (10DLC brand, WABA, domain) from day one, including non-white-label tenants?
- Are the existing iOS/Android apps native, React Native/Expo, or Flutter, and who holds the FCM project and APNs keys? Are device tokens stored in the Laravel DB in a migratable form?
- Will Yayatoh serve tenants or attendees in Canada/EU/UK (CASL, GDPR/PECR, data residency) in the first 18 months, and are international SMS/WhatsApp sends in scope at launch?
- Should tenants pay for SMS/WhatsApp usage (rebilling, prepaid credits, plan quotas) and pass-through TCR fees, or does Yayatoh absorb messaging costs into subscription tiers?
- Is a proprietary managed orchestration service (Inngest) acceptable, or is self-hosting (Trigger.dev/pg-boss) a hard requirement for security/compliance or cost reasons?
- Given the US WhatsApp marketing pause, how important is WhatsApp versus SMS for the first release, and does the owner want to go through Meta Tech Provider app review (weeks) before launch?
- Which of the 12 UI languages must be supported for outbound messaging templates at launch, and who authors/approves per-language WhatsApp templates?
- What historical attendee/order data can be migrated to seed contact_profile and year-over-year segments (e.g., 'attended last year')?
- Is there a legal/compliance owner to sign off on consent copy, quiet-hours policy, and the revocation-scope choice under the FCC's 2026 rule revision?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx
- https://resend.com/pricing
- https://resend.com/docs/api-reference/domains/create-domain
- https://resend.com/docs/dashboard/webhooks/event-types
- https://resend.com/docs/api-reference/introduction
- https://resend.com/docs/api-reference/emails/send-batch-emails
- https://postmarkapp.com/pricing
- https://postmarkapp.com/developer/api/domains-api
- https://aws.amazon.com/ses/pricing/
- https://docs.aws.amazon.com/ses/latest/dg/tenants.html
- https://docs.aws.amazon.com/ses/latest/dg/sending-email-subscription-management.html
- https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-ses-tenant-isolation-automated-reputation-policies
- https://www.saaspricepulse.com/tools/sendgrid (third-party, Feb 2026; vendor pricing page redirected)
- https://costbench.com/software/marketing-automation/customerio/ and https://customer.io/pricing
- https://loops.so/pricing and https://www.sequenzy.com/pricing/loops
- https://support.google.com/a/answer/81126
- https://senders.yahooinc.com/best-practices/
- https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730
- https://resend.com/blog/react-email-5 and https://react.email/docs/components/tailwind
- https://www.twilio.com/en-us/sms/pricing/us
- https://www.twilio.com/en-us/phone-numbers/pricing/us
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv
- https://www.twilio.com/en-us/blog/toll-free-verification-policy
- https://www.twilio.com/docs/messaging/features/message-scheduling
- https://www.twilio.com/blog/trust-hub-now-supports-tenant-verification-for-isvs
- https://telnyx.com/pricing/messaging
- https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges
- https://www.plivo.com/sms/pricing/us/
- https://apidog.com/blog/sinch-sms-api-cost/ (third-party; sinch.com pricing page 404)
- https://www.bclplaw.com/en-US/events-insights-news/the-tcpas-new-opt-out-rules-take-effect-on-april-11-2025-what-does-this-mean-for-businesses.html
- https://www.consumerfinancialserviceslawmonitor.com/2026/09/fcc-overhauls-tcpa-revocation-rules-before-they-even-take-effect/
- https://www.troutman.com/insights/fcc-revises-tcpa-revocation-of-consent-rules-that-were-set-to-go-into-effect-in-january/
- https://www.privacyworld.blog/2025/03/new-class-action-threat-tcpa-quiet-hours-and-marketing-messages/
- https://www.tychron.com/guides/state-texting-laws/ and https://www.fransis.ai/articles/texting-quiet-hours-tcpa-state-rules
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages
- https://developers.facebook.com/docs/whatsapp/messaging-limits
- https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
- https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/
- https://help.klaviyo.com/hc/en-us/articles/46890922548507
- https://getkanal.com/blog/whatsapp-marketing-usa-2026 (US marketing pause status, July 2026)
- https://setsmart.io/blog/whatsapp-business-api-pricing (third-party rate quotes)
- https://www.twilio.com/en-us/messaging/pricing/whatsapp
- https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide
- https://www.360dialog.com/pricing
- https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas
- https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
- https://docs.expo.dev/push-notifications/faq/
- https://onesignal.com/pricing
- https://knock.app/pricing and https://docs.knock.app/concepts/tenants
- https://novu.co/pricing and https://docs.novu.co/community/self-hosting-novu/overview
- https://www.courier.com/pricing
- https://temporal.io/pricing
- https://www.inngest.com/pricing, https://www.inngest.com/docs/guides/flow-control, https://www.inngest.com/docs/usage-limits/inngest
- https://trigger.dev/pricing, https://trigger.dev/docs/queue-concurrency, https://trigger.dev/docs/wait, https://trigger.dev/docs/triggering
- https://github.com/timgit/pg-boss and https://github.com/timgit/pg-boss/releases
- https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- https://crtc.gc.ca/eng/com500/faq500.htm and https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/getting-consent-send-email
- https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guide-to-pecr/electronic-and-telephone-marketing/electronic-mail-marketing/
