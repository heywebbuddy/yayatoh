# Spec: M6.5 — Enterprise integrations

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-4, P6-6, P6-13)
- **Status:** M6.5d built (2026-10-03), on the M6.4a integrations framework, behind the `integrations` module key and the `IntegrationAuth` port (fake QuickBooks and Xero in dev and CI; Nango's `quickbooks` and `xero` integrations in production once the owner registers the apps).
- **Risk tags:** `payments` (reads the payments ledger and gifts; posts money summaries to the org's books), `db-migration`, `tenancy`
- **Related ADRs:** 0008 (outbox), 0018/0022 (tokens, design v2)

## M6.5d — accounting: daily summary journals to QuickBooks Online and Xero (done)

### 1. Goal and users
Organizers (owners and admins; managers read) keep their books without exports: every day, once it
has ended in the org's time zone, Yayatoh posts **one summary journal per day and currency** with
the day's ticket sales, donations, refunds, Yayatoh fees and payouts to the accounts they chose in
their own chart of accounts. A day that changes later (a late refund, an adjustment) is **reversed
and posted again**, never edited, so the books always say what the ledger says.

### 2. References
- **Decision P6-6:** daily summary journal entries (sales, fees, refunds, payouts, donations per
  account) rather than one entry per order; QuickBooks Online and Xero through Nango; a mapping UI
  to the org's chart of accounts.
- **P6-4:** the M6.4a framework (port, engine, errors inbox). **P6-13:** the `integrations` key.
- **Plan row M6.5D** acceptance: a day's journal equals the ledger memo entries to the cent.

### 3. Scope
**In (built):**
- **Where the numbers come from** (read through the owning modules' exports, never their schemas):
  - `@yayatoh/payments` `ledgerDailyTotalsTx` (new, `src/daily-totals.ts`): per day (org time zone,
    by `occurred_at`) and currency, from the immutable journals — **sales** = `grossMinor` of `sale`
    and `organizer_collected_sale` memos; **fees** = their `feeMinor` less refund memos'
    `feeRefundedMinor`; **refunds** = refund memos' `amountMinor`; **payouts** = the
    `org:payable_releasable` debit of `transfer` journals.
  - `@yayatoh/donations` `donationDailyTotalsTx` (new, `src/daily-totals.ts`): paid gifts by
    `paid_at` (gift plus covered fee: what the donor was charged) and gift refunds by `refunded_at`
    (added to refunds). Gifts are direct charges with application fee 0 (P4-9/P4-10), so the ledger
    has no journal for them.
- **The journal** (pure rules, `integrations/src/accounting/domain.ts`): credits sales and
  donations, debits refunds, fees and payouts (the bank account), and the **clearing account**
  (money Yayatoh or the processor holds for the organizer) takes the balance, so every journal sums
  to zero. Zero lines are left out; a negative fee line flips to a credit. Integer minor units;
  sent to providers as exact decimals built from the integers (`minorToDecimal`), never floats.
- **Chart-of-accounts mapping** (`account_maps`, versioned): one provider account per category
  (sales, donations, refunds, fees, payouts, clearing) with the code and name it had, and the first
  day to post (`starts_on`, today or up to 366 days back). Every category is required; the clearing
  account may not be shared (its line is the balance); income categories may share an account. The
  console reads the chart live from the provider through the port (`chartOfAccounts`), and the
  save resolves every chosen id against it. A new version applies to new postings and to unsent
  journals; it never re-posts a day that stands.
- **Journals** (`accounting_journals`): one row per sent entry — `journal` (revision n) or
  `reversal` (of revision n, the same lines with opposite signs, the same day) — with the lines
  exactly as sent, the totals they came from and the provider's id. **Idempotency key:**
  `yayatoh:{org}:{day}:{currency}:r{revision}[:reversal]` (unique), sent as QuickBooks' `requestid`
  and Xero's `Idempotency-Key`.
- **Re-posting on correction** (`planDay`): each run recomputes every day from the mapping's first
  day to yesterday. What stands in the books is the newest posted journal no posted reversal
  undoes. Same totals → nothing new (a re-run writes nothing). Different totals → a reversal of the
  standing journal, then the next revision (or only the reversal when the day went back to zero).
  Rows that never reached the provider are replaced (`superseded`, no provider effect); a row whose
  outcome is uncertain (429, 5xx, network) **blocks its day** until its retry (same key) settles.
- **Sending** (`accounting/run.ts`, a step of the M6.4a run after the connector's objects): one
  command prepares the days, then each journal goes through the connector oldest first, a day at a
  time (a reversal always before its replacement; nothing after a failed row), results recorded in
  batches (`recordJournalResults`). Failures land in the errors inbox (`journals` object, step
  `push`, codes only) and retry on its schedule or its Retry button; an uncertain failure stops
  sending for the run; a refusal (401/403) stops the run and the connection is marked revoked
  within it (M6.4a).
- **Connectors** (`src/connectors/quickbooks.ts`, `xero.ts`, availability `general`, objects none,
  `accounting` side): chart of accounts and `postJournal`, each with a fake company (accounts,
  journals, idempotency, refusal of unbalanced or inactive-account entries). Xero manual journals
  are in the base currency only: another currency is refused (`currency_unsupported`) and waits in
  the inbox; Xero accounts without a code are not offered. The SDK gains `AccountingSide` and the
  port an optional, checked `headers` field (Xero's `Xero-tenant-id`; never credentials).
- **Console** (connection page, design v2 components, 13 locales, RTL): the "Chart of accounts"
  form (a Select per category with the provider's accounts, a date picker for the first day,
  inline errors, success with the version; read-only for managers) and the "Daily journals" table
  (day, currency, entry and revision, debit total, status with the failure reason, the provider's
  reference), with empty states that say what to do next.
- **Dev/CI:** `/api/dev/accounting/fixture` books a fixture day (two sales, a refund, a payout) or a
  late refund on it with the real ledger functions (404 unless dev auth).

**Later / Not yet:**
- **Zero-fee orders are not in the ledger:** `postSaleTx`/`postRefundTx` post nothing when every
  line is zero (an `organizer_mor` sale with no application fee, a refund that gives no fee back), so
  their gross is missing from the summaries too. The summaries follow the ledger by design; closing
  this gap means memo-only journals in payments (owner inbox).
- Stripe's processing fees on the organizer's own account (`organizer_mor`) are not in the ledger and
  so not in the journal; disputes and transfer reversals are not summarized yet.
- Per-event classes/tracking categories (QuickBooks classes, Xero tracking) and a per-category
  memo per event.
- Multi-currency Xero (needs a bank account per currency); closed periods at the provider surface as
  a refusal in the inbox (no automatic move to the next open day).
- Real endpoints are UNVERIFIED until the owner's Intuit and Xero apps and Nango integrations exist
  (owner inbox); the Nango QuickBooks proxy is assumed to carry the company (realm) in its base URL.

### 4. Acceptance
| Criterion | Test |
|---|---|
| A day's journal equals the ledger memo entries to the cent (sales, fees, refunds, payouts, donations) | `packages/testing/tests/accounting.int.test.ts` › "a day’s journal equals the ledger memo entries to the cent" (fixture day with platform/organizer sales, an organizer-collected sale, refunds with and without fee back, a payout, a paid gift and a gift refund, edges at 00:01, 23:59 and the next midnight; truth computed straight from the memos) |
| A correction re-posts once; a re-run of the same day writes nothing new | int › "a re-run of the same day writes nothing new", "a late refund re-posts the affected day once…" (reversal undoes revision 1 exactly, the books net to the corrected day, a further run adds nothing); unit `modules/integrations/tests/accounting.test.ts` (`planDay`); e2e › "connect, map accounts, post a day, correct it and see the repost" |
| Idempotency by org + day + revision | int (keys asserted), "a provider outage retries with the same key and lands once…", "the fake books post a requestid once" |
| Tokens never logged | int › "tokens never reach a row, an error, an audit entry, an event or a log" (canaries) |
| A revoked connection stops within one run | int › "a revoked connection stops within one run" (refusal mid-run and revoke between runs); e2e › "revoked at the provider…" |
| Mapping validated and versioned; Xero base currency | int › "lists the provider’s active accounts and validates a save", "a mapping change applies to new postings…", Xero › "posts base-currency days…"; unit domain tests; e2e validation steps |
| Permissions and isolation | int (viewer refused, another org `not_found`, disconnected `invalid_state`); e2e › "a viewer cannot open an accounting connection"; isolation suite (fixture rows for both orgs) |
| E2E: connect (fake), map accounts, post a day, correct it and see the repost; keyboard only; axe both themes; RTL | `apps/web/e2e/accounting.spec.ts` (5 tests × 3 viewports) |

### 5. Migration
`packages/db/drizzle/0142_tan_golden_guardian.sql` (renumbered at merge): `integrations.account_maps`
and `integrations.accounting_journals` (generated: FORCE RLS, policies, org-leading indexes,
composite FKs to `connections`, a self FK from a reversal to its journal). No hand edits. Additive
only.
