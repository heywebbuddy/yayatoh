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
