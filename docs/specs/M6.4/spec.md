# Spec: M6.4 — API and integrations: integrations framework and connectors

- **Milestone:** M6.4 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-4, P6-13)
- **Status:** M6.4a built (2026-10-03; local gate: lint, check:modules, typecheck, unit 2706/2706, integration 1519/1520; the one failure, `marketing-analytics.int.test.ts` › campaigns tile, was a date-zone bug that merge/next-3h fixed, and it passes after merging that fix; integrations e2e 18/18 on three viewports, canary crawl and console specs green), behind the `integrations` module key and the `IntegrationAuth` port (fake in dev/CI, off in production until Nango is configured). M6.4b–d stack on it.
- **Risk tags:** `db-migration`, `tenancy`, `infra`
- **Related ADRs:** 0008 (outbox), 0018/0022 (tokens, design v2)

## M6.4a — integrations framework (done)

### 1. Goal and users
Organizers (owners and admins; managers read) connect third-party tools once and keep records in
step both ways without exports, see what synced and when, fix what failed, and stop it at any time.
Builders of M6.4b–d plug connectors into one framework instead of each writing OAuth, cursors,
retries and an inbox.

### 2. References
- **Decision P6-4:** Nango (Cloud) behind an `IntegrationAuth` port; our own sync workers on
  pg-boss; one field-mapping UI for every connector; an "integration errors" inbox; tokens never
  logged; a sync never loops (origin stamps plus last-writer rules).
- **P6-13:** the `integrations` entitlement key (free within quotas in beta). **P6-1:** behind flags;
  anything that talks to a third party is built against fakes.
- **Plan row M6.4A** acceptance: a sync replayed twice writes once; a revoked connection stops
  within one run; tokens never appear in logs.

### 3. Scope
**In (built):**
- **Module `@yayatoh/integrations`** (tier 6, schema `integrations`, `MODULE.md`): `connections`,
  `field_mappings`, `sync_cursors`, `sync_runs`, `record_links`, `sync_errors` (all tenant tables,
  FORCE RLS, org-leading indexes, composite FKs to `connections`).
- **`IntegrationAuth` port** (`src/auth/port.ts`): `beginConnect` (consent URL), `resolve` (the
  provider-side connection for our connection id: ids and labels only), `check`, `refresh`,
  `revoke`, `client(ref).request(...)`. Failures are `ProviderError` (status + code): error bodies
  are never read. `redactSecrets` guards the rare free text.
  - **Nango adapter** (`src/auth/nango.ts`): connect sessions (`connect_link`), connection lookup by
    end user (our connection id), live check (never reads the credentials in the body), delete,
    and provider calls through Nango's proxy (`Connection-Id`, `Provider-Config-Key`,
    `Nango-Proxy-Idempotency-Key`). Injected `fetch`; unit-tested without network. UNVERIFIED
    against a real account (owner inbox).
  - **Fake** (`src/auth/fake.ts`): consent screen on our origin (`/dev/integrations/authorize`, a
    plain form post to `/api/dev/integrations/authorize` like a provider's), provider accounts in
    memory (shared per process), token expiry and refresh, provider-side revoke, forced failures,
    and each connector's own fake API. Its tokens are the canaries
    `__CANARY_integrations.oauth.access_token__` / `…refresh_token__`, and its refusals echo them in
    the error body.
  - `integrationAuthFromEnv`: `INTEGRATIONS_AUTH_PROVIDER=fake|nango`, `NANGO_SECRET_KEY`,
    `NANGO_HOST`; fake by default outside production; null (integrations off) in production
    without Nango; the fake refuses `VERCEL_ENV=production`.
- **Connector SDK** (`defineConnector`, `src/sdk/connector.ts`): key, name, Nango provider config
  key, scopes, entitlement (P6-13: every connector needs `integrations`, and may add its own key),
  availability (`general` | `fake_only`), objects with remote and Yayatoh fields, a pull side
  (`list` pages from a cursor, `get` one, `write` one inside the engine's transaction) and/or a push
  side (`changes` since a cursor, `read` one, `send` one with an idempotency key), default mappings,
  and the connector's fake API. Defaults are validated at definition time. `CONNECTORS` lists them.
- **Demo connector** (fake-only): contacts at a fake provider ↔ CRM contacts, both ways (new crm
  exports `contactsChangedSinceTx`, `contactSyncRowTx`, `writeSyncedContactTx` in `crm/src/sync.ts`).
  Its seed has three good contacts and one with an invalid address (`dc_4`), which lands in the
  errors inbox until fixed at the source.
- **Connections:** connect (pending connection + single-use state, only its sha256 stored, 15
  minutes) → consent → OAuth callback (`/o/{org}/integrations/callback`, the signed-in member's org,
  state checked twice) → the port resolves the provider connection → active, default mappings v1,
  first sync queued; a refused consent ends it `failed`; "Check connection" completes a pending
  connect without a callback (Nango's hosted page). One live connection per connector and org.
  Pause/resume, sync interval (15 min, hourly, 6 h, daily), Sync now, Disconnect (revoked here at
  once, then at the provider through the port).
- **Field mapping:** one editor for every connector — one row per target field with its source,
  a transform from an allowlist (`TRANSFORMS`: keep, trim, lower/upper/title case, first/last word,
  number, yes/no, date) and a default; per connection, object and direction; every save is a new
  version (history query); validated (unknown source/target, duplicate target, missing required
  target), inline errors per row; records the old mapping rejected are retried at once.
- **Sync engine** (`src/engine.ts`, run by the worker job `integrations.sync`, exclusive per
  connection, queued by the leader every 5 s from `integrations.connections_with_sync_work()`, and
  by the dev drain `/api/dev/integrations/run`): claim (a partial unique index allows one queued or
  running run per connection; a 10-minute lease frees a dead runner's connection), auth check
  through the port, per object pull (due retries first, then pages from the stored cursor) and push
  (due retries, then Yayatoh records changed since the push cursor), finish (run status and counts,
  the next sync by interval or backoff after failures, `integrations.sync_completed@1`). Each page is
  one command (system actor `integrations.sync`, permission `platform:integrations.sync`, audited);
  each record commits with its link in a savepoint, so a bad record never rolls back the others.
- **Exactly once and loop guards:** `record_links` is unique per (connection, object, provider id) —
  the external record's idempotency key — and per (connection, object, our id). It keeps the remote
  version and our hash at the last crossing. `decidePull` skips a version we applied or wrote, a
  record the provider stamped with our origin (`yayatoh:<connection id>`), and an older remote change
  when ours is newer (last writer wins); `decidePush` skips a record whose hash we last wrote or
  sent, so our pulls never echo back. Pushes carry `Idempotency-Key` = hash(connection, object,
  record, content).
- **Revocation:** a 401/403 anywhere in a run (or `check` = revoked) marks the connection
  `revoked` (`provider`) in that run, opens an `auth` error and emits
  `integrations.connection_revoked@1`; disconnecting cancels queued runs and a running run stops at
  its next page.
- **Errors inbox** (`/o/{org}/integrations/errors`): open / resolved / dismissed; groups by
  connection, step (connection, reading, mapping, saving, sending) and code (with the field for
  mapping errors), each record with attempts and the next automatic retry (1, 5, 15, 60, 240
  minutes, then "waiting for you"); Retry and Dismiss per record or per group; a later success
  resolves it. Rows carry codes and field names only. A whole run's failure (provider outage) is a
  connection-level row and backs the schedule off.
- **Console:** Integrations in the org nav (module `integrations`, `integrations:read`):
  connections page (each offered connector: state, account, last sync, open errors, Connect /
  Reconnect / Manage, "Not in your plan" when the connector's key is missing), connection page
  (status, schedule, Sync now as the one primary action, pause, disconnect with confirmation, the
  mapping editors, recent runs), errors inbox. Design v2 components only; 13 locales, Arabic RTL.
- **Permissions:** `integrations:read` (owners, admins, managers), `integrations:manage` (owners,
  admins). Connecting is an `export` command: refused while staff act as a member.
- **Entitlement:** module key `integrations` on every plan (migration), free in beta (P6-13).

**Later / Not yet:**
- Real connectors (M6.4b Eventbrite + Google Sheets, M6.4c Zapier + Slack, M6.4d Mailchimp,
  HubSpot, Klaviyo) and their fakes.
- Nango webhooks (connection created / refresh failed) as a faster path than `check` per run; the
  Nango adapter is untested against a real account.
- Field mapping for nested/array fields and per-record transforms beyond the allowlist; a mapping
  "re-apply to everything" (today: new versions apply to records that change, and to failed ones).
- Per-plan quotas on integrations (number of connections, records per day) once prices are set.
- Pruning old runs and resolved errors (retention).

### 4. Acceptance
| Criterion | Test |
|---|---|
| A sync replayed twice writes once | `packages/testing/tests/integrations.int.test.ts` › "a sync replayed twice writes once" (cursors reset, two replays: 0 written, links/contacts/provider unchanged) |
| A revoked connection stops within one run and is shown as revoked | int › "revoked at the provider…", "revoked in the middle of a run…", "disconnected by the organizer…"; e2e `apps/web/e2e/integrations.spec.ts` › "revoked at the provider…" |
| Tokens never appear in logs, errors, the inbox, audit rows or serializers (canary planted in the fake) | int › "tokens never leave the port (canary)"; `modules/integrations/tests/auth.test.ts` (fake and Nango drop error bodies); canary registry `PLANTED_SECRETS` (class `secret`) |
| Isolation: connection, mapping, error invisible to another org | int › "a connection, mapping or error of one org is invisible to another"; isolation suite (fixture rows for both orgs in all six tables) |
| Loop guards / idempotency keys / concurrency of one / retries with backoff | int › "loop guards…", "concurrency of one…", "nothing to do…", "a provider outage…"; `modules/integrations/tests/domain.test.ts` |
| Field mapping validated, versioned, allowlisted transforms | int › "saves validated versions…"; unit domain tests; e2e mapping steps |
| Permissions and entitlement | int › "viewers see nothing…", "without the integrations module…"; e2e › "a viewer cannot see or open integrations"; impersonation registry |
| pg-boss job, exclusive per connection | `apps/worker/tests/integrations.int.test.ts` |
| E2E: connect (fake OAuth), map, sync, see an error and retry it, disconnect; keyboard only; axe both themes; RTL | `apps/web/e2e/integrations.spec.ts` (6 tests × 3 viewports) |

### 5. Migration
`packages/db/drizzle/0113_purple_gressill.sql` (after merge/next-3h; renumbered at merge): schema `integrations`, six
tables with RLS/FORCE and policies (generated). Hand-written (between the markers): every plan gets
the `integrations` module key; `integrations.connections_with_sync_work(integer)` (SECURITY DEFINER,
ids only) granted to `platform_reader`.

## M6.4d — Mailchimp, HubSpot and Klaviyo (done)

### 1. Goal and users
Organizers who already run their email marketing in Mailchimp, Klaviyo or HubSpot keep using it,
with Yayatoh as the source of consent: an audience (or everyone with consent) is pushed as a list,
and unsubscribes, bounces and complaints come back as suppressions here. HubSpot users get their
contacts both ways and their events as HubSpot marketing events with registration and attendance.
Decision P6-4 (order: Mailchimp and HubSpot, then Klaviyo), P6-13 (behind the `integrations` key;
fakes in dev and CI).

### 2. What was built
- **Connectors** on M6.4a's SDK (`packages/modules/integrations/src/connectors/{mailchimp,klaviyo,hubspot}`),
  each with a fake whose responses follow the vendor's documented shapes
  (`tests/fixtures/{mailchimp,klaviyo,hubspot}.json`, the parsers are tested against both).
  - **Mailchimp / Klaviyo** (`defineListConnector`, one object `members`, both ways): the push
    sends the audience's members with merge fields (mapping: email, first/last name, company,
    phone); the pull reads the list's changes (Mailchimp `since_last_changed`, Klaviyo
    `greater-than(updated,…)`) and applies only consent changes: `unsubscribed`, `cleaned`
    (hard bounce), `complained` (Klaviyo spam complaint).
  - **HubSpot**: `contacts` both ways (search by `lastmodifieddate`, batch upsert by email, the
    `yayatoh_origin` property as the loop-guard stamp; opt-outs through the communication
    preferences API, `hs_email_optout` is never written), `marketing_events` (every event that is
    not a draft, keyed by our event id as `externalEventId`; cancellations sent once the event is
    there) and `event_attendance` (`register`, `attend`, `cancel` per contact and pushed event).
- **Consent rules first** (`audience/consent.ts`, pure): `subscriptionStatus` (express email
  marketing consent and no marketing unsubscribe, no address suppression, no erasure since the
  consent → `subscribed`; any no → `unsubscribed`; nothing either way → `none`), `memberStatus`
  (lists) and `hubspotContactAction`. A contact that is not `subscribed` and not already at the
  provider is **never sent**; one already there gets the unsubscribe (lists) or the opt-out
  (HubSpot); a list member who leaves the audience is archived, not unsubscribed. The status comes
  from the sources of truth (crm ledger, notifications suppressions, platform erased addresses),
  never from the field mapping, and `send` refuses to create a non-subscriber (defence in depth).
  Attendance goes out only for contacts with consent.
- **Inbound** (`audience/inbound.ts`): an unsubscribe withdraws email marketing consent in the crm
  ledger (evidence `integration:<connector>:<connection>`) and puts the address on the marketing
  unsubscribe list with the provider as `source` (`mailchimp`, `klaviyo`, `hubspot`); a cleaned
  address is an address suppression `hard_bounce`, a complaint both. An unknown person becomes a
  contact without consent. Each change is recorded once in `integrations.consent_changes` (unique
  per connection, provider record and version). Consent is never granted from a provider.
- **Both ways in one run:** the engine pulls before it pushes, so a run applies the provider's
  unsubscribes, then sends Yayatoh's. Pulled records are linked before the engine reads them back,
  so a change that came in is never sent back.
- **Settings** (`integrations.audience_syncs`): the audience (a saved segment, or everyone with
  consent) and the provider list, chosen from the provider's own lists (`providerLists`, through
  the port). A new list starts the members over; a deleted segment pauses new subscribers and is
  flagged. Command `integrations.saveAudienceSync` (`integrations:manage`, category `export`).
- **Console** (connection page): Audience (picker for owners/admins, read-only summary for
  managers, empty state), the consent rule, "What syncs with HubSpot", and "Consent changes from
  {provider}" (who, what happened there, what changed here, when). Mapping editors name the
  object when a connector has several. Dev route actions `unsubscribe`, `clean`, `complain`.
- **SDK additions** (the same text as M6.4b's, so the merge is clean): `loadScope` / `io.scope`,
  `changes(…, meta)`, `send({ …, local })`, `write(…, meta)`.
- **crm / events / notifications** (new files, appended exports): `contactsConsentTx`,
  `withdrawEmailMarketingTx`, `setSyncedContactCompanyTx`, `participationsAfterTx`;
  `eventsForSyncAfterTx`; `suppressFromIntegrationTx`, `suppressAddressFromIntegrationTx`
  (suppression sources widened). Contact merges move `consent_changes` (`integrationsContactOwner`).

**Later / Not yet:**
- Propagating a DSAR erasure to the providers (the `ErasureConnectorHook` from M6.1c): today an
  erased contact is unsubscribed (lists) or opted out (HubSpot), not deleted there.
- Re-subscribing someone who unsubscribed at the provider: Mailchimp refuses it through the API
  (the record lands in the errors inbox); they re-subscribe through the provider's own form.
- SMS (Klaviyo SMS consent), Mailchimp tags and groups, HubSpot custom properties and lists,
  HubSpot marketing event participation webhooks; batch endpoints for large audiences.
- The walk over the audience is per run (2 000 records a run, unchanged ones skipped by hash);
  very large audiences would want the providers' batch APIs.

### 3. Acceptance
| Criterion | Test |
|---|---|
| An unsubscribed contact is never pushed (property test over random consent states) | `modules/integrations/tests/marketing.test.ts` › "property: … never pushed as a subscriber" (5 000 random states over the rules); `packages/testing/tests/integrations-marketing.int.test.ts` › "property: over random consent states, an unsubscribed contact is never pushed" (4 rounds of random grants, withdrawals, legacy, unsubscribes, bounces against the Mailchimp fake) |
| Consent changes propagate both ways; an external unsubscribe becomes a suppression with its source | int › "consent changes propagate both ways within one run" (Mailchimp), Klaviyo and HubSpot tests (complaint, opt-out); e2e "an unsubscribe comes back" |
| Replays write once | int › "…replays write nothing" (Mailchimp), HubSpot "replays write once" (no provider writes, no ledger rows) |
| Isolation | int › "only integration managers choose the audience; other orgs see nothing"; isolation suite (fixture rows for both orgs in `audience_syncs` and `consent_changes`) |
| All three against recorded fakes in CI | `marketing.test.ts` › "recorded response samples" (fixtures), every int test runs on the fakes |
| E2E: connect each (fake), map fields, sync a segment, see an unsubscribe come back; keyboard only, axe both themes, RTL | `apps/web/e2e/integrations-marketing.spec.ts` (5 tests × 3 viewports) |

### 4. Migration
`packages/db/drizzle/0140_lush_pandemic.sql` (renumbered at merge): `integrations.audience_syncs`
and `integrations.consent_changes` (RLS/FORCE, policies, org-leading indexes, composite FKs to
connections). Hand-written: the widened `notifications.suppressions_source_check` added NOT VALID
then validated; `consent_changes_contact_fk` → `crm.contacts (org_id, id)` on delete cascade.

**Re-verified 2026-10-03** after merging `m0.5-foundation-ey5gqp` and `merge/next-3u`: the earlier
`audit.int` failure was the tamper test's two full `twoOrgs()` fixtures running past the test's
time (the fixture grows with every module, M6.4d's Mailchimp connection included); `merge/next-3u`
already switched them to `bareOrg()`, so nothing in M6.4d needed changing.
