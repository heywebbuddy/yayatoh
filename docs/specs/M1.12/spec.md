# M1.12 — Reports and organizer dashboard v1

Roadmap: M1.12 ("Metric registry with `as_of`. Organizer and event totals, net revenue, booking search, complimentary and failed bookings, code stats, check-ins, sales breakdowns. Admin commission report. Exports to R2. Acceptance: totals equal the golden queries; a 50k-row export completes."). Research 18 §1 (metric catalog, freshness classes). Delivered in three increments. No migration: the `reports` module owns no tables.

## M1.12a — metric registry and event/org totals (done)
- **Registry** (`packages/modules/reports/src/metrics/registry.ts`):
  - Each metric has a key, unit (`money`, `count`, `percent` in basis points), grains (event, org), the permission that may see it, a freshness class (all L0: read exactly from the transactional tables) and a plain-English definition.
  - `deriveMetrics(facts, keys, asOf)` is pure. Every value carries `asOf` (the report's read time).
  - Money is integer minor units **per currency**; currencies are never added together. The event's (or org's) own currency always appears, so an empty report shows zeros in it.
- **Definitions:**
  - *Sold orders* are those that were ever paid (`paid`, `partially_refunded`, `refunded`).
  - *Complimentary* means a sold order with a zero total (free pass, 100 % code). This matches the roadmap's "comps go straight to paid". Pending the owner's confirmation (owner inbox).
  - **Gross sales** is the sum of sold order totals (face after promo, plus pass-on fees). Box office is included. Periods count by payment time.
  - **Refunds** are succeeded refunds, counted by completion time.
  - **Platform fees kept** are the fee inside sold orders minus the fee part of refunds.
  - **Disputes lost** are counted by closing time.
  - **Net revenue** = gross − refunds − disputes lost − platform fees kept. This is the organizer's proceeds before card processing on their own Stripe account (organizer_mor). Under platform_mor the platform absorbs processing costs. Box-office money is already with the organizer; its fee is netted from the next payout.
  - **Tickets sold** = paid tickets issued − tickets refunded. Complimentary tickets are separate. For a period this can be negative.
  - **Valid tickets** are active tickets. Lost-dispute voids count here only.
  - **Checked in** = tickets with a live admission. **Check-in rate** = checked in ÷ valid, capped at 100 %.
  - **Capacity** = the quantities of ticket types that are not archived.
  - The by-ticket-type "sold" column is valid − complimentary.
- **Narrow reads added to lower tiers.** They are exported, RLS-scoped and return no rows of their own:
  - orders (`facts.ts`): `salesFactsTx`, `refundFactsTx`, `orderStatusCountsTx`, `salesByTicketTypeTx`, `salesByDayTx(timeZone)`, `salesByPromoCodeTx`, `salesByEventTx`.
  - ticketing: `ticketTypeStatsTx`, `orderIdsByShortCodeTx`.
  - checkin: `checkinFactsTx`.
  - payments: `lostDisputeFactsTx`, `platformFeesByOrgTx`.
  - tenancy: `organizationDefaultsTx` (timezone, currency).
- **Queries** (entitlement `reports`):
  - `reports.eventReport` (`orders:read`): metrics; orders by status; breakdowns by ticket type, by day in the event timezone, by channel (online vs organizer-collected) and by promo code, including codes never used.
  - `reports.eventFinance` (`finance:read`): the waterfall from gross to net.
  - `reports.orgReport` (`orders:read`) and `reports.orgFinance` (`finance:read`): inclusive calendar days in the **org's timezone** (`PeriodInput`, `periodRange`); per event and per day.
  - All outputs are Zod allowlists.
- **Booking search** (`orders.bookingSearch`, `orders:read`):
  - Searches buyer name or email, order-id prefix, promo code, or a ticket's printed code. LIKE wildcards are escaped.
  - Filters: all, paid (not comp), complimentary, failed, refunded (incl. partial), awaiting payment, expired/cancelled, box office.
  - Returns the match count and the newest 100.

## M1.12b — dashboard UI (done)
- **Event home** (real events; the demo overlay is unchanged for showcase slugs): four key numbers.
  - Gross sales, with the amount refunded.
  - Net revenue for finance roles; orders and failed payments for everyone else.
  - Tickets sold of capacity, with complimentary tickets.
  - Checked in, with the rate of valid tickets.
  - Also "Updated now" (as_of) and a link to the full report. An event with no sales keeps the "No sales yet" empty state.
- **Analysis** (`/o/{org}/e/{event}/analysis`, the profile nav's `analysis` item; it replaces the placeholder section):
  - Overview: key numbers and more numbers, then sales by day. The bar chart comes with a **"Show the data" table** (a `<details>` disclosure, keyboard operable).
  - Tables by ticket type, channel, order status and promo code.
  - Tabs: Overview · Bookings · Finance. The Finance tab shows only with `finance:read`.
- **Finance** (`…/analysis/finance`): the waterfall table, one column per currency, with the definition. Other roles get an explanatory empty state and no data, including on the direct URL.
- **Bookings** (`…/analysis/bookings`): a GET search form (works without JS; the URL is shareable and survives reload), a count, and results that link to the order. Box-office and promo-code tags appear on results.
- **Org home:** a Sales section for `orders:read`.
  - Period picker: last 7/30/90 days, this month, this year, all time, custom dates. Default: 30 days.
  - A backwards or partial custom range shows an error and falls back to the default.
  - Key numbers (net revenue for finance roles) and sales by event, linking to each event's report.
- **UI package:** `BarChart` (tokens only) and `ChartTable` (the data-table alternative).
- **Strings:** all in 13 locales; Arabic renders RTL. `reports.*` keys.

## M1.12c — exports and the admin commission report (done)
- **Bookings CSV** (`reports.bookingsCsv` bulk action, entitlement `reports`, permission `attendees:export`, since buyer contact data leaves the platform):
  - Exports whatever the booking search currently matches, through the bulk framework: selection snapshot, 2 000-row chunks, progress panel with polling, download route.
  - Columns are an allowlist: reference, buyer, email, status, tickets, total (plain decimal per currency exponent), currency, promo code, channel, booked/paid times in the event timezone.
  - CSV injection guard; UTF-8 BOM.
  - Selections above 50 000 are refused; so are id lists (exports go by search and filter).
  - Registered in the web app, the worker and the test ports.
- **Storage:** files still live in Postgres (`platform.files`/`file_parts`, 7-day expiry), as for attendee exports. **R2 is not wired yet** (owner inbox: Cloudflare account and bucket). The bulk framework's file API is the seam where an R2 adapter will go.
- **Admin commission report** (`apps/admin` → Commission, staff with the `fees` action: admin and finance staff):
  - Platform fees per org and currency for a period of UTC days, from the ledger.
  - Fees charged on sales (online and box office), fees refunded, net commission, and totals per currency.
  - A cross-tenant read through `platform_reader`, audited in the access log with the period.
  - Support staff and organizer accounts are refused.

## Later / not yet
- Materialized/projected metrics (L1/L2, `metric_snapshots`, realtime tiles) and a Redis cache with tag invalidation: M3.1/M3.2 Command Center. Today every report reads live (L0), so `as_of` is always "now".
- Sales-velocity, pace-vs-comparable, conversion funnel, AOV, refund rate: M3.2/M6.2.
- The report queries run in the default READ COMMITTED transaction. A REPEATABLE READ snapshot would give perfectly consistent totals under concurrent writes; this needs a `withTenant` option.
- CSV exports of the summary tables (by day, type, channel) and XLSX/PDF: later (M6.2 scheduled reports).
- R2 storage for export files (owner account needed).
- Agency cross-client reports read snapshots (M6.7).
- Legacy golden queries on `legacy-anon` (ELT, Phase 2) will reuse these metric definitions.

## Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | Event gross, refunds, discounts, fees, disputes lost and net equal independent superuser SQL, per currency, with refunds, comps, box office, promo and a lost dispute | `packages/testing/tests/reports.int.test.ts` |
| AC2 | Orders (sold, comp, failed, refunded), tickets (sold, comp, refunded, valid, capacity), check-ins and rate equal the golden queries | `reports.int.test.ts` |
| AC3 | Breakdowns by status, ticket type, day (event timezone), channel and promo code (including an unused code) equal the golden queries | `reports.int.test.ts` |
| AC4 | Org totals (all time and a period of org-timezone days) equal the golden queries; a backwards period is refused | `reports.int.test.ts`, `apps/web/tests/period.test.ts` |
| AC5 | Another org's data never appears; its own report matches its golden queries; a foreign event is not found; a non-member is refused | `reports.int.test.ts` |
| AC6 | A viewer reads sales but not finance; a scanner reads neither; a finance member reads finance | `reports.int.test.ts` |
| AC7 | Booking search filters (comp, failed, refunded, pending, box office, paid) and finds by name, email, order id, promo code and ticket code; wildcards are literal; nothing crosses orgs | `reports.int.test.ts` |
| AC8 | Registry: unique keys, definitions, money never summed across currencies, net formula, rate cap, as_of on every value | `packages/modules/reports/tests/metrics.test.ts` |
| AC9 | End to end: create an event and sell through the UI (paid, promo, free, declined, box office), refund, check in; every KPI on the event home, the report, the chart's data table and the finance waterfall matches; empty states before sales; axe; Arabic RTL | `apps/web/e2e/reports.spec.ts` |
| AC10 | End to end: booking search filters and codes by keyboard; no-match empty state; the search survives a reload | `apps/web/e2e/reports.spec.ts` |
| AC11 | End to end: a viewer sees sales, no Finance tab or net revenue; the finance URL is refused; the viewer has no export button and cannot download an owner's export | `apps/web/e2e/reports.spec.ts` |
| AC12 | End to end: the org home period picker (presets by keyboard, custom, a backwards-range error, an empty past period, all time) with sales by event; Arabic RTL | `apps/web/e2e/reports.spec.ts` |
| AC13 | A 50 000-row bookings export completes through the bulk framework. The file has 50 001 lines and allowlisted columns, is injection-safe, and its totals equal the golden SQL. Oversized, id-list and viewer requests are refused; another org can't read the operation | `packages/testing/tests/reports-export.int.test.ts` |
| AC14 | End to end: export the filtered bookings as CSV, download it, and check its rows | `apps/web/e2e/reports.spec.ts` |
| AC15 | Platform fees per org and currency (the commission report's source) equal the golden SQL over orders and refunds, including a fee refund, and filter by booking time | `reports.int.test.ts` |
| AC16 | End to end (staff console): a fee booked on a box-office sale shows up in the tenant's commission. A backwards period is refused; a past period is empty; the read is in the access log; organizer accounts are refused | `apps/admin/e2e/admin.spec.ts` |
