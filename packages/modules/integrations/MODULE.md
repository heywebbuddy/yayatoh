# integrations (tier 6)

The integrations framework (M6.4a, decision P6-4): third-party connectors behind the
`IntegrationAuth` port, one field-mapping model, the sync engine on pg-boss and the errors inbox.
Owns Postgres schema `integrations`: `connections`, `field_mappings`, `sync_cursors`, `sync_runs`,
`record_links` and `sync_errors`. M6.4b–d add connectors (Eventbrite, Google Sheets, Zapier,
Slack, Mailchimp, HubSpot, Klaviyo) with `defineConnector` in `src/connectors/` and list them in
`CONNECTORS`.

**Invariants**
- **Tokens never enter Yayatoh.** The `IntegrationAuth` port (`src/auth/port.ts`) does OAuth
  connect, refresh and revoke; production is Nango (it holds and refreshes tokens, and provider
  calls go through its proxy), dev/CI/previews the fake (`INTEGRATIONS_AUTH_PROVIDER`, default
  `fake` outside production; off in production until Nango is configured). We store the
  provider-side connection id and labels only. A provider failure surfaces as `ProviderError`
  (status + code): the port never reads an error body. The fake's tokens are leak canaries
  (`__CANARY_integrations.oauth.*__`) and its refusals echo them; none may reach a log, an error,
  the inbox, an audit row, an event or a page.
- **Entitlements (P6-13):** every command needs the `integrations` module key (on every plan, free
  in beta); a connector may add its own key (`ConnectorDefinition.entitlement`). Fake-only
  connectors (the demo) are offered only where the port is the fake.
- **Permissions:** reads `integrations:read` (owners, admins, managers); writes
  `integrations:manage` (owners and admins). Connecting is an `export` command (never while staff
  act as a member). The engine runs as the system actor `integrations.sync`
  (`platform:integrations.sync`).
- **Connect:** `beginConnect` (a pending connection with a single-use state; only its sha256 is
  stored, 15 minutes) → the port's consent URL → the callback finds the pending connection by
  state, asks the port to `resolve` it, `completeConnect` (state checked again) makes it active
  with the default mappings (version 1) and queues the first sync. One live (pending, active,
  paused) connection per connector and org; revoked and failed ones stay as history.
- **Disconnect** revokes the connection here first (no run continues past its next page), then at
  the provider through the port. A provider refusal (401/403) during a run marks it `revoked`
  (`provider`) within that run, opens an `auth` error and emits `integrations.connection_revoked@1`.
- **Mappings** are versioned per connection, object and direction; a save validates sources,
  targets, duplicates and required targets against the connector's fields and only allowlisted
  transforms (`TRANSFORMS`); the newest version is in force from the next run, and records the old
  mapping rejected are retried at once.
- **Sync engine** (`engine.ts`): claim (concurrency of one: a partial unique index on queued or
  running runs, a lease, the worker's exclusive queue), auth check, per object pull (due retries,
  then pages from the stored cursor) and push (due retries, then records changed since the push
  cursor), finish. Each page is one command; each record commits with its link in a savepoint.
- **Exactly once and loop guards:** `record_links` is unique per (connection, object, provider id)
  and per (connection, object, our id); it keeps the remote version and our hash at the last
  crossing. A pulled record whose version we applied or wrote is skipped (a replayed page writes
  nothing), as is one stamped with our origin (`yayatoh:<connection id>`) or older than our own
  change (last writer wins); a pushed record whose hash we last wrote or sent is skipped (our pulls
  never echo back). Pushes carry an `Idempotency-Key` per record and content.
- **Errors inbox:** one open row per (connection, step, record) counting repeats; codes and field
  names only (never values or tokens). Automatic retries after 1, 5, 15, 60 and 240 minutes, then
  manual Retry; Dismiss closes it; a later success resolves it. A whole run's failure is a
  connection-level row (`-`) and backs the schedule off.
- **Execution:** the worker's leader finds connections with work through
  `integrations.connections_with_sync_work()` (SECURITY DEFINER, ids only, platform_reader) and
  queues `integrations.sync` (exclusive per connection); the dev drain (`/api/dev/integrations/run`)
  runs `runDueSyncs`. Events: `integrations.connection_connected@1`,
  `integrations.connection_revoked@1`, `integrations.sync_completed@1` (ids, codes and counts).

**M6.4d — Mailchimp, Klaviyo, HubSpot** (`src/audience/`, `src/connectors/{mailchimp,klaviyo,hubspot}`)
- **Consent first** (`audience/consent.ts`): only `subscribed` contacts (express email marketing
  consent; no unsubscribe, address suppression or erasure since) are ever created at a provider;
  contacts already there get the unsubscribe / opt-out; list members who leave the audience are
  archived. The status is computed from the crm ledger, notifications suppressions and platform
  erased addresses (`audience/state.ts`), never from the mapping; `send` refuses a non-subscriber.
- **Inbound** (`audience/inbound.ts`): unsubscribe → consent withdrawn (evidence
  `integration:<connector>:<connection>`) + marketing suppression with the provider as `source`;
  cleaned → address suppression `hard_bounce`; complaint → both. Never a grant. Recorded once per
  provider record and version in `consent_changes` (merges move it: `integrationsContactOwner`).
- `audience_syncs`: one per Mailchimp/Klaviyo connection (segment or everyone with consent, the
  provider list); `saveAudienceSync` is an `export` command. Pulled records are linked before the
  engine reads them back (`linkPulledTx`), so a change that came in is never sent back.
