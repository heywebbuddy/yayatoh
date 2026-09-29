# Spec: M5.4 — Exhibitor portal, booths and sponsors

- **Milestone:** M5.4 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, Wave 1: M5.4a; Wave 2: M5.4b)
- **Status:** M5.4a built (2026-09-29); M5.4b (sponsor packages, deliverables, lead licenses) follows
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
- **Portal sign-in (minimal local version of M5.3a's foundation).** `requirePortalPrincipal()` in `apps/web/src/server/portal.ts` returns `{ orgId, eventId, eventRoleAssignmentId, role, subjectId }` (the contract M5.3a owns). An invitation or sign-in link is `{orgId}.{memberId}.{secret}`; only the secret's HMAC is stored (`exhibitor_members.link_hash`), the page spends nothing until **Continue** (mail scanners), and the link is spent on use. Opening it activates the member, upserts the `events.event_role_assignments` row (`exhibitor_admin` / `exhibitor_staff`, expiring at the event's end + 90 days) and starts a 7-day portal session (httpOnly cookie `{orgId}.{secret}`, `__Host-` on HTTPS; HMAC stored in `program.portal_sessions`). Signed out, a browser that signed in before (a signed `{orgId}.{eventId}` site cookie) or anyone with the organizer's sign-in page link can ask for a new 30-minute link by email: rate limited (`guestCode` policy, scope `exhibitor_portal`), same answer for any address. Revoking a member revokes its sessions, link and event role.
- **Portal (`/exhibitor`).** Admins edit name, website, description (Markdown subset), links (`Label | https://…`) and up to 5 categories; upload a logo (media pipeline, same quota and single logo slot, `POST /api/portal/logo`, works without script); see their booths; invite staff by email; revoke staff. Staff see their exhibitor and booth read-only. A **Tasks** section is a placeholder until M5.3a's task model is wired in (M5.4b).
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
- Portal accounts shared across events (one account, many events): M5.3a's portal account foundation replaces the per-membership `account_id` when it merges.

### 4. `touches:`
```yaml
touches:
  - packages/floorplan/src/{document,booths,index}.ts
  - packages/modules/program/src/{schema,index,private-columns,public}.ts   # append-only (+ one filter in public.ts)
  - packages/modules/program/src/{booths,exhibitor-portal,exhibitor-dto}.ts
  - packages/modules/program/src/domain/{exhibitors,portal-token}.ts
  - packages/modules/events/src/{queries,index}.ts                         # eventRoleAssignmentIdTx (appended)
  - packages/modules/media/src/{portal,media,index}.ts                     # portal logo upload
  - packages/modules/notifications/src/{kinds.ts,templates/**}             # portal.exhibitor-invite, portal.exhibitor-sign-in
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
| `program.exhibitor_members` | new | email (personal), role, status pending/active/revoked, `account_id`, `link_hash` (secret), `expires_at` = event end + 90 d; unique (org, exhibitor, lower(email)) while not revoked |
| `program.portal_sessions` | new | `token_hash` (secret), `expires_at`, `revoked_at` |
| `program.booths` | new | number unique per event (case-insensitive), category, x/y/width/height (cm) |
| `program.booth_assignments` | new | (booth, exhibitor) unique; at most one `is_primary` per booth (partial unique) |

**RLS:** every table via `tenantTable()` (org_id NOT NULL, ENABLE + FORCE RLS, the NULLIF policy, org-leading indexes, composite FKs to exhibitors/booths/members); fixture rows for both orgs in `createOrgFixture`; every text/jsonb/text[] column declared in `program/src/private-columns.ts` (link hash seeded only where not null).

**Migration** `packages/db/drizzle/0076_curly_triathlon.sql` (to be renumbered at merge): new tables only (expand). Hand-written block (`-- hand-written: begin/end`): composite `(org_id, event_id) → events.events` FKs (cascade) for all six event-scoped tables (program is tier 3, events tier 2).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Commands** (all `tenantCommand`, entitlement `exhibitors`): organizer (`events:write`): `saveExhibitorSettings`, `saveExhibitorListing`, `inviteExhibitorMember`, `resendExhibitorInvite`, `revokeExhibitorMember`, `decideProfileChange`, `saveBooth`, `deleteBooth` (delete category), `assignBooth`, `unassignBooth`; queries `exhibitorPortalAdmin`, `boothPlan` (`events:read`). Portal (`public:exhibitor_portal`; the handler re-checks the principal in its transaction: same org, an active unexpired member of that exhibitor, the named event-role assignment live, admin where needed): `openExhibitorLink`, `requestExhibitorLink`, `portalSaveProfile`, `portalInviteStaff`, `portalRevokeStaff`, query `exhibitorPortal`; media `portalUploadExhibitorLogo`, `portalExhibitorLogo`.

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
| AC-M5.4a-03 | Invitation link: signs in once, binds one event role, revocable, expires at event end + 90 d; forged org/secret refused; a new link replaces the old | int (sign-in describe); unit (tokens); e2e (second browser refused, sign out → new link) |
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
- Sign-in link requests are rate limited and answer the same for unknown addresses. Portal emails go out at once through the dev mailbox (production needs SES, owner inbox).
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
