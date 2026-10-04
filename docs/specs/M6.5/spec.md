# Spec: M6.5 — Enterprise integrations

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-4, P6-13)
- **Status:** M6.5b built (2026-10-03; gate: lint, check:modules, typecheck 63/63, unit 3453/3453, integration 1939/1939 in 203 files, e2e salesforce + integrations 33/33 on three viewports), on the M6.4a integrations framework, behind the `integrations` module key and the `IntegrationAuth` port (fake in dev and CI; Nango's `salesforce` integration in production once the owner registers the Connected App).
- **Risk tags:** `tenancy` (cross-module reads), none for money (amounts are read, never charged)
- **Related ADRs:** 0008 (outbox), 0018/0022 (tokens, design v2)

## M6.5b — Salesforce (done)

### 1. Goal and users
Organizers whose sales team lives in Salesforce (owners and admins connect and map; managers read)
get their event people, campaigns and sponsor deals there without exports: people both ways, a
campaign per event with who registered and who came, and every program sponsor as an opportunity.
People who did not agree to marketing never leave Yayatoh.

### 2. References
- **Plan row M6.5B:** contacts/leads, campaign members per event, sponsor opportunities. Acceptance:
  round-trip sync of the fixture org without duplicates; field mapping respected.
- **P6-4:** Nango behind the `IntegrationAuth` port, our own sync engine, one mapping UI, the errors
  inbox, tokens never logged, no loops. **P6-13:** the `integrations` key. **P6-1:** fakes only.
- Builds on M6.4a (`docs/specs/M6.4/spec.md`): connections, mappings, the engine, the inbox.

### 3. Scope
**In (built):**
- **Connector `salesforce`** (`packages/modules/integrations/src/connectors/salesforce/`), listed in
  `CONNECTORS`, `availability: 'general'`, entitlement `integrations`, scopes `api refresh_token`,
  REST API v62.0. Five objects, run in this order:
  - **contacts ↔ Contact** and **leads ↔ Lead** (pull and push). The pull reads changes with a SOQL
    keyset on `SystemModstamp, Id` (200 a page) and writes CRM contacts by email (`writeCrmPersonTx`:
    name from the mapped name, else first + last name; company when Salesforce has one). Pushes
    split the people so nobody is created twice: a person this connection links to a Salesforce
    **Contact** is updated there (`contacts`); everyone else goes out as a **Lead** (`leads`).
    Salesforce needs a last name (and a company for a Lead): the default push mapping fills them
    with Salesforce's own `[not provided]` when Yayatoh has none.
  - **campaigns → Campaign**, one per event that is not a draft: name, start and end date (in the
    event's time zone), status (Planned / In Progress / Completed / Aborted), `Type = Event`. The
    campaign's member statuses **Registered** and **Attended** are created when missing.
  - **campaign_members → CampaignMember** for each person on an event's list (Registered) or
    checked in (Attended), from `crm.event_participation`, pointing at the person's Contact or Lead
    and the event's campaign (this connection's record links). Checking in later updates the status;
    a member's campaign and person are never changed in place (Salesforce refuses that).
  - **sponsor_opportunities → Opportunity** per program sponsor of a non-draft event: name
    "{event}: {sponsor} ({tier})", stage from its deal (active → Closed Won, pending →
    Negotiation/Review, cancelled → Closed Lost, none → Prospecting), close date (activation,
    cancellation or the event's start, in the event's time zone), amount converted from integer
    minor units to Salesforce's decimal major units at the boundary, the tier as description, and
    the event's campaign. `CurrencyIsoCode` is mappable for multi-currency orgs (not by default).
- **Idempotency (external id):** Yayatoh's records are upserted by `Yayatoh_Id__c` (our id), so a
  retried or repeated send updates the same record; records Salesforce already had are updated by
  their Salesforce id. Every request also carries the engine's `Idempotency-Key`.
- **Loop guard:** Salesforce stamps `LastModifiedById` on every write. The connector asks
  `/services/oauth2/userinfo` once per run for the connection's integration user; a record last
  written by that user carries our origin stamp, so the pull skips it (`own_write`); a person's
  later edit makes it theirs again. With the M6.4a link hashes, nothing echoes either way.
- **Consent** (`connectors/salesforce/local.ts`): a person is pushed only while their latest email
  marketing consent is `granted` and their address is not unsubscribed (`notifications.suppressions`,
  category `marketing`) or suppressed; their campaign memberships follow the same rule. A person who
  grants consent later moves past the push cursor (the keyset runs on the later of the contact's
  and the consent's change) and goes out on the next run. A Salesforce **email opt-out**
  (`HasOptedOutOfEmail`) withdraws email marketing consent here (evidence
  `salesforce:email_opt_out`); Salesforce never grants consent.
- **Revocation:** unchanged M6.4a engine: a refusal (401/403) at any request marks the connection
  revoked within that run, opens an `auth` inbox row and emits `integrations.connection_revoked@1`.
- **Errors inbox:** codes and field names only, as M6.4a. A Salesforce refusal arrives as
  `http_<status>` (the port never reads Salesforce's error body).
- **Fake Salesforce org** (`connectors/salesforce/fake.ts`): userinfo, the connector's SOQL shapes
  (anything else is `MALFORMED_QUERY`), sObject get, update (204), upsert by external id (201/200),
  create; Salesforce's validation (required fields, bad emails, unknown fields, a person twice in a
  campaign, member statuses the campaign lacks, a member's references changing, bad references);
  `SystemModstamp` and `LastModifiedById` on every write. Seed: two contacts, two leads (one opted
  out of email) and a contact without an email (`SALESFORCE_BAD_RECORD`, the inbox example). The
  dev route `/api/dev/integrations/fake` (`action=fix`) gives it an email.
- **Framework additions** (taken verbatim from M6.4b so the branches merge cleanly): the SDK's push
  `changes(…, meta)` gets the connection id and the run's scope, `send` gets the local record, pull
  `write` gets `WriteMeta` (connection, the provider record, `emit`), `loadScope`. One engine change
  of M6.5b's own: a push page whose records were all filtered out (consent, links) still moves the
  cursor on. **`linkedCountsQuery`** (`src/linked.ts`): record links per object (counts only).
- **Read helpers in other modules** (new files, appended exports): `crm/src/crm-connector-sync.ts`
  (`consentedContactsChangedTx`, `contactsWithConsentTx`, `writeCrmPersonTx`,
  `withdrawEmailMarketingTx`, `crmParticipationRowsTx`), `events/src/crm-event-rows.ts`
  (`crmEventRowsTx`), `program/src/crm-sponsor-rows.ts` (`crmSponsorRowsTx`).
- **Console:** Salesforce appears on `/o/{org}/integrations` (no sandbox badge). Its connection page
  has one mapping form per object and direction, titled by object ("Leads: Out to the provider",
  the M6.4d change), and a new **Linked records** table (records in step per object; an empty state
  until the first sync). Copy in all 13 locales.

**Later / not yet:**
- Withdrawing consent in Yayatoh does not set `HasOptedOutOfEmail` in Salesforce (that would send
  data about a person who withdrew); pending owner.
- Accounts are not created for sponsors (opportunities have no `AccountId`); custom Salesforce fields
  beyond the listed ones are not mappable; a converted Lead's existing campaign membership stays on
  the Lead.
- Campaigns, members and opportunities are re-checked on every run (a pass over the set in id order,
  skipping what is unchanged by hash); very large orgs continue over several runs (20 pages of 100
  changed records a run).
- The Nango `salesforce` integration and the `Yayatoh_Id__c` fields are UNVERIFIED against a real org
  (owner inbox).

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-4, P6-6, P6-13)
- **Status:** M6.5d built (2026-10-03), on the M6.4a integrations framework, behind the `integrations` module key and the `IntegrationAuth` port (fake QuickBooks and Xero in dev and CI; Nango's `quickbooks` and `xero` integrations in production once the owner registers the apps).
- **Risk tags:** `payments` (reads the payments ledger and gifts; posts money summaries to the org's books), `db-migration`, `tenancy`

## M6.5d — accounting: daily summary journals to QuickBooks Online and Xero (done)

Organizers (owners and admins; managers read) keep their books without exports: every day, once it
has ended in the org's time zone, Yayatoh posts **one summary journal per day and currency** with
the day's ticket sales, donations, refunds, Yayatoh fees and payouts to the accounts they chose in
their own chart of accounts. A day that changes later (a late refund, an adjustment) is **reversed
and posted again**, never edited, so the books always say what the ledger says.

- **Decision P6-6:** daily summary journal entries (sales, fees, refunds, payouts, donations per
  account) rather than one entry per order; QuickBooks Online and Xero through Nango; a mapping UI
  to the org's chart of accounts.
- **P6-4:** the M6.4a framework (port, engine, errors inbox). **P6-13:** the `integrations` key.
- **Plan row M6.5D** acceptance: a day's journal equals the ledger memo entries to the cent.

- **Where the numbers come from** (read through the owning modules' exports, never their schemas):
  - `@yayatoh/payments` `ledgerDailyTotalsTx` (new, `src/daily-totals.ts`): per day (org time zone,
    by `occurred_at`) and currency, from the immutable journals — **sales** = `grossMinor` of `sale`
    and `organizer_collected_sale` memos; **fees** = their `feeMinor` less refund memos'
    `feeRefundedMinor`; **refunds** = refund memos' `amountMinor`; **payouts** = the
    `org:payable_releasable` debit of `transfer` journals.
  - `@yayatoh/donations` `donationDailyTotalsTx` (new, `src/daily-totals.ts`): paid gifts by
    `paid_at` (gift plus covered fee: what the donor was charged) and gift refunds by `refunded_at`
    (added to refunds). Gifts are direct charges with application fee 0 (P4-9/P4-10), so the ledger
    has no journal for them.
- **The journal** (pure rules, `integrations/src/accounting/domain.ts`): credits sales and
  donations, debits refunds, fees and payouts (the bank account), and the **clearing account**
  (money Yayatoh or the processor holds for the organizer) takes the balance, so every journal sums
  to zero. Zero lines are left out; a negative fee line flips to a credit. Integer minor units;
  sent to providers as exact decimals built from the integers (`minorToDecimal`), never floats.
- **Chart-of-accounts mapping** (`account_maps`, versioned): one provider account per category
  (sales, donations, refunds, fees, payouts, clearing) with the code and name it had, and the first
  day to post (`starts_on`, today or up to 366 days back). Every category is required; the clearing
  account may not be shared (its line is the balance); income categories may share an account. The
  console reads the chart live from the provider through the port (`chartOfAccounts`), and the
  save resolves every chosen id against it. A new version applies to new postings and to unsent
  journals; it never re-posts a day that stands.
- **Journals** (`accounting_journals`): one row per sent entry — `journal` (revision n) or
  `reversal` (of revision n, the same lines with opposite signs, the same day) — with the lines
  exactly as sent, the totals they came from and the provider's id. **Idempotency key:**
  `yayatoh:{org}:{day}:{currency}:r{revision}[:reversal]` (unique), sent as QuickBooks' `requestid`
  and Xero's `Idempotency-Key`.
- **Re-posting on correction** (`planDay`): each run recomputes every day from the mapping's first
  day to yesterday. What stands in the books is the newest posted journal no posted reversal
  undoes. Same totals → nothing new (a re-run writes nothing). Different totals → a reversal of the
  standing journal, then the next revision (or only the reversal when the day went back to zero).
  Rows that never reached the provider are replaced (`superseded`, no provider effect); a row whose
  outcome is uncertain (429, 5xx, network) **blocks its day** until its retry (same key) settles.
- **Sending** (`accounting/run.ts`, a step of the M6.4a run after the connector's objects): one
  command prepares the days, then each journal goes through the connector oldest first, a day at a
  time (a reversal always before its replacement; nothing after a failed row), results recorded in
  batches (`recordJournalResults`). Failures land in the errors inbox (`journals` object, step
  `push`, codes only) and retry on its schedule or its Retry button; an uncertain failure stops
  sending for the run; a refusal (401/403) stops the run and the connection is marked revoked
  within it (M6.4a).
- **Connectors** (`src/connectors/quickbooks.ts`, `xero.ts`, availability `general`, objects none,
  `accounting` side): chart of accounts and `postJournal`, each with a fake company (accounts,
  journals, idempotency, refusal of unbalanced or inactive-account entries). Xero manual journals
  are in the base currency only: another currency is refused (`currency_unsupported`) and waits in
  the inbox; Xero accounts without a code are not offered. The SDK gains `AccountingSide` and the
  port an optional, checked `headers` field (Xero's `Xero-tenant-id`; never credentials).
- **Console** (connection page, design v2 components, 13 locales, RTL): the "Chart of accounts"
  form (a Select per category with the provider's accounts, a date picker for the first day,
  inline errors, success with the version; read-only for managers) and the "Daily journals" table
  (day, currency, entry and revision, debit total, status with the failure reason, the provider's
  reference), with empty states that say what to do next.
- **Dev/CI:** `/api/dev/accounting/fixture` books a fixture day (two sales, a refund, a payout) or a
  late refund on it with the real ledger functions (404 unless dev auth).

**Later / Not yet:**
- **Zero-fee orders are not in the ledger:** `postSaleTx`/`postRefundTx` post nothing when every
  line is zero (an `organizer_mor` sale with no application fee, a refund that gives no fee back), so
  their gross is missing from the summaries too. The summaries follow the ledger by design; closing
  this gap means memo-only journals in payments (owner inbox).
- Stripe's processing fees on the organizer's own account (`organizer_mor`) are not in the ledger and
  so not in the journal; disputes and transfer reversals are not summarized yet.
- Per-event classes/tracking categories (QuickBooks classes, Xero tracking) and a per-category
  memo per event.
- Multi-currency Xero (needs a bank account per currency); closed periods at the provider surface as
  a refusal in the inbox (no automatic move to the next open day).
- Real endpoints are UNVERIFIED until the owner's Intuit and Xero apps and Nango integrations exist
  (owner inbox); the Nango QuickBooks proxy is assumed to carry the company (realm) in its base URL.

### 4. Acceptance
| Criterion | Test |
|---|---|
| Round-trip sync of the fixture org without duplicates | `packages/testing/tests/salesforce.int.test.ts` › "people both ways, campaigns and members per event, sponsor opportunities, then nothing twice" (second run: 0 in, 0 out, no write request, same record counts on both sides; an edit on each side crosses once) |
| Field mapping respected both ways | int › "a saved pull mapping and push mapping are what the next run applies"; e2e `apps/web/e2e/salesforce.spec.ts` › mapping steps (refused save, version 2 after reload) |
| An unsubscribed or non-consenting contact is never pushed | int › round trip (no consent, withdrawn, unsubscribed: no record and no request), "a person who withdraws or unsubscribes is never pushed again…", "a Salesforce email opt-out withdraws…" |
| A revoked connection stops within one run | int › "revoked at Salesforce before a run…", "revoked in the middle of a run: the refused request is the last one"; e2e › "revoked in Salesforce…" |
| Errors land in the inbox; tokens never logged | int › "the errors inbox" (missing email, fixed and retried; an outage and its recovery), "tokens never leave the port (canary)" |
| External-id idempotency, loop guards | `packages/modules/integrations/tests/salesforce.test.ts` (upsert by `Yayatoh_Id__c`, own writes stamped with our origin, person edits not) ; int round trip |
| Isolation and permissions | int › "viewers cannot connect or map; another org sees nothing of the connection"; e2e › "a viewer cannot open integrations…" |
| E2E: connect (fake OAuth), map fields, run a sync, see results and an error in the inbox; keyboard only, axe both themes, RTL | `apps/web/e2e/salesforce.spec.ts` (5 tests × 3 viewports) |

### 5. Migration
None: the connector uses the M6.4a tables (connections, mappings, cursors, runs, record links,
errors). No new tenant table.

# Spec: M6.5 — enterprise and connectors (SSO/SCIM, Salesforce, calendars and automation, accounting)

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-3, P6-4, P6-13)
- **Status:** M6.5c built (2026-10-03), behind the `integrations` module key, the `IntegrationAuth`
  port (fake in dev/CI, off in production until Nango is configured) and `api_access` for the
  automation apps' webhook subscriptions. M6.5a, M6.5b and M6.5d add their own sections here.
- **Risk tags:** `db-migration`, `tenancy`, `infra`
- **Related ADRs:** 0008 (outbox)

## M6.5c — Google Calendar push, Make and n8n (done)

- **Organizers** keep an org Google Calendar with every session of their live events, always
  current: a moved session moves, a cancelled one comes off, nobody re-exports anything.
- **Attendees** (registrants, no account) keep their own schedule in their own Google Calendar
  from "My schedule", opt-in, and it follows what they enrol in or drop.
- **Automation builders** use Yayatoh in Make and n8n: triggers from the webhook event catalog and
  actions over `/v1`, with nothing more than their API key allows.

- Plan row **M6.5C**: Google Calendar push of sessions and personal schedules, Make and n8n apps
  over `/v1` and webhooks; acceptance "a moved session updates every subscribed calendar once".
- **P6-4** (Nango behind `IntegrationAuth`, our own sync engine, one mapping UI, errors inbox),
  **P6-3** (`/v1` additive only, webhook catalog, docs from OpenAPI), **P6-13** (`integrations` key).
- Builds on **M6.4a** (integrations framework, sync engine) and **M6.3b** (webhook catalog,
  endpoints, Svix port), program sessions (M1.4f, agenda v2 M5.2a) and personal schedules (M5.2b).

- **Reconciling push** in the M6.4a engine (`PushSide.reconcile` + `remove`): each run lists every
  record that should be at the provider (the stored cursor goes back to the start after a complete
  pass); unchanged ones are skipped by the record link's content hash (no provider call), changed
  ones are sent once with an `Idempotency-Key` per connection, record and content, and linked
  records the side no longer wants (`read` answers null) are deleted at the provider
  (`removed` outcome, link dropped; a failure stays in the errors inbox and is retried).
- **Per-registrant scope:** `connections.registrant_id` / `event_id` (both or neither, CHECK); the
  live-slot unique index becomes (org, connector, registrant) so many registrants can connect the
  same connector; `PushScope` is passed to `changes`/`read`; `ConnectorDefinition.audience`
  (`org` | `registrant`) and `defaultSyncIntervalMinutes`. The console lists, offers and opens
  only org connections; personal ones are the registrant's.
- **Connectors** (`src/connectors/google-calendar.ts`), one Google Calendar v3 API shape:
  - `google_calendar`: every placed (non-draft) session of the org's events that are not
    cancelled or archived, ending after 24 h ago (older entries are kept, not re-read).
  - `google_calendar_personal`: the registrant's schedule (included sessions plus the optional ones
    they are enrolled in; not waitlists or open offers), only while their ticket is live.
  - Entries: `summary`/`description`/`location` from the session (title, description cut to 900
    characters, room), `start`/`end` as wall-clock time in the **event's IANA zone** with the
    zone named (`2030-03-09T12:00:00-05:00`, `America/New_York`), our origin stamp and session id
    in `extendedProperties.private`. Created under a stable id derived from the connection and
    session, so a create retried after a lost answer finds its entry (409 → update), never a
    second one. Delete is idempotent (404/410 count as done). Default mapping is editable in the
    M6.4a mapping UI (push direction). Sync every 15 minutes by default, "Sync now" any time.
  - **Fake Calendar API** (dev/CI): insert with client ids (409 on a duplicate), update, delete
    (410 after), Google-like validation (summary, RFC 3339 times, known zones, end after start),
    `Idempotency-Key` replay, a write counter per entry.
- **Personal opt-in** on "My schedule" (`/orders/{token}/schedule`, the manage link is the
  credential): "Add to Google Calendar" → consent (the fake's page in dev/CI) → callback
  `/orders/{token}/schedule/calendar/{registrant}` (single-use state, unexpired, this registrant's)
  → active with the first sync queued. The panel shows how many sessions are on their calendar
  and the last update, "Update now" and "Stop syncing" (revoked here at once, then at Google;
  entries already there stay); a Google-side revoke shows "connect again". No account label is
  stored for personal connections (it would be the person's Google name). Rate-limited with the
  schedule's policy.
- **`/v1` webhook subscriptions** (additive): `GET/POST /v1/orgs/{org}/webhook-endpoints`,
  `DELETE …/{endpointId}` over the M6.3b commands (URL checks, 20 endpoints per org, thin signed
  messages; secrets, test sends and replays stay in the console). New API key scope
  **`webhooks:manage`** (CHECK widened, NOT VALID then VALIDATE).
- **Make and n8n apps** (`tools/automation-apps`, generated, checked in, validated in CI):
  `pnpm apps:generate` reads `apps/api/openapi.json` and writes
  `tools/automation-apps/generated/make/yayatoh.make-app.json` (API-key connection tested with
  `GET /v1/orgs/{org}/api-key`; one dedicated webhook + instant trigger per subscribable event
  type that subscribes on attach and unsubscribes on detach; one action or search per scoped
  `/v1` org operation, searches iterating `data` and following `nextCursor`) and
  `generated/n8n/` (`YayatohApi.credentials.json`, the declarative `Yayatoh.node.json`,
  `YayatohTrigger.node.json` with its subscription calls). 30 actions/searches, 30 triggers today.
  `pnpm contracts:check` fails on a stale or invalid file. The org is never a module input: it
  comes from the connection next to the key; every module names the scope it needs.

**Not yet / later:**
- Choosing a calendar other than `primary` (a dedicated "Yayatoh" calendar per org), and choosing
  which events go on the org calendar (today: every live event).
- Push on change: calendars follow on the next scheduled run (15 min) or "Sync now"; an outbox
  event from every session writer (create, update, CFP placement, agenda import, room/track
  deletes) would queue runs at once.
- Microsoft 365 / Outlook calendars (same connector shape, another provider config).
- Erasing a registrant (DSAR) does not revoke their personal connection; their entries come off
  on the next run because their schedule is gone. A privacy contributor entry is "later".
- The n8n package's TypeScript node classes and npm publishing; the Make app import and review
  (owner inbox). Signature verification inside the Make/n8n triggers (secrets are console-only).


| A moved session updates every subscribed calendar exactly once (idempotent by session and revision) | `packages/testing/tests/calendar-push.int.test.ts` › "org calendar and two personal calendars: one PUT each, none on the next runs"; "a create whose answer was lost…"; `apps/web/e2e/calendar-sync.spec.ts` › org calendar (writes = 2 for the moved entry, 1 for the rest; resync writes nothing) |
| A cancelled session is removed from calendars | int › "a deleted session comes off every calendar; a cancelled event takes all its sessions off"; e2e › org calendar (deleted Track B is `cancelled`) |
| A revoked connection stops updates within one run | int › "a connection revoked at Google stops updates within one run", "disconnecting (org) or stopping (personal) here stops updates at once" |
| Event times in the event's IANA zone | `packages/modules/integrations/tests/calendar.test.ts` › zonedDateTime; int › first test (`2030-03-09T12:00:00-05:00`); e2e › every entry `America/Chicago` |
| Personal schedule opt-in (only their sessions; manage link is the credential) | int › "personal schedules" (3 tests); e2e › personal schedule, stale/forged callback |
| Make/n8n actions can't exceed their API key's scopes or org | `tools/automation-apps/tests/apps.int.test.ts` (each generated module's request against `/v1`: 403 without the scope, 404 for another org's key, subscriptions only with `webhooks:manage`); `packages/api-v1/tests/keys.int.test.ts` (every org operation) |
| App definitions generated from OpenAPI, checked in, validated in CI | `tools/automation-apps/tests/apps.test.ts` (current, valid, complete, canary); `pnpm contracts:check` |
| Entitlement `integrations` | int › "needs the integrations module; the org calendar needs integrations:manage" |
| E2E: keyboard only, axe both themes, RTL | `apps/web/e2e/calendar-sync.spec.ts` (4 tests × 3 viewports) |

### 5. Data
Migration `0140_workable_white_queen.sql`: `integrations.connections` + `registrant_id`, `event_id`
(nullable uuids), CHECK `connections_subject_check`, unique index
`connections_org_connector_subject_live_key` (created before the old `connections_org_connector_live_key`
is dropped), partial index `connections_org_registrant_idx`; `tenancy.api_keys_scopes_check`
widened with `webhooks:manage`. No new text columns.

# Spec: M6.5 — enterprise identity and business integrations

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-5, P6-13)
- **Status:** M6.5a built (2026-10-03; local gate: lint, check:modules, typecheck 64/64, unit 3470/3470, integration 1950/1950; sso e2e 15/15 on three viewports), behind the `enterprise` module key and the `IdentityProviderPort` (fake IdP, fake DNS and fake metadata in dev/CI; off in production until the owner's IdP test tenant). M6.5b–d (Salesforce, calendars, accounting) are separate increments.
- **Risk tags:** `auth`, `tenancy`, `db-migration` (owner approval needed before main)
- **Related ADRs:** 0010 (identity per host), D14 (TOTP for admins and staff)

## M6.5a — single sign-on (SAML and OIDC) and SCIM (done)

Enterprise organizers let their team sign in with the company's identity provider (Okta, Entra ID,
Google Workspace…), prove which email domains they own, and let the IdP add, change and remove
people automatically (SCIM). IT admins get "remove in the IdP = no access here on the next request".

- **P6-5:** in-house on Better Auth (SSO for SAML + OIDC, SCIM), behind `enterprise`; admins and
  staff keep TOTP (D14). **P6-13:** the `enterprise` key. **P6-1:** fakes for anything external.
- **Plan row M6.5A** acceptance: a deprovisioned SCIM user loses access on the next request; SSO
  cannot bypass TOTP for platform staff.

- **Module `@yayatoh/sso`** (tier 6, schema `sso`, `MODULE.md`): `connections` (one per org; SAML
  entity id / sign-in URL / signing certificate, or OIDC issuer / client id with the client secret
  sealed by the org's key vault), `domains` (DNS TXT verification; one org per verified domain,
  platform-wide), `identities` (IdP subject ↔ account per connection), `scim_tokens` (SHA-256 at
  rest, one live per org), `scim_users`, `scim_groups` (with the mapped role), `scim_group_members`.
  All tenant tables: FORCE RLS, org-leading indexes, composite FKs; fixture rows for both orgs.
- **Settings → Single sign-on** (`/o/{org}/sso`, Settings group of the sidebar; owners and admins,
  `sso:manage`): connect SAML (paste metadata XML, a metadata URL, or the three values by hand) or
  OIDC; default role and just-in-time provisioning; our SP details to copy (entity id, ACS URL,
  redirect URI; SP metadata at `/auth/sso/saml/metadata`); **Test sign-in** (certificate/discovery
  check, then a round trip at the IdP that signs nobody in); **Turn on** only after a passed test
  with the current settings and a verified domain; **Turn off**; **Delete**. Domains: add, the TXT
  record to publish, **Check**, **Require single sign-on** per verified domain, remove. SCIM: base
  URL, token create/replace (shown once)/revoke, provisioned counts, groups with a role picker.
  Every change of who can sign in is a step-up command.
- **SSO sign-in** (`/sign-in` → "Sign in with single sign-on" → `/sign-in/sso`): the work address's
  verified domain names the org and connection (`sso.connection_for_domain`, SECURITY DEFINER); the
  browser goes to the IdP with a random state held only in its cookie (10 minutes, single use) and
  a nonce (SAML InResponseTo / OIDC nonce). Back at `/auth/sso/saml/acs` (POST) or
  `/auth/sso/callback` (GET): the answer is checked (signature, issuer, audience, request, expiry),
  the address must be in **that org's** verified domains, the account is found or created
  (an existing unverified account loses its password, 2FA and sessions first: pre-hijack guard),
  the IdP identity is linked, the person is provisioned (JIT) and the session is made by
  `/sso/session` (Better Auth, closed over HTTP). The org always comes from the pending sign-in.
- **Org-bound SSO sessions** (`auth.sessions.sso_org_id`): such a session opens that org's console
  only (console, org list, command center, realtime, seat streams, media, Scan supervisor, tenant
  account); another org asks for a new sign-in (`/sign-in?sso=other_org`).
- **Enforcement:** with "Require single sign-on" on a verified domain and the connection on,
  members with an address in it open the org only with its SSO session (owners exempt).
- **Staff and two-step verification (D14):** after the IdP, people with 2FA and **every platform
  staff member** answer their authenticator code (`platform.is_staff`, SECURITY DEFINER); staff
  without 2FA are refused; a trusted device never skips a staff member's code; the session made
  after the code keeps the org binding. The staff console has its own sessions and no SSO route.
- **SCIM 2.0** at `/api/scim/v2` (Users, Groups with GET/list `eq` filters/POST/PUT/PATCH/DELETE,
  ServiceProviderConfig, ResourceTypes; Okta/Entra quirks such as `"False"` and capitalised ops).
  Bearer token → org (`sso.scim_token_by_hash`); commands as system actor `scim:<token>`; users only
  in verified domains. Deactivate or delete → membership removed, every session and /v1 refresh
  token revoked at once. Groups map to roles (strongest wins); SSO/SCIM never make, change or
  remove an owner except removing a non-last owner on deprovisioning.
- **Fakes:** the recorded fake IdP page `/auth/sso/fake` (SAML form POST or OIDC redirect,
  HMAC-signed answers per org and connection), fake DNS (`/api/dev/sso/dns`, dev only), fake
  metadata for reserved test hosts; the SCIM client fixture is the int/e2e request sequence.

- The **real IdP adapter** (SAML XML signature validation, OIDC code exchange + JWKS) behind the
  same port, recorded against the owner's IdP test tenant (owner inbox). Until then production
  shows "not available yet". Better Auth's `@better-auth/sso` / `@better-auth/scim` plugins were
  read but not mounted (see Decisions).
- IdP-initiated SAML, single logout, encrypted assertions, signed AuthnRequests.
- SCIM `bulk`, sorting, ETags, other filter operators; changing a user's address (`userName` to
  another address is refused as `mutability`).
- Group roles from assertion attributes (only SCIM groups map roles).
- A per-token SCIM rate limit; SCIM audit view in the console.

### 4. Decisions (pending owner where marked)
- **Better Auth plugins not mounted (pending owner):** `@better-auth/sso` resolves DNS and fetches
  IdP endpoints itself (no port, so no fake), creates sessions outside our host binding and 2FA
  challenge, and the SCIM plugin keeps provisioning in global, non-RLS tables tied to Better Auth's
  organization plugin. We use Better Auth's sessions and internal adapter (as M1.2f social sign-in
  does) with our own ports and RLS tables; the real adapter can wrap the plugins' SAML/OIDC
  validation later.
- Only addresses in the org's verified domains (pending owner): no external contractors via SSO or
  SCIM unless their domain is verified.
- Owners are exempt from enforcement (break-glass, pending owner).
- SSO sessions are bound to their org (a person in two orgs signs in again to switch).
- Staff console TOTP is not newly required for staff without 2FA (still pending owner from M1.2).

### 5. Acceptance

| A deprovisioned SCIM user loses access on the next request (sessions revoked, no cached access) | `packages/testing/tests/sso.int.test.ts` (SCIM › deprovision); `apps/web/e2e/sso.spec.ts` (SCIM test) |
| SSO cannot bypass TOTP for platform staff; admin access still needs staff TOTP | `apps/worker/tests/sso-staff.int.test.ts` |
| An SSO assertion for org A never creates or logs into a membership in org B | `packages/testing/tests/sso.int.test.ts` (isolation); `packages/modules/sso/tests/fake.test.ts`; e2e `sso=other_org` |
| SSO setup and test sign-in; domain verification; SCIM provision/deprovision through the fake | `apps/web/e2e/sso.spec.ts` |
| Keyboard only, axe both themes, RTL | `apps/web/e2e/sso.spec.ts` |
| Permissions (viewer hidden + refused), entitlement, step-up | `sso.int.test.ts`, `sso.spec.ts` |
| SAML metadata, certificates, domains, SCIM parsing/PATCH/resources | `packages/modules/sso/tests/*.test.ts` |

| A day's journal equals the ledger memo entries to the cent (sales, fees, refunds, payouts, donations) | `packages/testing/tests/accounting.int.test.ts` › "a day’s journal equals the ledger memo entries to the cent" (fixture day with platform/organizer sales, an organizer-collected sale, refunds with and without fee back, a payout, a paid gift and a gift refund, edges at 00:01, 23:59 and the next midnight; truth computed straight from the memos) |
| A correction re-posts once; a re-run of the same day writes nothing new | int › "a re-run of the same day writes nothing new", "a late refund re-posts the affected day once…" (reversal undoes revision 1 exactly, the books net to the corrected day, a further run adds nothing); unit `modules/integrations/tests/accounting.test.ts` (`planDay`); e2e › "connect, map accounts, post a day, correct it and see the repost" |
| Idempotency by org + day + revision | int (keys asserted), "a provider outage retries with the same key and lands once…", "the fake books post a requestid once" |
| Tokens never logged | int › "tokens never reach a row, an error, an audit entry, an event or a log" (canaries) |
| A revoked connection stops within one run | int › "a revoked connection stops within one run" (refusal mid-run and revoke between runs); e2e › "revoked at the provider…" |
| Mapping validated and versioned; Xero base currency | int › "lists the provider’s active accounts and validates a save", "a mapping change applies to new postings…", Xero › "posts base-currency days…"; unit domain tests; e2e validation steps |
| Permissions and isolation | int (viewer refused, another org `not_found`, disconnected `invalid_state`); e2e › "a viewer cannot open an accounting connection"; isolation suite (fixture rows for both orgs) |
| E2E: connect (fake), map accounts, post a day, correct it and see the repost; keyboard only; axe both themes; RTL | `apps/web/e2e/accounting.spec.ts` (5 tests × 3 viewports) |

`packages/db/drizzle/0140_good_blonde_phantom.sql` (renumbered at merge): `integrations.account_maps`
and `integrations.accounting_journals` (generated: FORCE RLS, policies, org-leading indexes,
composite FKs to `connections`, a self FK from a reversal to its journal). No hand edits. Additive
only.
