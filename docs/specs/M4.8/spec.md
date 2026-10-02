# Spec: M4.8 — Gala donations

- **Milestone:** M4.8 (Phase 4 plan `docs/plans/phase-4.md` §6, decisions P4-9 to P4-17, approved 2026-09-28; Wave B)
- **Status:** M4.8a and M4.8b built (2026-10-02); M4.8c–g to follow
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

### 16. Owner tasks
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
