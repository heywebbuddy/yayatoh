# Spec: M3.6 — CRM core, audiences and campaigns

- **Milestone:** M3.6 (roadmap Phase 3; `docs/plans/phase-3.md` wave B/C: M3.6a audiences, M3.6b campaigns)
- **Status:** M3.6a built (pending owner review); M3.6b built (pending owner review)
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

### Gate results (M3.6a, 2026-09-28)
- `pnpm verify`: green. Lint, check:modules and typecheck pass; unit 1010/1010 (106 files); integration 713/713 (90 files).
- New tests: unit 14 (`crm/tests/segments.test.ts` 10, `audiences/tests/templates.test.ts` 4); integration 14 (`testing/tests/audiences.int.test.ts`), plus audience-export coverage in the canary suite; e2e 4 specs × 3 viewports = 12 (`apps/web/e2e/audiences.spec.ts`), all passing.
- Full web e2e: 1105 passed, 32 skipped, 3 failed, none in audiences. `seat-finder.spec.ts:392` (tablet) passes when re-run alone (it failed under load). `ai-draft.spec.ts:171` opens the first `harbor-arts` event link, which now 404s on `/content`. `noindex.spec.ts:55` finds `rtl-*` blog posts that `cms.spec` created on Lakeside, served with a `noindex, nofollow` header. Both depend on shared seeded-org state from other specs and touch no audiences code.
- Found in passing: the two legacy-migrate suites share one test database and deterministic ids. Their whole-database counts (T5 duplicate admissions, T6 consents), the V10 settlement checksum and their per-file random key vaults made them depend on file order. Now fixed: counts and the checksum are scoped to migrated rows, and both suites use one test vault. Still open (reproduced on base 40935d3): if `m22c` runs before `migrate`, `migrate`'s V6 fails. Vitest's default order (by size) runs `migrate` first.

## M3.6b — campaigns

### 1. Goal and users
Organizers (owners, admins, managers, the marketing role) send **campaigns** to the audiences
built in M3.6a: an email designed from blocks with the org's brand kit (or a text message), a test
to their own inbox, a schedule in the org's timezone, and results. Only people who gave express
marketing consent on the channel get it, and one org's 50,000-person send never slows another
org's mail. Viewers and finance read campaigns and results. Roadmap acceptance: **a 50k send stays
fair across tenants.**

### 2. What was built
- **Module `packages/modules/campaigns` (tier 6)** with `MODULE.md`; schema `campaigns`.
- **Block editor** (`apps/web/src/components/campaign-editor.tsx`): heading, text, image, button,
  event card, divider and the mandatory footer (postal address, optional note; the unsubscribe
  link and "why you get this" line are always rendered). Blocks are native form controls; **move
  up / move down / remove buttons** are the accessible alternative to dragging (focus follows the
  block; the footer stays last). Subject, preview text, a font token (`emailFont` in
  `packages/ui/src/tokens.ts`: sans, serif, rounded, email-safe stacks) and the email language (13
  locales). **Preview** in a desktop or mobile frame (sandboxed iframe on the M1.10d preview
  route, so the strict CSP holds), with merge fields showing their fallbacks.
- **Brand kit:** the org's colour (text colour chosen for contrast), logo and name in the header;
  design tokens for every colour and radius; logical properties and `dir` (Arabic RTL).
- **Merge fields** (`@yayatoh/notifications/merge`): `{{first_name}}`, `{{last_name}}`, `{{name}}`,
  `{{email}}`, `{{org_name}}`, each with an optional fallback (`{{first_name|there}}`). Unknown
  fields are refused in the editor; recipient values are HTML-escaped when the dispatcher fills them.
- **Links through the M3.8a redirector:** every button and event card gets a tracked link
  (`createTrackedLinkTx` with `campaignId`, UTM `yayatoh / {channel} / {campaign-slug}`, content =
  block id), created once per block and reused by tests and the send. Buttons may target a
  same-site path of the event's site.
- **Audience:** a saved segment or the "registered, not checked in" / "came last year, not this
  year" templates for an event. **The count is shown before sending** with the excluded people by
  reason (`campaigns.estimateReach`).
- **Recipient snapshot at send time** (`campaign_recipients`): the audience's contacts with their
  reach checked in bulk — address for the channel, platform-erased address (unless consent was
  given again after the erasure), bounce/complaint suppression, marketing unsubscribe, and the
  latest **marketing** consent for the channel (`granted` only). Excluded rows keep the reason.
- **Test sends** to up to 5 addresses (kind `campaigns.test`: transactional, urgent; "[Test]"
  subject and banner; merge fields show fallbacks; never counted; 20 per campaign per hour).
- **Schedules** as a local date-time in the org's timezone (`zonedTimeToUtc`, DST-aware); the
  snapshot is taken when the time comes. A schedule that can't start (nobody to send to, audience
  gone, messaging paused) is cancelled with the reason and emits `campaigns.send_failed@1`.
- **Sending through the existing pipeline:** the campaign's email is rendered once and stored as
  **notifications stored content** (`notifications.stored_contents`, with `{{…}}` placeholders and
  `{{@unsubscribe}}` / `{{@origin}}` tokens); each recipient becomes a `marketing.message` in the
  notifications queue pointing at it (`params._content`). The dispatcher fills it per recipient
  (name, email, the per-message RFC 8058 unsubscribe link) and runs the **policy gate** as for any
  message: consent, suppressions, unsubscribes, federal and state quiet hours (SMS), frequency
  caps, quotas. SMS/WhatsApp campaigns send the text body (org name first, "Reply STOP…").
  Transports are the existing fakes (dev mailbox, memory); M3.5b's providers plug in behind the
  same `Transports` port.
- **Fair per-tenant throttling** (`domain/scheduler.ts`, `apps/worker/src/campaigns.ts`): every 2 s
  the leader starts due schedules, reads the sending campaigns' lanes (platform_reader, audited),
  and `allocate`s up to 500 recipients **round-robin across orgs** (and across an org's campaigns)
  in chunks of 50, each org within its per-minute rate (a tenth of its monthly quota for the
  channel, 30–2,000/min). Each allocation is a pg-boss job `campaigns.release` (exclusive per
  campaign) running `releaseChunkCommand`, which re-checks the org's rate inside the tenant
  transaction. Transactional mail never queues behind a campaign: at most a chunk of an org's
  campaign sits in the dispatcher at a time.
- **Pause / resume / cancel** mid-send; cancel drops pending recipients and cancels queued
  messages (`campaign_cancelled`).
- **Exactly once per recipient:** the recipient row is claimed (`FOR UPDATE SKIP LOCKED`) and
  marked in the same transaction that queues its message, whose dedupe key is
  `campaign:{campaign}:{contact}`.
- **Results** (`campaignResults`, exported for M3.8b): recipients and exclusions by reason,
  pending/released, sent, waiting, not sent (with the gate's reasons), failed, delivered, bounced,
  complained, unsubscribed, clicks and clicking devices; opens are "not tracked" (no pixel).
- **Events (versioned, outbox):** `campaigns.send_started@1`, `campaigns.send_completed@1` (when
  the last message left the queue: sent / not sent / failed), `campaigns.send_failed@1` (a
  schedule that could not start, or provider failures) — for the M3.2b alert engine and M3.8b
  analytics; this module imports neither.
- **Console:** Marketing → **Campaigns** (`/o/{org}/campaigns`, nav for `marketing:read` in orgs
  with the `marketing` module): list with status and recipients, create form, campaign page with
  editor, preview, audience and reach, test send, schedule / send now (with a confirmation that
  states the count), controls, results. 13 locales, Arabic RTL, keyboard, strict CSP (no inline
  styles), axe clean.
- **Dev/CI:** `POST /api/dev/campaigns/run {org}` runs the org's campaigns in-process (what the
  worker's tick and jobs do); `/api/dev/outbox/drain` then sends to the dev mailbox.

### 3. Data model
| Table | Change | Notes |
|---|---|---|
| `campaigns.campaigns` | new | name (unique per org, case-insensitive), channel, status (CHECK), locale, content jsonb, audience (segment or template + event + ticket types, CHECK), schedule and lifecycle times, `rate_per_minute`, `content_id`, `failure_reason` |
| `campaigns.campaign_recipients` | new | unique `(org, campaign, contact)`; status pending/queued/excluded/cancelled; reason CHECK (only excluded rows); `released_at` (queued rows only, CHECK) |
| `campaigns.campaign_links` | new | the tracked link per button/event card, unique `(org, campaign, block)` |
| `notifications.stored_contents` | new | rendered subject / HTML / text / SMS body with placeholders; immutable |

All four: `tenantTable()` (FORCE RLS, NULLIF policy, org-leading indexes), fixture rows for both
orgs (`createOrgFixture` sends a campaign to the org's email subscribers), privacy declared
(`private-columns.ts`; content of `stored_contents` is the organizer's outbound copy → public;
campaign names/drafts internal).

**Migration:** `packages/db/drizzle/0086_flimsy_kinsey_walden.sql` (0076 on the branch, renumbered at merge; new schema and tables; additive).
Hand-written between the markers:
1. `campaign_recipients_contact_fk` → `crm.contacts(org_id, id)` ON DELETE CASCADE.
2. `campaign_links_link_fk` → `marketing.tracking_links(org_id, id)` ON DELETE CASCADE.
3. `campaigns_content_fk` → `notifications.stored_contents(org_id, id)` ON DELETE SET NULL (`content_id`).

### 4. Commands and queries (entitlement `marketing`)
| Name | Kind | Permission |
|---|---|---|
| `campaigns.createCampaign`, `campaigns.saveCampaign`, `campaigns.setAudience` | command (audited) | `marketing:write` |
| `campaigns.deleteCampaign` | command (category `delete`) | `marketing:write` |
| `campaigns.testSend`, `campaigns.scheduleCampaign`, `campaigns.unscheduleCampaign`, `campaigns.sendNow` (idempotent), `campaigns.pauseCampaign`, `campaigns.resumeCampaign`, `campaigns.cancelCampaign` | command (audited) | `messages:send` |
| `campaigns.startScheduled`, `campaigns.releaseChunk`, `campaigns.finalizeCampaign` | command (system actor: worker tick/jobs) | `messages:send` |
| `campaigns.listCampaigns`, `campaigns.getCampaign`, `campaigns.estimateReach`, `campaigns.campaignResults`, `campaigns.campaignPreview` | query | `marketing:read` |

Other modules gained read/write helpers (down the tiers): crm `marketingReachTx`,
`contactsForSendTx`; notifications `storeContentTx`, `storedContentTx`, `renderStoredContent`,
`sendOutcomesTx`, `cancelQueuedByPrefixTx`, `marketingSuppressionsTx`, `queuedSinceByPrefixTx`,
`orgQuotaLimitsTx`, the `./merge` entry and the `campaigns.test` kind (13 locales); marketing
`campaignClicksTx`; ui `emailFont` tokens. `/v1`: none. `/api/v2`: none.

### 5. Acceptance
| Criterion | Test |
|---|---|
| A 50k send stays fair across tenants (roadmap): org A sends 50,000 while org B sends 100; B finishes in its first tick's fair share and its transactional mail goes out at once; A stays within its per-minute rate | `apps/worker/tests/campaigns.int.test.ts` (real DB, 50k snapshot, worker tick, dispatcher, fake transport, time-compressed); unit `packages/modules/campaigns/tests/domain.test.ts` "50,000 vs 100 (time-compressed)…", "round-robins chunks…" |
| Consent enforcement excludes non-consented, withdrawn, legacy, suppressed and unsubscribed contacts with reasons; the gate refuses a consent withdrawn after the snapshot | `packages/testing/tests/campaigns.int.test.ts` "consent enforcement…" ; unit "snapshot rules" |
| Recipient count shown before sending equals the snapshot | int "consent enforcement…" (`estimateReach` = results.reach); e2e "2 people of 3 contacts…" |
| Exactly once per recipient under job retries (concurrent/repeated releases, a crashed job, repeated dispatch) | int "exactly once…" (2 tests) |
| Pause / resume / cancel mid-send; per-org rate from quotas; over-quota messages held | int "pause, resume, cancel and per-org quotas" (2 tests); e2e "schedule… pause, resume and cancel" |
| Schedules in the org timezone (09:00 Chicago = 14:00 UTC), past refused, due start, failed start → cancelled + `send_failed@1` | int "schedules in the org timezone"; e2e schedule test |
| SMS through the same pipeline: SMS marketing consent, quiet hours hold texts, STOP line | int "SMS campaigns" |
| Test sends: ≤ 5 addresses, "[Test]", fallbacks, not counted, hourly limit | int "test sends"; e2e (dev mailbox, axe on the email) |
| Results: delivered, bounced, clicks, opens not tracked | int "results"; e2e results tiles |
| Block editor: keyboard add/move/remove, validation per field, persistence, preview desktop/mobile, merge fields | e2e `apps/web/e2e/campaigns.spec.ts`; unit "blocks", "merge fields", "render" |
| Permissions: viewer reads, no controls, refused commands; box office refused; marketing role builds | int "permissions and isolation"; e2e viewer test |
| Isolation (other org can't read/send/point at its audience or events; fixture rows for both orgs) | int "another org can't…"; `isolation.int.test.ts` |
| 13 locales, Arabic RTL, axe, strict CSP | e2e (every screen, `/ar/…`); `apps/web/tests/messages.test.ts` |

### 6. Later / not yet
- Real providers (M3.5b SES/Twilio/WhatsApp) plug in behind the existing `Transports` port; WhatsApp
  campaigns need approved templates (the gate already blocks marketing to +1 numbers).
- Open tracking (pixel), per-link click reports and revenue tiles (M3.8b), deliverability alerts
  (M3.2b consumes the events).
- Dragging blocks with a pointer (the buttons are the accessible path; a drag layer can come later),
  image upload from the editor (paste a `/media/…` path of an uploaded image or an https URL),
  the "ticket holders without seats" template in the console (it needs ticket types; available
  through the API shape), an org-level postal address setting.
- Pausing does not pull back the (at most one) chunk already handed to the dispatcher.

### 7. Gate results (M3.6b, 2026-09-29)
- `pnpm verify`: green. Lint, check:modules, typecheck; unit 1502/1502 (134 files); integration 969/969 (113 files).
- New tests: unit 20 (`packages/modules/campaigns/tests/domain.test.ts`); integration 14
  (`packages/testing/tests/campaigns.int.test.ts` 13, `apps/worker/tests/campaigns.int.test.ts` 1, the
  50k fairness test); e2e 4 specs × 3 viewports = 12 (`apps/web/e2e/campaigns.spec.ts`), all passing.
- Full web e2e: 1425 passed, 34 skipped, 2 failed: `widget.spec.ts:100` and `:110` (desktop), both
  an axe `page.evaluate` timeout (30 s) on the public-site settings page under full-suite load; the
  whole `widget.spec.ts` passes when re-run alone (25/25). Admin not touched (not run).
