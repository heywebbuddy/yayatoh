# Spec: M6.5 — enterprise and connectors (SSO/SCIM, Salesforce, calendars and automation, accounting)

- **Milestone:** M6.5 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-3, P6-4, P6-13)
- **Status:** M6.5c built (2026-10-03), behind the `integrations` module key, the `IntegrationAuth`
  port (fake in dev/CI, off in production until Nango is configured) and `api_access` for the
  automation apps' webhook subscriptions. M6.5a, M6.5b and M6.5d add their own sections here.
- **Risk tags:** `db-migration`, `tenancy`, `infra`
- **Related ADRs:** 0008 (outbox)

## M6.5c — Google Calendar push, Make and n8n (done)

### 1. Goal and users
- **Organizers** keep an org Google Calendar with every session of their live events, always
  current: a moved session moves, a cancelled one comes off, nobody re-exports anything.
- **Attendees** (registrants, no account) keep their own schedule in their own Google Calendar
  from "My schedule", opt-in, and it follows what they enrol in or drop.
- **Automation builders** use Yayatoh in Make and n8n: triggers from the webhook event catalog and
  actions over `/v1`, with nothing more than their API key allows.

### 2. References
- Plan row **M6.5C**: Google Calendar push of sessions and personal schedules, Make and n8n apps
  over `/v1` and webhooks; acceptance "a moved session updates every subscribed calendar once".
- **P6-4** (Nango behind `IntegrationAuth`, our own sync engine, one mapping UI, errors inbox),
  **P6-3** (`/v1` additive only, webhook catalog, docs from OpenAPI), **P6-13** (`integrations` key).
- Builds on **M6.4a** (integrations framework, sync engine) and **M6.3b** (webhook catalog,
  endpoints, Svix port), program sessions (M1.4f, agenda v2 M5.2a) and personal schedules (M5.2b).

### 3. Scope
**In (built):**
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

### 4. Acceptance

| Criterion | Test |
|---|---|
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
