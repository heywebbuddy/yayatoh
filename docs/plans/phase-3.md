# Phase 3 plan — Command Center, marketing and communications

Status: **approved by the owner** (2026-09-28): all five decisions accepted; Wave A started. Roadmap: `docs/roadmap.md` Phase 3 (M3.1–M3.11). Owner priority 1.

## 1. What I'm asking you to decide

| # | Decision | Recommendation |
|---|---|---|
| P3-1 | **Widen D28.** Today D28 allows only M3.1 plumbing before the yayatoh.com cutover (B-Y). B-Y itself waits on your accounts (staging, live Stripe, SES, legacy dumps). Build all of Phase 3 now in development, behind fakes and feature flags, and keep only the real-world exit criteria and the public launch (M3.11) behind B-Y. | Yes |
| P3-2 | **WhatsApp route (D16).** The roadmap specifies the WhatsApp Cloud API (Embedded Signup); today messages go through your own gateway (`whatsapp.panitechnologies.com`). | Build the port with both adapters; Cloud API for new tenants, your gateway kept for existing flows until migrated |
| P3-3 | **Realtime.** Ably (roadmap) or SSE only for now. | SSE now (already proven in live seats), Ably adapter behind the same port when you open the account |
| P3-4 | **Analytics sink.** M3.1 wants an interface; M6.2 names ClickHouse or Tinybird. | Port plus a Postgres implementation now; choose a vendor at M6.2 |
| P3-5 | **Messaging quotas before paid plans.** Included per-org quotas with admin-set limits (roadmap). | Yes; defaults pending your numbers |

## 2. Starting point

Phase 1 already delivers much of Phase 3's foundation:
- **Event pipeline:** outbox with exactly-once subscribers, a projector pattern (marketplace), pg-boss worker, a realtime port with org-scoped channels, SSE with resume (live seats), a metric registry (reports).
- **Command Center inputs:** readiness engine; dashboard tiles; failed-payment, refund, capacity and check-in facts; device heartbeats with battery and queue depth; fraud signals (M1.9e adds the order timeline and alerts); seat states; ticket distribution; member alerts and the inbox bell; the bulk-action framework to link alerts to fixes (M1.8f adds bulk seats and resend/cancel).
- **Messaging:** notification kinds and categories, a dispatcher policy gate (pause, unsubscribe, preferences, federal quiet hours), one-click unsubscribe, address suppressions, delivery-event webhooks, fake SES/Twilio/WhatsApp transports, the consent ledger with evidence, erased-address suppression (M1.14e), web push (M1.10e).
- **CRM and campaigns:** contacts and consents, the contact timeline, attendee filters and labels, bulk attendee email (not marketing), announcements, template editor, series (for "last year's attendees").
- **Journeys:** scheduled sends, reminder planning, reschedule on date change, send de-duplication, `replayed` events from the migration (M2.2c).
- **Attribution:** short links and legacy redirects, tenant hosts, promo and channel breakdowns.
- **Surveys:** the forms engine (versioned, responses), signed link tokens, reviews (M1.4g).
- **Orders and support:** refunds, refund policy and override, receivables, disputes and evidence, claim-link transfers, cancel/postpone, the message log, box office, staff impersonation (M1.2e).
- **Launch:** plans and entitlements, fees, tenant status (M1.3f), signup codes, the leak crawler (M1.11d), CMS pages for a help center (M1.4g), incident runbook.

## 3. Increments

About 22 increments in four waves, each sized for one agent session and tested end to end (keyboard, axe, Arabic RTL) like Phase 1. Waves start when the one before is merged; increments inside a wave run in parallel (6 cloud + 2 local slots).

### Wave A — plumbing and independent features (starts after the last Phase 1 round is merged)
| Increment | Scope | Acceptance (roadmap) |
|---|---|---|
| **M3.1a** Metrics pipeline | `metric_snapshots` and `metric_timeseries` projectors from the outbox; sharded counters; lag measurement; analytics sink port + Postgres sink | Projector lag p95 ≤ 2 s at 20 scans/s |
| **M3.1b** Realtime publisher | Generalize the live-seat SSE feed into an org-scoped publisher for any channel; Ably adapter stub behind the port | Cross-org channel attach is denied |
| **M3.5a** Policy gate v2 | State quiet-hour rules (e.g. Texas Sunday), frequency caps, SMS consent blocking with a reason, WhatsApp category, GSM-7/UCS-2 segment counting, usage metering and per-org quotas, complaint-rate auto-pause, preference center, lifting a suppression | SMS without consent blocked with a reason; Texas Sunday quiet hours respected; complaint rate > 0.3 % auto-pauses the org |
| **M3.8a** Click tracking | Link redirector on tenant hosts, UTM and signed click ID, first- and last-touch attribution to orders | An end-to-end click → purchase is attributed |
| **M3.9a** Surveys | Post-event survey and session feedback on the forms engine; signed single-use links; one response per person; NPS and response reports | One response per person; reminders stop once answered |
| **M3.10a** Waitlists | Waitlists with timed offers and return-to-waitlist; offer expiry sweeper | (part of M3.10) |

### Wave B — Command Center core, audiences, providers
| Increment | Scope | Acceptance |
|---|---|---|
| **M3.2a** Command Center shell | Widget registry (module, role, profile, mode); role layouts (owner, ops, finance, door, marketing); event modes planning → pre-show → live → wrap in the venue timezone; readiness score | The door layout shows no revenue |
| **M3.2b** Alert engine | Alert states, grouping, acknowledgement timeout; rules for unseated, undistributed, failed/stuck payments, refund surge, devices offline/low battery/backlog, capacity, sell-out, sales pace, readiness blockers, domain/SSL, Connect past due, deliverability, automation failures; routing in-app, email and SMS with deep links to the fixing bulk action | Fixtures give exactly "37 attendees do not have seats", "120 purchased tickets have not been distributed", "14 payments failed", "Three check-in devices are offline", each resolving when fixed |
| **M3.6a** Audiences | `event_participation` and `contact_profile` projections; segment DSL → SQL with a builder; the three vision audiences as templates | The three audiences return exact fixture results |
| **M3.4a** Staff mode | Command Center lite inside the Scan PWA (live counts, device board, alerts), staff web-push alerts, kiosk and supervisor modes | 600 offline scans sync exactly once; feedback ≤ 300 ms (real-device check is yours) |
| **M3.5b** Provider adapters | SES (tenant, sending domain, SNS webhooks), Twilio SMS (10DLC-ready, status webhooks), WhatsApp (Cloud API + your gateway), fallback chains; all tested against fakes and recorded payloads, switched on by config | Provider webhooks verified and deduplicated |
| **M3.10b** Refund operations | Unified order timeline; refund-request queue with SLA; refund policy editor (tighten-only, snapshotted text); cancel/postpone wizard with financial preview and resumable mass refunds that skip disputed charges | Cancelling an event with 1,000 orders refunds in a resumable batch, skips disputed charges and reconciles |

### Wave C — live mode, campaigns, journeys
| Increment | Scope | Acceptance |
|---|---|---|
| **M3.3a** Live mode | Live feed; check-in speed per entrance and device; duplicate/invalid monitor; device board; capacity gauges; staff presence; TV mode; live-critical escalation | Tiles ≤ 3 s p95 under simulated load; offline alert within 90 s |
| **M3.3b** Guest assistance | "Need help" in the seat finder and staff scanner requests, one queue with assignment and resolution | (part of M3.3) |
| **M3.6b** Campaigns | Block editor with brand kit, test sends, schedules, recipient snapshot, per-tenant throttles, marketing-consent enforcement | A 50k send stays fair across tenants |
| **M3.7a** Journeys | `scheduled_actions` journeys; triggers (purchase, check-in, time relative to the event); the vision journey template (confirmation, T−7 d reminder, T−24 h SMS/WhatsApp, event-day push, post-event survey); cancellation hooks; reschedule on date change; run history; failure alerts | Time-travel test sends 5 messages at the right offsets; a date change reschedules; retries never duplicate; `replayed` events never trigger |
| **M3.8b** Marketing analytics | Campaign → registrations and revenue tiles; deliverability alerts into the alert engine | (part of M3.8) |
| **M3.10c** Support tools | Ticket transfers with claim step and wallet update; credit notes; dispute queue; support macros | (part of M3.10) |

### Wave D — launch readiness (build now, go live after B-Y)
| Increment | Scope | Acceptance |
|---|---|---|
| **M3.11a** Self-serve signup | Open signup under the current fee model behind a switch; pricing/fees page; onboarding checklist | Signup stays closed until you flip the switch |
| **M3.11b** Help and status | Help center on the CMS, marketing site pages, status-page integration (port + fake), on-call rota runbook | — |
| **M3.x** Hardening | Load tests for the new paths (projectors, SSE fan-out, campaign sends), leak-crawler coverage for every new table, accessibility sweep | Canary crawler finds nothing; k6 thresholds met |

## 4. What waits for you

- **To switch features on:** Ably (or keep SSE), SES production access + DKIM/MAIL FROM/DMARC, Twilio toll-free verification and 10DLC, Meta business verification (Cloud API) or your gateway, VAPID/FCM/APNs keys, live Stripe (mass refunds, disputes).
- **Legal:** TCPA counsel (M3.5), privacy notice / sub-processors / DPA, D26 SOC 2 (Type I kickoff at M3.11).
- **Numbers:** messaging quotas, the platform fee (launch runs at 0 % until set), alert thresholds (defaults from the roadmap).
- **Real-world exit criteria:** Command Center live mode used at ≥ 2 real events; a segmented campaign and the five-step journey running with attribution; public launch gate (30 days stable after B-Y, ≥ 2 live events on the new platform).

## 5. Timing

The roadmap sized Phase 3 at ~125 increments over 12–18 weeks for a single-threaded build. Grouped into the ~22 larger increments above and run 6–8 in parallel, the build is roughly **4 waves, about 1–2 days each including merges and the full test gate**, if review keeps pace. The exit criteria and the public launch still depend on B-Y and real events.
