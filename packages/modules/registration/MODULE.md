# registration (tier 5)

Registration types and admission items (M5.1a; layout in ADR 0021). Owns Postgres schema `registration`:
`registration_types`, `admission_items`, `type_items` (the matrix cells) and `capacity_claims`. Later increments
add registrations, approvals, groups, invoices (M5.1c/d) and session enrollments (M5.2b) here.

**Invariants**
- **One inventory.** A registration type × admission item cell is exactly one ticket type, created by
  `registration.setCell` with `managed_by = 'registration'` (hidden, one per order). Orders, tickets, refunds,
  check-in, badges and reports see ordinary tickets. Ticketing refuses to quote, edit or archive a managed pass for
  anyone but registration, so the public checkout, the box office, access codes and `/v1` can't sell or change it.
  Disabling a cell archives its pass and the cell; enabling it again makes a new cell (old tickets still count).
- **A registration** is one registrant: one type, exactly one `admission` item and any `add_on` items, each once
  (`selectionProblem`). Only admission tickets count against the type's capacity.
- **Per-type capacity** is a counter on the type row (`quantity_held + quantity_sold ≤ capacity`, a CHECK). Checkout
  locks the type row, checks the room left beyond the type's waitlist (places waited for and open offers kept back,
  like M3.10a) and claims the place in the same transaction as the ticketing hold. `capacity_claims` records what
  each order counts; the `registration.capacity` subscriber (`order.paid`, `order.expired`, `order.refunded`,
  `order.payment_orphaned`, `tickets.cancelled`, all v1) recomputes the claim from orders and tickets and applies
  only the difference, so replayed or reordered events release a place exactly once. A late payment that no
  longer fits is not counted and emits `registration.type.over_capacity@1`.
- **Eligibility** (open, access code, email domain; subdomains match) is checked in `registration.startCheckout`
  and `registration.joinWaitlist` whatever the client sends (`forbidden`, reason `code_required`, `code_wrong` or
  `domain_not_allowed`). Pages show a buyer only the types they may pick (`publicRegistration`); codes and domains
  never leave the console.
- **Per-type waitlist** is M3.10a's: a full type's buyer joins the line of the admission item they want (managed
  lines have automatic offers off; the organizer's console can't offer on them). When places free (a release, an
  offer lapsing or given up — `waitlist.offer_expired@1`, `waitlist.offer_released@1` — or a capacity raise),
  registration offers them through `offerWaitlistEntryTx` in one queue across the type's lines, in line order;
  open offers count against the type, so each place is offered once. The offer is bought through
  `registration.startCheckout` with its link.
- **Conference pack (P5-11).** Setup commands activate the `conference_pack` event add-on (billing; free in beta,
  `beta_free`) and enforce its per-event quotas (`registrationTypes`, `admissionItems`, `registrants`). A catalog
  price later makes activation a purchase with no code change here.
- **Entitlement and permissions.** Every command and query needs the `registration` module key (P5-1). Reading the
  page is `events:read`; every organizer write `events:write`; checkout `public:checkout`; joining a line
  `public:waitlist`.
- **Public output** is an allowlist (`PublicRegistrationDto`): per type its name, description, all-in price range
  and whether it is full; per offered item its name, description, kind and all-in price.
- **Events:** `registration.type.{created,updated,archived}@1`, `registration.item.{created,updated,archived}@1`,
  `registration.cell.{enabled,disabled}@1` (ids and keys only), `registration.type.over_capacity@1`.
- **`RegistrationTypeRef`** (id, key, name) is the stable reference for other modules (M5.1b form paths, badges).

**Session enrollment and waitlists (M5.2b)** — `src/enrollment.ts`, pure rules in `src/domain/enrollment.ts`:
- **A registrant is their admission ticket** (`registrant_id` → `ticketing.tickets`; one per registrant since M5.1a, so an
  M5.1c substitution keeps the enrollments). The attendee's credential is the order's manage link (`myScheduleQuery`,
  `enrollSessionCommand`, `dropSessionCommand`, `acceptSessionOfferCommand`; `public:enrollment`).
- **Availability by admission item** (`item_sessions`): an `admission` item listing nothing gives every session; a listing
  gives only those; an `add_on` gives only what it lists. A registrant's items are their pass and the order's add-ons.
- **Atomic claim**: every decision runs under the session's counter row lock (`lockEnrollableSessionTx`, program) and a
  per-registrant advisory lock; places move only through program's `claimSessionPlaceTx` / `releaseSessionPlaceTx`, whose
  CHECK (`enrolled <= capacity`) is the last line of defence. Sessions are locked in id order (no deadlocks on swaps).
- **Conflicts**: a pick-one group allows one pick (program's `session_group_picks` is the DB guard); overlapping sessions
  (half-open) are refused with the session in the way (`conflict`, reason `overlap` / `one_per_group`), replaced on
  request (`choice: 'replace'`), or kept both only when neither has a capacity (P5-9, `keep_both`).
- **The line** (`session_enrollments.status = 'waiting'`, FIFO by `(position_at, id)`): a full session's line is joined
  only without conflicts and until the close. A free place belongs to the line first (enrolling promotes before it
  decides). Promotion (`planPromotion`) re-checks each person (still registered, still given the session, no overlap or
  group pick) and passes over for good (`skipped`, with the reason) whoever no longer fits, so it never loops. Per event
  (`enrollment_settings`, default `auto`): `auto` enrols at once; `offer` holds the place as an offer for `offer_minutes`
  (never past the close), accepted from the schedule; the sweeper expires lapsed offers.
- **P5-9 close**: promotion stops 24 h before the session starts (`promotionOpen`); then a free place goes to whoever
  enrols first, and the line takes nobody new (`waitlist_closed`). "Promote now" is refused after the close.
- **Organizer** (`events:write`): `setEnrollmentSettingsCommand`, `setItemSessionsCommand`, `promoteSessionNowCommand`;
  `enrollmentOverviewQuery` (`events:read`): per session places, waiting, offered, the close time.
- **Workers**: `sweepEnrollmentsCommand` (`platform:registration.sweep`, every 30 s after the waitlist sweeper);
  `registrationEnrollment()` ends a cancelled or refunded registrant's sessions (`tickets.cancelled@1`,
  `order.refunded@1`) and promotes; `enrollmentMailer` emails promotions (`registration.session-enrolled`,
  `registration.session-offer`). Event: `registration.session.promoted@1` (`{ eventId, sessionId, enrollmentId,
  registrantId, status, offer }`).
- Entitlement `registration` for every command and query.
