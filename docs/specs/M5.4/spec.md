# Spec: M5.4 — Exhibitor portal, booths and sponsors

- **Milestone:** M5.4 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, Wave 1: M5.4a; Wave 2: M5.4b)
- **Status:** M5.4a built (2026-09-29); M5.4b built (2026-10-03: sponsor packages, deliverables, sponsor portal, lead licenses)
- **Risk tags:** `db-migration`, `auth`, `tenancy` (owner approval)
- **Related:** decisions P5-1 (behind flags), P5-4 (licenses, later), P5-7 (portal sign-in), P5-8 (lead sharing, later), P5-11; ADRs 0002, 0003, 0010 (event roles), 0012 (floor plan documents), 0014; M1.4f/h (program, logos), M1.5f (guest links), M1.14 (rate limits)

## M5.4a — exhibitor portal and booths (done)

### 1. Goal and users
Organizers of a conference invite each exhibitor's admin to a portal. Exhibitor admins keep their
own profile and logo current, see their booth, and invite their booth staff, but only up to the
staff badge allowance the organizer grants. Organizers place booths on the exhibit hall's floor
plan and assign exhibitors to them; visitors find exhibitors on a public map. Portal people are
never org members and never reach the console.

### 2. References
- **Plan:** Phase 5 Wave 1, "M5.4a Exhibitor portal" (acceptance: *an exhibitor admin cannot see another exhibitor; staff invites stop at the allowance*).
- **Decisions:** P5-7 (portal accounts by email link, one event role at one event, invitations signed, revocable, expiring with the event + 90 days).
- **Legacy evidence:** none (Eventmie Pro has no exhibitor portal).

### 3. Scope (built)
**In:**
- **Portal sign-in (M5.3a's, since the batch 3f merge).** Exhibitor admins and staff are `events.portal_accounts` (subject kind `exhibitor`, roles `exhibitor_admin` / `exhibitor_staff`), one event role at one event expiring at the event's end + 90 days, invited with `createPortalAccountTx` and emailed by the portal invite mailer (`portal.invite`). They sign in through the one portal sign-in flow every portal role uses (`/event-portal/invite/{token}`: a 6-digit code or a magic link bound to the browser; 7-day host-bound `yy_portal` session). `requirePortalPrincipal()` returns M5.3a's principal (`{ orgId, eventId, eventRoleAssignmentId, role, subjectId, subjectKind, … }`). The organizer's shareable sign-in page (`/event-portal/sign-in/{orgId~eventId~mac}`) emails a live invitation again to the address typed: rate limited (`guestCode`, scope `portal`), same answer for any address. Revoking revokes the account (links, codes, sessions and the event role). M5.4a's own link/session tables (`program.exhibitor_members`, `program.portal_sessions`), its `/exhibitor/*` sign-in routes and its two email kinds were removed at merge.
- **Portal (`/event-portal` for an exhibitor principal).** Admins edit name, website, description (Markdown subset), links (`Label | https://…`) and up to 5 categories; upload a logo (media pipeline, same quota and single logo slot, `POST /api/portal/logo`, works without script); see their booths; invite staff by email; revoke staff. Staff see their exhibitor and booth read-only. A **Tasks** section is a placeholder until exhibitor tasks on M5.3a's generic task model (`subject_kind = 'exhibitor'`) get their organizer UI (M5.4b).
- **Approval (per event, optional).** With "Approve profile changes" on, an admin's edit becomes the exhibitor's one pending change (a newer edit replaces it); the organizer sees a field diff and approves (applied) or rejects (with an optional reason). The public side only ever shows approved values.
- **Staff allowance.** Event default (5 unless set) per exhibitor, overridable per exhibitor (M5.4b packages will set it). Pending and active staff hold a place; revoked ones free it; admins don't count. The command locks the exhibitor row before counting, so concurrent invites stop exactly at the allowance.
- **Organizer pages.** *Exhibitors → Portal and staff*: settings, the shareable sign-in page link, per exhibitor its listing (public or hidden), categories, links, own allowance, people (invite admin or staff, resend link, revoke) and the pending change diff. *Exhibitors → Booths and floor plan*: booths (number unique per event, category, width × depth, position in metres), the hall drawn from them, assignment by form (keyboard) and a drag shortcut on the map, make primary, remove; conflicts listed as warnings.
- **Booths in `@yayatoh/floorplan`.** `FloorObject` gains optional `booth: { number, category }` (size = width × height); `boothPlan`, `boothsOf`, `boothProblems` (duplicate numbers, booth info on non-booths, overlaps), `boothSize`. Program stores booths as rows and renders them as booth objects.
- **Public exhibitor map (`/events/{slug}/exhibitors`).** The hall (SVG, a picture) plus the same information as lists (exhibitors with logo, booths, categories, description; a booth table), through `publicExhibitorMapSerializer` and cached only via `public-cache.ts` (org-scoped key and tag; booth, listing, approval, portal edits and logo uploads revalidate it). Linked from the event page's Exhibitors section once booths exist. Unlisted exhibitors are left out of the map **and** the public program.
- **Events.** `program.exhibitor.staff_invited` v1 `{ eventId, exhibitorId, memberId, by }` and `program.booth.assigned` v1 `{ eventId, boothId, exhibitorId, primary }` (for M5.9a rules and metrics; no consumers yet).
- **Gate.** Everything runs under the `exhibitors` module key (entitlement on every command and query); the pages exist only for profiles whose nav lists Exhibitors (conference).

**Out (Later / not yet):**
- Lead licenses, leads, the `lead_retrieval` entitlement (M5.4b, M5.6b); sponsor packages and deliverables (M5.4b); booth chat (M5.8b).
- Exhibitor tasks (M5.3a's model; wired in M5.4b).
- Importing booth objects from an existing seating floor plan, rotated booths, an underlay image under the hall (booths are placed by position fields; the map is generated).
- The exhibitor map on tenant sites (`{org host}/events/{slug}/exhibitors`): the marketplace URL only for now (proxy rewrite later).
- Portal accounts shared across events (one account, many events): later, on M5.3a's portal accounts.

### 4. `touches:`
```yaml
touches:
  - packages/floorplan/src/{document,booths,index}.ts
  - packages/modules/program/src/{schema,index,private-columns,public}.ts   # append-only (+ one filter in public.ts)
  - packages/modules/program/src/{booths,exhibitor-portal,exhibitor-dto}.ts
  - packages/modules/program/src/domain/exhibitors.ts
  - packages/modules/events/src/{queries,index}.ts                         # eventRoleAssignmentIdTx (appended)
  - packages/modules/media/src/{portal,media,index}.ts                     # portal logo upload
  - packages/modules/events/src/{portal.ts,domain/portal-auth.ts}           # shareable sign-in page (merge)
  - packages/db/drizzle/0076_*.sql
  - packages/testing/src/fixtures.ts
  - apps/web/src/app/[locale]/exhibitor/**
  - apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/{page.tsx,portal/**,booths/**}
  - apps/web/src/app/[locale]/events/[slug]/exhibitors/page.tsx
  - apps/web/src/app/api/portal/logo/route.ts
  - apps/web/src/server/{portal,booths,exhibitor-map}.ts
  - apps/web/src/components/{booth-map,booth-drag-assign,public-exhibitor-map,program-sections,public-event-view}.tsx
  - apps/web/messages/*.json
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `program.exhibitor_settings` | new | per event: `default_staff_allowance` (0–500, default 5), `approval_required` |
| `program.exhibitor_profiles` | new | per exhibitor: `links` jsonb, `categories` text[] (≤ 5), `listed`, `staff_allowance` (null = event default) |
| `program.exhibitor_profile_changes` | new | `proposed` jsonb (internal), `status` pending/approved/rejected, one pending per exhibitor (partial unique) |
| `events.portal_accounts` | M5.3a | exhibitor admins and staff are portal accounts (subject kind `exhibitor`); `program.exhibitor_profile_changes.account_id` names the proposer |
| `program.booths` | new | number unique per event (case-insensitive), category, x/y/width/height (cm) |
| `program.booth_assignments` | new | (booth, exhibitor) unique; at most one `is_primary` per booth (partial unique) |

**RLS:** every table via `tenantTable()` (org_id NOT NULL, ENABLE + FORCE RLS, the NULLIF policy, org-leading indexes, composite FKs to exhibitors/booths/members); fixture rows for both orgs in `createOrgFixture`; every text/jsonb/text[] column declared in `program/src/private-columns.ts` (link hash seeded only where not null).

**Migration** `packages/db/drizzle/0076_curly_triathlon.sql` (to be renumbered at merge): new tables only (expand). Hand-written block (`-- hand-written: begin/end`): composite `(org_id, event_id) → events.events` FKs (cascade) for all six event-scoped tables (program is tier 3, events tier 2).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Commands** (all `tenantCommand`, entitlement `exhibitors`): organizer (`events:write`): `saveExhibitorSettings`, `saveExhibitorListing`, `inviteExhibitorMember`, `resendExhibitorInvite` (a new invitation version), `revokeExhibitorMember`, `decideProfileChange`, `saveBooth`, `deleteBooth` (delete category), `assignBooth`, `unassignBooth`; queries `exhibitorPortalAdmin`, `boothPlan` (`events:read`). Portal (`portal:exhibitor` for both roles, `portal:exhibitor_admin` for writes; the handler re-checks the account in its transaction with `exhibitorPrincipalTx`): `portalSaveProfile`, `portalInviteStaff`, `portalRevokeStaff`, query `exhibitorPortal`; media `portalUploadExhibitorLogo`, `portalExhibitorLogo`.

### 7. Events
| Event | Version | Producer | Consumers | Public webhook? |
|---|---|---|---|---|
| `program.exhibitor.staff_invited` | 1 | program (organizer or portal invite of staff) | none yet (M5.9a) | no |
| `program.booth.assigned` | 1 | program (`assignBooth`) | none yet (M5.9a, metrics) | no |

### 8. Entitlements and flags
- **Module key:** `exhibitors` (P5-1). **Profiles:** conference (nav). **Release flag:** none beyond the module key.

### 9. ELT impact
None (no legacy exhibitor data).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M5.4a-01 | An exhibitor admin cannot see another exhibitor, even with guessed ids, swapped subjects, another org or another member's assignment id | `packages/testing/tests/exhibitor-portal.int.test.ts` ("guessed ids…"); e2e staff/portal views |
| AC-M5.4a-02 | Staff invites stop at the allowance: pending count, revoke frees, the override wins; 12 concurrent invites for 4 places → exactly 4 | int ("pending invites count…", "under 12 concurrent invites…"); unit `program/tests/exhibitors.test.ts`; e2e "staff up to the allowance" |
| AC-M5.4a-03 | Invitation (M5.3a portal account): signs in by code or magic link, binds one event role, revocable, expires at event end + 90 d; a resend issues a new version; the event's sign-in page re-sends only live invitations; speaker and exhibitor principals can't reach each other's portals | int (sign-in describe); e2e (sign in by code, sign out → sign-in page → invitation again) |
| AC-M5.4a-04 | Admin edits profile (validation, persistence) and logo (media; staff and other exhibitors refused) | int ("the exhibitor logo from the portal", "profile edits…"); e2e test 1 |
| AC-M5.4a-05 | Approval on: pending change, organizer diff, approve applies / reject keeps; public shows approved only | int ("with approval it waits…"); e2e "approval on…" |
| AC-M5.4a-06 | Booths: unique numbers, size, category; first exhibitor primary, co-exhibitors, make primary, remove promotes; conflicts warned (overlap, shared, several booths, category) | unit `exhibitors.test.ts`, `floorplan/tests/booths.test.ts`; int ("booths on the floor plan"); e2e booths test |
| AC-M5.4a-07 | Assign by keyboard only; drag shortcut does the same | e2e booths test (Tab/Enter; dragTo) |
| AC-M5.4a-08 | Public map payload is allowlisted (no staff, emails, allowances, org ids, unlisted exhibitors); cached org-scoped | int ("the public map carries only allowlisted fields"); e2e public map; canary crawl |
| AC-M5.4a-09 | Viewer `jordan@lakeside.test` sees portal and booths read-only and every organizer action is refused by the server | int (viewer refused); e2e viewer test |
| AC-M5.4a-10 | Versioned outbox events emitted once per change | int (staff_invited ×4, booth.assigned ×3) |
| AC-M5.4a-11 | Isolation: every new table has rows for both orgs; canary leak test covers the new private columns | `isolation.int.test.ts`, `canary.int.test.ts`, `column-privacy.test.ts` |
| AC-M5.4a-12 | axe on every new screen and state, Arabic RTL, 375/768/1280 | `apps/web/e2e/exhibitor-portal.spec.ts` |

### 11. Security and privacy
- Tenant from the signed link or session cookie (never headers); a forged org finds nothing under RLS. Secrets stored only as HMACs; links spent on use; sessions revoked with the member.
- Portal commands authorize in the handler (the `invitation:accept` pattern) and always act on the principal's own exhibitor, never an id from the request.
- Every portal and public payload goes through an allowlist (`portalExhibitorViewSerializer`, `publicExhibitorMapSerializer`); unlisted exhibitors never reach public pages.
- Invitation re-send requests are rate limited and answer the same for unknown addresses. Invitations go through the outbox and the notifications dispatcher (dev mailbox in dev/CI; production needs SES, owner inbox).
- Every write is audited (`program.exhibitor_member.*`, `program.exhibitor_profile.*`, `program.booth.*`, `media.upload` with `by: exhibitor_portal`).

### 12. Performance budget
Booth plans are capped at 500 booths per event, members at 200 per exhibitor; the public map is one cached read per org and event.

### 13. Rollout
Behind the `exhibitors` module key (conference profile). No data backfill: existing exhibitors are listed (no profile row = listed, event default allowance).

### 15. Demo checklist
- [ ] Create a conference, add an exhibitor, open Exhibitors → Portal and staff, set 2 staff places, invite an admin.
- [ ] Open `/dev/mailbox`, follow the link in another browser, Continue, edit the profile, upload a logo, invite 2 staff and see the third refused.
- [ ] Exhibitors → Booths: add B12 and B13, assign by keyboard, drag another exhibitor onto a booth, see the warnings.
- [ ] Open the public event page → Exhibitor map; switch to `/ar/…`.

### 16. Owner tasks
See `docs/owner-inbox.md` ("Exhibitor portal defaults, pending owner").

### 17. Gate (2026-09-29)
`pnpm verify` green (lint, check:modules, typecheck, 1508 unit, 970 integration). E2E on 375/768/1280: `exhibitor-portal.spec.ts` (4 tests × 3), plus `program`, `program-media`, `events`, `media`, `door-staff`, `email-kind-labels`, `security`, `seating` and `canary-crawl` specs, all passing.


## M5.4b — sponsor packages, deliverables and lead licenses (built 2026-10-03)

### 1. Goal and users
Organizers sell sponsorship as **packages**: bundles of event-level allowances (comp registrations,
exhibitor badges, lead licenses, logo placements, session slots). A sponsor gets exactly what its
package includes, whether the organizer grants it or the sponsor's contact buys it in the
**sponsor portal**. Both sides keep a **deliverables checklist** with due dates and an owner, and
the organizer sees what is overdue. Exhibitor admins give their people **lead licenses** (P5-4)
and buy extra ones.

### 2. Scope (built)
- **Packages = sponsor tiers** (`program.sponsor_packages`, one per tier): description, price
  (null = granted only), quantity (null = no limit), on sale, the allowances, logo placements
  (website, agenda, badges, signage, stage, emails) and deliverable templates
  (`title | sponsor|organizer | days before the event`). Organizer page *Sponsors → Packages and
  sponsors* (`/o/{org}/e/{event}/sponsors/packages`).
- **Grants** (`program.sponsor_grants`): one active and one pending per sponsor (partial uniques).
  The grant **snapshots** the allowances. Activating (paid or organizer-granted) moves the sponsor
  to the tier, adds the template deliverables (due dates counted back from the event's first day in
  its zone) and emits `program.sponsor_package.activated@1`. Cancelling ends the allowances,
  releases the session slots and emits `…cancelled@1`; deleting a sponsor cancels its package and
  revokes its contacts. Quantity counts active grants and purchases whose 15-minute hold is live.
- **Purchase (fake provider in dev/CI).** `orders.startSponsorPackageCheckout`
  (`portal:sponsor_contact`) and `orders.startLeadLicenseCheckout` (`portal:exhibitor_admin`):
  program reserves (`reserveSponsorPackageTx` / `reserveLeadLicensesTx`, row locks), orders opens an
  **add-on order** (`orders.addon_items`, one line, no tickets, today's fee absorbed, the org's funds
  flow), then the provider's hosted page. `orders.applyProviderEvent` pays it through
  `payAddonOrderTx`: program activates first (`activatePurchasedGrantTx` /
  `activateLicensePurchaseTx`) in the same transaction, then paid + ledger sale +
  `order.addon_paid@1` (never `order.paid@1`). A late payment that can no longer activate (sold
  out meanwhile) emits `order.payment_orphaned@1` and leaves the order unpaid.
- **Comp registrations.** Registration's subscriber `registration.sponsor-comp-codes` makes one
  ticketing promo code per active grant (`COMP-XXXXXXXX`, 100 %, `maxRedemptions` = the allowance,
  limited to the event's admission passes) and records it on the grant; cancelling deactivates it.
  Guests type it in the registration code box (add-ons stay paid). `registration.sponsorCompUsage`
  shows "Used: x of N" in the portal.
- **Exhibitor link and allowances.** `program.sponsor_profiles.exhibitor_id` (one sponsor per
  exhibitor, `ON DELETE SET NULL (exhibitor_id)`): that exhibitor's staff allowance becomes base +
  the active packages' exhibitor badges (M5.4a's invite limit and both views use it), and its lead
  licenses included + packages + bought.
- **Session slots** (`program.sponsored_sessions`): the organizer assigns sessions up to the
  package's slots; the portal lists them in the event zone.
- **Sponsor contacts** are M5.3a portal accounts (subject `sponsor`, role `sponsor_contact`):
  invite, resend, revoke from the packages page; one sign-in flow. The **sponsor portal**
  (`/event-portal` for a sponsor principal): the package and allowances, comp code and use, linked
  exhibitor, sponsored sessions, packages for sale (buy → payment page → back with a thank-you),
  the deliverables checklist (tick off the sponsor's own).
- **Deliverables** (`program.sponsor_deliverables`): title, owner (sponsor/organizer), person
  responsible, due date = end of that day in the event's zone (`due_at` = next local midnight), done
  by whom and when. Page *Sponsors → Deliverables*: overdue first (most overdue first), all, add,
  tick off/reopen, delete. Per sponsor counts on the packages page.
- **Lead licenses** (`program.lead_licenses`, `program.lead_license_purchases`, two columns on
  `program.exhibitor_settings`): a license is one named seat held by a live portal account of the
  exhibitor; revoked people's seats free themselves; assignment counts under the exhibitor's row lock
  (concurrent assignments stop exactly at the allowance). Using licenses activates the
  `lead_retrieval` event add-on (billing catalog, free in beta, quota 2,000). Organizer page
  *Exhibitors → Lead licenses*; exhibitor portal section *Lead licenses* (admin gives/takes back,
  buys; staff see their own seat).

**Out (Later / not yet):** refunds of add-on orders from the console; package upgrades (one package
at a time); deliverable reminders and an overdue event (M5.9a alert rules); file uploads on
deliverables; showing sponsored sessions and logo placements on public pages; exhibitor tasks on
M5.3a's generic task model (organizer UI still pending, as in M5.4a); lead capture itself (M5.6b).

### 3. `touches:`
```yaml
touches:
  - packages/modules/program/src/{schema,schema-sponsors,index,private-columns,people,exhibitor-portal}.ts
  - packages/modules/program/src/{sponsor-packages,sponsor-deliverables,sponsor-portal,sponsor-allowances,sponsor-dto,lead-licenses}.ts
  - packages/modules/program/src/domain/sponsorship.ts
  - packages/modules/orders/src/{schema-addons,addon-orders,index,private-columns}.ts, commands/checkout.ts (3-line hook)
  - packages/modules/registration/src/{comp-codes,index}.ts
  - packages/modules/billing/src/addons.ts (lead_retrieval key)
  - packages/db/drizzle/0103_motionless_drax.sql
  - packages/testing/src/fixtures.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/sponsors/{page.tsx,packages/**,deliverables/**}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/exhibitors/{page.tsx,licenses/**}
  - apps/web/src/app/[locale]/event-portal/{page.tsx,exhibitor-portal.tsx,exhibitor-actions.ts,sponsor-portal.tsx,sponsor-actions.ts,lead-licenses-section.tsx}
  - apps/web/src/components/program-form.tsx (additive: `date` kind, `min`)
  - apps/web/src/server/notifications.ts, apps/worker/src/registry.ts (subscriber)
  - apps/web/messages/*.json
```

### 4. Data model
| Table | Change | Notes |
|---|---|---|
| `program.sponsor_packages` | new | per tier; price, quantity, on sale (needs a price), allowances (CHECKed ranges), placements (closed list), templates jsonb array |
| `program.sponsor_grants` | new | status pending/active/cancelled, source purchase/organizer, order id, hold, snapshot of allowances, comp code |
| `program.sponsor_profiles` | new | sponsor → exhibitor (unique per exhibitor, SET NULL on exhibitor delete) |
| `program.sponsor_deliverables` | new | owner, person, `due_at`, status with `(status = 'done') = (completed_at is not null)` |
| `program.sponsored_sessions` | new | session unique; cascade with sponsor and session |
| `program.lead_license_purchases` | new | quantity 1–100, unit price, status, order id, hold |
| `program.lead_licenses` | new | one seat per portal account (unique), FK to `events.portal_accounts` |
| `program.exhibitor_settings` | +2 columns | `included_lead_licenses` (default 1, 0–50), `lead_license_price_minor` |
| `orders.addon_items` | new | one per order, kind sponsor_package/lead_licenses, ref, quantity, unit face, fee |
| `billing.addons` | +1 row | `lead_retrieval` (free in beta) |

All new tables via `tenantTable()` (FORCE RLS, NULLIF policy, org-leading indexes, composite FKs),
fixture rows for both orgs, every text/jsonb/text[] column in `private-columns.ts` (the comp code is
`holder`). **Migration** `0103_motionless_drax.sql` (renumber at merge), expand only. Hand-written:
the two new CHECKs on `exhibitor_settings` added `NOT VALID` then validated; composite
`(org_id, event_id) → events.events` FKs (cascade) for the seven new program tables;
`sponsor_profiles_exhibitor_fk` with `ON DELETE SET NULL ("exhibitor_id")`;
`lead_licenses_account_fk → events.portal_accounts` (cascade); the `lead_retrieval` catalog row.

### 5. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Program** (`sponsors` key; organizer `events:write`, reads `events:read`): `saveSponsorPackage`,
  `grantSponsorPackage`, `cancelSponsorGrant`, `setSponsorExhibitor`, `inviteSponsorContact`,
  `resendSponsorInvite`, `revokeSponsorContact`, `assignSponsoredSession`,
  `unassignSponsoredSession`, `addSponsorDeliverable`, `setSponsorDeliverableDone`,
  `deleteSponsorDeliverable`; queries `sponsorshipAdmin`, `sponsorDeliverables`. Portal
  (`portal:sponsor_contact`): `sponsorPortal`, `portalSetDeliverableDone`. Licenses (`exhibitors`
  key): `saveLeadLicenseSettings`, `leadLicensesAdmin`; portal `portalLeadLicenses`
  (`portal:exhibitor`), `portalAssignLeadLicense`, `portalReleaseLeadLicense`
  (`portal:exhibitor_admin`).
- **Orders:** `startSponsorPackageCheckout`, `startLeadLicenseCheckout` (Idempotency-Key from the
  page). **Registration:** `sponsorCompUsage`.

### 6. Events
| Event | Version | Producer | Consumers |
|---|---|---|---|
| `program.sponsor_package.activated` | 1 | program (grant or paid purchase) | `registration.sponsor-comp-codes` |
| `program.sponsor_package.cancelled` | 1 | program (cancel, sponsor deleted) | `registration.sponsor-comp-codes` |
| `order.addon_paid` | 1 | orders (`payAddonOrderTx`) | none yet (metrics later) |

### 7. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M5.4b-01 | Buying "Gold" grants exactly its allowances: comp code 100 % × 10, badges base + 4, licenses 1 + 3, placements, 1 session slot (a 2nd refused); later package edits don't change it; duplicate webhook is a no-op; ledger sale and one `order.addon_paid@1` | `packages/testing/tests/sponsorship.int.test.ts` ("buying Gold…"); e2e "a sponsor contact buys Gold…" |
| AC-M5.4b-02 | Overdue deliverables list correctly: open and past the end of the due day in the event zone, most overdue first; done excluded; boundary at local midnight; reopen returns it | int ("overdue deliverables list correctly"); unit `program/tests/sponsorship.test.ts`; e2e deliverables test |
| AC-M5.4b-03 | Quantity: a held purchase takes the place until its hold lapses; organizer grants respect it | int ("a package sells at most its quantity") |
| AC-M5.4b-04 | Comp code makes a registration's pass free (add-ons paid), exactly N uses; closed on cancel | int ("comp registration codes", cancel path) |
| AC-M5.4b-05 | A sponsor contact sees only their sponsor; another sponsor's or the organizer's deliverables look unknown; exhibitor principals, members, org B and revoked contacts are refused | int ("a sponsor contact sees only…", "ticks off only…") |
| AC-M5.4b-06 | Lead licenses: 1 included, seats up to the allowance (concurrent: exactly 3 of 6), extra bought through the payment page, revoked seats free, staff see only their own and can't assign; `lead_retrieval` add-on activated | int (lead licenses describe); e2e "an exhibitor admin gives out lead licenses…" |
| AC-M5.4b-07 | Staff invites stop at base + package badges | int ("staff invites stop at the base allowance plus…") |
| AC-M5.4b-08 | Viewer reads and is refused every organizer command; no controls in the UI | int (viewer test); e2e viewer test |
| AC-M5.4b-09 | Validation messages, keyboard-only paths, axe light/dark, Arabic RTL on every new screen, 375/768/1280 | `apps/web/e2e/sponsorship.spec.ts` |
| AC-M5.4b-10 | Isolation and canary cover the new tables and columns | `isolation.int.test.ts`, `canary.int.test.ts`, `column-privacy.test.ts` |

### 8. Security and privacy
- The tenant comes from the portal session or the console route; portal commands re-check the
  principal in their transaction (`sponsorPrincipalTx`, `exhibitorPrincipalTx`) and act only on the
  principal's own sponsor or exhibitor.
- Money only through orders/payments on the fake provider in dev/CI; paid is set only from a
  verified, deduplicated provider event; Idempotency-Key on the purchase.
- The sponsor portal payload is an allowlist (`sponsorPortalSerializer`); comp codes never reach
  public pages.

### 9. Gate (2026-10-03)
See the final commit message (report) for `pnpm verify` and e2e results.
