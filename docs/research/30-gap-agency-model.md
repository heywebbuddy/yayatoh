# Event Agency Multi Client Model

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

event-agency-multi-client-model

# Agency / Multi-Client Workspace Model for Yayatoh 2.0

Vision-doc anchors: section 2 (organizations must have isolated users, events, attendees, branding, settings, payment configuration), section 3 (white-label per org, custom domain), section 12 ("An event agency may see: Clients | Events | Marketing | Reports"), section 6 (wedding planners as a target customer). The question is how a "client" fits into a tenant model that already assumes `org_id` on every row and Postgres RLS.

## 1. What comparable products actually do

| Product | Model | Delegation | Billing | Detach |
|---|---|---|---|---|
| **Stripe Connect** (verified, docs.stripe.com, Sept 2026) | Strictly two levels: platform + connected accounts. "Platforms using OAuth with read_write scope can't connect to Standard accounts that are controlled by another platform" (since June 2021); a user of a platform-controlled account is pushed to "create a separate Standard account" for a second platform. Express/Custom/v2 accounts are fully platform-controlled. No nested "platform of platforms". | n/a | Fees: `application_fee` accrues only to the platform; multi-party splits require *separate charges and transfers* ("You can transfer funds to multiple connected accounts"). | Platform "Remove account" = OAuth deauthorize; "permanently resets all platform controls on the account". |
| **SeatFound Agency** (verified, seatfound.com) | $99/mo, unlimited events, "white-label branding", event cloning, draft→activate workflow. Clients are *events inside the agency account*, not separate tenants; there is no client login. | none | Agency pays one subscription | Not supported (events belong to the agency) |
| **Zola** (verified, zola.com/faq) | "we do not offer wedding planner-specific logins"; workaround is sharing a partner login. Only the account holder can move cash funds / banking details. | shared credentials (anti-pattern) | couple pays | n/a |
| **Joy** | UNVERIFIED (help pages did not expose article text); believed to allow co-admins per wedding, no multi-couple planner console. | | | |
| **Mailchimp** (partially verified) | Mailchimp & Co: agencies get "client account access" to *separate client accounts* on paid plans; user levels Owner/Admin/Manager/Author/Viewer; "You can transfer ownership of your account at any time… The previous Owner's user level will automatically revert to Admin." Each client account is a full account with its own billing. | agency staff are users inside the client account | client pays (commissions to agency at 2+ paid connected customers) | ownership transfer + remove agency users |
| **HubSpot Partner** | UNVERIFIED (all knowledge-base URLs 404'd). Widely documented pattern: the client portal grants "partner employee access"; partner staff appear in the client's user list with a partner flag; client admins revoke from their own Users page; partner dashboard lists client portals. Each client portal is a separate account with its own subscription. | delegated users, client-revocable | client pays; partner may resell | client revokes access |
| **Cvent enterprise** | UNVERIFIED (docs behind login). Known pattern: parent "enterprise" account with child accounts/business units, shared templates and address book at parent level, consolidated reporting. |
| **Vercel** (verified) | Personal account + teams; a team switcher "at the top left of the navigation bar"; every project "belongs to a team"; team has a default; ownership transfer = promote a new Owner then remove the old one. |
| **Clerk OrganizationSwitcher** (verified) | Shows personal account, org list, create-org, active org; switching changes the active org context. |

Takeaways: every mature B2B product with real client data (HubSpot, Mailchimp, Stripe) makes the client a **first-class account** and gives the agency **delegated, client-revocable access**. Products that fold clients into the agency account (SeatFound, Zola's shared login) are cheap to build but cannot hand a client its own data, domain, or payouts, and cannot survive the "client fires the agency" event. Stripe's two-level ceiling means Yayatoh must be the sole Connect platform; agencies and clients are both connected accounts of Yayatoh, never platforms of each other.

## 2. Recommended model: client = full child organization, linked by relationship + grants

**Decision:** A client is a real `organization` row (own `org_id`, own members, branding, domain, feature modules, optional Stripe connected account). The agency relationship is metadata, not containment. Runner-up: "client as sub-scope (folder) inside the agency org" — lost because it breaks RLS isolation for a client that later wants independence, forces one Stripe payout account per agency, and cannot give the client's own staff (a corporate client's marketing team, the couple) a login that excludes other clients.

### 2.1 Schema sketch (Postgres)

```sql
-- existing
organizations(id, slug, name, kind /*organizer|agency|venue*/, billing_account_id, stripe_account_id null, ...)
members(id, org_id, user_id, role, ...)                 -- Better Auth 'member'
teams(id, org_id, name), team_members(team_id, user_id) -- Better Auth teams (agency internal squads)

-- relationships between orgs (already in research map; make it concrete)
org_relationships(
  id, parent_org_id, child_org_id, kind /*agency_client|franchise|venue_partner*/,
  status /*pending|active|ended*/, initiated_by /*parent|child*/,
  commission_bps int default 0, billing_mode /*agency_pays|client_pays*/,
  payout_mode /*client_account|agency_account*/,
  started_at, ended_at, ended_reason, unique(parent_org_id, child_org_id, kind))

-- delegated access: who from the agency may act inside the client org
org_access_grants(
  id, relationship_id -> org_relationships, grantor_org_id /*client*/,
  grantee_type /*org|team|user*/, grantee_id,
  role text /*maps to client-org role, e.g. 'agency_admin','agency_marketer','agency_checkin'*/,
  scopes jsonb null /*optional per-module overrides*/,
  granted_by_user_id, expires_at null, revoked_at null, revoked_by_user_id null)

-- billing decoupled from org so many orgs can share one payer
billing_accounts(id, owner_org_id, stripe_customer_id, plan_id, seat_count, ...)

-- cross-client reporting without live cross-tenant queries
agency_report_snapshots(id, agency_org_id, client_org_id, period, metrics jsonb, computed_at)
```

Effective access = `members` ∪ (`org_access_grants` active AND `org_relationships.status='active'` AND grantee resolves to this user via org/team/user). Cache this as `effective_orgs[]` on the session (Better Auth `customSession`, which runs per fetch and is not cookie-cached, so revocation is near-immediate).

### 2.2 Why not plain Better Auth membership for agency staff?

Option A (rejected): insert agency users as `member` rows in each client org with an `agency_*` role. Simple and works with `hasPermission` out of the box, but it (1) pollutes the client's member list and seat count, (2) requires N×M writes and deletes when a planner joins/leaves the agency, (3) has no single switch to sever a whole agency, (4) fights `membershipLimit`/invitation email verification. Option B (recommended): Better Auth organization plugin for direct membership, roles (`createAccessControl` statements per module: `events`, `tickets`, `seating`, `checkin`, `marketing`, `reports`, `billing`, `domain`, `payments`), invitations and teams; plus the `org_access_grants` table resolved by a custom authorization service that wraps `hasPermission`. Use Better Auth **dynamic access control** (`organizationRole` table) so a client can define "Agency – marketing only". Teams (`teams.enabled: true`) are used *inside the agency* ("Weddings team", "Corporate team") and referenced as `grantee_type='team'`, so onboarding a new planner to a team instantly grants all that team's clients.

### 2.3 Authorization rules

1. Every request resolves `active_org_id` from the URL (`/o/{org-slug}/…`), not only from `session.activeOrganizationId`; the server verifies `active_org_id ∈ effective_orgs` before setting `SET LOCAL app.org_id`. Path-scoped context (Vercel style) keeps links shareable and prevents "wrong client" writes after tab switching.
2. Grants can never exceed the client-org role ceiling: an `agency_admin` grant may not include `billing.*`, `payments.connect`, `domain.*`, `org.delete`, `members.owner` unless the client org's *owner* explicitly toggles "Agency may manage billing/payments". Mirror Zola's rule: only the account holder moves money.
3. A grant is created by (a) the client owner accepting an agency access request, or (b) the agency creating a *managed* client org (agency is initial owner; a client "handover contact" is stored so ownership can be transferred later).
4. Audit every action performed under a grant with `acting_via_relationship_id`; show "Acting as Agency X" in the client's audit log. Do not use Better Auth admin `impersonateUser` for agency work (it is for Yayatoh support only, 1-hour sessions, `impersonatedBy` marker).
5. Revocation: setting `revoked_at` or `relationship.status='ended'` invalidates cached `effective_orgs` (bump a per-user version key); `session.activeOrganizationId` pointing at a lost org is reset to the user's default org.
6. RLS: keep the single-tenant policy `org_id = current_setting('app.org_id')::uuid` on all data tables; delegated users are indistinguishable at the SQL layer. Add a `RESTRICTIVE` policy on money tables (`payouts`, `stripe_accounts`, `billing_*`) requiring `current_setting('app.actor_is_direct_member') = 'true'` unless the grant flag allows it. Run the app role with `FORCE ROW LEVEL SECURITY` on owned tables; reserve `BYPASSRLS` for the reporting job role only.

## 3. Cross-client reporting and marketing without breaking isolation

**Reports:** never run `org_id = ANY(...)` queries from the request path. A nightly (and on-demand) job running under the reporting role computes per-client rollups (revenue, tickets sold, registrations, check-in %, RSVP outstanding, unseated guests, failed payments, campaign performance) into `agency_report_snapshots` owned by the *agency* `org_id`. The agency's Reports page reads only its own rows under normal RLS. Row-level drilldown always opens the client workspace. Stripe already models this the same way ("Access consolidated reporting… across all connected accounts that you control" via platform-level reports rather than account-level access).

**Marketing:** contacts (the Event CRM of vision §11) stay in the client tenant; the agency has no merged audience. What *is* shared downward: brand kits, email/SMS/WhatsApp templates, automation recipes, and audience *definitions* (segment rules), published from the agency org into client orgs as copies (`source_template_id` for lineage, "update available" prompt). Cross-client sends are executed as N per-client campaigns fanned out by a job, each under the client's sender identity, consent records and suppression list. Consent and CAN-SPAM/TCPA sender-of-record stay per client. Offer "share contacts with agency" as an explicit client-owner setting (default off) that copies (not links) consented contacts to the agency org with a `source_org_id`; defer to a later phase.

## 4. Billing and money flows

Two independent axes, set per relationship:

- **Subscription billing** (`billing_mode`): `agency_pays` — client org's `billing_account_id` points to the agency's billing account (one Stripe Billing customer, per-client usage lines; SeatFound-style flat "unlimited events" agency tier is attractive here), or `client_pays` — client has its own billing account (HubSpot/Mailchimp model). Switching is a one-column change plus proration.
- **Ticket revenue** (`payout_mode`): Yayatoh is the only Connect platform (Stripe forbids nesting). Each org may hold its own connected account (Accounts v2 merchant config, `dashboard: express`, `losses_collector: application` if Yayatoh wants to control refunds). Per event, `payout_org_id` chooses the destination: the client's account (recommended default; client is merchant of record via `on_behalf_of`, statement descriptor and disputes land with the client) or the agency's account (small planners who collect on the couple's behalf; require a clickwrap acknowledgment because refund/chargeback liability follows the payout account).
- **Agency commission / pass-through:** `commission_bps` on the relationship. Implementation: destination charge to `payout_org` with Yayatoh's `application_fee_amount` = platform fee + commission; a job then creates a Transfer from the platform balance to the agency's connected account for the commission, tagged with `transfer_group = order_id`. Runner-up: separate charges and transfers with two transfers per order; more complex, and Stripe says to use it "only if your business use case requires" it. Refunds reverse the commission transfer proportionally.

## 5. Detach and handover

Because the client is already a full tenant, handover is a state change, not a migration:

1. Client owner (or agency, per contract) triggers "End agency relationship". Precondition: client org has at least one *direct* owner; if the org was agency-managed with no client owner, the flow forces an owner invitation to the stored handover contact first (Mailchimp: old owner "reverts to Admin"; here the agency's grant is simply revoked).
2. `org_relationships.status='ended'`, all grants `revoked_at=now()`, sessions re-resolved.
3. Billing: if `agency_pays`, create a client billing account with a 14-day grace; if unpaid, downgrade to the free tier rather than lock data.
4. Payments: future events default to the client's connected account; if none, ticket sales are blocked until Connect onboarding completes. Historical orders keep their original payout account and commission records (read-only). Nothing in Stripe needs to change; Yayatoh remains the platform for both accounts.
5. Assets: venues, layouts, templates copied from the agency remain (they are copies). Custom domain, branding, contacts, API keys, webhooks are already client-owned. API keys and webhooks *created by agency staff* are flagged for rotation in a post-detach checklist.
6. Agency keeps frozen `agency_report_snapshots` up to `ended_at` for its own books; live access ends.

Reverse flow (client joins an agency): existing org owner sends/accepts an access request; no data moves.

## 6. UI patterns

- **Switcher** (top-left, Vercel/Clerk pattern): sections "My organizations" (direct membership) and "Clients" grouped by agency, searchable (agencies commonly exceed 30 clients), recents pinned, "Create client" at the bottom for agency admins. Selecting a client navigates to `/o/{client-slug}/dashboard`.
- **Context badge:** inside a client workspace show a persistent chip "Client: Smith Wedding · via Bloom Events" with a one-click "Back to Bloom Events". Use the client's branding (white-label) in the workspace so what the agency sees matches what the client sees.
- **Agency home (Clients | Events | Marketing | Reports):** Clients table with status (managed/independent), next event date, tickets sold 7d, open alerts (unseated guests, undelivered tickets, RSVP outstanding, failed payments), "Open" and "Report". Events tab is a cross-client calendar built from snapshots plus lightweight `events` metadata exposed through a dedicated read model. Marketing tab manages brand kits/templates/automations to publish to clients. Reports tab reads snapshots.
- **Client side:** Settings → "Agencies & partners" listing active grants with role, granted date, "Revoke" (HubSpot pattern).
- **Mobile apps / API:** expose `GET /v1/me/organizations` returning `{org, access_kind: 'member'|'delegated', via_org}`; scanner app lists client events for planners on site; `X-Org-Id` header selects the active org, validated against `effective_orgs`.

## 7. Edge cases

- **Client leaves mid-event:** grants end immediately, but scheduled campaigns and automations are org-owned, so they keep running; on-site check-in devices logged in by agency staff lose access — allow the client to issue temporary "day-of staff" grants (`expires_at`) to those users.
- **Agency staff who are also direct client members:** direct membership stands on its own; grant revocation does not touch it.
- **Multiple agencies per client** (planner + ticketing vendor): allowed; distinct relationships and grants, each revocable.
- **Agency deleted or suspended:** all its relationships auto-end; managed clients with no direct owner get an escalation queue for Yayatoh support.
- **Shared venues/layouts:** venue library is org-owned; agency "publishes" a venue/layout to a client → copy with `source_id`; later edits do not propagate silently. Yayatoh-curated public venues (existing `/venues`) are platform-owned and readable by all.
- **Shared contacts:** never linked across tenants; copy with consent flag only (see §3).
- **Domains:** one custom domain per org; agency white-label domain (`events.bloom.co`) is the agency's, client subdomains (`smith.bloom.co`) are provisioned by the agency but stored on the client org so they survive… note they *cannot* survive detach if the parent domain is the agency's; the detach checklist must warn and offer a `yayatoh.com/{slug}` fallback.
- **Seat/plan limits:** enforce plan limits on the billing account (agency plan covers N active clients), not on each org, so `agency_pays` clients do not each need a plan.
- **RLS drift:** integration test that runs every read model with a delegated session and asserts zero rows outside `active_org_id`.

## 8. Phasing

Phase 1 (with core multi-tenancy): `org_relationships`, `org_access_grants`, switcher, context badge, client-revocable grants, `client_pays` only, snapshots for a minimal Clients table. Phase 2: agency billing account, commission transfers, template/brand-kit publishing, full Reports. Phase 3: team-based grants, opt-in contact sharing, day-of temporary grants.



## Key recommendations

- Model every agency client as a full `organization` tenant (own org_id, members, branding, domain, feature modules, optional Stripe connected account); the agency link is metadata in `org_relationships`, never containment — this is the HubSpot/Mailchimp/Stripe pattern and is what makes detach a state change instead of a migration.
- Grant agency staff access through an `org_access_grants` table (grantee = org | team | user, role, optional scopes, expires_at, revoked_at) resolved into a per-session `effective_orgs` list via Better Auth `customSession`; do not insert agency users as Better Auth members of client orgs.
- Keep Better Auth organization plugin for direct membership, roles (createAccessControl statements per module), invitations, dynamic per-org roles, and teams enabled inside the agency org so a team grant onboards a new planner to all that team's clients at once.
- Resolve active org from the URL path (`/o/{slug}/...`) and verify it against `effective_orgs` before `SET LOCAL app.org_id`; keep single-tenant RLS unchanged and add RESTRICTIVE policies on money tables requiring a direct member or an explicit client-owner-approved grant flag.
- Yayatoh is the only Stripe Connect platform (Stripe blocks nested platforms); both agencies and clients are connected accounts. Per event, `payout_org_id` picks client account (default, on_behalf_of) or agency account; agency commission is paid by a platform-to-agency Transfer funded from the application fee, tagged with transfer_group = order id.
- Decouple billing from organizations with `billing_accounts`; support `agency_pays` (client orgs point at the agency's billing account, plan limits enforced at billing-account level) and `client_pays`, switchable per relationship.
- Cross-client Reports read from `agency_report_snapshots` owned by the agency org, computed by a job under a reporting role; never run cross-tenant queries from the request path.
- Cross-client marketing = publishing brand kits, templates, automations and segment definitions downward as copies, and fanning out campaigns as N per-client sends under each client's sender identity and consent records; no merged audience in v1.
- Build the handover flow: require a direct client owner (force an owner invitation to the stored handover contact for agency-managed orgs), end relationship + revoke grants, migrate billing with a grace period, default future payouts to the client's connected account, freeze agency snapshots, and present a post-detach checklist (API keys, webhooks, agency-owned subdomain).
- Switcher UI: top-left org switcher with 'My organizations' and 'Clients' sections, search and recents; persistent 'Client X · via Agency Y' badge inside client workspaces; client-side 'Agencies & partners' settings page with per-grant Revoke.
- Expose delegated access to the mobile apps via `GET /v1/me/organizations` (access_kind member|delegated, via_org) and an `X-Org-Id` header validated against effective_orgs, so planners can run check-in for client events on site.
- Ship in phases: relationships + grants + switcher + client_pays first; agency billing, commissions and template publishing second; team grants, temporary day-of grants and opt-in contact sharing third.


## Data model implications

- organizations.kind enum gains 'agency' (and possibly 'venue'); organizations.billing_account_id FK replaces per-org billing fields.
- org_relationships(id, parent_org_id, child_org_id, kind, status, initiated_by, commission_bps, billing_mode, payout_mode, started_at, ended_at, ended_reason) with unique(parent, child, kind).
- org_access_grants(id, relationship_id, grantor_org_id, grantee_type, grantee_id, role, scopes jsonb, granted_by_user_id, expires_at, revoked_at, revoked_by_user_id).
- billing_accounts(id, owner_org_id, stripe_customer_id, plan_id, seat/client limits) shared by many orgs.
- events.payout_org_id (nullable, defaults to owning org) and orders/payments store payout_stripe_account_id and commission_transfer_id for auditability.
- agency_report_snapshots(agency_org_id, client_org_id, period, metrics jsonb, computed_at) as the only cross-tenant read model.
- audit_log rows carry acting_via_relationship_id and acting_user_id so delegated actions are attributable inside the client org.
- Templates, brand kits, venues and layouts carry source_id/source_org_id for copy-on-publish lineage; contacts carry source_org_id and consent_shared_at when copied under opt-in sharing.
- organizations.handover_contact_email (for agency-managed clients with no direct owner yet).
- Better Auth tables: organization, member, invitation, team, teamMember, organizationRole (dynamic roles), session.activeOrganizationId/activeTeamId; sessions extended with an effective_orgs cache version.


## Risks

- Agency subdomains under an agency-owned white-label domain cannot survive client detach; must warn and provide a yayatoh.com fallback URL and QR re-issue strategy.
- Payouts routed to the agency's connected account shift refund/chargeback liability to the agency; requires clear contractual acknowledgment and per-event disclosure to avoid disputes.
- Better Auth cookie-cache sessions can delay revocation until cache expiry; effective_orgs must be computed in customSession (uncached) or revocation must bump a version key.
- A live cross-tenant query path (org_id = ANY(...)) is an easy shortcut that silently weakens RLS; enforce snapshot-only cross-client reads with integration tests.
- Agency-managed client orgs with no direct owner become orphaned if the agency churns; needs a support escalation queue.
- Consent/sender-of-record rules (CAN-SPAM, TCPA for SMS, WhatsApp Business policies) differ per client; cross-client sends must run under each client's identity or the platform risks compliance exposure.
- HubSpot, Mailchimp client-management, Joy and Cvent hierarchy details could not be verified from primary pages in this session (404s/paywalled); the recommendations rely on Stripe, Better Auth, SeatFound, Zola, Vercel and Postgres sources plus general industry knowledge.
- Commission transfers from the platform balance require sufficient available balance and correct proportional reversal on refunds; a reconciliation job is mandatory.


## Open questions

- Should agencies be able to collect ticket revenue on a client's behalf (agency payout account) in v1, or must every selling client onboard its own Stripe connected account?
- Is the target agency customer mostly wedding/gala planners (few staff, many small clients, flat SeatFound-style pricing) or corporate event agencies (many staff, few large clients, per-client billing)? This drives whether agency_pays or client_pays is the default.
- Does Yayatoh want to pay agencies a commission / referral share (like Mailchimp & Co) or is commission purely an agency-to-client pass-through configured by the agency?
- Should agency-owned white-label domains be allowed to host client subdomains, given they cannot follow the client on detach?
- Do clients need the ability to restrict agency access to specific events rather than whole-org roles (event-level grants)?
- Is opt-in contact sharing from client to agency (Event CRM across clients) a required feature or a compliance risk the owner would rather avoid?
- Are there existing Laravel-era agency or reseller relationships in production data that need to be mapped into org_relationships during migration?
- What is the plan/seat pricing for an agency tier (number of active clients, staff seats) so plan limits can be enforced at the billing-account level?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx (sections 2, 3, 6, 11, 12)
- https://docs.stripe.com/connect/charges (charge types, separate charges and transfers, on_behalf_of, refunds/disputes)
- https://docs.stripe.com/connect/oauth-changes-for-standard-platforms.md (platforms cannot connect to accounts controlled by another platform; separate Standard account required)
- https://docs.stripe.com/connect/platform-controls-for-stripe-dashboard-accounts (consolidated reporting, Remove account resets platform controls)
- https://docs.stripe.com/connect/accounts.md (Standard/Express/Custom comparison; v2 recommended)
- https://docs.stripe.com/connect/accounts-v2/connected-account-configuration.md (fees_collector, losses_collector, dashboard settings)
- https://support.stripe.com/questions/platform-controls-for-connected-accounts (disconnection behaviour)
- https://www.better-auth.com/docs/plugins/organization (organizations, members, roles, teams, dynamic access control, hooks, schema)
- https://www.better-auth.com/docs/plugins/admin (impersonation, impersonatedBy, 1-hour default)
- https://www.better-auth.com/docs/concepts/session-management (customSession, cookie cache caveats)
- https://www.seatfound.com/ (Single Event $49; Agency $99/mo unlimited events, white-label branding, cloning)
- https://www.zola.com/faq/115002422171-can-my-wedding-planner-have-a-login-to-my-zola-account- (no planner logins; only account holder moves funds)
- https://www.zola.com/faq/115001755111-how-do-i-invite-my-partner-to-join-zola- (joint partner account)
- https://mailchimp.com/help/about-mailchimp-and-co/ (agency program tiers, client account access)
- https://mailchimp.com/help/manage-user-levels-in-your-account/ (Owner/Admin/Manager/Author/Viewer; ownership transfer)
- https://vercel.com/docs/accounts (team switcher, default team, ownership transfer)
- https://vercel.com/docs/projects (projects belong to a team)
- https://clerk.com/docs/components/organization/organization-switcher (switcher pattern)
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html (PERMISSIVE vs RESTRICTIVE, BYPASSRLS, FORCE ROW LEVEL SECURITY)
- UNVERIFIED: HubSpot partner employee access / partner dashboard (knowledge.hubspot.com pages returned 404)
- UNVERIFIED: Cvent enterprise account hierarchy (support/developer pages not accessible)
- UNVERIFIED: Joy (withjoy.com) co-admin/planner access articles
