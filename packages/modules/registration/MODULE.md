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
