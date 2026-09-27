# M1.6 — Payments operations and payouts

Roadmap: M1.6; ADR 0005 (hybrid funds flow and ledger); roadmap §5.3. Delivered in increments:

| # | Increment | Scope | Risk tags |
|---|---|---|---|
| a | Double-entry ledger | `payments.post_journal` (owner `ledger_writer`), sale journals for both funds flows, balances | payments, db-migration |
| b | Refunds | full, partial and per line; refund policy engine with the platform minimum; provider refunds on the right account; ledger reversals | payments |
| c | Settlements and transfers at release | release tiers and reserves (defaults pending D3), settlement batches, transfers, explicit transfer reversals and receivables; the organizer's settlement view | payments |
| d | Disputes | dispute webhooks, fund holds (held → reserve → receivable), the evidence packet for human review | payments |

Live money stays gated on the counsel items in roadmap §5.3 and owner decision **D3** (release tiers, reserves, fee-refund policy). Everything runs on the fake provider until the owner's Stripe account exists.

## M1.6a — double-entry ledger (done)

- **Tables** (tenant, RLS): `payments.journal_entries` (idempotency key unique per org, kind, reference, occurred at, memo) and `payments.postings` (account, signed integer minor units — debit positive, credit negative — currency). Every journal is about one org; platform accounts are postings too, so platform totals are the sum over orgs (staff, `platform_reader`).
- **Accounts:** `platform:stripe_cash`, `platform:platform_fee_deferred`, `platform:platform_fee_revenue`, `platform:processing_fee_expense`, `org:payable_held`, `org:payable_releasable`, `org:reserve`, `org:receivable` (a CHECK constraint keeps it to this list).
- **One writer.** `payments.post_journal` is SECURITY DEFINER, owned by the NOLOGIN role `ledger_writer` (created by `db:bootstrap`; production gets it from the owner-run role runbook). It refuses another org's journal, fewer than two lines, and any currency that does not sum to zero; a repeated idempotency key returns the first journal. `app_user` can only SELECT its org's rows: no INSERT, UPDATE, DELETE or TRUNCATE for anyone but the table owner. Corrections are reversing journals.
- **Sales.** When a verified provider event marks an order paid, the same transaction posts `sale:<orderId>`:
  - `platform_mor`: `stripe_cash` +total; `payable_held` −(total − fee); `platform_fee_deferred` −fee.
  - `organizer_mor`: the charge is on the organizer's account; the platform books only the application fee (`stripe_cash` +fee; `platform_fee_revenue` −fee), with the gross as a memo for reconciliation.
  - Free orders post nothing.
- **Reading.** `payments.ledgerBalances` (`finance:read`: owner, admin, finance, and staff) — per account and currency. The staff console shows it on the tenant page.
- **Later in M1.6:** processing-fee expense from actual Stripe fees, fee recognition at event end (deferred → revenue), daily three-way reconciliation (ledger vs Stripe balance transactions vs transfers).

### Acceptance (M1.6a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A paid order posts one balanced sale journal in the same transaction | `packages/testing/tests/ledger.int.test.ts` |
| AC2 | **Property (roadmap):** over 60 seeded random sales in both flows, with replays, cash equals organizer payables plus platform fees and every posting sums to zero | `ledger.int.test.ts` |
| AC3 | Unbalanced journals, another org's journal and direct INSERT/UPDATE/DELETE are refused | `ledger.int.test.ts` |
| AC4 | Balances need `finance:read`; orgs never see each other's; ledger tables have fixture rows for isolation | `ledger.int.test.ts`, `isolation.int.test.ts` |
