# Spec: M6.4 — API and integrations: integrations framework and connectors

- **Milestone:** M6.4 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-4, P6-13)
- **Status:** M6.4b built (2026-10-03, Eventbrite importer and Google Sheets live sync on the M6.4a framework; see its section). M6.4a built (2026-10-03; local gate: lint, check:modules, typecheck, unit 2706/2706, integration 1519/1520; the one failure, `marketing-analytics.int.test.ts` › campaigns tile, was a date-zone bug that merge/next-3h fixed, and it passes after merging that fix; integrations e2e 18/18 on three viewports, canary crawl and console specs green), behind the `integrations` module key and the `IntegrationAuth` port (fake in dev/CI, off in production until Nango is configured). M6.4b–d stack on it.
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

## M6.4c — Zapier and Slack (done)

- **Status:** built 2026-10-03 on M6.4a (local gate: lint, check:modules, typecheck 63/63, unit 2990/2990, integration 1687 with the two failures it found fixed and their files re-run green; e2e `slack-zapier` + `integrations` 42/42 on three viewports), behind the `integrations` module key (Slack) and `api_access` (Zapier, `/v1`), the `IntegrationAuth` port (fake in dev/CI, Nango in production once configured) and the webhook publisher port (fake in dev/CI, Svix in production). Nothing talks to Slack or Zapier from dev or CI.
- **Risk tags:** `db-migration`, `tenancy`, `infra`

### 1. Goal and users
Organizers get their alerts and a daily digest in a Slack channel the team already watches, and
connect Yayatoh to thousands of apps through Zapier (start Zaps on paid orders, check-ins,
registrations and published events; register people, add contacts and check tickets in from
other tools).

### 2. References
- **P6-4:** Zapier (order 2) and Slack notifications (order 5) on the M6.4a framework; tokens never
  leave the port. **P6-3:** `/v1` additive only, thin webhook payloads (D21). **P6-13:** entitlement
  keys (`integrations`, `api_access`).
- **Plan row M6.4C:** each Zapier trigger and action passes Zapier's test harness against the fake;
  Slack messages carry no PII beyond names.

### 3. Scope
**In (built):**
- **Zapier app** (`apps/zapier`, Zapier Platform CLI format, `zapier-platform-core` 19.1.0; not
  published). Authentication: an org API key and the org's id or slug (the test reads
  `GET /v1/orgs/{org}/api-key`). Triggers are REST hooks on the public webhook catalog: Order Paid
  (`order.paid`), Ticket Checked In (`ticket.admitted`), Registration Form Submitted
  (`form.registration_submitted`), Event Published (`event.published`); each subscribes
  (`POST /v1/orgs/{org}/hooks`), unsubscribes (`DELETE …/hooks/{id}`), lists a sample
  (`GET …/hooks/samples?event=`) and flattens a delivery (id, type, time, then the thin data).
  Actions on `/v1`: Create Registration (`POST …/events/{id}/registrations`), Add Contact
  (`POST …/contacts`), Check In Ticket (`POST …/events/{id}/checkins`); a hidden event picker
  (`GET …/events`). Every write sends an `Idempotency-Key` derived from the Zap and the input, so
  Zapier's retries apply once. Problem+json errors become clear Zapier errors (missing scope,
  revoked key, conflict, rate limit).
- **`/v1` additions** (additive; `packages/api-v1/src/routes/automation.ts`, OpenAPI and SDK
  regenerated): the three hook routes (scope `webhooks:subscribe`), `addContact` (scope
  `contacts:write`; find-or-create by email, no consent recorded), `createRegistration` (scope
  `attendees:write`; the event must be the org's: `attendees.addGuest` trusts its caller's event
  id). Tags `hooks` and `contacts`. The web's `/api/v1` mount answers `DELETE` too.
- **REST hooks** (`packages/modules/webhooks/src/rest-hooks.ts`): an endpoint with
  `source = 'rest_hook'` and the subscribing key, for one event type; the same signed thin
  deliveries; the tool can remove only hooks made this way; listed on the console's Zapier page
  (host only).
- **Scopes and permissions:** API key scopes `contacts:write` and `webhooks:subscribe`; member
  permissions of the same names (`contacts:write`: owners, admins, managers, marketing;
  `webhooks:subscribe`: owners, admins). `ZAPIER_TRIGGERS`/`ZAPIER_ACTIONS`/`ZAPIER_SCOPES` in the
  integrations module are the single list the console and the app's test share.
- **Slack connector** (`packages/modules/integrations/src/connectors/slack.ts`, `src/slack/`): a
  `notifications` connector (the SDK's new `purpose`; no objects, so no mapping; its runs are the
  connection's health check through the connector's new `health` hook, `auth.test`). OAuth through
  the `IntegrationAuth` port (Nango's `slack`; the fake workspace in dev/CI). Channel picker from
  `conversations.list` through the port (only channels the app is in can be picked).
  - **Alerts:** the M3.2b engine now emits `alerts.alert_notified@1` (ids, rule, severity, count,
    the fix page; internal, not a webhook) each time it sends an alert; the
    `integrations.slack-alerts` subscriber queues one message per (connection, channel, alert
    sending) at or above the chosen severity.
  - **Daily digest** at a chosen local time in the org's time zone: the previous day's orders,
    tickets and check-ins per event and today's events; amounts only on the connection owner's
    opt-in while they have finance access.
  - **Sender** (`runSlackDispatch`; worker job `integrations.slack`, exclusive per org, queued by
    the leader from `integrations.orgs_with_slack_work()`; the dev drain runs it too): queue due
    digests (dedupe key = the local day), claim due messages with a lease (skip locked), check the
    connection through the port, render, re-check for personal data (`slackPiiProblems`), post,
    record (retries after 1, 5, 15, 60 minutes; final for channel errors and blocked PII).
  - **Rendering** (`render.ts`): Block Kit plus fallback text in the org's language (13 catalogs
    in `src/slack/messages/`; alerts reuse the alert email's wording from notifications);
    organizer text is mrkdwn-escaped (no mentions or links can be injected); links only to our
    https console.
  - **Revocation:** a connection that is no longer active has its queue cancelled; one the port
    (or Slack) reports revoked is marked revoked through the engine's run (errors inbox,
    `integrations.connection_revoked@1`) and nothing more is sent.
- **Console:** the connection page for Slack shows "Channel and messages" (channel, alerts and
  their threshold, digest and its time with the org's zone, amounts for the owner), a preview of
  the test alert, **Send test alert** (the one primary action once a channel is set) and the recent
  messages with their outcome; Sync now, interval, mapping and runs are hidden for notifications
  connectors. **Settings → Integrations → Zapier** (`/o/{org}/integrations/zapier`): each trigger
  and action with the scope it needs, the org's live keys and whether they cover them, the active
  Zapier triggers; a Zapier card on the integrations page. 13 locales, Arabic RTL.

**Later / Not yet:**
- Publishing the Zapier app (owner's partner review); Zapier-side signature verification of
  deliveries (needs the endpoint secret at subscribe time); polling triggers and searches.
- Several Slack channels per connection (one channel now, routed by severity); per-alert-group
  routing to channels; interactive buttons (acknowledge from Slack).
- `attendees.addGuest` itself does not check that the event belongs to the org (the `/v1` route
  does; the console only passes its own events). A composite FK would close it at the source.

### 4. Acceptance
| Criterion | Test |
|---|---|
| Each Zapier trigger and action passes Zapier's test harness against the fake API | `apps/zapier/tests/zapier.test.ts` (app tester for authentication, the 4 triggers' subscribe/perform/performList/unsubscribe, the event picker, the 3 actions; Zapier's schema validation of the definition; the fake's responses checked against `apps/api/openapi.json`) |
| … and against the real `/v1` | `apps/zapier/tests/zapier-v1.int.test.ts` (a real delivery from the fake publisher through the trigger) |
| `/v1` hooks, contacts, registrations: scopes, idempotency, isolation, SSRF | `packages/api-v1/tests/automation.int.test.ts` |
| A Slack alert and digest render from fixtures | `packages/modules/integrations/tests/slack.test.ts` (alert, test alert, digest with and without amounts, many events, every locale, escaping) |
| The digest sends once per day per channel across retries and DST | `packages/testing/tests/slack.int.test.ts` › "goes out once per day per channel across retries, concurrent passes and DST", "the fall-back day…", "…skipped, not sent late"; unit DST schedule tests |
| Slack messages carry no PII beyond names (amounts only with the owner's finance opt-in) | unit guard tests; int › "carries no personal data…", "shows the day's sales…; amounts only…", "only the connection's owner…" |
| A revoked Slack connection stops sending on the next run | int › "a connection revoked at Slack stops sending…", "…disconnected by the organizer…"; e2e › "revoked at Slack…" |
| Alerts from the M3.2b engine reach Slack once | int › "alerts at or above the threshold reach the channel once…" |
| Permissions and isolation | int › "viewers cannot see it…", "another org can neither see nor send…"; isolation suite (fixture rows for both orgs) |
| Worker job | `apps/worker/tests/integrations.int.test.ts` › "Slack job" |
| E2E: connect Slack (fake), pick a channel, preview and send a test alert; Zapier page shows the API key scope; keyboard only; axe both themes; RTL | `apps/web/e2e/slack-zapier.spec.ts` (8 tests × 3 viewports) |

### 5. Migration
`packages/db/drizzle/0123_workable_miracleman.sql` (renumbered at merge): tables
`integrations.slack_settings` and `integrations.slack_messages` (RLS/FORCE, policies, org-leading
indexes, composite FKs to `connections`; generated); `webhooks.endpoints.source` (default
`console`) and `api_key_id` (generated). Hand edits: the new `api_keys_scopes_check` (adds
`contacts:write`, `webhooks:subscribe`) and `endpoints_source_check` are added `NOT VALID` then
validated; between the hand-written markers, `integrations.orgs_with_slack_work(integer)`
(SECURITY DEFINER, org ids only) granted to `platform_reader`.

## M6.4b — Eventbrite importer and Google Sheets (done)

Switchers bring their Eventbrite events, ticket types, orders and attendees into a Yayatoh org in
one guided import that they can preview first and run again safely (P6-4 step 1). Organizers who
live in spreadsheets keep an event's attendee list in a Google Sheet that stays in step both ways
(P6-4 step 3). Owners and admins run both; managers read.

- Plan row **M6.4B**: an import into a fresh org reproduces the fixture account's counts; sheet
  edits round-trip without duplicates. Brief `docs/agent-briefs/m6.4b.md`.
- P6-4 (Nango behind `IntegrationAuth`, our own sync workers, one mapping UI, the errors inbox, no
  loops), P6-13 (behind the `integrations` key), P6-1 (fakes only: no real accounts or calls).

### 3. What was built
**Framework extensions (additive, `@yayatoh/integrations`):**
- `ConnectorDefinition.mode: 'import'`: connecting queues nothing and schedules nothing (the
  wizard starts each run); `finishRun` and resume leave `next_sync_at` null; the interval command
  refuses (`importer`).
- `loadScope(tx, connectionId)` → `io.scope` (the linked sheets); `pull.write` gets
  `meta { connectionId, record, emit }` (nested data such as an order's attendees, and the page
  command's outbox); `push.changes` gets `{ connectionId, scope }`; `push.send` gets the `local`
  record.
- `pull.snapshot`: a provider read in full every run (a sheet has no change feed). After a read that
  reached the end, a linked record missing from it opens `remote_deleted` (never retried by
  itself; the Yayatoh record is never deleted). It resolves when the row comes back; Dismiss
  accepts the deletion and unties the record from the row.
- `pull.conflicts: 'inbox'`: last-writer conflicts (both sides changed since the last crossing)
  open a `conflict` inbox row (`conflict_kept_yayatoh` / `conflict_kept_remote`, codes only) and
  store the kept and lost values per field in **`integrations.sync_conflicts`** (personal, org
  scoped, deleted with the row on Dismiss, covered by the DSAR contributor). Retry skips decided
  conflicts and deleted rows (`retryable`).
- Links across connections (`linkedLocalIdTx`): a re-import after a reconnect finds what an earlier
  connection of the same connector wrote.

**Eventbrite importer** (`src/connectors/eventbrite/`, `mode: 'import'`, availability general,
fake `eventbriteFakeProvider` serving the recorded fixture account `fixture.ts`):
- Objects `events` (`GET /v3/organizations/{id}/events/?expand=ticket_classes,venue`),
  `ticket_classes` (from the same pages) and `orders` (`GET /v3/organizations/{id}/orders/
  ?expand=attendees&changed_since=`), paged by `continuation`; events and classes are read in full
  every run, orders resume from the newest `changed`.
- Writes go through the owning modules' command code inside the engine's page command:
  `events.createEvent` / `events.updateEvent` handlers (imported as **drafts**, a fresh slug,
  times as UTC instants with the event's IANA zone), `createTicketTypeTx` / `updateTicketTypeTx`
  (price in minor units, hidden classes hidden, quantity never below what is sold), and the new
  **orders import path** `importOrderTx` (`orders/src/imported.ts`).
- **Imported orders** are `created_via = 'import'`, collected by the organizer,
  `provider = 'eventbrite'` + the Eventbrite order id (unique per org: the DB-level idempotency
  key), status paid / partially refunded / refunded / cancelled from Eventbrite; one ticket per
  Eventbrite attendee, each named as on Eventbrite (`nameTicketHolderTx`); refunded or cancelled
  attendees' tickets voided (their places returned). **No `order.paid`**: no tickets email, no
  receipt, no journeys, no payment ledger entry; `order.imported@1` (ids, totals) instead. The order
  page says "Imported from Eventbrite · order N" and offers no refund (organizer collected).
- **Dry-run preview** `eventbritePreview` (reads the account through the port, writes nothing):
  totals and how many are new per object, attendees, refunded orders, revenue per currency.
  **Result** `importResultQuery`: the latest run and what Yayatoh holds from Eventbrite (events,
  ticket types, orders and paid orders, attendees and active ones, revenue to the cent).
- **Wizard** `/o/{org}/integrations/{connection}/import`: Connect (the callback lands here) →
  Preview → Import (queues the run; the worker or dev drain runs it) → Result, with a stepper. The
  connection page of an importer shows "Open import" instead of Sync now and the schedule.

**Google Sheets live sync** (`src/connectors/google-sheets/`, object `attendees`, fake
`googleSheetsFakeProvider`):
- A spreadsheet per linked event (`integrations.sheet_links`, one active per event and connection,
  hand-written FK to `events.events`). Link: `sheetLinkTargetQuery` checks, the transport creates
  the sheet through the port with the push mapping's columns as the header row, `linkSheetCommand`
  records it (category `export`), resets the attendees push cursor and queues a sync. Unlink:
  nothing syncs, the sheet stays at Google, its row links and open errors go.
- Pull (snapshot, conflicts in the inbox): an edited row renames a ticket holder
  (`nameTicketHolderTx`) or a guest (contact + `reassignAttendeeTx`) and sets labels as typed; a new
  row becomes a guest (`attendees.addGuest`; an address already on the list is refused into the
  inbox, never a second attendee). Push: attendees of linked events changed since the cursor
  (`attendeesChangedSinceTx`, keyset at millisecond precision), with Name, Email, Labels, Status.
- **Conflict rule:** last writer by row timestamp. When both the row and the attendee changed since
  the last sync, the later change wins (the row's last-edit time against the attendee's update
  time); the losing values are shown in the errors inbox beside the conflict.
- UI: the connection page's **Linked events** section (link form with inline validation, table
  with "Open in Google Sheets", Unlink with confirmation); the inbox shows a conflict's kept and lost
  values and a deleted row's explanation, without Retry.

**Dev and tests:** `/api/dev/integrations/fake` gains `eb-refund`, `sheet-edit`, `sheet-add`,
`sheet-delete` and a GET of the fake sheet; the fake consent page handles connectors without
scopes. Fixture org rows for `sheet_links` and `sync_conflicts` (a linked sheet and a conflict).

### 4. Later / not yet
- The **production Sheets adapter** maps the connector's row calls onto Sheets API v4 (values
  ranges, developer metadata for stable row ids, a hidden origin column, an installable onEdit
  trigger for "Last updated"); only the fake exists now (pending owner: Google Cloud project).
- Eventbrite: import of event status (all import as drafts), multi-date (series) events, seating,
  discounts and custom questions; mapping of attendee sub-fields; a per-event choice of what to
  import; a capacity smaller than sold + refunded (the order goes to the inbox).
- Sheets: a user-chosen existing spreadsheet; column order from the sheet; an attendee whose row was
  deleted is not re-added until it changes (then a 404 lands in the inbox).
- Imported revenue does not feed the analytics warehouse (it listens to `order.paid`).

### 5. Acceptance
| An import into a fresh org reproduces the fixture account's counts (events, ticket types, orders, attendees, revenue to the cent) | `packages/testing/tests/integrations-eventbrite-sheets.int.test.ts` › "an import into a fresh org reproduces the fixture account…"; e2e `apps/web/e2e/integrations-import-sheets.spec.ts` › "import wizard…" (result table) |
| Dry-run preview with counts before writing | int › "the dry-run preview counts the account and writes nothing"; e2e › "import wizard…" (preview table, nothing imported yet) |
| Re-runnable with external-id idempotency (also after a reconnect) | int › "a re-run writes nothing…", "disconnect, reconnect and import again…", "a refund and a rename at Eventbrite…"; e2e re-run and refund steps |
| Money in minor units; times as timestamptz with the event's IANA zone | int › "an import…" (prices, totals, `starts_at`, `timezone`); unit `modules/integrations/tests/eventbrite-sheets.test.ts` |
| Imported orders are marked imported and never trigger payment or receipt emails | int › "imported orders are marked imported and never pay or email" (no `order.paid`, no ledger entries, no messages); e2e › order page "Imported from Eventbrite", no Refund |
| Sheet edits round-trip without duplicates; our edits push, sheet edits pull | int › "round trips without duplicates…", "a row typed in for someone already on the list…"; e2e › "Google Sheets: link, round trip…" |
| Deleting a row never deletes an attendee (flagged in the inbox) | int › "deleting a row never deletes the attendee…"; e2e (inbox group, no Retry, Dismiss, attendee still listed) |
| Conflict rule documented, losing value in the inbox | int › "conflicts: the later writer wins…"; e2e (inbox shows kept and lost) |
| Link/unlink; permissions; isolation | int › "links an event…", "unlink stops the sync…", "viewers cannot link…", "only owners and admins preview…"; isolation suite (fixture rows) |
| Provider outage | int › "a provider outage fails the run into the inbox…" |
| E2E keyboard only, axe both themes, RTL, viewer refused | e2e › "keyboard only…", "renders right-to-left in Arabic", "a viewer cannot open the import wizard"; `expectAccessibleBothModes` on the wizard, Sheets section and inbox |

### 6. Migration
`packages/db/drizzle/0140_uneven_lilandra.sql` (renumbered at merge): `integrations.sheet_links`
and `integrations.sync_conflicts` (RLS/FORCE, policies, org-leading indexes, composite FKs;
generated). Hand-written: the widened `sync_errors_step_check` (adds `conflict`) added `NOT VALID`
then validated; `sheet_links_event_fk` → `events.events (org_id, id)`.
