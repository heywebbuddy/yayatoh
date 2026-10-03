# registration (tier 5)

Registration types and admission items (M5.1a; layout in ADR 0021). Owns Postgres schema `registration`:
`registration_types`, `admission_items`, `type_items` (the matrix cells), `capacity_claims` and (M5.1c)
`registrants`, `type_members` (auto-approve member lists) and `reason_templates`. Later increments
add registrations, approvals, groups, invoices (M5.1c/d) and session enrollments (M5.2b) here.

**Invariants**
- **One inventory.** A registration type × admission item cell is exactly one ticket type, created by
  `registration.setCell` with `managed_by = 'registration'` (hidden; up to 20 per order since M5.1c, one per
  named registrant of a group, each registrant still picking each item once). Orders, tickets, refunds,
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

**M5.1c: approval, groups and +1**
- **Registrants** are one named person each: `pending` (applied) → `approved` → `confirmed`, or `denied`; a public,
  group or +1 checkout makes `reserved` registrants of its order, `confirmed` when it is paid (each with one of the
  order's admission tickets, named for them; `registration.registrants` subscriber) or `cancelled` when it lapses.
  An approved applicant whose order lapses stays approved (order cleared) and may pay again.
- **Apply-to-attend** (`approval = 'manual'` on the type): `registration.apply` makes a pending application with no
  order: **nobody is charged before approval**. The public checkout, groups and the waitlist refuse approval types
  (`approval_required`). Auto-approval on applying: an address at an auto-approve domain (subdomains match), else on
  the type's member list (CSV or an audience snapshot taken by the app). A free selection is confirmed on approval;
  a paid one is paid from the applicant's signed link (`registration.payApproved`, which returns the open order of
  an earlier attempt instead of a second one).
- **Capacity on approval:** approved places count against the type's room like open waitlist offers
  (`typeDemandTx().approved`; public room, offer room and the capacity floor subtract them). Approval locks the
  registrant, then the type row, so concurrent approvals never pass the capacity. Every path locks registrant →
  type, and multi-type checkouts lock types in id order.
- **Decisions** (`registration.decide`, bulk `registration.decide` action = `registration.startDecide`): deciding
  what is already decided changes nothing (no second email); bulk runs 50 per chunk, each registrant in its own
  savepoint (a full type fails alone with its code); a crash replays only the uncommitted chunk. Approval and denial
  emails (`registration.approved` / `registration.denied`, dedupe per decision time) carry the reason (typed or a
  reason template).
- **Groups:** one payer, up to 20 named registrants each with a type and pass, one order; capacity claimed per type
  (`capacity_claims` unique per order and type). **Substitution** until the type's cut-off
  (`substitution_cutoff_hours` before the start) by the payer (group link) or the organizer: the ticket is reissued
  (new signed code and short code, the old ones stop), so exactly one credential stays valid; the attendee moves.
  A domain rule binds the new person. Audited (`registration.substitute`).
- **+1:** a type of `kind = 'guest'` is never sold directly or listed publicly; a confirmed host adds guests from
  their own link (up to `guests_per_host`), paid by the host in its own order, linked by `host_registrant_id`.
- **Events:** `registration.registrant.{applied,approved,denied,confirmed,substituted}@1` (ids only).

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

**M5.1d: pay later by invoice**
- Per type (`pay_later`, `po_number` off/optional/required; `registration.setPayLater`, `events:write`); never for approval or +1 types. `registration.startCheckout` with `payLater` checks the type and the PO rule (`pay_later_off`, `po_required`), then invoices the order in the same transaction (`issueInvoiceTx`): the place counts as sold and the registrant is confirmed at once; the balance is the invoice's business. `order.voided@1` releases the claim and cancels the registrant.

**M5.10a: the attendee conference hub**
- **Favorites** (`session_favorites`, one per registrant and session) hold no place and never touch the enrollment counter.
  `favoriteSessionCommand` (`public:enrollment`, the manage link) stars only sessions the registrant's items give; an
  overlap with the personal schedule (enrolled, offered or starred) is refused with the sessions in the way unless the
  attendee chose `keep_both`, or `replace` (un-stars overlapping favorites; refused while an enrolment is in the way:
  enrolments are dropped only by `dropSessionCommand`). At most 300 per registrant. Decisions per registrant are
  serialized by an advisory lock.
- **Calendar feed**: a signed link `{org}~{registrant}~{version}~{hmac}` (`signFeedToken`, the app token secret, its own
  purpose string). `calendarFeedTarget` checks the signature, then `registration.calendar_feed_target` (SECURITY
  DEFINER: active ticket, live org, version only); `calendarFeedQuery` checks the version again under RLS. The feed
  (`calendarFeedIcs`) carries enrolled (CONFIRMED), offered and starred (TENTATIVE) sessions: title, times, room; a
  session keeps its UID and its SEQUENCE grows with the session's (or room's) last change, so a calendar follows a
  moved session. `rotateCalendarFeedCommand` bumps the version (every earlier link stops).
- `conferenceHubQuery`: the hub's allowlisted view (M5.2b states plus `favorite`, `onSchedule`, `conflicts`).
