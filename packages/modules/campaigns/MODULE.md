# campaigns (tier 6)

Marketing campaigns (M3.6b): block-built emails (and SMS/WhatsApp texts) with the org's brand kit,
sent to a saved audience or an M3.6a template, through the notifications dispatcher. Owns Postgres
schema `campaigns` (`campaigns`, `campaign_recipients`, `campaign_links`). Calls audiences, crm,
marketing, notifications, events and tenancy down the tiers; emits versioned outbox events and
never imports alert or analytics code.

**Invariants**
- **Lifecycle** (`campaignLifecycle`): draft → scheduled → sending → sent, pause/resume while
  sending, cancel before done. Only drafts are edited; every change locks the row and applies a
  conditional update.
- **Content is data.** `CampaignContent` (blocks, subject, font token, SMS body) is re-validated on
  every read; exactly one footer, last, with a postal address; merge fields only from
  `MERGE_FIELDS` (filled per recipient by the dispatcher, values HTML-escaped); links only to the
  org's events through M3.8a tracked links (same-site paths); images only https or `/media/…`.
- **Snapshot at send time.** Starting a send resolves the audience into `campaign_recipients`:
  one row per contact, `pending` or `excluded` with its reason (no address, erased, suppressed,
  unsubscribed, consent withdrawn/missing). Only express marketing consent for the channel counts.
  The count shown before sending (`campaigns.estimateReach`) runs the same rules without writing.
- **Exactly once.** A recipient is released once (row claimed with SKIP LOCKED, status `queued`, in
  the transaction that queues its message) and the message's dedupe key is `campaign:{id}:{contact}`.
  Test sends use `campaign-test:{id}:…` and are never counted.
- **Fair scheduling.** `allocate` hands out each tick's capacity round-robin across orgs (and across
  an org's campaigns) in chunks, within each org's per-minute rate (from its quota, fixed at start).
  `releaseChunkCommand` enforces the org's rate again inside the tenant transaction.
- **Events** (outbox, v1): `campaigns.send_started`, `campaigns.send_completed` (totals, for M3.8b),
  `campaigns.send_failed` (a schedule that could not start, or provider failures; for M3.2b alerts).
- Cross-org reads (`dueScheduledCampaignsTx`, `campaignLanesTx`, `finalizableCampaignsTx`) are for
  the worker's `platform_reader` only and return ids and counts.
- **Permissions:** reading needs `marketing:read`; drafts and audiences `marketing:write`; test
  sends, schedule, send, pause, resume and cancel `messages:send`. Entitlement `marketing`.
