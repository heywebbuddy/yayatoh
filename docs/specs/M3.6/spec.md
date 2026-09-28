# Spec: M3.6 — CRM core, audiences and campaigns

- **Milestone:** M3.6 (roadmap Phase 3; `docs/plans/phase-3.md` wave B/C: M3.6a audiences, M3.6b campaigns)
- **Status:** M3.6a built (pending owner review); M3.6b not started
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0008 (outbox, replayed events), 0018 (tokens)

## M3.6a — audiences

### 1. Goal and users
Organizers (owners, admins, managers, marketing members) build **audiences** from what already
happened in Yayatoh — tickets, ticket types, seats, check-ins, spend, attendee labels, consent and
dates — without exporting lists anywhere. The vision's three audiences (docs/vision.md §8) are
templates. M3.6b sends campaigns to them.

### 2. References
- Vision §8: "VIP attendees who purchased tickets but have not selected their seats", "People who
  attended last year's event but have not registered this year", "Registered attendees who have not
  checked in yet".
- Roadmap M3.6 acceptance: "the three audiences return exact fixture results".
- Builds on M2.2c `crm.event_participation` / `crm.contact_stats`, M1.8f attendee labels, M1.4b
  series, M1.7 seats, M1.9 admissions, the marketplace projector pattern.

### 3. Scope
**In:** the live participation projector and `contact_profile`; the segment DSL (typed, validated)
compiled to parameterized SQL; counted and paged results; saved segments per org; the builder under
Marketing → Audiences (org console) with live count and preview; the three templates; export through
the bulk-export path; permissions incl. event-scoped preview.

**Out:** sending (M3.6b), journeys (M3.7), LTV/RFM scores (M6.1), a `/v1` surface for audiences
(additive later), realtime push of counts.

### 4. `touches:`
```yaml
touches:
  - packages/modules/audiences/**            # new module, tier 5
  - packages/modules/crm/**                  # projections, DSL, compiler
  - packages/modules/{attendees,seating,checkin,orders,ticketing,events}/src/**  # fact reads + change events
  - packages/db/drizzle/0060_*.sql
  - packages/testing/**                      # fixture rows, scenario, tests
  - tools/legacy-migrate/src/transforms/t9-derived.ts
  - apps/web/src/app/[locale]/o/[org]/(org)/audiences/**
  - apps/web/src/components/audience-builder.tsx
  - apps/web/messages/*.json
  - apps/web/e2e/audiences.spec.ts
  - apps/worker/src/{registry,bulk}.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `crm.event_participation` | add `registered bool`, `orders int`, `labels text[]` | CHECKs added `NOT VALID` then `VALIDATE`; legacy rows backfilled `registered = tickets > 0` |
| `crm.contact_profile` | new tenant table | per contact: events, events attended, tickets, orders, first/last seen, labels, email/SMS consent summary; FK to contacts (cascade) |
| `audiences.segments` | new tenant table | name (unique per org, case-insensitive), definition jsonb (DSL v1, re-validated on every read) |

`crm.refresh_contact_profiles(org, contact_ids[])` (SQL, SECURITY INVOKER, `search_path = pg_catalog`)
rebuilds profiles from participation and the consent ledger; the projector, `recordConsentTx` and the
migration backfill all use it. Every new column is declared in `private-columns.ts` (labels and
segment text are `internal`). Both orgs of `createOrgFixture` get rows (the projector catches up
and a segment is saved).

**Meaning of a participation row** (live projector = M2.2c backfill): `registered` = an active
attendee record (live ticket held, or a guest); `tickets`/`ticket_type_ids` = live tickets held;
`has_seat` = a held ticket has a bought seat, or the organizer seated the person; `checked_in` = any
of their tickets was admitted (not undone); `orders`/`spend_minor` = paid orders as the buyer, spend
net of succeeded refunds; `registered_at` = earliest active record or paid order; `labels` = the
union of their attendee labels. `has_seat` is per contact × event: a person holding a seated and an
unseated ticket counts as seated.

### 6. Commands, queries and events
| Name | Kind | Permission | Entitlement |
|---|---|---|---|
| `audiences.preview` | query | `messages:read` (event roles apply with `eventId`) | `marketing` |
| `audiences.listSegments`, `audiences.getSegment` | query | `messages:read` | `marketing` |
| `audiences.saveSegment` | command (audited) | `messages:send` | `marketing` |
| `audiences.deleteSegment` | command (category `delete`, audited) | `messages:send` | `marketing` |
| `audiences.startContactsCsv` … | bulk export (step-up, `bulk.start` audit, category `export`) | `attendees:export` | `marketing` |

New outbox events (internal, not public webhooks): `attendees.changed@1` {eventId, contactIds}
(guest added/removed, labels, handover, cancellation, import and its undo),
`seating.assignments_changed@1` {eventId, attendeeIds | null}, `ticket.admission_undone@1`;
offline device sync now emits `ticket.admitted@1` like a live scan. The projector
`audiences.participation` consumes those plus `order.paid`, `order.refunded`, `tickets.cancelled`,
`ticket.admitted`, `attendee.cancelled` — exactly once (`processed_events`), idempotent (rows are
recomputed from sources), and it accepts `replayed` legacy events.

### 7. Segment DSL (v1)
`{ version: 1, root: Group }`; `Group = { type: 'group', op: 'and'|'or', conditions: (Condition|Group)[] }`
(depth ≤ 3, ≤ 30 conditions, ≤ 20 per group; an empty group places no restriction). Conditions:
`participation` (scope; did/did not; as attendee or buyer; ticket types; seated; checked in;
registered between), `spend` (scope, currency, comparison, minor units), `consent` (email/SMS,
given or not), `label` (scope; had / never had), `totals` (events, events attended, tickets,
orders), `seen` (first/last seen between). Scopes: any event, one event, a series, the previous
edition of an event's series (series-relative "last year"), events starting between two dates
(org timezone). Every value is a bound parameter; operators and columns come from fixed tables;
merged and erased contacts never match. Counting runs under `statement_timeout = 10s`.

**Event-scoped access:** a preview with `eventId` is limited to that event's people and may only
look at that event ("any event" means it); other events, series, editions, date ranges and the
org-wide profile conditions are refused (`forbidden`, reason `event_scope`).

### 8. Templates
| Key | Definition |
|---|---|
| `vipsWithoutSeats` | took part in *event* holding one of *ticket types*, no seat |
| `lastYearNotThisYear` | checked in at the previous edition of *event*'s series AND did not take part in *event* |
| `registeredNotCheckedIn` | on *event*'s list, not checked in |

### 10. Acceptance
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M3.6-01 | **Given** the audience scenario **When** the VIP template runs for this year's event and VIP **Then** exactly Ben | `packages/testing/tests/audiences.int.test.ts`, `apps/web/e2e/audiences.spec.ts` |
| AC-M3.6-02 | **When** "last year, not this year" runs **Then** exactly Gus (Hal never checked in; Ava and Ivy registered again) | same |
| AC-M3.6-03 | **When** "registered, not checked in" runs **Then** exactly Ava, Cy, Fin, Ivy (Dee's record cancelled, Eve removed, Ben checked in) | same |
| AC-M3.6-04 | Projection rows equal the sources; recomputing and redelivering change nothing; a replayed legacy event rebuilds a lost row exactly once | `audiences.int.test.ts` (projection) |
| AC-M3.6-05 | A seat, a label and a consent change move people between audiences after catch-up | `audiences.int.test.ts` |
| AC-M3.6-06 | Another org's event ids match nothing; each org sees only its people | `audiences.int.test.ts`, isolation suite |
| AC-M3.6-07 | Viewers are refused; `messages:read` views; `messages:send` saves/deletes; export needs `attendees:export` | `audiences.int.test.ts`, e2e viewer test |
| AC-M3.6-08 | An event manager previews their event only; other scopes and profile totals are refused | `audiences.int.test.ts` |
| AC-M3.6-09 | Export needs a fresh step-up, is audited, and writes allowlisted columns | `audiences.int.test.ts` |
| AC-M3.6-10 | DSL validation rejects unknown shapes; injection attempts stay bound parameters; limits enforced | `packages/modules/crm/tests/segments.test.ts` |
| AC-M3.6-11 | Builder: keyboard-only add/edit, live count and preview, save, reload; axe clean at 375/768/1280; Arabic RTL | `apps/web/e2e/audiences.spec.ts` |

### 11. Security and privacy
Preview output is an allowlist (`AudienceRowDto`: contact id, name, email, event counts, last seen);
no ORM rows leave the module. Definitions are data: re-validated on read, compiled with bound
parameters only. All reads run in `withTenant` under RLS. Export: step-up, audit, impersonation
refusal, allowlisted CSV columns.

### 12. Performance
Count and page are single statements over org-leading indexes (`event_participation` unique
`(org, contact, event)`, `contact_profile (org, contact)`), bounded by a 10 s statement timeout.
Whole-event refreshes (floor-plan edits) recompute one event. Load tests land with M3.x hardening.

### 13. Rollout
Migration 0060 (additive; backfill of legacy `registered` and all profiles). Deploy order: migrate →
worker (projector subscribes and catches up through the relay) → web. Nav entry appears for members
with `messages:read` in orgs with the `marketing` module.

### 16. Owner tasks (pending owner, in docs/owner-inbox.md)
- "Attended last year" = **checked in** at the previous edition (vision wording); switch to
  "registered" if you prefer — organizers can already change it in the builder.
- Audience export uses `attendees:export` (the marketing role can build but not export).
- "Previous edition" = the series event that started last before the chosen one (weekly series
  mean last week, not last year).
