# Analytics Command Center

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

Event Command Center dashboard, analytics, alerts and reporting

# Yayatoh 2.0 — Event Command Center: Metrics, Analytics Architecture, Alerts and Reporting

Research date: 2026-09-26. Grounded in "Yayatoh.com Rebuild — Project Vision and Goal" (§7 Dashboard, §8 Marketing analytics, §9 Check-in, §11 Attendee CRM, §12 Event-type workflows, §13 Modules). Versions/prices below were verified against vendor pages or the npm registry on this date unless marked UNVERIFIED.

## 0. Design principles (derived from the vision doc)

1. **One metric layer, many surfaces.** Every number the organizer sees (dashboard tile, alert, export, mobile app, CRM profile) must come from one definition registry so "attendance %" is identical everywhere. Definition drift between "live counters" and "reports" is the #1 failure mode of event dashboards.
2. **Freshness is a property of the metric, not the dashboard.** Each metric declares a freshness class: **L0** exact/transactional, **L1** live (≤2 s, projected from domain events), **L2** near-real-time (≤5 min, materialized), **L3** batch (hourly/daily OLAP). The UI shows `as_of` on every tile.
3. **Tenant isolation everywhere**: every fact row carries `org_id`; every query is scoped by the metric service, never by the caller.
4. **Modular by event type** (§12): widgets and alert rules are registered per module (Ticketing, Registration, Seating, Sessions, Exhibitors, Marketing, Check-in) and only mount when the module is enabled on the event.

## 1. Metrics catalog

Grain key: **E** = event, **O** = org (cross-event), **S** = session, **TT** = ticket type, **EN** = entrance, **D** = device, **C** = campaign, **P** = person. Status vocabulary assumed: ticket ∈ {issued, distributed, claimed, checked_in, refunded, voided}; order ∈ {pending, paid, failed, refunded, partially_refunded, cancelled}; RSVP ∈ {invited, accepted, declined, pending, maybe}.

### 1.1 Revenue and finance (align to Stripe `reporting_category`: charge, refund, fee, dispute, platform_earning)

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Gross sales | Σ order totals (incl. buyer-paid fees, taxes) for orders in `paid` or `partially_refunded` state, in order currency | E, TT, O | L1 |
| Refunds | Σ refund amounts (full + partial) + Σ chargebacks/disputes lost | E, O | L1 |
| Net revenue | Gross sales − refunds − disputes − processor fees − Yayatoh platform fee (when Yayatoh is the merchant of record; if org uses own Stripe account, platform fee is a separate line) | E, O | L2 |
| Refund rate | Refunded tickets ÷ paid tickets | E, TT | L2 |
| Failed payments | Count of payment attempts whose *latest* attempt is `failed` in window (default 24 h); "pending > 15 min" counted separately as **stuck** | E | L1 |
| AOV | Gross sales ÷ paid orders | E, O | L2 |
| Payout position | Stripe balance available/pending for the org (read from Stripe, not computed) | O | L3 |

### 1.2 Sales and ticketing

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Tickets sold | Tickets in {issued, distributed, claimed, checked_in} from orders in {paid, partially_refunded} plus completed free orders | E, TT | L1 |
| Capacity | Σ ticket-type quantity caps, capped by venue/seat-map capacity if lower | E, TT | L0 |
| Sell-through % | Tickets sold ÷ capacity | E, TT | L1 |
| Sales velocity | Tickets sold in trailing 24 h / 7 d; **pace vs. comparable** = same days-to-event on the org's last comparable event | E | L2 |
| Sell-out ETA | (Capacity − sold) ÷ 7-day velocity, if velocity > 0 | E | L2 |
| Checkout conversion | Paid orders ÷ checkout sessions started; page conversion = paid orders ÷ unique event-page visitors (Eventbrite reports only page visits → orders → tickets with last-touch channel; we add "checkout started" as an intermediate stage) | E | L3 |
| Promo/channel mix | Tickets & gross by promo code, sales channel (web, white-label domain, mobile app, box office/manual, imported) | E | L2 |

### 1.3 Registrations (Registration module — conferences)

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Registrations | Registration records with status `confirmed` (paid or approved); separately `pending` (incomplete form / awaiting payment or approval), `waitlisted`, `cancelled` | E, reg-type | L1 |
| Completion rate | Confirmed ÷ started (form opened and saved) | E | L2 |
| Approval backlog | Pending-approval registrations older than 48 h | E | L2 |
| Session registrations / fill % | Confirmed session picks ÷ session capacity | S | L1 |

### 1.4 Attendees and guests (Wedding/gala module uses guest vocabulary)

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Expected attendance | Active tickets (sold − refunded − voided) — the canonical denominator for attendance | E | L1 |
| Attendees (people) | Distinct `person_id` holding ≥1 active ticket/registration (dedup by verified email/phone within org) | E, O | L2 |
| Guests invited / headcount | Invited guests; headcount = accepted guests + accepted plus-ones | E | L1 |
| RSVP response rate | (Accepted + declined) ÷ invited; **RSVP pending** = invited − accepted − declined | E | L1 |
| Guest groups | Groups with any member unseated / with mixed RSVP status | E | L2 |

### 1.5 Check-in and onsite

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Checked in | Distinct tickets with ≥1 `valid` scan in scope (event, day, session or entrance) | E, S, EN, TT | L1 |
| Attendance % | Checked in ÷ expected attendance (post-event: no-show % = 1 − attendance %) | E, TT, S | L1 |
| Throughput | Valid scans per 1-min bucket, per entrance and per device; also 5-min moving average; timestamp = `scanned_at` (device clock) not `received_at`, so offline replays land in the right bucket | EN, D | L1 |
| Completion ETA | (Expected − checked in) ÷ current 5-min throughput | E | L1 |
| Duplicate scans | Scans of a ticket already checked in within the same scope (result `duplicate`); **repeat offender** = same ticket ≥3 duplicate attempts or duplicates from ≥2 devices within 10 min (fraud signal) | E, D | L1 |
| Invalid scans | Result ∈ {not_found, refunded, voided, wrong_event, wrong_day, wrong_entrance, signature_invalid, expired} — counted by reason | E, EN | L1 |
| Manual check-ins | Check-ins by name/phone/email lookup or override, as share of all check-ins | E, D | L1 |
| Device status | online = heartbeat ≤ 60 s; degraded = 60–180 s; offline > 180 s; plus battery %, app version, offline queue depth | D | L1 |
| Assistance queue | Open assistance requests (raised by scanner app or seat-finder kiosk), by reason, with age | E | L1 |
| Session attendance | Distinct session check-ins ÷ session registrations and ÷ capacity; dwell time only if out-scans are enabled (Cvent tracks session duration this way) | S | L1 |

### 1.6 Seating, distribution and claims

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Seats assigned / unassigned | Seat-map seats with/without an assignment; per section and table | E | L1 |
| Attendees without seats | Active tickets in seated ticket types (or accepted guests) with no seat assignment — the "37 attendees do not have seats" number | E, TT | L1 |
| Tables over/under capacity | Tables where assigned > seats, or < min fill threshold | E | L2 |
| Seat-map completion % | Assigned ÷ required assignments | E | L1 |
| Tickets distributed | Tickets in a multi-ticket order that have a named recipient (sent/transferred); **not distributed** = active tickets in orders with qty > 1 still unassigned to a person — "120 purchased tickets not distributed" | E | L1 |
| Tickets claimed / claim rate | Distributed tickets whose recipient accepted (opened claim link / added to wallet / account) ÷ distributed | E | L1 |
| Seat-finder lookups | Kiosk/QR lookups per hour; failed lookups (name not found) | E | L1 |

### 1.7 Marketing performance (§8)

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Sent / delivered / bounced / failed | Provider webhook events per message; delivery rate = delivered ÷ sent | C, channel | L2 |
| Opened (email only) | Unique opens ÷ delivered; flag Apple Mail Privacy Protection inflation; **SMS/WhatsApp use delivered/read (WhatsApp read receipts) and click instead** | C | L2 |
| Clicked | Unique clicks ÷ delivered (tracked links) | C | L2 |
| Unsubscribed / complaints | Per campaign and rolling 30-day rate (should stay < 0.5 %) | C, O | L2 |
| Attributed orders / revenue | **Last-touch** within a 7-day click window using Yayatoh's own tracking parameter on links (`yt_c=<campaign>`); **first-touch** from UTM/referrer on first page view; report both, never sum them | C, E | L3 |
| Automation health | Per automation step: scheduled, sent, skipped (audience left), failed | automation | L2 |
| Audience size (live) | Count matching audience definition now vs. at send time | audience | L0 |

### 1.8 Exhibitors and sponsors (Enterprise module)

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Exhibitor readiness | Exhibitors with booth assigned, staff registered, profile complete, lead-retrieval activated | E | L2 |
| Leads captured | Lead scans; unique leads (dedup per exhibitor); leads per exhibitor; % exhibitors with 0 leads after day 1 | E, exhibitor | L1 |
| Sponsor deliverables % | Completed items ÷ items in the sponsor package checklist (logo placements, sponsored session, emails) | sponsor | L2 |
| Sponsor exposure | Impressions of sponsor placements (app views, email renders, sponsored-session attendance) | sponsor | L3 |

### 1.9 Readiness and alerts

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Readiness score | Weighted checklist per enabled module (tickets published, payment config verified, seat map published, custom domain verified, check-in devices registered ≥ N, staff assigned, comms scheduled, badge template set, sessions have rooms/capacity). Score = Σ weight(done) ÷ Σ weight; list blocking items. RainFocus surfaces "registration readiness" charts; we generalize to all modules | E | L2 |
| Open alerts | Count by severity; **MTTA** (time to acknowledge) for critical alerts on event day | E, O | L1 |

### 1.10 Cross-event and CRM (§11)

| Metric | Definition | Grain | Fresh |
|---|---|---|---|
| Lifetime value | Σ gross paid − refunds across all org events, per person | P, O | L3 |
| Events attended / registered | Distinct events with ≥1 check-in / with active ticket | P | L3 |
| Repeat attendance rate | Persons with ≥2 events attended ÷ persons with ≥1, per org and per rolling 24 months | O | L3 |
| Recency / frequency / monetary | RFM quintiles → segments (Champions, Loyal, At-risk, Lapsed) | P | L3 |
| Churn list | Attended an event in prior 12 months and not registered for any upcoming event | O | L3 |
| Engagement score | Weighted email/SMS/WhatsApp opens+clicks (90 d), app usage, survey responses, sessions attended | P | L3 |
| No-show propensity | Historical no-show rate per person (feeds overbooking and reminder targeting) | P | L3 |
| Cohort retention | By first-event year: % returning in each subsequent year | O | L3 |

## 2. Computation architecture

### 2.1 Load reality check

A 20k-attendee event with doors open ~90 min yields ~220 valid scans/min average; assuming 6–10 scans/min per staffed lane (UNVERIFIED industry benchmark; treat as planning assumption) that is 25–35 lanes and a peak around 5–7 scans/s with a 1.5× peak factor. Add duplicate/invalid scans, heartbeats every 30 s from ~40 devices, and dashboard viewers (10–200) refreshing. **Writes are trivial for Postgres; the risk is read fan-out of aggregate queries on hot tables and hot-row counter contention during on-sale spikes (hundreds of orders/s).** The design therefore separates (a) the write path, (b) a projector that maintains counters, and (c) heavy analytics.

### 2.2 Recommended tiering

**Tier 0 — Postgres 18 (released 2025-09-25) as system of record + `domain_events` fact table.**
Every state change (order.paid, ticket.issued, ticket.distributed, ticket.claimed, seat.assigned, rsvp.responded, scan.recorded, device.heartbeat, campaign.message.delivered, registration.confirmed, session.checked_in, lead.captured …) is inserted into `domain_events` in the **same transaction** as the state change (transactional outbox). Schema: `id uuidv7` (native in PG18), `org_id`, `event_id`, `aggregate_type`, `aggregate_id`, `event_type`, `version`, `occurred_at`, `recorded_at`, `actor_id`, `source` (web|mobile|scanner|import|webhook), `idempotency_key`, `payload jsonb`, monthly partitioned (pg_partman), indexed on `(org_id, event_id, id)` and `(event_type, id)`. This table is the backbone for: live projections, alerts, activity feed, audit log, webhooks, real-time push, the CRM timeline, and OLAP replication. **Do not** event-source aggregates (rebuilding tickets/orders from events); keep normal state tables and treat events as immutable facts ("event-carried facts, CRUD state"). SeatGeek went further, using `pg_logical_emit_message()` + Debezium to avoid outbox table contention; at Yayatoh's scale a table is simpler and queryable, and can migrate to WAL messages later.
Idempotency: offline scanners replay with `idempotency_key = device_id:local_seq`; a unique index makes replays no-ops, which is the only reliable defense against double-counted check-ins.

**Tier 1 — Projector → `metric_snapshots` and `metric_timeseries` (L1).** A single worker (pg-boss 12.34 or graphile-worker 0.18 on Postgres; or Inngest 4.21 if you want managed) tails `domain_events` by cursor in ~250 ms micro-batches and applies deltas to `metric_snapshots(org_id, event_id, metric_key, dims jsonb, value numeric, as_of)` and 1-minute buckets in `metric_timeseries`. Benefits over inline `UPDATE counters SET v=v+1`: no hot-row contention on the request path, exactly-once via cursor + batch transaction, one code path also emits real-time deltas and feeds the event-driven alert evaluator. Keep **two** inline exact counters only where the scanner UX needs them (`event.checked_in_count`, `session.checked_in_count`) using sharded counters (16 slots summed on read) to avoid contention.

**Tier 2 — Postgres materialized views and read replica (L2).** Dimensional breakdowns (by ticket type, promo, channel, section, day) as regular materialized views refreshed `CONCURRENTLY` every 1–5 min per *active* event by the scheduler, served from a read replica. `pg_ivm` 1.15 (PG13–19; immediate, same-transaction maintenance; supports count/sum/avg/min/max and equijoins; no window functions/HAVING/LIMIT) is viable for low-write tables (orders, seat assignments) but **not** for `scans` — its trigger overhead lands exactly on the burst path. TimescaleDB continuous aggregates with real-time aggregation (disabled by default since 2.13; Tiger Cloud from $30/mo "Performance", $36/mo "Scale") are the most elegant Postgres-native answer for throughput time series, but tie hosting to Tiger Cloud or self-managed Postgres; adopt only if the hosting decision lands there.

**Tier 3 — Columnar OLAP for behavioral, marketing and cross-event analytics (L3), added in Phase 3.** High-volume, non-transactional facts (page views, checkout funnel steps, email/SMS/WhatsApp provider events, seat-finder lookups, app analytics) should **never** be written to the transactional Postgres; send them directly to the OLAP store from day one.
- **Recommendation: ClickHouse** (26.8 LTS, 2026-08-27). Path A: **ClickHouse Cloud** with **ClickPipes Postgres CDC** (GA; $0.20/GB replicated, $0.10/GB initial load, compute $0.10/h Basic or $0.20/h Scale per service, billed since 2025-09-01) mirroring `domain_events`, orders, tickets, scans, persons; compute units $0.39/h in US (Enterprise list), $300 trial credits, scale-to-zero. Use `async_insert=1, wait_for_async_insert=1` (200 ms flush) for direct event ingestion and incremental materialized views (AggregatingMergeTree, `-State/-Merge`) for rollups; note IMVs see only the inserted block and ignore updates/deletes, so mutable dimensions are joined at query time. Client: `@clickhouse/client` 1.23.1. Path B: **Tinybird** (managed ClickHouse with parameterized SQL → HTTP endpoints; Free 0.25 vCPU/10 GB/1k req/day, Developer $49/mo, $0.058/GB storage; Events API NDJSON at 100 req/s per data source, 10 MB free / 100 MB paid payloads, `wait=true` for durable ack) — fastest time-to-API and ideal if the team has no ClickHouse ops appetite; SDK `@tinybirdco/sdk` is 0.0.84 (pre-1.0, UNVERIFIED stability). Row-level tenant filtering via scoped tokens is a known Tinybird feature (UNVERIFIED this session).
- Runner-ups: **MotherDuck/DuckDB** (DuckDB 1.5.5, 2026-07-22; Lite free 10 GB, Business $250/mo, Pulse $0.60/CU-h, $0.04/GB) — cheapest for batch reports, weaker for many-concurrent live dashboard queries; **pg_mooncake** (MIT, PG14–18, Iceberg columnstore + DuckDB, "sub-second freshness") — attractive Postgres-native design but pre-1.0; **pg_lake** (Crunchy/Snowflake, Apache-2.0, Nov 2025) — lakehouse on S3, not a serving layer; **pg_analytics** — archived March 2025, do not use.
- CDC alternatives if not on ClickHouse Cloud: **Sequin** (MIT, Docker, sinks to Kafka/SQS/Redis/webhooks, claims 50k ops/s) or `pg-logical-replication` 2.5.0 in Node; Debezium only if Kafka already exists.

**Metric service (the only reader).** A TypeScript package `@yayatoh/metrics` with a registry: `{key, definition, grain, freshness, tier, sql|projection, dims, format}`. API: `getMetric(ctx, key, {eventId, dims, range, bucket})` → `{value, series, as_of, freshness}`. It routes to Tier 1/2/3, enforces `org_id`, caches in Redis with tag invalidation from the projector, and is consumed by the web dashboard, the mobile API (`/v2/events/{id}/stats`), alerts, exports and the CRM. Postgres RLS remains the backstop.

### 2.3 Real-time transport requirements (owned by another researcher)

Per-event channel authorized by org membership/role; deltas (not snapshots) for `metric_snapshots` keys and the check-in feed; ≤2 s end-to-end at 10 events/s; ≤200 concurrent viewers per event; device presence/heartbeat every 30 s with server-side liveness; reconnect with cursor catch-up from `domain_events.id`; polling fallback at 5 s; payloads < 4 KB.

## 3. Alert rules engine

### 3.1 Model (borrowing Grafana's state machine and PagerDuty's ack semantics)

`alert_rules`: `id, org_id (null = system template), scope (org|event|session|entrance|device), module, metric_key or query_key, operator, threshold (absolute or % of capacity), window, evaluate: {schedule: '1m'|'30s'|'5m', on_events: [event_type…]}, pending_period ("for" — condition must hold before firing), keep_firing_for (avoid flapping), severity (info|warning|critical), cooldown/repeat_interval, active_modes [planning|pre_show|live|wrap], quiet_hours, routing {channels: [in_app, email, push, sms, webhook, slack], roles: [ops, owner…]}, auto_resolve bool`.
`alert_instances`: fingerprint = `rule_id + scope ids`; state ∈ Normal → Pending → Firing → (Acknowledged) → (Snoozed until T) → Resolved; plus NoData/Error when evaluation fails (surface to Yayatoh ops, not the organizer). Acknowledge stops notifications but keeps the instance visible; an **ack timeout** (default 60 min; 10 min in live mode for critical) re-triggers escalation, as PagerDuty does. Snooze = suppress notifications until T; on expiry re-evaluate and re-notify only if still firing. Auto-resolve when condition clears for `keep_firing_for`. Notification grouping per Grafana defaults (group_wait 30 s, group_interval 5 min, repeat 4 h) for email digests; in-app and push get individual deltas.

### 3.2 Evaluation

Two evaluators share one rule store: (a) **scheduled** — per active event, every 5 min in planning, 1 min in pre_show, 15–30 s in live mode (Inngest cron with `TZ=` prefix and fan-out per event, or pg-boss cron), reading Tier 1/2 metrics; (b) **event-driven** — the projector emits `metric.changed` for keys any rule references, and device/scan events trigger instant rules. Thresholds are data, not code; the first release needs **no generic rules engine**. For organizer-authored composite rules later, prefer **GoRules Zen** (`@gorules/zen-engine` 2.0.2, Aug 2026, MIT, Rust core, JDM decision tables with an embeddable React editor) over **json-rules-engine** (7.3.1, last release Feb 2025, ISC, 17 kB) — Zen gives a visual editor; json-rules-engine wins only for a tiny internal-only rule set.

### 3.3 Rule catalog (defaults; organizers may tune thresholds)

| # | Rule | Condition | Eval | Sev | Route | Auto-resolve |
|---|---|---|---|---|---|---|
| 1 | Attendees without seats | `attendees_without_seat > 0` and event ≤ 7 d away (warning), ≤ 24 h (critical) | 5 m | W/C | seating coord, ops | yes |
| 2 | Tickets not distributed | `tickets_undistributed ≥ 10` or ≥ 5 % of sold, ≤ 3 d away | 5 m | W | owner, marketing (offer reminder campaign) | yes |
| 3 | RSVP pending | `rsvp_pending > 0` at RSVP deadline − 7 d / − 1 d | 1 h | I/W | owner | yes |
| 4 | Failed payments spike | `payments_failed_24h ≥ 5` or failure rate ≥ 5 % of attempts (1 h) | on event + 5 m | W/C | finance | yes |
| 5 | Stuck payments | orders `pending > 15 min ≥ 3` | 5 m | W | finance | yes |
| 6 | Refund surge | refunds (24 h) ≥ 3× 7-day daily mean and ≥ 5 | 1 h | W | owner, finance | yes |
| 7 | Session near capacity | `session_fill ≥ 95 %` (info at 80 %) | on event | I/W | ops, content lead | yes (if capacity raised) |
| 8 | Session over-registered | registrations > capacity | on event | C | ops | yes |
| 9 | Room without session / session without room | readiness check | 1 h | W | content lead | yes |
| 10 | Devices offline | `devices_offline ≥ 1` (warning), ≥ 3 or ≥ 25 % of registered (critical), live mode only, pending 90 s | on heartbeat + 30 s | W/C | ops, door lead (push+SMS) | yes |
| 11 | Device low battery | battery ≤ 15 % | on heartbeat | W | ops | yes |
| 12 | Offline queue growing | device queue depth ≥ 50 or age ≥ 10 min | on heartbeat | W | ops | yes |
| 13 | Entrance stalled | entrance throughput = 0 for 5 min while others > 0, live | 30 s | W | ops | yes |
| 14 | Entrance congested | 5-min throughput ≥ 90 % of observed max for 10 min and ETA > 30 min after doors | 30 s | W | ops | yes |
| 15 | Duplicate scan burst | duplicates ≥ 10 in 5 min, or one ticket ≥ 3 duplicates / ≥ 2 devices | on scan | W/C | door lead, fraud queue | manual |
| 16 | Invalid scan burst | invalid ≥ 5 % of scans over 5 min (≥ 20 scans) | 30 s | W | ops | yes |
| 17 | Assistance queue aging | open requests ≥ 5 or oldest ≥ 10 min | on event | W | ops | yes |
| 18 | Venue/section capacity | checked-in ≥ 95 % of capacity (C at 100 %) | on scan | W/C | ops, owner | manual |
| 19 | Sell-out approaching | sell-through ≥ 90 % | 5 m | I | owner, marketing | n/a |
| 20 | Pace behind | sold vs. comparable-event pace ≤ 70 % at same days-to-event | daily | W | owner, marketing | yes |
| 21 | Low check-in rate | 60 min after doors: attendance % < 50 % of prior comparable | 5 m live | I | owner | n/a |
| 22 | Campaign deliverability | bounce ≥ 5 % or complaints ≥ 0.3 % of a send | on provider event | W/C | marketing | manual |
| 23 | Automation failing | step failures ≥ 10 % in 1 h | 15 m | W | marketing | yes |
| 24 | Exhibitor with zero leads | after day 1, leads = 0 | daily | I | exhibitor mgr | yes |
| 25 | Readiness blockers | any blocking checklist item at T-7 d / T-24 h | 1 h | W/C | owner | yes |
| 26 | Approval backlog | pending approvals > 48 h ≥ 5 | 1 h | W | registration lead | yes |
| 27 | Custom domain/SSL | domain verification failed or cert expiring ≤ 7 d | daily | C | owner + Yayatoh ops | yes |
| 28 | Data freshness | projector lag > 10 s or MV refresh failed | 30 s | C (internal) | Yayatoh ops | yes |

## 4. Event-day operational mode

**Mode derivation:** `planning` (> 24 h before first session/doors) → `pre_show` (T-24 h) → `live` (doors − 2 h … end + 2 h, per event day, venue timezone) → `wrap` (until +7 d). Manual override and "preview live mode" toggle. Multi-day events switch per day; sessions inherit. Mode drives evaluator cadence, default layout, and notification urgency.

**Live layout (ops role, default):**
1. Header strip: checked in / expected (%), throughput now (scans/min) with ETA to completion, open critical alerts, devices online/total, mode badge.
2. Live check-in feed: last 50 scans (name, ticket type, entrance, device, result badge, latency), filter by result, pause/resume.
3. Throughput per entrance: 60×1-min stacked bars + per-entrance current rate; click → device breakdown.
4. Duplicate/invalid monitor: counts by reason (5 min / total), list of tickets with repeated attempts, one-click "flag fraud" / "allow once".
5. Device board: name, entrance, status, last heartbeat, battery, app version, queue depth, scans/min; "ping device" and "reassign entrance".
6. Capacity gauges: venue, each section/room, each running session (registered vs. checked-in vs. capacity).
7. Guest assistance queue: requests from scanner app and seat-finder kiosks (not found, name mismatch, seat conflict, VIP escort) with claim/resolve and age timer.
8. Seating live: unseated checked-in guests (walk-ins), table fill.
9. Staff on shift and entrance assignments.
Offline semantics: replayed scans carry `scanned_at`; the projector re-buckets and the UI shows "N late-arriving scans applied"; counters never regress.

## 5. Role-based composition and event-type widgets

**Mechanism:** a widget registry (`id, module, roles, eventTypes, modes, minSize, dataKeys`) + layouts stored as JSON (`dashboard_layouts(org_id, event_id?, role, mode, user_id?, layout)`), rendered with `react-grid-layout` 2.2.4 (runner-up gridstack 14.0.0, framework-agnostic). Resolution order: user override → org role default → event-type template → system template. Widgets outside the enabled modules never mount (vision §12).

| Role | Default widgets (planning) | Live-mode additions |
|---|---|---|
| Owner/Admin | Revenue, sales & pace, registrations, readiness score, alerts, marketing attribution summary, seating completion, distribution/claims, top campaigns | Checked-in %, capacity gauges, critical alerts |
| Finance | Gross/net/refunds/fees, failed & stuck payments, payout position, refunds by reason, orders table, exports | Box-office sales today |
| Marketing | Funnel (visits→checkout→orders), channel/promo mix, campaign table (delivered/open/click/attributed), audiences, automation health, churn list size | Not-checked-in audience (for "we saved you a seat" SMS) |
| Operations / Event manager | Readiness checklist, seating, distribution, device registration, staffing, sessions/rooms, alerts | Full §4 live layout |
| Door staff (scanner app + web) | Their entrance: checked-in count, throughput, their device status, assistance requests assigned | same |
| Seating coordinator | Unseated list, tables over/under, groups split, VIP placement, seat-finder failed lookups | Walk-ins unseated |
| Registration/content lead (conference) | Registrations by type, approval backlog, session fill %, speaker readiness, badge print status | Session check-in live |
| Exhibitor manager | Exhibitor readiness, leads by exhibitor, zero-lead list, sponsor deliverables | Lead capture live |
| Exhibitor/Sponsor portal user | Own leads, booth staff, own sponsored-session attendance, deliverables | Own leads live |
| Agency (multi-client) | Portfolio table: per client/event revenue, sold %, readiness, alerts; cross-client calendar | Live events list |

| Event type | Navigation (vision §12) | Signature widgets |
|---|---|---|
| Wedding / gala / banquet | Guests, RSVP, Seating, Seat Finder, Gallery | RSVP funnel & pending list, headcount incl. plus-ones, seating completion, tables map mini-view, seat-finder activity, dietary/meal counts, gift/donation total (gala) |
| Concert / festival | Tickets, Marketing, Check-In, Sales | Sales pace vs. last show, sell-out ETA, tier mix, promo performance, entrance throughput, fraud monitor, refunds |
| Conference / trade show | Registration, Sessions, Speakers, Exhibitors, Sponsors, Badges, Check-In, Analytics | Registration funnel by type, session fill heatmap (rooms × time slots), speaker readiness, exhibitor leads leaderboard, sponsor deliverables, badge print status, session attendance vs. registered |
| Agency | Clients, Events, Marketing, Reports | Portfolio grid, cross-client benchmarks, scheduled reports |

## 6. Reporting, exports and BI

**Exports.** Run every export as a background job (Inngest 4.21 — Free 50k executions, Pro $99/mo; or Trigger.dev 4.6.4 — Apache-2.0, Pro $50/mo, 1000+ schedules; or pg-boss if staying Postgres-only) writing to S3/R2 with a signed URL and an `exports` row for history. Rationale: Vercel functions default to 300 s (800 s max, 1800 s beta) with a 4.5 MB response body cap, so streaming a 50k-row XLSX from a request handler is fragile. Libraries: CSV — `@json2csv/plainjs` 7.0.8 or `fast-csv` 5.0.7 (streamed from a Postgres cursor); XLSX — ExcelJS 4.4.0 streaming `WorkbookWriter` (last release Dec 2024, maintenance is slow) with `write-excel-file` 4.1.1 as lighter runner-up (SheetJS CE on npm is stuck at 0.18.5 — avoid); PDF — `@react-pdf/renderer` 4.9.0 for tabular reports, badges and finance statements (fast, no browser), and headless Chromium (`puppeteer-core` 25.12 + `@sparticuz/chromium` 153, >50 MB but inside the 250 MB bundle limit) only for pixel-perfect dashboard snapshots. Embed Noto fonts for the 12 UI locales (Arabic RTL, CJK, Devanagari) in PDF templates.

**Scheduled reports & saved views.** `saved_views(org_id, user_id?, entity, filters, columns, sort, group_by, shared)` power tables (TanStack Table 9.2.4 + `@tanstack/react-virtual` 3.14 for 100k-row attendee lists; AG Grid Community 36.2 if pivoting is needed). `report_schedules(saved_view_id, cron, tz, format, recipients, last_run)` executed via the scheduler's fan-out pattern with jitter; standard packs: daily sales digest, post-event summary (T+1), finance statement (monthly), exhibitor lead export (end of day).

**Embedded BI vs. custom charts.**
- Product dashboards: **custom charts**. Recharts 3.10.1 (MIT; 3.x rewrite shipped mid-2025 — exact date UNVERIFIED because scraped release dates were inconsistent; accessibility layer on by default, portal tooltips, React 19) via shadcn/ui chart primitives for the 90 % standard case; **Apache ECharts 6.1.0** (Apache-2.0; 6.0 on 2025-07-30 added matrix coordinate, SSR/hydration, new theme) for canvas-heavy views: session fill heatmaps, 1-min throughput over multi-day events, floor-plan heat overlays. Runner-ups: visx 4.0.0 (MIT, June 2026) when a bespoke D3-grade visual is needed; Tremor (`@tremor/react` 3.18.7, Jan 2025) has gone quiet as a package — skip.
- Self-serve "Explore/report builder" (Phase 3+): **Cube Core** (Apache-2.0 backend/MIT client, self-hosted; semantic layer with REST/GraphQL/SQL; multi-tenancy via `securityContext` + `queryRewrite` row filters, `contextToAppId`, `driverFactory`, `contextToOrchestratorId`, `preAggregationsSchema`; each app id costs single-to-dozens of MB compile cache, so bucket small tenants) mounted on Postgres now and ClickHouse later. Cube Cloud Premium ($80/dev/mo) adds hosted embedded dashboards if you would rather not build the explorer.
- **Metabase** (Pro $575/mo + $12/user beyond 10; Modular Embedding SDK 0.63.1 requires Pro/Enterprise, Metabase ≥1.52, React 18/19, Node 20+, one dashboard per page, **no SSR**): fine for Yayatoh's internal staff analytics on the open-source edition, not for white-labeled customer embedding — the per-viewer economics and SSR gap conflict with a Next.js white-label product.
- **Evidence** (Team $2,500/mo; embedding and white-label Enterprise-only): out.

## 7. Cross-event org analytics and attendee CRM analytics

Identity: org-scoped `persons` with merge rules (verified email > phone > name+DOB), consent flags, and a `person_events` timeline built from `domain_events`. Nightly (or hourly for large orgs) OLAP job writes `person_stats(person_id, ltv, events_attended, events_registered, first_event_at, last_event_at, no_show_rate, rfm_r, rfm_f, rfm_m, segment, engagement_score, channel_pref)`; `org_stats` gets cohort retention, repeat rate, revenue by event type/year, and comparable-event pace curves used by the sales-pace metric and alert #20. These tables feed the CRM profile page, the audience builder (§8 examples: "VIPs without seats", "attended last year, not registered", "registered, not checked in") and, with anonymization and opt-in, cross-org benchmarks (RainFocus sells "benchmarks from 1,000+ events" — a later differentiator, only with explicit org consent). Deletion/anonymization requests must propagate to OLAP (ClickHouse lightweight deletes) and exports.

## 8. Phasing

- **Phase 1 (parity + command center v1):** Postgres 18, `domain_events`, projector, `metric_snapshots`/`metric_timeseries`, metric registry, live check-in widgets, alert rules 1–5, 7, 10–18, 25, 27–28, CSV/XLSX exports, role layouts for owner/ops/door.
- **Phase 2:** materialized breakdowns, marketing metrics and attribution, readiness score, scheduled reports, PDF, remaining alerts, wedding/conference widget packs.
- **Phase 3:** ClickHouse/Tinybird for behavioral + marketing + cross-event; CRM stats; Cube-based explorer; organizer-authored rules (Zen); benchmarks.


## Key recommendations

- Build one metric registry package (@yayatoh/metrics) with formal definitions, grain and freshness class (L0 exact, L1 ≤2 s, L2 ≤5 min, L3 batch); every surface (web, mobile API, alerts, exports, CRM) reads through it, and every tile shows as_of.
- Use Postgres 18 as system of record with a transactional-outbox `domain_events` fact table (uuidv7 ids, org_id/event_id, monthly partitions, idempotency_key) as the analytics/alerts/feed/webhook backbone; do NOT event-source aggregates.
- Maintain live counters with a cursor-based projector into `metric_snapshots` and 1-minute `metric_timeseries` (not inline hot-row UPDATEs); keep only two inline sharded counters (event/session checked_in_count) for scanner UX.
- Serve dimensional breakdowns from concurrently-refreshed Postgres materialized views on a read replica; avoid pg_ivm on the scans table; adopt TimescaleDB continuous aggregates only if hosting lands on Tiger Cloud/self-managed.
- Send behavioral and marketing provider events (page views, funnel steps, email/SMS/WhatsApp webhooks) straight to a ClickHouse-family OLAP store from day one; in Phase 3 add ClickHouse Cloud + ClickPipes Postgres CDC ($0.20/GB CDC) or Tinybird (Developer $49/mo) for cross-event, attribution and CRM analytics.
- Implement alerts as data-driven threshold rules with a Grafana-style state machine (Pending → Firing → Acknowledged/Snoozed → Resolved, keep_firing_for, ack timeout re-escalation) evaluated by a scheduled evaluator (cadence by event mode) plus an event-driven evaluator fed by the projector; ship the 28-rule catalog; defer generic rule engines (GoRules Zen) to organizer-authored rules.
- Derive event mode automatically (planning → pre_show at T-24h → live from doors−2h to end+2h per day in venue TZ → wrap) to switch layouts, evaluator cadence and notification urgency; bucket throughput by device `scanned_at` so offline replays land correctly and use idempotency keys (device_id:local_seq) to prevent double counts.
- Compose dashboards from a widget registry gated by module, role, event type and mode, with JSON layouts (react-grid-layout 2.2.4) resolved user → org-role → event-type template → system default.
- Build charts in-house: Recharts 3.10.1 via shadcn/ui for standard tiles, Apache ECharts 6.1.0 for canvas-heavy heatmaps/time series; use Cube Core (Apache-2.0, self-hosted, securityContext/queryRewrite tenancy) later for a self-serve explorer; keep Metabase (open source) for internal staff only and skip Evidence.
- Run all exports and scheduled reports as background jobs (Inngest/Trigger.dev/pg-boss) writing to object storage with signed URLs; CSV via @json2csv/plainjs or fast-csv streamed from cursors, XLSX via ExcelJS streaming writer, PDF via @react-pdf/renderer (badges, statements) with Chromium only for dashboard snapshots; embed Noto fonts for the 12 locales.
- Define attribution explicitly: last-touch 7-day click window on Yayatoh's own link parameter plus first-touch UTM/referrer, reported separately and never summed; treat email opens as directional due to Apple MPP.
- Compute CRM analytics (LTV, repeat rate, RFM, churn list, no-show propensity, cohort retention) nightly into person_stats/org_stats and expose them to the audience builder; propagate deletion requests to OLAP and exports.


## Data model implications

- domain_events (id uuidv7, org_id, event_id, aggregate_type, aggregate_id, event_type, version, occurred_at, recorded_at, actor_id, source, idempotency_key unique, payload jsonb) partitioned monthly; consumed by projector, alerts, feed, webhooks, OLAP CDC.
- metric_snapshots (org_id, event_id, metric_key, dims jsonb, value numeric, as_of) and metric_timeseries (org_id, event_id, metric_key, dims, bucket_start, value) maintained by the projector; projector_cursors table.
- Sharded inline counters for event.checked_in_count and session.checked_in_count (16 slots).
- scans as an immutable log (ticket_id, device_id, entrance_id, session_id?, result enum {valid, duplicate, not_found, refunded, voided, wrong_event, wrong_day, wrong_entrance, signature_invalid, expired, manual_override}, scanned_at, received_at, local_seq) separate from check_ins (current state per ticket/scope).
- devices (org_id, event_id, name, entrance_id, last_heartbeat_at, battery_pct, app_version, offline_queue_depth, status derived) and device_heartbeats time series.
- entrances/sections/rooms with capacity; sessions with capacity, room_id, registered_count, checked_in_count.
- Ticket lifecycle fields: distributed_to_person_id, distributed_at, claimed_at, claim_status; orders with payment_attempt history and latest_payment_status; refunds and disputes as first-class rows with Stripe balance_transaction ids and reporting_category.
- Seat assignments keyed by (event_id, seat_id) → ticket_id/guest_id; guest_groups; rsvp_responses with plus_one counts; ticket_type.requires_seat flag.
- assistance_requests (event_id, source scanner|kiosk, reason, ticket_id?, guest_id?, status, claimed_by, created_at, resolved_at).
- alert_rules (system templates + org overrides: scope, module, metric_key/query_key, operator, threshold, window, schedule, on_events, pending_period, keep_firing_for, severity, cooldown, active_modes, quiet_hours, routing) and alert_instances (fingerprint, state, fired_at, acknowledged_by/at, snoozed_until, resolved_at, last_notified_at) plus alert_notifications log.
- event_modes: derived mode per event day (planning, pre_show, live, wrap) with manual override and venue timezone.
- readiness_checklist_items (event_id, module, key, weight, blocking, done_at) and readiness_score snapshot.
- dashboard_layouts (org_id, event_id?, role, mode, user_id?, layout json); widget registry in code.
- saved_views (org_id, user_id?, entity, filters, columns, sort, group_by, shared), report_schedules (saved_view_id, cron, tz, format, recipients), exports (status, file_url, row_count, requested_by, expires_at).
- persons (org-scoped identity with merge rules and consent), person_events timeline, person_stats (ltv, events_attended, rfm, segment, engagement_score, no_show_rate), org_stats (cohort retention, comparable-event pace curves).
- campaign_messages and campaign_events (provider webhook events: sent, delivered, bounced, opened, clicked, unsubscribed, complained, read) plus attribution_touches (person_id, event_id, touch_type first|last, campaign_id, utm fields, touched_at) linked to orders.
- exhibitor_leads (exhibitor_id, person_id, captured_by_user, captured_at, qualification jsonb), sponsor_deliverables checklist.
- Every analytics table carries org_id first in indexes/ORDER BY; Postgres RLS policies and OLAP row policies enforce tenant scope.


## Risks

- Definition drift between live counters, materialized views and OLAP (e.g., different denominators for attendance %) if the metric registry is bypassed.
- Hot-row contention or lock waits if counters are updated inline during on-sale spikes; projector lag during check-in bursts if micro-batches are too small or the worker is single-threaded per org.
- Double-counted check-ins from offline scanner replays without a unique idempotency key; counters that regress when late scans are re-bucketed.
- Alert fatigue: too many warnings on event day, no grouping or ack timeout, leading staff to ignore critical alerts.
- Attribution disputes and inflated email open rates (Apple Mail Privacy Protection); marketing revenue claims that do not reconcile with finance.
- Vercel function limits (300 s default, 4.5 MB body) breaking large exports/PDFs if run in request handlers.
- OLAP cost and complexity creep (ClickHouse Cloud CDC compute per service, Tinybird overages) if adopted before Postgres capacity is actually exhausted.
- Multi-tenant data leakage in embedded BI tools (Metabase sandboxes/Cube security context misconfiguration) or in cross-org benchmarks.
- Extension lock-in and hosting constraints: pg_ivm trigger overhead on hot tables, TimescaleDB availability on managed Postgres providers, pre-1.0 maturity of pg_mooncake and the Tinybird SDK.
- PII in OLAP stores and exports complicates GDPR/CCPA deletion; deletions must propagate to ClickHouse and stored export files.
- Timezone/DST errors in event-mode switching and scheduled reports for multi-day, multi-venue events.
- Chart performance: Recharts (SVG) degrades beyond a few thousand points; heavy views must use canvas (ECharts).
- Library maintenance risk: ExcelJS last release Dec 2024, json-rules-engine Feb 2025, @tremor/react Jan 2025.


## Open questions

- Who is the merchant of record today (Yayatoh via Stripe Connect vs. each organizer's own Stripe account), and what fee lines must 'net revenue' show to match the current Laravel finance reports?
- Does the current mobile scanner app already queue scans offline with a local sequence and timestamp, and does it send device heartbeats/battery? If not, is changing the app in scope for the API migration?
- Which roles exist in the current Laravel team management, and which of the proposed roles (finance, marketing, seating coordinator, door staff, agency) should exist at launch?
- What is the realistic scale target for the next 24 months (events/year, max attendees per event, number of orgs), and is there budget appetite for a managed OLAP store (ClickHouse Cloud/Tinybird) versus staying Postgres-only longer?
- Where will the platform be hosted (Vercel + managed Postgres, or containers)? This decides TimescaleDB feasibility and whether long-running exports need a separate worker tier.
- Should organizers be able to author custom alert rules and thresholds in v1, or are system templates with editable thresholds sufficient?
- Is session attendance tracked with in-scans only or in/out scans (dwell time)? Are badges scanned at session doors today?
- Do multi-day events sell per-day tickets, and should 'attendance %' be computed per day, per event, or both?
- Will marketing spend (ads, paid promotion) be entered into Yayatoh to compute CPA/ROI, or is attribution limited to owned channels?
- Are cross-organization anonymized benchmarks desirable and legally acceptable under the white-label contracts, and what consent language would be required?
- What data retention and deletion obligations apply (GDPR/CCPA requests from attendees) and must they propagate to analytics copies and stored exports?
- Which languages/locales must scheduled PDF reports support at launch (all 12 UI languages, including RTL Arabic and CJK), since that drives font embedding and template design?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx (sections 7, 8, 9, 10, 11, 12, 13)
- https://clickhouse.com/pricing (ClickHouse Cloud tiers, compute-unit and storage pricing, $300 trial credits)
- https://clickhouse.com/docs/cloud/reference/billing/clickpipes/postgres-cdc (Postgres CDC ClickPipes: $0.10/GB initial, $0.20/GB CDC, $0.10–0.20/h compute)
- https://clickhouse.com/blog/postgres-cdc-connector-clickpipes-ga (Postgres CDC GA; metered since 2025-09-01)
- https://clickhouse.com/docs/whats-new/changelog (ClickHouse 26.8 LTS, 2026-08-27)
- https://clickhouse.com/docs/materialized-view/incremental-materialized-view (incremental MV semantics and caveats)
- https://clickhouse.com/docs/optimize/asynchronous-inserts (async_insert settings, 200 ms busy timeout, wait_for_async_insert)
- https://www.tinybird.co/pricing (Free/Developer $49/SaaS/Enterprise; $0.058/GB storage)
- https://www.tinybird.co/docs/forward/get-data-in/events-api (NDJSON, 100 req/s per data source, 10/100 MB payloads, wait=true)
- https://motherduck.com/pricing/ (Lite free, Business $250/mo, Pulse $0.60/CU-h, $0.04/GB)
- https://github.com/duckdb/duckdb/releases (DuckDB v1.5.5, 2026-07-22)
- https://www.tigerdata.com/pricing (Tiger Cloud Performance $30/mo, Scale $36/mo)
- https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/real-time-aggregates (real-time aggregates disabled by default since 2.13)
- https://github.com/sraoss/pg_ivm (pg_ivm 1.15, PG13–19, supported/unsupported constructs, immediate maintenance)
- https://www.postgresql.org/about/news/pg_ivm-114-released-3265 (pg_ivm 1.14, 2026-04-01)
- https://www.postgresql.org/about/news/postgresql-18-released-3142/ (PostgreSQL 18, 2025-09-25, uuidv7, AIO)
- https://github.com/paradedb/pg_analytics (archived March 2025)
- https://github.com/Mooncake-Labs/pg_mooncake (MIT, PG14–18, Iceberg columnstore + DuckDB)
- https://datalakehousehub.com/blog/postgres-meets-the-lakehouse/ (pg_lake open-sourced Nov 2025, Apache-2.0)
- https://github.com/sequinstream/sequin (MIT Postgres CDC, sinks, throughput claims)
- https://chairnerd.seatgeek.com/transactional-outbox-pattern/ (pg_logical_emit_message + Debezium outbox at SeatGeek)
- https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/ (Normal/Pending/Alerting/Recovering/NoData/Error, pending period, keep firing for)
- https://grafana.com/docs/grafana/latest/alerting/fundamentals/notifications/group-alert-notifications/ (group_wait 30 s, group_interval 5 m, repeat_interval 4 h)
- https://grafana.com/docs/grafana/latest/alerting/configure-notifications/mute-timings/ and create-silence/ (silences vs mute timings)
- https://support.pagerduty.com/main/docs/incidents (Triggered/Acknowledged/Resolved, acknowledgement timeout re-escalation, priority vs urgency)
- https://github.com/CacheControl/json-rules-engine (rule format; npm 7.3.1, 2025-02-20, ISC)
- https://github.com/gorules/zen (Zen Engine 2.0, JDM, MIT; npm @gorules/zen-engine 2.0.2, 2026-08-24)
- https://www.inngest.com/pricing and https://www.inngest.com/docs/guides/scheduled-functions (tiers, executions, TZ cron, fan-out, jitter)
- https://trigger.dev/pricing (Free/Hobby $10/Pro $50, schedules per tier, Apache-2.0, v4.6.4)
- https://vercel.com/docs/functions/limitations (300 s default / 800 s max / 1800 s beta, 250 MB bundle, 4.5 MB body, 4 GB memory)
- https://www.metabase.com/pricing/ (Open Source, Starter, Pro $575/mo + $12/user, Enterprise from $20k/yr)
- https://www.metabase.com/docs/latest/embedding/sdk/introduction (SDK requires Pro/Enterprise, Metabase ≥1.52, React 18/19, no SSR, one dashboard per page)
- https://cube.dev/pricing (Cube Cloud Free/Starter $40/Premium $80 per developer; embedded dashboards on Premium)
- https://github.com/cube-js/cube (Cube Core Apache-2.0 backend / MIT client, self-hosted)
- https://docs.cube.dev/embedding/multitenancy (securityContext, queryRewrite, contextToAppId, driverFactory, contextToOrchestratorId, preAggregationsSchema, compile-cache cost per app id)
- https://evidence.dev/ and https://evidence.dev/pricing (Team $2,500/mo; embedding/white-label Enterprise-only)
- https://echarts.apache.org/en/changelog.html (ECharts 6.0, 2025-07-30: matrix coordinate, SSR, new theme)
- https://github.com/recharts/recharts/releases and /releases/tag/v3.0.0 (3.x rewrite features; release dates inconsistent in scrape — UNVERIFIED)
- https://www.rainfocus.com/data-driven-insights/ and https://www.rainfocus.com/platform/performance-strategy/ (registration readiness charts, Core Dashboards, benchmarks from 1,000+ events)
- https://www.cvent.com/en/event-marketing-management/onsite-solutions (real-time check-in counts, session tracking and duration, exhibit floor traffic)
- https://www.bizzabo.com/event-management-software/onsite-event-management-software and /event-data-analytics (Onsite Command App, real-time dashboards, heatmaps)
- https://www.eventbrite.com/help/en-us/articles/237711/how-to-use-the-analytics-tool/ and /840658/view-your-traffic-and-conversion-report/ (sales/attendee reports, last-touch channel attribution, page visits → orders → tickets)
- https://docs.stripe.com/reports/reporting-categories (charge, refund, fee, dispute, platform_earning categories)
- npm registry via `npm view` on 2026-09-26: recharts 3.10.1, echarts 6.1.0, @visx/visx 4.0.0, json-rules-engine 7.3.1, exceljs 4.4.0, @react-pdf/renderer 4.9.0, pg-boss 12.34.0, graphile-worker 0.18.0, bullmq 6.3.9, @evidence-dev/evidence 40.1.8, @cubejs-backend/server-core 1.7.46, @metabase/embedding-sdk-react 0.63.1, @gorules/zen-engine 2.0.2, @tremor/react 3.18.7, @sparticuz/chromium 153.0.0, puppeteer-core 25.12.0, inngest 4.21.0, @trigger.dev/sdk 4.6.4, @clickhouse/client 1.23.1, @tinybirdco/sdk 0.0.84, @duckdb/node-api 1.5.5-r.5, pg-logical-replication 2.5.0, @tanstack/react-table 9.2.4, @tanstack/react-virtual 3.14.13, react-grid-layout 2.2.4, gridstack 14.0.0, ag-grid-react 36.2.0, @mui/x-data-grid 9.14.0, @json2csv/plainjs 7.0.8, fast-csv 5.0.7, papaparse 5.7.0, write-excel-file 4.1.1, xlsx 0.18.5, pdfmake 0.3.11
