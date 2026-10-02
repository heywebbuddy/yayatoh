# Spec: M4.2 — Social profiles and workspace

- **Milestone:** M4.2 (roadmap §10 Phase 4, "M4.2 Social profiles and workspace (M)"; Phase 4 plan `docs/plans/phase-4.md`, Wave A)
- **Status:** M4.2a built (2026-09-29); M4.2b built (2026-10-02: gala tables & sponsors, table tickets)
- **Risk tags:** `auth`, `tenancy`, `db-migration`
- **Related decisions:** P4-3 (guest privacy), P4-8 (co-host and planner roles), D19 (wedding tabs)

## M4.2a — social workspace: event roles, route and vocabulary sweep, checklists and templates (done)

### 1. Goal and users
A couple, a gala chair and their planner work on one event without seeing the rest of the
organization. A wedding looks like a wedding: guests, RSVP and hosts, never attendees, registration,
organizers or tickets; its conference and ticketing pages don't exist, not just hidden. Weddings
and galas start from a template that gives them the right workspace and onboarding checklist.

### 2. References
- **Decisions:** P4-8 (co-host: full access to that event; planner: guests, RSVP, seating and day-of, no payouts), P4-3 (weddings never on the marketplace), D19 (wedding tabs).
- **Roadmap:** §4.5 profiles, entitlements and vocabulary; M4.2 acceptance "a wedding user sees no conference or ticketing modules unless enabled".
- **Legacy evidence:** none (Eventmie Pro has no event-scoped roles).

### 3. Scope
**In (built):**
- **Event roles `co_host` and `planner`** (`events.event_role_assignments`), one team role per person per event. Permissions in `@yayatoh/tenancy` (`EVENT_ROLE_PERMISSIONS`) accept `module:*` wildcards, so permissions later modules add (`guests:*`, `rsvp:*`, `website:*`, `gallery:*`, `dayof:*`, `tickets:*`, `tables:*`) map to co-hosts and planners **by name** with no change here (M4.1a's guests permissions included). No event role can ever grant `platform:`, `payouts:`, `billing:`, `members:`, `api_keys:`, `audit:`, `privacy:` or `org:` permissions, whatever its wildcards.
  - **Co-host:** `events:*`, `seating:*`, orders read/sell/support/refund, `attendees:*`, `contacts:read`, `checkin:*`, `messages:*`, `marketing:write`, `finance:read` (that event), `event_team:*`, and the social modules. Every console section of the event.
  - **Planner:** `events:read`, `seating:*`, attendees read/write, `checkin:scan`, `messages:*` and the social modules. Sections: Home, Guests, RSVP, Seating, Seat finder, Website, Gallery, Messages, Day-of (`EVENT_ROLE_SECTIONS`).
- **New permissions:** `seating:write` (every seating write; owners, admins, managers, event managers, co-hosts, planners — it replaces `events:write` on seating commands so a planner seats guests without editing the event), `event_team:read` (owners, admins, managers, viewers, co-hosts), `event_team:manage` (owners, admins, co-hosts).
- **Org role `collaborator`:** someone invited to an event who isn't in the org joins as a collaborator: org-wide they only read the org's name (`org:read`). `GRANTABLE_ORG_ROLES` (org invitations) leaves it out.
- **Enforcement:** the command pipeline's authorize step (event roles apply only to commands and queries whose input names the event, `eventId`); `loadEvent(org, event, section)` in every event page, route handler and Server Action (404 unless the profile shows the section and, for a collaborator, a team role opens it); `loadConsole` (every org page and org action) is a 404 for collaborators; the seating stream route checks the same. The event nav lists only the sections the person may open.
- **Team page** (`/o/{org}/e/{event}/team`): the roles explained; invite by email with a role (reusing the org invitation table, its HMAC token rules, 7-day expiry and one-pending-per-address rule); the team with change role / remove (step-up, confirmation, announced); pending invitations with withdraw. Read-only for members with `event_team:read`.
- **Invitations:** `tenancy.invitations` gets `event_id` + `event_role`; the email is a new kind `tenancy.event-invitation` naming the event and role (13 locales); the accept page names the event (`events.invitation_event`, SECURITY DEFINER, allowlisted columns). Accepting grants the event role through the `EventRoleGranter` port (`grantTeamRoleTx`) in the same transaction; an existing member keeps their org role.
- **Revocation** is immediate (every request re-reads live assignments); removing a collaborator's last event also removes their membership.
- **Collaborator console:** the org home lists just their events with their role on each ("Your events"); the org nav shows only Home.
- **Route sweep:** `Profile.strictRoutes` (wedding, gala): event pages outside the profile's navigation are a 404, not only hidden (tickets & orders, orders, attendees, analysis, marketing, on-site, sessions, speakers, exhibitors, sponsors, registration, reviews without tickets…). Details, content, images, access, dates, copies, the setup guide and the team stay for every profile. A gala keeps Tickets & Orders. `apps/web/tests/event-routes.test.ts` fails when a new event page, route or action forgets the section guard.
- **Vocabulary sweep:** the wedding and gala overlays add `organizer → host`; `profileCopy.<profile>.*` messages reword the sentences around the nav labels (announcements, private info, access codes, dates, duplicate, push hint, the co-host explanation) for weddings (guests, no tickets) and galas (guests); the event layout merges them into its client messages and server pages use `profileT`. The ticket KPIs leave the wedding home.
- **Checklists per profile** (`Profile.checklist`, the setup guide and the home readiness card): wedding — guest list, RSVP deadline, floor plan, guest website; gala — tables & sponsors, floor plan (plus tickets, from its nav). Items whose page is still a placeholder (`PLACEHOLDER_SECTIONS`) show **Coming soon**, link to that placeholder page and never count toward readiness. The floor plan item is live (a seating plan exists). The gala nav gains a **Tables & Sponsors** placeholder (M4.2b fills it).
- **Starter templates** (`@yayatoh/templates` `STARTER_TEMPLATES`): **Wedding** (private, 6 h) and **Gala** (public, 5 h) on the Templates page, showing the sections and checklist each presets; creating one opens the new event's setup guide.

**Later / not yet:**
- **M4.1a mapping at merge:** guests permissions named `guests:*`/`rsvp:*` map automatically; if M4.1a names them otherwise, add them to `EVENT_ROLE_PERMISSIONS` (co-host and planner) and remove `guests`/`rsvp` from `PLACEHOLDER_SECTIONS` with a real fact for `guestsAdded` / `rsvpDeadlineSet`.
- Order-keyed commands (refunds, the order page) don't carry `eventId`, so event roles can't reach them yet: a co-host can't refund from their event (pending owner, see the inbox).
- `/v1` has no event-scoped tokens; API keys stay org-wide (nothing to scope yet).
- One pending invitation per address per org (the existing unique index); a second event invite waits until the first is accepted or withdrawn.
- A wedding cannot switch on Tickets ("unless enabled") per event yet: modules are org entitlements, and the wedding profile lists no ticketing section. Per-event module toggles come with the gala tickets tab (M4.2b) if the owner wants them for weddings.
- Strict routes for the other profiles (concert, conference, community, agency, other) after their own sweep; they keep today's reachable-but-unlisted pages (seating on a concert).
- Cross-client planners (one planner across many clients' orgs) wait for Agency (M6.7).
- Day-of for weddings stays a placeholder (the check-in console is On-site for ticketed profiles).

### 4. `touches:`
```yaml
touches:
  - packages/modules/tenancy/** (roles, permissions, invitations, mailer)
  - packages/modules/events/** (team commands and queries, EVENT_ROLES)
  - packages/modules/seating/src/*.ts (seating:write)
  - packages/modules/templates/src/starters.ts
  - packages/modules/notifications/** (tenancy.event-invitation kind)
  - packages/platform/src/profiles/index.ts
  - packages/db/drizzle/0079_pale_molten_man.sql (renumbered from 0066 at the batch 3c merge)
  - apps/web/src/server/console.ts, apps/web/src/lib/{readiness,profile-copy}.ts
  - apps/web/src/app/[locale]/o/[org]/** (every event page and action: section guard; team page; org home; templates)
  - apps/web/src/app/[locale]/invite/**
  - apps/web/messages/*.json, apps/api/openapi.json, packages/sdk/src/schema.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `tenancy.invitations` | add `event_id uuid`, `event_role text`; CHECK both-or-neither and role in (co_host, planner); index (org_id, event_id); composite FK (org_id, event_id) → `events.events` ON DELETE CASCADE | hand-written FK, NOT VALID + VALIDATE |
| `tenancy.memberships`, `tenancy.invitations` | role CHECK widened with `collaborator` | NOT VALID + VALIDATE (expand only) |
| `events.event_role_assignments` | role CHECK widened with `co_host`, `planner` | NOT VALID + VALIDATE |
| `events.invitation_event(uuid)` | new SECURITY DEFINER function | event name + role for the accept page |

No new tables (the isolation suite already covers both tables for both orgs). `event_role` is declared `vocab` in tenancy's `private-columns.ts`.

### 6. API diff
- **`/v1`:** `OrgRole` enum gains `collaborator` (a response enum value added: additive).
- **Commands/queries:** `events.inviteTeamMember` (`event_team:manage`, step-up), `events.revokeTeamInvitation` (`event_team:manage`), `events.changeTeamRole` (`event_team:manage`, step-up), `events.removeTeamMember` (`event_team:manage`, step-up, category delete), `events.team` (`event_team:read`), `events.myTeamEvents` and `events.teamEventBySlug` (`org:read`, the actor's own team roles only). `tenancy.inviteMember` refuses `collaborator`. Seating writes need `seating:write`; `seating.listLayouts`/`getLayout` take an optional `eventId` (authorization scope).
- **`/api/v2`:** none.

### 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `invitation.created` | 1 (payload gains optional `eventRole`, `eventName`) | events (team invite) | tenancy invitation mailer | no |

### 8. Entitlements and flags
- **Module keys:** `core` (team), `seating`; profiles `wedding` and `gala` (strict routes, checklists, vocabulary).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.2a-01 | Role → permission matrix: co-host everything about the event, planner guests/RSVP/seating/website/gallery/messages/day-of; neither reaches payouts, billing, members, keys, audit, privacy or org settings | `packages/modules/tenancy/tests/permissions.test.ts` (unit) |
| AC-M4.2a-02 | Invite by email with the org token rules; the email names the event; one pending per address; unknown/foreign events and viewers refused; withdrawn invitations can't be accepted; every change audited | `packages/testing/tests/event-team.int.test.ts` (integration) |
| AC-M4.2a-03 | Event roles can't reach other events, the org-wide event list, org settings or members; planners refused on payouts and refunds commands; nothing in another org | `packages/testing/tests/event-team.int.test.ts` |
| AC-M4.2a-04 | Revocation takes effect immediately; a collaborator's last event takes the org with it; role changes replace (one team role) | `packages/testing/tests/event-team.int.test.ts` |
| AC-M4.2a-05 | An owner invites a planner and a co-host to a wedding; each accepts and sees exactly their pages; the planner is refused a payouts URL, org pages and other events; revoking removes access; keyboard, axe, Arabic RTL | `apps/web/e2e/social-workspace.spec.ts` (e2e) |
| AC-M4.2a-06 | A wedding user sees no conference or ticketing modules, and their direct URLs are a 404; a gala keeps tickets | `apps/web/e2e/social-workspace.spec.ts`, `packages/platform/tests/profiles.test.ts` |
| AC-M4.2a-07 | Every screen reachable in the wedding (and gala) nav uses the profile's words (no attendee, registration, organizer; no ticket for weddings) | `apps/web/e2e/social-workspace.spec.ts` (walker), `packages/platform/tests/profiles.test.ts` |
| AC-M4.2a-08 | Wedding and Gala templates create events with the right checklist; items for unbuilt features are "coming soon", link to their placeholder and don't count | `apps/web/e2e/social-workspace.spec.ts`, `apps/web/tests/readiness.test.ts` |
| AC-M4.2a-09 | Every event page, route and action is section-guarded; placeholder sections match the routes on disk | `apps/web/tests/event-routes.test.ts` (unit) |
| AC-M4.2a-10 | A viewer sees an event team read-only (no invite, no remove) | `apps/web/e2e/social-workspace.spec.ts` |

### 11. Security and privacy
- Tenant from the route only; collaborators resolve their event through their own live team roles (`teamEventBySlugQuery`), never a header.
- Invitation tokens: HMAC of the id (unchanged); nothing stored; accept requires the invitation's verified email.
- Step-up on invite, role change and removal; audit rows `event.team.invite|revokeInvitation|changeRole|remove` and `invitation.accept`.
- Defence in depth: `NEVER_EVENT_SCOPED` in `eventRoleCan`.

### 15. Demo checklist
- [ ] As the wedding owner, Templates → Starter templates → Wedding → create; the setup guide shows the wedding checklist with "Coming soon" items.
- [ ] Event → Team: invite a planner and a co-host; accept each from the emailed link (dev mailbox) in another browser.
- [ ] The planner sees Your events → the wedding with Home, Guests, RSVP, Seating, Seat finder, Website, Gallery, Messages, Day-of; `/o/rosewood-weddings/payouts` is a 404.
- [ ] Remove the planner; their next page load is a 404.
- [ ] Open `…/tickets-orders` on the wedding: 404. A gala keeps Tickets & Orders.

### 16. Owner tasks
- [ ] Confirm the co-host/planner defaults (docs/owner-inbox.md, M4.2a).

### Gate (2026-09-29)
`pnpm verify` green (lint, check:modules, typecheck, 1298 unit, 801 integration); `pnpm contracts:check` green; the whole web e2e suite at 375/768/1280: 1228 passed, 32 skipped (existing skips), 0 failed. New tests: `event-team.int.test.ts` (15), `social-workspace.spec.ts` (7 × 3 viewports), unit additions in `permissions.test.ts`, `profiles.test.ts`, `readiness.test.ts`, `event-routes.test.ts`.

## M4.2b — gala tables and sponsors (built 2026-10-02)

### 1. Goal and users
A gala sells whole tables. A company buys "a table of 10", pays once and then tells the host who
sits at it, through one link, without an account. The host sees every purchased table, which names
are still missing, can name guests by hand and nudge buyers. Tables on the floor plan carry their
sponsor's name, which guests see in the seat finder once the host shows it.

### 2. References
- **Plan:** `docs/plans/phase-4.md` Wave B (M4.2b), the gala profile; P4-8 (co-host `tables:*`; planners get no tables).
- **Reused flows:** ticket issue (`issueTicketsTx`), the claim/transfer reissue (`reissueTicketTx`: new code and short code, the attendee follows), signed link tokens (`signLinkToken`), the guests module's parties, guests and history, seating's plan documents, seat finder and assignments.
- **Legacy evidence:** none (Eventmie Pro has no table tickets).

### 3. Scope
**In (built):**
- **Tabs.** The gala's **Tables & Sponsors** (`tables-sponsors`, nav item from the profile registry) replaces its placeholder; it leaves `PLACEHOLDER_SECTIONS`, and the gala checklist item `tablesSponsors` is done once the event has a table ticket. The gala's **Tickets** tab is the existing **Tickets & Orders** (M4.2a kept it for galas); it gains table tickets.
- **Table ticket type** (`ticket_types.table_size`, 2–20, never a donation pass; fixed once created): price, inventory and per-order limits count tables. The form has "Seats per table"; the list shows "Table of N"; the public pass card says "Seats N guests…" (`ticketing.public_ticket_type_tables`, SECURITY DEFINER, same filter as the other public pass functions).
- **Guest slots.** Paying for a table issues, in the order's transaction, one `ticketing.table_units` row per table and `size` tickets pointing at it (`tickets.table_unit_id`), each with its attendee: a table of 10 has exactly 10 slots by construction. Slots are the table's live tickets.
- **Claim link** (`/tables/<id>~hmac`, purpose `table-naming`, one per table): the buyer names the table's party (company or sponsor) and its guests, one seat at a time (first name required, last name and email optional), sees every seat, and can email the link to themselves again (once a minute, plus the device rate limit). Naming reissues the seat's ticket to the guest (to their email, or the buyer's when none is given) and adds a guest to the table's party in the guests module, linked to that ticket and its attendee (`guests.ticket_id`, `parties.table_unit_id`), history source `table_link`. The link closes when the event ends or the order is no longer paid. The buyer's order page lists their tables with "Name guests at …".
- **Concurrency:** naming locks the table row (`FOR UPDATE`), so concurrent claims serialize; a slot is named once (unique guest per ticket); a full table answers `table_full`.
- **Emails** (`orders.table-naming`, 13 locales): the claim link after payment (outbox `order.paid@1`), on the buyer's request and as the host's reminder (`table.naming_link_requested@1`); the token is derived in the mailer, never carried by events.
- **Host view** (Tables & Sponsors): purchased tables (table, company or sponsor, buyer, seats, named, names missing); each table's seats with their ticket's short code and guest (a ticket shows its guest); "Name a guest at …" (manual naming, history source `manual`); "Send naming reminders" (tables with names missing, at most once an hour each). Empty states say what to do next (add a table ticket; create the floor plan).
- **Hosted tables** (`seating.table_sponsors`): a table of the event plan carries a sponsor name, an optional logo (one of the event's own images, `/media/{org}/…` of the same org only) and "Show the sponsor to guests". The seating editor writes it on the table (canvas) and in the list beside it; guests see it in the seat finder result ("Hosted by …") and the venue map data only when shown and the plan is on sale (published or locked), through allowlisted DTOs (`PublicTableSponsorDto`).
- **Refunds:** a table is refunded whole (every live seat chosen; `table_partial` otherwise) and paid back once at the table price; its seats are voided, so its unnamed slots disappear; the table returns to inventory when none of its seats is left (`voidTicketsTx`); the cancellation preview counts a table once (`liveTicketsByOrderItemTx`). Named guests stay on the guest list with their void ticket.
- **Check-in** is unchanged: every seat is an ordinary ticket with its own code.
- **Permissions:** `tables:read` (owners, admins, managers, box office, viewers, event managers), `tables:write` (owners, admins, managers, box office, event managers; co-hosts through `tables:*`). Sponsors need `seating:write`. Planners don't open Tables & Sponsors.

**Later / not yet:**
- Seating named guests automatically at a plan table linked to the purchase (the host seats them like any guest today).
- Refunding single seats of a table (pro-rata), and changing a table's size after sales.
- Renaming or removing a named slot (re-claim to another person) from the link or the console; a host-side company rename.
- Sponsor logos uploaded for the sponsor itself (today: one of the event's images); sponsor names drawn on the public venue map (the data is there; the map shows table labels).
- `/v1` resources for tables and sponsors.
- **Not merged:** `origin/merge/next-3f` (its `0095_long_luminals` collides with batch 3e's `0095_alert_signals` in the migration journal, outside M4.2b's files); `origin/agent/design-v2` is not ahead of the base yet.

### 4. `touches:`
```yaml
touches:
  - packages/modules/ticketing/src/{schema,dto,issue,public,tables,index}.ts
  - packages/modules/guests/src/{schema,tables,index}.ts
  - packages/modules/seating/src/{schema,table-sponsors,seat-finder,private-columns,index}.ts
  - packages/modules/orders/src/{tables,domain/tables,commands/refunds,index}.ts, package.json (guests)
  - packages/modules/tenancy/src/domain/permissions.ts (tables:read, tables:write)
  - packages/modules/notifications/src/{kinds.ts,templates/samples.ts,templates/messages/*.json}
  - packages/modules/command-center/src/{readiness.ts,domain/readiness.ts}
  - packages/db/drizzle/0096_skinny_quentin_quire.sql
  - packages/testing/src/fixtures.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/tables-sponsors/**, tables/[token]/**, orders/[token]/page.tsx
  - apps/web/src/components/{gala-tables,ticket-type-form,checkout-form,public-event-view,seating-editor,seating-canvas,seat-finder}.tsx
  - apps/web/messages/*.json, apps/web/src/server/{notifications,readiness}.ts, apps/worker/src/registry.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `ticketing.ticket_types` | add `table_size int` | CHECK 2–20 and not a donation (NOT VALID + VALIDATE) |
| `ticketing.table_units` | new | one purchased table: event, order, order item, ticket type, unit no, size, link sends and reminders; FKs to ticket types and (hand-written) events |
| `ticketing.tickets` | add `table_unit_id uuid` | partial index; hand-written FK to `table_units` (NOT VALID + VALIDATE) |
| `guests.parties` | add `table_unit_id uuid` | one party per table (partial unique); hand-written FK, `ON DELETE SET NULL (table_unit_id)` |
| `guests.guests` | add `ticket_id uuid` | one guest per ticket (partial unique); hand-written FK, `ON DELETE SET NULL (ticket_id)` |
| `guests.parties`, `rsvp_history`, `sub_event_responses` | source CHECK widened with `table_link` | NOT VALID + VALIDATE |
| `seating.table_sponsors` | new | event, table item id, sponsor name, logo path, published; unique per event and table; hand-written event FK |
| `ticketing.table_unit_org(uuid)`, `ticketing.public_ticket_type_tables(text, uuid[], boolean)` | new SECURITY DEFINER functions | allowlisted columns only |

Both new tables are tenant tables (FORCE RLS, NULLIF policy, org-leading indexes) with fixture rows for both orgs; `table_sponsors` text columns are declared `public` (guests see them once shown).

### 6. API diff
- **`/v1`:** none.
- **Commands/queries:** `orders.nameTableSlot` (public, claim link), `orders.setTableCompany` (public), `orders.resendTableLink` (public), `orders.hostNameTableSlot` (`tables:write`), `orders.sendTableReminders` (`tables:write`), `orders.hostedTables` (`tables:read`), `orders.publicTable` (public); `seating.planTables` (`events:read`), `seating.setTableSponsor` / `seating.removeTableSponsor` (`seating:write`). `ticketing.createTicketType` takes `tableSize`; `TicketTypeDto` and `PublicTicketTypeDto` gain `tableSize`; `SeatFinderResultDto` seats gain `sponsor`, `sponsorLogoUrl`; `PublicVenueMapDto` gains `sponsors`.
- **`/api/v2`:** none.

### 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `table.slot_named` | 1 | orders | none yet | no |
| `table.naming_link_requested` | 1 | orders (resend, reminder) | `orders.table-naming-mailer` | no |
| `order.paid` | 1 (unchanged) | orders | + `orders.table-naming-mailer` | — |

### 8. Entitlements and flags
- Module keys: `ticketing` (tables commands), `seating` (sponsors), `seat_finder` (public sponsors); profile `gala` (Tables & Sponsors, strict routes).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.2b-01 | Buying a table of 10 gives exactly 10 guest slots; the table counts once in inventory | `packages/testing/tests/gala-tables.int.test.ts` |
| AC-M4.2b-02 | 15 concurrent claims on a table of 10: exactly 10 guests, the rest `table_full` | `gala-tables.int.test.ts` |
| AC-M4.2b-03 | The claim link names only its table's slots; a forged token resolves to nothing | `gala-tables.int.test.ts`, `apps/web/e2e/gala-tables.spec.ts` |
| AC-M4.2b-04 | Naming reissues the ticket to the guest and makes them a guest of the table's party linked to the ticket and attendee; history records source and field names only | `gala-tables.int.test.ts` |
| AC-M4.2b-05 | A refund is whole-table, once, at the table price; it removes the unnamed slots and returns the table to sale; part of a table is refused | `gala-tables.int.test.ts`, `packages/modules/orders/tests/gala-tables.test.ts` |
| AC-M4.2b-06 | The sponsor shows on the table in the editor and in the seat finder; never while hidden or while the plan is a draft | `gala-tables.int.test.ts`, `gala-tables.spec.ts` |
| AC-M4.2b-07 | Emails: the link after payment, on request (once a minute) and as reminders (once an hour per table) | `gala-tables.int.test.ts` |
| AC-M4.2b-08 | Isolation: another org never sees or names a table; commands run through `tenantCommand` | `gala-tables.int.test.ts`, `isolation.int.test.ts` (fixture rows) |
| AC-M4.2b-09 | E2E: buy a table (fake provider), name guests via the link (validation, success, persistence, keyboard), see them on Guests, in seating and on Tables & Sponsors (host naming, reminders) | `apps/web/e2e/gala-tables.spec.ts` |
| AC-M4.2b-10 | A viewer reads Tables & Sponsors without controls; viewers are refused host naming, reminders and sponsors; a wedding has no such page | `gala-tables.spec.ts`, `gala-tables.int.test.ts` |
| AC-M4.2b-11 | Arabic RTL render, axe on every new screen | `gala-tables.spec.ts` |
| AC-M4.2b-12 | The gala checklist's Tables & Sponsors item is live (done with a table ticket) | `apps/web/tests/readiness.test.ts`, `social-workspace.spec.ts` |

### 11. Security and privacy
- The claim link token is the only authority on the public page (HMAC of the table id; the org comes from a SECURITY DEFINER lookup); nothing from headers; private link, `noindex`, disallowed in robots.
- The public table DTO carries names of the table's own guests (the buyer named them) and never an email; sponsors reach guests only through `PublicTableSponsorDto`.
- A guest's email is sealed with the private answers (P4-3); history and audit hold field names and counts only.

### 15. Demo checklist
- [ ] Gala → Tickets & Orders: add "Table of 10" ($1,000, 10 seats per table).
- [ ] In another browser: buy one table (Pay now (test)); on the order page choose "Name guests at …".
- [ ] Set the company, name two guests (one with an email); reload: both are there.
- [ ] Console → Guests: both names; Tables & Sponsors: 2 named, 8 names missing; name one by hand; Send naming reminders.
- [ ] Seating: create a plan; Tables & Sponsors: Table 1 sponsored by "Acme Corp", shown to guests; the editor shows it; seat a guest at Table 1, put seats on sale, open the seat finder by name: "Hosted by Acme Corp".

### 16. Owner tasks
- [ ] Confirm the M4.2b defaults (docs/owner-inbox.md, Phase 4).
