# U5: Money — finance overview and payouts dashboards

Source: `docs/plans/ux-review-1.md` (approved 2026-10-03), findings 7 and 8, principles 5 ("numbers before prose"), 6 and 7, decision UX-4 and row U5.

**Payments data:** these pages only **read** existing ledgers and reports (orders, refunds, lost disputes, the payments journal and settlements). No new money movement, no new table, no migration. Fake provider only in every test.

## What was built

### Money nav group (U2's grouped sidebar)
Money now opens with **Overview** (`/o/{org}/money`, `finance:read`), then **Payouts** (`finance:read`), **Sales by event** (`/o/{org}/sales-by-event`, `orders:read`) and **Fees** (`/o/{org}/fees`, `finance:read`). Reconciliation ("Finance"), analytics, coupons, refund requests, disputes and charity stay where U2 put them. Each Money page also has the same page switcher (`Money pages` tabs) for the pages the role may open. The pages refuse by URL (404) exactly like the nav hides them.

### Overview
- Net as the hero (highlight card), then gross, refunds, fees (taken less given back), lost disputes and paid out, each with the change against the period of the same length just before and the previous amount in words.
- Gross sales per day, week or month (bar chart, tokens only) in the **org's time zone**, with the data table as the accessible alternative (gross, refunds and fees per bucket). The bucket size follows the period (≤31 days: days, ≤184: weeks, else months) unless chosen.
- The period form is a GET form (shareable URL) with the U1 `Select` and `DatePicker`; the next payout card links to Payouts. Help panel "How your money adds up".
- Query: `reports.moneyOverview` (`finance:read`): the metric registry's finance keys (`deriveMetrics`, same definitions as `orgFinanceQuery`) + `payments.payoutTotalsTx`; per-day facts from `orders.moneyByDayTx`.

### Payouts
- Summary numbers: next payout (expected amount after the 5 % reserve, and its date), held for your events, in reserve (and when it next comes back), you owe.
- **Upcoming payouts** timeline: funds held per event with their release date (5 business days after the event ends), released payouts on their way (sending / waiting for your payout account / retrying), reserves coming back with their date. Used-up reserves are left out.
- **Settlements**: every released payout with released, kept back, paid out and status; each links to its drill-down. **Receivables** kept as before.
- The two prose paragraphs (settlements and receivables rules) became the "When payouts are sent" help panel.
- Queries: `reports.payoutsDashboard` reuses `settlementsQuery` and `receivablesQuery`, plus `payments.heldFundsTx` and `payments.reservesHeldTx`.

### Payout drill-down (`/o/{org}/payouts/{settlement}`)
- From release to payout: released, kept as reserve, taken for what you owed, paid to you; when it was sent, when the reserve comes back; link to the event's finance analysis.
- **Orders in this payout**: every sale and refund whose organizer share made up the release (date, type, order reference linking to the order, buyer, paid by the buyer, fee, your share), with totals. The shares add up to the released amount.
- How: `payments.settlementLinesTx` reads the journals that moved `org:payable_held` for the event and currency between the previous release and this one (journal ids are time-ordered uuidv7). A reserve release has no lines of its own and links to the payout that kept it.

### Sales by event
- Orders, tickets and gross per event for the period (`orgReportQuery`, `orders:read`); for finance roles also refunds, fees and net per event (`reports.eventMoney`, the registry's definitions per event and period, covering events with only refunds or lost disputes too). Each event links to its finance analysis (or its sales analysis without finance access).

### Fees (UX-4)
- The org's fee plan (plan name from `planSummaryQuery` when the role may read billing; the rate per currency from `feeScheduleQuery`, marked when it is a staff-agreed rate). Rates stay set by Yayatoh staff in admin.
- Fees in the period (taken, given back, net), **fees per order** (latest 200, newest first, linking to the order) and **fees per payout** (the fees on the orders each event payout released). Help panel "How fees work".
- Query: `reports.fees` (`finance:read`).

### CSV exports
`/o/{org}/money/export?view=overview|events|payouts|payout|fees` (the same queries and permissions as the pages; sales by event leaves the money columns empty without `finance:read`). Serializers in `@yayatoh/reports` (`money-csv.ts`): an explicit column allowlist per view over the DTOs, decimals in the currency's exponent, times in the org's time zone, headers in the reader's language, text cells neutralised against CSV injection (amounts we format ourselves are written as plain numbers).

## Later / not yet
- Fees per order lists the latest 200 orders of the period (the page says so); paging can come with a bulk export if organizers need more.
- The chart shows gross per bucket; refunds and fees per bucket are in its data table. Net per bucket would need disputes per day (not in the facts yet).
- Payout lines assume no sale is booked concurrently with the release job for the same event (the release takes the org lock, sales don't); a sale committed in that instant would appear in the next payout's lines although its money was in this one. The lines' total is checked against `releasedMinor` in the integration test.
- Organizer-collected sales (box office) have no payout; their fee shows under fees per order and as a receivable.
- `merge/next-3j` was not merged into this branch: it conflicts with `merge/next-3i` in about 80 files including migration snapshots (the merge session combines them). It adds no Money pages.

## Acceptance

| Criterion | Test |
|---|---|
| Totals match the ledger to the cent on the fixture org | `packages/testing/tests/money-dashboards.int.test.ts` (overview vs journals and postings, vs `orgFinanceQuery`; buckets add up; per event vs ledger; fees vs ledger) |
| A payout drills down to exactly its orders | same file ("…the payout drills down to exactly its orders": two sales and the refund of the event, none of the other event's, shares sum to `releasedMinor`); e2e `apps/web/e2e/money.spec.ts` (two buyers' rows, total = released, CSV has exactly them) |
| Only finance/reports roles see the group; exports respect the same | int: viewer refused by every money query; another org sees none of it. Unit `apps/web/tests/org-nav.test.ts`; e2e viewer test (nav hides Overview, Payouts, Fees; URLs and exports 404; sales by event without money columns) |
| Overview with period change | e2e (all time, by month, URL keeps it; bad custom range message) + int (previous period, grain) |
| Sales by event | e2e (row, Net column, CSV header and amount, link to finance analysis) |
| CSV export | e2e (overview, payouts, payout, sales by event) + unit `packages/modules/reports/tests/money-csv.test.ts` |
| Keyboard only | e2e "keyboard only" (period and grain chosen with the keyboard, Apply with Enter, tabs) |
| axe in both themes, RTL | e2e (`expectAccessibleBothModes` on overview, payouts, payout, sales, fees; `/ar/…` for all four pages) |
| Pure logic | `packages/modules/reports/tests/money-buckets.test.ts`, `apps/web/tests/money.test.ts` |
| Screenshots | `docs/ux/screenshots/u5/` (before: payouts, finance, home; after: overview, payouts, payout, sales, fees; light and dark, 1280 and 390 px) |

## Gate (2026-10-03)
- `pnpm lint`, `pnpm check:modules`, typecheck (62/62 packages): pass. Unit: 3066 passed.
- Integration: 1670 of 1671 passed. The one failure is `audit.int.test.ts` › "detects an edited, a deleted and a re-hashed entry", a 30 s timeout that reproduces when the file runs alone. That test builds two extra full fixtures (`twoOrgs()`) inside its 30 s limit; U5 changes no fixture, audit or tenancy code. Pre-existing on this base (3i + U1 + U2).
- e2e on 375/768/1280: `money.spec.ts` 12/12; related `console-nav`, `payouts`, `receivables`, `reports`, `reconciliation`: 60/60 (and payouts + receivables again after the last change).
