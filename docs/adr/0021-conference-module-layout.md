# ADR 0021 — Conference module layout (Phase 5)

- **Status:** Accepted (M5.1a, 2026-09-29), within the owner-approved Phase 5 plan (P5-1 to P5-11).
- **Relates to:** ADR 0001 (modular monolith), ADR 0013 (profiles, entitlements), roadmap §3.5 (tiers), `docs/plans/phase-5.md` §3.

## Context
- Phase 5 adds registration types, admission items, approvals, groups, invoices, session enrollment, badges, portals, CFP, booths, sponsor packages, lead retrieval, polls, Q&A, networking and chat.
- Roadmap §3.5 already names the contexts and tiers: `registration` and `badges` at tier 5, `engagement` at tier 4, and `sessions`, `speakers`, `exhibitors`, `sponsors` at tier 3.
- Today the tier-3 contexts live in **one** package, `packages/modules/program` (M1.4f), whose MODULE.md allows M5.2/M5.4 to split it.
- Wave 1 runs seven sessions in parallel; the layout must be fixed before they add tables, or two of them will create the same concept in two places.
- Registration must not become a second inventory: orders, tickets and check-in stay one system (roadmap §5.1–5.2).

## Decision

### New modules
| Module | Tier | Owns (schema) | Calls down to |
|---|---|---|---|
| `registration` | 5 | `registration`: registration types, admission items, the type × item cells, per-type capacity counters and claims; later registrations, approvals, groups, invoices (M5.1c/d), session enrollments (M5.2b) | events, ticketing, orders, billing, program (capacity counters, M5.2b) |
| `badges` | 5 | `badges`: templates, print jobs, printers, print log | events, ticketing (badges bind to ticket types), program, registration is same tier (read through a port) |
| `engagement` | 4 | `engagement`: polls, Q&A, engagement events, networking profiles, connections, meetings, chat | events, program, messaging (moderation), platform realtime |

- **A registration cell is a ticket type.** Each registration type × admission item cell creates one ticket type (`ticket_types.managed_by = 'registration'`). Orders, tickets, refunds, check-in, badges and reports see ordinary tickets. Registration adds only what ticketing cannot express: who may buy (eligibility) and how many people of each type (the per-type capacity counter).
- **Managed ticket types are sold only through their manager.** Ticketing's `quoteTx` refuses a managed ticket type unless the caller names the manager; the Tickets page cannot edit or archive it; the organizer's waitlist console cannot offer on its lines. This keeps eligibility and per-type capacity un-bypassable without any upward call from orders to registration.
- **Per-type waitlists reuse M3.10a.** The lines are the ordinary `orders.waitlists` of the type's admission cells, with automatic offers off; registration makes the offers (through an orders export, down the tiers) when its counter frees a place.

### Program stays one package (no split in Phase 5)
- `program` (tier 3) grows in place, in sub-areas with their own files and MODULE.md sections: **sessions** (session types, included/optional, session groups, capacity counters with a CHECK, agenda publishing, CSV import), **speakers** (speaker tasks, CFP submissions and reviews), **exhibitors** (booths on the floor plan, exhibitor staff, lead licenses and leads), **sponsors** (packages, deliverables).
- Entitlement keys stay per context (`sessions`, `speakers`, `exhibitors`, `sponsors`), as today, so the commercial split already exists without a package split.
- **Lead licenses and leads live in program's exhibitors area** (tier 3 per roadmap §3.5). What a scan may share depends on the attendee's consent (P5-8): program reads it through a narrow `LeadConsentReader` interface in program, implemented in the composition root over crm's consent ledger (tier 1, a downward read); tests use a fake.

### Why not split program now
- The four contexts share one event program: sessions reference rooms, tracks and speakers; exhibitors and sponsors share tiers and booths. Splitting now means composite FKs across four schemas at the same tier, which §3.5 forbids (FKs point only down), or duplicated reference data.
- Wave 1 and 2 increments (M5.2a, M5.3a/b, M5.4a/b) each touch one sub-area; separate files inside one package give the same merge isolation without a data migration.
- A split stays cheap later: each sub-area has its own tables with the `program` schema prefix and its own public exports.

## Alternatives
- **Split program into `sessions`/`speakers`/`exhibitors`/`sponsors` packages now.** Rejected for Phase 5: cross-schema FKs at one tier, a data move of merged M1.4f tables during parallel work, and no gain in entitlements (the keys already exist).
- **Registration owns its own inventory (registrations as the sold unit).** Rejected: a second inventory beside ticket types; orders, refunds, check-in and badges would need a parallel path.
- **Orders calls up into registration through a registered port on every checkout and offer.** Rejected: a runtime port on the money path that every app must remember to register; a missing registration silently disables eligibility. The `managed_by` marker makes the safe outcome the default.
- **Lead retrieval in `engagement` or its own module.** Rejected: the roadmap puts exhibitors at tier 3 and leads belong to exhibitors; engagement (tier 4) can still read lead counts through program's exports.

## Consequences
- Roadmap §3.5 stands as written; `sessions`, `speakers`, `exhibitors` and `sponsors` in its tier table are program's sub-areas (and entitlement keys) until a split.
- Ticketing gains `managed_by`; orders gains `startCheckoutTx`, `joinWaitlistTx`, `offerWaitlistEntryTx` and the `waitlist.offer_released@1` event so a higher tier can drive checkout and offers in its own transaction.
- Every Phase 5 table is a `tenantTable` with fixture rows for both orgs and a `private-columns.ts` entry.
- The `conference_pack` `event_addon` (P5-11) is data in `billing.addons`; activating it for an event is recorded in `billing.event_addons`. Price and quotas change with no code change.

## Revisit when
- Program's sub-areas reach the size where one team or agent owns each, or an entitlement needs data isolation beyond a module key.
- A second consumer (e.g. a membership product) needs to manage ticket types: `managed_by` then gets another value.
