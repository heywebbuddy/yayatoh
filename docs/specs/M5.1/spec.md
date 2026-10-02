# Spec: M5.1 — Advanced registration

- **Milestone:** M5.1 (roadmap §10 Phase 5, "M5.1 Advanced registration (L)"; Phase 5 plan `docs/plans/phase-5.md`, Wave 1: M5.1a)
- **Status:** M5.1a built (2026-09-29); M5.1b (multi-page forms) built (2026-09-29); M5.1c (approval, groups, +1) and M5.1d (invoice, PO, pay later) follow
- **Risk tags:** `db-migration`, `payments` (checkout path), `tenancy` (owner approval)
- **Related:** ADR 0021 (conference module layout, written here), ADR 0001, 0002, 0003, 0013, 0014; M1.5 (inventory, holds, checkout, M1.5f email codes), M3.10a (waitlists with timed offers), P5-1, P5-5, P5-10, P5-11

## M5.1a — registration types and admission items (done)

### 1. Goal and users
Conferences sell **who** registers (Member, Non-member, Student, Exhibitor, Speaker, VIP) separately from
**what** they buy (full pass, day pass, workshop add-on, dinner), with a price per combination, a
capacity per type, and rules on who may pick a type. Organizers set this up on the conference
profile's **Registration** page; buyers see only the types open to them. Inventory, orders,
refunds and check-in stay the one system they are today.

### 2. References
- **Roadmap:** M5.1 ("Registration types × admission items … per-type capacity; waitlist"), §3.5 (tiers), §4.5 (profiles, entitlements), §5.1–5.2.
- **Phase 5 plan:** P5-1 (behind the `registration` key), P5-5 (pay later is per registration type: room left, nothing modeled), P5-10, P5-11 (conference pack).
- **Legacy evidence:** none (Eventmie Pro has no registration types).

### 3. Scope (built)
**Layout (ADR 0021).** New modules `registration` (tier 5), `badges` (tier 5), `engagement` (tier 4); `program` stays one package (tier 3) and grows in sub-areas; lead licenses and leads live in program's exhibitors area with consent read through a narrow interface. Roadmap §3.5 is unchanged.

**Module `packages/modules/registration`** (tier 5, schema `registration`, `MODULE.md`):
- `registration_types` (per event): key, name, description, order, `capacity` (null = no limit), the counter `quantity_held` + `quantity_sold` with the CHECK `held + sold ≤ capacity`, eligibility `open | access_code | email_domain` (code stored normalized; up to 20 domains, subdomains match), archived.
- `admission_items` (per event): key, name, description, kind `admission` (a pass; exactly one per registration) or `add_on`.
- `type_items` (the matrix cells): each enabled cell is **one ticket type** created with `managed_by = 'registration'` (hidden, one per order, named "Type · Item", priced per cell). Disabling archives the pass and the cell; re-enabling makes a new cell.
- `capacity_claims`: what each order counts against its type, as last applied to the counter.
- `RegistrationTypeRef` (id, key, name) and `registration.typeRefs` for M5.1b form paths and badges.

**Managed ticket types (ticketing).** `ticket_types.managed_by` (null or `registration`). `quoteTx` refuses a managed pass to every caller but its manager (so public checkout, the box office, access codes and `/v1` cannot sell it); the ticket-type update/archive commands refuse it (`invalid_state`, reason `managed`); registration edits through `createTicketTypeTx` / `updateTicketTypeTx` / `archiveTicketTypeTx`. `TicketTypeDto` gains `managedBy` (console only; `/v1` wire unchanged).

**Checkout (`registration.startCheckout`, `public:checkout`).** One registrant: a type, one admission item, any add-ons, each once. In one transaction: lock the type row → eligibility (refused with `forbidden`, reason `code_required` / `code_wrong` / `domain_not_allowed`, whatever the client sent) → items offered to the type → room left beyond the type's line (places waited for and open offers kept back) → orders' `startCheckoutTx` (the ordinary checkout, ticketing hold included) → the place claimed on the counter (conditional update; the CHECK is the backstop) → the claim row. A free registration is sold at once.

**Release exactly once (`registration.capacity` subscriber).** On `order.paid`, `order.expired`, `order.refunded`, `order.payment_orphaned` and `tickets.cancelled` (all v1) the order's claim is **recomputed** from orders and tickets (held = items while the order holds stock; sold = active admission tickets once paid) and only the difference reaches the counter. Replays, duplicates and reordered events change nothing. Only admission tickets count: refunding the dinner keeps the registrant's place. A late payment that no longer fits is left uncounted and emits `registration.type.over_capacity@1`.

**Per-type waitlist (M3.10a, no new engine).** A full type's buyer joins the M3.10a line of the admission item they want (`registration.joinWaitlist`, `public:waitlist`, eligibility checked, refused while places are open). Lines of managed passes have automatic offers off; the organizer's console refuses manual offers and turning auto-offer on (`managed`). When places free (a release, `waitlist.offer_expired@1`, the new `waitlist.offer_released@1` for left/declined/removed offers, or a capacity raise), registration offers them through `offerWaitlistEntryTx` in one queue across the type's lines, strict line order; open offers count against the type, so each place is offered once. The offer email is M3.10a's; its link checks out through registration (the waitlist page routes managed passes to `registration.startCheckout`), and eligibility was checked at join (orders still checks the address).

**Conference pack (P5-11).** `billing.addons` (global catalog; `conference_pack`: modules, `price_minor` null = free in beta, quotas `registrationTypes` 30, `admissionItems` 20, `registrants` 5,000) and `billing.event_addons` (per event: source `beta_free | purchase | override`, price snapshot). Setup commands activate it (`beta_free`) and enforce the quotas; checkout enforces `registrants`. A catalog price later makes activation a purchase with no code change here (`addon_purchase_required`).

**Console page** `/o/{org}/e/{event}/registration` (conference profile nav; 404 for profiles without the item): pack status; empty state with "Add standard types and items" (names in the organizer's language); types with eligibility summary, "taken of capacity" and waitlist counts, an edit form (name, description, capacity, who may register, access code, email domains, order) and archive; items with kind; the **type × item matrix** as a table (a labelled price field and Offer / Save price / Stop offering buttons per cell, in a keyboard-focusable scroll region). Viewers see it read-only.

**Public page** `/events/{slug}/register` (linked from the event page's passes section): email and optional code first ("Show my options", rate-limited by the new M1.14 policy `registrationLookup`), then only the types this buyer may pick with their all-in price range and "Full"; one pass (radio) and add-ons (checkboxes), full name; the emailed code (M1.5f, always, so domain eligibility means a proved address); then the payment page or the order. A full type offers "Join the waitlist" instead.

**House rules.** Every write is a `tenantCommand` with `entitlement: 'registration'` (P5-1), `events:write` (organizer) or `public:*`; events `registration.type.{created,updated,archived}@1`, `registration.item.{…}@1`, `registration.cell.{enabled,disabled}@1`; public output through `PublicRegistrationDto` (types: name, description, price range, full; items: name, description, kind, price); every text column declared in `private-columns.ts` (the access code `holder`, domains `internal`); 13 locales, Arabic RTL, logical CSS, tokens only, no inline styles.

### 4. Acceptance
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M5.1a-01 | Per-type capacity 20, **50 concurrent checkouts** → exactly 20 succeed, the rest `type_full`; the counter and claims agree; the CHECK refuses a write past capacity | `packages/testing/tests/registration.int.test.ts` (integration) |
| AC-M5.1a-02 | Release on expiry, cancel (no refund) and refund **exactly once** under replayed events; paid moves held → sold; an add-on refund keeps the place | same (integration) |
| AC-M5.1a-03 | **Ineligible buyer refused in the command** with a forged request (no code, wrong code, other domain, look-alike domain), for checkout and the waitlist; a forged public checkout naming the managed pass is `not_found` | same (integration) |
| AC-M5.1a-04 | Waitlist: a full type takes a line; a freed place is offered to the head of the type's line once; the public can't take it; the offer is bought with its link; a capacity raise offers at once; an offer on a code-only type is bought with the link alone, only by its address | same (integration) |
| AC-M5.1a-05 | Entitlement off (`registration` revoked) refuses queries, organizer commands and checkout (`module_not_enabled`) | same (integration) |
| AC-M5.1a-06 | Isolation: rows for both orgs in every new table (`createOrgFixture`); another org sees nothing and cannot buy | `isolation.int.test.ts`, `registration.int.test.ts` |
| AC-M5.1a-07 | Type × item mapping, eligibility (code, domain, subdomain), capacity maths, strict line-order offers | `packages/modules/registration/tests/domain.test.ts` (unit) |
| AC-M5.1a-08 | Organizer by keyboard: seed defaults, add a code-only and a domain-only type (validation errors shown), set capacity, set matrix prices (bad price refused), persisted after reload; axe clean; no horizontal page scroll | `apps/web/e2e/registration.spec.ts` (e2e ×3 viewports) |
| AC-M5.1a-09 | Buyer: the event page links to registration; ineligible buyers never see code/domain types; eligible buyer registers (keyboard, emailed code, payment); a full type offers its waitlist and joins it | same (e2e) |
| AC-M5.1a-10 | Viewer `jordan@lakeside.test`: page read-only (no write controls, axe clean); the owner's open forms submitted as the viewer are refused | same (e2e) |
| AC-M5.1a-11 | Arabic: console page and public registration render right-to-left, axe clean | same (e2e) |
| AC-M5.1a-12 | Messages in 13 locales with identical keys | `apps/web/tests/messages.test.ts` |

### 5. Migration (`0089_left_doomsday`, was 0076)
New schema `registration` (4 tenant tables, FORCE RLS), `billing.addons` (global) and `billing.event_addons` (tenant), `ticketing.ticket_types.managed_by`. Hand-written, between `-- hand-written` markers: the `ticket_types_managed_by_check` CHECK added `NOT VALID` then validated; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON billing.addons FROM app_user` and the `conference_pack` seed row; composite FKs down the tiers (`registration_types`, `admission_items`, `type_items`, `capacity_claims` → `events.events`; `type_items` → `ticketing.ticket_types`; `capacity_claims` → `orders.orders`). Additive only.

### 6. Changes to existing code
- ticketing: `managed_by`, `quoteTx` `manager`, `createTicketTypeTx` / `updateTicketTypeTx` / `archiveTicketTypeTx`, `ticketTypeStockTx` returns `managedBy`, `TicketTypeDto.managedBy`.
- orders: `startCheckoutTx`, `joinWaitlistTx`, `offerWaitlistEntryTx` (manual offers and auto-offer refused on managed lines), `waitlistDemandTx`, `waitingEntriesTx`, `waitlistEntryByTokenTx`, `orderStockTx`; new event `waitlist.offer_released@1` (left, declined, removed).
- billing: add-on catalog and `ensureEventAddonTx` / `eventAddonTx`.
- platform: M1.14 policy `registrationLookup`.
- web: Registration page, public registration page, event page link, waitlist offer checkout routed through registration for managed passes, `guestEmailStep` purpose `checkout`; worker and dev drain run `registration.capacity`.

### 7. Pending owner (owner inbox)
- Conference pack quotas (30 types, 20 items, 5,000 registrants per event) and its price (null = free in beta; D22).
- Registration always asks for the emailed code (even when the org turned the checkout email check off), so domain eligibility means a proved address.

### 8. Decisions and deviations
- **No second inventory:** capacity per type is a counter over ordinary tickets; the per-type limit is the only extra rule. Items have no capacity of their own yet (M5.2b: availability by admission item).
- **One registrant per checkout.** Groups and +1 are M5.1c.
- **Box office** cannot sell managed passes (refused as `not_found`); registration at the door is a later increment.
- Releases are eventually consistent (the subscriber), claims are immediate; a place freed by an expiry is kept back from nobody meanwhile (the counter is conservative).

### 9. Later
- M5.1b multi-page forms per registration type (keyed by `RegistrationTypeRef`); M5.1c approvals, groups, +1; M5.1d invoices, PO and pay later per type (P5-5); M5.2b availability by admission item and session enrollment; M5.5a badges by type; registration at the box office; day passes bound to access dates.

## M5.1b — Multi-page conditional forms (done)

- **Risk tags:** `db-migration`, `tenancy`, `legal-copy` (the consent wording is a placeholder).
- **Related ADRs:** 0002, 0003, 0014, 0016. No new ADR (M5.1a writes ADR 0021 on the module layout).

### What was built
The forms engine (`@yayatoh/forms`, tier 1) gains a third kind, **`registration`**, next to `checkout_questions` and `survey`, which are unchanged: their commands, definitions (`FormDefinition`), validation (`checkAnswers`, hidden answers still dropped) and tests behave exactly as before (their commands refuse the new kind).

- **Definitions** (`src/registration.ts`, pure and client-safe): ordered **pages** (1–20), each with a title, optional description, questions, an optional page condition (the safe JsonLogic subset) and an optional list of **registration type ids**. Questions can also be limited to types and carry a condition. Conditions may only read questions that come earlier (earlier pages, or earlier on the same page); keys are unique across the form. Versioned like every form: a published version is immutable, and a respondent is pinned to the version they started on.
- **Registration types are opaque ids** supplied by the caller in the evaluation context (`registrationTypeId`, `[A-Za-z0-9_-]{1,64}`). M5.1a's types plug in at the Wave 2 wiring with no forms change. **Until then the web uses the event's ticket types as stand-in types** (`apps/web/src/server/registration-types.ts`, two functions to swap).
- **Path computation** (`computePath`): the pages and questions a registration type and the answers so far lead to; a condition sees only answers already on the path, and a page with no visible question is skipped. The browser and the server run the same function (property test).
- **Server authority** (`checkRegistrationAnswers`): recomputes the path, validates and normalizes every answer on it, enforces required questions on visible pages, and **rejects** (never drops) an answer to a question the respondent cannot see (another type's question, a hidden page, a false condition, an unknown key) with a `DomainError` naming the field (`validation_failed`, reason `hidden_answer`). The respondent's own stored draft answers that fell off the path after they changed an earlier answer are dropped (nothing the client sends now is).
- **New question types:** `company` (free text; suggestions from the event's exhibitors and sponsors and from companies at least two registrants named, `forms.companies`, 2+ letters, through public exports), `job_title` (the org-editable list in `forms.job_titles` plus "Other" with free text), and `consent` (a checkbox bound to a versioned term of the crm consent ledger: never pre-ticked, never required, never private; checking it records `granted` with the term's purpose and **version** on submit; unchecked records nothing).
- **Consent ledger** (`@yayatoh/crm`): `CONSENT_TERMS` (term → channel, purpose, versions), new purpose `exhibitor_sharing` (P5-8, "Exhibitors may receive my email when I let them scan my badge", default off) and a nullable `version` column on `crm.consents`; `recordTermConsentTx` finds or creates the contact (source `registration`) and appends the row. Marketing consent and the contact profile's summaries are untouched (they read `marketing` only). Forms reaches the ledger through a port: `submitRegistrationFormCommand({ recordConsent })`, wired with crm's function by the apps and tests.
- **Respondents and save/resume** (`forms.respondents`): one row per person filling the form (registration type id, name, email, locale, pinned version, current page, draft answers). Sensitive answers stay in one KeyVault envelope in the draft and in the response. The link is `<respondentId>~<hmac>` (purpose `forms.respondent`, M1.5f link rules, nothing secret stored; the org comes from `forms.respondent_org()`, a SECURITY DEFINER function returning ids of live orgs only). It works for one respondent, until the draft expires **14 days after the last save** (sliding), and shows "submitted" once used. "Save and email me a link" emails it through the notifications dispatcher (`forms.resume`, transactional, dedupe `form-resume:{id}:{n}`, at most 5 per respondent plus the `registrationForm` rate limit). Expired drafts are **deleted** by the daily retention pass (`registrationDrafts`). On submit the answers become one `form_responses` row (respondent `form_respondent`, pinned version), the draft is emptied and `form.registration_submitted@1` is emitted.
- **Commands** (all through `tenantCommand`, entitlement **`registration`** per P5-1): `forms.publishRegistrationForm` (events:write, optimistic concurrency via `expectedVersion`: a publish from a stale version is `conflict`/`stale_version`), `forms.setJobTitles` (events:write), `forms.startRegistrationForm`, `forms.saveRegistrationPage` (`next`/`back`/`stay`/`email`), `forms.submitRegistrationForm` (public, by link); queries `forms.getRegistrationForm` and `forms.listJobTitles` (events:read). The respondent payload (`PublicRespondentDto`) is an allowlist: only the current page of the path, this type's questions (no type lists), and the person's own answers to it.
- **Builder UI** (`/o/{org}/e/{event}/registration-form`, linked from the conference Registration section; conference profiles with the `registration` module only): pages and questions as lists with **move up/down buttons** (the keyboard alternative to dragging), page and question settings (who sees it: every type or some; when: always or "only when an earlier answer matches" with question/comparison/answer selects), add-question forms for every type (the consent term picker), the org job title list, and a **preview per registration type**. Every change publishes a new version; viewers see the form without controls.
- **Respondent UI:** `/events/{slug}/registration-form` (pick a type, name and email) then `/registration-form/{token}`: one page at a time, "Step n of m" with a progress bar, Continue / Save and email me a link / Back, the error summary focused on refusal with a link to the question, focus moved to the new page's heading between pages. Same-page conditions update as the person types; on the last page "Submit" first saves the page, so an answer that opens a later page leads there instead of submitting.
- **Strict CSP, tokens only, logical CSS**, 13 locales with Arabic RTL (`registrationForm.*`, `notifications.kinds.forms.resume`, the `forms.resume` email template).

### Not yet / later
- **Wave 2 wiring (M5.1a/M5.1c):** registration types from the `registration` module instead of ticket types; the form embedded in the registration checkout; responses shown per registration; a `registration` respondent type. The standalone public start page stays for testing and can be retired then.
- **Email proof before consent:** the standalone flow does not verify the address before submit (the resume email only proves it when used). Wave 2 submits through the registration checkout, which verifies the buyer's email (M1.5f), so an exhibitor-sharing consent is then always tied to a verified address.
- **DSAR:** submitted respondents (name, email, answers) are not yet in the data-subject export/erase (M1.14c); they join it with registrations in Wave 2. Drafts are deleted after 14 days.
- **Withdrawing** the exhibitor-sharing consent afterwards and "who scanned me" (P5-8) come with lead retrieval (M5.6b).
- The builder edits single-clause conditions (is / is not / includes); the engine accepts the full safe subset, and other conditions show as "custom" and can be kept or replaced.
- Company suggestions from crm contacts: contacts have no company field yet.

### Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | `registration` kind with ordered pages, page conditions on earlier answers, versioned definitions (immutable versions, submissions pinned) | `packages/modules/forms/tests/registration.test.ts`, `packages/testing/tests/registration-forms.int.test.ts` ("pins a respondent…", "publishes immutable versions…") |
| AC2 | Per-type paths computed server-side; **a fixture path shows and validates exactly the right pages for three registration types** | `registration-forms.int.test.ts` ("the fixture path for three registration types"), `registration.test.ts` ("path computation") |
| AC3 | **Answers on hidden pages or questions are rejected** with a `DomainError` naming the field; required questions on visible pages enforced | `registration-forms.int.test.ts` ("server authority"), `registration.test.ts` ("rejects (never drops)…") |
| AC4 | Property test: the server's path equals the client's for random forms, types and answer sets | `registration.test.ts` ("property: the server path equals the client path") |
| AC5 | Company lookup (suggestions, free text), job title list plus "other", consent checkbox bound to the ledger: checked records a versioned entry, unchecked nothing | `registration.test.ts`, `registration-forms.int.test.ts` ("consent questions and the ledger", "job titles and company suggestions") |
| AC6 | Save and resume by signed link emailed through the dispatcher; expired/forged/used links refused; drafts purged; sensitive answers in the KeyVault envelope | `registration-forms.int.test.ts` ("save and resume", "keeps sensitive answers…") |
| AC7 | Existing kinds unchanged | `packages/modules/forms/tests/definition.test.ts`, `packages/testing/tests/forms.int.test.ts`, `surveys.int.test.ts`, `registration-forms.int.test.ts` ("leaves the existing kinds alone") |
| AC8 | Gated by the `registration` module; viewers read but cannot edit; tenant isolation (fixture rows for both orgs in every new table) | `registration-forms.int.test.ts`, `packages/testing/tests/isolation.int.test.ts` |
| AC9 | Builder with keyboard (move up/down, settings, conditions), preview per type, job titles; persistence after reload; axe; Arabic RTL; viewer sees no controls | `apps/web/e2e/registration-form.spec.ts` |
| AC10 | Respondent: two types fill different paths, save, resume from the emailed link (dev mailbox), submit; validation messages, focus management, progress; axe; Arabic RTL | `apps/web/e2e/registration-form.spec.ts` |

## M5.1c — Approval, groups and +1 (done)

- **Risk tags:** `db-migration`, `tenancy`, `payments` (pay link on the org's funds flow), `legal-copy` (decision emails).
- **Related ADRs:** 0002, 0003, 0014, 0021. Decisions: P5-1, P5-11.

### What was built
- **Registrants** (`registration.registrants`): one named person per row with the states `pending → approved → confirmed` or `denied` (applications), and `reserved → confirmed` or `cancelled` (public, group and +1 checkouts). Every registration through the module now records its registrant; a confirmed registrant holds exactly one admission ticket, named for them. The order lifecycle subscriber `registration.registrants` confirms on `order.paid`, cancels reserved registrants when an order lapses (approved applicants keep their approval), and cancels registrants whose ticket was refunded or cancelled.
- **Apply-to-attend per type** (`approval = 'manual'`): the public page shows the type "By application" with company, job title and a message; `registration.apply` (email proved first, M1.5f) creates a pending application with **no order** (nobody is charged before approval). Auto-approve rules: **email domains** (subdomains match) and a **member list** (CSV file or pasted addresses, or a snapshot of an audience; at most 5,000). A free selection is confirmed on approval; a paid one is paid from the applicant's signed link (`/events/{slug}/registration/{token}`), which is **idempotent** (an open order of an earlier attempt is returned; the provider call uses the order's idempotency key).
- **Capacity on approval under concurrency:** approved places are kept back like open waitlist offers (public room, waitlist offer room and the capacity floor count them); approval locks the registrant then the type row.
- **Decisions:** single (queue drawer) and **bulk** as one resumable bulk operation (`registration.decide`, 50 per chunk, a savepoint per registrant, safe retries: re-deciding changes nothing and sends nothing), with a typed reason or an organizer **reason template**; approval and denial emails (`registration.approved`, `registration.denied`, 13 locales, the reason in the body).
- **Group registration** (`/events/{slug}/register/group`): one payer (email proved), up to 20 named people, each with their own type and pass, one order and payment; capacity claimed per type (one capacity claim per order and type). The payer's group page (`/events/{slug}/group/{token}`) replaces a name until the type's cut-off (default 24 h before the start); the organizer can too, from the drawer. **Substitution reissues the ticket** (new signed code and short code; older codes stop scanning), so exactly one credential stays valid; the attendee (badge source) moves to the new person; audited.
- **Guest (+1) types** (`kind = 'guest'`, allowance per host 1–10): never sold directly or listed publicly; a confirmed host adds a guest from their own page, paid by the host in its own order and linked by `host_registrant_id`. Separate from wedding parties (M4.1a): no shared tables; only the word "guest" is shared.
- **Console:** per-type rules on the Registration page (approval, auto-approve domains, member list, +1 kind and allowance, substitution cut-off) and the **Applications** queue (`/o/{org}/e/{event}/registration/applications`): status chips with counts, type filter, name/email search, pages of 50, a detail drawer with the application answers, decision trail, group and guests, approve/deny with reason or template, bulk decisions with progress, reason templates, substitution. Viewers read only.
- **Freeze and impersonation:** the registration module joins both sweeps; `registration.removeReasonTemplate` carries `delete`.

### Not yet / later
- The M5.1b multi-page form inside apply-to-attend (applications ask company, job title and a message today).
- Add-ons per person and code-only types in group checkout (groups sell open and email-domain types' passes).
- A host or payer substituting a +1 guest (the organizer can).
- An "application received" email (the applicant's page shows the status at once).
- Badges (M5.5) read the ticket holder; nothing extra is needed when they land.
- Design v2 restyle: `origin/agent/design-v2` conflicted outside this increment's files (ui tokens, the drizzle journal, the message files) and was not merged here.

### Acceptance
| Criterion | Test |
|---|---|
| Apply, auto-approve by domain and member list; no order before approval; approval/guest types refused by the public checkout and waitlist | `packages/testing/tests/registration-approvals.int.test.ts` ("applying makes a pending application…", "auto-approves…"); `apps/web/e2e/registration-approvals.spec.ts` ("apply, get auto-approved by domain…") |
| Manual approve and pay; pay link idempotent | int ("manual approval, then pay…"); e2e ("manual approval with a reason by keyboard…") |
| A denied registrant is never charged; denial email with reason (typed or template) | int ("deny with a reason…"); e2e ("bulk deny with a template reason…") |
| Bulk approve of 500 is one resumable operation (killed mid-chunk and resumed; each decided and emailed once) | int ("approves 500 as one resumable operation…") |
| Capacity per type respected on approval under concurrency | int ("capacity per type holds under concurrent approvals") |
| Group checkout with three names; substitution keeps exactly one valid credential; cut-off; audited | int ("one payer, three named registrants…"); e2e ("group checkout with three names…") |
| +1 type linked to the host, allowance enforced | int ("a confirmed host adds a guest…"); e2e ("…then bring a +1") |
| Isolation; impersonation and freeze coverage | int ("queue filters… tenant isolation"), `isolation.int.test.ts` (fixture rows), `freeze.int.test.ts`, `impersonation.int.test.ts` |
| Keyboard only, axe, RTL, viewer denied | e2e (keyboard rules and decisions, `expectAccessible` on every screen, "Arabic…", "the viewer reads the queue…") |

### Migration
`0095_thick_sabra` (renumbered at merge): new tables `registration.registrants`, `type_members`, `reason_templates` (FORCE RLS, org-leading indexes, composite FKs); new columns on `registration_types` (`approval`, `auto_approve_domains`, `kind`, `guests_per_host`, `substitution_cutoff_hours`). Hand edits: the per-type capacity claim index built before the old per-order one is dropped; the two CHECKs on `registration_types` added `NOT VALID` then validated; cross-module FKs (registrants → events, orders, tickets; type_members and reason_templates → events); managed passes' `max_per_order` raised from 1 to 20 (plain update, before launch).
