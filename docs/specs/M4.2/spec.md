# Spec: M4.2 — Social profiles and workspace

- **Milestone:** M4.2 (roadmap §10 Phase 4, "M4.2 Social profiles and workspace (M)"; Phase 4 plan `docs/plans/phase-4.md`, Wave A)
- **Status:** M4.2a built (2026-09-29); M4.2b (gala tables & sponsors, tickets tab) is Wave B
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
