# Spec: M6.2 — Analytics platform

- **Milestone:** M6.2 (roadmap Phase 6; plan `docs/plans/phase-6.md` Wave 2)
- **Status:** Approved (owner, 2026-10-02: Phase 6 plan, decisions P6-1…P6-13)
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** 0008 (outbox, relay, pg-boss; projections accept `replayed` events)

Delivered in increments: **M6.2a** warehouse and cross-event dashboards (this section), **M6.2b**
attribution, the curated explorer, organizer alert rules and scheduled PDF reports.

## M6.2a — Warehouse (built)

### 1. Goal and users
Organizers with many events need one place for the shape of their business: registrations,
tickets, check-ins, no-shows and revenue across every event, by day, week or month in their own
time zone. The M3.1a sink and projections are per event; M6.2a puts an `AnalyticsWarehouse` port in
front of them (P6-2) with a Postgres adapter (default) and a Tinybird adapter (managed ClickHouse,
switched on per deployment when volume needs it), fed from the outbox, rebuildable from the source
tables, and read by the org dashboards. Users: owners, admins and finance (with money); managers,
box office and viewers (counts only).

### 2. References
- **Plan:** `docs/plans/phase-6.md` row M6.2a and P6-2 ("`AnalyticsWarehouse` port in front of
  today's M3.1a sink … Postgres rollups (default) and Tinybird … every row carries `org_id`, and
  queries go through per-org tokens/row filters (an isolation test proves it)"), P6-13 (entitlement
  key `analytics_pro`, free in beta), P6-1 (behind flags, fakes for third parties).
- **Builds on:** M3.1a (metric registry definitions, the outbox `replayed` flag, `unpublishedPendingTx`),
  M1.12 (org report: the source totals the dashboards are compared with).

### 3. Scope
**In**
- `@yayatoh/analytics` (tier 6): the port, the Postgres adapter (`analytics.daily_rollups`,
  `analytics.event_rollups`), the Tinybird adapter (Events API appends + pipe reads with per-org
  JWTs) and `fakeTinybird()` (dev/CI; records calls, serves fixture rows, refuses unscoped reads).
  `ANALYTICS_WAREHOUSE=postgres|tinybird`, Postgres when unset.
- Ingest: the `analytics.warehouse` outbox subscriber with versioned payload schemas per
  `type@version`; idempotent by source event id (`analytics.ingest_log`) and by content
  (`analytics.event_sync` hash per adapter and event).
- Backfill: `analytics.startBackfill` (owners/admins, audited), the pg-boss job `analytics.backfill`
  (exclusive per run; leader tick every 5 s), keyset pages with a saved cursor (resumable), paced
  by `pages_per_minute` (rate limit); dev route `POST /api/dev/analytics/backfill`.
- Org dashboards at `/o/{org}/analytics` (nav "Analytics", module `analytics_pro`, `orders:read`):
  date range and event filters, Day/Week/Month switch, figure tiles, a line chart with its data
  table, the per-period table, top events; revenue tiles, per-period revenue and top events by
  revenue only for `finance:read`; the rebuild card for `org:update`; empty state; range errors.
- Narrow reads added to lower tiers: orders `dailySalesFactsTx`, `dailyRefundFactsTx`; checkin
  `dailyCheckinFactsTx` (counts and sums per day in a time zone; no rows).

**Out (Later / not yet)**
- Attribution, explorer, alert rules, scheduled PDF reports: M6.2b.
- Physical (declarative) partitioning of `daily_rollups`: deferred (owner inbox); the rollups are
  partitioned logically by org and day and replaced per event.
- A real Tinybird workspace: owner account (owner inbox); dev/CI only ever use the fake.
- An org time-zone change does not rebuild by itself: run a rebuild (the hash includes the zone, so
  the rebuild rewrites every event).
- `/v1` routes for the dashboards; agency roll-ups across client orgs (M6.7).
- The M3.1a `reports.analytics_events` sink stays as is (product events); the warehouse reads the
  source tables, not that sink, so its figures equal the reports to the cent.

### 4. `touches:`
```yaml
touches:
  - packages/modules/analytics/**                 # new module (tier 6) + tinybird/ contract files
  - packages/modules/orders/src/{daily-facts,index}.ts
  - packages/modules/checkin/src/{daily-facts,index}.ts
  - packages/platform/src/modules.ts              # MODULE_KEYS += analytics_pro
  - packages/db/drizzle/0107_needy_stryfe.sql (+ meta)
  - packages/testing/src/{fixtures,warehouse,index}.ts, src/canary/registry.ts, package.json
  - packages/testing/tests/warehouse.int.test.ts
  - apps/worker/src/{warehouse,registry,main}.ts, tests/warehouse.int.test.ts, package.json
  - apps/web/src/app/[locale]/o/[org]/(org)/analytics/{page,actions}.tsx|ts
  - apps/web/src/app/[locale]/o/[org]/(org)/layout.tsx   # one nav item
  - apps/web/src/app/api/dev/analytics/backfill/route.ts
  - apps/web/src/components/org-analytics{,-rebuild}.tsx
  - apps/web/messages/*.json (nav.orgAnalytics, warehouse.*), apps/web/scripts/seed.ts
  - apps/web/e2e/warehouse.spec.ts, .env.example, docs/owner-inbox.md
```

### 5. Data model
| Table | Notes |
|---|---|
| `analytics.daily_rollups` | (org, event, day, metric, currency) unique; value bigint; metrics `orders`, `tickets`, `comp_tickets`, `refunded_tickets`, `checkins`, `gross`, `refunds`; `(org_id, day, metric)` index |
| `analytics.event_rollups` | (org, event) unique: starts/ends, `end_day` (org zone), valid tickets, checked in |
| `analytics.event_sync` | (org, adapter, event) unique: snapshot hash, version, time zone, synced at |
| `analytics.ingest_log` | (org, source event id) unique; type, version, event, adapter, outcome; append-only for `app_user` |
| `analytics.backfill_runs` | status, adapter, cursor, page size, pages per minute, progress, next page at; one `running` per org (partial unique) |

All `tenantTable` (org_id NOT NULL, ENABLE + FORCE RLS, canonical policy, org-leading indexes),
fixture rows for both orgs (`createOrgFixture`: catch-up + one backfill), every text column declared
in `private-columns.ts`.

**Migration** `0107_needy_stryfe.sql` (new schema and tables only; nothing destructive).
Hand-written block: composite FKs `(org_id, event_id) → events.events (org_id, id) ON DELETE
CASCADE` on `daily_rollups`, `event_rollups`, `event_sync`; `REVOKE UPDATE, DELETE, TRUNCATE ON
analytics.ingest_log FROM app_user`; `INSERT INTO billing.plan_modules ('launch_standard',
'analytics_pro') ON CONFLICT DO NOTHING`.

### 6. API diff
- `/v1`: none. `/api/v2`: none.
- Queries: `analytics.orgDashboard` (`orders:read`; no money fields), `analytics.orgRevenue`
  (`finance:read`), `analytics.backfillStatus` (`orders:read`). Command `analytics.startBackfill`
  (`org:update`, audited `analytics.backfill_started`). All entitlement `analytics_pro`.
- Dev only: `POST /api/dev/analytics/backfill` (404 unless dev auth).

### 7. Events
Consumes (v1): `order.paid`, `order.refunded`, `order.disputed`, `order.dispute_closed`,
`tickets.cancelled`, `attendee.cancelled`, `ticket.admitted`, `ticket.admission_undone`,
`ticket.admission_moved`, `event.updated`, `event.published`, `event.postponed`,
`event.rescheduled`, `event.cancelled`. Emits none.

### 8. Entitlements and flags
`analytics_pro` (P6-13; on `launch_standard`, free in beta). `ANALYTICS_WAREHOUSE`,
`TINYBIRD_API_URL` (`fake` = in-memory fake, refused in production), `TINYBIRD_APPEND_TOKEN`,
`TINYBIRD_SIGNING_KEY`, `TINYBIRD_WORKSPACE_ID` (`.env.example` names only).

### 9. Security and privacy
- The adapter receives `ctx`; the org is `requireOrg(ctx)`. Postgres: RLS plus an explicit org
  filter. Tinybird: every appended row carries the org; every read uses a JWT for one pipe whose
  fixed `org_id` is the caller's; the adapter rejects any returned row of another org; the fake
  refuses a read whose URL org differs from the token's, an unsigned, forged, expired or
  other-pipe token, or a missing org.
- No personal data in the warehouse: ids of events, days, counts and money only.
- Money only through `orgRevenue` (`finance:read`); the counts DTO has no money field.

### 10. Acceptance criteria
| ID | Criterion | Test |
|---|---|---|
| AC1 | Isolation through the warehouse on both adapters: totals, top events, event filter (another org's event is not found), RLS (no foreign rows visible, no foreign writes), a sale in org B leaves A unchanged; the Tinybird fake asserts every query carries the signed org and every append one org | `packages/testing/tests/warehouse.int.test.ts`, `packages/modules/analytics/tests/warehouse.test.ts` |
| AC2 | Dashboards match the Postgres source totals to the cent on both fixture orgs (orders, net tickets, comps, refunded tickets, check-ins; gross and refunds per currency), USD and EUR kept apart, hand-computed event figures incl. no-shows | `warehouse.int.test.ts` |
| AC3 | Tinybird (fake) dashboards equal the Postgres ones for both orgs at day, week and month | `warehouse.int.test.ts` |
| AC4 | Replaying the outbox twice writes once (second delivery refused; a full replay with processed marks forgotten is refused by the ingest log; row versions unchanged); on Tinybird no new append | `warehouse.int.test.ts` |
| AC5 | A backfill after live ingest changes nothing (Postgres rows and xmin identical; Tinybird no append); a backfill repairs missing rows and equals the recomputation | `warehouse.int.test.ts` |
| AC6 | Backfill: owners/admins only (viewer and finance refused), one at a time, rate limited (a page early waits), resumable (a new worker continues from the cursor; each event appended once), a failed page stops the run and a new run skips what is already there; audited | `warehouse.int.test.ts`, `apps/worker/tests/warehouse.int.test.ts` |
| AC7 | Org time zone days, Monday weeks, months on the 1st; range validation (end before start, over two years, bad granularity) | `warehouse.int.test.ts`, `warehouse.test.ts` |
| AC8 | Permissions and entitlement: viewer gets counts and no money; finance gets revenue; scanner refused; `analytics_pro` revoked → `module_not_enabled` | `warehouse.int.test.ts` |
| AC9 | Versioned event schemas, adapter selection by env (fake refused in production), JWT signing/verification, pure bucketing and figure math, DTO allowlists | `warehouse.test.ts` |
| AC10 | Worker: subscriber registered; backfill job works a run to done page by page through pg-boss (exclusive per run, platform_reader audited) | `apps/worker/tests/warehouse.int.test.ts` |
| AC11 | E2E (375/768/1280): owner figures and per-currency revenue, top events, Day/Week/Month switch, reload persistence, keyboard-only filter and switch, empty state with next step, range errors (aria-invalid), viewer sees counts and no money or rebuild, scanner gets 404, rebuild started → done, axe in light and dark on every state, Arabic RTL | `apps/web/e2e/warehouse.spec.ts` |
| AC12 | Isolation suite and canary coverage include every new table | `packages/testing/tests/isolation.int.test.ts`, `canary.int.test.ts`, `column-privacy.test.ts` |

### 11. Demo
- [ ] Sign in as the Lakeside owner → Analytics: figures for the last 30 days, revenue per currency.
- [ ] Switch to Month, filter one event, reload: the URL keeps it.
- [ ] Rebuild: "Rebuild started", then (worker or dev route) "Done · N events checked, 0 updated".
- [ ] Sign in as jordan@lakeside.test (viewer): counts only, no revenue, no rebuild.

### 12. Gate results (M6.2a, on merge/next-3h + m0.5-foundation-ey5gqp + design-v2)
- `pnpm verify`: lint, check:modules, typecheck (59 packages), 2525 unit tests (191 files), 1422
  integration tests (158 files): all pass.
- E2E `warehouse.spec.ts`: 18/18 (6 tests × 375/768/1280).
- Whole web suite (2 workers; the org nav and seed changed): the first run stopped at the 2-hour
  limit after 1693 of 1989 tests; the 272 unrun desktop tests ran after (293 passed). Failures, none
  in analytics pages:
  - `dev-login.spec.ts:31` (all viewports): the "newcomer" persona already owns an org created by an
    earlier spec in the same database, so `/o` shows that org's home ("Good morning, Nia.").
  - `venues.spec.ts:134` (all viewports): the console list's Category filter comes back as
    `nightlife` instead of empty (state left by an earlier run on the shared database).
  - `registration-approvals.spec.ts:236` (all viewports): after paying from the emailed link the
    page reads "Pay for your order", not "You're registered" (M5.1c flow from batch 3h).
  - `enrollment.spec.ts:105` and `speaker-portal.spec.ts:147/254` failed once under full-suite load
    (email waits timed out) and pass when run alone.

## M6.2b — Attribution, explorer, alert rules, scheduled reports (built)

### 1. Goal and users
Organizers want to know which campaigns, channels and sources sold their tickets (not only the
first or last click), to slice their figures without asking for a report, to be told when a number
crosses a line, and to get the figures by email without opening the console. Users: owners, admins,
managers, finance, box office and viewers (each with what their role may see).

### 2. References
Plan `docs/plans/phase-6.md` row M6.2B and P6-2 ("a curated explorer covering events, channels,
cohorts and attribution, built in the app"), P6-1 (fakes, flags), P6-13 (`analytics_pro`); the
brief `docs/agent-briefs/m6.2b.md`. Builds on M6.2a (warehouse port), M3.8a/b (tracked links,
attribution records, campaign keys), M3.2b (alert engine), M1.10 (notifications), ADR 0017 (PDF).

### 3. Scope
**In**
- **Touch paths** (marketing, tier 5): `marketing.attribution_touches` written with each
  attribution record — every counting click in the org's lookback window (default 30 days, 1–90),
  at most 50 (the first and the latest 49), each with its link's UTM values and M3.6b campaign; or
  the first and last landings (`utm`, or `referral`: a page opened from another site without UTM
  values records `source = referring host, medium = referral`; our own hosts and payment return
  pages excluded; only the host kept). Event `marketing.order_attributed@1` (ids). Older records
  fall back to their first/last touch.
- **Multi-touch attribution** (analytics): first, last and linear models over those paths, stored
  as warehouse rollups (`analytics.attribution_rollups`, part of the event snapshot; Tinybird
  datasource + pipe), per payment day in the org time zone, model, source, medium, campaign key and
  link, in basis points of an order and integer minor units per currency. **Remainder rule:** each
  touch gets `floor(total / n)`; the remainder (fewer than `n` units) goes to the **last** touch.
- **Curated explorer** `/o/{org}/analytics/explore`: 11 measures (registrations, net tickets, free
  tickets, refunded tickets, check-ins, no-shows, attributed orders; paid, refunded, net, attributed
  revenue for finance), 5 dimensions (period by day/week/month, event; channel, source, campaign for
  attribution measures), presets or custom dates, an event filter, the attribution model. No free
  SQL. Saved views per member; CSV export through an allowlist serializer.
- **Organizer alert rules** `/o/{org}/analytics/alerts`: measure (7), condition (at least, below,
  rises/drops by at least N % against the previous window), window (today, 7, 14, 30 days), event,
  currency for money, severity, quiet hours (default on). Evaluated from the warehouse by the
  worker every minute (and at once on create/edit/switch); delivered by the M3.2b engine (alert
  lifecycle, routing, history, acknowledge/snooze) through `analytics.alert_rule_evaluated@1`.
- **Scheduled PDF reports** `/o/{org}/analytics/reports`: daily (yesterday), weekly (Monday–Sunday)
  or monthly, sent at an hour in the org time zone the day after the period, to chosen members;
  one PDF per recipient language and finance visibility; the email links to the PDF in the console.

**Out (Later / not yet)**
- View-through credit for campaign sends without a click; netting refunds in attributed revenue;
  data-driven or time-decay models; cohorts in the explorer (P6-2 lists them; not in the brief).
- PDF attachments (the notifications pipeline has none; the email links to the console).
- A member time-zone setting (quiet hours use the push device's zone, else the org's).
- Text messages for organizer rule alerts; `/v1` routes for the explorer, rules and reports.

### 4. `touches:`
```yaml
touches:
  - packages/modules/analytics/** (attribution/, explorer/, rules/, reports/, access.ts, tick.ts, schema, port, adapters, compute, ingest, tinybird/*)
  - packages/modules/marketing/src/{attribution,touch-paths,schema,private-columns,index,click}.ts, src/domain/{touches,referral}.ts
  - packages/modules/orders/src/{order-days,index}.ts
  - packages/modules/alerts/src/{engine,metric-rules,subscriber,api,schema,private-columns,index}.ts, src/domain/config.ts
  - packages/modules/notifications/src/{kinds.ts,templates/samples.ts,templates/messages/*.json}
  - packages/modules/webhooks/src/internal-events.ts
  - packages/pdf/src/{analytics-report,index}.ts
  - packages/db/drizzle/0123_cheerful_anita_blake.sql (+ meta)
  - packages/testing/src/{attribution,fixtures,index}.ts, tests/analytics-pro.int.test.ts
  - apps/worker/src/{analytics-pro,main}.ts, tests/analytics-pro.int.test.ts
  - apps/web: analytics/{explore,alerts,reports}/**, analytics/page.tsx (tabs), components/{analytics-tabs,analytics-pro-forms}.tsx,
    server/{explorer,analytics-pro,alerts}.ts, lib/{rule-threshold,attribution-capture}.ts, api/dev/analytics/run,
    command-center widgets (title param), messages ×13, e2e/analytics-pro.spec.ts, tests/rule-threshold.test.ts
```

### 5. Data model
| Table | Notes |
|---|---|
| `marketing.attribution_touches` | (org, order, position) unique; kind `click`/`utm`/`referral`; link (clicks only, CHECK), campaign id, source, medium, campaign; FK to the attribution record (cascade) and the link |
| `analytics.attribution_rollups` | (org, event, day, model, source, medium, campaign, link, currency) unique NULLS NOT DISTINCT; `credit_bps`, `revenue_minor` ≥ 0 |
| `analytics.saved_views` | (org, user, name) unique; measure/dimension/model/granularity/range vocab; custom from/to CHECK |
| `analytics.alert_rules` | (org, name) unique; measure, condition, threshold (bigint; 1–1000 for %), window 1/7/14/30, currency (money only, CHECK), severity, quiet hours, enabled, last state/value |
| `analytics.report_schedules` | (org, name) unique; frequency, send hour 0–23, event, recipients uuid[1..20], enabled, `active_since` |
| `analytics.report_runs` | **(org, schedule, period key) unique** — the dedupe key; status pending/sent/failed, attempts, error |
| `analytics.report_files` | (org, run, locale, finance) unique; the PDF (bytea) |

All `tenantTable` with FORCE RLS, org-leading indexes, composite FKs; fixture rows for both orgs;
every text column declared in `private-columns.ts`.

**Migration** `0123_cheerful_anita_blake.sql` (new tables, one new nullable column
`alerts.alerts.title`; nothing destructive). Hand-written blocks:
1. The three CHECKs on the existing `alerts.alerts` (`alerts_rule_check` with the two new rule
   keys, `alerts_scope_check` allowing `m:{uuid}` for those rules, `alerts_title_check`) added
   `NOT VALID`, then `VALIDATE CONSTRAINT`.
2. Composite FKs `(org_id, event_id) → events.events`: `attribution_rollups` ON DELETE CASCADE;
   `saved_views`, `alert_rules`, `report_schedules` ON DELETE SET NULL (`event_id`).

### 6. API diff
- `/v1`: none. `/api/v2`: none.
- Queries: `analytics.explore` (`orders:read`), `analytics.exploreMoney` (`finance:read`),
  `analytics.listSavedViews`, `analytics.listAlertRules`, `analytics.getAlertRule` (`orders:read`;
  money rules only with finance), `analytics.listReportSchedules`, `analytics.getReportSchedule`
  (`org:update`), `analytics.listReportRuns`, `analytics.reportFile` (`orders:read`; finance files
  only with finance). Commands (audited): `analytics.saveView`, `deleteView` (`orders:read`, own
  rows), `createAlertRule`, `updateAlertRule`, `setAlertRuleEnabled`, `deleteAlertRule`
  (`alerts:manage`), `createReportSchedule`, `updateReportSchedule`, `setReportScheduleEnabled`,
  `deleteReportSchedule` (`org:update`). All entitlement `analytics_pro`.
- Web routes: `/o/{org}/analytics/explore/export` (CSV), `/o/{org}/analytics/reports/files/{id}`
  (PDF). Dev only: `POST /api/dev/analytics/run` (`rules=1`, `reports=1`).

### 7. Events
Emits `marketing.order_attributed@1` (orderId, eventId) and `analytics.alert_rule_evaluated@1`
(rule id and name, state, numbers, vocabulary), both internal (`workflow`). The warehouse consumes
the first; the alerts evaluator the second.

### 8. Entitlements, flags, providers
`analytics_pro`. Tinybird stays the fake in dev/CI. PDFs through Gotenberg (`GOTENBERG_URL`; the
worker leaves runs pending without it). Notification kinds `alerts.metric`, `alerts.metric-now`,
`analytics.report` (13 locales).

### 9. Security and privacy
- Money only through the finance-gated query, rules and PDFs; the counts DTOs have no money field.
- Touch paths and rollups hold UTM values and hosts only (no click hashes, no people); referral
  capture keeps the host, never the path or query.
- Saved views are filtered by the caller; report PDFs are served only to members, never public.

### 10. Acceptance criteria
| ID | Criterion | Test |
|---|---|---|
| AC1 | A fixture campaign's attributed revenue (and orders) match hand-computed numbers to the cent for first, last and linear, by source, channel and campaign, with the remainder rule | `packages/testing/tests/analytics-pro.int.test.ts`, `packages/modules/analytics/tests/pro.test.ts`, `apps/web/e2e/analytics-pro.spec.ts` |
| AC2 | Tinybird (fake) attribution equals Postgres; every query scoped to the org | `analytics-pro.int.test.ts`, `pro.test.ts` |
| AC3 | Isolation: another org's event not found, rollups/touches/views invisible under RLS; isolation suite and canary cover every new table | `analytics-pro.int.test.ts`, `isolation.int.test.ts`, `canary.int.test.ts`, `column-privacy.test.ts` |
| AC4 | Finance gating: viewers/managers refused money; counts query refuses money measures; money views and rules need finance; money rules hidden from others | `analytics-pro.int.test.ts`, e2e |
| AC5 | Explorer validation (touch dimension, custom dates, from after to, closed vocabularies), saved views private and unique, CSV through the allowlist serializer | `analytics-pro.int.test.ts`, `pro.test.ts`, e2e |
| AC6 | Alert rules: fire, update, resolve, reopen and sweep through the M3.2b engine; evaluating twice sends nothing new; quiet hours hold email in the recipient's night; permissions and validation | `analytics-pro.int.test.ts`, e2e |
| AC7 | A scheduled report arrives once per period through a failed render, concurrent ticks and re-runs; one PDF per language and finance visibility; members only | `analytics-pro.int.test.ts`, `apps/worker/tests/analytics-pro.int.test.ts`, e2e |
| AC8 | DST: daily (Berlin, New York, Lord Howe), weekly and monthly schedules across DST changes send every period once, none skipped | `pro.test.ts`, `analytics-pro.int.test.ts` |
| AC9 | E2E (375/768/1280): explorer (measure, dimension, period, model; save view; export), rule create/edit/disable/delete, schedule a report (send, download); keyboard only; axe in both themes; Arabic RTL; viewer and scanner denials | `apps/web/e2e/analytics-pro.spec.ts` |
| AC10 | Referral capture and touch-path ordering/capping; threshold parsing to minor units | `packages/modules/marketing/tests/touches.test.ts`, `apps/web/tests/rule-threshold.test.ts` |

### 11. Demo
- [ ] Owner → Analytics → Explore: Attributed revenue by Source, Linear: Instagram $13.33,
  partner $3.34 (the fixture); switch to First and Last.
- [ ] Save the view, reload, open it from the list; Export CSV.
- [ ] Alert rules: "Registrations today at least 3" fires; it appears in Alerts; edit to 100 → resolved.
- [ ] Reports: schedule weekly to yourself; `POST /api/dev/analytics/run reports=1` twice → one
  email, one row, Download PDF.

### 12. Gate results (M6.2b, on m0.5-foundation-ey5gqp + merge/next-3i, re-merged before the gate)
- `pnpm lint`, `pnpm check:modules`: ok. Typecheck (`turbo run typecheck --concurrency=2`): 62/62.
- Unit: 2978/2978 (226 files). Integration: 1685/1685 (181 files) — the first run found
  `analytics.deleteView` without its `delete` category (impersonation test); fixed, and that file
  plus the M6.2b suites re-run green.
- E2E (2 workers, 375/768/1280): `analytics-pro.spec.ts` 30/30 plus the related `warehouse`,
  `alerts`, `marketing-analytics`, `marketing`, `tracked-links`, `command-center` specs: 132/132.
