# Spec: M4.8 — Gala donations

- **Milestone:** M4.8 (Phase 4 plan `docs/plans/phase-4.md` §6, decisions P4-9 to P4-17, approved 2026-09-28; Wave B)
- **Status:** M4.8a and M4.8b built (2026-10-02), M4.8c–M4.8g built (2026-10-03)
- **Risk tags (M4.8b):** `db-migration`, `payments`, `tenancy`, `legal-copy`
- **Risk tags:** `db-migration`, `payments`, `tenancy`
- **Related ADRs:** 0005 (hybrid funds flow and ledger), 0014 (public output allowlists), 0018 (tokens only), 0021 (module layout)

## M4.8a — donations module and giving page (done)

### 1. Goal and users
A gala or community host raises money at their event: campaigns with a goal, giving levels ("$1,000 funds a classroom"), and a phone-first public giving page. Guests give with a level or their own amount, may cover the processing fee, dedicate the gift and choose how their name appears. The gift is paid straight into the charity's own Stripe account (a direct charge, no Yayatoh fee). The host sees totals and the gifts (names only as donors chose) and exports the list.

### 2. References
- **Plan:** `docs/plans/phase-4.md` §6, row M4.8a; P4-9 (organizer_mor direct charges only), P4-10 (no Yayatoh fee; optional fee cover, off by default), P4-13 (anonymity; no donor list on public pages), P4-16 (`source` leaves room for auctions), P4-17 (employer name, exported).
- **Decisions:** `docs/decisions.md` 2026-09-28 rows "Donations: organizer_mor direct charges only" and "No Yayatoh fee on donations".
- **Legacy evidence:** donation ticket types only (`ticketing.ticket_types.is_donation`, unchanged).

### 3. Scope
**In:**
- The `donations` module (tier 5) with a `MODULE.md`: campaigns (goal and own-amount limits in the event's currency, open/closed), giving levels (name, amount, optional description), gifts.
- The public giving page `/events/{slug}/give` (published, listed events): level buttons or an own amount within the campaign's limits, one-off gifts, "cover the processing fee" with the exact amount (off by default), tribute (in honor of / in memory of, with an optional person to tell and a note), how the name appears (full name, first name only, anonymous: no default, the donor chooses), employer. Thank-you page `/events/{slug}/give/thanks?g=<signed gift link>`.
- Payment: an order with a **donation item** (`orders.donation_items`; no ticket lines), `organizer_mor` on the connected account, **application fee 0**, through the existing provider port (fake provider in dev/CI) and webhook path (`orders.applyProviderEvent` → `order.donation_paid@1` → `donations.gift-outcomes`). Idempotency-Key on the gift command (the page's form key) and on the provider payment (`order:<id>:1`).
- Unconnected orgs: "Connect Stripe to accept gifts" on the tab (with "Set up payouts" for those who manage payouts); `startGift` refuses (`not_connected`); the public page says online giving isn't open.
- The Donations tab (gala and community profiles) replaces its placeholder: campaigns, levels, totals (raised, gift count, fees covered), the paid gifts with each name as the donor chose ("Anonymous"), pending count, CSV export (bulk `donations.giftsCsv`: `attendees:export`, step-up, audited, refused under impersonation).

**Out (later):**
- Receipts, charity profile, fair-market value (M4.8b); paddle raise (M4.8c); live screen and QR-to-give (M4.8d); saved cards and pledges (M4.8e); matches (M4.8f); reports and reconciliation (M4.8g).
- Refunds of gifts from the console (the orders refund path is ticket-shaped; a gift refund lands with M4.8e/g).
- A link to the giving page on the public event page and the tenant-site copy of the giving page (`/t/{org}/…`): the host shares the link from the tab for now.
- Data-subject requests (export and erasure, `privacy.eraseSubject`) do not reach gifts yet: privacy and donations are both tier 5, so privacy cannot call donations synchronously, and a receipt record must outlive an erasure (M4.8b, counsel; owner inbox). It lands with M4.8b, through an erasure event or a tier change. Lapsed gifts already lose their donor after 30 days (retention).
- Recurring gifts; custom display names ("The Smith Family", P4-13): the brief asks for full / first / anonymous.

### 4. `touches:`
```yaml
touches:
  - packages/modules/donations/**                       # new module
  - packages/modules/orders/src/{schema,private-columns,index,donation-orders}.ts
  - packages/modules/orders/src/commands/checkout.ts    # applyProviderEvent routes gift orders (6 lines)
  - packages/db/drizzle/0099_yummy_young_avengers.sql   # + meta (renumbered at merge)
  - packages/testing/{package.json,src/fixtures.ts,src/ports.ts,src/canary/{registry,org}.ts}
  - packages/testing/tests/{donations,freeze,impersonation}.int.test.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/donations/**
  - apps/web/src/app/[locale]/events/[slug]/give/**
  - apps/web/src/app/api/dev/user/route.ts              # profile=…, payouts=active (dev only)
  - apps/web/src/server/bulk.ts, apps/web/messages/*.json, apps/web/package.json
  - apps/web/e2e/{donations.spec.ts,helpers.ts,canary-crawl.spec.ts}
  - apps/worker/{package.json,src/registry.ts,src/bulk.ts,src/retention.ts}
  - packages/modules/command-center/src/domain/readiness.ts  # donations leaves PLACEHOLDER_SECTIONS
  - apps/web/tests/event-routes.test.ts, packages/testing/tests/privacy.int.test.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `donations.campaigns` | new | event, name (unique per event), description, `goal_minor`, currency (the event's), `min_gift_minor`/`max_gift_minor`, status open/closed, position |
| `donations.levels` | new | campaign, name, `amount_minor` (unique per campaign), description |
| `donations.gifts` | new | event, campaign, level (cleared when the level goes), order, status pending/paid/failed/expired, source `online`, `amount_minor`, `fee_cover_minor`, currency, donor name/email, `display_as`, employer, tribute kind/name/recipient/note, locale, `paid_at` |
| `orders.donation_items` | new | the gift order's item: order (unique), gift (unique), name, `amount_minor`, `fee_cover_minor`, currency |

**RLS notes:**
- [x] All four tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs, org-scoped uniques).
- [x] Fixture rows for both orgs (`createOrgFixture` → `donationRows`: a campaign, a level, a lapsed gift with its order and donation item).
- [x] Text columns declared in `private-columns.ts` (donations; orders' `donation_items`); donor name/email, employer and tribute are `personal`.

**Migration:** `0099_yummy_young_avengers.sql` (to be renumbered), additive only. Hand-written block: `campaigns_event_fk` (→ `events.events`, cascade), `gifts_event_fk` and `gifts_order_fk` (no action: money records), `gifts_level_fk … ON DELETE SET NULL ("level_id")`.

### 6. API diff
None (`/v1` unchanged).

### 7. Events
- New: `order.donation_paid@1` `{orgId, orderId, eventId, giftId, totalMinor, currency, via}` (orders, in place of `order.paid@1` for gift orders: no tickets, mailers, journeys or ticket sales metrics).
- Consumed by `donations.gift-outcomes`: `order.donation_paid@1`, `order.payment_failed@1`, `order.expired@1`.

### 8. Entitlements and flags
Entitlement `donations` (already in `launch_standard`; the gala and community profiles list the tab). Online giving needs an active payout account (organizer_mor).

### 9. ELT impact
None yet (M4.8g reports).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.8a-01 | A gift charges exactly the chosen amount plus the fee cover, on the connected account, with application fee 0 (the fake provider's recorded charge) | `packages/testing/tests/donations.int.test.ts` ("a level gift with the fee cover charges exactly…"); e2e `apps/web/e2e/donations.spec.ts` ("a donor gives with a level…": `amount=103018`, `acct=fakeacct_…`, `fee=0`) |
| AC-M4.8a-02 | An unconnected org cannot open the page or take a gift; the tab says "Connect Stripe to accept gifts" | int "an unconnected org refuses gifts…"; e2e "an org without a connected account…" |
| AC-M4.8a-03 | Anonymous gifts never show a name in any public payload; the public payload carries no donor, tribute, employer or per-gift amount | int "the public payload never carries…"; unit `packages/modules/donations/tests/giving.test.ts` (allowlist); canary crawl `apps/web/e2e/canary-crawl.spec.ts` (giving page in the crawl, campaign shown); e2e page-content check |
| AC-M4.8a-04 | Webhook replay never double-counts (same event id, another event id for the same payment, replayed outbox) | int "webhook replays and duplicate deliveries…" |
| AC-M4.8a-05 | Isolation: every new table covered; another org can neither read nor give to this org's campaign | `isolation.int.test.ts` (fixture rows); int "another org can neither see…", "another org cannot give…" |
| AC-M4.8a-06 | Impersonation: the gift CSV and deleting a level are refused while staff act as a member; freeze refuses every donations command | `impersonation.int.test.ts` (registry + lists), int "needs a recent step-up…"; `freeze.int.test.ts` (module list) |
| AC-M4.8a-07 | Level or own amount within limits (min/max messages), fee cover computed by the server, closed campaigns refused, failed/lapsed payments not counted, a late payment counts | int "own amounts stay within…", "a closed campaign…", "failed and lapsed…"; unit `giving.test.ts` (fee cover, limits) |
| AC-M4.8a-08 | One Idempotency-Key is one gift; none is refused | int "one Idempotency-Key is one gift…" |
| AC-M4.8a-09 | Host flow: campaign and level validation, success messages, persistence after reload, closing a campaign | e2e "the host sets up a campaign and levels…" |
| AC-M4.8a-10 | An anonymous gift appears as "Anonymous" in the host's list; first-name donors by first name only; totals and fees covered | e2e "a donor gives…" (host table) ; int console assertions |
| AC-M4.8a-11 | CSV export with step-up lists donor, email, shown-as, employer and tribute; viewers cannot export | e2e "a donor gives…" (step-up dialog, CSV), "a viewer sees the tab…" (404); int "lists paid gifts…" |
| AC-M4.8a-12 | Viewer: hidden write controls and refused direct actions | e2e "a viewer sees the tab…"; int "viewers read the tab but cannot change…" |
| AC-M4.8a-13 | Keyboard only; axe on every new screen and state; Arabic RTL | e2e "keyboard only…", every test calls `expectAccessible`, "Arabic: …" |
| AC-M4.8a-14 | Retention: a gift left unpaid loses its donor (name, email, employer, tribute) after 30 days, not before; paid gifts and other orgs untouched; idempotent; members cannot run it | int "retention erases the donor of a gift left unpaid…"; `impersonation.int.test.ts` (`donations.retention` is `delete`); `apps/worker/tests/retention.int.test.ts` (the daily pass) |

### 11. Security and privacy
- Lapsed gifts (failed or expired, 30 days) lose their donor in the daily retention pass (`donations.retention`, worker), as their orders lose the buyer.
- No donor data in any public response: the giving page's DTO (`PublicGivingDto`) is an allowlist of campaign text, levels and totals; the thank-you page is reached by an HMAC-signed gift link and shows status and amount only.
- The host list shows names only as donors chose; the donor's own name and email leave only through the step-up CSV export. Audit rows hold ids and amounts, never donor details.
- The fee cover and amounts are computed server-side; the form cannot set them. The giving form is rate-limited (`checkoutStart`) and passes the checkout risk rules.
- Every query runs under RLS (`withTenant`); commands check the campaign belongs to the given event.

### 12. Performance budget
The tab loads the event's campaigns, their levels and the latest 500 paid gifts; totals are one grouped sum. The public page reads open campaigns and one grouped sum.

### 13. Rollout
Behind the `donations` entitlement and the gala/community profiles. Live money waits for the owner's Stripe account (fake provider until then).

### 14. Increment breakdown
| # | Increment | Scope | Risk tags |
|---|---|---|---|
| 1 | M4.8a | Module, giving page, gift orders, Donations tab | `db-migration`, `payments`, `tenancy` |
| 2 | M4.8b–g | See the plan §6 | — |

### 15. Demo checklist
- [ ] As a new owner (dev: `/api/dev/user` with `org=new&twoFactor=1&event=published&profile=gala&payouts=active`), open the event's **Donations** tab.
- [ ] Add "Scholarship Fund" (goal 25000, own amounts 10–5000) and a level "Classroom" at 1000.
- [ ] Open the giving page; choose Classroom, tick the fee cover ($30.18), give anonymously in memory of someone, employer "Acme Corp"; pay on the test page.
- [ ] Give again with an own amount (25), first name only.
- [ ] Back on the tab: $1,025.00 raised · 2 gifts; "Anonymous" and the first name; export the CSV (step-up).
- [ ] An org without payouts: the tab asks to connect Stripe; the giving page says giving isn't open.

### 16. Gate (2026-10-02, on merge/next-3e + next-3f + m0.5-foundation)
`pnpm verify` green (typecheck with `--concurrency=2`): 2318 unit, 1314 integration. E2E on all three projects: `donations`, `canary-crawl`, `checkout`, `payouts`, `step-up`, `command-center`, `social-workspace`, `bulk-actions`, `seat-assignment`, `alerts`, `staff-mode`, `tenant-account-corner`, `maintenance`, `journeys`, `campaigns`, `audiences`: all passed (the canary crawl runs on desktop only, by design). `agent/design-v2` is not merged: it conflicts with batch 3f's files (helpers, messages, portal pages, migration journal), left to the batch 3h merge.

### 17. Owner tasks
`docs/owner-inbox.md` → Phase 4 donations: the processing-fee rate donors may cover (standard 2.9 % + 30¢ vs a nonprofit rate), the default own-amount limits, and whether "how my name appears" should default to a choice.

## M4.8b — charity profile and receipts (done)

### 1. Goal and users
A charity's donors and gala guests get a proper receipt for every payment, by email and as a PDF in their language, showing what is tax-deductible. The org enters its charity details once (legal name, EIN, 501(c)(3) status or a fiscal sponsor); Yayatoh staff check them against the IRS exempt-organization list. Gala ticket types carry a fair-market value, and their ticket pages tell buyers how much of the price is deductible before they buy. Donors get a year-end statement of the year's deductible payments.

### 2. References
- **Plan:** `docs/plans/phase-4.md` §6, row M4.8b; P4-11 (tax receipts, `legal-copy`), P4-13 (donor privacy).
- **Decisions:** `docs/decisions.md` 2026-09-28 rows "Tax receipts for verified charities only", "Donations: organizer_mor direct charges only" (no tax-deductibility wording on `platform_mor`), "Donor privacy".
- **IRS:** the Exempt Organizations Business Master File extract (`eo1.csv`–`eo4.csv`, public bulk download); IRC §170(f)(8) (written acknowledgment), §6115 (quid-pro-quo disclosure over $75).

### 3. Scope
**In:**
- **Charity profile** per org (`/o/{org}/charity`, linked from Settings and from the event's Tax receipts page): legal name, EIN (normalized `12-3456789`, impossible prefixes refused), exempt status (own 501(c)(3) or fiscal sponsor, whose name and EIN then print on receipts), optional mailing address. Any change sends it to review again (new version); saving the same details changes nothing. Members read it; owners and admins (`org:update`) change it.
- **Staff verification** in the admin app (`/charities`, staff action `charities`: admins and support): the waiting list (platform_reader, access-logged), the review page beside the IRS record for the EIN (the sponsor's for a sponsored project), name match hint, eligibility (subsection 03, deductibility 1, status 01–03), verify (optional note), reject or withdraw a verification (note the org sees). Verdicts are audited platform commands (`donations.verifyCharity`, `donations.rejectCharity`, `platform:charity.verify`) for the version reviewed (a profile changed meanwhile is refused as `stale`). The IRS record is looked up again on the server, never taken from the form.
- **`ExemptOrgLookup` port:** `recordedExemptOrgLookup` (a recorded fixture in the EO BMF layout, invented organizations) in dev/CI; `bulkFileExemptOrgLookup` streams the downloaded files (`IRS_EO_BMF_DIR`); none otherwise (staff see the list isn't loaded and cannot verify). The download is an owner-run job (`pnpm --filter @yayatoh/worker irs-exempt-list`); no test calls the IRS.
- **Fair-market value per ticket type** (`donations.ticket_fair_values`, set on the event's Tax receipts page: value per ticket and what buyers receive; `events:write`). A ticket type with a value turns receipts on for its orders.
- **Quid-pro-quo notice** on the public ticket page (and the widget) for ticket types over $75 with a value, when the org is verified and sells to its own connected account: "Of your $500.00 payment, $350.00 is tax-deductible. The estimated fair-market value of the goods and services you receive is $150.00." The host's page previews it.
- **Receipts**, one per payment (`donations.receipts`, numbered R-00001 per org, gap-free): every paid gift order, and every paid ticket order with at least one ticket type with a value. Deductible = paid − fair-market value (never below 0; a line without a value counts at its full price; the platform's booking fee is not part of the payment to the charity). A gift: "No goods or services were provided in exchange for this contribution." Tax-deductible only for a verified charity on `organizer_mor` in USD; otherwise a plain "Payment receipt … This payment is not tax-deductible." Issued by the `donations.receipt-issuer` subscriber (`order.paid@1`, `order.donation_paid@1`), mailed to the donor only (`donations.receipt`, body = the legal text) with a signed PDF link `/receipts/{orgId}/{token}`; the host's list and PDF on the Tax receipts page. Snapshots of the charity details and the wording version make each receipt immutable.
- **Year-end statements** (`donations.year_end_statements`): the worker's daily pass (`runYearEndStatements`, leader only) runs `donations.yearEndStatements` per org with deductible receipts for the previous calendar year in the org's timezone; one statement per donor email and currency, totalling that year's deductible receipts exactly; reruns issue nothing. Mailed by `donations.statement-mailer` (`donations.year-end-statement`) with a signed PDF link `/statements/{orgId}/{token}`.
- **Legal copy:** every receipt, statement and notice string is in one file, `packages/modules/donations/src/legal/receipt-copy.ts` (`RECEIPT_COPY_VERSION`), marked `LEGAL-COPY` for counsel; English is the source, 12 courtesy translations.
- **PDFs** (Gotenberg, A4, RTL for Arabic) for receipts and statements; golden HTML and PDFs (English and Arabic).

**Later / not yet:**
- Refunds: a refunded payment keeps its receipt; a corrected or voided receipt (and a corrected statement) waits for the gift refund flow (M4.8e/g) and counsel.
- Data-subject requests for gifts and receipts (export, erasure): a receipt is a tax record that must outlive an erasure request; needs counsel (owner inbox).
- Receipt retention period (7 years is common); no purge yet.
- Choose-your-amount (donation) ticket types get receipts like any ticket type with a value, but no quid-pro-quo notice (the price is the buyer's).
- Non-US charities and other currencies (US/USD first, P4-11); per-org receipt signature/logo; a "resend receipt" button; statements on demand from the console.
- Pledges, paddle raise and offline payments (M4.8c/e) will issue receipts through the same `issueReceiptTx` once they are paid.

### 4. `touches:`
```yaml
touches:
  - packages/modules/donations/**                      # charity.ts, fair-value.ts, receipts.ts, receipt-document.ts, exempt-orgs/**, legal/receipt-copy.ts, domain/receipts.ts; schema/index/private-columns appended
  - packages/modules/orders/src/{receipt-facts,index}.ts      # receiptOrderFactsTx (new file + one export)
  - packages/modules/ticketing/src/{fair-value-facts,index}.ts # ticketTypePricesTx (new file + one export)
  - packages/modules/notifications/src/{kinds.ts,templates/samples.ts,templates/messages/*.json}  # two kinds, 13 locales
  - packages/db/drizzle/0100_lush_vertigo.sql          # + meta (renumbered at merge)
  - packages/testing/src/fixtures.ts                   # receiptRows
  - packages/testing/tests/receipts.int.test.ts, apps/worker/tests/charity-review.int.test.ts
  - apps/web/src/app/[locale]/o/[org]/(org)/{charity/**,settings/page.tsx}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/donations/{page.tsx,receipts/**}
  - apps/web/src/app/[locale]/{receipts,statements}/[org]/[token]/route.ts
  - apps/web/src/app/api/dev/charity/route.ts           # dev only
  - apps/web/src/components/public-event-view.tsx       # the notice
  - apps/web/src/server/{notifications,receipt-pdf}.ts, apps/web/messages/*.json
  - apps/web/e2e/receipts.spec.ts
  - apps/admin/src/{app/charities/**,server/charities.ts,server/staff-roles.ts,components/shell.tsx}, apps/admin/messages/en.json
  - apps/admin/e2e/charities.spec.ts, apps/admin/tests/staff-roles.test.ts, apps/admin/package.json
  - apps/worker/{src/registry.ts,src/main.ts,src/year-end.ts,scripts/irs-exempt-list.ts,package.json}
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `donations.charity_profiles` | new | one per org: legal name, EIN, `exempt_kind` (`501c3`/`fiscal_sponsor`), sponsor name/EIN, address, status pending/verified/rejected, version, submitted/reviewed at, reviewed by, review note, `irs_*` (what the list said at verification) |
| `donations.ticket_fair_values` | new | ticket type (unique per org), event, `fmv_minor`, currency, description |
| `donations.receipt_sequences` | new | per-org counter (row lock) |
| `donations.receipts` | new | order (unique), event, gift, number (unique per org), kind gift/ticket, `deductible`, donor name/email, locale, currency, amount/FMV/deductible minor, goods, charity name/EIN, sponsor name/EIN, address, `paid_at`, `tax_year` (org timezone), `copy_version` |
| `donations.year_end_statements` | new | tax year, donor email, currency (unique together per org), donor name, locale, receipt count, totals, charity snapshot, `copy_version` |

**RLS notes:**
- [x] All five tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, org-scoped uniques).
- [x] Fixture rows for both orgs (`createOrgFixture` → `receiptRows`: a verified profile, a value on the fixture's ticket type, the receipt of its paid order, a statement).
- [x] Text columns declared in `private-columns.ts`: donor name/email `personal`; the charity's legal name, EIN, address and sponsor are public record (they print on receipts); staff review data `internal`.

**Migration:** `0100_lush_vertigo.sql` (to be renumbered), additive only. Hand-written block: `ticket_fair_values_ticket_type_fk` (→ `ticketing.ticket_types`, cascade), `ticket_fair_values_event_fk` (→ `events.events`, cascade), `receipts_order_fk` (→ `orders.orders`), `receipts_event_fk` (→ `events.events`), `receipts_gift_fk` (→ `donations.gifts`) (no action: tax records).

### 6. API diff
None (`/v1` unchanged).

### 7. Events
- New: `donations.charity_submitted@1`, `donations.charity_verified@1`, `donations.charity_rejected@1` `{orgId, profileId, version}`; `donations.statement_issued@1` `{orgId, statementId, year}`.
- Consumed: `donations.receipt-issuer` ← `order.paid@1`, `order.donation_paid@1`; `donations.statement-mailer` ← `donations.statement_issued@1`.

### 8. Entitlements and flags
Entitlement `donations` (profile and values); staff verdicts and the yearly pass are platform commands (no entitlement). `IRS_EO_BMF_DIR` (the downloaded list).

### 9. ELT impact
None.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.8b-01 | A $500 ticket with a $150 FMV gives a receipt with $350 deductible | unit `packages/modules/donations/tests/receipts.test.ts`; int `packages/testing/tests/receipts.int.test.ts` ("a $500 ticket…"); e2e `apps/web/e2e/receipts.spec.ts` ("a $500 ticket with a $150 fair-market value…", mailbox) |
| AC-M4.8b-02 | A $100 gift with nothing in return says "No goods or services were provided" | unit golden (`golden.test.ts`); int ("a $100 gift…"); e2e ("a donor gives and receives the receipt in the dev mailbox…") |
| AC-M4.8b-03 | An unverified org issues only "not tax-deductible" receipts (and no notice) | unit (`isDeductibleReceipt`); int ("an unverified org…", notices); e2e ("an unverified org issues only…", "set a fair-market value…" before verification) |
| AC-M4.8b-04 | Golden PDFs in English and Arabic | `packages/modules/donations/tests/golden.test.ts` (HTML) and `golden.int.test.ts` (Gotenberg render, text per page; receipts and statement in en/ar) |
| AC-M4.8b-05 | A year-end statement totals exactly (org timezone; once per donor; not before the year ends) | unit (`statementTotals`, `taxYearOf`, `statementYearDue`); int ("one statement per donor…") |
| AC-M4.8b-06 | Isolation: every new table covered; another org cannot read a receipt, its PDF link or its statement | `isolation.int.test.ts` + `canary.int.test.ts` (fixture rows); int "isolation: one org never reads…", token checks |
| AC-M4.8b-07 | Impersonation and freeze: staff acting as a member cannot verify or write statements; the freeze refuses profile, value, review and statement writes while receipts of completed payments still issue | int "impersonation and the read-only freeze"; `freeze.int.test.ts` and `impersonation.int.test.ts` sweeps (every exported command) |
| AC-M4.8b-08 | Create the profile with every validation message; persisted after reload; waits for review | e2e "the owner creates the charity profile…" |
| AC-M4.8b-09 | Staff verify against the IRS list (fixture), audited; reject with a note the org sees; ineligible records cannot be verified; stale versions refused; finance refused | admin e2e `apps/admin/e2e/charities.spec.ts`; int `apps/worker/tests/charity-review.int.test.ts` (access log, audit actor), receipts int (only staff, stale, mismatch, ineligible) |
| AC-M4.8b-10 | Set FMV (validation, success, persistence); the verified charity's ticket page shows the notice; removing the value removes it | e2e "set a fair-market value; …notice" |
| AC-M4.8b-11 | Give and receive the receipt in the dev mailbox, with a working PDF link; only the donor gets it; the host sees it with its PDF | e2e "a donor gives and receives the receipt…"; int (one message per receipt, replays) |
| AC-M4.8b-12 | Viewers read the profile and receipts but see no write controls; unknown receipt PDFs are 404 | e2e "a viewer reads…"; int (viewer refused) |
| AC-M4.8b-13 | Keyboard only, axe on every new screen and state, Arabic RTL (profile, receipts page, ticket notice) | e2e "keyboard only…", "Arabic…", `expectAccessible` throughout; admin e2e keyboard |
| AC-M4.8b-14 | Every locale has every legal string with the same placeholders | unit "the legal-copy template" |

### 11. Security and privacy
- Receipts go only to the payer's email (P4-13); the PDF links are HMAC-signed per receipt and per org (the org id is in the path, never a header), `no-store`, `noindex`, no referrer. The host sees who gave (receipts need it).
- The public notice carries prices and values only. Audit rows of the yearly pass carry the year and a count, never donor data; staff verdicts carry the EIN and the IRS name.
- Staff list profiles through platform_reader (access-logged); verdicts are platform commands in the org (audited with the staff actor).

### 12. Performance budget
Issuing a receipt is a handful of indexed reads per paid order (most ticket orders stop at "no value"). The receipts page lists the latest 500. The yearly pass reads one year's deductible receipts per org.

### 13. Rollout
Behind the `donations` entitlement. Tax-deductible receipts need a verified profile, which needs the owner-run IRS download in production (`IRS_EO_BMF_DIR`) and counsel's review of the legal copy.

### 14. Build notes (2026-10-02)
- Gate: lint, check:modules, typecheck (57/57), unit 2,373 passed, integration 1,339 of 1,340 (the one failure is `apps/worker/tests/retention.int.test.ts` timing out at 30 s in the full run, where the daily pass sweeps every org the suite created; it passes alone). e2e: `receipts.spec.ts` 24/24 (3 projects), `donations`, `checkout`, `canary-crawl`, `email-kind-labels`, `privacy`, `security` 162/162; admin `charities.spec.ts` + `admin.spec.ts` 32/32.
- Not merged: `origin/agent/design-v2` (conflicts outside this increment's files: migration meta, the exhibitors and speakers pages, `e2e/helpers.ts`, the shells and message catalogs). The new screens use only existing `@yayatoh/ui` components (PageHeader, Card, EmptyState, StatusDot, Table, Alert, Button) and `ProgramForm`, so the batch 3h merge restyles them by inheritance.

### 15. Demo checklist
- [ ] As a new owner (`/api/dev/user` with `org=new&twoFactor=1&event=published&profile=gala&payouts=active`), open Settings → **Charity profile**; save "Harbor Arts Alliance", EIN 234567891.
- [ ] In the admin app (staff `omar@yayatoh.test`), **Charities** → open the org → the IRS record (fixture) matches → Verify.
- [ ] On the event's **Tickets & orders**, add "Gala dinner" at 500; on **Donations → Open tax receipts**, set its value to 150 "Dinner and entertainment".
- [ ] Open the public event page: "Of your $500.00 payment, $350.00 is tax-deductible…".
- [ ] Buy one Gala dinner and give $100 on the giving page; drain messages (`/api/dev/outbox/drain`) and open `/dev/mailbox`: two receipts ($350.00 deductible; "No goods or services were provided"); open the PDFs.

### 16. Owner tasks
`docs/owner-inbox.md` → M4.8b: counsel reviews `receipt-copy.ts` (and the translations), run the IRS download job monthly, the staff role for verification, receipts after refunds, donor data requests and receipt retention.

## M4.8c — paddle raise console and spotters (done)

### 1. Goal and users
The fund-a-need moment of a gala: the host or a hired auctioneer calls giving levels from the top down, guests raise numbered paddles, spotters on phones record the numbers, the room's total climbs live, and a recorder turns the recorded paddles into confirmed pledges afterwards. Users: the host and auctioneer (console), volunteers and staff who may scan at the event (spotters), the development lead (recorder), co-hosts.

### 2. References
- **Plan:** `docs/plans/phase-4.md` §6, row M4.8c; P4-12 (a pledge is a promise, never a charge), P4-13 (spotters see paddle numbers only), P4-9 (unconnected orgs can still run a paddle raise that records pledges).
- **Builds on:** M4.8a (campaigns and levels), M4.2b (purchased tables' parties and the guests holding their tickets), M3.1b (realtime channels, the message log and SSE).

### 3. Scope
**In:**
- **Paddle numbers** (`/o/{org}/e/{event}/donations/paddles`): a paddle is a number (1–99,999, unique per event) held by one named guest or one party (a household, or a purchased table's party). **Bulk:** every guest (or party) without a paddle, or only the guests (or parties) of purchased tables, numbered table by table from a chosen first number (default: after the highest, at least 100). **One at a time** at the check-in desk: choose the guest or party, the next free number or a chosen one. Take a paddle back while it has no counted entries. `guests:read` sees the list; `guests:write` gives and takes back.
- **Console** (`…/donations/paddle-raise`): call a level (the campaign's levels, largest first); one level at a time per event; the live panel shows the level being called with its running count and total, the duplicates waiting for the recorder, and the raise's totals (raised by paddle, paddles recorded, confirmed pledges, to review), kept current over the console channel; close the level; **Undo** reverses the room's last step (`undoStep`): while a level is open, the newest paddle waiting for review is set aside (or, with none, the arm is withdrawn); after a close, the level reopens; confirmed pledges are never undone here. `orders:read` watches; `events:write` runs it. A call copies the level's name and amount, so editing the level later never changes what the room pledged.
- **Spotter view** (`…/paddle-raise/spot`), phone first and keyboard first: type the number, Enter (44–56 px targets, numeric keyboard, autofocus, the field keeps focus). The level being called and the event's paddle numbers arrive over the spotters' channel (snapshot on (re)connect), so an unknown or malformed number, or a number typed while no level is called, is refused **on the device** with the reason, even offline. Each entry gets its own id on the device (`crypto.randomUUID()`) and waits in a queue kept in the browser's storage (`@yayatoh/donations/paddle-queue`): it is sent in batches of up to 100 when the network allows (on Enter, every 3 s while anything waits, on the `online` event, or "Send now") and leaves the queue only when the server answered for it. The list of recent entries shows waiting / recorded / already recorded (flagged for the recorder) / refused (and why). `checkin:scan` (box office, managers, door staff and co-hosts on their event).
- **Sync** (`POST …/paddle-raise/sync`, JSON, same-origin only, the member's session; org and event from the path): `donations.recordPaddles` stores each entry **once per device id** (unique per org; a known id gets its stored status back, a parallel duplicate request falls back to the first answer), refuses (does not store) a paddle not given at this event (`paddle_unknown`), a level of another event or org (`call_unknown`) or a withdrawn arm (`call_withdrawn`), and flags the same paddle at the same call as `duplicate` (stored, linked to the first entry, not counted). Late entries for a closed level count (a phone that was offline). A device clock in the future is stored as the arrival time. Batches lock their calls in id order so duplicate checks see every earlier entry.
- **Recorder's review** (`…/paddle-raise/review`): every level called (newest first) with its entries, holders' names (organizer only) and statuses; "Confirm N recorded paddles" turns a level's recorded entries into **pledges** (one per entry, the level's amount, the paddle's holder, `donations.pledges`, status `confirmed`); duplicates are confirmed one by one when the recorder decides they are real; "Set aside" voids an entry (and cancels its pledge if it had one). Refreshes live from the console channel.
- **Realtime** (M3.1b log channels, registered in the web's registry): `event.paddle-spotters` (`checkin:scan`: the call and the paddle numbers, never names or amounts given) and `event.paddle-console` (`orders:read`: the open call and the totals). Both are published inside the writing transaction.
- The Donations tab links to the console, the spotter view and the paddle numbers.

**Later / not yet:**
- Paddles for individual-ticket buyers who aren't guests (galas create guests from purchased tables only): an attendee holder kind, or creating a guest at check-in (pending owner, `docs/owner-inbox.md`).
- Assigning a paddle from the check-in scan itself (the Scan PWA) — today the check-in desk uses the "Give one paddle" form; members with only the `scanner` org role can't open console pages, so spotters need box office, manager or an event's door staff role (the Scan PWA's device tokens are not accepted by the sync).
- Pledge collection (cards on file, invoices, reminders, offline payments, write-offs), donor names on screens, the live thermometer and matches: M4.8d–f. Pledges do not count in the campaign's paid "raised" total until they are paid (M4.8e).
- An own amount called from the floor (only configured levels can be called); a service worker so the spotter page loads with no network at all (the page must be open before the network drops).

### 4. `touches:`
```yaml
touches:
  - packages/modules/donations/src/{domain/paddles.ts,domain/paddle-queue.ts,schema-paddles.ts,paddle-dto.ts,paddle-live.ts,paddles.ts,paddle-raise.ts}  # new files
  - packages/modules/donations/src/{index.ts,private-columns.ts}, package.json (+@yayatoh/guests, ./paddles and ./paddle-queue exports), MODULE.md   # appended
  - packages/modules/donations/tests/paddles.test.ts
  - packages/modules/guests/src/{paddle-holders.ts,index.ts}       # new read helpers + one export block
  - packages/db/drizzle/0115_aromatic_captain_stacy.sql (+ meta)   # renumbered at merge
  - packages/testing/src/fixtures.ts                               # paddleRaiseRows
  - packages/testing/tests/{paddle-raise.int.test.ts,impersonation.int.test.ts}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/donations/{page.tsx,paddles/**,paddle-raise/**}
  - apps/web/src/server/realtime.ts                                # two channels + snapshots
  - apps/web/messages/*.json                                       # donations.{raiseCard,paddles,raise,spot,review}
  - apps/web/e2e/paddle-raise.spec.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `donations.paddles` | new | event, number (unique per event), guest **or** party (exactly one; one paddle per guest and per party) |
| `donations.paddle_calls` | new | event, campaign, level (set null when the level goes), level name and amount copied, currency, status open/closed/withdrawn (one open per event), opened/closed at |
| `donations.paddle_entries` | new | event, call, `client_id` (the device's id, unique per org), paddle (set null when it goes) and number, status recorded/duplicate/confirmed/voided, duplicate of, spotter user id, recorded at (device clock), reviewed at |
| `donations.pledges` | new | event, campaign, call, entry (unique), paddle number, guest or party (set null when they go), amount, currency, status confirmed/cancelled, source `paddle`, confirmed/cancelled at |

**RLS notes:**
- [x] All four tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, org-scoped uniques, composite FKs).
- [x] Fixture rows for both orgs (`paddleRaiseRows`: the fixture party's paddle, a called and closed level, one entry confirmed into a pledge).
- [x] Text columns declared in `private-columns.ts` (level name public, statuses and currency vocab, the spotter's user id internal).

**Migration:** `0115_aromatic_captain_stacy.sql` (0113 on agent/m4.8c; renumbered after M4.4a's 0113/0114 when M4.8e stacked them) (to be renumbered), additive only. Hand-written block: `paddles_event_fk`, `paddle_calls_event_fk`, `paddle_entries_event_fk` (→ `events.events`, cascade); `paddles_guest_fk` / `paddles_party_fk` (→ `guests.guests` / `guests.parties`, cascade); `paddle_calls_level_fk` (→ `donations.levels`, `SET NULL (level_id)`); `paddle_entries_paddle_fk` (→ `donations.paddles`, `SET NULL (paddle_id)`); `pledges_event_fk` (→ `events.events`, no action: a money promise, like a gift); `pledges_guest_fk` / `pledges_party_fk` (`SET NULL (guest_id)` / `(party_id)`).

### 6. API diff
None on `/v1`. One web route: `POST /o/{org}/e/{event}/donations/paddle-raise/sync` (session, JSON, same-origin).

### 7. Events
None on the outbox. Realtime messages only (`state` on both channels).

### 8. Entitlements and flags
`donations` (every command, query and both channels). Permissions: `guests:read`/`guests:write` (paddles), `orders:read` (console, review), `events:write` (arm, close, undo, confirm, set aside), `checkin:scan` (spotters). Taking a paddle back is category `delete` (refused while staff impersonate). The read-only freeze refuses every write.

### 9. ELT impact
None (no legacy equivalent).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.8c-01 | 30 spotters record 400 paddles, half of them offline for 2 minutes (synced after the level closed), with lost answers and parallel replays: exactly 400 entries, 400 distinct paddles and device ids, all recorded, the level's total = 400 × its amount | int `packages/testing/tests/paddle-raise.int.test.ts` ("acceptance: 30 spotters…"); unit `packages/modules/donations/tests/paddles.test.ts` (same run against the queue) |
| AC-M4.8c-02 | The keyboard-only path works: the host calls a level with Enter; the spotter types numbers and Enter with the field keeping focus | e2e `apps/web/e2e/paddle-raise.spec.ts` ("the room…") |
| AC-M4.8c-03 | A paddle not given at this event is refused: on the device (with its number) and by the server (not stored); a level of another event or org and a withdrawn arm are refused | e2e "the room…" (999); int "records entries…", "undo…", "another org sees none of it…" |
| AC-M4.8c-04 | Duplicates are flagged for the recorder and never dropped; a replayed entry is stored once and gets its first answer | int "records entries…"; e2e "the room…" (flagged), "an offline spotter…" (replay) |
| AC-M4.8c-05 | An offline spotter's entries wait on the phone (count shown, page reload keeps them) and sync once when back; nothing reaches the console meanwhile | e2e "an offline spotter…"; unit queue tests |
| AC-M4.8c-06 | Paddles: bulk by table (or all), from a start number, the next free number at the desk, a taken number and a second paddle refused, take back refused once recorded | int "paddle numbers" block; e2e "paddle numbers…" |
| AC-M4.8c-07 | Console: one level at a time, close, undo (void newest, withdraw empty arm, reopen), live running total | int "arms one level…", "undo…"; e2e "the room…" |
| AC-M4.8c-08 | Recorder: confirm a level's recorded paddles into pledges once (amount and holder), duplicates one by one, set aside cancels a pledge | int "the recorder…"; e2e "the room…" |
| AC-M4.8c-09 | Spotters and the live channels never carry names or amounts given (P4-13) | int "arms one level…" (realtime log scan) |
| AC-M4.8c-10 | Permissions: door staff record on their event only and cannot run the console or confirm; viewers read without controls, get no spotter page and the sync refuses them | int "door staff…"; e2e "paddle numbers…" (viewer) |
| AC-M4.8c-11 | Isolation: every new table covered; another org can neither read nor record against this org's levels | `isolation.int.test.ts` (fixture rows); int "another org sees none of it…" |
| AC-M4.8c-12 | Accessibility: axe light and dark on every new screen and state; Arabic RTL of the three screens | e2e (`expectAccessibleBothModes` throughout), "Arabic (RTL)…" |

### 11. Security and privacy
- Spotters' phones get the level being called and the paddle numbers only; names reach the organizer's paddle list and review only (P4-13). Pledge amounts are numbers on organizer views.
- The sync route is same-origin JSON with the member's session; the tenant comes from the path; the device id is unique per org, and an id another event already used is refused without revealing anything.
- Audit rows carry counts (entries, refused, duplicates, confirmed), never names.

### 12. Performance budget
A sync batch (≤ 100 entries) is a handful of indexed reads and one insert per entry, under the call's row lock; 30 spotters syncing in parallel serialize per level for milliseconds. The console's live message is recomputed per batch (grouped counts per call).

### 13. Rollout
Behind the `donations` entitlement. Works for unconnected orgs too (pledges only, P4-9).

### 14. Build notes (2026-10-03)
Base: build branch + `merge/next-3g` + `agent/design-v2` + `merge/next-3h` (which carries `agent/m4.8a`, `agent/m4.8b` and `agent/m4.2b`).
- Gate: lint, check:modules, typecheck (59/59), unit 2,703 passed (200 files), integration 1,509 passed (165 files). e2e: `paddle-raise.spec.ts` 12/12 (3 projects); related `donations`, `realtime` 36/36; `canary-crawl`, `security` 106 passed (14 skipped by project). The screens use design v2 components only (PageHeader, Card, StatCard, StatusPill, EmptyState, Table, Alert, Button); one local composition, `RaiseActionButton` (a one-button form announcing the server's answer), lives in the feature folder.

### 15. Demo checklist
- [ ] As the Lakeside owner, create a gala, add a "Table of 4" ticket, publish, buy a table on the public page (fake provider) and name three guests through the table's link.
- [ ] Donations: add a campaign with levels $1,000 and $250. Open **Paddle numbers** → Give paddles (purchased tables) → 100–102.
- [ ] Open the **console**; on a phone (a box-office member) open **Spot paddles**.
- [ ] Call $1,000; type 100 ↵, 101 ↵, 100 ↵ on the phone (the third is flagged); watch the console climb; Undo; Close.
- [ ] Put the phone in airplane mode, call $250, type three numbers, turn the network back on: they arrive once.
- [ ] **Review**: confirm the recorded paddles into pledges; set one aside.

### 16. Owner tasks
`docs/owner-inbox.md` → M4.8c: paddles for individual-ticket buyers; spotters' roles (scanner role and the Scan PWA).

## M4.8d — live giving screen and QR-to-give (done)

### 1. Goal and users
The room's thermometer during a gala's fund-a-need: a projector shows the goal, the total climbing as paddles go up and phones give, how many gifts, the level the auctioneer is calling, and thanks to donors who asked to be named. A QR code on the screen and on table cards opens the giving page, so gifts from phones join the total live. Users: the host and AV team (screen link), the auctioneer, guests in the room (screen, phones), co-hosts and viewers (preview).

### 2. References
- **Plan:** `docs/plans/phase-4.md` §6, row M4.8d; P4-13 (screens show totals by default, names only with the donor's opt-in), P4-15 (QR-to-give now, no SMS keyword), P4-9 (the QR code only while the org can take gifts online).
- **Builds on:** M4.8a (campaigns, the giving page, gift outcomes), M4.8c (calls, spotters' entries, the console channel), M3.1b (realtime log channels, SSE with resume and snapshots), M5.7a (signed big-screen links, the screen's high-contrast and reduced-motion modes).

### 3. Scope
**In:**
- **Screen settings** (`/o/{org}/e/{event}/donations/screen`, linked from the Donations tab's paddle-raise card): the campaign the thermometer follows (its QR code opens that campaign's giving page) and "Thank donors by name" (on by default; off shows totals only). One screen per event (`donations.screens`). `orders:read` opens the page and watches a live preview; `events:write` sets it up, sees the projector's link (copy, open, open in high contrast, open with reduced motion) and replaces it (a second, deliberate step: a native disclosure, then "Replace it").
- **The projector** (`/{locale?}/giving-screen/{token}`, no sign-in): the token is `{orgId}~{eventId}~{version}~{HMAC}` under the app token secret (like M5.7a); the org and event come from the signature and `donations.screen_target` (SECURITY DEFINER, live orgs only) answers the current version, so a forged, edited or replaced link and a suspended org's link are 404s. Always dark (ADR 0022); the total in big tabular type; the thermometer (a `progressbar` with the total and goal as text; its fill's exact width is set through the CSSOM, the strict CSP allows no style attributes); "{percent}% of the {goal} goal", "Goal reached!"; the gift count (paid gifts plus counted paddles); the level being called with its paddle count ("Raise your paddle!", "3 paddles raised"); the QR code (black on white in every mode) when the giving page takes gifts; the thank-you list. **High contrast** (white on black) and **reduced motion** (no fill animation, no pulsing live dot) are toggles (buttons with `aria-pressed`, keyboard-operable), start from `?contrast=high` / `?motion=reduced`, and follow the system's `prefers-contrast` / `prefers-reduced-motion`. Full screen button.
- **Live over the realtime publisher:** channel `event.giving-screen` (M3.1b log channel, `orders:read` for members' previews; the projector streams through `/api/donations/screen/{token}`, which checks the signed link, then the same SSE as every channel: Last-Event-ID resume, rate and stream limits). Every message carries the whole allowlisted state (`ScreenStateDto`), and a (re)connecting screen gets it as the **snapshot**, so a dropped screen is whole again either way. Published inside the writing transaction by: every paddle-raise write (arm, record, undo, close, confirm, set aside: `publishConsoleStateTx` now also publishes the screen), a gift becoming paid (`donations.gift-outcomes`), a campaign edit, and saving the screen. Replacing the link publishes `link {version}`: open screens on an older version stop ("This screen link was replaced").
- **The total:** the campaign's paid gifts (gift amounts, without the fee cover) plus the paddles counted at its levels (recorded or confirmed; duplicates, set-aside entries and withdrawn arms never), in the campaign's currency. Confirming pledges doesn't change it (the entries already counted).
- **Names (P4-13):** the giving page gains "Thank me by name on the screen in the room" (off by default; hidden when the donor gives anonymously; `gifts.show_on_screen`, with a CHECK that an anonymous gift never carries it). The screen shows the newest 8 paid gifts' names that opted in, as the donor chose to appear (`screenName`: full or first name), and nothing for everyone else. Paddle holders are never named (a pledge carries no consent). No email, no per-gift amount, no tribute, no holder ever reaches a screen payload.
- **QR-to-give:** the screen's and the table cards' QR codes open `/events/{slug}/give?c={campaign}&via=screen|table`; the giving page keeps `via` across its campaign chips and records the gift's `source` as `qr` (`GIFT_SOURCES` widened, CHECK replaced NOT VALID then validated). Shown only while the giving page takes gifts: a connected account (P4-9), a published event (`checkout_target`) and an open campaign; otherwise the screen runs without a QR code and the host page says why. **Table cards** (`…/donations/screen/cards`): a printable sheet of four cards (event, "Scan to give", the QR code, the campaign, the address), print button, page chrome hidden when printed.

**Later / not yet:**
- The active match ("Every gift doubled up to $25,000"): M4.8f adds matches; the screen's DTO and component get a `match` block then.
- Shout-outs as they happen (an animated "Thank you, Ada!"), per-table cards with table names, a screen per campaign (one per event now), a screen that cycles campaigns.
- Pledges paid later (M4.8e) must not be counted twice when their payments arrive.
- Text-to-give (P4-15, waits for the 10DLC campaign).

## M4.8e — cards on file and pledge collection (done)

### 1. Goal and users
Turn a raised paddle into collected money without staff ever typing a card number: guests save a card on their own phone for the evening (one-tap gifts; their pledges are charged the next morning), every other pledge gets a pay link with a due date and reminders, and the host settles the rest by hand (offline payments, write-offs). Users: guests and donors (phones), the development lead and finance (the pledges page), the host (alerts).

### 2. References
- **Plan:** `docs/plans/phase-4.md` row M4.8e; P4-12 (pledges paid later, chasing unpaid ones), P4-14 (cards saved for one-tap giving; `payments` and `legal-copy`, owner approval), P4-9/P4-10 (direct charges on the connected account, application fee 0), P4-13 (no donor data on public pages).
- **Builds on:** M4.8a (gifts and donation orders), M4.8b (receipts per paid order), M4.8c (pledges), M4.4a (the party's permanent link and QR code), M3.2b (alerts), the payments port and the fake provider. M4.4b (check-in) is built in parallel: the check-in entry is the desk's card-saving QR code on the existing check-in page (not the scan result).

### 3. Scope
**In:**
- **Payment port (additive):** `createCardSetup` (a SetupIntent for off-session use on the organizer's connected account; Stripe: a customer on the connected account and a Checkout Session in setup mode), `chargeSavedCard` (an off-session PaymentIntent with `confirm`, exactly the amount, idempotent per key; a card error is a decline, not a throw), `detachSavedCard`, and a `SetupEvent` webhook (`setup.succeeded` / `setup.failed`, references and display details only). The fake provider has a hosted card step (`/checkout/fake/setup`, test cards 4242 charges, 0002 always declines, 9995 declines its first charge) and remembers one answer per idempotency key, like Stripe.
- **Saving a card** (`donations.saved_cards`): opt-in only, on the guest's own device, from four entry points: the party's own link (`/rsvp/{token}/card`, the QR code on the place card, also linked from the party's seat page), the table and check-in QR codes (`/events/{slug}/card?src=table|checkin`; the pledges page shows the table code, the check-in page shows the desk code while a campaign is open), and the checkout box "Save my card for tonight's giving" (unticked; after paying the buyer lands on the card page). Name, email and the authorization box (required, never pre-ticked) — the consent text version (`CARD_CONSENT_VERSION`) and time are recorded when the card is started; the verified setup webhook makes it `active` (deduplicated by provider event id). The device keeps the card's signed link in an http-only cookie (3 days). The card page shows the saved card (brand, last four) with "Give now" and "Remove my card".
- **One-tap giving** (the giving page): with an active card saved on this device for this event, one button per level ("Give $250.00 · A school day") charges it off-session, exactly the level's amount, no fee cover; the page's Idempotency-Key makes a double tap one gift and one charge; the answer is applied to the order like a webhook (`orders.attachPayment` + `orders.applyProviderEvent`, event id `{provider}:card-charge:{payment id}`), so the gift, ledger and receipt follow the M4.8a/b path.
- **Closing the night** (`/o/{org}/e/{event}/donations/pledges`, `donations.closePledges`, finance roles `orders:refund`, money category): every confirmed pledge without a collection gets one (`donations.pledge_collections`): with an active card of its holder (the guest, the guest's party or the party; else one saved under the holder's email; the newest wins) it is **scheduled** for the first 09:00 in the event's time zone at least six hours later; otherwise it is **invoiced** (pay link, due in 30 days). Each donor with an email gets one summary (`donations.pledge-summary`: the card and the charge time, or the pay links and the due date). Running it again only picks up new pledges.
- **The morning run** (`collectPledges`: the worker every 5 minutes, leader only; the dev route `/api/dev/donations/collect` in dev/CI): `donations.claimPledgeCharges` claims due charges under `FOR UPDATE SKIP LOCKED`, creates the try's gift and order (`pledge_attempts`, the order key `order:<id>:1`) and marks the collection `charging`; the provider charges the saved card; `donations.settleCardCharge` records the answer. A claim whose run vanished is handed out again after 10 minutes **with the same order and key**, so the provider answers the first charge and nothing is charged twice. A card that is no longer usable (removed, failed, another account) is never charged: the pledge is invoiced instead.
- **Declines:** the first decline is retried 24 hours later; the second makes it an invoice (`donations.pledge-invoice`, with the reason) — never a third charge.
- **Pay link** (`/events/{slug}/pledge/{token}`, signed): the pledge, its state and one action — "Pay $X now" (or "pay another way" before the card charge, which moves the pledge off the card). Exactly the pledged amount, a direct charge on the connected account, fee 0 (`donations.startPledgePayment`, idempotent). With no email on file the page asks for one (kept on the pledge, for the receipt). Settled pledges refuse another payment.
- **Reminders** (P4-12): queued with the invoice at +7, +21 and +28 days, 09:00 in the event's zone (`donations.pledge-reminder`, `sendAfter`, dedupe key per collection and step), and **cancelled the moment the pledge is settled** (paid by card or link, recorded offline, written off). Built on the notifications queue ("today's reminder planner"), not on journeys: they are transactional and fixed by P4-12.
- **Offline payments and write-offs** (finance roles, money category): record a check, wire, stock, donor-advised fund, cash or other payment (date not in the future, optional reference and note; idempotent), or write a pledge off with a required note. Both also work before the night is closed. Offline-paid pledges count in the campaign's "raised" total like paid gifts.
- **Alert** (M3.2b engine, rule `pledgesUnpaid`, event scope, `orders:read`, category payments): "N pledges are still unpaid 14 days after the event", with the sum in its params; the planning sweep evaluates events over for 14 days that still have unpaid pledges; the fix link opens the pledges page; resolves when they are settled.
- **Retention (P4-14):** cards are removed from the charity's customer 30 days after the event (`donations.expireSavedCards` in the same run → `detachSavedCard`).

**Later / not yet:**
- Saving the card with the ticket payment itself (`setup_future_usage` on the checkout's PaymentIntent): today the checkout box opens the card page after paying, so the guest saves the card with its own consent step.
- The check-in scan result offering the guest's own card page (needs M4.4b's scan outcome to carry the guest or party): today the desk shows the event's card QR code.
- The alert text shows the count; the amount is on the pledges page (the alert renderers pass counts only).
- Receipts for offline-paid pledges (M4.8b issues receipts per paid order); a donor's several pledges paid in one charge; refunds of pledge payments (M4.8g); Stripe Terminal card readers.
- The card-on-file wording and the pledge terms are `legal-copy` (pending the owner and counsel).

### 4. `touches:`
```yaml
touches:
  - packages/modules/donations/src/{domain/screen.ts,screen-link.ts,screen-dto.ts,screen-live.ts,screen.ts,schema-screens.ts}  # new files
  - packages/modules/donations/src/{schema.ts (gifts.show_on_screen + CHECK),domain/giving.ts (GIFT_SOURCES + qr),dto.ts (StartGiftInput.showOnScreen/source),gifts.ts (store them; publish on paid),campaigns.ts (publish on edit),paddle-live.ts (publish with the console),index.ts}, package.json (./screen export)
  - packages/modules/donations/tests/screen.test.ts
  - packages/db/drizzle/0114_long_fat_cobra.sql (+ meta)   # renumbered at merge
  - packages/testing/src/fixtures.ts                       # screenRows
  - packages/testing/tests/giving-screen.int.test.ts
  - apps/web/src/server/realtime.ts                        # the channel + its snapshot
  - apps/web/src/app/api/donations/screen/[token]/route.ts
  - apps/web/src/app/[locale]/giving-screen/[token]/page.tsx
  - apps/web/src/components/donations/giving-screen.tsx
  - apps/web/src/app/[locale]/o/[org]/e/[event]/donations/{page.tsx,screen/**}
  - apps/web/src/app/[locale]/events/[slug]/give/{page.tsx,actions.ts,give-form.tsx}
  - apps/web/messages/*.json                               # donations.{screen,screenPage,screenCards}, give.showOnScreen*, raiseCard.openScreen
  - apps/web/e2e/{giving-screen.spec.ts,donations.spec.ts (keyboard path)}
  - packages/modules/payments/src/{port.ts,fake.ts,stripe.ts,index.ts}       # additive port methods + SetupEvent
  - packages/modules/payments/tests/saved-cards.test.ts
  - packages/modules/donations/src/{domain/collection.ts,schema-collection.ts,saved-cards.ts,pledge-collection.ts,pledge-totals.ts,legal/card-consent.ts}  # new
  - packages/modules/donations/src/{index.ts,private-columns.ts,campaigns.ts}, package.json (+payments, +notifications, ./collection export), MODULE.md
  - packages/modules/donations/tests/collection.test.ts
  - packages/modules/guests/src/{pledge-contact.ts,index.ts}                  # one new read helper
  - packages/modules/alerts/src/{domain/config.ts,domain/rules.ts,facts.ts,subscriber.ts}, package.json, tests/rules.test.ts
  - packages/modules/notifications/src/{kinds.ts,templates/samples.ts,templates/messages/*.json}
  - packages/db/drizzle/0116_abnormal_midnight.sql (+ meta)                   # renumber at merge
  - packages/testing/src/{fixtures.ts,pledges.ts,index.ts}, tests/pledge-collection.int.test.ts
  - apps/worker/src/{main.ts,registry.ts,sweeper.ts}
  - apps/web/src/app/[locale]/events/[slug]/{card/**,pledge/[token]/**,give/{page.tsx,one-tap.tsx,one-tap-actions.ts},actions.ts}
  - apps/web/src/app/[locale]/rsvp/[token]/{card/page.tsx,seat/page.tsx}
  - apps/web/src/app/[locale]/checkout/fake/setup/**
  - apps/web/src/app/[locale]/o/[org]/e/[event]/{donations/pledges/**,donations/page.tsx,onsite/page.tsx}
  - apps/web/src/app/api/dev/donations/collect/route.ts
  - apps/web/src/{components/checkout-form.tsx,components/public-event-view.tsx,server/webhooks.ts,server/notifications.ts,server/saved-card.ts}
  - apps/web/messages/*.json        # savedCard, pledgePay, pledges, fakePay.*, checkout.saveCardForGiving, partySeats.saveCard, donations.raiseCard.openPledges, alerts.*
  - apps/web/e2e/pledge-collection.spec.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `donations.screens` | new | event (unique per org), campaign (cascade), `show_names` (default true), `version` (≥ 1; the link's) |
| `donations.gifts` | + `show_on_screen boolean not null default false` | CHECK `gifts_show_on_screen_check` (never with `display_as = 'anonymous'`); `gifts_source_check` widened to `online`, `qr` |

**RLS notes:**
- [x] `screens` uses `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, org-scoped unique, composite FK to `campaigns`).
- [x] Fixture rows for both orgs (`screenRows`: the fixture campaign's screen).
- [x] No text columns on `screens` (nothing to declare in `private-columns.ts`); `gifts.show_on_screen` is a boolean.

**Migration:** `0114_long_fat_cobra.sql` (to be renumbered), additive only. Hand-written blocks: (1) `gifts_show_on_screen_check` added `NOT VALID` then `VALIDATE CONSTRAINT`; (2) `gifts_source_check` re-added `NOT VALID` then validated (drizzle drops and re-adds it); (3) `screens_event_fk` (→ `events.events`, cascade) and the `donations.screen_target(uuid, uuid)` SECURITY DEFINER function (version only, live orgs), `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`.

### 6. API diff
None on `/v1`. Web: `GET /api/donations/screen/{token}` (SSE, signed link), the page `/giving-screen/{token}`.

### 7. Events
None on the outbox. Realtime messages on `event.giving-screen`: `state` (the whole `ScreenStateDto`), `link {version}`, plus the stream's `snapshot`.

### 8. Entitlements and flags
`donations` (commands, query, channel). Permissions: `orders:read` (screen page, preview, channel), `events:write` (set up, link, replace). The read-only freeze refuses the writes. Audit: `donations.screen.save` (campaign, names setting), `donations.screen.rotate` (version); never a donor.

### 9. ELT impact
None (no legacy equivalent).
| `donations.saved_cards` | new | event; party or guest (at most one); name, email (personal); source; status `pending/active/failed/removed`; provider references (secret: connected account, setup, customer, payment method); brand, last four, expiry; consent version and time; activated, remove-after (event end + 30 days), removed |
| `donations.pledge_collections` | new | one per pledge (unique): amount and currency copied, donor name/email/locale, status `scheduled/charging/invoiced/paid/paid_offline/written_off`, card and charge time, card tries (≤ 2), claim time, invoice time and due day, paid time, offline method/reference/received day, note, who closed and who settled; CHECKs tie each status to its columns |
| `donations.pledge_attempts` | new | one per try: `card` (try 1 or 2, unique) or `link`; its gift and order (unique); status `pending/paid/failed`, decline code |
| `alerts.alerts` | CHECK widened | `alerts_rule_check` gains `pledgesUnpaid` (`NOT VALID` + `VALIDATE`) |

**Migration:** `0116_abnormal_midnight.sql` (expand only; after M4.8c's `0115`; renumber at merge). Hand-written block: `saved_cards_event_fk` and `pledge_collections_event_fk` (→ `events.events`, no action: consent and money records keep their event), `saved_cards_party_fk` / `saved_cards_guest_fk` (`SET NULL (party_id)` / `(guest_id)`), `pledge_attempts_order_fk` (→ `orders.orders`). Hand edit: the widened `alerts_rule_check` as `NOT VALID` then `VALIDATE CONSTRAINT`.

### 6. API diff
None on `/v1`. The `PaymentProvider` port gains three methods and one webhook event type (internal).

### 7. Events
`donations.pledges_closed@1` and `donations.pledge_invoiced@1` (→ `donations.pledge-mailer`). Consumed: `order.donation_paid@1`, `order.payment_failed@1`, `order.expired@1` (→ `donations.pledge-outcomes`).

### 8. Entitlements and flags
Behind `donations`. Cards and pay links need a connected account (P4-9).

### 9. ELT impact
None.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.8d-01 | **A gift made on a phone moves the thermometer within 3 s p95** | int `giving-screen.int.test.ts` ("20 phone gifts each reach a listening screen…": payment applied → realtime log → LISTEN fan-out → a subscribed hub, p95 < 3 s); e2e `giving-screen.spec.ts` ("a gift made on a phone…": the projector shows the new total ≤ 3 s after the thank-you page, three gifts) |
| AC-M4.8d-02 | **Screens never show an unconsented name** (fixture with mixed consents: opted-in full and first names, a full name and a first name without opt-in, an anonymous donor who ticked the box, an unpaid opted-in gift, paddle pledges) | int "acceptance: with mixed consents…" (the page payload, the snapshot and every realtime message scanned); unit `screen.test.ts` (`screenName`, the DTO allowlist); e2e "a gift made on a phone…" (page HTML scanned; the anonymous donor has no box) |
| AC-M4.8d-03 | The total is paid gifts (without fee cover) plus counted paddles; pending gifts, duplicates, undo and set-aside don't count; confirming doesn't double it | int "totals paid gifts…"; e2e "the level being called…" |
| AC-M4.8d-04 | The level being called and its paddles appear live; a campaign edit reaches the screen | int "totals…", "a campaign edit…"; e2e "the level being called…" |
| AC-M4.8d-05 | Signed link: forged, edited, another org's, replaced and suspended-org links refused; an open screen stops when the link is replaced | int "a link opens its screen…"; unit token tests; e2e "the level being called…" (replace), "table cards…" (forged page and stream) |
| AC-M4.8d-06 | Reconnect: a screen that lost its stream catches up (snapshot) | e2e "the level being called…" (offline, streams dropped, level closed meanwhile) |
| AC-M4.8d-07 | QR-to-give opens the campaign's giving page from the screen and table cards and records `qr`; no QR code for an unconnected org | int "totals…" (source); e2e "a gift made on a phone…", "table cards…", "an org without a connected account…" |
| AC-M4.8d-08 | Reduced motion and high contrast, from the link and by keyboard | e2e "the level being called…" |
| AC-M4.8d-09 | Permissions: viewers watch without settings or link; lower roles refused; only `events:write` sets up and replaces | int "events:write sets it up…"; e2e "table cards…" (viewer, scanner 404) |
| AC-M4.8d-10 | Isolation: another org can't set up, read or open this org's screen; every new table covered | int "isolation"; `isolation.int.test.ts` (fixture rows) |
| AC-M4.8d-11 | Validation, success messages, persistence, empty states | e2e "a gift made on a phone…" (no campaign, saved, reload), "table cards…" (cards before setup) |
| AC-M4.8d-12 | Accessibility: axe light and dark on every new screen and state; Arabic RTL of the console page and the screen | e2e (`expectAccessibleBothModes` / `expectAccessible` throughout; "table cards…" Arabic) |

### 11. Security and privacy
- The projector's payloads are the allowlisted `ScreenStateDto` only (parsed again by the channel's schema on publish and on send). Names only with the donor's opt-in (P4-13), never for an anonymous gift (also a CHECK), never a paddle holder.
- The link is a bearer credential for totals and opted-in names: no sign-in, signed per org and event, replaceable, refused for suspended orgs; the stream is rate-limited per link like M5.7a's. Pages are `noindex`, `referrer: no-referrer`.
- The tenant comes from the signed token (display) or the path (console), never a header.

### 12. Performance budget
A screen state is five indexed reads (screen, campaign, gift sum, paddle sum by campaign, open call) plus the newest names; it is recomputed per write in the writer's transaction (the console already recomputes its own). The p95 test measures payment → screen at well under a second locally; in production the gift reaches the screen when the donor's phone lands on the thank-you page (which applies the outcome) or the worker's relay delivers it, whichever comes first.

### 13. Rollout
Behind the `donations` entitlement. Works for unconnected orgs (paddles only, no QR code).

### 14. Build notes (2026-10-03)
Base: build branch + `merge/next-3g` + `merge/next-3h` (design v2, M4.8a/b) + `agent/m4.8c`. One merge conflict (`command-center/src/widgets.ts`, batch 3g vs 3h: kept the build branch's `days:` call, which already fixes the same day-range bug).
- The screen is composed from `@yayatoh/ui` (Card, StatusPill, Button, Alert, Select, Checkbox, Input, PageHeader, SectionHeader, EmptyState) and the M5.7a screen's patterns (`StreamBadge`, toggles). Local compositions: `components/donations/giving-screen.tsx` (the thermometer screen and preview), `screen-form.tsx`, `screen-link.tsx`, `cards/print-button.tsx`; the replace-link control reuses M4.8c's `RaiseActionButton`.
- Gate (2026-10-03): lint, check:modules, typecheck 59/59 (concurrency 2), unit 2,717 passed (201 files), integration 1,519 passed (166 files). e2e on 375/768/1280: `giving-screen.spec.ts` 12/12; related `donations.spec.ts`, `paddle-raise.spec.ts`, `realtime.spec.ts` 48/48 (after making M4.8a's keyboard test name its checkbox); `canary-crawl.spec.ts`, `security.spec.ts` 106 passed (14 skipped by project).

### 15. Demo checklist
- [ ] As a gala's owner (connected Stripe, published event): Donations → add a campaign with a $1,000 level → **Live screen** → choose the campaign → Set up the screen.
- [ ] Open the screen link on a second browser (the projector); try **High contrast** and **Reduced motion**.
- [ ] Scan the QR code with a phone (or open its address), give $1,000 with "Show my full name" and **Thank me by name on the screen**, pay on the test page: the screen climbs and thanks you within seconds.
- [ ] Give again without the box: the total moves, no name. Give anonymously: no box at all.
- [ ] Call the level on the paddle-raise console; record a paddle from **Spot paddles**: the screen shows "Now calling" and the paddle.
- [ ] **Print table cards**; scan one: the giving page opens.
- [ ] **Replace the link**: the open screen says it was replaced; the old link is gone.

### 16. Owner tasks
`docs/owner-inbox.md` → M4.8d: what the total counts, names on screen, the link, QR-to-give and table cards.
| AC-M4.8e-01 | A confirmed pledge with a saved card is charged once, on schedule (09:00 local the next morning, nothing before), exactly the pledged amount, on the connected account | int `pledge-collection.int.test.ts` ("closing the night…" block); unit `collection.test.ts` (charge time, DST); e2e `pledge-collection.spec.ts` ("a guest saves a card…") |
| AC-M4.8e-02 | Replayed jobs never charge twice: replayed runs charge nothing; a run that vanished after charging is replayed under the same key and the provider answers the first charge | int "replayed runs never charge twice", "a crashed run replays under the same key"; e2e (second morning run: 0) |
| AC-M4.8e-03 | Reminders stop once paid: three queued at +7/+21/+28 days 09:00 local, all cancelled when the pay link is paid | int "pays exactly the pledge; the reminders stop…", "0002 declines twice…" |
| AC-M4.8e-04 | A pledge without saved consent is never charged (no card, a removed card, a failed setup) | int "a pledge without saved consent…", "removed cards are never charged" block; e2e (Nakamura) |
| AC-M4.8e-05 | One retry on a declined card, then a pay link (never a third charge) | int "a declined card is retried once…" block |
| AC-M4.8e-06 | Saving a card: consent required and recorded (version, time), references only, a replayed webhook changes nothing; every validation message; keyboard only | int "saving a card" block; e2e "a guest saves a card…" |
| AC-M4.8e-07 | One-tap giving charges exactly the level once per Idempotency-Key; a removed card is refused | int "one-tap giving…"; e2e "one-tap giving…" |
| AC-M4.8e-08 | Pay link: exactly the pledge; asks for an email when none is on file; settled pledges refuse; paying before the morning means the card is not charged too | int "the pay link" block; e2e "a pledge without a card is paid by its link…" |
| AC-M4.8e-09 | Offline payments (date not in the future) and write-offs (note required) stop collection; offline counts in "raised" | int "offline payments and write-offs" block; e2e (Okafor, Rivera) |
| AC-M4.8e-10 | The alert "N pledges unpaid 14 days after the event" | unit `alerts/tests/rules.test.ts`; int "the alert engine raises…" |
| AC-M4.8e-11 | Permissions: only finance roles close, record and write off; viewers read without controls | int "only finance roles…", "a viewer cannot"; e2e (viewer) |
| AC-M4.8e-12 | Isolation: every new table covered; another org can't read or use the links | `isolation.int.test.ts` (fixture rows); int "tenant isolation" |
| AC-M4.8e-13 | Accessibility: axe light and dark on the card, pay and pledges pages; Arabic RTL | e2e throughout, "Arabic (RTL)…" |
| AC-M4.8e-14 | Entry points: the checkout box (unticked) and the check-in QR code lead to the card page | e2e "the checkout box…", "one-tap giving…" (check-in QR) |

### 11. Security and privacy
- No card data ever reaches Yayatoh: the provider's hosted step takes the card; we keep references (secret columns, never in a response, export or message) and brand/last four (personal: shown to the card's owner by its signed link and cookie, to the host, and in the donor's own summary).
- Public pages carry no donor list: the card page answers by the device's own cookie; the pay page by the pledge's signed link (amount, level, due date; nothing about other donors).
- Every write is a command: public ones are rate-limited per device and idempotent; host money actions are finance-only, money category (refused while staff act as a member) and audited without donor details.
- Off-session charges and card removals carry idempotency keys (`order:<id>:1`, `card-remove:<id>`); webhooks are verified and deduplicated by provider event id.

### 12. Performance budget
The run claims at most 50 charges per org per pass under `SKIP LOCKED`; the worker's org lookup is one indexed query (`pledge_collections_org_charge_idx`, `saved_cards_org_remove_idx`).

### 13. Rollout
Behind `donations`; the worker run is leader-only. Live Stripe waits for the owner's account; setup and off-session charges are written against the pinned API version and unit-tested with a recorded fake.

### 14. Build notes (2026-10-03)
Base: build branch + `merge/next-3g` + `merge/next-3h` + `agent/m4.8c` + `agent/m4.4a` (M4.8c's migration renumbered 0113 → 0115 after M4.4a's 0113/0114). Design v2 components only (PageHeader, Card, StatCard, StatusPill, EmptyState, Table, Alert, Button, Input, Select, Checkbox, Textarea); local compositions in the feature folders: `CardForm`, `CardPage`, `OneTap`, `SettleForms`, `CardSavingQr`; the pledges page reuses M4.8c's `RaiseActionButton`/`RaiseAnnouncer`.
- Gate: lint, check:modules, typecheck 59/59, unit 2,782 passed (205 files), integration 1,554 passed (168 files; `impersonation.int.test.ts` caught `donations.removeSavedCard` without the `delete` category — fixed and re-run). e2e: `pledge-collection.spec.ts` 15/15 (3 projects); related `donations`, `paddle-raise`, `receipts`, `guest-seat-finder`, `checkout`, `gala-tables`, `alerts`, `checkin` together 144/144 (3 projects, with the new spec); `canary-crawl` + `security` 40 passed (desktop).

### 15. Demo checklist
- [ ] A connected org with a published gala: a campaign with $1,000 and $250 levels; three parties with paddles; a paddle raise with confirmed pledges.
- [ ] On a phone, open a party's card page (its link or QR code): try saving without the box ticked; tick it; save test card 4242.
- [ ] Pledges page: "Close the night and send summaries" — the carded pledge is scheduled for 09:00 tomorrow, the others get pay links.
- [ ] Run the morning (`POST /api/dev/donations/collect` with `now` tomorrow): paid; run it again: nothing more.
- [ ] Open a pay link, pay with the fake provider; record a check; write one off with a note.
- [ ] Check-in page: the desk's QR code; giving page with a saved card: one-tap gifts.

### 16. Owner tasks
`docs/owner-inbox.md` → M4.8e (legal-copy, payments).

## M4.8f — matching gifts (done)

### 1. Goal and users
Hosts of a gala let a sponsor match the room's gifts: "Every gift doubled up to $25,000" (P4-17). The match is computed from confirmed gifts and shown on the console (the Donations tab, the Matching gifts page and the paddle-raise console's live channel) and on the public giving page; the room's thermometer screen (M4.8d) takes the same payload. When the host closes it, the sponsor's match becomes its own pledge, collected like any other (M4.8e). Charities also export the donors whose employers match gifts.

### 2. References
`docs/plans/phase-4.md` §6 (row M4.8f, P4-12, P4-13, P4-17); M4.8a (gifts), M4.8c (pledges); CLAUDE.md (tenancy, commands, money, time).

### 3. Scope
- **Challenge match:** sponsor (name and optional email, host only), an optional public name ("a generous sponsor" when empty), one campaign, a window (timestamptz, entered in the event's time zone; start included, end excluded), a ratio (`ratio_percent`: 50, 100 = 1:1, 200, 300 offered; 1–1,000 stored), a cap ($1.00–$10,000,000.00), the campaign's currency. At most 20 per campaign.
- **What counts:** paid online gifts of the campaign whose payment landed in the window, each less what was refunded of it (a refund takes the covered fee first, then the gift), and confirmed (not cancelled) paddle pledges confirmed in the window. Sponsors' own match pledges never count. Matched = ⌊eligible × ratio ⁄ 100⌋, never above the cap (exact integer arithmetic). Nothing is stored while a match runs: every view computes it.
- **States:** `active` (shown as Scheduled / Live / Window ended by the clock), `closed`, `cancelled`. Close (only once started): the window ends now if it was still running, `matched_minor` is stored, and a pledge (`source = 'match'`, no call, entry or paddle) is recorded for the amount when it is above zero. Cancel: only while active; nothing is pledged.
- **After the close:** a refund of a matched gift (`order.refunded@1` → `donations.gift-refunds`) or a voided paddle pledge brings the sponsor's pledge down with the match, never up; at zero it is cancelled (P4-12: never ask more than pledged).
- **Employer matching list:** CSV of the event's paid gifts that name an employer, sorted by employer: employer, donor, email, date (event time zone), campaign, amount less refunds; fully refunded gifts left out. Bulk export: `attendees:export`, a recent step-up, audited, refused while staff act as a member.
- **UI:** `Donations → Matching gifts` (`/o/{org}/e/{event}/donations/matches`): the matches with progress, Close / Cancel, the add form, the employer list; a card on the Donations tab with the running matches; a banner on the giving page for each live match.

**Not yet / later:** editing a running match (cancel and add again); a per-donor matching limit; linking the sponsor to a guest or party (for card-on-file collection, M4.8e); the room's screen itself (M4.8d, which reads `LiveMatchDto` from the console channel or `publicGiving`); a paid matching-gift database integration (Double the Donation, P4-17, owner's call); refunds lowering campaign totals (M4.8g reconciliation).

### 4. `touches:`
`packages/modules/donations` (new `domain/matches.ts`, `schema-matches.ts`, `match-dto.ts`, `match-progress.ts`, `matches.ts`, `employer-export.ts`; appended to `schema-paddles.ts`, `domain/paddles.ts`, `paddle-dto.ts`, `paddle-live.ts`, `paddle-raise.ts`, `dto.ts`, `gifts.ts`, `index.ts`, `private-columns.ts`), `packages/db/drizzle/0114_*.sql`, `packages/testing` (fixture rows, ports bulk action), `apps/worker` (subscriber, bulk action), `apps/web` (matches page, actions, export route, Donations card, giving page banner, bulk registry, messages in 13 locales).

### 5. Data model
- `donations.matches` (tenant, FORCE RLS): event, campaign (FK), sponsor name/email (personal), public name, ratio, cap, currency, window, status, `matched_minor`, `closed_at`, `cancelled_at`; checks on every column; `(org_id, event_id)` → `events.events` (hand-written, no cascade: it may carry a pledge).
- `donations.gift_refunds` (tenant, FORCE RLS): one row per provider refund of a gift's order (`unique (org_id, refund_id)`: replays count once); `(org_id, refund_id)` → `orders.refunds` (hand-written).
- `donations.pledges` (M4.8c): `call_id`, `entry_id`, `paddle_number` nullable; new `match_id` (FK, partial unique); `source in ('paddle', 'match')` with a shape check (NOT VALID + VALIDATE on the existing table).

### 6. API diff
None on `/v1`. The paddle console's live payload (`ConsoleLiveDto`) and the public giving payload (`PublicCampaignDto.matches`) gain the running matches (`LiveMatchDto`: terms, phase, matched, remaining, public name; never the sponsor's contact).

### 7. Events
Consumes `order.refunded@1` (`donations.gift-refunds`). Emits none (the console channel is published in each write's transaction).

### 8. Entitlements and flags
`donations`. Permissions: `events:write` (create, close, cancel), `orders:read` (read), `attendees:export` (employer list).

### 9. ELT impact
None (no legacy equivalent).

### 10. Acceptance criteria
| ID | Criterion | Test |
|---|---|---|
| AC-M4.8f-01 | A 1:1 match capped at $25,000 stops at the cap exactly | unit `packages/modules/donations/tests/matches.test.ts` ("stops at the cap exactly"); int `packages/testing/tests/matching-gifts.int.test.ts` ("doubles confirmed gifts in the window and stops at the cap exactly"); e2e `apps/web/e2e/matching-gifts.spec.ts` ("a 1:1 match capped at $25,000…") |
| AC-M4.8f-02 | A refunded gift reduces the match (partial refunds: the covered fee first) | unit (`matchableAmount`); int ("a refunded gift reduces the match", "a refund takes the covered fee first"); e2e (refund on the order page, $24,100) |
| AC-M4.8f-03 | Closing makes the sponsor's match its own pledge; later refunds bring it down, never up; at zero it is cancelled; replays count once | int ("closing records…", "gifts after the close…", "refunding everything…"); e2e (pledge recorded, persisted) |
| AC-M4.8f-04 | Only confirmed gifts count: paid online gifts and confirmed paddle pledges in the window and campaign; a voided paddle pledge lowers a closed match | int ("confirmed paddle pledges count…", "another campaign never counts", windows) |
| AC-M4.8f-05 | Window and ratio: scheduled matches cannot close, past windows match nothing, 2:1 triples | unit (phases, ratios); int ("a match before its window…", "a 2:1 match…"); e2e (scheduled, tripled) |
| AC-M4.8f-06 | Shown on the console and the giving page; public payload has no sponsor contact | int ("the console and the giving page show it"); e2e (Donations card, giving page banner, no email in HTML) |
| AC-M4.8f-07 | Employer matching list export (step-up, permission, net of refunds, sorted, own org only) | int ("the employer matching list"); e2e (CSV after step-up) |
| AC-M4.8f-08 | Every validation message, empty states, success messages, persistence after reload | e2e ("every validation message…", main journey) |
| AC-M4.8f-09 | Permissions and isolation: viewers read only (hidden controls; 404 export), other orgs see nothing; both new tables in the isolation fixture | int ("viewers see matches…"); `isolation.int.test.ts`, `canary.int.test.ts` (fixture `matchRows`); e2e viewer |
| AC-M4.8f-10 | Keyboard only, axe light and dark on every new screen, Arabic RTL | e2e ("keyboard only…", "Arabic…", `expectAccessibleBothModes` throughout) |

### 11. Security and privacy
The sponsor's name and email are personal columns, shown only to the host; screens and the giving page show the public name the host entered (or "a generous sponsor"). No donor reaches a match payload. The employer list carries donors' names and emails, so it is a step-up bulk export like the gift list. Audit rows carry terms and amounts, never contacts.

### 12. Performance budget
A match's progress reads the campaign's paid gifts, their refunds and paddle pledges once per page (indexed by campaign); galas have hundreds to a few thousand gifts.

### 13. Rollout
Behind `donations`. Collection of the sponsor's pledge arrives with M4.8e.

### 14. Build notes (2026-10-03)
Built on the build branch + `merge/next-3g` + `merge/next-3h` + `agent/m4.8c` (unmerged; the pledges changes depend on its migration landing first).
- Gate: lint, check:modules, typecheck 59/59, unit 2,716 passed (new: `matches.test.ts` 9), integration 1,524 passed (new: `matching-gifts.int.test.ts` 14). After the last merges of `agent/m4.8c` and `merge/next-3g`: matching-gifts, donations, paddle-raise, receipts, isolation, canary, impersonation and freeze integration files 87/87. e2e on all three projects: `matching-gifts.spec.ts` 15/15; with `donations` and `receipts` 57/57; with M4.8c's `paddle-raise.spec.ts` 27/27.
- `merge/next-3h`'s newest commit (c1b7d889, the Command Center campaigns tile) conflicts with `merge/next-3g`'s fix of the same tile in `packages/modules/command-center/src/widgets.ts` (not this increment's file); that merge was left to the merge session.
- The paddle-raise console's matches refresh when the console channel publishes (match, pledge and paddle writes); a gift paid online shows on the next page load. M4.8d's screen can publish on gift outcomes too.

## M4.8g — reporting, exports and reconciliation (done)

### 1. Goal and users
After the gala the charity's finance people (owners, admins, finance members; co-hosts read) need to know what was raised and how, which pledges came in, which were written off, who gave (with the anonymous flag), a file their donor CRM imports as is, and proof that every gift in Yayatoh's ledger is in their Stripe account and reached the bank.

### 2. References
`docs/plans/phase-4.md` §6, row M4.8g (D, extends M1.6e reconciliation), P4-9 (organizer_mor direct charges), P4-10 (no platform fee), P4-12, P4-13 (anonymity), P4-17; M1.6e (`payments/reconciliation.ts`); M4.8a–f; CLAUDE.md (tenancy, allowlists, commands, money, time).

### 3. Scope
**In:**
- **Memo entries (payments):** a gift is a direct charge on the charity's connected account with application fee 0, so it never posted a journal (`postSaleTx` posts nothing at 0). Each paid gift now gets a memo-only journal (`kind = 'donation_memo'`, key `donation:<orderId>`, memo `{grossMinor, currency, connectedAccountId, fundsFlow}`) and each refund of a gift one more (`donation_refund_memo`, key `donation_refund:<refundId>`), written by the new `payments.post_memo` SECURITY DEFINER function (memo kinds only, org-checked, idempotent per key, no postings). Balances and the platform reconciliation (M1.6e) are unchanged.
- **Connected account on the payment port (additive):** `listConnectedBalanceTransactions({connectedAccountId, from, to})` (charges, refunds, payouts; gross, the provider's fee, net, the payout each was paid out in) and `listPayouts`. The fake records direct charges (webhook naming the account), refunds and saved-card charges on the account with Stripe's US nonprofit fee (2.2% + 30¢) and makes daily payouts (UTC day D, created D+1, arriving D+3); Stripe lists `balance_transactions` and `payouts` on the account (`Stripe-Account`), attributing charges by their metadata and payouts by `balance_transactions?payout=`.
- **Report** (`/o/{org}/e/{event}/donations/report`, `donations.report`, `finance:read`): every line of money of the event — paid gifts (online, QR, or a paddle pledge paid by card or pay link) less their refunds, pledges paid offline, and paid lines of donation ticket types — totalled per currency (received by card, offline, ticket donations, raised; covered fees and refunds; pledged / collected (card, link, offline) / written off / open; matched by sponsors), per source, per level (gifts given at it; paddle pledges called at it, never a paid pledge twice), per match, per donor (by email; flagged anonymous if any gift was), plus the ledger check: the memo entries and the provider as the last reconciliation saw it ("Matches to the cent" / "Differs by …").
- **Donor CRM exports** (CSV and Excel): one row per gift, offline payment and donation ticket line (fully refunded gifts left out), in four layouts — generic (the requester's language), Salesforce NPSP Data Import, Bloomerang, Little Green Light (each CRM's own column names, split first/last names, `TRUE`/`FALSE`) — each keeping the anonymous flag. Bulk exports (`donations.donorsCsv`, `donations.donorsXlsx`): `finance:read`, a fresh step-up, audited, refused while staff act as a member; read in the event's tenant only. Excel files are written by M4.3b's XLSX writer in `@yayatoh/csv` (inline strings, never formulas; bold frozen header; amounts as numbers).
- **Reconciliation** (`/o/{org}/e/{event}/donations/reconciliation`, like M1.6e): "Reconcile now" (`finance:reconcile`) asks the provider for the movements and payouts of every connected account the event's gifts were charged on, from a week before the first gift to a day ahead, keeps the event's charges and refunds (`order:<gift order>`, `refund:<gift refund>`), and compares them per reference and currency with the memo entries. Differences (`missing_at_provider`, `missing_in_ledger`, `amount_mismatch`) are kept per reference: opened, updated, `cleared` when both sides agree again; finance resolves one with a note (stays resolved while its amounts don't change). The run keeps per-currency totals (ledger, provider, provider fees, not paid out yet) and the payouts that carried the event's gifts (whole payout, the event's gross, fees, net, count).
- **Campaign totals net refunds:** the campaign's "raised" (Donations tab, giving page, screen) now subtracts refunds, the covered fee first (the M4.8f owner note "until M4.8g").
- **UI:** a "Report and exports" card on the Donations tab (finance roles), the two pages (design v2 components: PageHeader, StatCard, Table with phone stacking, StatusPill, Badge, EmptyState, Alert), a dev route `/api/dev/donations/provider` (dev/CI, fake only: age the account's movements, add drift).

**Later / not yet:**
- A scheduled reconciliation (the worker runs M1.6e hourly; donations reconcile on demand now).
- Ticket donations are reported from paid and partly refunded orders at the line's paid price; a partial refund of a mixed ticket order is not split per line. They are reconciled by M1.6e (ticket orders), not here.
- Gifts paid before this increment have no memo entry: a reconciliation lists them as `missing_in_ledger` until a backfill (one script, owner-approved, when it's needed on real data).
- The sponsor's match pledge is reported per match but is not collected by M4.8e's flow (the sponsor is not a guest with a card or pay link).
- Disputes on gifts (Stripe `dispute` movements) are listed as provider movements without a ledger memo.
- CRM layouts follow each CRM's documented import columns; the owner should confirm them with the charities' own CRM admins (owner inbox).

### 4. `touches:`
```yaml
touches:
  - packages/modules/payments/src/{port.ts,fake.ts,stripe.ts,memo-ledger.ts,index.ts}   # additive port methods; memo journals
  - packages/modules/payments/tests/connected-balance.test.ts
  - packages/modules/orders/src/{donation-orders.ts,commands/refunds.ts,donation-ticket-facts.ts,index.ts}
  - packages/modules/donations/src/{domain/report.ts,domain/reconcile.ts,domain/crm.ts,report.ts,report-dto.ts,report-export.ts,reconciliation.ts,schema-reconciliation.ts}  # new
  - packages/modules/donations/src/{index.ts,private-columns.ts,campaigns.ts,pledge-collection.ts}, MODULE.md
  - packages/modules/donations/tests/report.test.ts
  - packages/db/drizzle/0130_green_loa.sql (+ meta)   # renumber at merge
  - packages/testing/src/{fixtures.ts,ports.ts}, tests/{donations-report,donations,pledge-collection}.int.test.ts
  - apps/worker/src/bulk.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/donations/{page.tsx,report/**,reconciliation/**}
  - apps/web/src/app/[locale]/checkout/fake/{page.tsx,actions.ts}   # the fake page names the connected account
  - apps/web/src/app/api/dev/donations/provider/route.ts
  - apps/web/src/server/bulk.ts
  - apps/web/messages/*.json   # donations.report.*, donations.recon.*
  - apps/web/e2e/donations-report.spec.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `donations.recon_runs` | new | event; provider; ledger/provider/item counts; `totals` jsonb (per currency: ledger, provider, fees, not paid out; parsed by `ReconTotals`); `ran_by` |
| `donations.recon_items` | new | event, run; kind; reference (`order:`/`refund:`); currency; ledger and provider sums; status `open/resolved/cleared`; note (3–500, required when resolved); unique per org, event, reference and currency |
| `donations.recon_payouts` | new | run, event; payout id, status, amount, currency, arrival date, created at; the event's donation gross, fees and count; unique per run and payout |
| `payments.journal_entries` | rows only | memo journals `donation_memo` / `donation_refund_memo` (no postings) |

**RLS notes:**
- [x] Three new tables through `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, org-scoped uniques, composite FKs to the run and, hand-written, to `events.events`).
- [x] Fixture rows for both orgs (`donationReconRows`: one run over the fixture gift order with a `missing_in_ledger` difference and a payout).
- [x] Every text/jsonb column declared in `private-columns.ts` (references, payout ids, totals, notes and actors internal).

**Migration:** `0130_green_loa.sql` (renumber at merge), additive. Hand-written block: (1) `recon_runs_event_fk`, `recon_items_event_fk`, `recon_payouts_event_fk` (→ `events.events`, cascade); (2) `payments.post_memo(uuid, text, text, text, uuid, timestamptz, jsonb, uuid)` SECURITY DEFINER (`search_path = pg_catalog`), owned by `ledger_writer` (with the `GRANT CREATE` / `REVOKE CREATE ON SCHEMA payments` dance post_journal uses), `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO app_user`.
Generated after batch 3j's `0129_conference_alert_rules` (`drizzle-kit generate` shows no changes afterwards).

### 6. API diff
None on `/v1`. The `PaymentProvider` port gains `listConnectedBalanceTransactions` and `listPayouts` (internal). The fake's signed webhook may name `connectedAccountId` (stripped before the app sees the event).

### 7. Events
None new. Audit: `donations.reconcile`, `donations.reconcile_resolve`, `bulk.start` for the exports.

### 8. Entitlements and flags
`donations`. Permissions: `finance:read` (report, reconciliation view, exports), `finance:reconcile` (run, resolve).

### 9. ELT impact
None.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.8g-01 | **The fixture gala's report totals equal the ledger memo entries and the provider's balance transactions to the cent** (online and QR gifts, a covered fee, a partial refund, a card-paid pledge; offline and ticket donations reported apart) | int `donations-report.int.test.ts` ("acceptance: the totals equal…"); e2e `donations-report.spec.ts` ("report totals, the ledger check…") |
| AC-M4.8g-02 | **Exports never include donors of the other org** | int "CSV, generic layout…", "Excel…" (the other org's gift never appears); e2e (export journey) |
| AC-M4.8g-03 | Per source (online, QR, paddle, ticket), per level, per match, per donor; pledged vs collected vs written off vs open | unit `donations/tests/report.test.ts`; int "totals per currency…", "per source, per level…" |
| AC-M4.8g-04 | CRM layouts (generic localized, Salesforce NPSP, Bloomerang, Little Green Light) keep the anonymous flag; CSV and XLSX; never a formula | unit `report.test.ts` (and M4.3b's `csv/tests/xlsx-write.test.ts`); int CSV/Excel tests; e2e (step-up, both files) |
| AC-M4.8g-05 | Reconciliation lists differences like M1.6e (missing at provider, missing in ledger, amount mismatch), resolves with a note, clears when both sides agree | unit (`reconcileDonations`, `nextItemStatus`); int "lists a missing provider charge…"; e2e (drift, empty note error, resolved, persisted) |
| AC-M4.8g-06 | Payouts: which payouts carried the gifts; what is not paid out yet | unit (fake payouts, Stripe adapter); int "shows the payouts…"; e2e (aged movements, "Paid") |
| AC-M4.8g-07 | Memo entries only through `payments.post_memo` (memo kinds, own org, once per key); no postings for gifts | int "memo entries are written only…"; `donations.int.test.ts` (memo, no postings) |
| AC-M4.8g-08 | Permissions: viewers refused (hidden card, refused pages and commands); exports need a fresh step-up; finance only reconciles | int (report, exports, reconcile, resolve); e2e (viewer) |
| AC-M4.8g-09 | Isolation: every new table covered; another org can neither read nor reconcile this event | `isolation.int.test.ts`, `canary.int.test.ts` (fixture `donationReconRows`); int "finance only; refuses another org's event…" |
| AC-M4.8g-10 | Empty states, success messages, keyboard only, axe light and dark, Arabic RTL | e2e throughout |

### 11. Security and privacy
- Report and exports name donors: `finance:read` only; the report payload is an allowlist (no order, payment, account ids or tribute notes); exports are step-up bulk operations, audited, refused during impersonation.
- The provider's data is fetched server-side (`reconcileEventDonations`) and never sent by a browser; references, payout ids and notes are internal columns.
- Anonymous donors stay flagged in every layout (the charity sees who gave, P4-13).

### 12. Performance budget
The report reads the event's paid gifts, refunds, pledges, collections, matches and donation ticket lines once (indexed by event); a reconciliation lists at most 10,000 movements per run.

### 13. Rollout
Behind `donations`. Live Stripe needs the owner's account (connected-account listing is written against the pinned API version and tested with the fake Stripe API).

### 14. Build notes (2026-10-03)
Base: build branch (batch 3h, design v2) + `agent/m4.8c`–`f`, then `merge/next-3j` before the final gate (its resolutions of the four donations branches, its migration numbering 0113–0129 and M4.3b's XLSX writer were taken; this increment's own XLSX writer was dropped for M4.3b's). This increment's migration is `0130_green_loa.sql`. Merged again before the final gate: `merge/next-3j` (1294fe0b) and the build branch (dfbf5e28).
- Gate (2026-10-03): lint (one warning, `apps/web/messages/hi.json` over Biome's 1 MiB limit, already on `merge/next-3j`), check:modules ok, typecheck 60/60 (concurrency 2), unit 3,097 passed (229 files), contracts:check ok. Integration, whole suite on the 3j merge: 1,775 passed and 2 failed, both from batch 3j and fixed here (`pledge-collection.int.test.ts` counted the fixture's new match pledge, the same fix 3j then pushed; `audit.int.test.ts`'s tamper test builds two org fixtures, ~18 s each since 3j, so it gets 120 s); after the last merges the changed and isolation files pass (pledge-collection, door-scope, donations-report, isolation, canary: 56/56). e2e on 375/768/1280: `donations-report.spec.ts` 9/9; with `donations`, `matching-gifts`, `giving-screen`, `pledge-collection`, `reconciliation` (M1.6e) and `checkout` (the fake payment page changed): all pass; the Scan PWA check-in test of `pledge-collection` failed identically on a clean `merge/next-3j` and passes after 3j's fix (38c6dff7).

### 15. Demo checklist
- [ ] A connected gala: give two gifts on the giving page (one anonymous), refund part of one from its order page.
- [ ] Donations → **Open the report**: totals, by source/level/donor (Anonymous badge), the ledger check "Not reconciled yet".
- [ ] **Reconciliation** → **Reconcile now**: "Everything matches"; back on the report "Matches to the cent".
- [ ] `POST /api/dev/donations/provider` `op=drift`: reconcile, see "Amounts differ", resolve it with a note.
- [ ] `op=age`: reconcile, see the payouts ("Paid").
- [ ] Export donors for Salesforce (CSV) and generic (Excel): confirm it's you, download both.

### 16. Owner tasks
`docs/owner-inbox.md` → M4.8g.
