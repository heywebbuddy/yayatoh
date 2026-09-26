# Platform Pricing Packaging Subscription Billing

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** direct charges for all organizers. The owner chose the HYBRID model and keeps the current fee model at launch (docs/roadmap.md §5.3, M6.6).


## Topic

platform-pricing-packaging-subscription-billing

# Yayatoh 2.0 — Platform Pricing, Packaging & Subscription Billing

Grounded in the vision doc (multi-tenant, white-label, modular Event OS serving small organizers → agencies → conference organizers, with existing Stripe-based ticketing and mobile apps). Research date: 2026-09-26. Web search budget was exhausted mid-task, so several vendor pages were fetched directly; items that could not be fetched are marked UNVERIFIED.

## 1. How comparable platforms package and bill (2026 figures)

| Segment | Vendor | Model | Verified figures |
|---|---|---|---|
| Self-serve ticketing | Eventbrite | Per-ticket fee, free events free, optional Pro (marketing) subscription | 3.7% + $1.79 service fee per paid ticket + 2.9% payment processing per order; free events $0; "Eventbrite Pro" email marketing add-on from $15/mo (eventbrite.com/organizer/pricing). Pro/Flex capacity tiers UNVERIFIED (page 404). |
| Self-serve ticketing | Tito | Pure pay-as-you-go, no subscription | 3% per paid ticket (2.5% nonprofit, on application); capped at €25/ticket; free tickets free; organizer's own Stripe/PayPal (2.9% + 30¢ US) (ti.to/pricing). |
| Self-serve ticketing | Humanitix | Per-ticket fee, all features on every plan | 2.1% + $0.99 per paid ticket (1% + $0.99 charities/schools) + 2.9% + $0.30 processing; free events $0 (humanitix.com/us/pricing). |
| Self-serve ticketing | Ticket Tailor | Pay-as-you-go per ticket or prepaid credit bundles; free tickets free | UNVERIFIED (site returned 403). Memory: ~$0.75/ticket PAYG, ~$0.26–0.50/ticket prepaid. |
| RSVP / guest mgmt | RSVPify | Free personal tier + monthly business tiers gated on registrations/month + per-ticket fee for paid events | Free (personal, ≤500 guests); Starter $39/mo (150 reg/mo, seating chart); Plus $125/mo (500 reg/mo, QR check-in, collaborators); Professional $409/mo (1,500 reg/mo, form logic, custom branding); Enterprise custom (kiosk, SSO). Ticketed: 1.95% + $0.90/ticket + Stripe 2.9% + $0.30 (getapp.com listing). |
| Wedding / gala seating | SeatFound | Per-event flat fee or agency monthly | Single Event $49 (unlimited guests, floor plan, kiosk, QR); Agency $99/mo (unlimited events, **white-label = remove "Powered by"**, clone events) (seatfound.com). |
| Wedding / gala seating | Venued | UNVERIFIED (site unreachable) | Memory: per-event pricing in the $40–$100 range with premium tiers. |
| Mid-market conference | Swoogo | Annual per-user license, unlimited events & registrations | Professional $11,800/yr: 1 full user, 1 reporting user, unlimited events/registrations, check-in app, 1 custom domain. Enterprise: custom, 5 branded URLs, SSO, sub-accounts, API, 99.9% SLA. Add-ons: Go Onsite Pro, Go Attend app, extra domains, premium support (swoogo.events/pricing). |
| Enterprise conference | Cvent | Annual subscription sized by events/attendee capacity + modules (Attendee Hub, OnArrival, LeadCapture) | No list price. Vendr: median $19,550/yr, range $5,012–$94,417; small orgs $5–25k, mid-market $30–150k; 15–30% multi-year discounts. |
| Enterprise conference | Bizzabo | Quote-based, contracted attendee capacity with overage | Vendr: median $30,035/yr, range $12k–$59k; hidden add-ons (lead retrieval, wearables, badge printing) add 15–30%. |
| Enterprise conference | RainFocus | Contact sales only (page 403) | UNVERIFIED. |

**Patterns worth copying**
1. Free events are free everywhere at the self-serve end; nobody wins share by charging for free RSVPs.
2. Per-ticket fees are the default monetization for organizers with revenue; flat subscriptions appear only where usage is not ticket revenue (RSVP volume, seats, custom domains, marketing).
3. White-label is consistently a paid tier signal: SeatFound gates "remove Powered by" at $99/mo, Swoogo gates custom domains (1 → 5) between Pro and Enterprise, RSVPify gates custom branding at $409/mo.
4. Enterprise is annual + capacity band + module add-ons, always quote-based, with overage clauses.
5. Nonprofit/charity discount is standard (Tito 2.5%, Humanitix 1%) — relevant for Yayatoh's church and association segment.

## 2. Recommended Yayatoh plan matrix

Hybrid model: **per-ticket platform fee funds the free/starter tiers; subscriptions unlock modules, white-label, and volume; metered add-ons cover variable communication cost.**

| | Free | Starter | Pro | Agency | Enterprise |
|---|---|---|---|---|---|
| Price | $0 | $29/mo or $290/yr | $99/mo or $990/yr | $249/mo or $2,490/yr | From ~$6k/yr, quote |
| Per-ticket platform fee (paid tickets) | 3.5% + $1.29 | 2.9% + $0.99 | 2.5% + $0.79 | 2.0% + $0.59 | 0–1.5% negotiated or $0 with volume commit |
| Free tickets / RSVPs | free, ≤500 guests/event | free, ≤2,000 | free, unlimited | unlimited | unlimited |
| Nonprofit/church discount | — | 20% off plan, fee 1.9% + $0.79 | same | same | custom |
| Modules: Events, Ticketing, Orders, Attendees, QR check-in, basic analytics | ✓ | ✓ | ✓ | ✓ | ✓ |
| Seating (tables/seats, seat finder) | 1 floor plan/event, watermark | ✓ | ✓ + sections/VIP/kiosk mode | ✓ | ✓ |
| Guest list, RSVP, plus-ones, CSV import | ✓ basic | ✓ | ✓ | ✓ | ✓ |
| Marketing: email campaigns, audiences, automations | 1 automation, 1,000 emails/mo | 5,000 emails/mo | 25,000 emails/mo, SMS/WhatsApp enabled (metered) | 100,000 emails/mo | custom pool |
| Conference: registration forms, sessions, speakers | — | forms only | ✓ sessions/speakers/tracks | ✓ | ✓ + exhibitor/sponsor portals, badges, lead retrieval |
| Command Center (real-time ops, alerts, device status) | basic dashboard | basic | ✓ | ✓ | ✓ + custom reports |
| Team seats | 1 | 3 | 10 | 25, client sub-orgs | unlimited, SSO |
| White-label | "Powered by Yayatoh" | remove branding | + custom domain (1) | + custom domains (5), custom email sender domain, client-branded sub-orgs | + branded mobile app (Expo EAS white-label build), custom SLA |
| API & webhooks | read-only | read-only | ✓ | ✓ | ✓ elevated limits |
| Check-in devices | 2 | 5 | 20 | 50 | unlimited |

Rationale: Starter at $29 undercuts RSVPify's $39 while bundling seating; Pro at $99 matches SeatFound Agency and makes custom domain the upgrade trigger (as Swoogo/SeatFound do); Agency at $249 introduces client sub-organizations (the "Clients | Events | Marketing | Reports" persona from the vision); Enterprise anchors well below Swoogo's $11.8k and the Cvent median of $19.5k. Runner-up: a pure per-ticket model like Tito/Humanitix — rejected because weddings/galas/RSVP-only events generate no ticket revenue and the marketing/WhatsApp costs need a subscription base.

## 3. Metered add-ons (Stripe Billing Meters)

| Meter (event_name) | Unit | Included | Overage price | Cost basis |
|---|---|---|---|---|
| `email_sent` | email | per plan | $1.50 / 1,000 | Resend Pro: $20/50k, $0.90/1k overage (resend.com/pricing) |
| `sms_segment_sent` | segment | 0 | $0.03 / segment (US) | Twilio $0.0083/segment + carrier fees $0.0035–$0.005 (twilio.com); 10DLC brand/campaign fees UNVERIFIED (memory: $4 brand, $15 vetting, $1.50–$10/mo per campaign) |
| `whatsapp_marketing_sent` | delivered template | 0 | $0.06 / message | Meta per-message pricing since 2025-07-01; new rate card effective 2026-07-01 (developers.facebook.com); US marketing rate UNVERIFIED (memory ≈ $0.025) |
| `whatsapp_utility_sent` | delivered template | 0 | $0.02 / message | utility free inside service window |
| `push_sent` | notification | unlimited | — | Expo push is free; keep as a usage stat only |
| `lead_retrieval_license` | exhibitor license per event | 0 | $99–$149 / license / event (Enterprise; Bizzabo/Cvent charge similar via add-ons) | licensed (quantity) not metered |
| `extra_seat` | team user | per plan | $10 / user / mo | licensed price, quantity on subscription item |
| `extra_custom_domain` | domain | per plan | $15 / domain / mo | licensed |
| `checkin_device_overage` | device-day | per plan | $2 / device-day | metered, `count` aggregation |

## 4. Technical approach: Stripe Billing for tenants + Stripe Connect for organizers

**Two money flows, one Stripe platform account**
1. **Ticket buyers → organizers**: Connect direct charges on the organizer's connected account with `payment_intent_data[application_fee_amount]` = Yayatoh's per-ticket platform fee. Application fee is transferred to the platform; connected account bears Stripe fees, refunds and disputes (docs.stripe.com/connect/direct-charges). Use `refund_application_fee=true` on full refunds and keep partial-refund proportional behavior. This is Stripe's "Stripe-owned pricing" SaaS model — no per-account Connect fees to the platform and possible referral revenue share (docs.stripe.com/connect/saas). Runner-up: destination charges with `on_behalf_of` — better for Express/Custom accounts but the platform absorbs fees/disputes; choose it only if Yayatoh later moves to a buy-rate model.
2. **Organizers (tenants) → Yayatoh**: Stripe Billing subscriptions where the tenant is a **platform-level Customer** (one Customer per organization, never per user). Stripe's Connect docs explicitly describe this "bill connected accounts" pattern: Prices live on the platform, the Customer represents the connected account, and the subscription is independent of ticket flows (docs.stripe.com/connect/subscriptions). Store `stripe_customer_id` and `stripe_connect_account_id` on the `organizations` row.

**Catalog**
- One Product per plan (`yayatoh_starter`, `yayatoh_pro`, `yayatoh_agency`, `yayatoh_enterprise`) with monthly and annual Prices (`lookup_key` e.g. `pro_monthly_v1`). Version prices instead of editing (`pro_monthly_v2`) so grandfathering is trivial.
- Licensed add-on Products (seats, domains, lead-retrieval licenses) as quantity-based Prices on the same subscription.
- Metered Prices bound to Billing Meters (`recurring.usage_type=metered`, `recurring.meter=mtr_…`), graduated tiers for email.
- Stripe **Entitlements**: create a Feature per module (`lookup_key` = module code such as `seating`, `sessions`, `white_label_domain`), attach to Products via `/v1/products/{id}/features`. Stripe then emits `entitlements.active_entitlement_summary.updated` on any subscribe/upgrade/downgrade/cancel; the summary carries max 10 entitlements, so always follow `entitlements.url` to page the full list (docs.stripe.com/billing/entitlements).

**Usage metering — use Billing Meters, not Metronome**
Stripe now steers new integrations to Metronome, but its own comparison table shows Metronome has **no Connect compatibility**, no Adaptive Pricing and limited Checkout support, while Billing Meters remains fully supported and Connect-compatible; up to 100M meter events/month are included in Billing pricing (docs.stripe.com/billing/subscriptions/usage-based/compare-metronome; stripe.com/billing/pricing). Yayatoh is a Connect platform, so Billing Meters is the correct choice. Constraints to design for: meter config is immutable after creation except display name; `/v1/billing/meter_events` limit 1,000 calls/s per account and one concurrent call per customer per meter; timestamps must be ≤35 days old and ≤5 min in future; `identifier` gives idempotency; corrections via Meter Event Adjustments only within 24 h; aggregation is async and reconciled at invoice time (docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api). Implementation: write every send to a local `usage_events` table first (source of truth for in-app quota display and hard caps), then a worker pre-aggregates hourly per org and posts one meter event per (org, meter, hour) with `identifier = org_id:meter:hour`. Enforce plan quotas locally (Stripe only reconciles at invoice time, so a Free tenant could otherwise blow past limits).

**Trials, proration, dunning, portal, tax**
- Trials: 14-day Pro trial without card via `trial_period_days` + `trial_settings[end_behavior][missing_payment_method]=pause`; react to `customer.subscription.trial_will_end` (3 days prior) and `customer.subscription.paused`. The new Trial Offer API (paid/discounted trials) is preview-only (`2026-03-25.preview`, requires `billing_mode=flexible`) — do not depend on it at launch.
- Plan changes: create new subscriptions with `billing_mode[type]=flexible` (more accurate credit prorations). Upgrades: `proration_behavior=always_invoice` so the tenant pays immediately and modules unlock at once; downgrades: schedule at period end via Subscription Schedules or `cancel_at_period_end`-style `proration_behavior=none`. Preview with `invoices.create_preview` passing `subscription_details.proration_date`, and reuse that `proration_date` on the update. Usage-based items are never prorated.
- Dunning: enable Smart Retries (recommended default 8 attempts over 2 weeks); on exhaustion set subscription to `past_due` rather than cancel, and let the app degrade the tenant to read-only after `invoice.payment_failed` with `attempt_count ≥ 4`; hard declines require a new payment method (docs.stripe.com/billing/revenue-recovery/smart-retries).
- Customer portal: enable payment method updates, invoices, and plan switching among Starter/Pro/Agency (max 10 products); note the portal cannot *update* subscriptions containing usage-based items, only cancel them — so do plan switches from Yayatoh's own billing page via API and use the portal for cards/invoices. Custom portal domain is $10/mo.
- Tax: Stripe Tax on the platform subscription (`automatic_tax[enabled]=true`) at 0.5% per transaction (low-code) or $0.50 per API transaction; SaaS is taxable in several US states (e.g., TX, PA, NY) so register early. Tax on tickets is the organizer's liability (connected account is merchant of record with direct charges); Stripe Tax for connected accounts requires the account's tax settings `status=active` before enabling `automatic_tax` on their Checkout sessions (docs.stripe.com/tax/tax-for-platforms).
- Billing cost: Stripe Billing is charged as a percentage of billing volume — 0.7% on the page that loaded (India geo); US Starter/Scale rates UNVERIFIED (memory: 0.5% / 0.8%).

**Entitlement sync to `org_module_entitlements`**
1. Webhook handler (idempotent on `event.id`, persisted to `billing_webhook_events`) consumes `entitlements.active_entitlement_summary.updated`, `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`.
2. Resolve org by `stripe_customer_id`; fetch full active entitlements list; upsert `org_module_entitlements` rows (`org_id, module_code, source='subscription', limit_json, valid_from, valid_to, stripe_subscription_item_id`). Rows for modules no longer entitled get `valid_to = now()` (soft-revoke, keeps data; UI shows "module locked").
3. Merge with `entitlement_overrides` (super-admin grants, trials, partner deals, per-event upsells) — effective entitlement = union of active subscription entitlements and unexpired overrides; limits take the max.
4. Nightly reconciliation job calls `GET /v1/entitlements/active_entitlements?customer=` for all paying orgs and repairs drift (Stripe itself recommends persisting entitlements locally).
5. Feature gates in Next.js read a cached `effective_entitlements` JSON on the org (Redis, 60 s TTL) — never call Stripe in the request path. Module navigation per event type (wedding vs conference) is a *presentation* layer on top of entitlements: the org's plan decides what it *may* use; the event template decides what is *shown*.

**Combining per-ticket fees with subscriptions**
- `platform_fee_schedules` table: `(plan_code, fee_percent, fee_fixed_cents, min_fee_cents, max_fee_cents, absorb_default, currency, valid_from)`. The checkout service computes `application_fee_amount` per order from the org's *current* plan at purchase time and stores the snapshot on the order (fees must not retroactively change on plan downgrade).
- Enterprise "$0 per-ticket" deals are just a schedule row with 0% plus a higher subscription; volume-commit deals use Subscription Schedules phases.
- Organizer chooses "absorb" or "pass to buyer" per ticket type (all competitors offer this); the fee line is shown on receipts either way.
- Application fees land in the platform balance immediately; subscription revenue arrives via Billing invoices; both are reported to finance from Stripe Sigma plus the local `platform_revenue_ledger` (fee per order, refunds of application fees, subscription invoices, metered overages).

## 5. Platform super-admin console (Yayatoh staff only)

- **Tenant list**: org, plan, MRR, trial end, Stripe customer/account links, Connect `charges_enabled`/`payouts_enabled`/`requirements.currently_due`, custom domains and TLS status, last activity, risk score.
- **Plan overrides**: grant/revoke module entitlements with expiry and reason (writes `entitlement_overrides`, audit-logged); change fee schedule per org; apply coupons/promotion codes; force plan change with proration preview; extend trials (`trial_end` update).
- **Commission & settlement oversight**: per-org GMV, application fees collected/refunded, disputes and chargeback rate (from `charge.dispute.*` webhooks on connected accounts), payout schedule control (`settings.payouts.schedule.interval` daily/weekly/monthly/manual, `delay_days_override` up to 31 for accounts where platform owns liability), manual payout trigger, negative balance list.
- **Abuse suspension**: org `status` (active, limited, suspended, terminated) with kill-switches: pause new event publishing, pause checkout, pause outbound messaging (protects 10DLC/WhatsApp sender reputation), and for Express/Custom accounts `POST /v1/accounts/{id}/reject` with `reason=fraud|terms_of_service|other` (defaults to pausing payouts). Standard accounts can only be disconnected, so suspension there is app-level plus payout-timing controls.
- **Billing ops**: failed invoices queue, dunning status, usage anomalies (meter error events `v1.billing.meter.error_report_triggered`), refund application fee tool, tax registration status per connected account.
- **Impersonation & audit**: "view as org" with reason capture, immutable audit log on every override.

## 6. Open risks

- Stripe is publicly de-emphasizing Billing Meters in favor of Metronome; it remains "fully supported" but the roadmap may stall — keep the meter abstraction thin so a swap is possible.
- Meta and carriers change messaging prices annually (next WhatsApp card 2026-07-01); price add-ons with margin and repricing clauses.
- Mixing legacy Laravel-era organizers (currently per-ticket only) into plans requires a grandfathered `legacy_fee` schedule and a migration date.


## Key recommendations

- Adopt a hybrid model: per-ticket platform fee (3.5% + $1.29 on Free, descending to 2.0% + $0.59 on Agency, negotiable to 0 on Enterprise) plus monthly/annual subscriptions ($0 / $29 / $99 / $249 / quote) that unlock modules, white-label and volume; free tickets and RSVPs stay free at every tier, matching Eventbrite, Tito, Humanitix and RSVPify.
- Make white-label the upgrade trigger: 'Remove Powered by' at Starter, 1 custom domain at Pro, 5 domains + client sub-orgs at Agency, branded mobile app at Enterprise (mirrors SeatFound $99/mo agency and Swoogo 1→5 domains).
- Offer a 20% nonprofit/church discount and reduced per-ticket fee (Tito 2.5%, Humanitix 1% + $0.99 set the market expectation).
- Bill tenants with Stripe Billing on the platform account (one Customer per organization) and keep ticket money on Stripe Connect direct charges with application_fee_amount; Stripe documents this 'bill connected accounts' pattern and it avoids per-account Connect fees under the Stripe-owned pricing model.
- Use Stripe Billing Meters (not Metronome) for email/SMS/WhatsApp/device overages because Metronome has no Connect compatibility; pre-aggregate usage hourly per org, use deterministic identifiers for idempotency, and enforce quotas locally since Stripe only reconciles usage at invoice time.
- Model modules as Stripe Entitlement Features (lookup_key = module code) attached to plan Products, and sync entitlements.active_entitlement_summary.updated into org_module_entitlements with a nightly reconciliation job; merge with an entitlement_overrides table for super-admin grants and trials.
- Create subscriptions with billing_mode=flexible; upgrades use proration_behavior=always_invoice (instant unlock), downgrades apply at period end; preview with invoices.create_preview using a fixed proration_date.
- Enable Smart Retries (8 attempts / 2 weeks), keep failed subscriptions past_due rather than cancelled, and degrade the tenant to read-only in-app; use the Stripe customer portal for cards and invoices but perform plan switches in Yayatoh's own UI because the portal cannot update subscriptions containing metered items.
- Turn on Stripe Tax for platform subscriptions (0.5%/transaction) and register in SaaS-taxing states; leave ticket tax liability with organizers (merchant of record on direct charges) and only enable automatic_tax on their checkouts once their tax settings status is active.
- Snapshot the per-ticket fee schedule on each order at purchase time from a platform_fee_schedules table keyed by plan, so plan changes never retroactively alter organizer settlements.
- Build the super-admin console around tenant status kill-switches (publishing, checkout, messaging), entitlement overrides with expiry and audit, payout-schedule and delay controls, and accounts.reject for Express/Custom accounts flagged for fraud.
- Price metered add-ons with margin over verified costs: email $1.50/1k (Resend $0.90/1k), SMS $0.03/segment (Twilio $0.0083 + carrier fees), WhatsApp marketing ~$0.06/msg; lead-retrieval licenses $99–$149 per exhibitor per event as a licensed quantity item.


## Data model implications

- organizations: add stripe_customer_id (platform Billing customer), stripe_connect_account_id, connect_account_type (standard|express|custom), plan_code, billing_status (trialing|active|past_due|paused|canceled), org_status (active|limited|suspended|terminated), nonprofit_verified, fee_absorb_default.
- plans / plan_prices: plan_code, stripe_product_id, stripe_price_id, interval (month|year), version, is_grandfathered, included_limits_json (emails, seats, domains, devices, guests).
- org_subscriptions: org_id, stripe_subscription_id, status, current_period_start/end, trial_end, cancel_at_period_end, billing_mode, items[] (stripe_subscription_item_id, price_id, quantity, meter_id).
- org_module_entitlements: org_id, module_code, source (subscription|override|trial|event_addon), limit_json, valid_from, valid_to, stripe_subscription_item_id, stripe_entitlement_id; unique on (org_id, module_code, source).
- entitlement_overrides: org_id, module_code, granted_by_admin_id, reason, expires_at, limit_json; audit-logged.
- platform_fee_schedules: plan_code or org_id, fee_percent, fee_fixed_cents, min_fee_cents, max_fee_cents, currency, valid_from, valid_to; orders snapshot platform_fee_cents, fee_schedule_id, application_fee_id.
- usage_events: org_id, meter_code, quantity, occurred_at, source_ref (campaign_id/message_id/device_id), reported_to_stripe_at, stripe_identifier; plus usage_counters (org_id, meter_code, period_start, included, used) for quota enforcement.
- billing_webhook_events: stripe_event_id (unique), type, payload, processed_at, error — idempotent processing of Billing, Entitlements, Connect and meter error events.
- platform_revenue_ledger: entry_type (application_fee|application_fee_refund|subscription_invoice|usage_overage|referral_share), org_id, stripe_object_id, amount_cents, currency, occurred_at.
- connect_account_snapshots: org_id, charges_enabled, payouts_enabled, requirements_currently_due, disabled_reason, payout_schedule_json, tax_settings_status, last_synced_at.
- org_suspensions: org_id, action (pause_publishing|pause_checkout|pause_messaging|reject_account), reason, actor_admin_id, created_at, lifted_at.
- lead_retrieval_licenses: event_id, exhibitor_id, license_count, stripe_invoice_item_id, status — per-event licensed quantity billed to the organizer (or exhibitor via separate checkout).


## Risks

- Stripe now recommends Metronome for new usage-based integrations and calls Billing Meters a 'lower-level primitive'; Meters remain fully supported and are the only Connect-compatible option, but future feature investment may lag — keep the metering layer abstracted.
- US Stripe Billing percentage (Starter/Scale) and Ticket Tailor, Venued, Eventbrite Pro-tier, WhatsApp US per-message and Twilio 10DLC registration figures could not be fetched and are UNVERIFIED; confirm before publishing pricing.
- Messaging costs (Meta WhatsApp rate card effective 2026-07-01, US carrier surcharges) change frequently; fixed overage prices need annual repricing and margin headroom.
- Stripe customer portal cannot update subscriptions that contain usage-based items — plan switching must be built in-app, adding scope.
- Standard connected accounts cannot be rejected via API; abuse suspension for them relies on app-level kill-switches and payout-timing controls only.
- Application fees are not auto-refunded on ticket refunds; forgetting refund_application_fee leaves organizers out of pocket and creates disputes.
- SaaS subscriptions are taxable in several US states; failing to register and enable Stripe Tax early creates back-tax exposure.
- Legacy Laravel-era organizers billed only per ticket will need a grandfathered fee schedule and a communicated migration date to avoid churn.
- Trial Offer API (paid/discounted trials) is preview-only as of 2026-03-25 and incompatible with Checkout; relying on it at launch risks breaking changes.
- Enterprise deals priced below Swoogo ($11.8k) and Cvent median ($19.5k) may under-monetize if lead retrieval, badges and branded apps are bundled instead of sold as add-ons.


## Open questions

- What is the current per-ticket fee schedule on Yayatoh.com today (percent, fixed, absorb vs pass-through) and how many active organizers must be grandfathered?
- Are existing organizers on Stripe Standard accounts (organizer-owned) or Express/Custom (platform-controlled)? This determines whether accounts.reject and payout controls are available and whether the buy-rate model is possible.
- Which Stripe account/entity will own the platform subscription revenue, and in which US states is Yayatoh registered for sales tax on SaaS?
- Should Yayatoh be merchant of record for any tickets (destination charges) or always leave the organizer as merchant of record (direct charges)?
- What share of current volume is free/RSVP-only events versus paid ticketing? This sets how aggressive the Free tier can be.
- Is a nonprofit/church discount desired, and how will eligibility be verified (EIN lookup, manual review)?
- Does Yayatoh want to resell messaging (own Twilio/Meta accounts, metered to tenants) or let large tenants bring their own Twilio/WhatsApp credentials with no overage?
- What is the target Enterprise ACV and will lead retrieval, badge printing and branded apps be sold as separate add-ons or bundled?
- Should agencies (multi-client) be billed one subscription with client sub-orgs, or should each client org carry its own subscription with agency-level discounts?
- Do the existing mobile apps need a white-label build per Enterprise tenant (separate App Store listings) or only in-app theming under the Yayatoh listing?


## Sources

- https://www.eventbrite.com/organizer/pricing/ (fetched 2026-09-26: 3.7% + $1.79 service fee, 2.9% processing, free events free, Pro email add-on from $15/mo)
- https://ti.to/pricing (3% per ticket, 2.5% nonprofit, €25 cap, no subscription)
- https://humanitix.com/us/pricing (2.1% + $0.99, charities 1% + $0.99, 2.9% + $0.30 processing)
- https://www.getapp.com/marketing-software/a/rsvpify/ (RSVPify Free / $39 / $125 / $409 / Enterprise; 1.95% + $0.90 per ticket)
- https://www.seatfound.com/ (Single Event $49, Agency $99/mo with white-label)
- https://swoogo.events/pricing/ (Professional $11,800/yr, Enterprise custom, 1 vs 5 branded domains)
- https://www.vendr.com/marketplace/cvent (median $19,550/yr, range $5,012–$94,417)
- https://www.vendr.com/marketplace/bizzabo (median $30,035/yr, range $12k–$59k)
- https://stripe.com/billing/pricing (Billing % of volume, Smart Retries, portal custom domain $10/mo, 100M meter events/month included; page served India rate 0.7%, US rate UNVERIFIED)
- https://stripe.com/tax/pricing (0.5% per transaction low-code; $0.50 per transaction API + 10 calculations)
- https://docs.stripe.com/billing/subscriptions/usage-based (Metronome vs Billing Meters guidance)
- https://docs.stripe.com/billing/subscriptions/usage-based/compare-metronome (Connect: Billing Meters supported, Metronome not)
- https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api (meter events rate limits, 35-day window, identifiers, v2 event stream)
- https://docs.stripe.com/billing/subscriptions/usage-based/meters/configure (meter creation, aggregation, adjustments within 24h)
- https://docs.stripe.com/billing/entitlements?dashboard-or-api=api (Features, product_features, active_entitlement_summary.updated, 10-entitlement summary cap)
- https://docs.stripe.com/connect/subscriptions (bill connected accounts as platform Customers, application_fee_percent, on_behalf_of)
- https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted (application_fee_amount, refund_application_fee, fee flow)
- https://docs.stripe.com/connect/saas (Stripe-owned pricing vs buy-rate monetization models)
- https://docs.stripe.com/billing/subscriptions/prorations (proration_behavior, billing_mode flexible, create_preview with proration_date)
- https://docs.stripe.com/billing/subscriptions/trials (Trial Offer API preview 2026-03-25; legacy trial_end/trial_period_days)
- https://docs.stripe.com/billing/revenue-recovery/smart-retries (8 retries / 2 weeks default; past_due/unpaid/cancel outcomes; hard decline codes)
- https://docs.stripe.com/customer-management (portal features and limitation on usage-based subscriptions; $10/mo custom domain)
- https://docs.stripe.com/tax/tax-for-platforms (connected account tax settings must be active before automatic_tax)
- https://docs.stripe.com/api/account/reject (reason fraud|terms_of_service|other, payouts_action pause; Express/Custom only)
- https://docs.stripe.com/connect/manage-payout-schedule (interval manual/daily/weekly/monthly, delay_days_override ≤31)
- https://docs.stripe.com/connect/platform-controls-for-stripe-dashboard-accounts (payout timing control, remove account)
- https://www.twilio.com/en-us/sms/pricing/us ($0.0083/segment; carrier fees $0.0035–$0.005; MMS $0.022)
- https://developers.facebook.com/docs/whatsapp/pricing (per-message pricing since 2025-07-01; rate card effective 2026-07-01; US figures not in page text)
- https://resend.com/pricing (Free 3k/mo; Pro $20/50k, $35/100k; $0.90 per 1k overage; dedicated IP $30/mo)
- UNVERIFIED (fetch blocked): tickettailor.com/pricing, venued.com, rsvpify.com/pricing, cvent.com pricing, bizzabo.com/pricing, rainfocus.com/pricing, Twilio 10DLC fee article, Eventbrite Pro/Flex tier prices
