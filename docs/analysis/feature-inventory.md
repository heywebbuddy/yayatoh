# Yayatoh feature and module inventory

Includes every module invariant document, declared package connections, detected commands and queries, emitted event type literals, tables and source tests. Invariant documents sometimes contain historical milestone wording; code remains the implementation evidence.

## agency

Tier 6; 6 source files; 1 test files.

Declared connections: @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/platform, @yayatoh/reports, @yayatoh/tenancy.

Source imports: @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/platform, @yayatoh/reports, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| agency.clients | agency:read | agency | [source](../../packages/modules/agency/src/queries.ts#L54) |
| agency.events | agency:read | agency | [source](../../packages/modules/agency/src/queries.ts#L126) |
| agency.refreshSnapshots | agency:read | agency | [source](../../packages/modules/agency/src/snapshots.ts#L197) |

### Feature rules and lifecycle

#### agency (tier 6)

Agency v1 (M6.7a, P6-8): the agency's **Clients | Events | Marketing | Reports** pages. Owns
Postgres schema `agency` (`client_snapshots`, `event_snapshots`), both owned by the **agency**
org. Grants themselves live in tenancy (`tenancy.org_access_grants`, owned by the client).

**Invariants**
- The agency's pages read only the agency's own snapshot rows, joined to the **live** grant list
  (`tenancy.agency_client_grants()`, a SECURITY DEFINER function that takes the agency from the
  transaction). A revoked client disappears at once; nothing on these pages reads a client table.
- Snapshots are computed under the **client's** tenant (a system actor of the client org) from the
  client's projections and exported read functions only (`eventHeadlineTx` over
  `reports.metric_snapshots`, events, marketing analytics totals), then written into the agency's
  tenant. Writers: `agency.refreshSnapshots` (the Reports page, `agency:read` + entitlement
  `agency`) and the `agency.snapshots` subscriber (grant created, changed or revoked).
- Money (gross sales) is stored only when the client opted in to finance (`with_finance`, CHECK), and
  shown only while the live grant still has the opt-in.
- Clients pay for themselves (D23): nothing here moves or bills money.
- Tier 6: it reads reports and marketing (tier 5) and is imported only by the apps.

**Public surface:** `.` (queries, the refresh command, the subscriber, pure report totals).


### Source index

- [packages/modules/agency/src/domain.ts](../../packages/modules/agency/src/domain.ts)
- [packages/modules/agency/src/index.ts](../../packages/modules/agency/src/index.ts)
- [packages/modules/agency/src/private-columns.ts](../../packages/modules/agency/src/private-columns.ts)
- [packages/modules/agency/src/queries.ts](../../packages/modules/agency/src/queries.ts)
- [packages/modules/agency/src/schema.ts](../../packages/modules/agency/src/schema.ts)
- [packages/modules/agency/src/snapshots.ts](../../packages/modules/agency/src/snapshots.ts)

## agency-ops

Tier 7; 9 source files; 1 test files.

Declared connections: @yayatoh/audiences, @yayatoh/campaigns, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/templates, @yayatoh/tenancy.

Source imports: @yayatoh/audiences, @yayatoh/campaigns, @yayatoh/campaigns/client, @yayatoh/crm/client, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/templates, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: agency_ops.client_detached, footer, group, heading, participation, system, text.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| agencyOps.detachAgency | members:manage | core | [source](../../packages/modules/agency-ops/src/detach.ts#L53) |
| agencyOps.prepareHandover | agency:manage | agency | [source](../../packages/modules/agency-ops/src/detach.ts#L124) |
| agencyOps.clientView | members:read | core | [source](../../packages/modules/agency-ops/src/detach.ts#L220) |
| agencyOps.createFanout | agency:campaigns | agency | [source](../../packages/modules/agency-ops/src/fanout.ts#L90) |
| agencyOps.recordFanoutTarget | agency:campaigns | agency | [source](../../packages/modules/agency-ops/src/fanout.ts#L142) |
| agencyOps.receiveCampaign | marketing:write | marketing | [source](../../packages/modules/agency-ops/src/fanout.ts#L168) |
| agencyOps.fanouts | agency:read | agency | [source](../../packages/modules/agency-ops/src/fanout.ts#L319) |
| agencyOps.setTemplatePrivacy | agency:manage | agency | [source](../../packages/modules/agency-ops/src/publish.ts#L67) |
| agencyOps.saveBrandKit | agency:manage | agency | [source](../../packages/modules/agency-ops/src/publish.ts#L123) |
| agencyOps.library | agency:read | agency | [source](../../packages/modules/agency-ops/src/publish.ts#L191) |
| agencyOps.prepareTemplatePublish | agency:manage | agency | [source](../../packages/modules/agency-ops/src/publish.ts#L236) |
| agencyOps.receiveTemplate | events:write | core | [source](../../packages/modules/agency-ops/src/publish.ts#L293) |
| agencyOps.recordPublications | agency:manage | agency | [source](../../packages/modules/agency-ops/src/publish.ts#L342) |
| agencyOps.prepareBrandKitPublish | agency:manage | agency | [source](../../packages/modules/agency-ops/src/publish.ts#L452) |
| agencyOps.receiveBrandKit | marketing:write | core | [source](../../packages/modules/agency-ops/src/publish.ts#L485) |
| agencyOps.applyBrandKit | org:update | core | [source](../../packages/modules/agency-ops/src/publish.ts#L571) |
| agencyOps.assignStaff | agency:manage | agency | [source](../../packages/modules/agency-ops/src/staff.ts#L52) |
| agencyOps.revokeStaff | agency:manage | agency | [source](../../packages/modules/agency-ops/src/staff.ts#L113) |
| agencyOps.staff | agency:read | agency | [source](../../packages/modules/agency-ops/src/staff.ts#L139) |

### Feature rules and lifecycle

#### agency-ops (tier 7)

Agency v2 operations (M6.8b, P6-8), behind the platform switch `agency_v2` and the `agency`
entitlement. Owns Postgres schema `agency_ops`. Builds on agency v1 (grants in tenancy, the
`agency` module's snapshots) and calls templates, campaigns, audiences, events and tenancy down
the tiers.

**Invariants**
- **Published downward = copied.** A template or brand kit published to a client becomes the
  client's own row in the client's org (a normal template; a kit in its library), written by the
  agency person **acting through the client's live grant** (`viaGrantCtx`), so the client's
  authorizer (grant role, team and day-of rules), audit (`viaAgency`) and row security apply.
- **Private parts never leave the agency.** Template private notes (`template_settings`) and
  kept-back parts (`questions`, `seating`, removed by `publicSnapshot`) and brand kits' private
  notes are never sent; a CHECK keeps notes off received kits.
- **Fan-out never mixes orgs.** One agency message becomes one campaign per client in that
  client's org with the client's own segment, footer (postal address) and send: its consent and
  suppression rules decide recipients (campaigns' recipient snapshot). The agency stores only
  ids and statuses (`fanout_targets`), never a recipient.
- **Detach keeps the client's data.** `agencyOps.detachAgency` (client, `members:manage`) and the
  agency's handover (`agency:manage` + step-up, then the same command as a system actor of the
  client) delete nothing of the client's: they revoke the grant and every team place and day-of
  pass under it, and clear the links back to the agency's originals. Event
  `agency_ops.client_detached@1` marks the agency's side (subscriber `agency-ops.detached`).
- **Team and day-of grants** are client-owned rows in `tenancy.agency_staff_grants`, read per
  request by `tenancy.agency_access()`; the agency writes them under the client's tenant only after
  checking its live grant; the agency reads them back through `tenancy.agency_staff_of_agency()`.
- Cross-org reads only through SECURITY DEFINER functions (`tenancy.agency_client_grants`,
  `tenancy.agency_staff_of_agency`); nothing here reads another org's tables directly.

**Public surface:** `.` (commands, queries, the publish / fan-out / handover orchestrators, the
subscriber, pure rules in `domain.ts`).


### Source index

- [packages/modules/agency-ops/src/common.ts](../../packages/modules/agency-ops/src/common.ts)
- [packages/modules/agency-ops/src/detach.ts](../../packages/modules/agency-ops/src/detach.ts)
- [packages/modules/agency-ops/src/domain.ts](../../packages/modules/agency-ops/src/domain.ts)
- [packages/modules/agency-ops/src/fanout.ts](../../packages/modules/agency-ops/src/fanout.ts)
- [packages/modules/agency-ops/src/index.ts](../../packages/modules/agency-ops/src/index.ts)
- [packages/modules/agency-ops/src/private-columns.ts](../../packages/modules/agency-ops/src/private-columns.ts)
- [packages/modules/agency-ops/src/publish.ts](../../packages/modules/agency-ops/src/publish.ts)
- [packages/modules/agency-ops/src/schema.ts](../../packages/modules/agency-ops/src/schema.ts)
- [packages/modules/agency-ops/src/staff.ts](../../packages/modules/agency-ops/src/staff.ts)

## ai

Tier 6; 15 source files; 3 test files.

Declared connections: @yayatoh/audiences, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Source imports: @yayatoh/audiences, @yayatoh/crm/client, @yayatoh/db, @yayatoh/engagement, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: consent, group, participation.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| ai.listBrandKits | marketing:read | ai | [source](../../packages/modules/ai/src/brand-kits.ts#L78) |
| ai.saveBrandKit | marketing:write | ai | [source](../../packages/modules/ai/src/brand-kits.ts#L99) |
| ai.deleteBrandKit | marketing:write | ai | [source](../../packages/modules/ai/src/brand-kits.ts#L161) |
| ai.creditBalance | events:read | ai | [source](../../packages/modules/ai/src/credits.ts#L121) |
| ai.creditLedger | events:read | ai | [source](../../packages/modules/ai/src/credits.ts#L143) |
| ai.debitCredit | events:write | ai | [source](../../packages/modules/ai/src/credits.ts#L160) |
| ai.refundCredit | events:write | ai | [source](../../packages/modules/ai/src/credits.ts#L221) |
| ai.adjustCredits | platform:entitlements.manage | null or not captured | [source](../../packages/modules/ai/src/credits.ts#L236) |

### Feature rules and lifecycle

#### ai (tier 6)

AI drafting for event copy (M1.4f) and the per-org AI credits ledger (decision D12: a small free allowance per org, metered at M6.6). M6.12b adds AI v2: drafts for campaigns, site pages and agendas in a tone and a brand kit, audience suggestions in the segment DSL, and matchmaking embeddings for networking. Owns Postgres schema `ai`.

**Invariants**
- `AiDrafter` is a port. `fakeDrafter` (deterministic) serves dev, CI and previews; `anthropicDrafter` is a stub until the owner's provider account exists (owner inbox). `drafterFromEnv` returns null in production without a provider: drafting is off, and nothing is debited.
- Organizer text is **data**: it is sent inside one JSON block with `<`, `>` and `&` escaped, and the instructions forbid following anything inside it. Drafts are cleaned (`cleanDraft`: plain text for taglines, the Markdown subset for descriptions, parsed question/answer pairs for FAQs) and shown as a **preview**. Nothing is saved or published by this module; the organizer accepts through the normal event commands (which audit and sanitize again).
- Credits: `ai.credit_accounts` (one row per org, `balance >= 0` CHECK) is locked `FOR UPDATE` for every change, so concurrent drafts serialize and the balance never goes negative. `ai.credit_ledger` is append-only (UPDATE/DELETE revoked from `app_user`) and its amounts always sum to the balance.
- The free allowance (`FREE_MONTHLY_CREDITS`, pending owner) tops the balance **up to** the allowance at the first use in each UTC month; extra credits granted on top are kept.
- One draft costs one credit. A provider failure, a timeout or an unusable draft refunds it (once per debit, enforced by a unique index).
- Drafting needs `events:write` and the `ai` entitlement; reading the balance `events:read`. Staff adjustments (`ai.adjustCredits`) are platform-only.

**AI v2 (M6.12b)**
- **The port** (`AiDrafter`) gains `compose` (a v2 draft: one JSON object back) and `embed` (one 512-number vector per text). `fakeDrafter` is deterministic (tone openers, the brand kit's first word, hashed bag-of-words embeddings); `anthropicDrafter` is still a stub, and Claude has no embeddings endpoint (owner inbox: an embeddings provider). Organizer text (brief, brand voice, event facts) travels in one escaped `<organizer_data>` block the model is told never to obey (`buildComposePrompt`).
- **Replies are cleaned and validated, never trusted**: campaigns become plain text (no HTML, no merge braces), pages the Markdown subset, agenda sessions are kept only inside the event's wall-clock start and end, in order and without overlaps; an audience suggestion must parse as a `SegmentDefinition` and may reference only the org's own events that were offered (`cleanAudienceSuggestion`). Unusable output is `invalid_state` / `ai_output`.
- **Nothing is saved, sent or published by AI.** Every result is a preview: the campaign editor applies it to unsaved state, a page becomes a *draft* entry through `createEntryCommand`, chosen agenda sessions go through `createSessionCommand`, an audience opens in the builder and is saved there.
- **Every call is charged**: one credit per call through a spend command whose permission is the feature's (`messagingCredits` = `messages:send` for campaigns and audiences, `contentCredits` = `marketing:write` for pages, `eventCredits` = `events:write` for agendas and embeddings), refunded once on failure (`chargedCall`). The ledger's `ai.credits_spent@1` / `ai.credits_refunded@1` feed M6.6b's `ai_credits` meter, so meter rows equal ledger debits and refunds exactly. `draft_kind` records the purpose (`AI_PURPOSES`).
- **Brand kits** (`ai.brand_kits`): name (unique per org, case-insensitive), voice, default tone, up to 12 words to use and to avoid, at most one default (partial unique index), at most 20 per org. Read `marketing:read`, write `marketing:write`. A draft names a kit by id; RLS makes another org's kit `not_found`.
- **Matchmaking** (`refreshMatchmaking`): asks engagement for listed profiles without an embedding (`pendingEmbeddingsQuery`: opted in, not hidden, attending; public fields only, never names or emails), embeds them in batches of 64 (one credit each, at most 10 calls per refresh) and stores them through `storeEmbeddingsCommand`, which skips anyone who left meanwhile. The ai module never touches engagement's tables.


### Source index

- [packages/modules/ai/src/brand-kits.ts](../../packages/modules/ai/src/brand-kits.ts)
- [packages/modules/ai/src/compose.ts](../../packages/modules/ai/src/compose.ts)
- [packages/modules/ai/src/credits.ts](../../packages/modules/ai/src/credits.ts)
- [packages/modules/ai/src/domain/compose.ts](../../packages/modules/ai/src/domain/compose.ts)
- [packages/modules/ai/src/domain/drafts.ts](../../packages/modules/ai/src/domain/drafts.ts)
- [packages/modules/ai/src/domain/embed.ts](../../packages/modules/ai/src/domain/embed.ts)
- [packages/modules/ai/src/domain/ledger.ts](../../packages/modules/ai/src/domain/ledger.ts)
- [packages/modules/ai/src/domain/tones.ts](../../packages/modules/ai/src/domain/tones.ts)
- [packages/modules/ai/src/drafter.ts](../../packages/modules/ai/src/drafter.ts)
- [packages/modules/ai/src/index.ts](../../packages/modules/ai/src/index.ts)
- [packages/modules/ai/src/matchmaking.ts](../../packages/modules/ai/src/matchmaking.ts)
- [packages/modules/ai/src/private-columns.ts](../../packages/modules/ai/src/private-columns.ts)
- [packages/modules/ai/src/schema.ts](../../packages/modules/ai/src/schema.ts)
- [packages/modules/ai/src/spend.ts](../../packages/modules/ai/src/spend.ts)
- [packages/modules/ai/src/ui.ts](../../packages/modules/ai/src/ui.ts)

## alerts

Tier 6; 13 source files; 4 test files.

Declared connections: @yayatoh/assistance, @yayatoh/badges, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/assistance, @yayatoh/badges, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/notifications/deliverability, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| alerts.list | events:read | core | [source](../../packages/modules/alerts/src/api.ts#L124) |
| alerts.count | events:read | core | [source](../../packages/modules/alerts/src/api.ts#L159) |
| alerts.history | events:read | core | [source](../../packages/modules/alerts/src/api.ts#L180) |
| alerts.acknowledge | alerts:manage | core | [source](../../packages/modules/alerts/src/api.ts#L218) |
| alerts.snooze | alerts:manage | core | [source](../../packages/modules/alerts/src/api.ts#L255) |
| alerts.routing | members:read | core | [source](../../packages/modules/alerts/src/api.ts#L307) |
| alerts.setRouting | members:manage | core | [source](../../packages/modules/alerts/src/api.ts#L327) |
| alerts.mySettings | org:read | core | [source](../../packages/modules/alerts/src/api.ts#L379) |
| alerts.setMyPhone | org:read | core | [source](../../packages/modules/alerts/src/api.ts#L394) |
| alerts.salesTarget | orders:read | core | [source](../../packages/modules/alerts/src/api.ts#L422) |
| alerts.setSalesTarget | events:write | core | [source](../../packages/modules/alerts/src/api.ts#L435) |

### Feature rules and lifecycle

#### alerts (tier 6)

The alert engine (M3.2b): rules evaluated from the outbox and on a schedule, alert instances with
their lifecycle and history, per-role routing, and delivery through notifications. Owns Postgres
schema `alerts` (`alerts`, `alert_history`, `routing`, `member_settings`, `sales_targets`). The
facts it measures belong to the modules below it (seating, ticketing, orders, check-in, tenancy,
payments, notifications, platform); it reads them through their exported counts only.

**Invariants**
- **One alert per rule and scope.** The scope is the event (`scope_key` = its id) or the org. A
  condition that clears resolves the alert automatically; the same condition coming back reopens
  the same row (`reopen_count`), so an event never piles up duplicates.
- **Lifecycle** (`alertLifecycle`): open → acknowledged | snoozed → resolved, and resolved →
  open (reopen). An acknowledgement that is still firing after 60 minutes (10 when live-critical)
  opens again and is sent again; a snooze ends the same way. Every change is a row in
  `alert_history` (append-only for the app) and a message on the org's `alerts` realtime channel
  (ids and states only).
- **Idempotent evaluation.** Every evaluation recomputes each rule from its sources under the
  scope's advisory lock, then reconciles (`planAlert`, pure). The `alerts.evaluator` subscriber
  handles each outbox event once (`processed_events`) and never takes replayed history; the
  worker's sweep (`evaluateOrgNow`) notices time passing. Evaluating twice changes nothing and
  sends nothing twice (deliveries are keyed by alert, sending number and member).
- **Thresholds are config** (`THRESHOLDS`, roadmap defaults pending the owner). Rules only read
  counts; `params` hold numbers only (never names or ids of people).
- **Visibility and routing.** A member sees (and is told about) a rule only if their role has the
  rule's permission (`RULES[rule].permission`). Routing is per role and group (`routing`, over
  `DEFAULT_ROUTING`); owners and admins change it (`members:manage`). In-app, email and push go out
  at once (`alerts.alert`, transactional); texts go to the member's own number
  (`member_settings`, their own setting only) as `alerts.alert-text`, which waits out quiet hours.
- **Acknowledge and snooze** need `alerts:manage` (not viewers or scanners); both are audited.
- Every alert links to the console page that fixes it (`RULES[rule].fix`).
- **Live-critical escalation (M3.3a):** a live-critical alert (devices offline or capacity while live, failed payments at the critical level while live) goes to members on duty at the event (check-in's `onDutyStaffTx`: staff presence) in-app and by push whatever their routing, and their text as `alerts.alert-urgent-text` (urgent: no quiet hours); door-only staff (viewer/scanner) only for door alerts. It re-sends when an acknowledgement times out (10 min). `watchQuietDevices` (the worker's per-second live watchdog) records devices going quiet and evaluates the org's live and pre-show events at once.
- **Same-tier sources only through the outbox** (batch 3e): journeys (`automations.journey_step_failed@1`)
  and campaigns (`campaigns.send_failed@1`) are recorded once per outbox event as `signals` (kept 7
  days) and counted by the org rules; this module never imports them, and they never import it.
  Dispute deadlines (`payments`, a lower tier) are read as counts (`disputeDeadlineFactsTx`).
- **Conference pack (M5.9a):** ten event rules (`evaluateConferenceRules`) read counts from program, registration, check-in and orders (`conferenceFactsTx`), and leads, sponsor deliverables and badge printers through `AlertDeps.conference` (`ConferenceSources`; a missing port or a `null` answer keeps the rule quiet). Group `conference`. Nothing fires once an event wraps.
- **Social pack (M4.6a):** three event rules read the guest list (guests' `socialFactsTx`, counts only) and seating's guest plan (`guestPlacesTx`, through the `OccupantDirectory` port each composition root registers, the worker included). `rsvpPending`: invited guests with an invitation still unanswered (gala seat holders and guests invited to nothing aside), from RSVP deadline −7 d (warning) and −1 d (critical) until the event starts; params `parties` and `days`. `guestsUnseated`: guests who haven't declined without a table on a guest chart, in the last 7 days (critical in the last day and while the event runs). `mealsMissing`: attending guests without a meal when the event has a menu, in the last 7 days. All `attendees` group, `guests:read`. `guests.party_responded@1` and `guests.rsvp_deadline_set@1` re-evaluate the event; the full sweep also takes events whose RSVP deadline is in the last 120 days or the next 8 (`rsvpDeadlineEventIdsTx`; `alerts.orgs_to_evaluate` likewise), so a wedding two months out is watched at deadline −7 d.
- **Integrations and billing (batch 3l merge):** two org rules. `integrationFailed` (group `setup`, `integrations:read`, fix `/integrations/errors`) counts sync runs that failed (`integrations.sync_completed@1` with status `failed`) and connections revoked at the provider (`integrations.connection_revoked@1`) in the last 24 hours, recorded as `signals` like the batch 3e failures; warning, critical once a connection is lost. `billingPastDue` (group `payments`, `billing:read`, fix `/plan`) reads the plan subscriptions now `past_due` (warning) or `unpaid` (critical) from billing (`subscriptionPaymentProblemsTx`, counts only); `billing.subscription_changed@1` re-evaluates the org, so the alert resolves once the plan is paid. Virtual (M6.9a) emits no failure event (`virtual.attended@1` only), so it has no rule.
- **Organizer rules (M6.2b).** Rule keys `metricRule` (sales group, `orders:read`) and
  `metricRuleFinance` (payments group, `finance:read`), scope `m:{ruleId}`, title = the rule's
  name. Driven only by `analytics.alert_rule_evaluated@1` (analytics is the same tier); the sweep
  wakes snoozes and times out acknowledgements from the stored reading. Sent in the app, by email
  and by push (never text) as `alerts.metric` (waits out quiet hours in the recipient's time zone)
  or `alerts.metric-now`.


### Source index

- [packages/modules/alerts/src/api.ts](../../packages/modules/alerts/src/api.ts)
- [packages/modules/alerts/src/client.ts](../../packages/modules/alerts/src/client.ts)
- [packages/modules/alerts/src/data-subject.ts](../../packages/modules/alerts/src/data-subject.ts)
- [packages/modules/alerts/src/domain/config.ts](../../packages/modules/alerts/src/domain/config.ts)
- [packages/modules/alerts/src/domain/lifecycle.ts](../../packages/modules/alerts/src/domain/lifecycle.ts)
- [packages/modules/alerts/src/domain/rules.ts](../../packages/modules/alerts/src/domain/rules.ts)
- [packages/modules/alerts/src/engine.ts](../../packages/modules/alerts/src/engine.ts)
- [packages/modules/alerts/src/facts.ts](../../packages/modules/alerts/src/facts.ts)
- [packages/modules/alerts/src/index.ts](../../packages/modules/alerts/src/index.ts)
- [packages/modules/alerts/src/metric-rules.ts](../../packages/modules/alerts/src/metric-rules.ts)
- [packages/modules/alerts/src/private-columns.ts](../../packages/modules/alerts/src/private-columns.ts)
- [packages/modules/alerts/src/schema.ts](../../packages/modules/alerts/src/schema.ts)
- [packages/modules/alerts/src/subscriber.ts](../../packages/modules/alerts/src/subscriber.ts)

## analytics

Tier 6; 28 source files; 2 test files.

Declared connections: @yayatoh/checkin, @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/checkin, @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| analytics.startBackfill | org:update | analytics_pro | [source](../../packages/modules/analytics/src/backfill.ts#L45) |
| analytics.backfillStatus | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/backfill.ts#L83) |
| analytics.orgDashboard | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/dashboard.ts#L319) |
| analytics.orgRevenue | finance:read | analytics_pro | [source](../../packages/modules/analytics/src/dashboard.ts#L345) |
| analytics.explore | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/explorer/explore.ts#L281) |
| analytics.exploreMoney | finance:read | analytics_pro | [source](../../packages/modules/analytics/src/explorer/explore.ts#L289) |
| analytics.listSavedViews | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/explorer/views.ts#L55) |
| analytics.saveView | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/explorer/views.ts#L71) |
| analytics.deleteView | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/explorer/views.ts#L128) |
| analytics.listReportSchedules | org:update | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L107) |
| analytics.getReportSchedule | org:update | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L120) |
| analytics.createReportSchedule | org:update | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L133) |
| analytics.updateReportSchedule | org:update | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L168) |
| analytics.setReportScheduleEnabled | org:update | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L196) |
| analytics.deleteReportSchedule | org:update | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L223) |
| analytics.listReportRuns | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L261) |
| analytics.reportFile | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/reports/schedules.ts#L314) |
| analytics.listAlertRules | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/rules/rules.ts#L249) |
| analytics.getAlertRule | orders:read | analytics_pro | [source](../../packages/modules/analytics/src/rules/rules.ts#L270) |
| analytics.createAlertRule | alerts:manage | analytics_pro | [source](../../packages/modules/analytics/src/rules/rules.ts#L289) |
| analytics.updateAlertRule | alerts:manage | analytics_pro | [source](../../packages/modules/analytics/src/rules/rules.ts#L321) |
| analytics.setAlertRuleEnabled | alerts:manage | analytics_pro | [source](../../packages/modules/analytics/src/rules/rules.ts#L354) |
| analytics.deleteAlertRule | alerts:manage | analytics_pro | [source](../../packages/modules/analytics/src/rules/rules.ts#L379) |

### Feature rules and lifecycle

#### analytics (tier 6)

The analytics warehouse and the cross-event org dashboards (M6.2a, decision P6-2; M6.2b adds
attribution, the explorer and scheduled reports here). Owns the Postgres schema `analytics`:
`daily_rollups`, `event_rollups` (the Postgres adapter's data), `event_sync` (what each adapter
last received per event), `ingest_log` (one row per ingested domain event) and `backfill_runs`.
Entitlement key `analytics_pro` (P6-13, free in beta on `launch_standard`).

**Invariants**
- **The port.** Everything goes through `AnalyticsWarehouse` (`src/warehouse/port.ts`): `writeEvent`,
  `dailyTotals`, `eventTotals`, `eventStates`. Each call takes a `WarehouseScope` built from the
  caller's `Ctx` and tenant transaction; the org always comes from `requireOrg(ctx)`, never from an
  argument. Adapters: `postgresWarehouse` (default everywhere, FORCE RLS plus an explicit org filter
  on every statement) and `tinybirdWarehouse` (Events API appends, pipe reads with a short-lived
  per-org JWT whose `fixed_params.org_id` pins the org; every returned row's `org_id` is checked).
  `ANALYTICS_WAREHOUSE=postgres|tinybird` picks one (`warehouseFromEnv`); `fakeTinybird()` is the
  only Tinybird dev and CI ever talk to.
- **One unit per event.** An event's rollups are recomputed from the sources (orders, refunds,
  check-in admissions, ticket types, the event row; exported narrow reads only) and replaced as a
  whole: `syncEventTx` takes the event's advisory lock, computes the snapshot and writes only when
  its hash differs from `event_sync` for that adapter. Versions grow with the database clock under
  the lock (newest wins in Tinybird). A replay, a duplicate or a backfill after live ingest writes
  nothing.
- **Ingest** (`analytics.warehouse` subscriber, `acceptsReplayed`): versioned payload schemas per
  `type@version` (`WAREHOUSE_EVENT_SCHEMAS`); only ids are read from payloads. Each source event is
  ingested once (`ingest_log`, unique per org and source event id, append-only for `app_user`).
- **Backfill** (`analytics.startBackfill`, `org:update`, audited; worker job `analytics.backfill`):
  keyset pages of events in one transaction each, cursor saved with the page (resumable), pages
  spaced by `pages_per_minute` (rate limit), one running run per org.
- **Days** are calendar days in the org's time zone (rollup rows store the day; a time zone change
  needs a backfill). Weeks start on Monday; months on the 1st.
- **Definitions:** registrations = sold orders (free ones included); tickets = paid tickets issued
  minus tickets refunded (the registry's `tickets.sold`); check-ins = each ticket once, on the day
  of its first live admission; no-shows = valid tickets never checked in, on the day an ended event
  ended; revenue = gross minus refunds per currency (before platform fees). Money is never added
  across currencies.
- **Output:** `analytics.orgDashboard` (`orders:read`) has no money field at all;
  `analytics.orgRevenue` (`finance:read`) is the only path to money. Both are allowlisted Zod DTOs.

**M6.2b: attribution, explorer, alert rules, scheduled reports**
- **Attribution rollups** (`attribution_rollups`): part of an event's snapshot (the same hash,
  version and adapters; Tinybird datasource `yy_attribution_rollups`, pipe `yy_attribution_rows`,
  newest version from `yy_daily_rollups`). Built from marketing's touch paths (`eventTouchPathsTx`)
  and orders' `soldOrderDaysTx`: per payment day (org time zone), model, source, medium, campaign
  key and link, in basis points of an order and minor units per currency. Models in
  `attribution/models.ts` (pure): first, last, linear with whole shares and **the remainder to
  the last touch**; every model adds up to the order exactly. `marketing.order_attributed@1`
  re-syncs the event.
- **Explorer** (`explorer/*`): closed vocabularies (`MEASURES`, `DIMENSIONS`, `RANGE_PRESETS`);
  touch dimensions only with attribution measures. `analytics.explore` (`orders:read`, counts and
  attributed orders) and `analytics.exploreMoney` (`finance:read`) are separate queries with
  separate input enums. Saved views are per member (the caller's rows only); money views need
  finance. CSV through `exploreCsvSerializer` (formula-safe cells).
- **Organizer alert rules** (`rules/*`, `alert_rules`): measured from the warehouse over whole
  days in the org's time zone; a change of state (or of the reading while firing) emits
  `analytics.alert_rule_evaluated@1` (numbers, vocabulary and the rule name), which the alerts
  module (same tier) applies to its own alert. Evaluating again with nothing new emits nothing.
- **Scheduled reports** (`reports/*`): `report_runs` is unique per (schedule, period key) and
  notifications are keyed `report:{schedule}:{period}:{member}`, so a period is sent once through
  retries, restarts and concurrent ticks. Periods are calendar days in the org's time zone (DST
  never skips or repeats one). The PDF is rendered outside transactions per recipient language
  and finance visibility (`report_files`), served only to members (`reportFileQuery`).


### Source index

- [packages/modules/analytics/src/access.ts](../../packages/modules/analytics/src/access.ts)
- [packages/modules/analytics/src/attribution/models.ts](../../packages/modules/analytics/src/attribution/models.ts)
- [packages/modules/analytics/src/backfill.ts](../../packages/modules/analytics/src/backfill.ts)
- [packages/modules/analytics/src/compute.ts](../../packages/modules/analytics/src/compute.ts)
- [packages/modules/analytics/src/dashboard.ts](../../packages/modules/analytics/src/dashboard.ts)
- [packages/modules/analytics/src/explorer/catalog.ts](../../packages/modules/analytics/src/explorer/catalog.ts)
- [packages/modules/analytics/src/explorer/csv.ts](../../packages/modules/analytics/src/explorer/csv.ts)
- [packages/modules/analytics/src/explorer/explore.ts](../../packages/modules/analytics/src/explorer/explore.ts)
- [packages/modules/analytics/src/explorer/views.ts](../../packages/modules/analytics/src/explorer/views.ts)
- [packages/modules/analytics/src/index.ts](../../packages/modules/analytics/src/index.ts)
- [packages/modules/analytics/src/ingest.ts](../../packages/modules/analytics/src/ingest.ts)
- [packages/modules/analytics/src/private-columns.ts](../../packages/modules/analytics/src/private-columns.ts)
- [packages/modules/analytics/src/reports/catalog.ts](../../packages/modules/analytics/src/reports/catalog.ts)
- [packages/modules/analytics/src/reports/labels.ts](../../packages/modules/analytics/src/reports/labels.ts)
- [packages/modules/analytics/src/reports/period.ts](../../packages/modules/analytics/src/reports/period.ts)
- [packages/modules/analytics/src/reports/run.ts](../../packages/modules/analytics/src/reports/run.ts)
- [packages/modules/analytics/src/reports/schedules.ts](../../packages/modules/analytics/src/reports/schedules.ts)
- [packages/modules/analytics/src/rules/catalog.ts](../../packages/modules/analytics/src/rules/catalog.ts)
- [packages/modules/analytics/src/rules/evaluate.ts](../../packages/modules/analytics/src/rules/evaluate.ts)
- [packages/modules/analytics/src/rules/rules.ts](../../packages/modules/analytics/src/rules/rules.ts)
- [packages/modules/analytics/src/schema.ts](../../packages/modules/analytics/src/schema.ts)
- [packages/modules/analytics/src/sync.ts](../../packages/modules/analytics/src/sync.ts)
- [packages/modules/analytics/src/tick.ts](../../packages/modules/analytics/src/tick.ts)
- [packages/modules/analytics/src/warehouse/port.ts](../../packages/modules/analytics/src/warehouse/port.ts)
- [packages/modules/analytics/src/warehouse/postgres.ts](../../packages/modules/analytics/src/warehouse/postgres.ts)
- [packages/modules/analytics/src/warehouse/select.ts](../../packages/modules/analytics/src/warehouse/select.ts)
- [packages/modules/analytics/src/warehouse/tinybird-fake.ts](../../packages/modules/analytics/src/warehouse/tinybird-fake.ts)
- [packages/modules/analytics/src/warehouse/tinybird.ts](../../packages/modules/analytics/src/warehouse/tinybird.ts)

## assistance

Tier 5; 8 source files; 1 test files.

Declared connections: @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: none detected.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| assistance.guestRequest | public:assistance.request | checkin | [source](../../packages/modules/assistance/src/api.ts#L304) |
| assistance.guestStatus | public:assistance.status | checkin | [source](../../packages/modules/assistance/src/api.ts#L397) |
| assistance.staffRequest | checkin:device | checkin | [source](../../packages/modules/assistance/src/api.ts#L424) |
| assistance.queue | assistance:read | checkin | [source](../../packages/modules/assistance/src/api.ts#L468) |
| assistance.assignees | assistance:read | checkin | [source](../../packages/modules/assistance/src/api.ts#L503) |
| assistance.assign | assistance:manage | checkin | [source](../../packages/modules/assistance/src/api.ts#L537) |
| assistance.update | assistance:manage | checkin | [source](../../packages/modules/assistance/src/api.ts#L597) |
| assistance.addNote | assistance:manage | checkin | [source](../../packages/modules/assistance/src/api.ts#L637) |

### Feature rules and lifecycle

#### assistance (tier 5)

Guest assistance (M3.3b): guests ask for help from the seat finder with their ticket's help link;
door staff ask from the Scan PWA; one queue per event where staff take, assign, start, resolve or
cancel requests and add notes. Owns Postgres schema `assistance` (`requests`, `activity`). It
reads tickets, events, check-in devices and checkpoints, and memberships through their exported
reads only; the alert engine (tier 6) and the Command Center (tier 6) read it the same way.

**Invariants**
- **A guest request needs the ticket's help link for that event.** `<ticketId>~<hmac>` under
  APP_TOKEN_SECRET (purpose `assistance.ticket`); the ticket must be active and belong to the
  event in the URL. Another event's ticket, a forged or void one: `not_found`. At most
  `MAX_OPEN_PER_TICKET` open requests per ticket; the web action rate-limits first
  (`assistanceRequest`). The guest gets a status link (`assistance.request`) showing number,
  reason and state only.
- **Staff requests come from a device** (`checkin:device`), tied to it and to the entrance it
  scans at (a checkpoint of another event is dropped).
- **Lifecycle** (`requestLifecycle`): new → assigned → in progress → resolved | cancelled;
  starting an unassigned request assigns it to whoever starts it. Conditional updates on the
  state; every change is an `activity` row, an audit entry (never the note's text), an outbox
  event (`assistance.requested` / `assistance.updated`, ids and states) and a message on the
  event's `assistance` realtime channel (ids and states only).
- **Priority and SLA** are pure (`priorityFor`, `SLA_MS`): medical and security urgent (2 min),
  accessibility, backup and supervisor high (5 min), the rest normal (10 min). The SLA runs while
  nobody has taken the request; the alert engine raises `assistanceOverdue` when one is past it.
  Urgent and high requests are pushed at once to the staff devices at the event.
- **Assignees** are members who may work the queue at the event (`assistance:manage` by org role
  or event role), or the device asking (`me`). Viewers read the queue and can't act.
- **Privacy:** notes, locations and staff notes are `personal`; DTOs are allowlists; guests'
  names and ticket codes reach the event's staff only; nothing here feeds marketing.


### Source index

- [packages/modules/assistance/src/api.ts](../../packages/modules/assistance/src/api.ts)
- [packages/modules/assistance/src/client.ts](../../packages/modules/assistance/src/client.ts)
- [packages/modules/assistance/src/data-subject.ts](../../packages/modules/assistance/src/data-subject.ts)
- [packages/modules/assistance/src/domain/rules.ts](../../packages/modules/assistance/src/domain/rules.ts)
- [packages/modules/assistance/src/index.ts](../../packages/modules/assistance/src/index.ts)
- [packages/modules/assistance/src/private-columns.ts](../../packages/modules/assistance/src/private-columns.ts)
- [packages/modules/assistance/src/realtime.ts](../../packages/modules/assistance/src/realtime.ts)
- [packages/modules/assistance/src/schema.ts](../../packages/modules/assistance/src/schema.ts)

## attendees

Tier 2; 15 source files; 0 test files.

Declared connections: @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Source imports: @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: attendee.cancelled, attendees.changed, attendees.message_batch.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| attendees.listAttendees | attendees:read | attendees | [source](../../packages/modules/attendees/src/attendees.ts#L251) |
| attendees.getAttendee | attendees:read | attendees | [source](../../packages/modules/attendees/src/attendees.ts#L260) |
| attendees.labels | attendees:read | attendees | [source](../../packages/modules/attendees/src/attendees.ts#L277) |
| attendees.setLabels | attendees:write | attendees | [source](../../packages/modules/attendees/src/attendees.ts#L299) |
| attendees.search | attendees:read | attendees | [source](../../packages/modules/attendees/src/attendees.ts#L387) |
| attendees.addGuest | attendees:write | attendees | [source](../../packages/modules/attendees/src/guests.ts#L25) |
| attendees.removeGuest | attendees:write | attendees | [source](../../packages/modules/attendees/src/guests.ts#L82) |
| attendees.stageImport | attendees:write | attendees | [source](../../packages/modules/attendees/src/imports.ts#L94) |
| attendees.validateImport | attendees:write | attendees | [source](../../packages/modules/attendees/src/imports.ts#L161) |
| attendees.importSummary | attendees:write | attendees | [source](../../packages/modules/attendees/src/imports.ts#L258) |
| attendees.importFailures | attendees:write | attendees | [source](../../packages/modules/attendees/src/imports.ts#L312) |

### Feature rules and lifecycle

#### attendees (tier 2)

The per-event participant record. Owns Postgres schema `attendees`.

**Invariants**
- Every attendee belongs to one event and one org contact (`crm.contacts`); the contact is the person, the attendee is their participation.
- Ticketed attendees are created in the same transaction that issues the ticket, one per ticket (`unique (org_id, ticket_id)`).
- Organizer reads go through `listAttendeesQuery` and the `AttendeeDto` allowlist.
- Taking a guest off the list (`removeGuestCommand`) emits `attendee.cancelled@1` `{ orgId, eventId, attendeeId }` so higher tiers can react (seating frees their seat).
- **Filter extensions (M1.8f):** filters on data higher tiers own (ticket type, check-in) arrive as ticket-id subqueries built by those modules (`TicketFilterExtension`); this module applies them to `ticket_id` and never reads their schemas.
- **Search (M1.8f):** name/email search runs through `attendees.search_ids(pattern)` (SECURITY DEFINER, own org only via `app.org_id`, ids only) so the trigram indexes serve it under RLS (Postgres can't use them for `ILIKE` behind a policy); the rest of the query stays under RLS and results equal a plain `ILIKE`.


### Source index

- [packages/modules/attendees/src/attendees.ts](../../packages/modules/attendees/src/attendees.ts)
- [packages/modules/attendees/src/bulk.ts](../../packages/modules/attendees/src/bulk.ts)
- [packages/modules/attendees/src/contact-merge.ts](../../packages/modules/attendees/src/contact-merge.ts)
- [packages/modules/attendees/src/data-subject.ts](../../packages/modules/attendees/src/data-subject.ts)
- [packages/modules/attendees/src/dsar.ts](../../packages/modules/attendees/src/dsar.ts)
- [packages/modules/attendees/src/dto.ts](../../packages/modules/attendees/src/dto.ts)
- [packages/modules/attendees/src/guests.ts](../../packages/modules/attendees/src/guests.ts)
- [packages/modules/attendees/src/imports.ts](../../packages/modules/attendees/src/imports.ts)
- [packages/modules/attendees/src/index.ts](../../packages/modules/attendees/src/index.ts)
- [packages/modules/attendees/src/networking.ts](../../packages/modules/attendees/src/networking.ts)
- [packages/modules/attendees/src/participation.ts](../../packages/modules/attendees/src/participation.ts)
- [packages/modules/attendees/src/private-columns.ts](../../packages/modules/attendees/src/private-columns.ts)
- [packages/modules/attendees/src/schema.ts](../../packages/modules/attendees/src/schema.ts)
- [packages/modules/attendees/src/sync-rows.ts](../../packages/modules/attendees/src/sync-rows.ts)
- [packages/modules/attendees/src/testing.ts](../../packages/modules/attendees/src/testing.ts)

## audiences

Tier 5; 13 source files; 1 test files.

Declared connections: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/crm/client, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: group, participation, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| audiences.personTimeline | contacts:read | marketing | [source](../../packages/modules/audiences/src/people.ts#L44) |
| audiences.preview | messages:read | marketing | [source](../../packages/modules/audiences/src/segments.ts#L63) |
| audiences.listSegments | messages:read | marketing | [source](../../packages/modules/audiences/src/segments.ts#L96) |
| audiences.getSegment | messages:read | marketing | [source](../../packages/modules/audiences/src/segments.ts#L121) |
| audiences.saveSegment | messages:send | marketing | [source](../../packages/modules/audiences/src/segments.ts#L141) |
| audiences.deleteSegment | messages:send | marketing | [source](../../packages/modules/audiences/src/segments.ts#L190) |

### Feature rules and lifecycle

#### audiences (tier 5)

Audiences (M3.6a): the live participation projector, the segment builder's saved definitions, the
vision's three audience templates and the audience export. Owns Postgres schema `audiences`
(`segments`); the projections it keeps current (`event_participation`, `contact_profile`) and the
segment DSL and its SQL compiler belong to `crm`, which it calls down the tiers.

**Invariants**
- **Projector (`audiences.participation`).** Fed by the outbox: `order.paid`, `order.refunded`,
  `tickets.cancelled`, `ticket.admitted`, `ticket.admission_undone`, `attendee.cancelled`,
  `attendees.changed`, `seating.assignments_changed`, `guests.rsvp_responded` (M4.1d; it sets the
  row's `rsvp` on rows that exist for other reasons only, P4-3) (all v1). Each names an event and people (or,
  for a floor-plan edit, the whole event); their rows are recomputed from the sources (attendees,
  tickets, seat assignments, admissions, paid orders) and replaced, then their profiles are
  rebuilt. Exactly once per event (`processed_events`), idempotent besides, order-independent. It
  opts in to `replayed` legacy events, so migrated history is projected like live sales.
- **Definitions are data, never SQL.** A saved definition is re-validated with the DSL schema on
  every read; scopes (event, series, previous edition, date range) are resolved to event ids through
  the events module under the tenant's RLS, then crm compiles with bound parameters only.
- **Permissions.** Viewing and previewing need `messages:read`; saving and deleting need
  `messages:send`. A preview with `eventId` is event-scoped: event roles apply, the audience is that
  event's people, and any scope beyond that event (or an org-wide profile condition) is refused.
- **Preview output is an allowlist** (`AudienceRowDto`: contact id, name, email, event counts, last
  seen). Counts are computed on read and never stored.
- **Export** is the platform bulk-export path (`audiences.contactsCsv`): step-up, `bulk.start` audit,
  impersonation category `export`, allowlisted CSV columns; permission `attendees:export`.
- Templates are pure (`./client`): they fill the builder with ordinary definitions.
- **Engagement (M5.7b).** The DSL's `engagement` condition reads `crm.event_engagement` (kept by
  the `engagement` module): the sum of a contact's scores over the events in scope, compared with a
  whole number. Its scope is resolved like every other condition's.
- **M6.1a.** `personTimelineQuery` (`contacts:read`) pages the crm timeline projection and names its
  events through the events module (a lookup, not a join). `participationContactOwner` is the
  `projections`-phase contact reference owner: after every module moved its rows in a merge (or an
  undo), it recomputes both records' participation at every event either took part in, in the same
  transaction.

- **Contact stats (M6.1b).** The participation projector refreshes the stats of every contact it
  touches in the same transaction; `audiences.contact-signals` records `session.attended@1` and
  `campaign.opened@1` (v1 contracts; replayed history included) and refreshes that contact.
  Everything is recomputed from the sources: replaying never double-counts. `rescoreOrgContacts`
  is the backfill and the daily rescore (worker job `audiences.contact-stats`), so registrations
  whose events have ended become attended or no-shows.
- **Money conditions** (`ltv`, `rfmMonetary`) need the member's org role to hold `finance:read`
  for preview, save and export (`assertMoneyConditionsAllowedTx`; the export checks the
  transaction's actor). System actors (campaign sends) are not members and pass.


### Source index

- [packages/modules/audiences/src/client.ts](../../packages/modules/audiences/src/client.ts)
- [packages/modules/audiences/src/contact-merge.ts](../../packages/modules/audiences/src/contact-merge.ts)
- [packages/modules/audiences/src/domain/templates.ts](../../packages/modules/audiences/src/domain/templates.ts)
- [packages/modules/audiences/src/export.ts](../../packages/modules/audiences/src/export.ts)
- [packages/modules/audiences/src/index.ts](../../packages/modules/audiences/src/index.ts)
- [packages/modules/audiences/src/money.ts](../../packages/modules/audiences/src/money.ts)
- [packages/modules/audiences/src/people.ts](../../packages/modules/audiences/src/people.ts)
- [packages/modules/audiences/src/private-columns.ts](../../packages/modules/audiences/src/private-columns.ts)
- [packages/modules/audiences/src/projector.ts](../../packages/modules/audiences/src/projector.ts)
- [packages/modules/audiences/src/schema.ts](../../packages/modules/audiences/src/schema.ts)
- [packages/modules/audiences/src/scopes.ts](../../packages/modules/audiences/src/scopes.ts)
- [packages/modules/audiences/src/segments.ts](../../packages/modules/audiences/src/segments.ts)
- [packages/modules/audiences/src/stats.ts](../../packages/modules/audiences/src/stats.ts)

## automations

Tier 6; 16 source files; 2 test files.

Declared connections: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/seating, @yayatoh/surveys.

Source imports: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/seating, @yayatoh/surveys.

Tables detected: see schema source.

Event type literals detected: system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| automations.listJourneys | marketing:read | marketing | [source](../../packages/modules/automations/src/journeys.ts#L182) |
| automations.journey | marketing:read | marketing | [source](../../packages/modules/automations/src/journeys.ts#L205) |
| automations.journeyRuns | marketing:read | marketing | [source](../../packages/modules/automations/src/journeys.ts#L272) |
| automations.journeyRun | marketing:read | marketing | [source](../../packages/modules/automations/src/journeys.ts#L325) |
| automations.createJourney | marketing:write | marketing | [source](../../packages/modules/automations/src/journeys.ts#L453) |
| automations.updateJourney | marketing:write | marketing | [source](../../packages/modules/automations/src/journeys.ts#L501) |
| automations.setJourneyEnabled | marketing:write | marketing | [source](../../packages/modules/automations/src/journeys.ts#L544) |
| automations.deleteJourney | marketing:write | marketing | [source](../../packages/modules/automations/src/journeys.ts#L582) |
| automations.rsvpReminders | guests:read | guests | [source](../../packages/modules/automations/src/rsvp-reminders.ts#L90) |
| automations.setRsvpReminders | guests:write | guests | [source](../../packages/modules/automations/src/rsvp-reminders.ts#L105) |
| automations.partyReminders | guests:read | guests | [source](../../packages/modules/automations/src/rsvp-reminders.ts#L210) |
| automations.recordStepFailure | platform:automations.run | null or not captured | [source](../../packages/modules/automations/src/runner.ts#L314) |
| automations.enrollEventTime | platform:automations.run | marketing | [source](../../packages/modules/automations/src/runner.ts#L381) |

### Feature rules and lifecycle

#### automations (tier 6)

Journeys (M3.7a): an org's automation for one event (or every event of a series). Owns Postgres
schema `automations`: `journeys`, `journey_steps`, `journey_runs` (one person's way through a
journey) and `scheduled_actions` (the work queue, one row per run and step).

**Invariants**
- A journey has one trigger: `order_paid` (the buyer), `checked_in` (the ticket's holder) or
  `event_time` (everyone on the event's list, enrolled by the runner). `rsvp` is reserved for
  M4.1d (`FUTURE_TRIGGERS`): a new trigger is a subscriber that calls `journeysForEventTx` +
  `enrollTx`, plus the value in `journeys_trigger_check`.
- Each step = a wait (from the trigger, the event's start or its end: calendar days in the event's
  timezone at the same wall-clock time or at `at_time`, then exact minutes; DST-safe) + an action
  (email, SMS, WhatsApp or push message; add a label; survey invite) + an optional condition
  (checked in, has a seat, answered the survey, or their negations), checked when the step is due.
- Steps are edited only while the journey is off. Switching it on never enrolls anyone
  retroactively; switching it off cancels every pending step (`journey_disabled`).
- One run per (journey, event, contact). On enrollment every step gets a `scheduled_actions` row
  with its time; a step whose time has passed is `skipped` (`too_late`), except steps that wait
  from the trigger.
- **Exactly once:** `scheduled_actions.idempotency_key` (journey + step + event + contact) is
  unique per org and is the message's notifications dedupe key. The runner claims a due row with
  `FOR UPDATE SKIP LOCKED` while `pending` and commits the step's effect with the row's new status.
  A failed attempt rolls back entirely and is retried with backoff (1, 5, 15, 60 min); after 5
  attempts (or a permanent error) the step is `failed` and `automations.journey_step_failed@1`
  `{ orgId, journeyId, runId, actionId, eventId, position, action, attempts, error }` is emitted.
  **The M3.2b alert engine subscribes to it** for its "automation failures" rule (not wired here).
- **`replayed` events never trigger journeys:** none of the subscribers accepts replayed history,
  and each handler checks the flag again.
- Cancellation hooks: a full refund (`order.refunded@1`, `fully`) cancels the runs its order
  started; a cancelled ticket or guest spot cancels the person's runs once they hold nothing at the
  event; a cancelled event or date cancels its runs.
- Reschedule on date change (`event.updated/rescheduled/postponed/occurrences_updated`): pending
  steps are re-planned from the event's current start/end (never from the change, so replays land
  on the same result); trigger-anchored steps keep their time; past-due steps run now while their
  anchor is ahead, else are skipped; steps that ran never run again. A postponed event parks its
  event-anchored steps (`cancelled` / `event_postponed`) until it is rescheduled.
- Messages go through the notifications dispatcher as `automations.message` (category reminders:
  preferences, unsubscribe, quiet hours, texts need consent) on the step's own channel; subject and
  body are the organizer's, with `{name}`, `{event}` and `{when}` filled per person.
- Reads need `marketing:read` (viewers included); writes need `marketing:write`. The runner's
  commands need `platform:automations.run` (system actors only).
- Execution: the worker's leader finds orgs with due work through
  `automations.orgs_with_journey_work()` (SECURITY DEFINER, ids only, platform_reader) and queues
  the pg-boss job `automations.run-due` (exclusive per org); the dev drain runs the same pass.

**System journeys: RSVP reminders (M4.1f)**
- A system trigger (`SYSTEM_TRIGGERS`: `rsvp_sent`) and anchor (`rsvp_deadline`) are accepted by the tables but never offered by the builder; journeys with them (template `rsvp_reminders`) are hidden from the journey list, detail and run pages and from their commands (`not_found`). The guests RSVP host (`guests:write`, entitlement `guests`) manages them through `automations.setRsvpReminders` (days before the deadline × channels; changing them retires the old journey and starts a new one, enrolling every party already sent and not answered) and reads them with `automations.rsvpReminders` / `automations.partyReminders` (`guests:read`).
- **Party runs:** `journey_runs` and `scheduled_actions` hold either a `contact_id` or a `party_id` (CHECK: exactly one). A party run's key is `partyActionKey` (journey + step + event + party). Guests never become contacts (P4-3).
- The runner runs party steps under the `guests` entitlement (`automations.runPartyAction`), so a wedding org without the marketing module still gets its reminders; without marketing only party steps run. A party step first checks whether the party answered (then the run is cancelled, `responded`), else queues the reminder through guests (`queuePartyMessageTx`: transactional, quiet hours in the event's zone) on the step's channel, or skips (`no_address`, `no_link`, `link_expired`). `RunnerDeps.appOrigin` is needed for the party's link.
- Hooks (`rsvpReminderHooks`, part of `journeySubscribers`): `guests.invitation_queued@1` enrolls the party, `guests.party_responded@1` cancels its runs, `guests.rsvp_deadline_set@1` re-plans pending steps (`rescheduleEventTx`). An `rsvp_deadline` step of an event with no deadline is skipped (`no_deadline`).
- **Invoice reminders (M5.1d):** trigger `invoice_issued` (`order.invoiced@1`, the buyer) and wait anchor `invoice_due` (the run's `due_at`, the start of the invoice's due day in the event's timezone; unaffected by event reschedules). `order.paid@1` / `order.voided@1` cancel the order's `invoice_issued` runs (`invoice_paid` / `invoice_void`); a due step on a settled invoice is skipped (`invoice_settled`). Messages may use `{invoice}`, `{balance}`, `{due}` and `{link}` (`RunnerDeps.appOrigin`). Template `invoice_reminders` (−7 d, due, +7 d at 09:00).


### Source index

- [packages/modules/automations/src/client.ts](../../packages/modules/automations/src/client.ts)
- [packages/modules/automations/src/contact-merge.ts](../../packages/modules/automations/src/contact-merge.ts)
- [packages/modules/automations/src/data-subject.ts](../../packages/modules/automations/src/data-subject.ts)
- [packages/modules/automations/src/domain/conditions.ts](../../packages/modules/automations/src/domain/conditions.ts)
- [packages/modules/automations/src/domain/journey.ts](../../packages/modules/automations/src/domain/journey.ts)
- [packages/modules/automations/src/domain/templates.ts](../../packages/modules/automations/src/domain/templates.ts)
- [packages/modules/automations/src/domain/timing.ts](../../packages/modules/automations/src/domain/timing.ts)
- [packages/modules/automations/src/index.ts](../../packages/modules/automations/src/index.ts)
- [packages/modules/automations/src/invoice-hooks.ts](../../packages/modules/automations/src/invoice-hooks.ts)
- [packages/modules/automations/src/journeys.ts](../../packages/modules/automations/src/journeys.ts)
- [packages/modules/automations/src/lifecycle.ts](../../packages/modules/automations/src/lifecycle.ts)
- [packages/modules/automations/src/private-columns.ts](../../packages/modules/automations/src/private-columns.ts)
- [packages/modules/automations/src/rsvp-reminders.ts](../../packages/modules/automations/src/rsvp-reminders.ts)
- [packages/modules/automations/src/runner.ts](../../packages/modules/automations/src/runner.ts)
- [packages/modules/automations/src/schema.ts](../../packages/modules/automations/src/schema.ts)
- [packages/modules/automations/src/subscribers.ts](../../packages/modules/automations/src/subscribers.ts)

## badges

Tier 5; 26 source files; 5 test files.

Declared connections: @yayatoh/checkin, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/media, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.

Source imports: @yayatoh/checkin, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/media, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui/tokens.

Tables detected: see schema source.

Event type literals detected: system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| badges.overrideBalanceDue | attendees:write | badges | [source](../../packages/modules/badges/src/balance-override.ts#L26) |
| badges.startBatch | attendees:export | badges | [source](../../packages/modules/badges/src/batches.ts#L188) |
| badges.cancelBatch | attendees:export | badges | [source](../../packages/modules/badges/src/batches.ts#L267) |
| badges.listBatches | events:read | badges | [source](../../packages/modules/badges/src/batches.ts#L302) |
| badges.batchLink | attendees:export | badges | [source](../../packages/modules/badges/src/batches.ts#L320) |
| badges.singleBadge | attendees:write | badges | [source](../../packages/modules/badges/src/batches.ts#L370) |
| badges.tickets | attendees:write | badges | [source](../../packages/modules/badges/src/batches.ts#L429) |
| badges.nextBatchChunk | dynamic or not captured | badges | [source](../../packages/modules/badges/src/batches.ts#L472) |
| badges.storeBatchChunk | dynamic or not captured | badges | [source](../../packages/modules/badges/src/batches.ts#L507) |
| badges.batchParts | dynamic or not captured | badges | [source](../../packages/modules/badges/src/batches.ts#L543) |
| badges.finishBatch | dynamic or not captured | badges | [source](../../packages/modules/badges/src/batches.ts#L559) |
| badges.failBatch | dynamic or not captured | badges | [source](../../packages/modules/badges/src/batches.ts#L590) |
| badges.kioskSettings | events:read | badges | [source](../../packages/modules/badges/src/kiosk.ts#L65) |
| badges.setKioskSettings | events:write | badges | [source](../../packages/modules/badges/src/kiosk.ts#L78) |
| badges.kioskLookup | checkin:device | badges | [source](../../packages/modules/badges/src/kiosk.ts#L209) |
| badges.kioskRequestCode | checkin:device | badges | [source](../../packages/modules/badges/src/kiosk.ts#L247) |
| badges.kioskVerifyCode | checkin:device | badges | [source](../../packages/modules/badges/src/kiosk.ts#L327) |
| badges.kioskPrint | checkin:device | badges | [source](../../packages/modules/badges/src/kiosk.ts#L406) |
| badges.kioskJobBadge | checkin:device | badges | [source](../../packages/modules/badges/src/kiosk.ts#L489) |
| badges.kioskSnapshot | checkin:device | badges | [source](../../packages/modules/badges/src/kiosk.ts#L531) |
| badges.createPrinter | events:write | badges | [source](../../packages/modules/badges/src/printing.ts#L110) |
| badges.archivePrinter | events:write | badges | [source](../../packages/modules/badges/src/printing.ts#L175) |
| badges.printingSetup | events:read | badges | [source](../../packages/modules/badges/src/printing.ts#L208) |
| badges.setPrintNode | platform:badges.printnode | null or not captured | [source](../../packages/modules/badges/src/printing.ts#L231) |
| badges.printerHeartbeat | attendees:write | badges | [source](../../packages/modules/badges/src/printing.ts#L276) |
| badges.recordPrinterStates | dynamic or not captured | badges | [source](../../packages/modules/badges/src/printing.ts#L301) |
| badges.markQuietPrinters | dynamic or not captured | badges | [source](../../packages/modules/badges/src/printing.ts#L335) |
| badges.startPrintJob | attendees:write | badges | [source](../../packages/modules/badges/src/printing.ts#L468) |
| badges.recordPrintResult | attendees:write | badges | [source](../../packages/modules/badges/src/printing.ts#L560) |
| badges.queuedJobBadge | attendees:write | badges | [source](../../packages/modules/badges/src/printing.ts#L628) |
| badges.browserJobBadge | attendees:write | badges | [source](../../packages/modules/badges/src/printing.ts#L638) |
| badges.printLog | attendees:read | badges | [source](../../packages/modules/badges/src/printing.ts#L700) |
| badges.printState | attendees:write | badges | [source](../../packages/modules/badges/src/printing.ts#L769) |
| badges.samplePreview | events:read | badges | [source](../../packages/modules/badges/src/sample.ts#L13) |
| badges.createTemplate | events:write | badges | [source](../../packages/modules/badges/src/templates.ts#L130) |
| badges.saveTemplate | events:write | badges | [source](../../packages/modules/badges/src/templates.ts#L193) |
| badges.setDefaultTemplate | events:write | badges | [source](../../packages/modules/badges/src/templates.ts#L242) |
| badges.deleteTemplate | events:write | badges | [source](../../packages/modules/badges/src/templates.ts#L265) |
| badges.assignTemplate | events:write | badges | [source](../../packages/modules/badges/src/templates.ts#L301) |
| badges.setup | events:read | badges | [source](../../packages/modules/badges/src/templates.ts#L350) |

### Feature rules and lifecycle

#### badges (tier 5)

Badge templates, their assignment to ticket types, and batch PDFs (M5.5a). Owns Postgres schema `badges`. Printers, print jobs, the print log and the `BadgePrinter` port arrived with M5.5b; kiosk self-print arrives with M5.5c. Stage 1 printing (P5-2) is the PDF itself: AirPrint or the browser's print dialog, on any printer.

**Invariants**
- Gated by the `badges` module key (every command and query) and shown only where the event's profile lists the Badges page (the conference profile).
- A template is a series of immutable versions (`template_versions.design`, a `BadgeDesign`); saving writes version n + 1 and is refused when the editor started from an older version (`stale_version`). A batch pins the versions it prints (`batches.version_map`), so an edit during a run never mixes designs.
- Positions are millimetres in logical (left-to-right) coordinates on the face; RTL badges mirror them (`placeElement`). Sizes, bleed and safe areas are fixed presets (`SIZES`, P5-2): 4×3 in fold-over (front and back on one 4×6 sheet, the back turned 180°), 4×6 in, CR80, Brother QL 62 mm and 4 in.
- One template per ticket type (`assignments`, unique per ticket type); an unassigned type prints with the event's default template (exactly one default while the event has templates; the first template is the default, and deleting the default promotes the oldest). The target is one column per binding kind with `assignments_target_check = num_nonnulls(…) = 1`: registration types (M5.1a) add `registration_type_id` additively.
- **Render allowlist:** a badge's data is built by `badgeRow` (`BadgeRow`, a strict Zod object) from the fields the template places, and nothing else. The holder's email never leaves ticketing (`badgeTicketsTx` doesn't select it). Checkout answers reach a badge only when the organizer maps a question to company or job title, and only non-sensitive free-text questions may be mapped (checked on save).
- **Badge QR = the ticket's active signed yy1 code (ADR 0011), unchanged**, so the Scan PWA reads a badge exactly as the ticket. Voided tickets are not printed (a ticket voided mid-batch is left out of its chunk).
- Ribbon colours are design tokens only (`RIBBON_COLORS`, each a fill + text pair at ≥ 4.5:1).
- Batches: `badges.startBatch` (`attendees:export`, step-up, category `export`) snapshots and sorts the selection (last name A–Z, or company A–Z with no-company last) and is idempotent per `request_key`. The worker's `badges.batch` job (exclusive per batch) renders chunks of 100 through the `PdfRenderer` port, stores each in `batch_parts` (keyed by sequence; progress moves only when the batch is still at that chunk, so retries never double-count), merges them, stores the file in the media store under `{org}/{batch}/0-{sha}.pdf`, and deletes the parts. Cancel stops it between chunks. Files expire after 7 days.
- Downloads: `badges.batchLink` signs a 15-minute link (`{org}~{batch}~{exp}~{hmac}`, APP_TOKEN_SECRET); the route serves the file only while the batch is done and unexpired.
- Writes to templates and assignments need `events:write`; previews with sample people need `events:read` (viewers can preview); the one-badge PDF needs `attendees:write`.
- Consumes no events and emits none yet.
- **Balance due (M5.1d):** a ticket with `payment_due` prints only one at a time, with `badges.overrideBalanceDue` (`attendees:write`, a reason, audited) returning a 10-minute signed permission for that ticket (`startPrintJobCommand.overrideToken`, and `singleBadgeQuery.overrideToken`); batches leave such tickets out (counted as skipped).
- **Printing (M5.5b).** Printers belong to one event (`printers`; archived, never deleted). Every print is a `print_jobs` row written before anything prints (`startPrintJobCommand`, `attendees:write`, idempotent per `request_key`); the server decides print vs reprint (any earlier job that did not fail), and a reprint needs a reprint reason (`other` needs a note): `print_jobs_kind_reason_check` ties `kind = 'print'` to `reason = 'first_print'`. A browser job's PDF opens only within 30 minutes of the job; a PrintNode job is handed over through the `BadgePrinter` port (fake in dev/CI) with the job id as idempotency key.
- **Heartbeat.** A printer goes `online` on a heartbeat (station page every 30 s, or the worker's PrintNode poll) and `offline` exactly once when the watchdog finds it silent for 90 s (`markQuietPrintersCommand`, SKIP LOCKED, only while online). PrintNode is switched on per org by platform staff (`print_settings`).
- Emits `badges.printer_offline@1` and `badges.printer_online@1` (`PrinterStatePayload`). Consumes no events.


### Source index

- [packages/modules/badges/src/balance-override.ts](../../packages/modules/badges/src/balance-override.ts)
- [packages/modules/badges/src/batches.ts](../../packages/modules/badges/src/batches.ts)
- [packages/modules/badges/src/client.ts](../../packages/modules/badges/src/client.ts)
- [packages/modules/badges/src/data-subject.ts](../../packages/modules/badges/src/data-subject.ts)
- [packages/modules/badges/src/domain/content.ts](../../packages/modules/badges/src/domain/content.ts)
- [packages/modules/badges/src/domain/design.ts](../../packages/modules/badges/src/domain/design.ts)
- [packages/modules/badges/src/domain/kiosk.ts](../../packages/modules/badges/src/domain/kiosk.ts)
- [packages/modules/badges/src/domain/layout.ts](../../packages/modules/badges/src/domain/layout.ts)
- [packages/modules/badges/src/domain/names.ts](../../packages/modules/badges/src/domain/names.ts)
- [packages/modules/badges/src/domain/printing.ts](../../packages/modules/badges/src/domain/printing.ts)
- [packages/modules/badges/src/domain/ribbons.ts](../../packages/modules/badges/src/domain/ribbons.ts)
- [packages/modules/badges/src/domain/row.ts](../../packages/modules/badges/src/domain/row.ts)
- [packages/modules/badges/src/domain/samples.ts](../../packages/modules/badges/src/domain/samples.ts)
- [packages/modules/badges/src/domain/sizes.ts](../../packages/modules/badges/src/domain/sizes.ts)
- [packages/modules/badges/src/domain/sort.ts](../../packages/modules/badges/src/domain/sort.ts)
- [packages/modules/badges/src/domain/text.ts](../../packages/modules/badges/src/domain/text.ts)
- [packages/modules/badges/src/index.ts](../../packages/modules/badges/src/index.ts)
- [packages/modules/badges/src/kiosk.ts](../../packages/modules/badges/src/kiosk.ts)
- [packages/modules/badges/src/link.ts](../../packages/modules/badges/src/link.ts)
- [packages/modules/badges/src/printer-port.ts](../../packages/modules/badges/src/printer-port.ts)
- [packages/modules/badges/src/printing.ts](../../packages/modules/badges/src/printing.ts)
- [packages/modules/badges/src/private-columns.ts](../../packages/modules/badges/src/private-columns.ts)
- [packages/modules/badges/src/render.ts](../../packages/modules/badges/src/render.ts)
- [packages/modules/badges/src/sample.ts](../../packages/modules/badges/src/sample.ts)
- [packages/modules/badges/src/schema.ts](../../packages/modules/badges/src/schema.ts)
- [packages/modules/badges/src/templates.ts](../../packages/modules/badges/src/templates.ts)

## billing

Tier 1; 25 source files; 9 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: billing.agency_billing_ended, billing.agency_billing_offered, billing.agency_billing_started, billing.agency_billing_withdrawn, billing.customer_linked, billing.entitlements_synced, billing.subscription_changed, customer.subscription.updated, entitlements.active_entitlement_summary.updated, entitlements.changed, system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| billing.offerAgencyBilling | billing:manage | agency | [source](../../packages/modules/billing/src/agency-billing.ts#L87) |
| billing.withdrawAgencyBillingOffer | billing:manage | null or not captured | [source](../../packages/modules/billing/src/agency-billing.ts#L140) |
| billing.agencyBilledClients | agency:read | agency | [source](../../packages/modules/billing/src/agency-billing.ts#L189) |
| billing.clientAgencyBilling | members:read | null or not captured | [source](../../packages/modules/billing/src/agency-billing.ts#L260) |
| billing.acceptAgencyBilling | billing:manage | null or not captured | [source](../../packages/modules/billing/src/agency-billing.ts#L288) |
| billing.endAgencyBilling | billing:manage | null or not captured | [source](../../packages/modules/billing/src/agency-billing.ts#L366) |
| billing.setAgencyCommission | platform:entitlements.manage | null or not captured | [source](../../packages/modules/billing/src/agency-billing.ts#L383) |
| billing.setNonprofitDiscount | platform:entitlements.manage | null or not captured | [source](../../packages/modules/billing/src/discount.ts#L50) |
| billing.markDiscountPushed | platform:billing.link | null or not captured | [source](../../packages/modules/billing/src/discount.ts#L70) |
| billing.standing | org:read | null or not captured | [source](../../packages/modules/billing/src/dunning.ts#L97) |
| billing.setEntitlementOverride | platform:entitlements.manage | null or not captured | [source](../../packages/modules/billing/src/entitlements.ts#L87) |
| billing.getEntitlements | org:read | null or not captured | [source](../../packages/modules/billing/src/entitlements.ts#L126) |
| billing.feeSchedule | org:read | null or not captured | [source](../../packages/modules/billing/src/fees.ts#L60) |
| billing.setFeeOverride | platform:entitlements.manage | null or not captured | [source](../../packages/modules/billing/src/fees.ts#L75) |
| billing.usageSummary | billing:read | null or not captured | [source](../../packages/modules/billing/src/meters.ts#L138) |
| billing.markUsageReported | platform:billing.meter | null or not captured | [source](../../packages/modules/billing/src/meters.ts#L219) |
| billing.planChangeOptions | billing:read | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L169) |
| billing.manageCheck | billing:manage | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L179) |
| billing.subscriptionHint | billing:read | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L242) |
| billing.changePlan | billing:manage | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L270) |
| billing.recordPlanChangeOutcome | platform:billing.link | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L345) |
| billing.payOutstanding | billing:manage | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L422) |
| billing.lastSubscription | platform:billing.link | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L457) |
| billing.planChangeHistory | billing:read | null or not captured | [source](../../packages/modules/billing/src/plan-change.ts#L506) |
| billing.planSummary | billing:read | null or not captured | [source](../../packages/modules/billing/src/plan-page.ts#L64) |
| billing.applyProviderEvent | platform:billing.webhook | null or not captured | [source](../../packages/modules/billing/src/subscriptions.ts#L56) |
| billing.linkCustomer | platform:billing.link | null or not captured | [source](../../packages/modules/billing/src/subscriptions.ts#L178) |
| billing.setLegacyFees | platform:entitlements.manage | null or not captured | [source](../../packages/modules/billing/src/subscriptions.ts#L223) |
| billing.account | platform:billing.link | null or not captured | [source](../../packages/modules/billing/src/subscriptions.ts#L259) |

### Feature rules and lifecycle

#### billing (tier 1)

Plans and entitlements (roadmap §4.5, ADR 0013). Owns Postgres schema `billing`.

**Invariants**
- `billing.plans` and `billing.plan_modules` are global reference data: readable by `app_user`, written only by migrations.
- Every org is on `launch_standard` unless `org_plans` says otherwise. `org_plans` is the plan whose fee schedule applies; a subscription moves it unless the org's legacy fees are grandfathered (M6.6a).
- `effective(org) = (base ∪ active grants) − active revokes`, where base is the plan's modules, or, with billing switched on (`BILLING_ENABLED`) and a live subscription whose entitlements the provider synced, those entitlements plus `core`. With billing off it is exactly the plan modules.
- Code checks module keys, never plan names.
- Overrides are platform actions (`platform:entitlements.manage`), audited, and take effect without a deploy.

**Subscription billing (M6.6a, dormant)**
- Everything that talks to the billing provider goes through `BillingProvider` (fake in dev/CI; Stripe only behind the port, never from tests). `BILLING_ENABLED` unset = off: the webhook is a 404 and modules never read subscription data.
- The plan catalog (`plan_catalog`, `plan_prices`, `features`) is global reference data: migrations seed it and only `billing.apply_catalog` (platform_reader, the worker's catalog sync) writes it. `launch_standard` is never sold or synced.
- Provider webhooks are verified on the raw body, deduplicated by provider event id (`provider_events`) and ordered by the provider's event time; only the system applies them (`billing.applyProviderEvent`).
- The plan page reads only `PlanSummaryDto` (no provider, customer or event ids).

**Meters, plan changes and dunning (M6.6b, dormant)**
- Usage comes only from outbox events (`messaging.usage_metered`, `ai.credits_spent`/`_refunded`, `device.enrolled`); one `usage_records` row per (event, meter), so a replayed event never counts twice. A record is marked reported only after the provider's meter accepted it (its id is the provider's identifier).
- A plan change is recorded (`plan_changes`, Idempotency-Key) and sent to the provider; only the provider's webhook moves the subscription, the fee plan and the modules. A change that turns modules off needs the organizer's confirmation; their data is never touched.
- Dunning never deletes anything. A failed renewal gives a grace period; after it, or once the provider gives up, the org's members and API keys are read-only (`read_only_billing`) until it pays. Buyers, guests, portals, devices and the platform are never refused; reads, exports, paying, changing the plan and door scans always work. With billing off the gate reads nothing.
- The nonprofit coupon comes from a verified charity profile (outbox) or a staff flag (audited); billing never reads the charity module's tables.
- **Agency billing (M6.8a, behind the platform switch `agency_v2` that M6.8b's operations share: `agencyV2EnabledTx`, `platform.flag_enabled('agency_v2')`):** the agency's offer (`agency_billing_offers`, owned by the agency) and the client's acceptance (`agency_billing`, owned by the client, one live row, `commission_bps` fixed per row, staff change it). In force only while the grant is live, the offer stands, the agency has `agency` and the flag is on (`billing.agency_billing_active()`); then the agency's plan modules join the client's effective modules (`billing.agency_cover_modules()`, never `agency`, nothing while the agency is read-only). Cross-org reads only through SECURITY DEFINER functions with the org from the transaction. Accepting needs `billing:manage` and step-up; agency roles never hold `billing:*`.


### Source index

- [packages/modules/billing/src/addons.ts](../../packages/modules/billing/src/addons.ts)
- [packages/modules/billing/src/agency-billing.ts](../../packages/modules/billing/src/agency-billing.ts)
- [packages/modules/billing/src/catalog-sync.ts](../../packages/modules/billing/src/catalog-sync.ts)
- [packages/modules/billing/src/catalog.ts](../../packages/modules/billing/src/catalog.ts)
- [packages/modules/billing/src/discount.ts](../../packages/modules/billing/src/discount.ts)
- [packages/modules/billing/src/dunning-rules.ts](../../packages/modules/billing/src/dunning-rules.ts)
- [packages/modules/billing/src/dunning.ts](../../packages/modules/billing/src/dunning.ts)
- [packages/modules/billing/src/entitlements.ts](../../packages/modules/billing/src/entitlements.ts)
- [packages/modules/billing/src/fees.ts](../../packages/modules/billing/src/fees.ts)
- [packages/modules/billing/src/index.ts](../../packages/modules/billing/src/index.ts)
- [packages/modules/billing/src/meters.ts](../../packages/modules/billing/src/meters.ts)
- [packages/modules/billing/src/plan-change.ts](../../packages/modules/billing/src/plan-change.ts)
- [packages/modules/billing/src/plan-page.ts](../../packages/modules/billing/src/plan-page.ts)
- [packages/modules/billing/src/pricing.ts](../../packages/modules/billing/src/pricing.ts)
- [packages/modules/billing/src/private-columns.ts](../../packages/modules/billing/src/private-columns.ts)
- [packages/modules/billing/src/provider/config.ts](../../packages/modules/billing/src/provider/config.ts)
- [packages/modules/billing/src/provider/fake.ts](../../packages/modules/billing/src/provider/fake.ts)
- [packages/modules/billing/src/provider/flag.ts](../../packages/modules/billing/src/provider/flag.ts)
- [packages/modules/billing/src/provider/port.ts](../../packages/modules/billing/src/provider/port.ts)
- [packages/modules/billing/src/provider/proration.ts](../../packages/modules/billing/src/provider/proration.ts)
- [packages/modules/billing/src/provider/stripe.ts](../../packages/modules/billing/src/provider/stripe.ts)
- [packages/modules/billing/src/schema.ts](../../packages/modules/billing/src/schema.ts)
- [packages/modules/billing/src/subscriptions.ts](../../packages/modules/billing/src/subscriptions.ts)
- [packages/modules/billing/src/testing.ts](../../packages/modules/billing/src/testing.ts)
- [packages/modules/billing/src/webhook.ts](../../packages/modules/billing/src/webhook.ts)

## campaigns

Tier 6; 16 source files; 1 test files.

Declared connections: @yayatoh/audiences, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/notifications, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.

Source imports: @yayatoh/audiences, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/notifications, @yayatoh/notifications/merge, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui/tokens.

Tables detected: see schema source.

Event type literals detected: button, footer, heading, system, text.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| campaigns.createCampaign | marketing:write | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L98) |
| campaigns.saveCampaign | marketing:write | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L150) |
| campaigns.setAudience | marketing:write | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L188) |
| campaigns.deleteCampaign | marketing:write | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L227) |
| campaigns.listCampaigns | marketing:read | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L244) |
| campaigns.campaignNames | marketing:read | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L296) |
| campaigns.getCampaign | marketing:read | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L306) |
| campaigns.postalAddress | marketing:read | marketing | [source](../../packages/modules/campaigns/src/campaigns.ts#L337) |
| campaigns.campaignResults | marketing:read | marketing | [source](../../packages/modules/campaigns/src/results.ts#L79) |
| campaigns.campaignPreview | marketing:read | marketing | [source](../../packages/modules/campaigns/src/results.ts#L96) |
| campaigns.estimateReach | marketing:read | marketing | [source](../../packages/modules/campaigns/src/send.ts#L124) |
| campaigns.testSend | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L239) |
| campaigns.sendNow | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L372) |
| campaigns.scheduleCampaign | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L391) |
| campaigns.unscheduleCampaign | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L425) |
| campaigns.pauseCampaign | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L439) |
| campaigns.resumeCampaign | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L452) |
| campaigns.cancelCampaign | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L470) |
| campaigns.startScheduled | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L494) |
| campaigns.releaseChunk | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L541) |
| campaigns.finalizeCampaign | messages:send | marketing | [source](../../packages/modules/campaigns/src/send.ts#L620) |

### Feature rules and lifecycle

#### campaigns (tier 6)

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


### Source index

- [packages/modules/campaigns/src/campaigns.ts](../../packages/modules/campaigns/src/campaigns.ts)
- [packages/modules/campaigns/src/client.ts](../../packages/modules/campaigns/src/client.ts)
- [packages/modules/campaigns/src/contact-merge.ts](../../packages/modules/campaigns/src/contact-merge.ts)
- [packages/modules/campaigns/src/data-subject.ts](../../packages/modules/campaigns/src/data-subject.ts)
- [packages/modules/campaigns/src/domain/blocks.ts](../../packages/modules/campaigns/src/domain/blocks.ts)
- [packages/modules/campaigns/src/domain/lifecycle.ts](../../packages/modules/campaigns/src/domain/lifecycle.ts)
- [packages/modules/campaigns/src/domain/render.ts](../../packages/modules/campaigns/src/domain/render.ts)
- [packages/modules/campaigns/src/domain/scheduler.ts](../../packages/modules/campaigns/src/domain/scheduler.ts)
- [packages/modules/campaigns/src/dto.ts](../../packages/modules/campaigns/src/dto.ts)
- [packages/modules/campaigns/src/index.ts](../../packages/modules/campaigns/src/index.ts)
- [packages/modules/campaigns/src/private-columns.ts](../../packages/modules/campaigns/src/private-columns.ts)
- [packages/modules/campaigns/src/results.ts](../../packages/modules/campaigns/src/results.ts)
- [packages/modules/campaigns/src/schema.ts](../../packages/modules/campaigns/src/schema.ts)
- [packages/modules/campaigns/src/send.ts](../../packages/modules/campaigns/src/send.ts)
- [packages/modules/campaigns/src/tick.ts](../../packages/modules/campaigns/src/tick.ts)
- [packages/modules/campaigns/src/timeline.ts](../../packages/modules/campaigns/src/timeline.ts)

## ce

Tier 5; 9 source files; 1 test files.

Declared connections: @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui, @yayatoh/virtual.

Source imports: @yayatoh/checkin, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/pdf, @yayatoh/platform, @yayatoh/program, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui/tokens, @yayatoh/virtual.

Tables detected: see schema source.

Event type literals detected: ce.certificate_issued, ce.certificate_revoked, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| ce.setup | events:read | virtual | [source](../../packages/modules/ce/src/certificates.ts#L84) |
| ce.setSettings | events:write | virtual | [source](../../packages/modules/ce/src/certificates.ts#L162) |
| ce.setSessionRule | events:write | virtual | [source](../../packages/modules/ce/src/certificates.ts#L195) |
| ce.removeSessionRule | events:write | virtual | [source](../../packages/modules/ce/src/certificates.ts#L235) |
| ce.calculate | events:write | virtual | [source](../../packages/modules/ce/src/certificates.ts#L332) |
| ce.certificateDocument | events:read | virtual | [source](../../packages/modules/ce/src/certificates.ts#L582) |
| ce.verify | public:ce | virtual | [source](../../packages/modules/ce/src/certificates.ts#L623) |
| ce.certificateLinks | public:ce | virtual | [source](../../packages/modules/ce/src/certificates.ts#L658) |

### Feature rules and lifecycle

#### ce (tier 5)

CE (continuing education) credits and certificates (M6.9b, decision P6-9). Owns Postgres schema
`ce`: `settings`, `session_rules`, `certificates` and `awards`. Attendance comes from lower tiers
through their exports: session door visits from `checkin` (tier 4), heartbeat watch minutes and
Zoom attendance from `virtual` (tier 4), holders from `ticketing`, order languages from `orders`.
The composite FKs to `events.events`, `program.sessions` and `ticketing.tickets` are hand-written
in the migration (cascade on delete). Entitlement `virtual` (P6-13).

**Invariants**
- **A rule per session**: credits in hundredths (1–10 000), a minimum of 1–1440 minutes, and which
  attendance counts (in person, online, or both; at least one). Reads `events:read`, changes
  `events:write`.
- **Minutes are minute buckets** (`domain/credits.ts`, pure): a visit (scan in → out; never scanned
  out: until the session ends) and a Zoom segment count every UTC minute they overlap; a watched
  minute is its own bucket; everything is clipped to the session's window; a bucket counts once
  whatever covers it. A session qualifies at its minimum; a certificate totals its qualifying
  sessions. Only ended sessions count.
- **Exactly reproducible**: the awards store the minutes and credits each certificate was computed
  from; the document (`certificate-document.ts`) is built only from them, the settings and the
  `legal-copy` file (`legal/certificate-copy.ts`, placeholder wording pending counsel).
- **Idempotent calculation** (`ce.calculate`, the settings row is the lock): the same inputs change
  nothing (content hash) and send nothing; a different result is a new revision; a ticket with no
  qualifying session left (or voided) has its certificate withdrawn (`revoked`, verifiable as
  such). One certificate per ticket; codes are unique per org (`XXXXX-XXXXX`, Crockford, 50 bits).
- **Below the threshold, no certificate.** Events: `ce.certificate_issued@1`,
  `ce.certificate_revoked@1` (ids and the revision). `ce.certificate-mailer` emails the holder
  once per revision (`ce.certificate`), with the signed PDF link (`ce.certificate` token).
- **Public verification** (`public:ce`) by org and code: status, a masked name (first name and an
  initial), event, organizer, credits and dates. Never the address, the ticket or the full name.
- Certificates speak the order's language (13 locales, Arabic right to left); dates in the event's
  timezone.


### Source index

- [packages/modules/ce/src/certificate-document.ts](../../packages/modules/ce/src/certificate-document.ts)
- [packages/modules/ce/src/certificates.ts](../../packages/modules/ce/src/certificates.ts)
- [packages/modules/ce/src/data-subject.ts](../../packages/modules/ce/src/data-subject.ts)
- [packages/modules/ce/src/domain/credits.ts](../../packages/modules/ce/src/domain/credits.ts)
- [packages/modules/ce/src/dto.ts](../../packages/modules/ce/src/dto.ts)
- [packages/modules/ce/src/index.ts](../../packages/modules/ce/src/index.ts)
- [packages/modules/ce/src/legal/certificate-copy.ts](../../packages/modules/ce/src/legal/certificate-copy.ts)
- [packages/modules/ce/src/private-columns.ts](../../packages/modules/ce/src/private-columns.ts)
- [packages/modules/ce/src/schema.ts](../../packages/modules/ce/src/schema.ts)

## checkin

Tier 4; 33 source files; 4 test files.

Declared connections: @yayatoh/attendees, @yayatoh/checkin-engine, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticket-crypto, @yayatoh/ticketing.

Source imports: @yayatoh/attendees, @yayatoh/checkin-engine, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticket-crypto, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: checkin.duplicate_offline, checkin.fraud_signal, checkin.session_attended, checkin.session_left, contact, device, device.state_changed, event, http, order, system, thread, ticket, ticket.admission_moved, ticket.admission_undone, ticket.admitted, user.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| checkin.admitBalanceDue | checkin:scan | checkin | [source](../../packages/modules/checkin/src/balance-override.ts#L20) |
| checkin.createCheckpoint | dynamic or not captured | null or not captured | [source](../../packages/modules/checkin/src/checkpoints.ts#L55) |
| checkin.setCheckpointArchived | events:write | checkin | [source](../../packages/modules/checkin/src/checkpoints.ts#L136) |
| checkin.listCheckpoints | checkin:scan | checkin | [source](../../packages/modules/checkin/src/checkpoints.ts#L158) |
| checkin.enrollDevice | checkin:scan | checkin | [source](../../packages/modules/checkin/src/devices.ts#L132) |
| checkin.setDeviceState | checkin:scan | checkin | [source](../../packages/modules/checkin/src/devices.ts#L171) |
| checkin.heartbeat | checkin:device | checkin | [source](../../packages/modules/checkin/src/devices.ts#L195) |
| checkin.deviceManifest | checkin:device | checkin | [source](../../packages/modules/checkin/src/devices.ts#L418) |
| checkin.syncScans | checkin:device | checkin | [source](../../packages/modules/checkin/src/devices.ts#L601) |
| checkin.listDevices | checkin:scan | checkin | [source](../../packages/modules/checkin/src/devices.ts#L922) |
| checkin.guestSnapshot | checkin:device | checkin | [source](../../packages/modules/checkin/src/guest-checkin.ts#L122) |
| checkin.recordGuestArrivals | checkin:device | checkin | [source](../../packages/modules/checkin/src/guest-checkin.ts#L215) |
| checkin.markGuestsArrived | checkin:scan | checkin | [source](../../packages/modules/checkin/src/guest-checkin.ts#L257) |
| checkin.undoGuestArrival | checkin:scan | checkin | [source](../../packages/modules/checkin/src/guest-checkin.ts#L300) |
| checkin.dayOf | guests:read | checkin | [source](../../packages/modules/checkin/src/guest-checkin.ts#L374) |
| checkin.reportPresence | checkin:scan | checkin | [source](../../packages/modules/checkin/src/live.ts#L80) |
| checkin.scanTicket | checkin:scan | checkin | [source](../../packages/modules/checkin/src/scan.ts#L77) |
| checkin.undoAdmission | checkin:scan | checkin | [source](../../packages/modules/checkin/src/scan.ts#L303) |
| checkin.status | checkin:scan | checkin | [source](../../packages/modules/checkin/src/scan.ts#L391) |
| checkin.admitSessionOverride | checkin:scan | checkin | [source](../../packages/modules/checkin/src/session-checkin.ts#L27) |
| checkin.setSelfCheckin | events:write | checkin | [source](../../packages/modules/checkin/src/session-checkin.ts#L106) |
| checkin.sessionDoorChoices | events:write | checkin | [source](../../packages/modules/checkin/src/session-checkin.ts#L146) |
| checkin.sessionAttendance | checkin:scan | checkin | [source](../../packages/modules/checkin/src/session-checkin.ts#L192) |
| checkin.selfCheckinPage | public:self_checkin | checkin | [source](../../packages/modules/checkin/src/session-checkin.ts#L300) |
| checkin.selfCheckIn | public:self_checkin | checkin | [source](../../packages/modules/checkin/src/session-checkin.ts#L332) |
| checkin.listFraudSignals | checkin:scan | checkin | [source](../../packages/modules/checkin/src/signals.ts#L347) |
| checkin.resolveFraudSignal | events:write | checkin | [source](../../packages/modules/checkin/src/signals.ts#L381) |
| checkin.orderSignals | orders:read | checkin | [source](../../packages/modules/checkin/src/signals.ts#L433) |
| checkin.detectionSettings | checkin:scan | checkin | [source](../../packages/modules/checkin/src/signals.ts#L484) |
| checkin.setDetectionSettings | events:write | checkin | [source](../../packages/modules/checkin/src/signals.ts#L505) |
| checkin.staffOverview | checkin:device | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L216) |
| checkin.supervisorView | checkin:kiosk | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L266) |
| checkin.requestDeviceSync | checkin:supervise | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L348) |
| checkin.switchDeviceCheckpoint | checkin:supervise | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L371) |
| checkin.revokeDevice | checkin:supervise | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L401) |
| checkin.startKiosk | checkin:kiosk | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L461) |
| checkin.stopKiosk | checkin:kiosk | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L528) |
| checkin.exitKiosk | checkin:device | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L556) |
| checkin.subscribeStaffPush | checkin:device | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L688) |
| checkin.unsubscribeStaffPush | checkin:device | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L721) |
| checkin.staffPushStatus | checkin:device | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L734) |
| checkin.claimStaffPush | checkin:supervise | checkin | [source](../../packages/modules/checkin/src/staff-mode.ts#L756) |
| checkin.doorStaff | events:read | checkin | [source](../../packages/modules/checkin/src/staff.ts#L80) |
| checkin.setDoorStaff | members:manage | checkin | [source](../../packages/modules/checkin/src/staff.ts#L105) |
| checkin.removeDoorStaff | members:manage | checkin | [source](../../packages/modules/checkin/src/staff.ts#L144) |
| checkin.myScanScope | checkin:scan | checkin | [source](../../packages/modules/checkin/src/staff.ts#L165) |
| checkin.virtualCheckpoints | events:read | checkin | [source](../../packages/modules/checkin/src/virtual-attendance.ts#L97) |

### Feature rules and lifecycle

#### checkin (tier 4)

Admissions and the scan log. Owns Postgres schema `checkin`.

**Invariants**
- A code is either a yy1 code (Ed25519-verified with the org's public keys; the ticket's current `rev` must match) or a ticket short code. Anything else is `invalid`.
- Rules, in order: known ticket → this event (`wrong_event`, and nothing about the other event's ticket is returned) → not void → inside the event window (6 h before start to 6 h after end) → today (event timezone) is one of the pass's access dates, if it has any.
- One live admission per ticket per event day (partial unique index). A second scan is `duplicate`, with the first admission time. Undo marks the admission undone (never deletes it), which allows a fresh admission.
- Every attempt is appended to `scans`. `client_scan_id` makes a scanner's retries idempotent: a retried scan returns its first outcome, not a duplicate.
- Offline scanning (manifest + sync, roadmap §5.4): first-wins by corrected device time; losers become `duplicate_offline`.
- Checkpoints belong to one event. An entrance admits (the per-day admission rule is unchanged, and the entrance is recorded). A zone never admits: it returns `granted`/`no_access` from its ticket-type list (empty = all), after the event rules.
- Fraud signals are rows (only their triage status changes) plus a `checkin.fraud_signal@1` event, raised in the scan transaction: `two_entrances` (another entrance within 5 min of admission), `invalid_burst` (the 5th invalid code from one scanner within 60 s, once per burst).
- Checkpoint scope (M1.9d): a `door_staff` (or `session_scanner`) assignment may list checkpoints (`events.event_role_assignments.checkpoint_ids`, validated here: live checkpoints of the same event; empty = the whole event). A member whose org role scans (owner, admin, manager, box office, scanner) is never scoped. A scoped scanner, or a device handed to one (`devices.assigned_user_id`), gets `wrong_checkpoint` anywhere else, including "whole event"; the refusal names no ticket and admits nobody. The server decides from the scope as it is at scan/sync time.
- Manifest v2: the header lists only the device's checkpoints and carries `scope` signed with the org's ticket key (`checkin-scope-v1` statement tag); devices refuse a manifest whose scope doesn't verify. v1 snapshots keep working offline and are refetched in full on the next sync. A device handed to someone with no role at the event gets 403.
- Velocity signals (M1.9d) are computed by `checkin-engine`'s `detectVelocity` over the scan log after every online scan and every synced batch (corrected time): `device_velocity` (> N scans in 60 s per device or signed-in scanner, N per event, default 40), `rejected_burst` (8 refused in 2 min), `impossible_travel` (two successful scans of one ticket at located checkpoints ≥ 50 m apart, faster than the event's km/h, within 30 min). Re-running over the same log raises nothing twice.
- Every signal stores its severity (`FRAUD_SEVERITY`) and a status: open → acknowledged | dismissed (`events:write`, audited, once). The door screen shows open ones; the fraud list shows all. Signal details leave through an allowlist of numbers only.
- **Dates (M1.4b):** a ticket for one date of a multi-date event is admitted only from 6 h before to 6 h after that date, never on a cancelled date (`wrong_date`, online and offline; the manifest header lists the dates).
- **One fraud-signal model (M1.9e).** `fraud_signals` also holds signals raised by outbox subscribers here: checkout risk outcomes (`order.risk_flagged@1` → `purchase_velocity` | `country_mismatch` on the order; `order.checkout_blocked@1` → `card_testing` | `checkout_blocked`, one per buyer and event per hour) and chat reports the organizer filed (`messaging.report_filed@1` → `chat_abuse` about the contact, severity by reason; contact reports raise nothing). Each has a `source` (`checkin` | `checkout` | `chat`) and the `source_event_id` that raised it (unique: once per event). Only chat signals may lack an event (a conversation with no event). The door screen shows `checkin` signals only.
- Every new signal, from any source, is announced as `checkin.fraud_signal@1`; `checkin.fraud-alerts` alerts the security team (`security.fraud_signal`: owner, admin, manager) for **high** ones only, at most once per subject (ticket > order > contact > thread > device > user > event) and event per hour (`alerted_at`, under an advisory lock on the subject).
- Triage (`checkin.resolveFraudSignal`, `events:write`): a dismissal needs a note (3–500), an acknowledgement may carry one; the note is stored and audited. Org-level signals are resolved without an event (org roles only).
- The door sees only a count: scans (online and each synced batch result) carry `openSignals`, the open **high** signals about the ticket or its order; nothing when the scan describes no ticket.
- Offline manifests carry migrated tickets' legacy QR payloads only as `legacyPayloadHash(salt, payload)` (case-sensitive, domain-separated from the email hash); sync resolves legacy payloads (raw code, case-sensitive) before short codes, like online scans.
- **Live check-ins (M3.1b):** an online admission, an undo, and a synced batch that admitted anyone each publish one `admission` message to the event's `event.checkins` realtime channel inside the command's transaction (delivered only on commit). The payload is the change, checkpoint, count and time — never a ticket, code or holder.
- **Staff mode (M3.4a):** devices report their event and checkpoint by heartbeat (unknown ones ignored); the heartbeat hands back supervisor directives (sync now, switch checkpoint, kiosk) that devices apply once by request time. Supervisor commands (`checkin:supervise`: sync, switch, revoke with step-up) and kiosk commands (`checkin:kiosk`) act only on devices at that event or not yet at any, are audited, and poke the device over `event.devices` (`command`, ids only). The kiosk PIN is stored and delivered only as a PBKDF2 hash, never audited. `syncScans` holds a per-event advisory lock (no deadlocks between devices, each `scanId` applied once).
- **Staff alerts:** `StaffAlertSource` is a port (stub `derivedStaffAlerts`; M3.2b plugs in its engine at the composition roots). `checkin.staff-alerts` queues each alert once per subscribed device per episode (`staff_alert_pushes` unique key); device alerts only for a subscription a supervisor claimed (re-checked each time), never about the device itself. The subscription stores the device's own notification text (plain, validated); the server fills `{label}`/`{percent}`/`{count}` only.
- **Live mode (M3.3a):** a scan a device sends online is recorded with its `device_id` (speed per device, "last scan"). Scans nobody was let in by publish a value-free `scan {outcome, checkpointId, count, at}` ping on `event.checkins` (the live feed re-reads). `device_events` (append-only for the app) records a device's transitions: back online (a heartbeat after the offline window), battery dropping to low, revoked or wiped, and going quiet (`markQuietDevicesTx`, run by the live watchdog, dated when it crossed the line, once per silence). `staff_presence` is one row per member per event (door screen pings every 30 s; the heartbeat of a device handed to a member); a row counts for 2 minutes (`presenceActive`). `checkpoints.capacity` is optional per area. Live reads return counts, outcomes and staff labels only: never a code, ticket holder or buyer; the duplicate/invalid monitor names the ticket's order through ticketing's own read.
- **Balance due (M5.1d):** a ticket sold on an invoice with a balance (`tickets.payment_due`) scans as `balance_due` at an entrance (zones still answer granted/no_access); `checkin.admitBalanceDue` (`checkin:scan`, reason 3–300, audited on the ticket, allowed during a freeze) admits it with `admissions.balance_override`. Offline manifests don't carry the flag yet.
- **Session doors (M5.6a):** a checkpoint of kind `session` names a program session. A scan there records a visit in `session_attendance` (never an event admission), after the event rules, behind three gates in order: `enrollment` (a registrant, and enrolled when the session is optional with a capacity, P5-9; result `not_enrolled`), `admission_level` (the pass's items give the session) and `capacity` (open door visits ≥ the door's number, else the room's). `direction: out` closes the open visit (`scanned_out`, dwell) or is `not_in_room`; a second scan in is `duplicate`. One open visit per ticket and session; every decision runs under a per-session advisory lock. Registration (a higher tier) answers who is registered/enrolled through the `SessionAccessSource` port each composition root registers (`setSessionAccessSource`); without it session doors fail closed.
- **Overrides:** `checkin.admitSessionOverride` (`checkin:scan`, online) waives only the named gates that actually refuse, records them and the reason on the visit (`source = override`) and audits `checkin.session_override` on the ticket. Nothing to waive is `nothing_to_override`.
- **Offline (manifest v3):** the signed scope also signs each session door's gates (capacity, enrollment required, enrolled ticket ids); rows carry the pass's session access. On sync the room count is the device's call (a device refusal records nothing; an admit past a full room is kept); the other gates are re-checked; a device that refused at any gate records no visit.
- **Self check-in flyers:** `self_checkin_token` on a session door (`checkin.setSelfCheckin`, a new token each time it is turned on). The public page resolves the org through `checkin.self_checkin_door` (definer) and checks in by ticket/badge code: attendance only (`source = self`), no gates, no seat, once per visit, open 30 min before the start until the end; the page shows the session and event only.
- **Events:** `checkin.session_attended@1`, `checkin.session_left@1` (ids, times, dwell).



### Source index

- [packages/modules/checkin/src/assistance-support.ts](../../packages/modules/checkin/src/assistance-support.ts)
- [packages/modules/checkin/src/balance-override.ts](../../packages/modules/checkin/src/balance-override.ts)
- [packages/modules/checkin/src/ce-facts.ts](../../packages/modules/checkin/src/ce-facts.ts)
- [packages/modules/checkin/src/checkpoints.ts](../../packages/modules/checkin/src/checkpoints.ts)
- [packages/modules/checkin/src/conference-facts.ts](../../packages/modules/checkin/src/conference-facts.ts)
- [packages/modules/checkin/src/contact-merge.ts](../../packages/modules/checkin/src/contact-merge.ts)
- [packages/modules/checkin/src/daily-facts.ts](../../packages/modules/checkin/src/daily-facts.ts)
- [packages/modules/checkin/src/data-subject.ts](../../packages/modules/checkin/src/data-subject.ts)
- [packages/modules/checkin/src/device-actor.ts](../../packages/modules/checkin/src/device-actor.ts)
- [packages/modules/checkin/src/devices.ts](../../packages/modules/checkin/src/devices.ts)
- [packages/modules/checkin/src/dsar.ts](../../packages/modules/checkin/src/dsar.ts)
- [packages/modules/checkin/src/fraud-rules.ts](../../packages/modules/checkin/src/fraud-rules.ts)
- [packages/modules/checkin/src/fraud-sources.ts](../../packages/modules/checkin/src/fraud-sources.ts)
- [packages/modules/checkin/src/guest-checkin.ts](../../packages/modules/checkin/src/guest-checkin.ts)
- [packages/modules/checkin/src/index.ts](../../packages/modules/checkin/src/index.ts)
- [packages/modules/checkin/src/kiosk-device.ts](../../packages/modules/checkin/src/kiosk-device.ts)
- [packages/modules/checkin/src/live.ts](../../packages/modules/checkin/src/live.ts)
- [packages/modules/checkin/src/network-chat-signals.ts](../../packages/modules/checkin/src/network-chat-signals.ts)
- [packages/modules/checkin/src/occurrence.ts](../../packages/modules/checkin/src/occurrence.ts)
- [packages/modules/checkin/src/private-columns.ts](../../packages/modules/checkin/src/private-columns.ts)
- [packages/modules/checkin/src/routes.ts](../../packages/modules/checkin/src/routes.ts)
- [packages/modules/checkin/src/scan.ts](../../packages/modules/checkin/src/scan.ts)
- [packages/modules/checkin/src/schema.ts](../../packages/modules/checkin/src/schema.ts)
- [packages/modules/checkin/src/session-checkin.ts](../../packages/modules/checkin/src/session-checkin.ts)
- [packages/modules/checkin/src/session-doors.ts](../../packages/modules/checkin/src/session-doors.ts)
- [packages/modules/checkin/src/signals.ts](../../packages/modules/checkin/src/signals.ts)
- [packages/modules/checkin/src/staff-alerts.ts](../../packages/modules/checkin/src/staff-alerts.ts)
- [packages/modules/checkin/src/staff-mode.ts](../../packages/modules/checkin/src/staff-mode.ts)
- [packages/modules/checkin/src/staff.ts](../../packages/modules/checkin/src/staff.ts)
- [packages/modules/checkin/src/stats.ts](../../packages/modules/checkin/src/stats.ts)
- [packages/modules/checkin/src/testing.ts](../../packages/modules/checkin/src/testing.ts)
- [packages/modules/checkin/src/timeline.ts](../../packages/modules/checkin/src/timeline.ts)
- [packages/modules/checkin/src/virtual-attendance.ts](../../packages/modules/checkin/src/virtual-attendance.ts)

## cms

Tier 1; 15 source files; 2 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: cms.contact_requested, cms.entry_created, cms.entry_deleted, cms.help_article_created, cms.help_article_deleted, cms.org_contact_received, cms.site_section_changed, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| cms.createEntry | dynamic or not captured | core | [source](../../packages/modules/cms/src/cms.ts#L65) |
| cms.updateEntry | dynamic or not captured | core | [source](../../packages/modules/cms/src/cms.ts#L119) |
| cms.setEntryStatus | dynamic or not captured | core | [source](../../packages/modules/cms/src/cms.ts#L178) |
| cms.deleteEntry | dynamic or not captured | core | [source](../../packages/modules/cms/src/cms.ts#L220) |
| cms.listEntries | dynamic or not captured | core | [source](../../packages/modules/cms/src/cms.ts#L242) |
| cms.getEntry | dynamic or not captured | core | [source](../../packages/modules/cms/src/cms.ts#L257) |
| cms.contactPage | dynamic or not captured | core | [source](../../packages/modules/cms/src/contact-page.ts#L42) |
| cms.setContactPage | dynamic or not captured | core | [source](../../packages/modules/cms/src/contact-page.ts#L55) |
| cms.submitOrgContact | public:contact_request | core | [source](../../packages/modules/cms/src/contact-page.ts#L112) |
| cms.orgContactMessages | dynamic or not captured | core | [source](../../packages/modules/cms/src/contact-page.ts#L174) |
| cms.orgContactNewCount | dynamic or not captured | core | [source](../../packages/modules/cms/src/contact-page.ts#L197) |
| cms.createHelpCategory | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L85) |
| cms.updateHelpCategory | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L142) |
| cms.deleteHelpCategory | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L168) |
| cms.createHelpArticle | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L195) |
| cms.updateHelpArticle | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L257) |
| cms.setHelpArticleStatus | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L318) |
| cms.deleteHelpArticle | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L352) |
| cms.listHelp | dynamic or not captured | core | [source](../../packages/modules/cms/src/help.ts#L379) |
| cms.getHelpArticle | public:help_feedback | core | [source](../../packages/modules/cms/src/help.ts#L415) |
| cms.getHelpCategory | public:help_feedback | core | [source](../../packages/modules/cms/src/help.ts#L424) |
| cms.submitHelpFeedback | public:help_feedback | core | [source](../../packages/modules/cms/src/help.ts#L439) |
| cms.createSiteSection | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L48) |
| cms.updateSiteSection | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L105) |
| cms.setSiteSectionStatus | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L159) |
| cms.deleteSiteSection | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L193) |
| cms.listSiteSections | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L212) |
| cms.getSiteSection | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L227) |
| cms.submitContactRequest | public:contact_request | core | [source](../../packages/modules/cms/src/site.ts#L269) |
| cms.listContactRequests | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L304) |
| cms.markContactHandled | dynamic or not captured | core | [source](../../packages/modules/cms/src/site.ts#L321) |

### Feature rules and lifecycle

#### cms (tier 1)

Tenant CMS (M1.4g): an org's pages and blog posts. Owns Postgres schema `cms`.

**Tier:** 1, the roadmap's "content" slot (§3.5). It needs nothing from other modules: the
author is the acting member (`ctx.actor`) with a display-name snapshot from the console, so it
never reads tenancy. Higher tiers read it: marketplace (tier 6) validates the pages a tenant
site's navigation links and lists entries in sitemaps.

**Invariants**
- `entries` is a tenant table (RLS FORCE). One row is a `page` or a `post`; `slug` is unique per
  org and kind, lowercase ASCII (`a-z0-9` and single hyphens, ≤ 80), derived from the title
  with a `-2`, `-3` suffix when left empty, and **frozen once first published** (public URLs and
  sitemaps depend on it).
- `body` is the M1.4d Markdown subset (`@yayatoh/contracts` `sanitizeMarkdown` on every write,
  `parseMarkdown` → React elements on every render): raw HTML stays text, only http(s)/mailto
  links survive, control and bidi-override characters are stripped.
- Status: draft → published ⇄ draft, draft/published → archived, archived → published. Only
  `published` entries are ever read publicly (`publicEntries`, `publicEntry`, `navPages`,
  `sitemapEntries`), through allowlisted DTOs (no ids, no author account id).
- Writes need `marketing:write` (owner, admin, manager, marketing); reads need `org:read`
  (viewers read only). Every write is audited; publish/unpublish/archive/delete emit
  `cms.page_published@1` / `cms.post_published@1` / `cms.entry_unpublished@1` /
  `cms.entry_archived@1` / `cms.entry_deleted@1` (payload: org, entry id, kind, slug).
- **Hook (M1.4e):** cover images arrive with the media pipeline as a `cover_media_id` column
  and a `cover` field on the public DTOs; nothing stores images before then.

**Platform CMS (M3.11b)** — the help center and the marketing site, written by the marketplace
content org and read under its RLS (never across tenants):
- `help_categories` (audience, slug unique per org, `search` reserved, translations jsonb),
  `help_articles` (per locale; a translation is the same slug in another locale; `entries`
  lifecycle; slug frozen once published), `help_feedback` (one answer per voter hash per article;
  no person or IP), `site_sections` (per placement and locale; CTA is a site path or https only),
  `contact_requests` (personal data: `marketing:write` roles only, never public).
- Public reads return published rows only, through allowlisted DTOs, with a per-slug fallback to
  English (`pickLocale`). Search ranking and related articles are pure (`domain/help.ts`).
- Public commands: `submitHelpFeedback` (`public:help_feedback`) and `submitContactRequest`
  (`public:contact_request`); the web rate-limits both (`helpFeedback`, `contactRequest`).

**Org contact page (U10)** — `contact_pages` (one row per org: on/off, a line of text) and
`contact_requests` rows with `source = 'org_site'`:
- `submitOrgContactCommand` (`public:contact_request`; the web rate-limits `orgContact`, checks a
  honeypot, a signed fill-time stamp and the human check first) is refused while the page is off,
  needs the visitor's consent, and stores once per form key (`submission_key`, unique per org).
- `cms.org_contact_received@1` (no personal data) → `orgContactNotifier` notifies the org's
  members (`cms.contact_message`, deduplicated by the message id). Messages are read with
  `orgContactMessagesQuery` (`marketing:write` roles; personal data). The public page gets only
  `PublicContactPageDto` (its line of text): never an address of the org.


### Source index

- [packages/modules/cms/src/cms.ts](../../packages/modules/cms/src/cms.ts)
- [packages/modules/cms/src/contact-page.ts](../../packages/modules/cms/src/contact-page.ts)
- [packages/modules/cms/src/data-subject.ts](../../packages/modules/cms/src/data-subject.ts)
- [packages/modules/cms/src/domain/help.ts](../../packages/modules/cms/src/domain/help.ts)
- [packages/modules/cms/src/domain/kinds.ts](../../packages/modules/cms/src/domain/kinds.ts)
- [packages/modules/cms/src/domain/slug.ts](../../packages/modules/cms/src/domain/slug.ts)
- [packages/modules/cms/src/dto-help.ts](../../packages/modules/cms/src/dto-help.ts)
- [packages/modules/cms/src/dto.ts](../../packages/modules/cms/src/dto.ts)
- [packages/modules/cms/src/help.ts](../../packages/modules/cms/src/help.ts)
- [packages/modules/cms/src/index.ts](../../packages/modules/cms/src/index.ts)
- [packages/modules/cms/src/private-columns.ts](../../packages/modules/cms/src/private-columns.ts)
- [packages/modules/cms/src/schema.ts](../../packages/modules/cms/src/schema.ts)
- [packages/modules/cms/src/site.ts](../../packages/modules/cms/src/site.ts)
- [packages/modules/cms/src/testing.ts](../../packages/modules/cms/src/testing.ts)
- [packages/modules/cms/src/ui.ts](../../packages/modules/cms/src/ui.ts)

## command-center

Tier 6; 24 source files; 5 test files.

Declared connections: @yayatoh/assistance, @yayatoh/billing, @yayatoh/checkin, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/assistance, @yayatoh/billing, @yayatoh/checkin, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/marketing, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/reports, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| commandCenter.saveLayout | events:read | core | [source](../../packages/modules/command-center/src/commands.ts#L21) |
| commandCenter.resetLayout | events:read | core | [source](../../packages/modules/command-center/src/commands.ts#L56) |
| commandCenter.setMode | events:write | core | [source](../../packages/modules/command-center/src/commands.ts#L78) |
| commandCenter.createDisplayLink | events:write | checkin | [source](../../packages/modules/command-center/src/display.ts#L36) |
| commandCenter.revokeDisplayLink | events:write | checkin | [source](../../packages/modules/command-center/src/display.ts#L68) |
| commandCenter.displayLinks | events:read | checkin | [source](../../packages/modules/command-center/src/display.ts#L99) |
| commandCenter.tvBoard | events:read | checkin | [source](../../packages/modules/command-center/src/display.ts#L181) |
| commandCenter.eventView | events:read | core | [source](../../packages/modules/command-center/src/view.ts#L125) |
| commandCenter.orgOverview | events:read | core | [source](../../packages/modules/command-center/src/view.ts#L186) |

### Feature rules and lifecycle

#### command-center (tier 6)

The event Command Center shell (M3.2a): the widget registry, role layouts, event modes, the
readiness score and the multi-event overview. Owns Postgres schema `command_center` (`layouts`,
`mode_overrides`). It reads every other module only through their exported queries and `*Tx`
reads inside the caller's tenant transaction (reports metrics, check-in facts, seating fill,
devices, events, program, ticketing), and never writes to them. The M3.2b alert engine plugs into
the `alerts` slot with `withWidget`.

**Invariants**
- **Widgets are registered, never ad hoc.** A widget is its metadata (`WIDGET_META`: module, permission, roles, profiles, modes, size, realtime channel) plus a loader built by `defineWidget`: a tenant query whose handler resolves the caller's Command Center role for the event and refuses (`forbidden`) any widget the registry does not allow them. A key outside the registry never renders.
- **Roles are derived, never granted.** `commandCenterRole(orgRole, eventRoles)` maps members to owner, ops, finance, door or marketing (see `domain/roles.ts` for the precedence). Every loader also checks its permission through the normal query pipeline.
- **The door never sees revenue.** The sales widget is `revenue: true`: `widgetAllowed` refuses it for the door role whatever the metadata says, the default door layouts don't list it, and a saved layout can't store it.
- **Modes are computed in the event's IANA zone** (`domain/modes.ts`): pre-show from the same wall-clock time the day before the start, live from doors −2 h to the end +2 h, wrap until the end +7 calendar days; multi-date events use the current date. A manual override (`events:write`) wins until cleared; setting and clearing it is audited.
- **Layouts are per member per event**: order and hidden widgets, validated against the registry on write and filtered by role, profile, module and mode on read.
- **Realtime payloads carry no figures.** `event.metrics` gets a value-free "changed" ping from the metrics projector (the channel admits door staff); widgets re-read through their loaders. Device presence goes to `event.devices` for events in pre-show or live.
- Widget DTOs are allowlists (counts, minor units per currency, ISO times). Money is never summed across currencies.
- **Live mode (M3.3a):** widgets `liveFeed` (scans, device transitions and — through the app's `FeedAlertSource` port — alerts; filters by entrance, device and kind), `checkinSpeed` (scan log per entrance and device; the chart from the metric time series), `scanIssues` (the order deep link only for roles that read orders, never the door), `capacity` (the alert engine's thresholds, kept equal by `alert-thresholds.test.ts`), `staffPresence` (names through the app's `MemberNames` port) and the `assistance` slot for M3.3b (`withWidget`). None carry money. A widget may follow several channels (`alsoFollows`).
- **TV mode:** `display_links` hold only the SHA-256 of the token (`yytv_…`, shown once). `command_center.display_link_target` (SECURITY DEFINER, ids only, live links of active orgs) resolves a token; the board reads as the system actor `display:{link}` and re-checks the link in the transaction, so revoking stops it at the next refresh. `tvBoardQuery` returns counts, speed, capacity and devices only.
- **Conference pack (M5.9a):** tiles `sessionAttendance` (the door may see it), `sessionFill`, `exhibitorActivity` and `sponsorActivity`, for conference events only; counts, session titles and exhibitor/sponsor names, never money. Leads and sponsor deliverables come through the app's ports (`exhibitorActivityWidget(leads)`, `sponsorActivityWidget(deliverables)`); `null` says the source isn't connected. Grading (`domain/conference.ts`) equals the alert engine's thresholds. The capacity tile lists entrances and zones only (session doors are on the session rooms tile).
- **Social pack (M4.6a):** `rsvp`, `guestSeating`, `meals` and `arrivals` for wedding and gala events with the `guests` module (`social-widgets.ts`). RSVP (pending, responded, parties, not sent, deadline in the event's zone) and meals (per menu option with its notes, other, none, and how many attending guests have dietary or accessibility needs: counts only, the sealed answers never leave guests) need `guests:read` and are owner/ops only. Guest seating (the seating editor's unseated guests, eight names at most) and arrivals (check-in's day-of read: expected, arrived, the latest eight) need `events:read` like the other door widgets, so the door sees them; none carries money. They poll (no channel).
- **Command Center v2 (U4):** the KPI row's keys are `kpiKeys` (the source widget's own `widgetAllowed`: the door never gets sales); the board packs with `boardSpans` (no empty cell at 1, 2 or 3 columns, member order kept); the hero's `nextAction` and `countdown` are pure and fed only by the member's own loader reads; readiness rules carry the `field` that fixes them (`READINESS_FIELDS`). The org overview's `sales` and `tickets` per event follow the sales and tickets widgets' rules plus `orders:read`/the reports module.


### Source index

- [packages/modules/command-center/src/access.ts](../../packages/modules/command-center/src/access.ts)
- [packages/modules/command-center/src/client.ts](../../packages/modules/command-center/src/client.ts)
- [packages/modules/command-center/src/commands.ts](../../packages/modules/command-center/src/commands.ts)
- [packages/modules/command-center/src/conference-widgets.ts](../../packages/modules/command-center/src/conference-widgets.ts)
- [packages/modules/command-center/src/display.ts](../../packages/modules/command-center/src/display.ts)
- [packages/modules/command-center/src/domain/conference.ts](../../packages/modules/command-center/src/domain/conference.ts)
- [packages/modules/command-center/src/domain/hero.ts](../../packages/modules/command-center/src/domain/hero.ts)
- [packages/modules/command-center/src/domain/live.ts](../../packages/modules/command-center/src/domain/live.ts)
- [packages/modules/command-center/src/domain/modes.ts](../../packages/modules/command-center/src/domain/modes.ts)
- [packages/modules/command-center/src/domain/pack.ts](../../packages/modules/command-center/src/domain/pack.ts)
- [packages/modules/command-center/src/domain/readiness.ts](../../packages/modules/command-center/src/domain/readiness.ts)
- [packages/modules/command-center/src/domain/roles.ts](../../packages/modules/command-center/src/domain/roles.ts)
- [packages/modules/command-center/src/domain/timeline.ts](../../packages/modules/command-center/src/domain/timeline.ts)
- [packages/modules/command-center/src/domain/widgets.ts](../../packages/modules/command-center/src/domain/widgets.ts)
- [packages/modules/command-center/src/index.ts](../../packages/modules/command-center/src/index.ts)
- [packages/modules/command-center/src/live-widgets.ts](../../packages/modules/command-center/src/live-widgets.ts)
- [packages/modules/command-center/src/private-columns.ts](../../packages/modules/command-center/src/private-columns.ts)
- [packages/modules/command-center/src/readiness.ts](../../packages/modules/command-center/src/readiness.ts)
- [packages/modules/command-center/src/realtime.ts](../../packages/modules/command-center/src/realtime.ts)
- [packages/modules/command-center/src/registry.ts](../../packages/modules/command-center/src/registry.ts)
- [packages/modules/command-center/src/schema.ts](../../packages/modules/command-center/src/schema.ts)
- [packages/modules/command-center/src/social-widgets.ts](../../packages/modules/command-center/src/social-widgets.ts)
- [packages/modules/command-center/src/view.ts](../../packages/modules/command-center/src/view.ts)
- [packages/modules/command-center/src/widgets.ts](../../packages/modules/command-center/src/widgets.ts)

## crm

Tier 1; 30 source files; 3 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: crm.contacts_merged, crm.contacts_unmerged, group, participation, stats.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| crm.addContact | contacts:write | api_access | [source](../../packages/modules/crm/src/add-contact.ts#L14) |
| crm.mergeContacts | contacts:merge | marketing | [source](../../packages/modules/crm/src/merge/commands.ts#L32) |
| crm.mergeDuplicatesBulk | contacts:merge | marketing | [source](../../packages/modules/crm/src/merge/commands.ts#L66) |
| crm.undoMerge | contacts:merge | marketing | [source](../../packages/modules/crm/src/merge/commands.ts#L133) |
| crm.scanDuplicates | contacts:merge | marketing | [source](../../packages/modules/crm/src/merge/duplicates.ts#L151) |
| crm.dismissDuplicate | contacts:merge | marketing | [source](../../packages/modules/crm/src/merge/duplicates.ts#L168) |
| crm.duplicateQueue | contacts:read | marketing | [source](../../packages/modules/crm/src/merge/queries.ts#L73) |
| crm.duplicatePair | contacts:read | marketing | [source](../../packages/modules/crm/src/merge/queries.ts#L145) |
| crm.people | contacts:read | marketing | [source](../../packages/modules/crm/src/merge/queries.ts#L202) |
| crm.person | contacts:read | marketing | [source](../../packages/modules/crm/src/merge/queries.ts#L273) |
| crm.contactStats | contacts:read | core | [source](../../packages/modules/crm/src/stats/queries.ts#L80) |
| crm.contactValue | finance:read | core | [source](../../packages/modules/crm/src/stats/queries.ts#L113) |
| crm.orgContactStats | contacts:read | core | [source](../../packages/modules/crm/src/stats/queries.ts#L190) |
| crm.orgValue | finance:read | core | [source](../../packages/modules/crm/src/stats/queries.ts#L277) |

### Feature rules and lifecycle

#### crm (tier 1)

Org-scoped contacts and the consent ledger. Owns Postgres schema `crm`.

**Invariants**
- A contact belongs to one org. The same person in two orgs is two contacts, and there is no global attendee record (roadmap §4.1).
- `email_norm` (trimmed, lower-case) is unique per org; `upsertContactTx` is the only way contacts are created from checkout and ticket issue.
- Consents are append-only rows with evidence; the latest row per (contact, channel, purpose) wins. No row means no consent. Consent is never inferred from a purchase.
- Transactional email (tickets, receipts) needs no marketing consent; marketing sends must check `currentConsentTx` (M3.5 adds suppressions and the policy gate).
- Consent channels are email, SMS and WhatsApp; purposes are `marketing` (express written consent
  for texts) and `informational` (reminders and updates by text, M3.5a). The preference center
  writes rows only when a choice changes, with evidence naming the disclosure version.
- `event_participation` (contact × event) and `contact_stats` (contact × currency) are projections. The legacy migration backfills history (`source = 'legacy'`, rebuilt on each run); the live projector is `audiences.participation` (M3.6a, `source = 'live'`), which writes only through `replaceParticipationTx` and `refreshContactProfilesTx`. The event reference is a composite FK to `events.events` in a hand-written migration (this module never imports the events schema). DSAR exports include both.

- `contact_profile` (M3.6) is a projection of `event_participation` and the consent ledger, rebuilt by the SQL function `crm.refresh_contact_profiles` (shared by the projector, `recordConsentTx` and the migration backfill). Consent is summarized in the same transaction that records it.
- **Segment DSL (M3.6a):** `SegmentDefinition` (zod, browser-safe via `./client`) is compiled by `compileSegment` to a WHERE clause with bound parameters only; operators and columns come from fixed tables keyed by enum values. Scopes arrive resolved to event ids (crm never reads the events schema). Merged and erased contacts never match.
- `event_engagement` (M5.7b): each contact's engagement score per event, written only by the `engagement` module through `replaceEventEngagementTx` (crm never computes it); composite FKs to `crm.contacts` and `events.events` (hand-written), cascade. The segment condition `engagement` sums it over the events in scope. `contactForAccountTx` finds the contact behind a signed-in account (link, else email; never a merged contact).

**M6.1a — duplicates, merge and the person timeline** (ADR 0023)
- **Duplicates** (`duplicate_candidates`, `duplicate_scans`): a pair per row (`a < b`) with a score 0–99 and its reasons (`email`: same canonical mailbox, plus-tags and Gmail dots ignored; `phone`: same E.164; `name_company`: pg_trgm name and company similarity ≥ 0.6 through the SECURITY DEFINER `crm.similar_contact_pairs`). `scanDuplicatesTx` is incremental (contacts changed since the scan cursor, compared with everyone) unless `full`; the worker's `crm.duplicate-scan` job runs it per org (`crm.orgs_needing_duplicate_scan`). Dismissed pairs are never raised again; merged and erased contacts never match.
- **Merge** (`mergeContactsTx`, commands `crm.mergeContacts` / `crm.mergeDuplicatesBulk` (step-up) / `crm.undoMerge`, permission `contacts:merge`): both records locked; refused while any `contact_id`-named column in the database has no registered `ContactReferenceOwner`. The target takes the chosen fields (an email chosen from the duplicate is swapped, so both addresses resolve to the person); the duplicate gets `merged_into`. Consent: the strictest current status per (channel, purpose), an opt-out winning, appended as ledger rows on the target (evidence `merge:<id>`). Timeline entries and every owner's rows move in the same transaction and are recorded once in `contact_merge_moves`. Emits `crm.contacts_merged@1`.
- **Undo** within 30 days restores the split exactly: owners move back the recorded rows, timeline entries go back with their subjects, the merge's consent rows are removed, both records get their snapshot fields (and `updated_at`) back; emits `crm.contacts_unmerged@1`. Refused once expired, after erasure (the snapshot is scrubbed by `eraseContactDsarTx`) or while the target has been merged again.
- `upsertContactTx`, `upsertContactsTx` and `contactIdByEmailTx` follow `merged_into` (a merged-away address finds the record that stays).
- **Timeline** (`timeline_entries`): a projection written only by owners' outbox subscribers through `recordTimelineTx`, exactly once per `(kind, source_ref)`; a fact about a merged contact lands on the active record. Never PII beyond a short label (a campaign or survey name). Read by keyset (`timelinePageTx`).
- **Contact stats (M6.1b):** `contact_scores` (per contact) and `contact_stats` (per contact ×
  currency: lifetime value) are projections recomputed from `event_participation` and
  `contact_signals` by `writeContactStatsTx` (audiences runs it); never written by anything else.
  `contact_signals` is exactly once per (contact, kind, ref). The formulas are pure and documented
  (`stats/formulas.ts`); RFM quintiles are computed on read (`stats/rfm.ts`), never stored.
  Money (lifetime value, the monetary quintile) leaves only through `finance:read` queries;
  `contactStats`/`orgContactStats` never carry an amount. The `ltv` and `rfmMonetary` segment
  conditions are money conditions (`usesMoneyConditions`).


### Source index

- [packages/modules/crm/src/add-contact.ts](../../packages/modules/crm/src/add-contact.ts)
- [packages/modules/crm/src/client.ts](../../packages/modules/crm/src/client.ts)
- [packages/modules/crm/src/consent-entry.ts](../../packages/modules/crm/src/consent-entry.ts)
- [packages/modules/crm/src/contacts.ts](../../packages/modules/crm/src/contacts.ts)
- [packages/modules/crm/src/crm-connector-sync.ts](../../packages/modules/crm/src/crm-connector-sync.ts)
- [packages/modules/crm/src/data-subject.ts](../../packages/modules/crm/src/data-subject.ts)
- [packages/modules/crm/src/dsar.ts](../../packages/modules/crm/src/dsar.ts)
- [packages/modules/crm/src/engagement.ts](../../packages/modules/crm/src/engagement.ts)
- [packages/modules/crm/src/index.ts](../../packages/modules/crm/src/index.ts)
- [packages/modules/crm/src/integration-consent.ts](../../packages/modules/crm/src/integration-consent.ts)
- [packages/modules/crm/src/merge/commands.ts](../../packages/modules/crm/src/merge/commands.ts)
- [packages/modules/crm/src/merge/domain.ts](../../packages/modules/crm/src/merge/domain.ts)
- [packages/modules/crm/src/merge/duplicates.ts](../../packages/modules/crm/src/merge/duplicates.ts)
- [packages/modules/crm/src/merge/engine.ts](../../packages/modules/crm/src/merge/engine.ts)
- [packages/modules/crm/src/merge/owners.ts](../../packages/modules/crm/src/merge/owners.ts)
- [packages/modules/crm/src/merge/queries.ts](../../packages/modules/crm/src/merge/queries.ts)
- [packages/modules/crm/src/private-columns.ts](../../packages/modules/crm/src/private-columns.ts)
- [packages/modules/crm/src/projection.ts](../../packages/modules/crm/src/projection.ts)
- [packages/modules/crm/src/schema.ts](../../packages/modules/crm/src/schema.ts)
- [packages/modules/crm/src/segments/compile.ts](../../packages/modules/crm/src/segments/compile.ts)
- [packages/modules/crm/src/segments/dsl.ts](../../packages/modules/crm/src/segments/dsl.ts)
- [packages/modules/crm/src/stats/compute.ts](../../packages/modules/crm/src/stats/compute.ts)
- [packages/modules/crm/src/stats/formulas.ts](../../packages/modules/crm/src/stats/formulas.ts)
- [packages/modules/crm/src/stats/projection.ts](../../packages/modules/crm/src/stats/projection.ts)
- [packages/modules/crm/src/stats/queries.ts](../../packages/modules/crm/src/stats/queries.ts)
- [packages/modules/crm/src/stats/rfm.ts](../../packages/modules/crm/src/stats/rfm.ts)
- [packages/modules/crm/src/sync.ts](../../packages/modules/crm/src/sync.ts)
- [packages/modules/crm/src/terms.ts](../../packages/modules/crm/src/terms.ts)
- [packages/modules/crm/src/testing.ts](../../packages/modules/crm/src/testing.ts)
- [packages/modules/crm/src/timeline.ts](../../packages/modules/crm/src/timeline.ts)

## donations

Tier 5; 52 source files; 9 test files.

Declared connections: @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui.

Source imports: @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/ui/tokens.

Tables detected: see schema source.

Event type literals detected: donations.charity_rejected, donations.charity_submitted, donations.charity_verified, donations.pledge_invoiced, donations.pledges_closed, donations.statement_issued, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| donations.createCampaign | events:write | donations | [source](../../packages/modules/donations/src/campaigns.ts#L68) |
| donations.updateCampaign | events:write | donations | [source](../../packages/modules/donations/src/campaigns.ts#L115) |
| donations.createLevel | events:write | donations | [source](../../packages/modules/donations/src/campaigns.ts#L154) |
| donations.deleteLevel | events:write | donations | [source](../../packages/modules/donations/src/campaigns.ts#L198) |
| donations.console | orders:read | donations | [source](../../packages/modules/donations/src/campaigns.ts#L304) |
| donations.saveCharityProfile | org:update | donations | [source](../../packages/modules/donations/src/charity.ts#L76) |
| donations.charityProfile | org:read | donations | [source](../../packages/modules/donations/src/charity.ts#L150) |
| donations.verifyCharity | platform:charity.verify | null or not captured | [source](../../packages/modules/donations/src/charity.ts#L179) |
| donations.rejectCharity | platform:charity.verify | null or not captured | [source](../../packages/modules/donations/src/charity.ts#L239) |
| donations.setFairValue | events:write | donations | [source](../../packages/modules/donations/src/fair-value.ts#L34) |
| donations.clearFairValue | events:write | donations | [source](../../packages/modules/donations/src/fair-value.ts#L81) |
| donations.startGift | public:checkout | donations | [source](../../packages/modules/donations/src/gifts.ts#L38) |
| donations.createMatch | events:write | donations | [source](../../packages/modules/donations/src/matches.ts#L105) |
| donations.cancelMatch | events:write | donations | [source](../../packages/modules/donations/src/matches.ts#L171) |
| donations.closeMatch | events:write | donations | [source](../../packages/modules/donations/src/matches.ts#L205) |
| donations.matches | orders:read | donations | [source](../../packages/modules/donations/src/matches.ts#L256) |
| donations.armLevel | events:write | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L46) |
| donations.closeCall | events:write | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L94) |
| donations.undoPaddleStep | events:write | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L128) |
| donations.recordPaddles | checkin:scan | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L195) |
| donations.confirmEntries | events:write | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L351) |
| donations.voidEntry | events:write | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L433) |
| donations.paddleConsole | orders:read | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L474) |
| donations.spotterState | checkin:scan | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L515) |
| donations.paddleReview | orders:read | donations | [source](../../packages/modules/donations/src/paddle-raise.ts#L528) |
| donations.assignPaddle | guests:write | donations | [source](../../packages/modules/donations/src/paddles.ts#L57) |
| donations.bulkAssignPaddles | guests:write | donations | [source](../../packages/modules/donations/src/paddles.ts#L103) |
| donations.releasePaddle | guests:write | donations | [source](../../packages/modules/donations/src/paddles.ts#L160) |
| donations.paddles | guests:read | donations | [source](../../packages/modules/donations/src/paddles.ts#L204) |
| donations.closePledges | orders:refund | donations | [source](../../packages/modules/donations/src/pledge-collection.ts#L180) |
| donations.claimPledgeCharges | platform:donations.collect | null or not captured | [source](../../packages/modules/donations/src/pledge-collection.ts#L266) |
| donations.settleCardCharge | platform:donations.collect | null or not captured | [source](../../packages/modules/donations/src/pledge-collection.ts#L411) |
| donations.startPledgePayment | public:checkout | donations | [source](../../packages/modules/donations/src/pledge-collection.ts#L534) |
| donations.recordPledgePayment | orders:refund | donations | [source](../../packages/modules/donations/src/pledge-collection.ts#L773) |
| donations.writeOffPledge | orders:refund | donations | [source](../../packages/modules/donations/src/pledge-collection.ts#L812) |
| donations.pledgeCollection | orders:read | donations | [source](../../packages/modules/donations/src/pledge-collection.ts#L872) |
| donations.receiptsConsole | orders:read | donations | [source](../../packages/modules/donations/src/receipts.ts#L263) |
| donations.receiptDocument | orders:read | donations | [source](../../packages/modules/donations/src/receipts.ts#L317) |
| donations.yearEndStatements | platform:donations.statements | null or not captured | [source](../../packages/modules/donations/src/receipts.ts#L393) |
| donations.reconTarget | finance:reconcile | donations | [source](../../packages/modules/donations/src/reconciliation.ts#L70) |
| donations.reconcile | finance:reconcile | donations | [source](../../packages/modules/donations/src/reconciliation.ts#L142) |
| donations.resolveReconItem | finance:reconcile | donations | [source](../../packages/modules/donations/src/reconciliation.ts#L275) |
| donations.reconciliation | finance:read | donations | [source](../../packages/modules/donations/src/reconciliation.ts#L310) |
| donations.report | finance:read | donations | [source](../../packages/modules/donations/src/report.ts#L234) |
| donations.retention | platform:donations.retention | core | [source](../../packages/modules/donations/src/retention.ts#L48) |
| donations.startCardSetup | public:checkout | donations | [source](../../packages/modules/donations/src/saved-cards.ts#L69) |
| donations.attachCardSetup | public:checkout | donations | [source](../../packages/modules/donations/src/saved-cards.ts#L132) |
| donations.applyCardSetup | platform:payments.webhook | null or not captured | [source](../../packages/modules/donations/src/saved-cards.ts#L178) |
| donations.removeSavedCard | public:checkout | donations | [source](../../packages/modules/donations/src/saved-cards.ts#L256) |
| donations.expireSavedCards | platform:donations.collect | null or not captured | [source](../../packages/modules/donations/src/saved-cards.ts#L287) |
| donations.giveWithSavedCard | public:checkout | donations | [source](../../packages/modules/donations/src/saved-cards.ts#L471) |
| donations.saveScreen | events:write | donations | [source](../../packages/modules/donations/src/screen.ts#L28) |
| donations.rotateScreenLink | events:write | donations | [source](../../packages/modules/donations/src/screen.ts#L63) |
| donations.screenSettings | orders:read | donations | [source](../../packages/modules/donations/src/screen.ts#L93) |

### Feature rules and lifecycle

#### donations (tier 5)

Gala and community giving (M4.8a; plan `docs/plans/phase-4.md` §6, decisions P4-9 to P4-17). Owns Postgres schema `donations`: campaigns, giving levels and gifts; charity profiles, ticket fair-market values, receipts and year-end statements (M4.8b).

**Invariants**
- **Funds flow (P4-9):** a gift is an order with one donation item (`orders.donation_items`, `startDonationOrderTx`) paid as a **direct charge on the organizer's connected account** (`organizer_mor`) with **application fee 0** (P4-10: no Yayatoh fee on donations). An org without an enabled connected account cannot take gifts online: `startGift` is refused (`not_connected`), the public giving page says giving is unavailable, and the Donations tab asks the host to connect Stripe. Donations under `platform_mor` wait for counsel.
- **Amounts:** integer minor units in the event's currency. A gift is a level's amount or an own amount within the campaign's `min_gift_minor`..`max_gift_minor`. The processing-fee cover (off by default, P4-10) is computed by the server (`processingFeeCover`: the smallest charge that leaves the whole gift after 2.9 % + 30), never taken from the form; the charge is exactly gift + cover.
- **Idempotency:** `donations.startGift` requires an Idempotency-Key (the giving page's form key): a double submit is one gift and one order; the provider payment's key is the order's (`order:<id>:1`).
- **Outcomes** come from the orders module through the outbox (`order.donation_paid@1`, `order.payment_failed@1`, `order.expired@1` → `donations.gift-outcomes`). Each change moves a gift only out of `pending` (paid also out of a lapse); totals are sums of paid gifts, so a replayed or duplicated webhook never counts twice (the orders side also deduplicates provider event ids). Pages that show gifts call `catchUpGifts(orgId)` (dev/e2e have no worker; the worker relays in production).
- **Privacy (P4-13):** donor name, email, employer and tribute (honoree, recipient, note) are personal columns. **No donor list or per-gift amount reaches a public page or payload**: the giving page (`PublicGivingDto`) carries campaign text, levels and totals only. The host's list shows each name only as the donor chose (`full_name`, `first_name`, or Anonymous; `shownName`); the donor's own name and email are in the CSV export (bulk `donations.giftsCsv`: `attendees:export`, step-up, audited, refused while staff act as a member).
- **Retention:** a gift that never got paid (`failed`, `expired`) loses its donor after 30 days, like its order's buyer (`privacy.retention`): the worker's daily pass runs `donations.retention` per org as a system actor (`platform:` permission, category `delete`, audited with the count). Name and email become the erased placeholders; employer and tribute go; paid gifts keep theirs.
- **Permissions:** campaigns and levels need `events:write` (co-hosts through their event role); the console needs `orders:read`; deleting a level is category `delete` and keeps its gifts (level cleared).
- **Charity profile and receipts (M4.8b, P4-11):** one charity profile per org (legal name, EIN, own 501(c)(3) or a fiscal sponsor); any change sends it to staff review (`pending`, new version); only staff (`platform:charity.verify`, admin app) verify the version they reviewed, with an eligible IRS record for its EIN (the sponsor's), looked up through the `ExemptOrgLookup` port (recorded fixture in dev/CI; the owner-run download in production; never a live call). One receipt per paid order (gift, or tickets whose types carry a fair-market value), numbered gap-free per org, immutable (charity details and `RECEIPT_COPY_VERSION` snapshotted). Deductible = paid − FMV, never below zero; tax-deductible only when verified, `organizer_mor` and USD, otherwise a plain "not tax-deductible" receipt. Receipts and year-end statements go only to the donor's email (signed links per org). Statements: once per donor, currency and tax year (org timezone), exact sums of that year's deductible receipts. All wording lives in `src/legal/receipt-copy.ts` (legal-copy).
- **Paddle raise (M4.8c):** a paddle (`paddles`, number unique per event) belongs to one named guest or one party of the event (read through `@yayatoh/guests`' `paddleHolder*Tx`, a lower tier); taking one back is refused once it has counted entries. A call (`paddle_calls`) is one level armed by the console, with the level's name and amount copied; one open call per event. Spotters' entries (`paddle_entries`) carry the device's own id (`client_id`, unique per org): `donations.recordPaddles` stores each once and answers a known id with its stored status; a paddle not given at this event, another event's level or a withdrawn arm is refused (not stored); the same paddle at the same call is stored as `duplicate` (never dropped, not counted). Batches lock their calls in id order. Undo (`undoStep`) sets aside the newest waiting entry, withdraws an empty arm or reopens a closed level; never a confirmed pledge. The recorder confirms entries into `pledges` (one per entry: the level's amount and the paddle's holder) and voids mistakes (cancelling the pledge). A pledge is a promise, never a charge (P4-12). Spotters' channel (`event.paddle-spotters`, `checkin:scan`) carries the level and paddle numbers only, never names or amounts given (P4-13); the console channel (`event.paddle-console`, `orders:read`) carries the open call and totals. Every write publishes in its own transaction.
- **Live giving screen (M4.8d):** one screen per event (`screens`): the campaign it follows, names on or off, the signed link's version (`screen-link.ts`; replacing it stops open screens). Its state (`screen-live.ts`, `ScreenStateDto`) is the campaign's paid gifts plus counted paddles, the open call and the names of paid gifts that opted in (`gifts.show_on_screen`, never anonymous, never a paddle holder, P4-13); published on `event.giving-screen` by every paddle-raise write, a paid gift, a campaign edit and a save. QR gifts record `source = qr`.
- **Cards on file and pledge collection (M4.8e, P4-12, P4-14):** a saved card (`saved_cards`) is opt-in, started with the consent recorded (`CARD_CONSENT_VERSION`, time) and usable only once the verified setup webhook makes it `active`; references only (secret), on the organizer's connected account, for its own event, removed 30 days after it. Closing the night gives every confirmed pledge one collection (`pledge_collections`): its holder's card → scheduled at 09:00 local the next morning, else an invoice (pay link, 30 days, reminders at +7/+21/+28 queued and cancelled on settlement). Each try is a gift and order of exactly the pledged amount (`pledge_attempts`, key `order:<id>:1`); a claimed try is replayed with the same order and key, never a second charge; a decline is retried once, then invoiced; a card that is not usable is never charged. Offline payments and write-offs are finance-only with a note; offline-paid pledges count in "raised". The `pledgesUnpaid` alert reads `unpaidPledgeFactsTx` (counts only).
- **Matching gifts (M4.8f, P4-17):** a challenge match (sponsor, window `[starts_at, ends_at)`, `ratio_percent`, cap, the campaign's currency) is never stored while it runs: `matchProgressTx` computes it from the campaign's paid online gifts in the window less their refunds (`gift_refunds`, one row per provider refund from `order.refunded@1`; a refund takes the covered fee first) and confirmed paddle pledges in the window; sponsors' match pledges never count. Matched = ⌊eligible × ratio ⁄ 100⌋, never above the cap. Closing (`events:write`, only once started) ends the window, stores `matched_minor` and records the sponsor's pledge (`pledges.source = 'match'`, one per match) when above zero; afterwards refunds and voided paddle pledges bring it down, never up (`resyncMatchPledgesTx`; cancelled at zero). Public payloads (`LiveMatchDto`: console channel, giving page, M4.8d screen) carry terms, progress and the host-typed public name only; the sponsor's name and email are personal. The employer matching list (`donations.employerCsv`) is a step-up bulk export like the gift list.
- **Reporting, exports and reconciliation (M4.8g):** every line of money of an event (`donationFactsTx`: paid gifts less refunds, offline pledge payments, donation ticket lines) feeds both the report (`donations.report`, `finance:read`) and the donor CRM exports (CSV/XLSX bulk actions, step-up, the anonymous flag kept in every layout), so they always agree. Reconciliation compares the payments ledger's memo entries (`memoEntriesTx`) with the connected account's movements per reference (`order:`/`refund:`) and keeps differences per reference (`recon_items`: open → resolved with a note, or cleared) and the payouts per run. The provider is only called by `reconcileEventDonations`, outside the transaction. Campaign totals net refunds (covered fee first).


### Source index

- [packages/modules/donations/src/campaigns.ts](../../packages/modules/donations/src/campaigns.ts)
- [packages/modules/donations/src/charity.ts](../../packages/modules/donations/src/charity.ts)
- [packages/modules/donations/src/daily-totals.ts](../../packages/modules/donations/src/daily-totals.ts)
- [packages/modules/donations/src/data-subject.ts](../../packages/modules/donations/src/data-subject.ts)
- [packages/modules/donations/src/domain/collection.ts](../../packages/modules/donations/src/domain/collection.ts)
- [packages/modules/donations/src/domain/crm.ts](../../packages/modules/donations/src/domain/crm.ts)
- [packages/modules/donations/src/domain/giving.ts](../../packages/modules/donations/src/domain/giving.ts)
- [packages/modules/donations/src/domain/matches.ts](../../packages/modules/donations/src/domain/matches.ts)
- [packages/modules/donations/src/domain/paddle-queue.ts](../../packages/modules/donations/src/domain/paddle-queue.ts)
- [packages/modules/donations/src/domain/paddles.ts](../../packages/modules/donations/src/domain/paddles.ts)
- [packages/modules/donations/src/domain/receipts.ts](../../packages/modules/donations/src/domain/receipts.ts)
- [packages/modules/donations/src/domain/reconcile.ts](../../packages/modules/donations/src/domain/reconcile.ts)
- [packages/modules/donations/src/domain/report.ts](../../packages/modules/donations/src/domain/report.ts)
- [packages/modules/donations/src/domain/screen.ts](../../packages/modules/donations/src/domain/screen.ts)
- [packages/modules/donations/src/dto.ts](../../packages/modules/donations/src/dto.ts)
- [packages/modules/donations/src/employer-export.ts](../../packages/modules/donations/src/employer-export.ts)
- [packages/modules/donations/src/exempt-orgs/fixture.ts](../../packages/modules/donations/src/exempt-orgs/fixture.ts)
- [packages/modules/donations/src/exempt-orgs/lookup.ts](../../packages/modules/donations/src/exempt-orgs/lookup.ts)
- [packages/modules/donations/src/export.ts](../../packages/modules/donations/src/export.ts)
- [packages/modules/donations/src/fair-value.ts](../../packages/modules/donations/src/fair-value.ts)
- [packages/modules/donations/src/gifts.ts](../../packages/modules/donations/src/gifts.ts)
- [packages/modules/donations/src/index.ts](../../packages/modules/donations/src/index.ts)
- [packages/modules/donations/src/legal/card-consent.ts](../../packages/modules/donations/src/legal/card-consent.ts)
- [packages/modules/donations/src/legal/receipt-copy.ts](../../packages/modules/donations/src/legal/receipt-copy.ts)
- [packages/modules/donations/src/match-dto.ts](../../packages/modules/donations/src/match-dto.ts)
- [packages/modules/donations/src/match-progress.ts](../../packages/modules/donations/src/match-progress.ts)
- [packages/modules/donations/src/matches.ts](../../packages/modules/donations/src/matches.ts)
- [packages/modules/donations/src/paddle-dto.ts](../../packages/modules/donations/src/paddle-dto.ts)
- [packages/modules/donations/src/paddle-live.ts](../../packages/modules/donations/src/paddle-live.ts)
- [packages/modules/donations/src/paddle-raise.ts](../../packages/modules/donations/src/paddle-raise.ts)
- [packages/modules/donations/src/paddles.ts](../../packages/modules/donations/src/paddles.ts)
- [packages/modules/donations/src/pledge-collection.ts](../../packages/modules/donations/src/pledge-collection.ts)
- [packages/modules/donations/src/pledge-totals.ts](../../packages/modules/donations/src/pledge-totals.ts)
- [packages/modules/donations/src/private-columns.ts](../../packages/modules/donations/src/private-columns.ts)
- [packages/modules/donations/src/receipt-document.ts](../../packages/modules/donations/src/receipt-document.ts)
- [packages/modules/donations/src/receipts.ts](../../packages/modules/donations/src/receipts.ts)
- [packages/modules/donations/src/reconciliation.ts](../../packages/modules/donations/src/reconciliation.ts)
- [packages/modules/donations/src/report-dto.ts](../../packages/modules/donations/src/report-dto.ts)
- [packages/modules/donations/src/report-export.ts](../../packages/modules/donations/src/report-export.ts)
- [packages/modules/donations/src/report.ts](../../packages/modules/donations/src/report.ts)
- [packages/modules/donations/src/retention.ts](../../packages/modules/donations/src/retention.ts)
- [packages/modules/donations/src/saved-cards.ts](../../packages/modules/donations/src/saved-cards.ts)
- [packages/modules/donations/src/schema-collection.ts](../../packages/modules/donations/src/schema-collection.ts)
- [packages/modules/donations/src/schema-matches.ts](../../packages/modules/donations/src/schema-matches.ts)
- [packages/modules/donations/src/schema-paddles.ts](../../packages/modules/donations/src/schema-paddles.ts)
- [packages/modules/donations/src/schema-reconciliation.ts](../../packages/modules/donations/src/schema-reconciliation.ts)
- [packages/modules/donations/src/schema-screens.ts](../../packages/modules/donations/src/schema-screens.ts)
- [packages/modules/donations/src/schema.ts](../../packages/modules/donations/src/schema.ts)
- [packages/modules/donations/src/screen-dto.ts](../../packages/modules/donations/src/screen-dto.ts)
- [packages/modules/donations/src/screen-link.ts](../../packages/modules/donations/src/screen-link.ts)
- [packages/modules/donations/src/screen-live.ts](../../packages/modules/donations/src/screen-live.ts)
- [packages/modules/donations/src/screen.ts](../../packages/modules/donations/src/screen.ts)

## engagement

Tier 5; 34 source files; 5 test files.

Declared connections: @yayatoh/attendees, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program.

Source imports: @yayatoh/attendees, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program.

Tables detected: see schema source.

Event type literals detected: engagement.chat_reported, engagement.chat_started, engagement.connection_accepted, engagement.meeting_accepted, engagement.question_asked, engagement.vote_cast, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| engagement.chatInbox | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L97) |
| engagement.chatThread | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L175) |
| engagement.sendChatMessage | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L207) |
| engagement.boothThread | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L274) |
| engagement.sendBoothMessage | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L299) |
| engagement.blockBooth | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L340) |
| engagement.markChatRead | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L390) |
| engagement.reportChat | public:networking | sessions | [source](../../packages/modules/engagement/src/chat/attendee.ts#L458) |
| engagement.chatConsole | events:read | sessions | [source](../../packages/modules/engagement/src/chat/console.ts#L56) |
| engagement.moderateChatReport | events:write | sessions | [source](../../packages/modules/engagement/src/chat/console.ts#L178) |
| engagement.removeChatMessage | events:write | sessions | [source](../../packages/modules/engagement/src/chat/console.ts#L228) |
| engagement.restoreBoothChat | events:write | sessions | [source](../../packages/modules/engagement/src/chat/console.ts#L266) |
| engagement.boothInbox | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L87) |
| engagement.boothChatThread | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L132) |
| engagement.replyBoothChat | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L160) |
| engagement.markBoothRead | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L189) |
| engagement.setBoothChat | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L209) |
| engagement.blockVisitor | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L239) |
| engagement.reportVisitor | portal:exhibitor | sessions | [source](../../packages/modules/engagement/src/chat/exhibitor.ts#L269) |
| engagement.reviewChatReport | platform:engagement.review_chat_report | null or not captured | [source](../../packages/modules/engagement/src/chat/review.ts#L83) |
| engagement.chatRetention | platform:engagement.chat_retention | null or not captured | [source](../../packages/modules/engagement/src/chat/review.ts#L130) |
| engagement.enableLive | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L82) |
| engagement.updateSettings | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L118) |
| engagement.rotateDisplayLink | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L161) |
| engagement.createPoll | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L201) |
| engagement.openPoll | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L250) |
| engagement.closePoll | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L274) |
| engagement.setPollResults | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L296) |
| engagement.presentPoll | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L322) |
| engagement.deletePoll | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L346) |
| engagement.moderateQuestion | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L367) |
| engagement.pinQuestion | events:write | sessions | [source](../../packages/modules/engagement/src/commands.ts#L411) |
| engagement.moderation | events:read | sessions | [source](../../packages/modules/engagement/src/commands.ts#L442) |
| engagement.liveSessions | events:read | sessions | [source](../../packages/modules/engagement/src/commands.ts#L458) |
| engagement.networkHome | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L120) |
| engagement.optIn | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L158) |
| engagement.updateNetworkProfile | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L195) |
| engagement.optOut | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L226) |
| engagement.directory | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L279) |
| engagement.networkPerson | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L300) |
| engagement.requestConnection | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L326) |
| engagement.respondConnection | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L424) |
| engagement.withdrawConnection | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L450) |
| engagement.myConnections | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L490) |
| engagement.requestMeeting | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L597) |
| engagement.respondMeeting | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L679) |
| engagement.cancelMeeting | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L733) |
| engagement.myMeetings | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L798) |
| engagement.myMeeting | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L849) |
| engagement.blockPerson | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L916) |
| engagement.unblockPerson | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L934) |
| engagement.blockedPeople | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L954) |
| engagement.reportPerson | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/attendee.ts#L986) |
| engagement.networkConsole | events:read | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L58) |
| engagement.updateNetworkSettings | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L157) |
| engagement.saveMeetingLocation | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L213) |
| engagement.deleteMeetingLocation | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L290) |
| engagement.addMeetingSlots | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L328) |
| engagement.deleteMeetingSlot | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L359) |
| engagement.resolveReport | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L391) |
| engagement.restoreNetworkProfile | events:write | sessions | [source](../../packages/modules/engagement/src/networking/console.ts#L424) |
| engagement.pendingEmbeddings | events:write | sessions | [source](../../packages/modules/engagement/src/networking/matchmaking.ts#L43) |
| engagement.storeEmbeddings | events:write | sessions | [source](../../packages/modules/engagement/src/networking/matchmaking.ts#L84) |
| engagement.matchmakingStatus | events:read | sessions | [source](../../packages/modules/engagement/src/networking/matchmaking.ts#L142) |
| engagement.suggestedMatches | public:networking | sessions | [source](../../packages/modules/engagement/src/networking/matchmaking.ts#L189) |
| engagement.vote | public:engagement | sessions | [source](../../packages/modules/engagement/src/participate.ts#L77) |
| engagement.askQuestion | public:engagement | sessions | [source](../../packages/modules/engagement/src/participate.ts#L176) |
| engagement.upvoteQuestion | public:engagement | sessions | [source](../../packages/modules/engagement/src/participate.ts#L257) |
| engagement.scoreWeights | events:read | sessions | [source](../../packages/modules/engagement/src/scores.ts#L320) |
| engagement.setScoreWeights | org:update | sessions | [source](../../packages/modules/engagement/src/scores.ts#L336) |
| engagement.resetScoreWeights | org:update | sessions | [source](../../packages/modules/engagement/src/scores.ts#L370) |
| engagement.eventScores | attendees:read | sessions | [source](../../packages/modules/engagement/src/scores.ts#L437) |

### Feature rules and lifecycle

#### engagement (tier 5)

Live polls and moderated Q&A per program session (M5.7a), and engagement events and scores (M5.7b). Owns Postgres schema `engagement`. Sessions come from `program` (tier 3), events from `events` (tier 2); both are read through their exports, and the composite foreign keys to `events.events` and `program.sessions` are hand-written in the migration (cascade on delete).

**Invariants**
- A session takes part only once an organizer turns live engagement on (`session_settings` row, `enableLive`). Until then its participant page, channels and display link are a 404.
- **Server-authoritative polls**: single choice, multiple choice (up to `max_choices`), rating (1…`rating_scale`), word cloud (normalized words, at most `MAX_WORDS` distinct; counts only). States move forward only: draft → open → closed. "Show results" is a separate switch. Ballots (`poll_ballots`) keep no choice; only `poll_tallies` and `polls.ballots` move.
- **One vote per person per poll**: the unique `(org_id, poll_id, participant_key)` decides under concurrency, inside a transaction holding the poll row (so no vote lands after it closed). A second ballot is `conflict` / `already_voted`.
- **Participants are never stored by identity.** `participant_key` is an HMAC (app token secret) of the signed-in user's id or the device cookie (`yy_did`), scoped to the session (`participantKey`), so keys can't be linked across sessions.
- **Moderated Q&A**: every question starts `pending`; moderators approve, dismiss, mark answered (and back), and pin one approved question. One upvote per participant per approved question. At most `QUESTION_RATE` questions per participant per session per 10 minutes (`rate_limited`), `MAX_QUESTIONS_PER_SESSION` per session.
- **Unapproved questions never reach public payloads**: public DTOs (`PublicQuestionDto`, `PublicLiveStateDto`) and the `session.live` channel carry approved questions only; a question that stops being approved is removed from screens (`question-removed`). Pending and dismissed bodies are `personal` in `private-columns.ts` (canary-seeded).
- **Anonymous questions**: the audience never sees a name. The name is kept only when the session's policy is `moderators`; switching to `hidden` erases the names already kept.
- **Realtime** over the M3.1b publisher, session-scoped channels `org:{org}:event:{event}:session:{session}:live` (public: approved questions and shown results; the signed display link) and `…:moderation` (members with `events:read`). Every message is the full allowlisted shape; snapshots (`publicSnapshotTx`, `moderationSnapshotTx`) make a reconnecting screen whole.
- **Big-screen link**: `signDisplayToken` (`{org}~{session}~{version}~{hmac}`); `displaySession` checks the signature and the session's current `display_version` through `engagement.display_target` (SECURITY DEFINER, live orgs only, ids and version only). `rotateDisplayLink` revokes every earlier link.
- Entitlement `sessions`. Organizer writes need `events:write`, the console reads `events:read`, the audience `public:engagement` (published, non-private events only). `deletePoll` is a `delete` command (refused while impersonating).
- **Engagement scores (M5.7b).** `engagement_events` logs what an attendee (a crm contact with an active attendee record at the event) did: `check_in`, `poll_vote`, `question`, `feedback`, `enrollment`; unique per (contact, kind, source ref), so nothing counts twice; never a choice, an answer, an upvote or an anonymous question. Live votes and named questions are logged by their commands only when the actor is the signed-in account passed in `account` (contact by account link, else email); ballots and questions themselves stay keyed by the HMAC participant key. The `engagement.activity` subscriber logs `ticket.admitted@1` (undone by `ticket.admission_undone@1`), `survey.responded@1` (needs its `contactId`), `registration.session.promoted@1` and `registration.session.enrollment_changed@1` (a drop takes the fact back). Score = Σ weight × count (`domain/score.ts`; check-in counts once per event); weights per org in `score_weights` (0–100, defaults otherwise; `org:update` to change, which rescores the whole org at once). Each change writes the contact's score to `crm.event_engagement` in the same transaction (audiences segment on it). `eventScoresQuery` needs `attendees:read`. Composite FKs to `crm.contacts` (cascade), `events.events` (cascade) and `program.sessions` (set null) are hand-written.
- Events emitted: `engagement.vote_cast@1` (`{ eventId, sessionId, pollId }`) and `engagement.question_asked@1` (`{ eventId, sessionId, questionId }`), for M5.7b engagement scores. No participant data.

**Networking (M5.8a)** — `src/networking/`, `src/domain/networking.ts`
- **Opt-in twice:** the organizer turns networking on per event (`network_settings`, off by default) and each attendee opts in (`network_profiles.opted_in`, off by default). A person appears only while opted in, not hidden by the organizer, and still holding an active place at the event (`@yayatoh/attendees`). Everyone else is a 404 on every read, the same as someone who isn't there.
- **Attendees are verified addresses, not members.** Attendee commands and queries (`public:networking`) take the address the web app proved (the M1.5f emailed code) and resolve it to the person's contact and active place in the transaction; a profile id from the browser is never trusted as the viewer.
- **Allowlists:** attendee DTOs show another person only as their chosen profile (name, job title, company, interests, bio); no email, contact, attendee or ticket id. Organizers see counts, places, slots and reports (two display names, reason, details), never the directory or anyone's requests.
- **A location never double-books:** accepting a meeting holds the location row and both profiles (id order), takes the lowest free table `1…capacity` for the slot, and the partial unique key `(org, location, slot, table) where accepted` refuses a second meeting at a held table. A person has at most one accepted meeting per slot. Capacity can't go below a table in use; places and slots with live meetings can't be deleted.
- **Block and report:** blocking withdraws requests between the two, removes their connection and cancels meetings ahead; neither sees the other again. Reporting also blocks; the organizer hides (every open report about the person closes, their requests and meetings ahead end) or dismisses. Opting out ends waiting requests and meetings ahead too.
- Events emitted: `engagement.connection_accepted@1` (`{ eventId, connectionId }`), `engagement.meeting_accepted@1` (`{ eventId, meetingId, slotId, locationId }`). Ids only.
- **Matchmaking (M6.12b)** — `src/networking/matchmaking.ts`. `network_embeddings` holds one pgvector `vector(512)` per **listed** profile (composite FK, cascade), made from its public fields (headline, company, interests, bio; `profileEmbeddingText`). Opting out, being hidden (`leaveNetworkTx`), editing the profile and erasure delete it in the same transaction (`dropEmbeddingTx`). `suggestedMatchesQuery` (`public:networking`) is an exact cosine search (`operator(extensions.<=>)`) within the event that re-checks both sides are listed, attending and not blocked, and leaves out people already connected; it explains a match with shared interests and a 0–100 score. No ANN index on purpose: an event's directory is small and a filtered ANN scan can drop people. The vectors come from the ai module (tier 6) through `pendingEmbeddingsQuery` / `storeEmbeddingsCommand` (`events:write`).


**Chat (M5.8b)** — `src/chat/`, `src/domain/chat.ts`
- **Who may write (P5-3):** a direct chat only between two listed people (opted in, not hidden, still attending, no block either way) with an **accepted connection or an agreed meeting**; booth chat between a listed attendee and a listed exhibitor at a booth whose admin turned booth chat on (`booth_chat_settings`, off by default) and the organizer has not suspended. The organizer's `network_settings.chat_enabled` switches both. Everything else is refused, and nothing is stored: a blocked or hidden person is `not_found` (the same as someone who isn't there), unconnected people are `forbidden` / `not_connected`.
- **A blocked person's messages never deliver:** a send holds both profiles (lowest id first, `FOR NO KEY UPDATE` so a block's FK checks can't deadlock with it) and re-reads blocks under the locks; a booth send holds the attendee's profile, then the booth's settings, then the conversation (the booth's commands take settings then conversation). A block committed first is always seen.
- **One conversation per pair** (`chat_conversations`: `direct` keeps `profile_a < profile_b`; `booth` is attendee + exhibitor), unique in the database; concurrent first messages share one row. Messages are stored with the database's time; each side's last read marks unread.
- **Delivery** over the M3.1b log, in the sending transaction (nothing delivers unless it commits), to the two sides' **inbox channels**: `org:{org}:event:{event}:inbox:{profile}:chat` (an attendee) and `…:inbox:{exhibitor}:booth-chat` (an exhibitor's people). Inbox channels are `access: { own: true }`: the generic realtime attach refuses them; only the web app's stream routes attach them, after proving the caller owns the inbox (`attendeeChatChannel`, `exhibitorChatChannel`, `chatAttachAllowed`). Payloads are allowlisted (`ChatWireMessageDto`: the text, which side, the time).
- **Limits** (`chatRefusal`, counted under the sender's lock): 10 a minute and 120 an hour per attendee, 20 new chats an hour, 5 unanswered in a row; a booth 30 a minute. `rate_limited` with the limit as the reason.
- **Reports** (`chat_reports`) from either side also block (a person: the M5.8a block; a booth chat: `blocked_by`). The organizer sees only reported conversations, as an excerpt (`chatConsoleQuery`), removes a message (`removeChatMessage`, `delete` category, reported conversations only), hides the reported person (`hideProfileTx`) or suspends the reported booth, or dismisses (`moderation`). Yayatoh staff review them in the M1.10d queue (`chatReportsForReviewTx` through platform_reader, `reviewChatReportCommand`). A report about an attendee emits `engagement.chat_reported@1` (`{ orgId, eventId, reportId, contactId, reason }`, never the details) → checkin's `chat_abuse` fraud signal.
- **Retention (D11):** `chatRetentionCommand` (the worker's daily pass) deletes conversations of events that ended 24 months ago, with their messages and reports.
- Events emitted: `engagement.chat_started@1` (`{ eventId, conversationId, kind }`), `engagement.chat_reported@1`. Organizers never see chats that nobody reported; exhibitors see a visitor only as their chosen profile basics.


### Source index

- [packages/modules/engagement/src/chat/attendee.ts](../../packages/modules/engagement/src/chat/attendee.ts)
- [packages/modules/engagement/src/chat/console.ts](../../packages/modules/engagement/src/chat/console.ts)
- [packages/modules/engagement/src/chat/dto.ts](../../packages/modules/engagement/src/chat/dto.ts)
- [packages/modules/engagement/src/chat/exhibitor.ts](../../packages/modules/engagement/src/chat/exhibitor.ts)
- [packages/modules/engagement/src/chat/realtime.ts](../../packages/modules/engagement/src/chat/realtime.ts)
- [packages/modules/engagement/src/chat/review.ts](../../packages/modules/engagement/src/chat/review.ts)
- [packages/modules/engagement/src/chat/state.ts](../../packages/modules/engagement/src/chat/state.ts)
- [packages/modules/engagement/src/chat/stream.ts](../../packages/modules/engagement/src/chat/stream.ts)
- [packages/modules/engagement/src/client.ts](../../packages/modules/engagement/src/client.ts)
- [packages/modules/engagement/src/commands.ts](../../packages/modules/engagement/src/commands.ts)
- [packages/modules/engagement/src/contact-merge.ts](../../packages/modules/engagement/src/contact-merge.ts)
- [packages/modules/engagement/src/data-subject.ts](../../packages/modules/engagement/src/data-subject.ts)
- [packages/modules/engagement/src/domain/chat.ts](../../packages/modules/engagement/src/domain/chat.ts)
- [packages/modules/engagement/src/domain/kinds.ts](../../packages/modules/engagement/src/domain/kinds.ts)
- [packages/modules/engagement/src/domain/networking.ts](../../packages/modules/engagement/src/domain/networking.ts)
- [packages/modules/engagement/src/domain/polls.ts](../../packages/modules/engagement/src/domain/polls.ts)
- [packages/modules/engagement/src/domain/questions.ts](../../packages/modules/engagement/src/domain/questions.ts)
- [packages/modules/engagement/src/domain/score.ts](../../packages/modules/engagement/src/domain/score.ts)
- [packages/modules/engagement/src/domain/tokens.ts](../../packages/modules/engagement/src/domain/tokens.ts)
- [packages/modules/engagement/src/dto.ts](../../packages/modules/engagement/src/dto.ts)
- [packages/modules/engagement/src/index.ts](../../packages/modules/engagement/src/index.ts)
- [packages/modules/engagement/src/networking/attendee.ts](../../packages/modules/engagement/src/networking/attendee.ts)
- [packages/modules/engagement/src/networking/console.ts](../../packages/modules/engagement/src/networking/console.ts)
- [packages/modules/engagement/src/networking/dsar.ts](../../packages/modules/engagement/src/networking/dsar.ts)
- [packages/modules/engagement/src/networking/dto.ts](../../packages/modules/engagement/src/networking/dto.ts)
- [packages/modules/engagement/src/networking/matchmaking.ts](../../packages/modules/engagement/src/networking/matchmaking.ts)
- [packages/modules/engagement/src/networking/public.ts](../../packages/modules/engagement/src/networking/public.ts)
- [packages/modules/engagement/src/networking/state.ts](../../packages/modules/engagement/src/networking/state.ts)
- [packages/modules/engagement/src/participate.ts](../../packages/modules/engagement/src/participate.ts)
- [packages/modules/engagement/src/private-columns.ts](../../packages/modules/engagement/src/private-columns.ts)
- [packages/modules/engagement/src/realtime.ts](../../packages/modules/engagement/src/realtime.ts)
- [packages/modules/engagement/src/schema.ts](../../packages/modules/engagement/src/schema.ts)
- [packages/modules/engagement/src/scores.ts](../../packages/modules/engagement/src/scores.ts)
- [packages/modules/engagement/src/state.ts](../../packages/modules/engagement/src/state.ts)

## events

Tier 2; 43 source files; 8 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/venues.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/tenancy, @yayatoh/venues.

Tables detected: see schema source.

Event type literals detected: event.announcement_published, event.created, event.occurrence_cancelled, event.occurrences_added, event.occurrences_updated, event.short_link_changed, event.updated, portal, portal.account_invited, series.created, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| events.orgCategories | events:read | core | [source](../../packages/modules/events/src/categories.ts#L179) |
| events.addOrgCategory | org:update | core | [source](../../packages/modules/events/src/categories.ts#L224) |
| events.renameOrgCategory | org:update | core | [source](../../packages/modules/events/src/categories.ts#L251) |
| events.setOrgCategoryHidden | org:update | core | [source](../../packages/modules/events/src/categories.ts#L268) |
| events.moveOrgCategory | org:update | core | [source](../../packages/modules/events/src/categories.ts#L295) |
| events.checklist | events:read | core | [source](../../packages/modules/events/src/checklist.ts#L68) |
| events.addChecklistItem | events:write | core | [source](../../packages/modules/events/src/checklist.ts#L77) |
| events.setChecklistItemDone | events:write | core | [source](../../packages/modules/events/src/checklist.ts#L114) |
| events.deleteChecklistItem | events:write | core | [source](../../packages/modules/events/src/checklist.ts#L141) |
| events.privateInfo | events:write | core | [source](../../packages/modules/events/src/commands/access.ts#L45) |
| events.setPrivateInfo | events:write | core | [source](../../packages/modules/events/src/commands/access.ts#L66) |
| events.createAccessCode | events:write | access_codes | [source](../../packages/modules/events/src/commands/access.ts#L152) |
| events.setAccessCodeActive | events:write | access_codes | [source](../../packages/modules/events/src/commands/access.ts#L187) |
| events.listAccessCodes | events:write | access_codes | [source](../../packages/modules/events/src/commands/access.ts#L210) |
| events.redeemAccessCode | public:access_code | access_codes | [source](../../packages/modules/events/src/commands/access.ts#L238) |
| events.sections | events:read | core | [source](../../packages/modules/events/src/commands/content.ts#L48) |
| events.addSection | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L59) |
| events.updateSection | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L108) |
| events.deleteSection | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L153) |
| events.reorderSections | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L183) |
| events.announcements | events:read | core | [source](../../packages/modules/events/src/commands/content.ts#L244) |
| events.createAnnouncement | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L278) |
| events.updateAnnouncement | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L303) |
| events.deleteAnnouncement | events:write | core | [source](../../packages/modules/events/src/commands/content.ts#L349) |
| events.setEventCurrency | events:write | core | [source](../../packages/modules/events/src/commands/currency.ts#L21) |
| events.eventDetails | events:read | core | [source](../../packages/modules/events/src/commands/details.ts#L59) |
| events.setEventDetails | events:write | core | [source](../../packages/modules/events/src/commands/details.ts#L73) |
| events.orgTags | events:read | core | [source](../../packages/modules/events/src/commands/details.ts#L157) |
| events.searchEvents | events:read | core | [source](../../packages/modules/events/src/commands/details.ts#L185) |
| events.eventLabels | events:read | core | [source](../../packages/modules/events/src/commands/details.ts#L267) |
| events.createEvent | events:write | core | [source](../../packages/modules/events/src/commands/events.ts#L28) |
| events.updateEvent | events:write | core | [source](../../packages/modules/events/src/commands/events.ts#L65) |
| events.transitionEvent | events:write | core | [source](../../packages/modules/events/src/commands/events.ts#L116) |
| events.assignEventRole | members:manage | core | [source](../../packages/modules/events/src/commands/events.ts#L166) |
| events.shortLinks | events:read | core | [source](../../packages/modules/events/src/commands/short-links.ts#L33) |
| events.ensureShortLink | events:write | core | [source](../../packages/modules/events/src/commands/short-links.ts#L48) |
| events.setVanityShortLink | events:write | core | [source](../../packages/modules/events/src/commands/short-links.ts#L66) |
| events.addOccurrences | events:write | core | [source](../../packages/modules/events/src/occurrences.ts#L133) |
| events.previewOccurrences | events:write | core | [source](../../packages/modules/events/src/occurrences.ts#L187) |
| events.addRecurringOccurrences | events:write | core | [source](../../packages/modules/events/src/occurrences.ts#L206) |
| events.updateOccurrence | events:write | core | [source](../../packages/modules/events/src/occurrences.ts#L244) |
| events.cancelOccurrence | events:write | core | [source](../../packages/modules/events/src/occurrences.ts#L340) |
| events.listOccurrences | events:read | core | [source](../../packages/modules/events/src/occurrences.ts#L373) |
| events.listEvents | events:read | core | [source](../../packages/modules/events/src/queries.ts#L15) |
| events.getEvent | events:read | core | [source](../../packages/modules/events/src/queries.ts#L45) |
| events.getEventBySlug | events:read | core | [source](../../packages/modules/events/src/queries.ts#L58) |
| events.seriesDetail | events:read | core | [source](../../packages/modules/events/src/series-events.ts#L43) |
| events.eventSeries | events:read | core | [source](../../packages/modules/events/src/series-events.ts#L78) |
| events.createEventInSeries | events:write | core | [source](../../packages/modules/events/src/series-events.ts#L100) |
| events.createSeries | events:write | core | [source](../../packages/modules/events/src/series.ts#L69) |
| events.updateSeries | events:write | core | [source](../../packages/modules/events/src/series.ts#L103) |
| events.deleteSeries | events:write | core | [source](../../packages/modules/events/src/series.ts#L129) |
| events.setEventSeries | events:write | core | [source](../../packages/modules/events/src/series.ts#L145) |
| events.listSeries | events:read | core | [source](../../packages/modules/events/src/series.ts#L171) |
| events.team | event_team:read | core | [source](../../packages/modules/events/src/team.ts#L92) |
| events.inviteTeamMember | event_team:manage | core | [source](../../packages/modules/events/src/team.ts#L113) |
| events.revokeTeamInvitation | event_team:manage | core | [source](../../packages/modules/events/src/team.ts#L143) |
| events.changeTeamRole | event_team:manage | core | [source](../../packages/modules/events/src/team.ts#L178) |
| events.removeTeamMember | event_team:manage | core | [source](../../packages/modules/events/src/team.ts#L200) |
| events.myTeamEvents | org:read | core | [source](../../packages/modules/events/src/team.ts#L258) |
| events.teamEventBySlug | org:read | core | [source](../../packages/modules/events/src/team.ts#L309) |

### Feature rules and lifecycle

#### events (tier 2)

Events, their lifecycle and event-scoped roles. Owns Postgres schema `events`.

**Invariants**
- Status changes only through the lifecycle (`domain/lifecycle.ts`) with a conditional `UPDATE … WHERE status = ANY(from)`; every transition is audited and emits `event.<transition>@1`.
- Slugs are global (public URL `yayatoh.com/events/{slug}`), lowercase, and frozen once the event has been published.
- Times are `timestamptz`; the event's IANA `timezone` is how they render (CLAUDE.md → Time). `ends_at > starts_at`.
- Public reads go only through `events.public_event(slug)` (SECURITY DEFINER, allowlisted columns); private events and drafts are never returned.
- Event-scoped roles (`event_role_assignments`) grant access to one event only and may expire.
- **Dates (M1.4b):** `occurrences` are the dates of a multi-date event (`scheduled` or `cancelled`, optional capacity). With any, the event's `starts_at`/`ends_at` are kept equal to the span of its scheduled dates (`syncEventSpanTx`). At most 366 scheduled dates; no two scheduled dates start at the same instant. Dates are cancelled, never deleted.
- Recurrence (`domain/recurrence.ts`) is expanded in the event's wall-clock time with `zonedTimeToUtc`, so times stay put across DST; "this and following" keeps each date's local day. Rules are not stored.
- **Series (M1.4b):** global slugs (`/series/{slug}`); an event is in at most one series (`series_events`). Public reads only through `events.public_series` / `events.public_series_events` (active orgs, public upcoming events, allowlisted columns); public dates only through `events.public_occurrences` (sold out yes/no, never capacity numbers).
- **Series ↔ events (U7):** `events.createEventInSeries` creates the event and joins (or creates) its series in one transaction; a taken series address is a `conflict` on the `series` field. `seriesDetailQuery` (by slug) lists a series' events of any status; `eventSeriesQuery` names an event's series. The public event page links its series through `publicEventSeries(target)` (the target from `pageTarget`, read under that org's RLS, slug and name only).


**M1.4c/d content and access**
- Venues belong to the `venues` module (tier 1); an event points at one with `venue_id` (composite FK). Picking a venue copies its name, city and country into the free-text fields, which stay what pages show (expand step; the free-text fields keep working without a venue).
- Categories are the platform taxonomy `EVENT_CATEGORIES` (a CHECK on `events.category`); tags are per org (`event_tags`, unique per event case-insensitively via `tag_key`, at most 10 per event).
- Content sections (`event_sections`) are typed per kind (Zod `SectionBody`), kept in dense `position` order; reorder takes either the full order (drag) or one step (keyboard), and a stale order is a `conflict`.
- Organizer text is a small Markdown subset parsed to a tree (`domain/markdown.ts`) and rendered as React elements: raw HTML stays text; only http(s)/mailto links survive.
- Announcements publish/unpublish; each publish emits `event.announcement_published@1` for notifications (M1.10). No email is sent here. `holders` announcements never reach public reads.
- `event_private_info` (private info and the online join link) is never read by a public function or serializer. Holders get it through `holderEventContent`, called only after a manage/holder link was verified and the holder has a live ticket. The join link shows from `join_opens_minutes` before the start until the end, for online/hybrid events only. Reading it in the console needs `events:write`.
- Access codes are stored upper-case and matched case-insensitively; wrong, expired, inactive and used-up codes get one answer and count as a failed attempt; `ACCESS_ATTEMPTS_PER_WINDOW` failures per client key and event in `ACCESS_ATTEMPT_WINDOW_MS` → `rate_limited`. A success counts one use atomically; a visitor who already unlocked keeps access until expiry or deactivation. Listing codes needs `events:write`.
- Short links (`short_links`) are global (unique `code`), lower-case, one automatic code per event (created with the event) and at most one vanity code; `/e/{code}` resolves only for events with a public page (`events.short_link_target`).
- Public reads for this content: `events.public_event_v2`, `events.page_target`, `events.access_target`, `events.short_link_target`, `events.public_events_at_venue` (SECURITY DEFINER, allowlisted columns).
- **Event teams (M4.2a, P4-8):** `co_host` and `planner` are team roles in `event_role_assignments`; a person holds at most one team role per event (`grantTeamRoleTx` replaces). Invitations reuse `tenancy.invitations` (`event_id`, `event_role`) and its token rules; accepting grants the role through the `EventRoleGranter` port. Removing someone's last event role in an org removes a `collaborator` membership. `teamEventBySlugQuery` and `myTeamEventsQuery` serve collaborators, who have no org-wide `events:read`. `events.invitation_event` (SECURITY DEFINER) names the event on the accept page.
- M5.3a portal accounts (P5-7): `portal_accounts` (one event role at one event for one program row; its `event_role_assignments` row has `user_id` = the account id and expires with the event + 90 days), `portal_challenges` and `portal_sessions` (HMACs only). The org comes from the signed invitation or the session cookie. `portalPrincipalTx` re-checks the account in every portal command; the kernel actor `portal` may only hold `portal:{role}`. Invitations are emailed by `events.portal-invite-mailer` (`portal.account_invited@1`, no token in the event).
- **Currency (U9):** chosen at creation; `events.setEventCurrency` changes it until the first order. Orders reference `(org_id, event_id, currency)` (unique `events_org_id_currency_key`), so the database refuses a change once any order exists (`invalid_state` / `currency_locked`); ticket types and promo codes follow by cascade.


### Source index

- [packages/modules/events/src/categories.ts](../../packages/modules/events/src/categories.ts)
- [packages/modules/events/src/checklist.ts](../../packages/modules/events/src/checklist.ts)
- [packages/modules/events/src/commands/access.ts](../../packages/modules/events/src/commands/access.ts)
- [packages/modules/events/src/commands/content.ts](../../packages/modules/events/src/commands/content.ts)
- [packages/modules/events/src/commands/currency.ts](../../packages/modules/events/src/commands/currency.ts)
- [packages/modules/events/src/commands/details.ts](../../packages/modules/events/src/commands/details.ts)
- [packages/modules/events/src/commands/events.ts](../../packages/modules/events/src/commands/events.ts)
- [packages/modules/events/src/commands/short-links.ts](../../packages/modules/events/src/commands/short-links.ts)
- [packages/modules/events/src/copy-content.ts](../../packages/modules/events/src/copy-content.ts)
- [packages/modules/events/src/copy.ts](../../packages/modules/events/src/copy.ts)
- [packages/modules/events/src/crm-event-rows.ts](../../packages/modules/events/src/crm-event-rows.ts)
- [packages/modules/events/src/data-subject.ts](../../packages/modules/events/src/data-subject.ts)
- [packages/modules/events/src/delivery.ts](../../packages/modules/events/src/delivery.ts)
- [packages/modules/events/src/domain/access-code.ts](../../packages/modules/events/src/domain/access-code.ts)
- [packages/modules/events/src/domain/categories.ts](../../packages/modules/events/src/domain/categories.ts)
- [packages/modules/events/src/domain/content-kinds.ts](../../packages/modules/events/src/domain/content-kinds.ts)
- [packages/modules/events/src/domain/lifecycle.ts](../../packages/modules/events/src/domain/lifecycle.ts)
- [packages/modules/events/src/domain/markdown.ts](../../packages/modules/events/src/domain/markdown.ts)
- [packages/modules/events/src/domain/org-categories.ts](../../packages/modules/events/src/domain/org-categories.ts)
- [packages/modules/events/src/domain/portal-auth.ts](../../packages/modules/events/src/domain/portal-auth.ts)
- [packages/modules/events/src/domain/recurrence.ts](../../packages/modules/events/src/domain/recurrence.ts)
- [packages/modules/events/src/domain/sections.ts](../../packages/modules/events/src/domain/sections.ts)
- [packages/modules/events/src/domain/short-code.ts](../../packages/modules/events/src/domain/short-code.ts)
- [packages/modules/events/src/dto-content.ts](../../packages/modules/events/src/dto-content.ts)
- [packages/modules/events/src/dto.ts](../../packages/modules/events/src/dto.ts)
- [packages/modules/events/src/index.ts](../../packages/modules/events/src/index.ts)
- [packages/modules/events/src/integration-sync.ts](../../packages/modules/events/src/integration-sync.ts)
- [packages/modules/events/src/listing-facts.ts](../../packages/modules/events/src/listing-facts.ts)
- [packages/modules/events/src/occurrences.ts](../../packages/modules/events/src/occurrences.ts)
- [packages/modules/events/src/portal.ts](../../packages/modules/events/src/portal.ts)
- [packages/modules/events/src/private-columns.ts](../../packages/modules/events/src/private-columns.ts)
- [packages/modules/events/src/public-content.ts](../../packages/modules/events/src/public-content.ts)
- [packages/modules/events/src/queries.ts](../../packages/modules/events/src/queries.ts)
- [packages/modules/events/src/schema-checklist.ts](../../packages/modules/events/src/schema-checklist.ts)
- [packages/modules/events/src/schema-content.ts](../../packages/modules/events/src/schema-content.ts)
- [packages/modules/events/src/schema-portal.ts](../../packages/modules/events/src/schema-portal.ts)
- [packages/modules/events/src/schema.ts](../../packages/modules/events/src/schema.ts)
- [packages/modules/events/src/series-events.ts](../../packages/modules/events/src/series-events.ts)
- [packages/modules/events/src/series.ts](../../packages/modules/events/src/series.ts)
- [packages/modules/events/src/team.ts](../../packages/modules/events/src/team.ts)
- [packages/modules/events/src/testing.ts](../../packages/modules/events/src/testing.ts)
- [packages/modules/events/src/timings.ts](../../packages/modules/events/src/timings.ts)
- [packages/modules/events/src/ui.ts](../../packages/modules/events/src/ui.ts)

## forms

Tier 1; 13 source files; 3 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: form.registration_submitted, form.resume_requested, system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| forms.publishForm | events:write | ticketing | [source](../../packages/modules/forms/src/forms.ts#L151) |
| forms.getForm | events:read | ticketing | [source](../../packages/modules/forms/src/forms.ts#L175) |
| forms.listResponses | orders:read | ticketing | [source](../../packages/modules/forms/src/forms.ts#L326) |
| forms.publishRegistrationForm | events:write | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L73) |
| forms.getRegistrationForm | events:read | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L120) |
| forms.listJobTitles | events:read | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L154) |
| forms.setJobTitles | events:write | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L166) |
| forms.startRegistrationForm | public:registration_form | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L386) |
| forms.saveRegistrationPage | public:registration_form | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L506) |
| forms.submitRegistrationForm | public:registration_form | registration | [source](../../packages/modules/forms/src/registration-forms.ts#L576) |

### Feature rules and lifecycle

#### forms (tier 1)

Organizer-defined questions: event checkout questions, survey questions (M3.9a, `@yayatoh/surveys`) and multi-page registration forms (M5.1b). Owns Postgres schema `forms`.

**Invariants**
- A form belongs to one subject (`subject_type`, `subject_id`) and kind; every change writes a new, immutable `form_versions` row. Responses point at the exact version answered, so later edits never reinterpret old answers.
- Definitions are validated on publish (unique keys, options only on choice fields, conditions limited to a safe JsonLogic subset: `var == != > >= < <= in and or !`).
- Answers are validated server-side against the current version; fields hidden by their condition are dropped, unknown keys rejected. Sensitive answers are stored as one KeyVault envelope.
- Question types per kind: checkout questions use `FIELD_TYPES`; surveys add the `rating` (1–5) and `nps` (0–10) scales and never hold sensitive answers (both checked on publish).
- v1 stores a response's answers as JSON on the response row; a normalized `form_answers` table arrives with reporting (M3+).

**Registration forms (M5.1b, kind `registration`)**
- Pages (1–20) with questions, page conditions and per-registration-type limits. Registration types are opaque ids the caller supplies (`registrationTypeId`); this module never reads another module's types. Conditions only read earlier questions (checked on publish).
- The server recomputes the path (`checkRegistrationAnswers`) and **rejects** any answer off it, naming the question (the checkout and survey kinds keep dropping hidden answers). Required questions are enforced on visible pages.
- `forms.respondents`: one row per person, pinned to the version they started; draft answers (sensitive ones in one KeyVault envelope) until submit, then one `form_responses` row (respondent `form_respondent`) and the draft emptied. The link is `<id>~<hmac>` (purpose `forms.respondent`); `forms.respondent_org()` (SECURITY DEFINER, ids of live orgs) resolves the org. Drafts expire 14 days after the last save and are deleted by retention.
- Consent questions pin a crm consent term and version; checked boxes are recorded through the `recordConsent` port (`@yayatoh/crm` `recordTermConsentTx`) on submit, unchecked ones record nothing.
- `forms.job_titles` (the org's list) and `forms.companies` (names submitted, counted; suggested only from two respondents up).
- Publishing takes an optional `expectedVersion`: a publish from a stale version is a `conflict` (`stale_version`).

**RSVP questions (M4.1e, kind `rsvp`)**
- One form per event; questions with the checkout types plus `meal` (the guests module's menu supplies the options), an optional sub-event, an optional write-back (`dietary` / `accessibility`, text only, always private) and a condition on the guest's context (`attending`, `age_class`, `is_plus_one`, `plus_one_named`) or earlier answers. One meal question; context keys are reserved.
- `rsvpVisible` (client-safe) decides what a guest sees; `checkRsvpAnswers` is the server's authority and **rejects** answers to questions the guest can't see. Unnamed plus-ones and uninvited guests see nothing.
- Responses are per guest (`respondent_type = 'guest'`, an id the guests module owns): the newest replaces the earlier one; private answers in one KeyVault envelope; write-back answers are not stored here (the guest owns them). The guests module runs all of this inside its own commands.


### Source index

- [packages/modules/forms/src/data-subject.ts](../../packages/modules/forms/src/data-subject.ts)
- [packages/modules/forms/src/definition.ts](../../packages/modules/forms/src/definition.ts)
- [packages/modules/forms/src/dsar.ts](../../packages/modules/forms/src/dsar.ts)
- [packages/modules/forms/src/forms.ts](../../packages/modules/forms/src/forms.ts)
- [packages/modules/forms/src/index.ts](../../packages/modules/forms/src/index.ts)
- [packages/modules/forms/src/private-columns.ts](../../packages/modules/forms/src/private-columns.ts)
- [packages/modules/forms/src/registration-forms.ts](../../packages/modules/forms/src/registration-forms.ts)
- [packages/modules/forms/src/registration.ts](../../packages/modules/forms/src/registration.ts)
- [packages/modules/forms/src/rsvp-forms.ts](../../packages/modules/forms/src/rsvp-forms.ts)
- [packages/modules/forms/src/rsvp.ts](../../packages/modules/forms/src/rsvp.ts)
- [packages/modules/forms/src/schema.ts](../../packages/modules/forms/src/schema.ts)
- [packages/modules/forms/src/testing.ts](../../packages/modules/forms/src/testing.ts)
- [packages/modules/forms/src/ui.ts](../../packages/modules/forms/src/ui.ts)

## gallery

Tier 5; 15 source files; 1 test files.

Declared connections: @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/platform.

Source imports: @yayatoh/db, @yayatoh/events, @yayatoh/guests, @yayatoh/kernel, @yayatoh/media, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| gallery.hostGallery | guests:read | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L368) |
| gallery.saveSettings | guests:write | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L412) |
| gallery.requestUpload | guests:write | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L504) |
| gallery.requestGuestUpload | public:gallery | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L520) |
| gallery.completeUpload | guests:write | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L628) |
| gallery.completeGuestUpload | public:gallery | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L643) |
| gallery.addVideo | guests:write | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L710) |
| gallery.addGuestVideo | public:gallery | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L725) |
| gallery.moderate | guests:write | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L752) |
| gallery.removeItem | guests:write | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L796) |
| gallery.removeOwnItem | public:gallery | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L821) |
| gallery.publicGallery | public:gallery | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L852) |
| gallery.hostSlides | guests:read | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L903) |
| gallery.publicSlides | public:gallery | gallery | [source](../../packages/modules/gallery/src/gallery.ts#L917) |

### Feature rules and lifecycle

#### gallery (tier 5)

The event gallery (M4.5b, P4-5, P4-6): photos and video links from guests and hosts, the moderation queue, the per-event storage cap and per-guest quota, and the live slideshow's feed. Owns Postgres schema `gallery`. Tier 5: it reads `guests` (tier 3: the guest site's password gate) and `media` (tier 4: storage and the re-encoding pipeline) and `events`; nothing imports it but the apps.

**Invariants**
- **Access.** Guests reach the gallery only through the event's published guest site (`/w/{code}/gallery`) and only past its password: every public command and query calls `guestSiteAccessTx` (guests) with the site's access proof and refuses a locked visitor (`forbidden`/`locked`), a closed gallery (`invalid_state`/`gallery_closed`) and an unpublished site (`not_found`). The tenant comes from the site address (`guests.site_target`), never a header. Hosts need `guests:read` to see and `guests:write` to change (co-hosts and planners through the `guests:*` event role); entitlement `gallery`.
- **Uploads go straight to storage.** A slot (`requestUpload` / `requestGuestUpload`) is a presigned PUT for exactly the declared size (`MediaStore.presignPut`, R2) or, on the Postgres store (dev, CI), the app's `/api/gallery/direct/{token}` route, which stores the bytes unread. Completing (`completeUpload` / `completeGuestUpload`) reads the staged object, checks its size, sniffs it (JPEG, PNG, GIF, WebP, AVIF; **HEIC** through the `HeicDecoder` port; never SVG) and re-encodes it with the media pipeline (EXIF/GPS never survive); the staging object is deleted after commit. Slots expire after an hour (`purgeExpiredGalleryUploads`).
- **Cap and quota (P4-6).** Placeholders until the owner sets numbers (`GALLERY_LIMITS`: 5 GiB per event, 250 MiB and 50 items per guest, 25 MB per upload, 5,000 items per event); a host may only lower them. Usage = stored bytes of processed photos + declared bytes of open slots. Checked under the event's advisory lock when a slot is handed out (declared size, `conflict` with `event_cap`/`guest_bytes`/`guest_items`/`event_items`) and again on completion (stored size; the photo is deleted and the answer is `refused` with the reason). Exactly at the cap is allowed.
- **Moderation (P4-6).** Guest uploads are `pending` until a host approves them unless the event's mode is `auto`; host uploads publish at once. Rejecting or removing deletes the rows and, after commit, the files. A guest may take back their own items (uploader cookie).
- **Privacy (P4-3).** Uploader names and captions are personal; items are read only through allowlisted DTOs (`GalleryItemDto`) with **signed file URLs** valid to the end of the next UTC day; the file route also checks that the item still exists. Nothing here creates contacts, consents or audience members, emits domain events, or reaches the marketplace.
- **Video (P4-5).** Links only: YouTube and Vimeo URLs are parsed to a provider and id; the pasted URL is never stored and pages get a canonical https link. The `VideoHost` port has a Cloudflare Stream stub (owner inbox).
- **Live slideshow.** `event.gallery` realtime channel (log), ids and states only (`item`: published/removed); clients re-read `hostSlides` / `publicSlides`. Members attach through the realtime route (`guests:read`); guests through `/api/gallery/stream/{code}` after the password check.


### Source index

- [packages/modules/gallery/src/client.ts](../../packages/modules/gallery/src/client.ts)
- [packages/modules/gallery/src/data-subject.ts](../../packages/modules/gallery/src/data-subject.ts)
- [packages/modules/gallery/src/domain/heic.ts](../../packages/modules/gallery/src/domain/heic.ts)
- [packages/modules/gallery/src/domain/limits.ts](../../packages/modules/gallery/src/domain/limits.ts)
- [packages/modules/gallery/src/domain/tokens.ts](../../packages/modules/gallery/src/domain/tokens.ts)
- [packages/modules/gallery/src/domain/video.ts](../../packages/modules/gallery/src/domain/video.ts)
- [packages/modules/gallery/src/dto.ts](../../packages/modules/gallery/src/dto.ts)
- [packages/modules/gallery/src/files.ts](../../packages/modules/gallery/src/files.ts)
- [packages/modules/gallery/src/gallery.ts](../../packages/modules/gallery/src/gallery.ts)
- [packages/modules/gallery/src/index.ts](../../packages/modules/gallery/src/index.ts)
- [packages/modules/gallery/src/ports.ts](../../packages/modules/gallery/src/ports.ts)
- [packages/modules/gallery/src/private-columns.ts](../../packages/modules/gallery/src/private-columns.ts)
- [packages/modules/gallery/src/realtime.ts](../../packages/modules/gallery/src/realtime.ts)
- [packages/modules/gallery/src/schema.ts](../../packages/modules/gallery/src/schema.ts)
- [packages/modules/gallery/src/testing.ts](../../packages/modules/gallery/src/testing.ts)

## guests

Tier 3; 40 source files; 9 test files.

Declared connections: @yayatoh/attendees, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/venues.

Source imports: @yayatoh/attendees, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/platform/ssrf, @yayatoh/venues.

Tables detected: see schema source.

Event type literals detected: guests.party_responded, guests.rsvp_deadline_set, guests.rsvp_responded, user.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| guests.setCollector | guests:write | guests | [source](../../packages/modules/guests/src/collector.ts#L120) |
| guests.collectorSettings | guests:read | guests | [source](../../packages/modules/guests/src/collector.ts#L143) |
| guests.publicCollector | public:collector | guests | [source](../../packages/modules/guests/src/collector.ts#L160) |
| guests.submitContact | public:collector | guests | [source](../../packages/modules/guests/src/collector.ts#L211) |
| guests.collectorQueue | guests:read | guests | [source](../../packages/modules/guests/src/collector.ts#L297) |
| guests.collectorMergePreview | guests:write | guests | [source](../../packages/modules/guests/src/collector.ts#L370) |
| guests.approveSubmission | guests:write | guests | [source](../../packages/modules/guests/src/collector.ts#L422) |
| guests.mergeSubmission | guests:write | guests | [source](../../packages/modules/guests/src/collector.ts#L513) |
| guests.rejectSubmission | guests:write | guests | [source](../../packages/modules/guests/src/collector.ts#L635) |
| guests.createParty | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L280) |
| guests.updateParty | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L318) |
| guests.removeParty | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L347) |
| guests.addGuest | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L395) |
| guests.updateGuest | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L474) |
| guests.addPlusOne | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L535) |
| guests.removeGuest | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L601) |
| guests.moveGuest | guests:write | guests | [source](../../packages/modules/guests/src/guests.ts#L646) |
| guests.guestList | guests:read | guests | [source](../../packages/modules/guests/src/guests.ts#L713) |
| guests.guestCount | guests:read | guests | [source](../../packages/modules/guests/src/guests.ts#L809) |
| guests.partyHistory | guests:read | guests | [source](../../packages/modules/guests/src/guests.ts#L825) |
| guests.partyHub | public:rsvp | guests | [source](../../packages/modules/guests/src/hub.ts#L138) |
| guests.stageImport | guests:write | guests | [source](../../packages/modules/guests/src/imports.ts#L200) |
| guests.validateImport | guests:write | guests | [source](../../packages/modules/guests/src/imports.ts#L283) |
| guests.importSummary | guests:write | guests | [source](../../packages/modules/guests/src/imports.ts#L403) |
| guests.importRejected | guests:write | guests | [source](../../packages/modules/guests/src/imports.ts#L530) |
| guests.purgeImports | platform:guests.purgeImports | core | [source](../../packages/modules/guests/src/imports.ts#L814) |
| guests.setInvitations | guests:write | guests | [source](../../packages/modules/guests/src/invitations.ts#L110) |
| guests.recordSubEventResponse | guests:write | guests | [source](../../packages/modules/guests/src/invitations.ts#L217) |
| guests.invitationMatrix | guests:read | guests | [source](../../packages/modules/guests/src/invitations.ts#L340) |
| guests.subEventHistory | guests:read | guests | [source](../../packages/modules/guests/src/invitations.ts#L451) |
| guests.invitationTemplates | guests:read | guests | [source](../../packages/modules/guests/src/invites.ts#L67) |
| guests.setInvitationTemplate | guests:write | guests | [source](../../packages/modules/guests/src/invites.ts#L89) |
| guests.resetInvitationTemplate | guests:write | guests | [source](../../packages/modules/guests/src/invites.ts#L122) |
| guests.invitationPreview | guests:read | guests | [source](../../packages/modules/guests/src/invites.ts#L149) |
| guests.setPartyLocale | guests:write | guests | [source](../../packages/modules/guests/src/invites.ts#L171) |
| guests.partyContact | guests:read | guests | [source](../../packages/modules/guests/src/invites.ts#L204) |
| guests.setPartyContact | guests:write | guests | [source](../../packages/modules/guests/src/invites.ts#L228) |
| guests.sendInvitations | guests:write | guests | [source](../../packages/modules/guests/src/invites.ts#L303) |
| guests.sendTestInvitation | guests:write | guests | [source](../../packages/modules/guests/src/invites.ts#L399) |
| guests.partyInvites | guests:read | guests | [source](../../packages/modules/guests/src/invites.ts#L461) |
| guests.partyInviteMessages | guests:read | guests | [source](../../packages/modules/guests/src/invites.ts#L511) |
| guests.menu | guests:read | guests | [source](../../packages/modules/guests/src/rsvp-questions.ts#L54) |
| guests.saveMenuOption | guests:write | guests | [source](../../packages/modules/guests/src/rsvp-questions.ts#L79) |
| guests.removeMenuOption | guests:write | guests | [source](../../packages/modules/guests/src/rsvp-questions.ts#L156) |
| guests.rsvpQuestions | guests:read | guests | [source](../../packages/modules/guests/src/rsvp-questions.ts#L208) |
| guests.publishRsvpQuestions | guests:write | guests | [source](../../packages/modules/guests/src/rsvp-questions.ts#L226) |
| guests.mealCounts | guests:read | guests | [source](../../packages/modules/guests/src/rsvp-questions.ts#L579) |
| guests.setRsvpSettings | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L146) |
| guests.rsvpSettings | guests:read | guests | [source](../../packages/modules/guests/src/rsvp.ts#L183) |
| guests.createRsvpLinks | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L199) |
| guests.resetRsvpLink | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L253) |
| guests.resetRsvpPin | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L279) |
| guests.markRsvpSent | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L308) |
| guests.reopenRsvp | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L332) |
| guests.rsvpOverview | guests:read | guests | [source](../../packages/modules/guests/src/rsvp.ts#L410) |
| guests.partyRsvp | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L454) |
| guests.rsvpLinks | guests:write | guests | [source](../../packages/modules/guests/src/rsvp.ts#L484) |
| guests.publicRsvp | public:rsvp | guests | [source](../../packages/modules/guests/src/rsvp.ts#L562) |
| guests.markRsvpViewed | public:rsvp | guests | [source](../../packages/modules/guests/src/rsvp.ts#L626) |
| guests.submitRsvp | public:rsvp | guests | [source](../../packages/modules/guests/src/rsvp.ts#L668) |
| guests.findRsvpByName | public:rsvp | guests | [source](../../packages/modules/guests/src/rsvp.ts#L834) |
| guests.publicRsvpQuestions | public:rsvp | guests | [source](../../packages/modules/guests/src/rsvp.ts#L871) |
| guests.guestSite | guests:read | website | [source](../../packages/modules/guests/src/site.ts#L205) |
| guests.guestSitePublished | guests:read | website | [source](../../packages/modules/guests/src/site.ts#L218) |
| guests.saveGuestSite | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L249) |
| guests.setGuestSitePassword | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L274) |
| guests.publishGuestSite | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L302) |
| guests.addGuestSiteBlock | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L332) |
| guests.updateGuestSiteBlock | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L373) |
| guests.moveGuestSiteBlock | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L413) |
| guests.removeGuestSiteBlock | dynamic or not captured | null or not captured | [source](../../packages/modules/guests/src/site.ts#L437) |
| guests.publicGuestSite | public:guest_site | website | [source](../../packages/modules/guests/src/site.ts#L508) |
| guests.unlockGuestSite | public:guest_site | website | [source](../../packages/modules/guests/src/site.ts#L570) |
| guests.createSubEvent | guests:write | guests | [source](../../packages/modules/guests/src/sub-events.ts#L211) |
| guests.updateSubEvent | guests:write | guests | [source](../../packages/modules/guests/src/sub-events.ts#L253) |
| guests.moveSubEvent | guests:write | guests | [source](../../packages/modules/guests/src/sub-events.ts#L300) |
| guests.removeSubEvent | guests:write | guests | [source](../../packages/modules/guests/src/sub-events.ts#L348) |
| guests.subEvents | guests:read | guests | [source](../../packages/modules/guests/src/sub-events.ts#L409) |

### Feature rules and lifecycle

#### guests (tier 3)

Wedding and gala guest data (Phase 4, M4.1a): parties (households), the guests in them, placeholder plus-ones and the change history. Owns Postgres schema `guests`. Later Phase 4 increments add sub-events, invitations, RSVP, guest sites, gallery items and hosted tables here (roadmap §5.1).

**Tier.** Tier 3, as roadmap §3.5 lists it (with ticketing and seating). It reads down only: `events` (tier 2) to check the event, `attendees` (tier 2) to link a guest to a guest-list entry and its CRM contact. Seating (same tier) will reach guests through a port (`OccupantDirectory`, M4.3a), never an import.

**Invariants**
- Every row belongs to one event of the org: composite `(org_id, event_id)` foreign keys to `events.events` (hand-written in the migration, cascade on event delete). Every command takes the `eventId` and only touches parties and guests of that event, so event-scoped roles (co-host, planner in M4.2a) authorize against the right event.
- A party holds 0–20 guests. A guest is `guest` (has a first name) or `plus_one` ("Guest of <host>": same party, at most one per host, may stay unnamed until named; never the primary contact). A plus-one moves and is removed with their host; moving a plus-one alone is refused.
- One primary contact per party (partial unique index): the first guest added, or the one the host picks; when the primary leaves, the first named adult takes over.
- **Private data (P4-3):** dietary and accessibility answers and the home address are sealed together in `guests.private_ciphertext` with the org's key vault (AES-GCM bound to the org). They are opened only for the console's `GuestDto` (organizer roles with `guests:read`) and never written to the history, audit data, logs or any public payload.
- **Never marketing (P4-3):** nothing in this module creates CRM contacts, consents, audience members or campaign recipients, emits events that marketing consumes, or feeds a segment. A link to an attendee (and its contact) is a reference for RSVP and day-of messages only. Guests get RSVP, reminders and day-of messages; never campaigns.
- **History:** every change to a party or guest writes `guests.rsvp_history` in the same transaction (action, source, actor, changed field names, structural detail such as `fromPartyId`). The table is append-only for `app_user` (UPDATE/DELETE/TRUNCATE revoked) and has no foreign key to parties or guests, so it outlives them. Sources: `manual` and `paper` (entered on a guest's behalf) from the console; `import`, `collector` and `rsvp` are reserved for M4.1b/f/d.
- Permissions: reads need `guests:read`, writes `guests:write` (batch 3c merge: every org role with `attendees:read`/`attendees:write` holds them; co-hosts and planners get them on their events through the M4.2a `guests:*` event-role wildcard). Entitlement: the `guests` module. Removals are `delete` commands (refused while staff impersonate).
- Limits: 1,000 parties and 3,000 guests per event, 20 tags per party.
- **Import (M4.1b):** paste, CSV (any common encoding), XLSX (cell values only, `@yayatoh/csv`) and a Google Sheet shared by link (read once through the SSRF guard, `@yayatoh/guests/sheet`, server-only; the link is never stored). `guests.import_batches` / `guests.import_rows` stage the list with the header and every row **sealed** (they hold dietary, accessibility and address columns); nothing reaches the list until the host checks the mapping and confirms. Rows group into parties by a household column; a party is imported whole or rejected whole (per-party and per-event limits, a name the event already has, any bad row). Each planned party gets its id at the check and is created with that id once (the import's idempotency key); a second start is refused. Every created party and guest writes history with source `import` and `{ batchId }`. Imported rows lose their cells at once; rejected rows keep them (for the download) until the batch expires 72 hours after staging, when the daily worker pass (`guests.purgeImports`) clears everything. Imports create no CRM contacts, consents or audience members; audit data holds counts only.

**Sub-events and invitations (M4.1c)**
- A **sub-event** (`sub_events`: ceremony, reception, rehearsal dinner, custom) belongs to one event: name, times as instants (entered and shown in the event's zone), a free-text place and/or a venue of the org (`SET NULL` when the venue goes), an optional date of the event (`events.occurrences`, `SET NULL` when the date goes; a newly chosen date must be scheduled) and an order (`position`, 0…n-1, moved one step at a time). At most 20 per event.
- **Invitations** (`invitations`) are rows for named guests only. A plus-one has none: they follow their host's (`inviteeOf`). A sub-event with `invite_all` invites every guest of the event, including parties added later (by hand or by import), with no rows; cells of such a sub-event can't be changed until it is turned off, and turning it off writes a row for every named guest so nobody loses their invitation. Changes go through `guests.setInvitations` (a cell, a party, a filter of side/tag/VIP, or everyone; repeatable).
- **Responses** (`sub_event_responses`, attending/declined with the source) exist only for invited guests: every write that records attendance calls **`assertInvitedTx`** in its transaction (`guests.recordSubEventResponse` now; M4.1d's public RSVP must too). Another event's or org's guest or sub-event is `not_found`, an uninvited one `invalid_state` / `not_invited`. Uninviting deletes the guest's and their plus-one's response for that sub-event; removing a guest or a sub-event cascades.
- Every sub-event, invitation and response change writes `rsvp_history` in the same transaction (`sub_event_id` set; `party_id` null only for sub-event actions), field names only.
- Removing a sub-event with recorded responses is refused (`has_responses`) unless confirmed; its history stays.
- A sub-event's **seating chart** lives in `seating.sub_event_charts` (seating's schema; a hand-written FK to `(org_id, event_id, id)` here cascades). This module never touches it: the web page composes the two modules.
- Nothing here creates contacts, consents, audience members or domain events (P4-3).

**RSVP (M4.1d)**
- **Access (P4-2).** A party's page is `/rsvp/{token}`: the token is `signLinkToken('guests.rsvp-link', link_id)`, resolved to its org by the SECURITY DEFINER `guests.rsvp_link_org` (live orgs only; ids only), so the tenant comes from the token, never a header. "Reset the link" gives the party a new `link_id`: every earlier link and QR code fails at once. Links stop at `link_expires_at` (60 days after the event ends). The paper fallback is `/rsvp/find/{lookup_code}` (`guests.rsvp_lookup_target`, only while `name_lookup` is on): the exact full name of a guest of the party (`strictName`: case, spaces and Unicode forms only) plus the party's six-digit PIN, derived from the party and `pin_version` under the app secret (never stored). Every miss (unknown name, partial name, wrong PIN) gets the same answer after the same work; the web action rate-limits it (`rsvpLookup`) and asks for the human check past the device budget.
- **Household answers.** `guests.submitRsvp` takes one status per invited guest and sub-event (all of them) and names for placeholder plus-ones; it refuses guests outside the party, missing or duplicate answers, an unnamed attending plus-one, an expired link, and anything after the event's deadline unless the host reopened the party (the next answer closes it again). Every answer calls `assertInvitedTx` in the transaction.
- **States** (`party_rsvp`): `invited → sent → viewed → responded` from `sent_at`, `viewed_at` (first open) and `responded_at` (the party answered, or the host recorded an answer for every invitation of the party). Counts per sub-event come from `sub_event_responses`.
- **History.** Link created/reset, PIN reset, sent, reopened (source `manual`), viewed, submitted, responses and plus-one names (source `rsvp`) all write `rsvp_history` in the same transaction; field names only.
- **Participation, never marketing (P4-3).** When a party with guests linked to guest-list entries answers (or the host records its answers), `guests.rsvp_responded@1` carries the event, the party, the linked contact ids and counts. The `audiences.participation` projector sets `event_participation.rsvp` on rows that exist for other reasons; nothing here creates contacts, consents or audience members.
- Host tools need `guests:write` (links and PINs are credentials); viewers see states and counts only.


**RSVP questions (M4.1e)**
- **Menu** (`menu_options`): labels unique per event (case-insensitive) with dietary notes. A guest's meal is the option's label in `guests.meal`; renaming an option renames it on every guest who chose it (history `meal`); an option someone chose can't be removed.
- **Questions** are the forms engine's `rsvp` kind (`@yayatoh/forms`), published by `guests.publishRsvpQuestions` (sub-events of the event only; a meal question needs a menu). `guests.submitRsvp` takes each guest's answers and `applyRsvpQuestionsTx` checks them against what that guest can see once the statuses and plus-one names are in: answers to hidden questions are **rejected**. The meal goes to `guests.meal`, dietary and accessibility answers into the sealed private fields (P4-3), other answers to the guest's form response (private ones sealed). The page never receives a private answer back; a blank private answer keeps the earlier one. History names fields only (`meal`, `dietary`, `accessibility`, `rsvpAnswers`). Removing a guest or party deletes their answers.
- **Meal counts** (`guests.mealCounts`): attending guests by meal per sub-event (the meal question's, or all). **Export**: `guests.rsvpAnswersCsv` (`attendees:export`) and `guests.rsvpAnswersPrivateCsv` (`attendees:export_private`, adds private columns); step-up, audited with counts only.

**Invitations and contact collector (M4.1f)**
- **Collector (P4-3).** An event's public collector (`collector_settings`: on/off and a platform-unique code; `/collect/{code}` resolved by the SECURITY DEFINER `guests.collector_target`, live orgs and collectors that are on only, ids only) takes a household's name, its people, a postal address, email and phone and a note. Submissions (`collector_submissions`) are **sealed whole** and land in the host's queue; nothing changes a party until a host with `guests:write` approves one into a new party (source `collector`; the first person is the primary contact and holds the sealed address, email and phone; the guest's language becomes the party's invitation language), merges it into an existing party field by field (keep or use the address, email and phone on the primary guest; add only people the party doesn't have) or rejects it. The payload is cleared the moment the host decides. Spam protection (the `contactCollector` limit and the human check) runs in the web action. At most 2,000 pending per event.
- **Invitations.** `guests.sendInvitations` (`guests:write`) gives each party its RSVP link and, for each chosen channel the party has an address on (email; SMS only to an E.164 number), queues `guests.invitation` through the guests mailer (`invitationMailer`, from `guests.invitation_queued@1`, ids only), marks the party `sent` (`rsvp_sent` the first time, `invitation_sent` each time) and logs each message in `invite_messages` (channel and notifications dedupe key; never the address). Delivery states (sent, waiting for quiet hours, delivered, bounced, failed) are read back from notifications by dedupe key (`messageStatesTx`), so a bounce shows on the party. Wording per event and language in `invitation_templates`, else the built-in text (`domain/invite-copy.ts`, 13 languages); a party's language in `party_invites`. Test sends go by email to the signed-in host (`to.userId`).
- **Reminders** run on the M3.7a journey engine (automations, tier 6): a system journey (`rsvp_sent`, steps anchored on the RSVP deadline) enrolls each party when its invitation is queued; `guests.party_responded@1` (ids only, emitted whenever a party reaches `responded`) cancels its run and the runner checks again when a step is due; `guests.rsvp_deadline_set@1` re-plans pending steps. Reminders go through `queuePartyMessageTx` (kind `guests.rsvp-reminder`).
- Both kinds are **transactional and not urgent**: no consent or contact needed, never suppressed by marketing unsubscribes or the org pause, but quiet hours apply in the event's timezone. Nothing creates contacts, consents or audience members (P4-3).

**Gala tables (M4.2b)**
- A purchased table (`ticketing.table_units`, same tier: a reference only) has at most one party (`parties.table_unit_id`, partial unique): the buyer's company or the sponsor. Each named seat is a guest of that party holding the seat's ticket (`guests.ticket_id`, one guest per ticket) and its attendee; history source `table_link` (the buyer's claim link) or `manual` (the host). `tablePartyTx`, `addTableGuestTx`, `guestsByTicketTx` and `tablePartiesTx` run in the caller's transaction (orders, which locks the table and reissues the ticket); this module never reads tickets. The guest's email is sealed with the private answers.

**Guest seating (M4.3a)**
- Seating's **`OccupantDirectory`** port is implemented here (`guestsOccupantDirectory` in `seating-occupants.ts`) and registered by each app's composition root; seating never imports guests, and this module never imports seating. For a sub-event it lists the guests invited to it (plus-ones follow their host) with their answer for it; for the event plan, every guest, with `attending` (a ticket, or yes to any sub-event), `declined` (no to every sub-event they're invited to) or `pending`. Names, meals and age classes only, never a private answer (P4-3).
- **Live guest list:** both history writers (`recordHistoryTx`, `recordSubEventHistoryTx`) publish on `org:{o}:event:{e}:guests` (`GUESTS_CHANNEL`, `guests:read`, entitlement `guests`) in the same transaction: `party {partyId}` once per party per transaction, and a single `list` message once more than 20 parties changed (an import) or a change names no party (an "everyone invited" switch). Ids only. So every change that writes history (a plus-one added or named, a meal, an RSVP answer, a move, an import) reaches the seating editor's queue, and a rolled-back change never does.
- Seating's places (`seating.guest_seats`) reference guests and sub-events by hand-written cascading FKs: removing a guest or a sub-event removes their places.
- **Seat finder credentials (M4.4a):** `guestsPartyCredentials` implements seating's `PartyCredentials` port: a party link resolves only while it is the party's current, unexpired link; name + PIN uses `matchPartyByNamePinTx` (shared with `findRsvpByName`: every named guest of the event read and compared in memory, a PIN always compared, a dummy one on a miss). It ignores the RSVP name-lookup switch (the seat finder's mode is the organizer's switch) and never renews a link.
**Guest website (M4.5a)**
- One `sites` row per event (address code, draft/published, title, intro, writing language, **scrypt hash** of the password, `password_version`) and ordered `site_blocks` (text, program, travel, registry, faq; content checked per kind in `domain/site.ts`, read back item by item). A published site always has a password (P4-3c).
- The program shows the sub-events everyone is invited to, or the host's explicit pick; never a guest, party, answer or contact detail. Public reads go through `PublicGuestSiteDto` only; the locked state carries the event's name alone.
- The tenant comes from the address (`guests.site_target`, SECURITY DEFINER, published sites of live orgs, ids only). Access is an HMAC of the site and its password version (`siteAccessToken`); a new password locks everyone out. The web action rate-limits password tries (`guestSitePassword`) with the human check.
- Never on the marketplace: nothing here emits domain events. Writes need `guests:write` with the `website` entitlement; audit data names fields only (never content or the password).

**Guest hub (M4.7a)**
- One page per party at `/hub/{token}`: the **same token as the RSVP link** (resolved by `linkPartyTx`; resetting the link or its expiry closes both; the org comes from the token). `partyHubQuery(readers)` (`public:rsvp`) returns `PartyHubDto` only: the party's invited guests (names as the host wrote them), the sub-events it is invited to with its answers, the RSVP tally, seats, tickets and the published site's code. Never a private answer, a contact/attendee/order id or anyone outside the party (P4-3).
- Seats and tickets belong to seating and ticketing (same tier): the app passes their readers in (`partySeatsTx`, `partyTicketsTx`); this module never imports them. People are the party's guests linked to a guest-list entry and/or holding a ticket. Seats are null until the host opens the seat finder.
- **Wallet passes** go through `GuestPassProvider` (fake in dev/CI until the owner's Apple/Google accounts exist): one serial per party (`yyg-{partyId}`); content from `guestPassContent` (event, envelope name, when/where, seats once shared). Nothing here stores passes or emits domain events.

**Social Command Center pack (M4.6a)**
- `socialFactsTx` (RSVP counts, the deadline, attending guests and missing meals), `mealDietaryCountsTx` (meals per menu option; dietary and accessibility answers unsealed only to be counted, never returned) and `rsvpDeadlineEventIdsTx` run in the caller's transaction for the alert engine and the Command Center (tier 6). "Not responded" (`rsvpPendingCounts`, pure): a guest invited to a sub-event who hasn't answered every one of their invitations; guests invited to nothing and gala seat holders are not counted. Counts only; nothing here feeds marketing (P4-3).


### Source index

- [packages/modules/guests/src/collector.ts](../../packages/modules/guests/src/collector.ts)
- [packages/modules/guests/src/contact-merge.ts](../../packages/modules/guests/src/contact-merge.ts)
- [packages/modules/guests/src/data-subject.ts](../../packages/modules/guests/src/data-subject.ts)
- [packages/modules/guests/src/day-of.ts](../../packages/modules/guests/src/day-of.ts)
- [packages/modules/guests/src/domain/collector.ts](../../packages/modules/guests/src/domain/collector.ts)
- [packages/modules/guests/src/domain/guests.ts](../../packages/modules/guests/src/domain/guests.ts)
- [packages/modules/guests/src/domain/hub.ts](../../packages/modules/guests/src/domain/hub.ts)
- [packages/modules/guests/src/domain/import.ts](../../packages/modules/guests/src/domain/import.ts)
- [packages/modules/guests/src/domain/invitations.ts](../../packages/modules/guests/src/domain/invitations.ts)
- [packages/modules/guests/src/domain/invite-copy.ts](../../packages/modules/guests/src/domain/invite-copy.ts)
- [packages/modules/guests/src/domain/rsvp.ts](../../packages/modules/guests/src/domain/rsvp.ts)
- [packages/modules/guests/src/domain/site.ts](../../packages/modules/guests/src/domain/site.ts)
- [packages/modules/guests/src/domain/social.ts](../../packages/modules/guests/src/domain/social.ts)
- [packages/modules/guests/src/dto.ts](../../packages/modules/guests/src/dto.ts)
- [packages/modules/guests/src/guests.ts](../../packages/modules/guests/src/guests.ts)
- [packages/modules/guests/src/hub.ts](../../packages/modules/guests/src/hub.ts)
- [packages/modules/guests/src/imports.ts](../../packages/modules/guests/src/imports.ts)
- [packages/modules/guests/src/index.ts](../../packages/modules/guests/src/index.ts)
- [packages/modules/guests/src/invitations.ts](../../packages/modules/guests/src/invitations.ts)
- [packages/modules/guests/src/invite-delivery.ts](../../packages/modules/guests/src/invite-delivery.ts)
- [packages/modules/guests/src/invites-state.ts](../../packages/modules/guests/src/invites-state.ts)
- [packages/modules/guests/src/invites.ts](../../packages/modules/guests/src/invites.ts)
- [packages/modules/guests/src/paddle-holders.ts](../../packages/modules/guests/src/paddle-holders.ts)
- [packages/modules/guests/src/pledge-contact.ts](../../packages/modules/guests/src/pledge-contact.ts)
- [packages/modules/guests/src/private-columns.ts](../../packages/modules/guests/src/private-columns.ts)
- [packages/modules/guests/src/realtime.ts](../../packages/modules/guests/src/realtime.ts)
- [packages/modules/guests/src/rsvp-filter.ts](../../packages/modules/guests/src/rsvp-filter.ts)
- [packages/modules/guests/src/rsvp-questions.ts](../../packages/modules/guests/src/rsvp-questions.ts)
- [packages/modules/guests/src/rsvp-state.ts](../../packages/modules/guests/src/rsvp-state.ts)
- [packages/modules/guests/src/rsvp.ts](../../packages/modules/guests/src/rsvp.ts)
- [packages/modules/guests/src/schema.ts](../../packages/modules/guests/src/schema.ts)
- [packages/modules/guests/src/seat-finder-party.ts](../../packages/modules/guests/src/seat-finder-party.ts)
- [packages/modules/guests/src/seating-occupants.ts](../../packages/modules/guests/src/seating-occupants.ts)
- [packages/modules/guests/src/sheet.ts](../../packages/modules/guests/src/sheet.ts)
- [packages/modules/guests/src/site-access.ts](../../packages/modules/guests/src/site-access.ts)
- [packages/modules/guests/src/site.ts](../../packages/modules/guests/src/site.ts)
- [packages/modules/guests/src/social-facts.ts](../../packages/modules/guests/src/social-facts.ts)
- [packages/modules/guests/src/sub-events.ts](../../packages/modules/guests/src/sub-events.ts)
- [packages/modules/guests/src/tables.ts](../../packages/modules/guests/src/tables.ts)
- [packages/modules/guests/src/wallet-pass.ts](../../packages/modules/guests/src/wallet-pass.ts)

## integrations

Tier 6; 64 source files; 9 test files.

Declared connections: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/virtual.

Source imports: @yayatoh/attendees, @yayatoh/audiences, @yayatoh/billing, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/donations, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/virtual.

Tables detected: see schema source.

Event type literals detected: boolean, consent, context, date, divider, email, group, header, integrations.connection_connected, integrations.connection_revoked, integrations.sheet_linked, integrations.sheet_unlinked, json, list, mrkdwn, number, plain_text, profile, section, string, system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| integrations.accountingDetail | integrations:read | integrations | [source](../../packages/modules/integrations/src/accounting/journals.ts#L137) |
| integrations.accountingRef | integrations:read | integrations | [source](../../packages/modules/integrations/src/accounting/journals.ts#L174) |
| integrations.saveAccountMap | integrations:manage | integrations | [source](../../packages/modules/integrations/src/accounting/journals.ts#L195) |
| integrations.prepareJournals | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/accounting/journals.ts#L309) |
| integrations.recordJournalResults | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/accounting/journals.ts#L470) |
| integrations.audienceSync | integrations:read | integrations | [source](../../packages/modules/integrations/src/audience/settings.ts#L68) |
| integrations.consentChanges | integrations:read | integrations | [source](../../packages/modules/integrations/src/audience/settings.ts#L99) |
| integrations.saveAudienceSync | integrations:manage | integrations | [source](../../packages/modules/integrations/src/audience/settings.ts#L139) |
| integrations.listConnections | integrations:read | integrations | [source](../../packages/modules/integrations/src/connections.ts#L166) |
| integrations.connectionDetail | integrations:read | integrations | [source](../../packages/modules/integrations/src/connections.ts#L207) |
| integrations.beginConnect | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L254) |
| integrations.pendingConnection | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L311) |
| integrations.completeConnect | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L364) |
| integrations.failConnect | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L428) |
| integrations.setConnectionPaused | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L459) |
| integrations.setSyncInterval | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L498) |
| integrations.disconnect | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L540) |
| integrations.requestSync | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connections.ts#L599) |
| integrations.importTarget | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connectors/eventbrite/preview.ts#L41) |
| integrations.alreadyImported | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connectors/eventbrite/preview.ts#L58) |
| integrations.importResult | integrations:read | integrations | [source](../../packages/modules/integrations/src/connectors/eventbrite/preview.ts#L186) |
| integrations.sheetLinks | integrations:read | integrations | [source](../../packages/modules/integrations/src/connectors/google-sheets/links.ts#L55) |
| integrations.sheetLinkTarget | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connectors/google-sheets/links.ts#L86) |
| integrations.linkSheet | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connectors/google-sheets/links.ts#L135) |
| integrations.unlinkSheet | integrations:manage | integrations | [source](../../packages/modules/integrations/src/connectors/google-sheets/links.ts#L226) |
| integrations.claimRun | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/engine.ts#L335) |
| integrations.pullPage | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/engine.ts#L450) |
| integrations.pushPage | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/engine.ts#L713) |
| integrations.finishRun | dynamic or not captured | null or not captured | [source](../../packages/modules/integrations/src/engine.ts#L823) |
| integrations.listErrorGroups | integrations:read | integrations | [source](../../packages/modules/integrations/src/errors.ts#L60) |
| integrations.openErrorCount | integrations:read | integrations | [source](../../packages/modules/integrations/src/errors.ts#L145) |
| integrations.retryErrors | integrations:manage | integrations | [source](../../packages/modules/integrations/src/errors.ts#L163) |
| integrations.dismissErrors | integrations:manage | integrations | [source](../../packages/modules/integrations/src/errors.ts#L227) |
| integrations.linkedCounts | integrations:read | integrations | [source](../../packages/modules/integrations/src/linked.ts#L10) |
| integrations.saveMapping | integrations:manage | integrations | [source](../../packages/modules/integrations/src/mappings.ts#L15) |
| integrations.mappingVersions | integrations:read | integrations | [source](../../packages/modules/integrations/src/mappings.ts#L103) |
| integrations.personalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L62) |
| integrations.beginPersonalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L111) |
| integrations.pendingPersonalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L166) |
| integrations.completePersonalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L192) |
| integrations.failPersonalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L248) |
| integrations.stopPersonalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L282) |
| integrations.syncPersonalCalendar | public:calendar | integrations | [source](../../packages/modules/integrations/src/personal.ts#L338) |
| integrations.queueSlackDigests | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/slack/dispatch.ts#L73) |
| integrations.claimSlackMessages | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/slack/dispatch.ts#L138) |
| integrations.finishSlackMessage | dynamic or not captured | integrations | [source](../../packages/modules/integrations/src/slack/dispatch.ts#L217) |
| integrations.slackPanel | integrations:read | integrations | [source](../../packages/modules/integrations/src/slack/settings.ts#L112) |
| integrations.saveSlackSettings | integrations:manage | integrations | [source](../../packages/modules/integrations/src/slack/settings.ts#L153) |
| integrations.queueSlackTest | integrations:manage | integrations | [source](../../packages/modules/integrations/src/slack/settings.ts#L228) |
| integrations.slackAuthRef | integrations:read | integrations | [source](../../packages/modules/integrations/src/slack/settings.ts#L266) |
| integrations.zoomWebinarPlan | events:write | integrations | [source](../../packages/modules/integrations/src/zoom-webinars.ts#L63) |
| integrations.zoomConnected | events:read | integrations | [source](../../packages/modules/integrations/src/zoom-webinars.ts#L80) |
| integrations.recordCreatedZoomWebinar | events:write | integrations | [source](../../packages/modules/integrations/src/zoom-webinars.ts#L90) |

### Feature rules and lifecycle

#### integrations (tier 6)

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
- **Notifications connectors (M6.4c, Slack):** `purpose: 'notifications'`, no objects (no mapping);
  their runs are health checks (`health`). Slack's settings (`slack_settings`: one channel per
  connection, alerts at or above a severity, a daily digest at a local time in the org's zone,
  amounts only on the connection owner's opt-in while they have `finance:read`) and its send log
  (`slack_messages`, unique per connection, channel, kind and dedupe key: an alert sending, a local
  day, a test). Alerts arrive from the alerts module through the outbox
  (`alerts.alert_notified@1`, subscriber `integrations.slack-alerts`), never by import. The sender
  (`runSlackDispatch`; worker job `integrations.slack`, exclusive per org, found through
  `integrations.orgs_with_slack_work()`) claims with a lease, checks the connection through the
  port, re-checks every message for personal data (`slackPiiProblems`) and marks a revoked
  connection through the engine's run. Messages name events and counts only.
- **Zapier (M6.4c)** is not a connector: it authenticates with an org API key. `ZAPIER_TRIGGERS`,
  `ZAPIER_ACTIONS` and `ZAPIER_SCOPES` (`src/zapier.ts`) describe the app in `apps/zapier` for the
  console and the app's own test.


**Salesforce (M6.5b, `src/connectors/salesforce/`)**
- Objects in order: `contacts` ↔ Contact and `leads` ↔ Lead (both ways), then `campaigns` (one per
  non-draft event), `campaign_members` (registered → Registered, checked in → Attended) and
  `sponsor_opportunities` (program sponsors and their deals) out. A person linked to a Salesforce
  Contact is updated there; everyone else goes out as a Lead, so nobody is created twice.
- Yayatoh's records are upserted by the external id `Yayatoh_Id__c`; the pull skips records last
  modified by the connection's own integration user (`LastModifiedById`, the origin stamp).
- **Consent:** only people whose latest email marketing consent is `granted` and whose address is
  not unsubscribed or suppressed are pushed, and their campaign memberships with them. A Salesforce
  email opt-out withdraws consent here; Salesforce never grants it.
- Amounts leave as Salesforce decimals (major units) converted from integer minor units at the
  boundary. The fake org (`fake.ts`) mirrors Salesforce's validation for dev and CI.
- **Reconciling push (M6.5c):** a `PushSide` with `reconcile` lists every record it wants on each
  pass (its cursor goes back to the start after the last page); unchanged ones are skipped by the
  link hash, and linked records `read` no longer returns are deleted at the provider with
  `remove` (`removed` outcome; the link goes). Calendars use it.
- **Personal connections (M6.5c):** `audience: 'registrant'` connectors (`google_calendar_personal`)
  belong to one registrant (`registrant_id` + `event_id`); the live slot is per (org, connector,
  registrant). They are made from "My schedule" with the order's manage link (`personal.ts`,
  `public:calendar` commands that re-check the registrant), never listed, offered or opened in the
  console, and store no account label. `PushScope` tells `changes`/`read` whose records to push.
- **Google Calendar (M6.5c):** `google_calendar` (the org's sessions) and
  `google_calendar_personal` (a registrant's schedule) push sessions as entries in the event's
  IANA zone under stable ids (a lost create answer is a 409, then an update); the fake Calendar
  API (`googleCalendarFakeProvider`) backs dev and CI.
- **Accounting (M6.5d, P6-6):** QuickBooks Online and Xero (`src/connectors/quickbooks.ts`,
  `xero.ts`) have no objects but an `accounting` side (chart of accounts, `postJournal`). A run
  posts **one daily summary journal per day (org time zone) and currency** from the ledger
  (`@yayatoh/payments` `ledgerDailyTotalsTx`: memo gross, fees, refunds; transfers as payouts) and
  giving (`@yayatoh/donations` `donationDailyTotalsTx`), mapped to the org's accounts
  (`account_maps`, versioned; every category required, the clearing account unshared). Journals
  (`accounting_journals`) are never edited: a changed day gets a reversal of the standing journal
  and the next revision; the provider's idempotency key is org + day + currency + revision (+
  kind). Unsent rows are superseded freely; an uncertain failure blocks its day until its retry
  (same key) settles. Days from the mapping's first day to yesterday; integer minor units, sent as
  exact decimals. Xero takes its base currency only (`currency_unsupported`).

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


### Source index

- [packages/modules/integrations/src/accounting/domain.ts](../../packages/modules/integrations/src/accounting/domain.ts)
- [packages/modules/integrations/src/accounting/journals.ts](../../packages/modules/integrations/src/accounting/journals.ts)
- [packages/modules/integrations/src/accounting/run.ts](../../packages/modules/integrations/src/accounting/run.ts)
- [packages/modules/integrations/src/audience/consent.ts](../../packages/modules/integrations/src/audience/consent.ts)
- [packages/modules/integrations/src/audience/inbound.ts](../../packages/modules/integrations/src/audience/inbound.ts)
- [packages/modules/integrations/src/audience/list-connector.ts](../../packages/modules/integrations/src/audience/list-connector.ts)
- [packages/modules/integrations/src/audience/settings.ts](../../packages/modules/integrations/src/audience/settings.ts)
- [packages/modules/integrations/src/audience/state.ts](../../packages/modules/integrations/src/audience/state.ts)
- [packages/modules/integrations/src/auth/fake.ts](../../packages/modules/integrations/src/auth/fake.ts)
- [packages/modules/integrations/src/auth/nango.ts](../../packages/modules/integrations/src/auth/nango.ts)
- [packages/modules/integrations/src/auth/port.ts](../../packages/modules/integrations/src/auth/port.ts)
- [packages/modules/integrations/src/auth/registry.ts](../../packages/modules/integrations/src/auth/registry.ts)
- [packages/modules/integrations/src/client.ts](../../packages/modules/integrations/src/client.ts)
- [packages/modules/integrations/src/connections.ts](../../packages/modules/integrations/src/connections.ts)
- [packages/modules/integrations/src/connectors/demo.ts](../../packages/modules/integrations/src/connectors/demo.ts)
- [packages/modules/integrations/src/connectors/eventbrite/fake.ts](../../packages/modules/integrations/src/connectors/eventbrite/fake.ts)
- [packages/modules/integrations/src/connectors/eventbrite/fixture.ts](../../packages/modules/integrations/src/connectors/eventbrite/fixture.ts)
- [packages/modules/integrations/src/connectors/eventbrite/index.ts](../../packages/modules/integrations/src/connectors/eventbrite/index.ts)
- [packages/modules/integrations/src/connectors/eventbrite/preview.ts](../../packages/modules/integrations/src/connectors/eventbrite/preview.ts)
- [packages/modules/integrations/src/connectors/google-calendar.ts](../../packages/modules/integrations/src/connectors/google-calendar.ts)
- [packages/modules/integrations/src/connectors/google-sheets/fake.ts](../../packages/modules/integrations/src/connectors/google-sheets/fake.ts)
- [packages/modules/integrations/src/connectors/google-sheets/index.ts](../../packages/modules/integrations/src/connectors/google-sheets/index.ts)
- [packages/modules/integrations/src/connectors/google-sheets/links.ts](../../packages/modules/integrations/src/connectors/google-sheets/links.ts)
- [packages/modules/integrations/src/connectors/hubspot/fake.ts](../../packages/modules/integrations/src/connectors/hubspot/fake.ts)
- [packages/modules/integrations/src/connectors/hubspot/index.ts](../../packages/modules/integrations/src/connectors/hubspot/index.ts)
- [packages/modules/integrations/src/connectors/index.ts](../../packages/modules/integrations/src/connectors/index.ts)
- [packages/modules/integrations/src/connectors/klaviyo/fake.ts](../../packages/modules/integrations/src/connectors/klaviyo/fake.ts)
- [packages/modules/integrations/src/connectors/klaviyo/index.ts](../../packages/modules/integrations/src/connectors/klaviyo/index.ts)
- [packages/modules/integrations/src/connectors/links.ts](../../packages/modules/integrations/src/connectors/links.ts)
- [packages/modules/integrations/src/connectors/mailchimp/fake.ts](../../packages/modules/integrations/src/connectors/mailchimp/fake.ts)
- [packages/modules/integrations/src/connectors/mailchimp/index.ts](../../packages/modules/integrations/src/connectors/mailchimp/index.ts)
- [packages/modules/integrations/src/connectors/quickbooks.ts](../../packages/modules/integrations/src/connectors/quickbooks.ts)
- [packages/modules/integrations/src/connectors/salesforce/fake.ts](../../packages/modules/integrations/src/connectors/salesforce/fake.ts)
- [packages/modules/integrations/src/connectors/salesforce/index.ts](../../packages/modules/integrations/src/connectors/salesforce/index.ts)
- [packages/modules/integrations/src/connectors/salesforce/local.ts](../../packages/modules/integrations/src/connectors/salesforce/local.ts)
- [packages/modules/integrations/src/connectors/salesforce/objects.ts](../../packages/modules/integrations/src/connectors/salesforce/objects.ts)
- [packages/modules/integrations/src/connectors/slack.ts](../../packages/modules/integrations/src/connectors/slack.ts)
- [packages/modules/integrations/src/connectors/xero.ts](../../packages/modules/integrations/src/connectors/xero.ts)
- [packages/modules/integrations/src/connectors/zoom.ts](../../packages/modules/integrations/src/connectors/zoom.ts)
- [packages/modules/integrations/src/contact-merge.ts](../../packages/modules/integrations/src/contact-merge.ts)
- [packages/modules/integrations/src/data-subject.ts](../../packages/modules/integrations/src/data-subject.ts)
- [packages/modules/integrations/src/domain/calendar.ts](../../packages/modules/integrations/src/domain/calendar.ts)
- [packages/modules/integrations/src/domain/mapping.ts](../../packages/modules/integrations/src/domain/mapping.ts)
- [packages/modules/integrations/src/domain/sync.ts](../../packages/modules/integrations/src/domain/sync.ts)
- [packages/modules/integrations/src/engine.ts](../../packages/modules/integrations/src/engine.ts)
- [packages/modules/integrations/src/errors.ts](../../packages/modules/integrations/src/errors.ts)
- [packages/modules/integrations/src/hash.ts](../../packages/modules/integrations/src/hash.ts)
- [packages/modules/integrations/src/index.ts](../../packages/modules/integrations/src/index.ts)
- [packages/modules/integrations/src/linked.ts](../../packages/modules/integrations/src/linked.ts)
- [packages/modules/integrations/src/mappings.ts](../../packages/modules/integrations/src/mappings.ts)
- [packages/modules/integrations/src/personal.ts](../../packages/modules/integrations/src/personal.ts)
- [packages/modules/integrations/src/private-columns.ts](../../packages/modules/integrations/src/private-columns.ts)
- [packages/modules/integrations/src/schema.ts](../../packages/modules/integrations/src/schema.ts)
- [packages/modules/integrations/src/sdk/connector.ts](../../packages/modules/integrations/src/sdk/connector.ts)
- [packages/modules/integrations/src/slack/api.ts](../../packages/modules/integrations/src/slack/api.ts)
- [packages/modules/integrations/src/slack/digest.ts](../../packages/modules/integrations/src/slack/digest.ts)
- [packages/modules/integrations/src/slack/dispatch.ts](../../packages/modules/integrations/src/slack/dispatch.ts)
- [packages/modules/integrations/src/slack/fake.ts](../../packages/modules/integrations/src/slack/fake.ts)
- [packages/modules/integrations/src/slack/render.ts](../../packages/modules/integrations/src/slack/render.ts)
- [packages/modules/integrations/src/slack/schedule.ts](../../packages/modules/integrations/src/slack/schedule.ts)
- [packages/modules/integrations/src/slack/settings.ts](../../packages/modules/integrations/src/slack/settings.ts)
- [packages/modules/integrations/src/slack/subscriber.ts](../../packages/modules/integrations/src/slack/subscriber.ts)
- [packages/modules/integrations/src/zapier.ts](../../packages/modules/integrations/src/zapier.ts)
- [packages/modules/integrations/src/zoom-webinars.ts](../../packages/modules/integrations/src/zoom-webinars.ts)

## leads

Tier 6; 10 source files; 1 test files.

Declared connections: @yayatoh/badges, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/ticketing.

Source imports: @yayatoh/badges, @yayatoh/checkin, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/registration, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: leads.captured, leads.email_withdrawn.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| leads.whoScannedMe | public:holder | exhibitors | [source](../../packages/modules/leads/src/attendee.ts#L47) |
| leads.withdrawEmail | public:holder | exhibitors | [source](../../packages/modules/leads/src/attendee.ts#L71) |
| leads.setEmailSharing | public:holder | exhibitors | [source](../../packages/modules/leads/src/attendee.ts#L114) |
| leads.setup | portal:exhibitor | exhibitors | [source](../../packages/modules/leads/src/capture.ts#L202) |
| leads.syncScans | portal:exhibitor | exhibitors | [source](../../packages/modules/leads/src/capture.ts#L374) |
| leads.myLeads | portal:exhibitor | exhibitors | [source](../../packages/modules/leads/src/capture.ts#L413) |
| leads.updateLead | portal:exhibitor | exhibitors | [source](../../packages/modules/leads/src/capture.ts#L430) |
| leads.exportLeads | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/leads/src/capture.ts#L487) |
| leads.saveSettings | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/leads/src/settings.ts#L12) |
| leads.acceptTerms | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/leads/src/settings.ts#L54) |

### Feature rules and lifecycle

#### leads (tier 6) — lead retrieval (M5.6b)

Exhibitor people capture leads by scanning badges in the Scan PWA's lead mode (`/scan/leads`).
Decisions P5-4 (licenses, capture window) and P5-8 (what a scan shares, consent).

**Invariants**
- A lead belongs to one exhibitor; every command and query acts on the signed-in portal
  principal's own exhibitor (`exhibitorPrincipalTx`, re-checked in the transaction), never an
  exhibitor id from the request. Another exhibitor's lead and a teammate's hidden lead are both
  `not_found`.
- Capture needs: a lead license within the allowance (`leadSeatStandingTx`: seats ranked oldest
  first; seats beyond a shrunken allowance are `over_allowance`), the exhibitor admin's acceptance
  of the current lead terms (`LEAD_TERMS_VERSION`), and the window: from 24 h before the event
  starts until 48 h after it ends, judged at each scan's own time (the device's unless it runs
  more than 5 min ahead). Lists, edits and export end 90 days after the event.
- Exactly once: `lead_scans` is unique per exhibitor and scan id; a repeat answers as the first
  time. The exhibitor's syncs serialize on an advisory lock. One lead per exhibitor and ticket; a
  rescan adds to it.
- A lead stores the P5-8 allowlist stamped at the first scan: name, job title, company; email only
  when the ticket holder's current `exhibitor_email_sharing` consent is granted (with its version).
  Phone and address are never read. A withdrawal clears the email (the stamp stays).
- Own vs team: the admin sees all leads; staff see the leads they scanned, or the team's when the
  admin turns on team visibility. The organizer sees no leads.
- Export: admin only, step-up (portal sign-in in the last 10 minutes), the `LeadExportRow`
  allowlist, CSV cells neutralised against formulas, times in the event's zone.

**Events:** `leads.captured@1` `{ orgId, eventId, exhibitorId, leadId, emailShared }`,
`leads.email_withdrawn@1` `{ orgId, eventId, exhibitorId, leadId }` (no consumers yet).


### Source index

- [packages/modules/leads/src/attendee.ts](../../packages/modules/leads/src/attendee.ts)
- [packages/modules/leads/src/capture.ts](../../packages/modules/leads/src/capture.ts)
- [packages/modules/leads/src/data-subject.ts](../../packages/modules/leads/src/data-subject.ts)
- [packages/modules/leads/src/domain/rules.ts](../../packages/modules/leads/src/domain/rules.ts)
- [packages/modules/leads/src/dto.ts](../../packages/modules/leads/src/dto.ts)
- [packages/modules/leads/src/facts.ts](../../packages/modules/leads/src/facts.ts)
- [packages/modules/leads/src/index.ts](../../packages/modules/leads/src/index.ts)
- [packages/modules/leads/src/private-columns.ts](../../packages/modules/leads/src/private-columns.ts)
- [packages/modules/leads/src/schema.ts](../../packages/modules/leads/src/schema.ts)
- [packages/modules/leads/src/settings.ts](../../packages/modules/leads/src/settings.ts)

## marketing

Tier 5; 20 source files; 3 test files.

Declared connections: @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy.

Source imports: @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: none detected.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| marketing.analyticsReport | marketing:read | marketing | [source](../../packages/modules/marketing/src/analytics.ts#L320) |
| marketing.campaignDetail | marketing:read | marketing | [source](../../packages/modules/marketing/src/analytics.ts#L370) |
| marketing.attributionSettings | marketing:read | marketing | [source](../../packages/modules/marketing/src/attribution.ts#L35) |
| marketing.setAttributionWindow | marketing:write | marketing | [source](../../packages/modules/marketing/src/attribution.ts#L45) |
| marketing.attributeOrder | public:checkout | marketing | [source](../../packages/modules/marketing/src/attribution.ts#L111) |
| marketing.orderAttribution | orders:read | marketing | [source](../../packages/modules/marketing/src/attribution.ts#L279) |
| marketing.deliverability | messages:read | marketing | [source](../../packages/modules/marketing/src/deliverability.ts#L109) |
| marketing.createTrackedLink | marketing:write | marketing | [source](../../packages/modules/marketing/src/links.ts#L104) |
| marketing.recordClick | public:track | marketing | [source](../../packages/modules/marketing/src/links.ts#L170) |
| marketing.linkReport | marketing:read | marketing | [source](../../packages/modules/marketing/src/reports.ts#L93) |
| marketing.linkDetail | marketing:read | marketing | [source](../../packages/modules/marketing/src/reports.ts#L126) |
| marketing.utmOnlyReport | marketing:read | marketing | [source](../../packages/modules/marketing/src/reports.ts#L175) |

### Feature rules and lifecycle

#### marketing (tier 5)

Marketing: tracked links, click tracking and order attribution (M3.8a). Campaigns (M3.6b) and journeys (M3.7a) will join this module and create their links through `createTrackedLinkTx`. Owns Postgres schema `marketing`.

**Invariants**
- **Open-redirect proof.** A tracked link's destination is a *path* on the host that served `/r/{code}`, never a URL. `destinationProblem` validates it when the link is created (and a CHECK constraint again in the database); `redirectTarget` builds the Location from the request's own origin and throws if it would leave it.
- **Tenancy.** Codes are global (`tracking_links_code_key`) and resolve only through the SECURITY DEFINER `marketing.tracked_link_target(code)` (allowlisted columns, live orgs, events with a public page). On a tenant host only the host's org's links resolve; the org of a click always comes from the link, never from the request.
- **Signed click id.** The click id is the uuidv7 of the `link_clicks` row; `yyc=<id>~<hmac>` (HMAC-SHA256 under `APP_TOKEN_SECRET`, purpose-bound) goes in the destination URL and the 24-hour `yy_click` cookie. `verifyClickToken` rejects forged, altered, expired and future tokens. A tampered token is ignored, never an error.
- **No PII in the click log.** Only keyed hashes of the IP address and the `yy_did` device cookie (`pseudonym`), no user agent, no referrer. Bots (user agents), HEAD requests and rate-limited floods (`trackedClick` policy) still get the redirect but no click row and no click id.
- **Attribution.** One record per order (`attributions_org_order_key`), written by `attributeOrderCommand` right after the order is created (the checkout hook). Clicks count when they are for the order's event and inside the org's window (default 30 days, 1–90, pending owner) before the order; first touch is the earliest, last touch the latest. Without a click, the UTM values the buyer landed with (`yy_utm` cookie, first and last) give a `utm` record. The records keep the window they were made with.
- **Reports** count sold orders only (paid, partially refunded, refunded) through the orders module's `orderOutcomesTx` facts; revenue is the gross order total per currency in integer minor units (refunds are not netted, as in M1.12's gross). Conversion is last-touch orders per click.
- **Permissions.** Reading links and reports: `marketing:read` (owners, admins, managers, marketing, finance, viewers). Creating links and changing the window: `marketing:write`. Entitlement: `marketing`. An order's attribution record: `orders:read`.
- **Touch paths (M6.2b).** With each attribution record, `attributeOrderCommand` writes the order's
  touch path (`attribution_touches`): every counting click (at most 50: the first and the latest
  49) with its link's UTM values and campaign, or the first and last landings (`utm`, or `referral`
  for a landing from another site: the landing capture turns a foreign `Referer` host into
  `source = host, medium = referral`; only the host is kept). It emits `marketing.order_attributed@1`
  (ids only). `eventTouchPathsTx` serves the paths to the analytics warehouse; records made before
  M6.2b fall back to their first and last touch.


### Source index

- [packages/modules/marketing/src/analytics.ts](../../packages/modules/marketing/src/analytics.ts)
- [packages/modules/marketing/src/attribution.ts](../../packages/modules/marketing/src/attribution.ts)
- [packages/modules/marketing/src/click.ts](../../packages/modules/marketing/src/click.ts)
- [packages/modules/marketing/src/data-subject.ts](../../packages/modules/marketing/src/data-subject.ts)
- [packages/modules/marketing/src/deliverability.ts](../../packages/modules/marketing/src/deliverability.ts)
- [packages/modules/marketing/src/domain/analytics.ts](../../packages/modules/marketing/src/domain/analytics.ts)
- [packages/modules/marketing/src/domain/bots.ts](../../packages/modules/marketing/src/domain/bots.ts)
- [packages/modules/marketing/src/domain/click-token.ts](../../packages/modules/marketing/src/domain/click-token.ts)
- [packages/modules/marketing/src/domain/destination.ts](../../packages/modules/marketing/src/domain/destination.ts)
- [packages/modules/marketing/src/domain/referral.ts](../../packages/modules/marketing/src/domain/referral.ts)
- [packages/modules/marketing/src/domain/touches.ts](../../packages/modules/marketing/src/domain/touches.ts)
- [packages/modules/marketing/src/domain/utm.ts](../../packages/modules/marketing/src/domain/utm.ts)
- [packages/modules/marketing/src/domain/window.ts](../../packages/modules/marketing/src/domain/window.ts)
- [packages/modules/marketing/src/dto.ts](../../packages/modules/marketing/src/dto.ts)
- [packages/modules/marketing/src/index.ts](../../packages/modules/marketing/src/index.ts)
- [packages/modules/marketing/src/links.ts](../../packages/modules/marketing/src/links.ts)
- [packages/modules/marketing/src/private-columns.ts](../../packages/modules/marketing/src/private-columns.ts)
- [packages/modules/marketing/src/reports.ts](../../packages/modules/marketing/src/reports.ts)
- [packages/modules/marketing/src/schema.ts](../../packages/modules/marketing/src/schema.ts)
- [packages/modules/marketing/src/touch-paths.ts](../../packages/modules/marketing/src/touch-paths.ts)

## marketplace

Tier 6; 23 source files; 3 test files.

Declared connections: @yayatoh/cms, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/reviews, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/venues.

Source imports: @yayatoh/cms, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/reviews, @yayatoh/tenancy, @yayatoh/ticketing, @yayatoh/venues.

Tables detected: see schema source.

Event type literals detected: invalid_request, marketplace.listing_changed, marketplace.site_settings_changed, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| marketplace.moderateListing | platform:marketplace.moderate_listing | null or not captured | [source](../../packages/modules/marketplace/src/commands/moderation.ts#L19) |
| marketplace.promotions | marketing:read | core | [source](../../packages/modules/marketplace/src/commands/promotions.ts#L49) |
| marketplace.promoteListing | marketing:write | core | [source](../../packages/modules/marketplace/src/commands/promotions.ts#L99) |
| marketplace.endPromotion | marketing:write | core | [source](../../packages/modules/marketplace/src/commands/promotions.ts#L134) |
| marketplace.addLegacyRedirect | platform:redirects.manage | core | [source](../../packages/modules/marketplace/src/commands/redirects.ts#L34) |
| marketplace.siteSettings | org:read | core | [source](../../packages/modules/marketplace/src/commands/settings.ts#L11) |
| marketplace.updateSiteSettings | org:update | core | [source](../../packages/modules/marketplace/src/commands/settings.ts#L25) |

### Feature rules and lifecycle

#### marketplace (tier 6)

The public listings projection, the marketplace and tenant-site reads, per-org public site
settings and the legacy URL map. Owns Postgres schema `marketplace`.

**Invariants**
- `public_listings` is a projection (roadmap §3.3, §3.5 rule 4): written only by the
  `marketplace.listings` projector (outbox events from events, ticketing, tenancy) and by this
  module's own settings command, never by a runtime join. Each refresh rebuilds a row from its
  sources, so replays converge.
- A row exists only for a `public`, published or postponed event of an active or limited org.
  `on_marketplace` additionally needs the org's enrollment (owner D13: opt-in for new orgs) and
  is never true for weddings.
- Allowlisted columns only: no PII, no ids leave through the DTO. Cross-tenant reads (search,
  cities, sitemap, one listing by slug, redirects) go only through SECURITY DEFINER functions
  that return allowlisted columns; tenant sites read their own rows under RLS.
- Canonical host (roadmap §4.2): verified custom domain, else the tenant-apex subdomain when the
  org runs a tenant site, else null (the marketplace apex).
- Adding a website to the widget's embed origins grants it access to checkout: it needs a recent
  step-up (M1.2c). Removing origins and the other site settings do not.
- `legacy_redirects` rows are written only with the platform permission
  `platform:redirects.manage` (migration tooling); `(host, source)` is globally unique on purpose.

**Search v2 (M6.14a, P6-11)**
- **The port.** `SearchIndex` (`src/search/port.ts`): `setup`, `upsert`, `remove`, `clear`, `search`
  (multi-search). Adapter `meilisearchIndex` (HTTP API; admin key writes, search-only key reads);
  `fakeMeilisearch()` is the only Meilisearch dev and CI talk to (strict: admin vs search keys,
  filter/sort/facet attributes must be configured, every stored document must pass the allowlist).
  `searchIndexFromEnv`: Meilisearch with `MEILISEARCH_URL` + both keys; the per-process fake in dev,
  CI and previews; null (off) in production otherwise.
- **Fed only from the public read model.** The projector emits `marketplace.listing_changed@1`
  (payload: the event id) after it rewrote or dropped a row; the `marketplace.search-index`
  subscriber reads that row under RLS and indexes it only when `on_marketplace` and not a wedding
  (D13's second lock), else removes it. `reindexAll` reads `marketplace.index_listings` (SECURITY
  DEFINER: marketplace rows of live orgs, never weddings).
- **Documents** (`SearchDocument`, `.strict()`): public listing fields only, an opaque id (hash of
  org and event), unix-second dates, the price band, the venue's location rounded to ~100 m, the
  popularity (the org's visible review count). `INDEXED_FIELDS` maps each field to its source
  columns; the canary test checks they are public or vocab.
- **Answers come from the read model.** Searches and recommendations only order slugs; the rows
  shown come from `marketplace.listings_by_slugs` (same rules), so a stale index entry never shows.
- **Moderation.** `listing_moderation` (one row per event; history in the audit log): staff
  (`platform:marketplace.moderate_listing`) hide or show a listing with a reason; the projector keeps
  a hidden listing off the marketplace through every rebuild (the tenant site keeps it).
- **Promoted placements (M6.14b, flag `PROMOTED_PLACEMENTS`):** `promotions` (one per event, 1–30 days, only marketplace listings, never weddings). Search reads running ones through the SECURITY DEFINER `promoted_slugs(now)` and shows at most `PROMOTED_SLOTS` that match the visitor's query and filters, page 1 only, hydrated from the public read model and always labelled as promoted. Nothing is charged.


### Source index

- [packages/modules/marketplace/src/commands/moderation.ts](../../packages/modules/marketplace/src/commands/moderation.ts)
- [packages/modules/marketplace/src/commands/promotions.ts](../../packages/modules/marketplace/src/commands/promotions.ts)
- [packages/modules/marketplace/src/commands/redirects.ts](../../packages/modules/marketplace/src/commands/redirects.ts)
- [packages/modules/marketplace/src/commands/settings.ts](../../packages/modules/marketplace/src/commands/settings.ts)
- [packages/modules/marketplace/src/domain/embed.ts](../../packages/modules/marketplace/src/domain/embed.ts)
- [packages/modules/marketplace/src/domain/listing.ts](../../packages/modules/marketplace/src/domain/listing.ts)
- [packages/modules/marketplace/src/domain/redirects.ts](../../packages/modules/marketplace/src/domain/redirects.ts)
- [packages/modules/marketplace/src/domain/search.ts](../../packages/modules/marketplace/src/domain/search.ts)
- [packages/modules/marketplace/src/dto.ts](../../packages/modules/marketplace/src/dto.ts)
- [packages/modules/marketplace/src/index.ts](../../packages/modules/marketplace/src/index.ts)
- [packages/modules/marketplace/src/private-columns.ts](../../packages/modules/marketplace/src/private-columns.ts)
- [packages/modules/marketplace/src/projector.ts](../../packages/modules/marketplace/src/projector.ts)
- [packages/modules/marketplace/src/queries.ts](../../packages/modules/marketplace/src/queries.ts)
- [packages/modules/marketplace/src/schema.ts](../../packages/modules/marketplace/src/schema.ts)
- [packages/modules/marketplace/src/search/document.ts](../../packages/modules/marketplace/src/search/document.ts)
- [packages/modules/marketplace/src/search/indexer.ts](../../packages/modules/marketplace/src/search/indexer.ts)
- [packages/modules/marketplace/src/search/meilisearch-fake.ts](../../packages/modules/marketplace/src/search/meilisearch-fake.ts)
- [packages/modules/marketplace/src/search/meilisearch.ts](../../packages/modules/marketplace/src/search/meilisearch.ts)
- [packages/modules/marketplace/src/search/params.ts](../../packages/modules/marketplace/src/search/params.ts)
- [packages/modules/marketplace/src/search/port.ts](../../packages/modules/marketplace/src/search/port.ts)
- [packages/modules/marketplace/src/search/promoted.ts](../../packages/modules/marketplace/src/search/promoted.ts)
- [packages/modules/marketplace/src/search/query.ts](../../packages/modules/marketplace/src/search/query.ts)
- [packages/modules/marketplace/src/search/select.ts](../../packages/modules/marketplace/src/search/select.ts)

## media

Tier 4; 22 source files; 8 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/tenancy, @yayatoh/venues.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/tenancy, @yayatoh/venues.

Tables detected: see schema source.

Event type literals detected: media.asset_added, media.asset_removed, system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| media.library | org:read | core | [source](../../packages/modules/media/src/library.ts#L324) |
| media.deleteLibraryImage | events:write | core | [source](../../packages/modules/media/src/library.ts#L354) |
| media.storageUsage | org:read | core | [source](../../packages/modules/media/src/library.ts#L435) |
| media.uploadMedia | events:write | core | [source](../../packages/modules/media/src/media.ts#L353) |
| media.uploadLogo | org:update | core | [source](../../packages/modules/media/src/media.ts#L373) |
| media.removeMedia | events:write | core | [source](../../packages/modules/media/src/media.ts#L420) |
| media.removeLogo | org:update | core | [source](../../packages/modules/media/src/media.ts#L432) |
| media.updateMediaAlt | events:write | core | [source](../../packages/modules/media/src/media.ts#L472) |
| media.updateLogoAlt | org:update | core | [source](../../packages/modules/media/src/media.ts#L483) |
| media.listMedia | org:read | core | [source](../../packages/modules/media/src/media.ts#L583) |
| media.listOwnersMedia | org:read | core | [source](../../packages/modules/media/src/media.ts#L613) |
| media.usage | org:read | core | [source](../../packages/modules/media/src/media.ts#L630) |
| media.uploadSpeakerPortalFile | portal:speaker | speakers | [source](../../packages/modules/media/src/portal-files.ts#L73) |
| media.portalFile | events:read | speakers | [source](../../packages/modules/media/src/portal-files.ts#L182) |
| media.portalUploadExhibitorLogo | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/media/src/portal.ts#L23) |
| media.portalExhibitorLogo | portal:exhibitor | exhibitors | [source](../../packages/modules/media/src/portal.ts#L73) |

### Feature rules and lifecycle

#### media (tier 4)

Uploaded images: event cover and gallery, venue photos, the org logo (M1.4e); speaker photos, exhibitor and sponsor logos (M1.4h). Owns Postgres schema `media`. Tier 4 so it can check program owners (tier 3); nothing below imports it.

**Invariants**
- An upload is what its **bytes** are (magic-byte sniffing): JPEG, PNG, GIF, WebP, AVIF or SVG. The file name and Content-Type are never trusted. At most 4 MB (Vercel's request cap; SVG 1 MB) and 40 megapixels.
- Nothing is served as uploaded. Rasters are decoded (first frame), auto-oriented and **re-encoded** to AVIF and WebP at the standard widths (320/640/1280/1920, never enlarged) plus one PNG/JPEG fallback (≤1280 px) for email and OG images; encoders write no metadata, so EXIF/GPS, XMP, IPTC and ICC never survive. SVGs are **sanitized** to an allowlisted subset (no script, handlers, `javascript:`, `foreignObject`, animation, external references, DOCTYPE/entities) and also rasterized from the sanitized document.
- `media.assets` / `media.variants` are tenant rows (FORCE RLS). Alt text is required unless the image is marked decorative (CHECK). `cover` and `logo` hold one image; `gallery` and `photo` at most 20.
- Files live in the `MediaStore` port under `{org}/{asset}/{width}-{sha256[:32]}.{ext}` (content-hashed, immutable). Adapters: `postgres` (dev/CI, `media.blobs`) and `r2` (production; owner inbox). Every store call names the org and refuses keys outside its prefix.
- Uploads count against the org's quota (`media.quotas`, default 1 GiB) under a per-org advisory lock; a replacement's old bytes don't count twice. Removing or replacing an image deletes its rows in the command and its files right after commit; a failed upload's files are purged.
- Permissions: event and venue images need `events:write`; the logo needs `org:update` (it also sets `tenancy.organizations.logo_path/logo_alt` through tenancy's `setOrganizationLogoTx`). Every member may list.
- Public reads only through the SECURITY DEFINER functions `media.public_media`, `media.public_covers` and `media.serve_target` (via `media.owner_visibility`): event images while the event has a public page (private events only with an access grant the server checked), venue photos of listed live venues, the logo of an active org. Output is allowlisted (`PublicMediaDto`).
- Program images (M1.4h): owner types `speaker` (slot `photo`), `exhibitor` and `sponsor` (slot `logo`), one image each, always described (never decorative). Commands per kind need that kind's program entitlement (`speakers`, `exhibitors`, `sponsors`) and `events:write`. Visibility follows the row's event (`media.owner_event`). A deleted row's images are removed by the subscriber `media.program-owner-cleanup` on `program.{speaker,exhibitor,sponsor}_deleted@1` (rows, then files).
- Events emitted: `media.asset_added@1`, `media.asset_removed@1`. Consumed: `program.speaker_deleted@1`, `program.exhibitor_deleted@1`, `program.sponsor_deleted@1`.
- M5.3a `portal_files`: speaker task answers and proposed photos, sniffed (PDF/PPTX/DOCX/JPEG/PNG/WebP), ≤ 25 MB (photos ≤ 4 MB and decodable), stored as uploaded under `{org}/{file}/f-{hash}.{ext}`, never public; organizers read them through `media.portalFile` (`events:read`). `media.speaker-photo-approver` turns an approved proposed photo into the speaker photo (`program.speaker_change.decided@1`).
- U10 media library: owner type `library` (owner id = the org, slot `library`) holds images uploaded straight to the library (members only: `owner_visibility` is `none`). A **reuse** is an asset row with `source_asset_id` (always an original, `bytes = 0`, never `library`) whose variant rows name the original's files, so nothing is stored twice and the quota counts originals only; each placement has its own URL and visibility, and `media.serve_target_v3` returns `storage_asset_id` (whose files to read). An original can't be deleted while reused (FK `assets_source_fk`, restrict): `releaseTx` moves a reused original to the library when it is removed, replaced or its program owner is deleted. `deleteLibraryImageCommand` deletes only an unused library original. Commands `media.reuse{Media,Logo,SpeakerPhoto,ExhibitorLogo,SponsorLogo}` follow each family's permission; `libraryQuery` and `storageUsageQuery` are for every member. Floor plans are never offered for reuse. A speaker's erasure removes their photo's original and every reuse.


### Source index

- [packages/modules/media/src/data-subject.ts](../../packages/modules/media/src/data-subject.ts)
- [packages/modules/media/src/dto.ts](../../packages/modules/media/src/dto.ts)
- [packages/modules/media/src/index.ts](../../packages/modules/media/src/index.ts)
- [packages/modules/media/src/library.ts](../../packages/modules/media/src/library.ts)
- [packages/modules/media/src/media.ts](../../packages/modules/media/src/media.ts)
- [packages/modules/media/src/pipeline/documents.ts](../../packages/modules/media/src/pipeline/documents.ts)
- [packages/modules/media/src/pipeline/plan.ts](../../packages/modules/media/src/pipeline/plan.ts)
- [packages/modules/media/src/pipeline/process.ts](../../packages/modules/media/src/pipeline/process.ts)
- [packages/modules/media/src/pipeline/sniff.ts](../../packages/modules/media/src/pipeline/sniff.ts)
- [packages/modules/media/src/pipeline/svg.ts](../../packages/modules/media/src/pipeline/svg.ts)
- [packages/modules/media/src/portal-files.ts](../../packages/modules/media/src/portal-files.ts)
- [packages/modules/media/src/portal.ts](../../packages/modules/media/src/portal.ts)
- [packages/modules/media/src/private-columns.ts](../../packages/modules/media/src/private-columns.ts)
- [packages/modules/media/src/schema-files.ts](../../packages/modules/media/src/schema-files.ts)
- [packages/modules/media/src/schema.ts](../../packages/modules/media/src/schema.ts)
- [packages/modules/media/src/storage/config.ts](../../packages/modules/media/src/storage/config.ts)
- [packages/modules/media/src/storage/port.ts](../../packages/modules/media/src/storage/port.ts)
- [packages/modules/media/src/storage/postgres.ts](../../packages/modules/media/src/storage/postgres.ts)
- [packages/modules/media/src/storage/r2.ts](../../packages/modules/media/src/storage/r2.ts)
- [packages/modules/media/src/subject-erased.ts](../../packages/modules/media/src/subject-erased.ts)
- [packages/modules/media/src/testing.ts](../../packages/modules/media/src/testing.ts)
- [packages/modules/media/src/ticket.ts](../../packages/modules/media/src/ticket.ts)

## messaging

Tier 3; 8 source files; 0 test files.

Declared connections: @yayatoh/attendees, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.

Source imports: @yayatoh/attendees, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: announcement.sent, messaging.report_filed, system, thread.contact_wrote, thread.replied.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| messaging.previewAnnouncement | messages:send | messaging | [source](../../packages/modules/messaging/src/announcements.ts#L47) |
| messaging.sendAnnouncement | messages:send | messaging | [source](../../packages/modules/messaging/src/announcements.ts#L125) |
| messaging.announcements | messages:read | messaging | [source](../../packages/modules/messaging/src/announcements.ts#L182) |
| messaging.reviewReport | platform:messaging.review_report | null or not captured | [source](../../packages/modules/messaging/src/review.ts#L108) |
| messaging.threads | messages:read | messaging | [source](../../packages/modules/messaging/src/threads.ts#L116) |
| messaging.thread | messages:read | messaging | [source](../../packages/modules/messaging/src/threads.ts#L177) |
| messaging.markThreadRead | messages:read | messaging | [source](../../packages/modules/messaging/src/threads.ts#L204) |
| messaging.replyToThread | messages:send | messaging | [source](../../packages/modules/messaging/src/threads.ts#L223) |
| messaging.blockThread | messages:send | messaging | [source](../../packages/modules/messaging/src/threads.ts#L271) |
| messaging.reportThread | messages:send | messaging | [source](../../packages/modules/messaging/src/threads.ts#L330) |
| messaging.contactMessage | public:messaging | messaging | [source](../../packages/modules/messaging/src/threads.ts#L408) |
| messaging.contactBlock | public:messaging | messaging | [source](../../packages/modules/messaging/src/threads.ts#L457) |
| messaging.contactReport | public:messaging | messaging | [source](../../packages/modules/messaging/src/threads.ts#L483) |

### Feature rules and lifecycle

#### messaging (tier 3)

Organizer announcements and organizer↔customer conversations (M1.10c). Owns Postgres schema
`messaging`. Sends through the notifications module (the platform `Notifier` port); reads
attendees and events down the tiers.

**Invariants**
- An announcement goes to the event's active attendees, one message per email address; it is
  recorded before it is sent (the sent log) and fanned out by the worker under per-address dedupe
  keys, so a replay sends nothing twice. Staff `pause_messaging` refuses new announcements.
- One conversation per org and contact email. Every announcement and reply carries a signed link
  (HMAC of the thread id) back into that conversation; the link is the contact's only credential.
- The organizer can block a conversation (the contact's messages are refused) and report it; the
  contact can block the organizer (no more replies, and the org's event updates to that address
  stop) and report it. Reports wait for platform staff review.
- Contacts can write at most `CONTACT_HOURLY_LIMIT` messages per hour into one conversation.
- The public view of a conversation is allowlisted: no staff names, user ids or internal ids.
- Platform staff review reports (M1.10d) through `reportsForReviewTx` (a platform_reader read in
  apps/admin, allowlisted: no contact addresses or internal ids) and `reviewReportCommand` (a
  platform actor; resolved or dismissed with a note, audited in the org; once only).


### Source index

- [packages/modules/messaging/src/announcements.ts](../../packages/modules/messaging/src/announcements.ts)
- [packages/modules/messaging/src/data-subject.ts](../../packages/modules/messaging/src/data-subject.ts)
- [packages/modules/messaging/src/index.ts](../../packages/modules/messaging/src/index.ts)
- [packages/modules/messaging/src/private-columns.ts](../../packages/modules/messaging/src/private-columns.ts)
- [packages/modules/messaging/src/review.ts](../../packages/modules/messaging/src/review.ts)
- [packages/modules/messaging/src/schema.ts](../../packages/modules/messaging/src/schema.ts)
- [packages/modules/messaging/src/threads.ts](../../packages/modules/messaging/src/threads.ts)
- [packages/modules/messaging/src/timeline.ts](../../packages/modules/messaging/src/timeline.ts)

## notifications

Tier 2; 57 source files; 13 test files.

Declared connections: @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.

Source imports: @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui/tokens.

Tables detected: see schema source.

Event type literals detected: body, bounced, complained, delivered, individual, json, messaging.auto_paused, messaging.delivery_problems, messaging.usage_metered, org.suspension_changed, system, template, text, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| notifications.recordDeliveryEvents | platform:notifications.delivery_events | null or not captured | [source](../../packages/modules/notifications/src/delivery.ts#L150) |
| notifications.emailIdentity | org:read | core | [source](../../packages/modules/notifications/src/email-identity.ts#L98) |
| notifications.setEmailIdentity | org:update | core | [source](../../packages/modules/notifications/src/email-identity.ts#L108) |
| notifications.recordInboundKeyword | platform:notifications.inbound | null or not captured | [source](../../packages/modules/notifications/src/inbound.ts#L22) |
| notifications.inboxCount | org:read | core | [source](../../packages/modules/notifications/src/inbox.ts#L32) |
| notifications.inbox | org:read | core | [source](../../packages/modules/notifications/src/inbox.ts#L45) |
| notifications.markInboxRead | org:read | core | [source](../../packages/modules/notifications/src/inbox.ts#L88) |
| notifications.sendTest | org:read | core | [source](../../packages/modules/notifications/src/inbox.ts#L118) |
| notifications.orderMessages | orders:read | ticketing | [source](../../packages/modules/notifications/src/inbox.ts#L177) |
| notifications.templateOverrides | org:read | core | [source](../../packages/modules/notifications/src/overrides.ts#L57) |
| notifications.setTemplateOverride | org:update | core | [source](../../packages/modules/notifications/src/overrides.ts#L81) |
| notifications.previewTemplate | org:read | core | [source](../../packages/modules/notifications/src/overrides.ts#L127) |
| notifications.messagingUsage | org:read | core | [source](../../packages/modules/notifications/src/policy/console.ts#L114) |
| notifications.setQuotaLimit | platform:messaging.quota | null or not captured | [source](../../packages/modules/notifications/src/policy/console.ts#L124) |
| notifications.frequencyCaps | org:read | core | [source](../../packages/modules/notifications/src/policy/console.ts#L180) |
| notifications.setFrequencyCaps | org:update | core | [source](../../packages/modules/notifications/src/policy/console.ts#L202) |
| notifications.autoPause | org:read | core | [source](../../packages/modules/notifications/src/policy/console.ts#L337) |
| notifications.liftAutoPause | platform:messaging.auto_pause.lift | null or not captured | [source](../../packages/modules/notifications/src/policy/console.ts#L347) |
| notifications.policyLog | messages:read | core | [source](../../packages/modules/notifications/src/policy/console.ts#L395) |
| notifications.addressSuppressions | messages:read | core | [source](../../packages/modules/notifications/src/policy/console.ts#L471) |
| notifications.liftAddressSuppression | org:update | core | [source](../../packages/modules/notifications/src/policy/console.ts#L498) |
| notifications.savePreferenceCenter | public:preferences | null or not captured | [source](../../packages/modules/notifications/src/preference-center.ts#L124) |
| notifications.myPreferences | org:read | core | [source](../../packages/modules/notifications/src/preferences.ts#L44) |
| notifications.setMyPreferences | org:read | core | [source](../../packages/modules/notifications/src/preferences.ts#L75) |
| notifications.storeEmailPreview | org:read | core | [source](../../packages/modules/notifications/src/previews.ts#L35) |
| notifications.emailPreview | org:read | core | [source](../../packages/modules/notifications/src/previews.ts#L59) |
| notifications.registerPushToken | org:read | core | [source](../../packages/modules/notifications/src/push.ts#L207) |
| notifications.removePushToken | org:read | core | [source](../../packages/modules/notifications/src/push.ts#L244) |
| notifications.myPushDevices | org:read | core | [source](../../packages/modules/notifications/src/push.ts#L267) |
| notifications.sendingSetup | org:read | core | [source](../../packages/modules/notifications/src/senders.ts#L136) |
| notifications.addSendingDomain | org:update | core | [source](../../packages/modules/notifications/src/senders.ts#L179) |
| notifications.recordSendingDomainCheck | org:update | core | [source](../../packages/modules/notifications/src/senders.ts#L224) |
| notifications.removeSendingDomain | org:update | core | [source](../../packages/modules/notifications/src/senders.ts#L271) |
| notifications.setChannelSender | platform:messaging.senders | null or not captured | [source](../../packages/modules/notifications/src/senders.ts#L297) |
| notifications.unsubscribe | public:unsubscribe | null or not captured | [source](../../packages/modules/notifications/src/unsubscribe.ts#L115) |
| notifications.resubscribe | public:unsubscribe | null or not captured | [source](../../packages/modules/notifications/src/unsubscribe.ts#L171) |

### Feature rules and lifecycle

#### notifications (tier 2)

Outbound messages and the member inbox (M1.10). Owns Postgres schema `notifications`. Implements
the platform `Notifier` port: modules describe what to send (`kind`, recipient, params, dedupe
key) inside their own transaction; this module records, gates, renders and sends.

**Invariants**
- Every message is one of the kinds in `src/kinds.ts`; the kind fixes its category, default
  channels, required params and whether quiet hours apply.
- One row per `(org, channel, dedupe_key)` in `messages`: a replayed or duplicated event never
  creates a second delivery. The dispatcher claims due rows with `FOR UPDATE SKIP LOCKED`, so two
  dispatchers never hand the same row to a provider.
- Template params are stored encrypted with the org's key envelope (they can carry link tokens).
- Transactional messages (tickets, refunds, invitations, ticket links, replies the customer asked
  for) are never suppressed. Every other category checks, in order: the org kill switch
  (`pause_messaging` holds them), unsubscribes (`suppressions`), the recipient's preferences, then
  quiet hours (21:00–08:00 in the recipient's timezone: theirs, else the event's, else the org's).
- Unsubscribable email carries RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post`; the token is
  an HMAC of the message id (nothing secret stored). Unsubscribing never needs an account.
- Inbox items and preferences belong to one user; queries and commands take the user from the
  session, never from input.
- Push tokens keep their real platform; legacy APNs tokens are imported as `apns` (the legacy app
  sent them through FCM).
- Providers (SES, Twilio, WhatsApp, FCM v1, APNs) are owner accounts: until they exist,
  `devMailboxTransports` (dev/CI) and `memoryTransports` (tests) stand in. Web push (M1.10e) is a
  real adapter (RFC 8030/8291/8292 with `node:crypto`) that only contacts known push services.
- Web push devices belong to a member (`user_id`) or a guest buyer (`email_norm`), never both; at
  most 10 per person and org. Push is queued only for people with an active device, sent once per
  device (`push_deliveries`, also across retries), and pruned on 404/410. Payloads are an
  allowlist (title, body, a link on our origin); endpoints and keys never leave the server.
- Delivery reports (M1.10d) come from a verified provider webhook and are kept once per provider
  event id (`message_events`, append-only). Hard bounces, complaints and repeated soft bounces put
  the address on `address_suppressions`, which the dispatcher honours for every category,
  transactional included (the message is `suppressed`, reason `bounced`/`complained`).
- Erased addresses (M1.14e): the global `platform.erased_addresses` list (hashes only) is checked
  for every org's email. Order mail (transactional kinds about an order or ticket) goes out; account
  mail (invitations, member notifications) only after the person signed up again; everything else
  is `suppressed` (`erased`) until the org records a marketing consent given after the erasure.
- `cancelQueuedTx` cancels queued messages by dedupe key with a reason (a survey reminder once the person answered, M3.9a); sent messages never change.
- Reminders are the day before at the same wall-clock time in the event's timezone; queued
  reminders are re-planned from the event's (or date's) current start whenever it changes, so
  replays are harmless. Sent messages are never rewritten.
- Member notifications render in the member's own email language, looked up at send time.
- Email previews are stored for ten minutes (`email_previews`, creator only) and served from their
  own URL with their own sandboxed CSP; drafts never travel in URLs.
- Policy gate v2 (M3.5a) is a registry of rules (`src/policy/gate.ts`, `POLICY_RULES`) run in two
  phases: `eligibility` blocks (texts without consent in the crm ledger, US marketing WhatsApp) and
  `timing` holds (state calling hours as data, frequency caps, monthly quotas). A hold keeps the
  message queued with a reason; a quota or cap never drops reminders or updates.
- Every send is metered in `usage_counters` (SMS by GSM-7/UCS-2 segment). Over the org's quota,
  optional messages wait; transactional messages and members' alerts never do.
- A complaint rate on optional email strictly above 0.3 % (30 days, ≥ 100 sent, since the last
  auto-pause) switches
  on the org's `pause_messaging` suspension and records `auto_pauses`; only staff lift it (audited).
- Frequency caps count by `recipient_key` (an HMAC of channel and address), never a readable phone.
- Provider adapters (M3.5b, `src/providers/`) are chosen by config names only: SES (SigV4,
  `node:crypto`), Twilio, the WhatsApp Cloud API and the owner's gateway behind the same ports,
  each live only when switched on and fully configured (`providerMode`). Every webhook is verified
  on the raw body (SNS certificate host + signature + topic + age; `X-Twilio-Signature` over the
  URL and form; `X-Hub-Signature-256`; the gateway's timestamped HMAC) before anything is
  recorded, and each event's org comes from our message id, never from the payload.
- Fallback chains per category (`src/fallback.ts`): a message that can't reach the person on its
  channel for a reachability reason goes to the next channel **once** (same dedupe key, so the
  `(org, channel, dedupe_key)` unique makes it idempotent across providers, retries and
  webhooks); never for consent, opt-outs, unsubscribes or holds; marketing never falls back.
- Inbound STOP/START/HELP (`src/inbound.ts`) apply once per provider message id and org: STOP
  withdraws that channel's consent in the crm ledger (with evidence) and suppresses the number
  (`opt_out`, lifted only by START); the org comes from the dedicated sender reached, else every org
  that texted the number from the shared sender (by `recipient_key`, never a readable number).
- Provider health (`notifications.provider_health`) is a platform table of counters only (no org,
  address or id), written through a SECURITY DEFINER function after the tenant transaction.
- A sending domain belongs to one org platform-wide; mail uses it only while DKIM and SPF are
  verified. A dedicated SMS Messaging Service is used only once its 10DLC campaign is verified.
- U10 "Email sending" (`email_settings`, one row per org): the From name and Reply-To put on every email the dispatcher sends (and the web's guest-code emails). The From address never changes (verified sending domain, else the platform sender); the name can't contain an address, `@ < > "` or a domain-looking string (CHECK + `checkFromName`), and Reply-To can't be a Yayatoh address (`checkReplyTo`). SES gets `ReplyToAddresses`. Kind `cms.contact_message` (U10) tells the org's messages roles about a contact-page message.


### Source index

- [packages/modules/notifications/src/account-data.ts](../../packages/modules/notifications/src/account-data.ts)
- [packages/modules/notifications/src/contact-merge.ts](../../packages/modules/notifications/src/contact-merge.ts)
- [packages/modules/notifications/src/data-subject.ts](../../packages/modules/notifications/src/data-subject.ts)
- [packages/modules/notifications/src/deliverability-rules.ts](../../packages/modules/notifications/src/deliverability-rules.ts)
- [packages/modules/notifications/src/deliverability.ts](../../packages/modules/notifications/src/deliverability.ts)
- [packages/modules/notifications/src/delivery-rules.ts](../../packages/modules/notifications/src/delivery-rules.ts)
- [packages/modules/notifications/src/delivery.ts](../../packages/modules/notifications/src/delivery.ts)
- [packages/modules/notifications/src/dispatch.ts](../../packages/modules/notifications/src/dispatch.ts)
- [packages/modules/notifications/src/email-identity.ts](../../packages/modules/notifications/src/email-identity.ts)
- [packages/modules/notifications/src/fallback.ts](../../packages/modules/notifications/src/fallback.ts)
- [packages/modules/notifications/src/inbound.ts](../../packages/modules/notifications/src/inbound.ts)
- [packages/modules/notifications/src/inbox.ts](../../packages/modules/notifications/src/inbox.ts)
- [packages/modules/notifications/src/index.ts](../../packages/modules/notifications/src/index.ts)
- [packages/modules/notifications/src/integration-suppressions.ts](../../packages/modules/notifications/src/integration-suppressions.ts)
- [packages/modules/notifications/src/kinds.ts](../../packages/modules/notifications/src/kinds.ts)
- [packages/modules/notifications/src/message-states.ts](../../packages/modules/notifications/src/message-states.ts)
- [packages/modules/notifications/src/notifier.ts](../../packages/modules/notifications/src/notifier.ts)
- [packages/modules/notifications/src/overrides.ts](../../packages/modules/notifications/src/overrides.ts)
- [packages/modules/notifications/src/policy/config.ts](../../packages/modules/notifications/src/policy/config.ts)
- [packages/modules/notifications/src/policy/console.ts](../../packages/modules/notifications/src/policy/console.ts)
- [packages/modules/notifications/src/policy/gate.ts](../../packages/modules/notifications/src/policy/gate.ts)
- [packages/modules/notifications/src/policy/rules.ts](../../packages/modules/notifications/src/policy/rules.ts)
- [packages/modules/notifications/src/policy/sms-segments.ts](../../packages/modules/notifications/src/policy/sms-segments.ts)
- [packages/modules/notifications/src/policy/state-rules.ts](../../packages/modules/notifications/src/policy/state-rules.ts)
- [packages/modules/notifications/src/policy/windows.ts](../../packages/modules/notifications/src/policy/windows.ts)
- [packages/modules/notifications/src/preference-center.ts](../../packages/modules/notifications/src/preference-center.ts)
- [packages/modules/notifications/src/preferences.ts](../../packages/modules/notifications/src/preferences.ts)
- [packages/modules/notifications/src/previews.ts](../../packages/modules/notifications/src/previews.ts)
- [packages/modules/notifications/src/private-columns.ts](../../packages/modules/notifications/src/private-columns.ts)
- [packages/modules/notifications/src/provider-health.ts](../../packages/modules/notifications/src/provider-health.ts)
- [packages/modules/notifications/src/providers/config.ts](../../packages/modules/notifications/src/providers/config.ts)
- [packages/modules/notifications/src/providers/keywords.ts](../../packages/modules/notifications/src/providers/keywords.ts)
- [packages/modules/notifications/src/providers/select.ts](../../packages/modules/notifications/src/providers/select.ts)
- [packages/modules/notifications/src/providers/ses.ts](../../packages/modules/notifications/src/providers/ses.ts)
- [packages/modules/notifications/src/providers/sigv4.ts](../../packages/modules/notifications/src/providers/sigv4.ts)
- [packages/modules/notifications/src/providers/sns.ts](../../packages/modules/notifications/src/providers/sns.ts)
- [packages/modules/notifications/src/providers/twilio.ts](../../packages/modules/notifications/src/providers/twilio.ts)
- [packages/modules/notifications/src/providers/types.ts](../../packages/modules/notifications/src/providers/types.ts)
- [packages/modules/notifications/src/providers/whatsapp.ts](../../packages/modules/notifications/src/providers/whatsapp.ts)
- [packages/modules/notifications/src/push.ts](../../packages/modules/notifications/src/push.ts)
- [packages/modules/notifications/src/quiet-hours.ts](../../packages/modules/notifications/src/quiet-hours.ts)
- [packages/modules/notifications/src/reminder-time.ts](../../packages/modules/notifications/src/reminder-time.ts)
- [packages/modules/notifications/src/reminders.ts](../../packages/modules/notifications/src/reminders.ts)
- [packages/modules/notifications/src/schema.ts](../../packages/modules/notifications/src/schema.ts)
- [packages/modules/notifications/src/senders.ts](../../packages/modules/notifications/src/senders.ts)
- [packages/modules/notifications/src/stored-content.ts](../../packages/modules/notifications/src/stored-content.ts)
- [packages/modules/notifications/src/templates/cutover.ts](../../packages/modules/notifications/src/templates/cutover.ts)
- [packages/modules/notifications/src/templates/merge.ts](../../packages/modules/notifications/src/templates/merge.ts)
- [packages/modules/notifications/src/templates/numbers.ts](../../packages/modules/notifications/src/templates/numbers.ts)
- [packages/modules/notifications/src/templates/render.ts](../../packages/modules/notifications/src/templates/render.ts)
- [packages/modules/notifications/src/templates/samples.ts](../../packages/modules/notifications/src/templates/samples.ts)
- [packages/modules/notifications/src/testing.ts](../../packages/modules/notifications/src/testing.ts)
- [packages/modules/notifications/src/transports.ts](../../packages/modules/notifications/src/transports.ts)
- [packages/modules/notifications/src/unsubscribe.ts](../../packages/modules/notifications/src/unsubscribe.ts)
- [packages/modules/notifications/src/web-push-transport.ts](../../packages/modules/notifications/src/web-push-transport.ts)
- [packages/modules/notifications/src/web-push.ts](../../packages/modules/notifications/src/web-push.ts)
- [packages/modules/notifications/src/webhooks.ts](../../packages/modules/notifications/src/webhooks.ts)

## orders

Tier 4; 57 source files; 10 test files.

Declared connections: @yayatoh/attendees, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/program, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/attendees, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/guests, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/payments, @yayatoh/platform, @yayatoh/platform/security, @yayatoh/program, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: order.addon_paid, order.checkout_blocked, order.credit_note_issued, order.dispute_closed, order.disputed, order.donation_paid, order.expired, order.imported, order.invoice_payment_recorded, order.invoiced, order.links_requested, order.manage_link_reissued, order.mass_refund_finished, order.mass_refund_started, order.paid, order.payment_failed, order.payment_orphaned, order.payment_started, order.refund_request_declined, order.refund_requested, order.refunded, order.reserved, order.risk_flagged, order.support_reply, order.voided, system, table.naming_link_requested, table.slot_named, ticket.resend_requested, tickets.cancelled, user, waitlist.joined, waitlist.offer_expired, waitlist.offer_released, waitlist.offered.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| orders.startSponsorPackageCheckout | portal:sponsor_contact | sponsors | [source](../../packages/modules/orders/src/addon-orders.ts#L124) |
| orders.startLeadLicenseCheckout | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/orders/src/addon-orders.ts#L143) |
| orders.bookingSearch | orders:read | ticketing | [source](../../packages/modules/orders/src/bookings.ts#L138) |
| orders.recordBoxOfficeSale | orders:sell | ticketing | [source](../../packages/modules/orders/src/commands/box-office.ts#L39) |
| orders.startCheckout | public:checkout | ticketing | [source](../../packages/modules/orders/src/commands/checkout.ts#L430) |
| orders.attachPayment | public:checkout | ticketing | [source](../../packages/modules/orders/src/commands/checkout.ts#L453) |
| orders.applyProviderEvent | platform:payments.webhook | null or not captured | [source](../../packages/modules/orders/src/commands/checkout.ts#L497) |
| orders.expireOrders | platform:orders.sweep | null or not captured | [source](../../packages/modules/orders/src/commands/checkout.ts#L619) |
| orders.recordCheckoutBlock | public:checkout | ticketing | [source](../../packages/modules/orders/src/commands/checkout.ts#L665) |
| orders.issueCreditNote | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/credit-notes.ts#L113) |
| orders.creditNotes | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/credit-notes.ts#L208) |
| orders.creditNoteTotals | finance:read | ticketing | [source](../../packages/modules/orders/src/commands/credit-notes.ts#L240) |
| orders.creditNoteDocument | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/credit-notes.ts#L286) |
| orders.applyDisputeEvent | platform:payments.webhook | null or not captured | [source](../../packages/modules/orders/src/commands/disputes.ts#L16) |
| orders.startInvoicePayment | public:checkout | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L302) |
| orders.attachInvoicePayment | public:checkout | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L367) |
| orders.recordInvoicePayment | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L461) |
| orders.voidInvoice | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L563) |
| orders.orderInvoice | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L721) |
| orders.eventInvoices | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L746) |
| orders.invoiceDocument | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/invoices.ts#L821) |
| orders.cancellationPreview | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/mass-refunds.ts#L105) |
| orders.startMassRefund | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/mass-refunds.ts#L223) |
| orders.massRefundStatus | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/mass-refunds.ts#L327) |
| orders.massRefunds | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/mass-refunds.ts#L337) |
| orders.nextMassRefundStep | platform:orders.mass_refund | ticketing | [source](../../packages/modules/orders/src/commands/mass-refunds.ts#L501) |
| orders.settleMassRefundItem | platform:orders.mass_refund | ticketing | [source](../../packages/modules/orders/src/commands/mass-refunds.ts#L662) |
| orders.addOrderNote | orders:note | ticketing | [source](../../packages/modules/orders/src/commands/order-notes.ts#L17) |
| orders.orderNotes | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/order-notes.ts#L49) |
| orders.registerPush | public:order-push | null or not captured | [source](../../packages/modules/orders/src/commands/push.ts#L45) |
| orders.removePush | public:order-push | null or not captured | [source](../../packages/modules/orders/src/commands/push.ts#L72) |
| orders.setRefundPolicy | events:write | ticketing | [source](../../packages/modules/orders/src/commands/refund-policy.ts#L64) |
| orders.refundPolicy | events:read | null or not captured | [source](../../packages/modules/orders/src/commands/refund-policy.ts#L149) |
| orders.requestRefund | public:refund_request | ticketing | [source](../../packages/modules/orders/src/commands/refund-requests.ts#L112) |
| orders.refundRequests | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/refund-requests.ts#L287) |
| orders.refundRequestCounts | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/refund-requests.ts#L319) |
| orders.declineRefundRequest | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/refund-requests.ts#L342) |
| orders.refundPreview | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/refunds.ts#L193) |
| orders.startRefund | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/refunds.ts#L322) |
| orders.startPolicyOverrideRefund | orders:refund_override | ticketing | [source](../../packages/modules/orders/src/commands/refunds.ts#L349) |
| orders.completeRefund | orders:refund | ticketing | [source](../../packages/modules/orders/src/commands/refunds.ts#L497) |
| orders.orderRefunds | orders:read | ticketing | [source](../../packages/modules/orders/src/commands/refunds.ts#L597) |
| orders.saveSupportMacro | orders:support | ticketing | [source](../../packages/modules/orders/src/commands/support-macros.ts#L65) |
| orders.archiveSupportMacro | orders:support | ticketing | [source](../../packages/modules/orders/src/commands/support-macros.ts#L108) |
| orders.supportMacros | orders:support | ticketing | [source](../../packages/modules/orders/src/commands/support-macros.ts#L131) |
| orders.previewSupportMacro | orders:support | ticketing | [source](../../packages/modules/orders/src/commands/support-macros.ts#L190) |
| orders.runSupportMacro | orders:support | ticketing | [source](../../packages/modules/orders/src/commands/support-macros.ts#L219) |
| orders.checkoutSettings | events:read | ticketing | [source](../../packages/modules/orders/src/guest/orders.ts#L36) |
| orders.setCheckoutSettings | events:write | ticketing | [source](../../packages/modules/orders/src/guest/orders.ts#L46) |
| orders.reissueManageLink | orders:support | ticketing | [source](../../packages/modules/orders/src/guest/orders.ts#L85) |
| orders.requestOrderLinks | public:order_links | ticketing | [source](../../packages/modules/orders/src/guest/orders.ts#L120) |
| orders.listOrders | orders:read | ticketing | [source](../../packages/modules/orders/src/queries.ts#L19) |
| orders.search | orders:read | ticketing | [source](../../packages/modules/orders/src/queries.ts#L93) |
| orders.orderDetail | orders:read | ticketing | [source](../../packages/modules/orders/src/queries.ts#L222) |
| orders.nameTableSlot | public:claim | ticketing | [source](../../packages/modules/orders/src/tables.ts#L166) |
| orders.hostNameTableSlot | tables:write | ticketing | [source](../../packages/modules/orders/src/tables.ts#L182) |
| orders.setTableCompany | public:claim | ticketing | [source](../../packages/modules/orders/src/tables.ts#L198) |
| orders.resendTableLink | public:claim | ticketing | [source](../../packages/modules/orders/src/tables.ts#L219) |
| orders.sendTableReminders | tables:write | ticketing | [source](../../packages/modules/orders/src/tables.ts#L245) |
| orders.hostedTables | tables:read | ticketing | [source](../../packages/modules/orders/src/tables.ts#L388) |
| orders.publicTable | public:claim | ticketing | [source](../../packages/modules/orders/src/tables.ts#L417) |
| orders.joinWaitlist | public:waitlist | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L340) |
| orders.sweepWaitlists | platform:orders.sweep | null or not captured | [source](../../packages/modules/orders/src/waitlist.ts#L507) |
| orders.leaveWaitlist | public:waitlist | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L554) |
| orders.declineWaitlistOffer | public:waitlist | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L579) |
| orders.rejoinWaitlist | public:waitlist | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L608) |
| orders.listWaitlists | orders:support | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L860) |
| orders.waitlistEntries | orders:support | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L932) |
| orders.offerWaitlistEntry | orders:support | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L1025) |
| orders.updateWaitlist | orders:support | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L1037) |
| orders.removeWaitlistEntries | orders:support | ticketing | [source](../../packages/modules/orders/src/waitlist.ts#L1077) |

### Feature rules and lifecycle

#### orders (tier 4)

Orders, order items and checkout. Owns Postgres schema `orders`.

**Invariants**
- A large refund (≥ `LARGE_REFUND_MINOR` = 50,000 minor units, or the whole order; threshold pending owner confirmation) needs a recent step-up; `startRefund` checks it after computing the amount (M1.2c).
- Lifecycle (`domain/lifecycle.ts`, roadmap §5.2): reserved → awaiting_payment → paid, with payment_failed, expired and cancelled. Changes use `UPDATE … WHERE status = ANY(from)`.
- `paid` is set only from a verified, deduplicated provider event, a zero-total order, or an audited staff action — never from the browser.
- Totals and the fee schedule are **snapshotted** on the order and its items; later price or fee changes never alter an order.
- Holds last 10 minutes (+5 when payment starts); the sweeper releases expired holds.
- Guest orders are managed through a random `manage_token`; only its SHA-256 hash is stored.
- **Dates (M1.4b):** a multi-date event sells one date per order (`orders.occurrence_id`, required when the event has dates). The date's row is locked, then its capacity is checked against live tickets for it plus tickets in orders still holding stock (`claimOccurrenceTx`); checkout and the box office both use it.
- **Refund policy (M1.6e):** one policy per event (`refund_policies`); discretionary refunds (`requested_by_customer`, `goodwill`) follow it, evaluated in the event's timezone inside `orders.startRefund`; the platform minimum (cancellation, long postponement) and duplicates/fraud never do. Refunding outside it is only `orders.startPolicyOverrideRefund` (owner/admin, note, audited).
- **Checkout risk (M1.6e):** the server action assesses the risk port before `startCheckout`; a block never creates an order; a review is recorded in `risk_review`.
- **Cancel tickets without a refund (M1.8f):** `orders.cancelTickets` (bulk, `orders:refund`, never undoable, category `delete`: refused while staff act as a member) voids tickets per order through `voidTicketsTx` (reason `cancelled`), frees bought seats and seats given by the organizer, and emits `tickets.cancelled@1`. No money moves; orders keep their status. Refunds stay per order.
- **Search (M1.8f):** buyer name/email search runs through `orders.search_ids(pattern)` (SECURITY DEFINER, own org only via `app.org_id`, ids only) so the trigram indexes serve it under RLS; results equal a plain `ILIKE`.
- **Guest email verification (M1.5f):** `guest_challenges` and `guest_sessions` are global (listed in `GLOBAL_TABLES`; app_user only, no platform_reader). They store HMACs of codes, magic links, browser states and session tokens, never the secrets. A code is 6 random digits, works once, for 10 minutes, and locks after 5 wrong tries (outcomes are returned, not thrown, so the count commits); a new code retires the address's older ones and is refused within 30 s of the last. Magic links work once, for 15 minutes, only in the browser whose state cookie asked for them. Sends and checks count against the M1.14 limiter (`guestCode`, `guestVerify`) per device and per address.
- **Attendee sessions** are separate from organizer (Better Auth) sessions, bound to the host that issued them and to one org's site (or the marketplace, null scope). Listing across orgs goes only through `orders.order_refs_by_email` (ids only) and then each org's RLS.
- **Manage links:** reissuing replaces both the hash and the ciphertext (the old link stops at once), is audited and emits `order.manage_link_reissued@1`; "email me my links" emits `order.links_requested@1` with order ids only, the same for any address. Events never carry tokens or addresses.
- **Refund operations (M3.10b):** the refund policy shown at purchase is snapshotted on the order (`refund_policy_snapshot`; `unset` when none was shown); discretionary refunds get the better of that and the current policy (`evaluateOrderRefundPolicy`), so a tightening only reaches later orders. Buyers ask from the order page (`orders.requestRefund`, manage token, one open request per order, SLA `REFUND_REQUEST_SLA_BUSINESS_DAYS`); approving is `orders.startRefund` with `refundRequestId` (evaluated as of the request; a declined provider refund reopens it; a full refund answers any open request); declining needs a reason the buyer is emailed.
- **Mass refunds (M3.10b):** `orders.startMassRefund` (cancelled event, `orders:refund`, step-up) snapshots one item per sold order; the batch (`nextMassRefundStep` → provider keyed `refund:<id>` → `completeRefund` → `settleMassRefundItem`, system only) records each item's refund in the same transaction that creates it, so a crash never refunds twice; open disputes and organizer-collected orders are skipped; paused runs are not worked; the last step reconciles the run against the ledger. Run by the worker's `orders.mass-refund` pg-boss job (exclusive per run).
- **Waitlists (M3.10a):** `waitlists` (one per ticket type and date) and `waitlist_entries` (queue order `(position_at, id)`; `waiting → offered → accepted | expired | declined`, plus `left`/`removed`). Freed stock goes to the line first: public checkout holds only stock beyond the waiting quantities of the type's lists (`holdInventoryTx` reserve) and a date's line (`occurrenceTakenTx`). `orders.sweepWaitlists` (worker, after the hold sweeper) expires lapsed offers and offers free stock in strict line order under list → date → ticket-type locks, so each freed place is offered once. An offer holds `offered_quantity` in `quantity_held`; `startCheckout` with `waitlistToken` buys it with that stock (its pass, date, address, at most its quantity); a lapsed offer order gives the stock back to the still-open offer. Rejoining goes to the back of the line. Links are `<entryId>~<hmac>` (purpose `orders.waitlist`), resolved through `orders.waitlist_entry_org()`. Console reads and changes need `orders:support`; the CSV export is a bulk export (`attendees:export`, step-up, category `export`). Emails are transactional only.
- **Credit notes (M3.10c):** `orders.issueCreditNote` (`orders:refund`, category `money`, idempotent: Idempotency-Key required) issues a full (everything still creditable) or partial note with a reason; creditable = paid total − refunds (pending or done) − earlier notes. Numbers are gap-free per org (`credit_note_sequences`, the counter row is locked by the upsert; label `CN-00001`). `store_credit` notes carry a `CR-XXXX-XXXX` code and a balance; `refunded` notes only record money paid back outside the provider. The code is typed in checkout's code box: `startCheckout` locks the note, takes up to its balance off the tickets (`creditBudgetMinor`), records a `credit_note_applications` row and lowers the balance in the same transaction; an order that lapses unpaid gives it back (`releaseCreditTx` in the hold sweeper), a late payment takes it again if it is still there. The buyer is emailed the note (`orders.credit-note`); the order page and the finance report list them; the PDF is rendered by Gotenberg in the viewer's language.
- **Support macros (M3.10c):** `support_macros` (`orders:support`) hold a reply (subject and body with merge fields, validated at save: `domain/macros.ts`) and actions (`email_buyer`, `add_note`, `resend_tickets`, `transfer_ticket`). `orders.runSupportMacro` (idempotent, audited) fills the fields from the order and does every action in one transaction: the reply as `order.support_reply@1` (mailer `orders.support-reply`), a team note, `ticket.resend_requested@1` for the live tickets (operation = the run), a transfer through `startTransferTx`; the run (`support_macro_runs`, with the reply as sent) is on the order timeline.
- **Gala tables (M4.2b, `src/tables.ts`):** naming a purchased table's seat (the buyer's claim link or the host's console) locks the table row, picks an unnamed seat of that table, reissues its ticket (`reissueTicketTx`) and adds the guest to the table's party in the guests module, in one transaction: concurrent claims never exceed the table. Naming is open while the order is paid (or partly refunded) and the event has not ended. A refund by tickets refunds a table whole and once (`refundUnits`; `table_partial` otherwise). The table's link goes to the buyer after payment, on request (once a minute) and as the host's reminder (once an hour per table) through `orders.table-naming-mailer`; events never carry the token.
- **Invoices and pay later (M5.1d):** `issueInvoiceTx` turns a just-reserved order (a higher module's checkout, e.g. registration) into `awaiting_invoice`: stock sold, tickets issued with `payment_due`, an invoice numbered per org gap-free (`invoice_sequences`, locked by the upsert; never reused, void keeps its number) with snapshotted terms (`net30_event7`, `domain/invoices.ts`). Such an order has no expiry and is never cancelled automatically; `void` only through `orders.voidInvoice` (organizer, unpaid only). Payments (`invoice_payments`) are 1 … the balance: pay link (`orders.startInvoicePayment`, idempotent, provider key `invoice_payment:<id>`, applied by the verified webhook through `applyProviderEvent`) or recorded offline (`orders.recordInvoicePayment`, `orders:refund`, `money`, idempotent, audited). Each posts `invoice_payment:<id>` to the ledger with a fee part (`feePartMinor`) so the parts add up to the order's fee; offline fee parts are receivables. A settled balance makes the order `paid` (`order.paid@1`, `via: 'invoice'`) and clears `payment_due`. Events: `order.invoiced@1`, `order.invoice_payment_recorded@1`, `order.voided@1`. The buyer's page is reached by the signed link `invoicePath(slug, id)`; `PublicInvoiceDto` is the allowlist (no fees, void reasons or notes).


### Source index

- [packages/modules/orders/src/addon-orders.ts](../../packages/modules/orders/src/addon-orders.ts)
- [packages/modules/orders/src/bookings.ts](../../packages/modules/orders/src/bookings.ts)
- [packages/modules/orders/src/buyer.ts](../../packages/modules/orders/src/buyer.ts)
- [packages/modules/orders/src/commands/box-office.ts](../../packages/modules/orders/src/commands/box-office.ts)
- [packages/modules/orders/src/commands/cancel-tickets.ts](../../packages/modules/orders/src/commands/cancel-tickets.ts)
- [packages/modules/orders/src/commands/checkout.ts](../../packages/modules/orders/src/commands/checkout.ts)
- [packages/modules/orders/src/commands/credit-notes.ts](../../packages/modules/orders/src/commands/credit-notes.ts)
- [packages/modules/orders/src/commands/disputes.ts](../../packages/modules/orders/src/commands/disputes.ts)
- [packages/modules/orders/src/commands/invoices.ts](../../packages/modules/orders/src/commands/invoices.ts)
- [packages/modules/orders/src/commands/mass-refunds.ts](../../packages/modules/orders/src/commands/mass-refunds.ts)
- [packages/modules/orders/src/commands/order-notes.ts](../../packages/modules/orders/src/commands/order-notes.ts)
- [packages/modules/orders/src/commands/push.ts](../../packages/modules/orders/src/commands/push.ts)
- [packages/modules/orders/src/commands/refund-policy.ts](../../packages/modules/orders/src/commands/refund-policy.ts)
- [packages/modules/orders/src/commands/refund-requests.ts](../../packages/modules/orders/src/commands/refund-requests.ts)
- [packages/modules/orders/src/commands/refunds.ts](../../packages/modules/orders/src/commands/refunds.ts)
- [packages/modules/orders/src/commands/support-macros.ts](../../packages/modules/orders/src/commands/support-macros.ts)
- [packages/modules/orders/src/contact-merge.ts](../../packages/modules/orders/src/contact-merge.ts)
- [packages/modules/orders/src/daily-facts.ts](../../packages/modules/orders/src/daily-facts.ts)
- [packages/modules/orders/src/data-subject.ts](../../packages/modules/orders/src/data-subject.ts)
- [packages/modules/orders/src/domain/credit-notes.ts](../../packages/modules/orders/src/domain/credit-notes.ts)
- [packages/modules/orders/src/domain/invoices.ts](../../packages/modules/orders/src/domain/invoices.ts)
- [packages/modules/orders/src/domain/lifecycle.ts](../../packages/modules/orders/src/domain/lifecycle.ts)
- [packages/modules/orders/src/domain/macros.ts](../../packages/modules/orders/src/domain/macros.ts)
- [packages/modules/orders/src/domain/mass-refund.ts](../../packages/modules/orders/src/domain/mass-refund.ts)
- [packages/modules/orders/src/domain/refund-policy.ts](../../packages/modules/orders/src/domain/refund-policy.ts)
- [packages/modules/orders/src/domain/tables.ts](../../packages/modules/orders/src/domain/tables.ts)
- [packages/modules/orders/src/domain/waitlist.ts](../../packages/modules/orders/src/domain/waitlist.ts)
- [packages/modules/orders/src/donation-orders.ts](../../packages/modules/orders/src/donation-orders.ts)
- [packages/modules/orders/src/donation-ticket-facts.ts](../../packages/modules/orders/src/donation-ticket-facts.ts)
- [packages/modules/orders/src/dsar.ts](../../packages/modules/orders/src/dsar.ts)
- [packages/modules/orders/src/dto.ts](../../packages/modules/orders/src/dto.ts)
- [packages/modules/orders/src/facts.ts](../../packages/modules/orders/src/facts.ts)
- [packages/modules/orders/src/guest/access.ts](../../packages/modules/orders/src/guest/access.ts)
- [packages/modules/orders/src/guest/orders.ts](../../packages/modules/orders/src/guest/orders.ts)
- [packages/modules/orders/src/guest/otp.ts](../../packages/modules/orders/src/guest/otp.ts)
- [packages/modules/orders/src/imported.ts](../../packages/modules/orders/src/imported.ts)
- [packages/modules/orders/src/index.ts](../../packages/modules/orders/src/index.ts)
- [packages/modules/orders/src/invoice-facts.ts](../../packages/modules/orders/src/invoice-facts.ts)
- [packages/modules/orders/src/invoice-mailer.ts](../../packages/modules/orders/src/invoice-mailer.ts)
- [packages/modules/orders/src/locale-facts.ts](../../packages/modules/orders/src/locale-facts.ts)
- [packages/modules/orders/src/manage-link.ts](../../packages/modules/orders/src/manage-link.ts)
- [packages/modules/orders/src/money-facts.ts](../../packages/modules/orders/src/money-facts.ts)
- [packages/modules/orders/src/occurrence.ts](../../packages/modules/orders/src/occurrence.ts)
- [packages/modules/orders/src/order-days.ts](../../packages/modules/orders/src/order-days.ts)
- [packages/modules/orders/src/participation.ts](../../packages/modules/orders/src/participation.ts)
- [packages/modules/orders/src/payment-state.ts](../../packages/modules/orders/src/payment-state.ts)
- [packages/modules/orders/src/private-columns.ts](../../packages/modules/orders/src/private-columns.ts)
- [packages/modules/orders/src/queries.ts](../../packages/modules/orders/src/queries.ts)
- [packages/modules/orders/src/receipt-facts.ts](../../packages/modules/orders/src/receipt-facts.ts)
- [packages/modules/orders/src/refund-flow.ts](../../packages/modules/orders/src/refund-flow.ts)
- [packages/modules/orders/src/schema-addons.ts](../../packages/modules/orders/src/schema-addons.ts)
- [packages/modules/orders/src/schema.ts](../../packages/modules/orders/src/schema.ts)
- [packages/modules/orders/src/subscribers.ts](../../packages/modules/orders/src/subscribers.ts)
- [packages/modules/orders/src/tables.ts](../../packages/modules/orders/src/tables.ts)
- [packages/modules/orders/src/testing.ts](../../packages/modules/orders/src/testing.ts)
- [packages/modules/orders/src/timeline.ts](../../packages/modules/orders/src/timeline.ts)
- [packages/modules/orders/src/waitlist.ts](../../packages/modules/orders/src/waitlist.ts)

## payments

Tier 3; 25 source files; 10 test files.

Declared connections: @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Source imports: @yayatoh/billing, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: account.updated, account_onboarding, dispute.created, ignored, invalid_request_error, payment.succeeded, payments.agency_commission, payments.dispute_deadline_approaching, payments.reconciliation_drift, payouts.account_updated, payouts.destination_changed, payouts.hold_changed, payouts.transferred, setup.failed, setup.succeeded, system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| payments.payoutAccount | org:read | core | [source](../../packages/modules/payments/src/accounts.ts#L84) |
| payments.payoutAccountId | payouts:manage | core | [source](../../packages/modules/payments/src/accounts.ts#L107) |
| payments.recordPayoutAccount | payouts:manage | core | [source](../../packages/modules/payments/src/accounts.ts#L124) |
| payments.continuePayoutOnboarding | payouts:manage | core | [source](../../packages/modules/payments/src/accounts.ts#L159) |
| payments.applyAccountEvent | platform:payments.webhook | null or not captured | [source](../../packages/modules/payments/src/accounts.ts#L234) |
| payments.setPayoutHold | platform:payouts.hold | null or not captured | [source](../../packages/modules/payments/src/accounts.ts#L300) |
| payments.recordCommissionReversal | orders:refund | null or not captured | [source](../../packages/modules/payments/src/commission.ts#L442) |
| payments.agencyCommissionStatement | finance:read | null or not captured | [source](../../packages/modules/payments/src/commission.ts#L621) |
| payments.clientCommissionStatement | finance:read | null or not captured | [source](../../packages/modules/payments/src/commission.ts#L678) |
| payments.alertDisputeDeadlines | platform:payments.dispute_alerts | null or not captured | [source](../../packages/modules/payments/src/dispute-alerts.ts#L32) |
| payments.disputes | finance:read | null or not captured | [source](../../packages/modules/payments/src/disputes.ts#L147) |
| payments.markEvidenceSubmitted | platform:disputes.submit | null or not captured | [source](../../packages/modules/payments/src/disputes.ts#L174) |
| payments.saveEvidenceDraft | disputes:respond | null or not captured | [source](../../packages/modules/payments/src/disputes.ts#L223) |
| payments.markOrgEvidenceSubmitted | disputes:respond | null or not captured | [source](../../packages/modules/payments/src/disputes.ts#L256) |
| payments.ledgerBalances | finance:read | null or not captured | [source](../../packages/modules/payments/src/ledger.ts#L241) |
| payments.recordReconciliation | platform:payments.reconcile | null or not captured | [source](../../packages/modules/payments/src/reconciliation.ts#L112) |
| payments.reconciliationItems | finance:read | null or not captured | [source](../../packages/modules/payments/src/reconciliation.ts#L238) |
| payments.reconciliationRuns | finance:read | null or not captured | [source](../../packages/modules/payments/src/reconciliation.ts#L275) |
| payments.resolveReconciliationItem | finance:reconcile | null or not captured | [source](../../packages/modules/payments/src/reconciliation.ts#L294) |
| payments.releaseDueSettlements | platform:payouts.release | null or not captured | [source](../../packages/modules/payments/src/settlements.ts#L74) |
| payments.recordTransfer | platform:payouts.release | null or not captured | [source](../../packages/modules/payments/src/settlements.ts#L243) |
| payments.recordTransferReversal | orders:refund | null or not captured | [source](../../packages/modules/payments/src/settlements.ts#L340) |
| payments.settlements | finance:read | null or not captured | [source](../../packages/modules/payments/src/settlements.ts#L386) |
| payments.receivables | finance:read | null or not captured | [source](../../packages/modules/payments/src/settlements.ts#L483) |

### Feature rules and lifecycle

#### payments (tier 3)

The `PaymentProvider` port and provider-event bookkeeping. Owns Postgres schema `payments`.

**Invariants**
- A new payout destination (an account connected; later, a bank change reported by the provider) waits **24 h** before any transfer goes to it (`destination_hold_until`, roadmap §10); `payouts.destination_changed@1` tells the owners at once (`payments.destination-changed`: in-app and email, through the notifications core). Payout set-up and continuing onboarding are step-up commands (M1.2c).
- Every side effect with a provider carries an idempotency key; provider webhooks are verified on the **raw body** and deduplicated by provider event id (`provider_events` unique per org × provider × event id).
- Two funds flows (roadmap §5.3): `organizer_mor` (direct charge on the connected account + application fee) and `platform_mor` (platform charge; separate charges & transfers, transfer at release). The flow is recorded on every order.
- Until the owner's Stripe account exists, the `fake` provider runs in dev/preview/CI only. It is refused when `VERCEL_ENV=production`.
- **Reconciliation (M1.6e):** one run per org and UTC day (`reconciliation_runs`, unique), differences as items matched by the ledger reference both sides share; runs are recorded only by the platform; resolving needs `finance:reconcile` and a note. Every provider write the platform makes is tagged with `metadata.yayatoh_ref` (its idempotency key) and `orgId`.
- **Evidence (M1.6e):** the organizer's statement and exclusions are saved while the dispute is open; submission is recorded once, after the provider accepted it.
- **Dispute deadline alerts (M3.10c):** `payments.alertDisputeDeadlines` (system only; worker hourly, dev route in dev/CI) raises `payments.dispute_deadline_approaching@1` once per level for open disputes: level 1 at three days before the evidence deadline, level 2 at one day (`deadline_alert_level`, raised under a row lock with `WHERE level < new`). `payments.dispute-deadline-notifier` tells owners, admins and finance (in-app + email) until the M3.2b alert engine consumes the event.
- **Invoice payments (M5.1d):** `postInvoicePaymentTx` posts one journal per invoice payment (`invoice_payment:<paymentId>`, memo: gross, fee part, channel): a pay-link card payment as a `sale` on the funds flow at the time (reconciled under `order:<id>`), an offline (organizer-collected) payment as `organizer_collected_sale` with its fee part as an org receivable.
- **Agency commission (M6.8a, flag `agency_v2`):** only `platform_mor` sales earn it while the client's agency billing is in force (`agencyBillingActiveTx` from billing). It sits in `agency:commission_held` (client ledger, per event, memo `agencyOrgId`), is released as a `commission` settlement transferred to the agency with the event's `transfer_group`, and refunds reverse it cumulatively in proportion to the refunded organizer share (to the cent): untransferred commission goes back to held funds, transferred commission by an **explicit transfer reversal** (`commission_reversal:<refund>`), never `reverse_transfer`; a failed reversal stays `agency:commission_receivable`, netted from the agency's next commission. `eventTransferTx` never returns a commission transfer. Each movement emits `payments.agency_commission@1`; `payments.agency-commission` mirrors it into the agency's own ledger (`agency:commission_due|earned|paid|clawback`, never platform cash), so agency statements read only the agency's rows.


### Source index

- [packages/modules/payments/src/accounts.ts](../../packages/modules/payments/src/accounts.ts)
- [packages/modules/payments/src/commission-math.ts](../../packages/modules/payments/src/commission-math.ts)
- [packages/modules/payments/src/commission.ts](../../packages/modules/payments/src/commission.ts)
- [packages/modules/payments/src/config.ts](../../packages/modules/payments/src/config.ts)
- [packages/modules/payments/src/daily-totals.ts](../../packages/modules/payments/src/daily-totals.ts)
- [packages/modules/payments/src/data-subject.ts](../../packages/modules/payments/src/data-subject.ts)
- [packages/modules/payments/src/dedupe.ts](../../packages/modules/payments/src/dedupe.ts)
- [packages/modules/payments/src/dispute-alerts.ts](../../packages/modules/payments/src/dispute-alerts.ts)
- [packages/modules/payments/src/disputes.ts](../../packages/modules/payments/src/disputes.ts)
- [packages/modules/payments/src/fake.ts](../../packages/modules/payments/src/fake.ts)
- [packages/modules/payments/src/index.ts](../../packages/modules/payments/src/index.ts)
- [packages/modules/payments/src/invoice-ledger.ts](../../packages/modules/payments/src/invoice-ledger.ts)
- [packages/modules/payments/src/ledger.ts](../../packages/modules/payments/src/ledger.ts)
- [packages/modules/payments/src/memo-ledger.ts](../../packages/modules/payments/src/memo-ledger.ts)
- [packages/modules/payments/src/payouts.ts](../../packages/modules/payments/src/payouts.ts)
- [packages/modules/payments/src/port.ts](../../packages/modules/payments/src/port.ts)
- [packages/modules/payments/src/private-columns.ts](../../packages/modules/payments/src/private-columns.ts)
- [packages/modules/payments/src/reconciliation.ts](../../packages/modules/payments/src/reconciliation.ts)
- [packages/modules/payments/src/risk.ts](../../packages/modules/payments/src/risk.ts)
- [packages/modules/payments/src/sandbox.ts](../../packages/modules/payments/src/sandbox.ts)
- [packages/modules/payments/src/schema.ts](../../packages/modules/payments/src/schema.ts)
- [packages/modules/payments/src/settlements.ts](../../packages/modules/payments/src/settlements.ts)
- [packages/modules/payments/src/stats.ts](../../packages/modules/payments/src/stats.ts)
- [packages/modules/payments/src/stripe.ts](../../packages/modules/payments/src/stripe.ts)
- [packages/modules/payments/src/testing.ts](../../packages/modules/payments/src/testing.ts)

## privacy

Tier 5; 14 source files; 1 test files.

Declared connections: @yayatoh/attendees, @yayatoh/auth, @yayatoh/checkin, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/attendees, @yayatoh/auth, @yayatoh/checkin, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/media, @yayatoh/notifications, @yayatoh/orders, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: pkcs8, privacy.subject_erased, self, spki, staff, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| privacy.detachAccount | platform:privacy.account | null or not captured | [source](../../packages/modules/privacy/src/account.ts#L388) |
| privacy.findSubject | privacy:manage | core | [source](../../packages/modules/privacy/src/dsar.ts#L46) |
| privacy.openRequest | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L144) |
| privacy.submitSelfRequest | platform:privacy.self-request | core | [source](../../packages/modules/privacy/src/requests.ts#L171) |
| privacy.requests | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L193) |
| privacy.request | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L223) |
| privacy.exportSubject | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L265) |
| privacy.archiveFile | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L340) |
| privacy.selfArchiveFile | platform:privacy.self-request | core | [source](../../packages/modules/privacy/src/requests.ts#L351) |
| privacy.eraseSubject | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L380) |
| privacy.selfReceipt | platform:privacy.self-request | core | [source](../../packages/modules/privacy/src/requests.ts#L459) |
| privacy.cancelRequest | privacy:manage | core | [source](../../packages/modules/privacy/src/requests.ts#L474) |
| privacy.retention | platform:privacy.retention | core | [source](../../packages/modules/privacy/src/retention.ts#L62) |

### Feature rules and lifecycle

#### privacy (tier 5)

Data-subject requests and retention (M1.14c). Owns Postgres schema `privacy`
(`dsar_requests`, the accountability record; `account_requests`, the global record of account DSARs). Reads and redacts other modules only through
their exported `*DsarTx` / retention functions, inside the caller's tenant transaction.

**Invariants**
- Only owners and admins (`privacy:manage`) find, export or erase a person. Every request is
  recorded in `privacy.dsar_requests` and audited; neither keeps the address (SHA-256 of the
  normalized email plus a masked hint).
- Erasure redacts in place; it never deletes rows other data depends on. Paid orders and the
  ledger are kept for 7 years (legal hold) with the buyer's name, email, account link, payment
  reference and manage link removed. Tickets stay valid (holder redacted, devices resync).
  Consent rows and check-in admissions are kept; they hold no personal data.
- Export files that mention an erased address are deleted; the access-request file itself expires
  after 7 days and the email in the export operation's params is cleared after a day.
- The access document is an allowlist (`yayatoh.dsar/1` JSON): no tokens, hashes, signing keys,
  provider ids or internal contact ids.
- Retention (`retentionCommand`) is idempotent, runs per org as a system actor, and uses the
  defaults in `src/retention.ts` (pending the owner's confirmation).

- Account requests (M1.14e, Yayatoh as controller; `src/account.ts`): the `yayatoh.account/1`
  document is an allowlist (a Zod schema drops every undeclared key). Self-service export and
  deletion need a step-up in the last 10 minutes; staff need a reason (10–500 characters). Deletion
  is refused while the person is the only owner of an org, sends the confirmation to the old
  address first, detaches the account in each org through `privacy.detachAccount` (a platform
  command: system actors only, audited in the org's chain), then anonymises the identity (packages/
  auth), adds the address to the platform-wide erased list and records the request in the global
  `privacy.account_requests` (hash + masked hint, actor, reason; SECURITY DEFINER insert only).
- Org-side erasure also removes team invitations addressed to the person and adds the address to
  the platform-wide erased list (`platform.erased_addresses`).

- M6.1c DSAR propagation: every module that holds personal data exports a `DataSubjectContributor`
  (`@yayatoh/platform`); the apps register them. A table with a personal or holder column and no
  contributor fails the coverage test. One open request per person per org (partial unique index),
  due 30 days after it is opened; the address is sealed with the org's key vault while the request is
  open and cleared when it closes. Fulfilling needs a recent step-up and is refused while staff act as
  a member (export / delete categories).
- The archive is a ZIP with a manifest of SHA-256 checksums signed with Ed25519 (`DsarSigner`;
  local key from APP_TOKEN_SECRET outside production); it is kept 7 days in the media store. The
  erasure receipt holds no personal data (masked hint, SHA-256) and is signed the same way.
- Erasure runs every contributor in one tenant transaction, then the media subscriber deletes stored
  files and the connector-hook subscriber tells M6.4 integrations (`privacy.subject_erased@1`).
- Events emitted: `privacy.subject_erased@1` (request id, subject SHA-256, media asset ids).

**Public surface:** `.` only.


### Source index

- [packages/modules/privacy/src/account.ts](../../packages/modules/privacy/src/account.ts)
- [packages/modules/privacy/src/archive.ts](../../packages/modules/privacy/src/archive.ts)
- [packages/modules/privacy/src/data-subject.ts](../../packages/modules/privacy/src/data-subject.ts)
- [packages/modules/privacy/src/dsar.ts](../../packages/modules/privacy/src/dsar.ts)
- [packages/modules/privacy/src/hooks.ts](../../packages/modules/privacy/src/hooks.ts)
- [packages/modules/privacy/src/index.ts](../../packages/modules/privacy/src/index.ts)
- [packages/modules/privacy/src/private-columns.ts](../../packages/modules/privacy/src/private-columns.ts)
- [packages/modules/privacy/src/receipt.ts](../../packages/modules/privacy/src/receipt.ts)
- [packages/modules/privacy/src/requests.ts](../../packages/modules/privacy/src/requests.ts)
- [packages/modules/privacy/src/retention.ts](../../packages/modules/privacy/src/retention.ts)
- [packages/modules/privacy/src/schema.ts](../../packages/modules/privacy/src/schema.ts)
- [packages/modules/privacy/src/signing.ts](../../packages/modules/privacy/src/signing.ts)
- [packages/modules/privacy/src/subject.ts](../../packages/modules/privacy/src/subject.ts)
- [packages/modules/privacy/src/zip.ts](../../packages/modules/privacy/src/zip.ts)

## program

Tier 3; 44 source files; 7 test files.

Declared connections: @yayatoh/billing, @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/floorplan, @yayatoh/forms, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.

Source imports: @yayatoh/billing, @yayatoh/contracts, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/floorplan, @yayatoh/forms, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: program.agenda.published, program.booth.assigned, program.exhibitor.staff_invited, program.speaker_change.decided, program.speaker_task.assigned, program.speaker_task.completed, program.speaker_task.overdue, program.speaker_task.reminder_requested, program.sponsor_package.activated, program.sponsor_package.cancelled, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| program.createSessionType | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L80) |
| program.addStandardSessionTypes | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L115) |
| program.deleteSessionType | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L154) |
| program.createSessionGroup | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L184) |
| program.deleteSessionGroup | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L226) |
| program.setSessionAgenda | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L318) |
| program.publishAgenda | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L505) |
| program.unpublishAgenda | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L551) |
| program.agenda | events:read | core | [source](../../packages/modules/program/src/agenda.ts#L579) |
| program.agendaImportPreview | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L771) |
| program.importAgenda | events:write | sessions | [source](../../packages/modules/program/src/agenda.ts#L803) |
| program.boothPlan | events:read | exhibitors | [source](../../packages/modules/program/src/booths.ts#L97) |
| program.saveBooth | events:write | exhibitors | [source](../../packages/modules/program/src/booths.ts#L110) |
| program.deleteBooth | events:write | exhibitors | [source](../../packages/modules/program/src/booths.ts#L150) |
| program.assignBooth | events:write | exhibitors | [source](../../packages/modules/program/src/booths.ts#L179) |
| program.unassignBooth | events:write | exhibitors | [source](../../packages/modules/program/src/booths.ts#L248) |
| program.saveCfp | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L240) |
| program.addCfpQuestion | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L288) |
| program.removeCfpQuestion | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L328) |
| program.addCfpReviewer | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L355) |
| program.revokeCfpReviewer | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L404) |
| program.assignCfpReviewer | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L433) |
| program.unassignCfpReviewer | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L476) |
| program.cfpOverview | events:read | speakers | [source](../../packages/modules/program/src/cfp.ts#L503) |
| program.cfpSubmission | events:read | speakers | [source](../../packages/modules/program/src/cfp.ts#L574) |
| program.decideCfpSubmission | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L678) |
| program.placeDraftSession | events:write | speakers | [source](../../packages/modules/program/src/cfp.ts#L770) |
| program.submitCfp | public:cfp | speakers | [source](../../packages/modules/program/src/cfp.ts#L855) |
| program.cfpReviewerHome | portal:cfp_reviewer | speakers | [source](../../packages/modules/program/src/cfp.ts#L970) |
| program.cfpReviewerSubmission | portal:cfp_reviewer | speakers | [source](../../packages/modules/program/src/cfp.ts#L1047) |
| program.submitCfpReview | portal:cfp_reviewer | speakers | [source](../../packages/modules/program/src/cfp.ts#L1100) |
| program.saveExhibitorSettings | events:write | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L265) |
| program.saveExhibitorListing | events:write | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L296) |
| program.inviteExhibitorMember | events:write | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L323) |
| program.resendExhibitorInvite | events:write | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L347) |
| program.revokeExhibitorMember | events:write | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L379) |
| program.decideProfileChange | events:write | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L405) |
| program.exhibitorPortalAdmin | events:read | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L485) |
| program.exhibitorPortal | portal:exhibitor | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L553) |
| program.portalSaveProfile | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L635) |
| program.portalInviteStaff | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L677) |
| program.portalRevokeStaff | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/program/src/exhibitor-portal.ts#L703) |
| program.saveLeadLicenseSettings | events:write | exhibitors | [source](../../packages/modules/program/src/lead-licenses.ts#L106) |
| program.leadLicensesAdmin | events:read | exhibitors | [source](../../packages/modules/program/src/lead-licenses.ts#L137) |
| program.portalLeadLicenses | portal:exhibitor | exhibitors | [source](../../packages/modules/program/src/lead-licenses.ts#L170) |
| program.portalAssignLeadLicense | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/program/src/lead-licenses.ts#L210) |
| program.portalReleaseLeadLicense | portal:exhibitor_admin | exhibitors | [source](../../packages/modules/program/src/lead-licenses.ts#L268) |
| program.createSpeaker | events:write | speakers | [source](../../packages/modules/program/src/people.ts#L81) |
| program.updateSpeaker | events:write | speakers | [source](../../packages/modules/program/src/people.ts#L105) |
| program.deleteSpeaker | events:write | speakers | [source](../../packages/modules/program/src/people.ts#L129) |
| program.createExhibitor | events:write | exhibitors | [source](../../packages/modules/program/src/people.ts#L175) |
| program.updateExhibitor | events:write | exhibitors | [source](../../packages/modules/program/src/people.ts#L199) |
| program.deleteExhibitor | events:write | exhibitors | [source](../../packages/modules/program/src/people.ts#L223) |
| program.createSponsorTier | events:write | sponsors | [source](../../packages/modules/program/src/people.ts#L270) |
| program.deleteSponsorTier | events:write | sponsors | [source](../../packages/modules/program/src/people.ts#L303) |
| program.createSponsor | events:write | sponsors | [source](../../packages/modules/program/src/people.ts#L351) |
| program.updateSponsor | events:write | sponsors | [source](../../packages/modules/program/src/people.ts#L376) |
| program.deleteSponsor | events:write | sponsors | [source](../../packages/modules/program/src/people.ts#L401) |
| program.proposeProfileChange | portal:speaker | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L147) |
| program.proposeSessionChange | portal:speaker | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L189) |
| program.inviteSpeaker | events:write | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L265) |
| program.revokeSpeakerAccess | events:write | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L300) |
| program.speakerAccess | events:read | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L319) |
| program.speakerChanges | events:read | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L373) |
| program.decideSpeakerChange | events:write | speakers | [source](../../packages/modules/program/src/portal-speakers.ts#L430) |
| program.createPortalTask | events:write | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L131) |
| program.assignNewSpeakers | events:write | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L175) |
| program.deletePortalTask | events:write | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L195) |
| program.portalTaskBoard | events:read | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L221) |
| program.remindMissing | events:write | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L275) |
| program.completePortalTask | portal:speaker | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L381) |
| program.speakerPortal | portal:speaker | speakers | [source](../../packages/modules/program/src/portal-tasks.ts#L435) |
| program.createTrack | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L37) |
| program.deleteTrack | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L67) |
| program.createRoom | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L95) |
| program.deleteRoom | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L134) |
| program.createSession | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L284) |
| program.updateSession | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L323) |
| program.deleteSession | events:write | sessions | [source](../../packages/modules/program/src/sessions.ts#L374) |
| program.program | events:read | core | [source](../../packages/modules/program/src/sessions.ts#L400) |
| program.counts | events:read | core | [source](../../packages/modules/program/src/sessions.ts#L434) |
| program.addSponsorDeliverable | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-deliverables.ts#L57) |
| program.setSponsorDeliverableDone | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-deliverables.ts#L118) |
| program.deleteSponsorDeliverable | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-deliverables.ts#L150) |
| program.sponsorDeliverables | events:read | sponsors | [source](../../packages/modules/program/src/sponsor-deliverables.ts#L171) |
| program.portalSetDeliverableDone | portal:sponsor_contact | sponsors | [source](../../packages/modules/program/src/sponsor-deliverables.ts#L204) |
| program.saveSponsorPackage | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L237) |
| program.grantSponsorPackage | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L278) |
| program.cancelSponsorGrant | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L345) |
| program.setSponsorExhibitor | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L394) |
| program.inviteSponsorContact | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L448) |
| program.resendSponsorInvite | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L490) |
| program.revokeSponsorContact | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L515) |
| program.assignSponsoredSession | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L546) |
| program.unassignSponsoredSession | events:write | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L605) |
| program.sponsorshipAdmin | events:read | sponsors | [source](../../packages/modules/program/src/sponsor-packages.ts#L670) |
| program.sponsorPortal | portal:sponsor_contact | sponsors | [source](../../packages/modules/program/src/sponsor-portal.ts#L18) |

### Feature rules and lifecycle

#### program (tier 3)

The lightweight event program (M1.4f): tracks, rooms, sessions, speakers, exhibitors and sponsors. Owns Postgres schema `program`. The roadmap's tier-3 contexts `sessions`, `speakers`, `exhibitors` and `sponsors` start here as one package; M5.2 (enrollment) and M5.4 (portals, leads) may split it.

**Invariants**
- Every row belongs to one event of the org: a composite `(org_id, event_id)` foreign key to `events.events` (hand-written in the migration, cascade on event delete). Rooms, tracks, speakers and sponsor tiers referenced by a session or sponsor must belong to the **same event** (checked by the commands).
- Session times are stored as instants (`timestamptz`); organizers enter wall-clock times in the **event's** timezone and the public agenda groups by day in that timezone.
- A session may belong to one date of a multi-date event (`occurrence_id` → `events.occurrences`, composite FK). It must fall within that date and the date must be scheduled.
- Conflicts (same room at overlapping times, a speaker in two overlapping sessions, a session outside the event) are **warnings**, never errors: the write happens and the console shows them. Intervals are half-open.
- A room or track in use can be deleted: its sessions keep their place and lose the room/track. A sponsor tier with sponsors can't be deleted (`tier_in_use`).
- Markdown fields (session description, speaker bio, exhibitor/sponsor description) are sanitized with the events module's Markdown subset. Links are http(s) only.
- Public reads (`publicProgram`, `publicSpeaker`) go through allowlist serializers: no capacities, no org internals.
- Entitlements: `sessions` (tracks, rooms, sessions), `speakers`, `exhibitors`, `sponsors`. Reading the program needs `events:read`; every write `events:write`.
- Events emitted (M1.4h): `program.speaker_deleted@1`, `program.exhibitor_deleted@1`, `program.sponsor_deleted@1` (`{ kind, eventId, id }`); media removes the row's photo/logo. `programOwnerTx` lets media check an image owner under RLS.

**Agenda model v2 (M5.2a)** — `src/agenda.ts`, pure rules in `src/domain/agenda.ts`:
- **Session types** (`session_types`, per event, org-editable; a "standard set" command in the organizer's language). Deleting a type keeps its sessions.
- **`session_details`**: one row per session, created and kept in step by the trigger `program.sync_session_details` (insert, and `capacity` updates on `sessions`). Holds the type, **included vs optional** (P5-9; default included), the pick-one group, `enrollment_open`, the CSV `import_key` and the **capacity counter** (`capacity` mirrors `sessions.capacity`; `enrolled` with the CHECK `enrolled >= 0 and (capacity is null or enrolled <= capacity)`). `enrolled` moves only through `claimSessionPlaceTx` / `releaseSessionPlaceTx` (a conditional UPDATE like ticketing's holds: optional, open, not full); M5.2b calls them. Lowering a session's capacity below `enrolled` fails the CHECK (M5.2b should map it to a friendly error in `updateSession`).
- **Pick-one groups** (`session_groups`): only optional sessions join (CHECK). `groupPickDecision` is the rule (exactly one pick per registrant and group); `session_group_picks` is the DB guard M5.2b writes through `recordGroupPickTx` (unique per registrant and group; a composite key into `session_details (org_id, session_id, group_id)` keeps the pick inside its group). A group with picks can't be deleted and its sessions can't leave it.
- **Warnings** (never errors): `room_too_small` (session capacity above the room's) and `group_not_overlapping`, next to the M1.4f overlaps (`agendaQuery.warnings`).
- **Publishing** (`agenda_publications`): no row = **live** (M1.4f: public at once); `draft` = no public sessions; `published` = the public agenda (`publicProgram`, `publicSpeaker`, `/v1` agenda) serves the stored allowlisted snapshot; `changed` is derived (current hash ≠ snapshot hash). Publishing emits `program.agenda.published@1` (`{ eventId, version, sessions, publishedAt }`); an unchanged re-publish is a no-op.
- **CSV import** on `@yayatoh/csv` (`agendaImportPreviewQuery` = dry run, `importAgendaCommand` = apply): times are wall-clock in the event's zone; speakers by email (`speaker_contacts`); matching by `key`, else title + start; idempotent; formula-like cells refused.
- Entitlement `sessions` for every write; `events:write` (the dry run too); reads `events:read`.

- M5.3a speaker portal: `speaker_changes` (proposals with the approved `base`; one pending per speaker and target; approval writes only changed fields and is refused when stale), `portal_tasks` + `portal_task_assignees` (generic by subject kind; one row per assignee). Portal commands need `portal:speaker` and re-check the principal (`speakerPrincipalTx`) and its subject; organizer commands `events:write`, reads `events:read`; all need `speakers`. Events: `program.speaker_change.decided@1`, `program.speaker_task.assigned@1`, `program.speaker_task.reminder_requested@1`, `program.speaker_task.completed@1`, `program.speaker_task.overdue@1` (once per assignee). The task reminder mailer queues `program.task-reminder` for open assignees only.
**M5.4a — exhibitor portal and booths**
- Exhibitor people are M5.3a portal accounts (`events.portal_accounts`, subject kind `exhibitor`, role `exhibitor_admin`/`exhibitor_staff`; merged in batch 3f): one event role at one event that expires with the event + 90 days, never org members, invited through `createPortalAccountTx` (the portal invite mailer emails the signed link) and signed in through the one portal sign-in flow (code or magic link). Revoking (`revokePortalAccountTx`) ends links, codes, sessions and the event role; deleting an exhibitor revokes its people.
- Portal commands need `portal:exhibitor` (both roles) or `portal:exhibitor_admin` and re-check the account in their transaction (`exhibitorPrincipalTx`: a live portal account with an exhibitor role whose exhibitor still exists in its event, admin where needed); they act only on the principal's own exhibitor.
- Staff invites stop at the allowance (the exhibitor's own, else the event default, else 5): pending and active staff hold places, revoked free them; the exhibitor row is locked before counting.
- With approval on, an admin's edit is the exhibitor's single pending change until the organizer approves (applied) or rejects it.
- Booths: numbers unique per event (case-insensitive); at most one primary per booth (the first by default; removing the primary promotes the longest-standing co-exhibitor). Overlaps, shared booths, several booths and category mismatches are warnings.
- Public reads (`publicExhibitorMap`, `publicProgram`) leave out unlisted exhibitors and go through allowlist serializers.
- Events: `program.exhibitor.staff_invited@1`, `program.booth.assigned@1`.

**Enrollment reads (M5.2b)** — `src/enrollment.ts`: `enrollableSessionsTx` / `enrollableSessionsByIdTx` (a session's
times, room, admission, group and counter) and `lockEnrollableSessionTx` (the counter row lock every enrollment decision
takes) for registration's enrollment, which never touches the `program` schema. `updateSession` refuses a capacity below
the places held (`invalid_state`, reason `capacity_below_enrolled`).
**M5.3b — call for papers** — `src/cfp.ts`, pure rules in `src/domain/cfp.ts`, tables in `src/schema-cfp.ts`:
- One call per event (`cfp_calls`: draft / open / closed, optional deadline, blind review, the lengths offered, co-speakers allowed). A draft call has no public page; closed and past-deadline calls refuse proposals (`cfpOpenness`).
- The public form (`submitCfpCommand`, `public:cfp`; the event comes from its public page): fixed fields + co-speakers (`cfp_co_speakers`; no repeated address, not the submitter) + the event's `cfp` questions in the forms engine (kind `cfp`, respondent `cfp_submission`; validated against the current version, nothing sensitive). One proposal per call, address and title (case-insensitive). Emits `program.cfp_submission.received@1`.
- Reviewers are portal accounts (event role `cfp_reviewer`, subject `cfp_reviewers`): `reviewerPrincipalTx` re-checks the account and its reviewer row; every reviewer read and write goes through the reviewer's own `cfp_assignments` row, so anything not assigned to them is `not_found`. Under blind review the reviewer queries never read names, co-speakers or answers (`forReviewer`). One review (score 1–5, comment) per assignment, editable until the proposal is decided.
- Deciding (`decideCfpSubmissionCommand`) locks the proposal row: decided once (`decided`). Accepting reuses or creates the speakers by email (`speaker_contacts`) and inserts **exactly one** session with `draft = true` (placeholder time: the event start for the requested length; `cfp_submissions.session_id` unique). Drafts never reach the public agenda, its snapshot or `/v1`, and a speaker whose only sessions are drafts is left out of the public speaker list; they warn about nothing. `placeDraftSessionCommand` puts the draft on the agenda. Emits `program.cfp_submission.decided@1`.
- `cfpMailer` (worker and dev drain) emails `program.cfp-received` to the submitter and `program.cfp-accepted` / `program.cfp-rejected` to every speaker on the proposal, in the submitter's language, with the organizer's note.
- Organizer commands need `events:write` (reads `events:read`); all need the `speakers` module.
**M5.4b — sponsor packages, deliverables and lead licenses**
- A package is a sponsor tier's terms (`sponsor_packages`). A grant (`sponsor_grants`) snapshots its allowances; at most one active and one pending grant per sponsor (partial uniques); quantity counts active grants and purchases whose hold (`PURCHASE_HOLD_MINUTES`) is live. Activation moves the sponsor to the tier, adds template deliverables and emits `program.sponsor_package.activated@1`; cancelling emits `…cancelled@1` and frees session slots; deleting a sponsor cancels its package and revokes its contacts.
- Purchases are orders' add-on orders: program reserves (`reserveSponsorPackageTx`, `reserveLeadLicensesTx`) and activates in the payment's transaction (`activatePurchasedGrantTx`, `activateLicensePurchaseTx`); program never calls orders.
- The exhibitor a sponsor exhibits as (`sponsor_profiles`) gets the active packages' badges (added to the staff allowance) and lead licenses. Lead licenses = included (`exhibitor_settings.included_lead_licenses`, default 1) + packages + bought; seats (`lead_licenses`) belong to live portal accounts, counted under the exhibitor row lock; assigning activates the `lead_retrieval` add-on.
- Deliverables are due by the end of the due day in the event's zone (`due_at` = next local midnight); overdue = open and `now >= due_at`. Sponsor contacts tick off only their sponsor's `owner = 'sponsor'` items.
- Portal commands need `portal:sponsor_contact` (re-checked with `sponsorPrincipalTx`), license commands `portal:exhibitor(_admin)`; entitlement `sponsors` (packages, deliverables) or `exhibitors` (licenses).


### Source index

- [packages/modules/program/src/agenda-dto.ts](../../packages/modules/program/src/agenda-dto.ts)
- [packages/modules/program/src/agenda.ts](../../packages/modules/program/src/agenda.ts)
- [packages/modules/program/src/booth-chat.ts](../../packages/modules/program/src/booth-chat.ts)
- [packages/modules/program/src/booths.ts](../../packages/modules/program/src/booths.ts)
- [packages/modules/program/src/calendar.ts](../../packages/modules/program/src/calendar.ts)
- [packages/modules/program/src/cfp.ts](../../packages/modules/program/src/cfp.ts)
- [packages/modules/program/src/checkin-facts.ts](../../packages/modules/program/src/checkin-facts.ts)
- [packages/modules/program/src/conference-facts.ts](../../packages/modules/program/src/conference-facts.ts)
- [packages/modules/program/src/crm-sponsor-rows.ts](../../packages/modules/program/src/crm-sponsor-rows.ts)
- [packages/modules/program/src/data-subject.ts](../../packages/modules/program/src/data-subject.ts)
- [packages/modules/program/src/domain/agenda.ts](../../packages/modules/program/src/domain/agenda.ts)
- [packages/modules/program/src/domain/cfp.ts](../../packages/modules/program/src/domain/cfp.ts)
- [packages/modules/program/src/domain/exhibitors.ts](../../packages/modules/program/src/domain/exhibitors.ts)
- [packages/modules/program/src/domain/lead-seat.ts](../../packages/modules/program/src/domain/lead-seat.ts)
- [packages/modules/program/src/domain/portal.ts](../../packages/modules/program/src/domain/portal.ts)
- [packages/modules/program/src/domain/schedule.ts](../../packages/modules/program/src/domain/schedule.ts)
- [packages/modules/program/src/domain/sponsorship.ts](../../packages/modules/program/src/domain/sponsorship.ts)
- [packages/modules/program/src/dto.ts](../../packages/modules/program/src/dto.ts)
- [packages/modules/program/src/enrollment.ts](../../packages/modules/program/src/enrollment.ts)
- [packages/modules/program/src/exhibitor-dto.ts](../../packages/modules/program/src/exhibitor-dto.ts)
- [packages/modules/program/src/exhibitor-portal.ts](../../packages/modules/program/src/exhibitor-portal.ts)
- [packages/modules/program/src/hub.ts](../../packages/modules/program/src/hub.ts)
- [packages/modules/program/src/index.ts](../../packages/modules/program/src/index.ts)
- [packages/modules/program/src/lead-licenses.ts](../../packages/modules/program/src/lead-licenses.ts)
- [packages/modules/program/src/lead-seat.ts](../../packages/modules/program/src/lead-seat.ts)
- [packages/modules/program/src/people.ts](../../packages/modules/program/src/people.ts)
- [packages/modules/program/src/portal-dto.ts](../../packages/modules/program/src/portal-dto.ts)
- [packages/modules/program/src/portal-speakers.ts](../../packages/modules/program/src/portal-speakers.ts)
- [packages/modules/program/src/portal-tasks.ts](../../packages/modules/program/src/portal-tasks.ts)
- [packages/modules/program/src/private-columns.ts](../../packages/modules/program/src/private-columns.ts)
- [packages/modules/program/src/public-session.ts](../../packages/modules/program/src/public-session.ts)
- [packages/modules/program/src/public.ts](../../packages/modules/program/src/public.ts)
- [packages/modules/program/src/schema-cfp.ts](../../packages/modules/program/src/schema-cfp.ts)
- [packages/modules/program/src/schema-portal.ts](../../packages/modules/program/src/schema-portal.ts)
- [packages/modules/program/src/schema-sponsors.ts](../../packages/modules/program/src/schema-sponsors.ts)
- [packages/modules/program/src/schema.ts](../../packages/modules/program/src/schema.ts)
- [packages/modules/program/src/sessions.ts](../../packages/modules/program/src/sessions.ts)
- [packages/modules/program/src/shared.ts](../../packages/modules/program/src/shared.ts)
- [packages/modules/program/src/sponsor-allowances.ts](../../packages/modules/program/src/sponsor-allowances.ts)
- [packages/modules/program/src/sponsor-deliverables.ts](../../packages/modules/program/src/sponsor-deliverables.ts)
- [packages/modules/program/src/sponsor-dto.ts](../../packages/modules/program/src/sponsor-dto.ts)
- [packages/modules/program/src/sponsor-packages.ts](../../packages/modules/program/src/sponsor-packages.ts)
- [packages/modules/program/src/sponsor-portal.ts](../../packages/modules/program/src/sponsor-portal.ts)
- [packages/modules/program/src/ui.ts](../../packages/modules/program/src/ui.ts)

## registration

Tier 5; 33 source files; 3 test files.

Declared connections: @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/program, @yayatoh/ticketing.

Source imports: @yayatoh/billing, @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform, @yayatoh/program, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: registration.cell.disabled, registration.cell.enabled, registration.registrant.applied, registration.registrant.approved, registration.registrant.confirmed, registration.registrant.denied, registration.registrant.substituted, registration.session.enrollment_changed, registration.session.promoted, registration.type.over_capacity, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| registration.setTypeRules | events:write | registration | [source](../../packages/modules/registration/src/approvals.ts#L79) |
| registration.replaceMembers | events:write | registration | [source](../../packages/modules/registration/src/approvals.ts#L126) |
| registration.saveReasonTemplate | events:write | registration | [source](../../packages/modules/registration/src/approvals.ts#L171) |
| registration.removeReasonTemplate | events:write | registration | [source](../../packages/modules/registration/src/approvals.ts#L205) |
| registration.approvalSetup | events:read | registration | [source](../../packages/modules/registration/src/approvals.ts#L229) |
| registration.decide | events:write | registration | [source](../../packages/modules/registration/src/approvals.ts#L441) |
| registration.apply | public:checkout | registration | [source](../../packages/modules/registration/src/approvals.ts#L576) |
| registration.payApproved | public:checkout | registration | [source](../../packages/modules/registration/src/approvals.ts#L698) |
| registration.startCheckout | public:checkout | registration | [source](../../packages/modules/registration/src/checkout.ts#L115) |
| registration.joinWaitlist | public:waitlist | registration | [source](../../packages/modules/registration/src/checkout.ts#L243) |
| registration.sponsorCompUsage | portal:sponsor_contact | sponsors | [source](../../packages/modules/registration/src/comp-codes.ts#L119) |
| registration.enrollSession | public:enrollment | registration | [source](../../packages/modules/registration/src/enrollment.ts#L446) |
| registration.dropSession | public:enrollment | registration | [source](../../packages/modules/registration/src/enrollment.ts#L570) |
| registration.acceptSessionOffer | public:enrollment | registration | [source](../../packages/modules/registration/src/enrollment.ts#L617) |
| registration.mySchedule | public:enrollment | registration | [source](../../packages/modules/registration/src/enrollment.ts#L680) |
| registration.enrollmentOverview | events:read | registration | [source](../../packages/modules/registration/src/enrollment.ts#L738) |
| registration.promoteSessionNow | events:write | registration | [source](../../packages/modules/registration/src/enrollment.ts#L808) |
| registration.setEnrollmentSettings | events:write | registration | [source](../../packages/modules/registration/src/enrollment.ts#L832) |
| registration.setItemSessions | events:write | registration | [source](../../packages/modules/registration/src/enrollment.ts#L877) |
| registration.sweepEnrollments | platform:registration.sweep | null or not captured | [source](../../packages/modules/registration/src/enrollment.ts#L935) |
| registration.startGroup | public:checkout | registration | [source](../../packages/modules/registration/src/groups.ts#L53) |
| registration.addGuest | public:checkout | registration | [source](../../packages/modules/registration/src/groups.ts#L109) |
| registration.substituteByPayer | public:checkout | registration | [source](../../packages/modules/registration/src/groups.ts#L270) |
| registration.substitute | events:write | registration | [source](../../packages/modules/registration/src/groups.ts#L291) |
| registration.favoriteSession | public:enrollment | registration | [source](../../packages/modules/registration/src/hub.ts#L104) |
| registration.conferenceHub | public:enrollment | registration | [source](../../packages/modules/registration/src/hub.ts#L183) |
| registration.rotateCalendarFeed | public:enrollment | registration | [source](../../packages/modules/registration/src/hub.ts#L253) |
| registration.calendarFeed | public:enrollment | registration | [source](../../packages/modules/registration/src/hub.ts#L306) |
| registration.payLaterRules | events:read | registration | [source](../../packages/modules/registration/src/pay-later.ts#L76) |
| registration.setPayLater | events:write | registration | [source](../../packages/modules/registration/src/pay-later.ts#L101) |
| registration.queue | events:read | registration | [source](../../packages/modules/registration/src/queue.ts#L76) |
| registration.registrant | events:read | registration | [source](../../packages/modules/registration/src/queue.ts#L162) |
| registration.setup | events:read | registration | [source](../../packages/modules/registration/src/setup.ts#L159) |
| registration.typeRefs | events:read | registration | [source](../../packages/modules/registration/src/setup.ts#L191) |
| registration.createType | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L283) |
| registration.updateType | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L372) |
| registration.archiveType | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L429) |
| registration.createItem | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L489) |
| registration.updateItem | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L516) |
| registration.archiveItem | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L561) |
| registration.setCell | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L595) |
| registration.disableCell | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L683) |
| registration.seedDefaults | events:write | registration | [source](../../packages/modules/registration/src/setup.ts#L732) |

### Feature rules and lifecycle

#### registration (tier 5)

Registration types and admission items (M5.1a; layout in ADR 0021). Owns Postgres schema `registration`:
`registration_types`, `admission_items`, `type_items` (the matrix cells), `capacity_claims` and (M5.1c)
`registrants`, `type_members` (auto-approve member lists) and `reason_templates`. Later increments
add registrations, approvals, groups, invoices (M5.1c/d) and session enrollments (M5.2b) here.

**Invariants**
- **One inventory.** A registration type × admission item cell is exactly one ticket type, created by
  `registration.setCell` with `managed_by = 'registration'` (hidden; up to 20 per order since M5.1c, one per
  named registrant of a group, each registrant still picking each item once). Orders, tickets, refunds,
  check-in, badges and reports see ordinary tickets. Ticketing refuses to quote, edit or archive a managed pass for
  anyone but registration, so the public checkout, the box office, access codes and `/v1` can't sell or change it.
  Disabling a cell archives its pass and the cell; enabling it again makes a new cell (old tickets still count).
- **A registration** is one registrant: one type, exactly one `admission` item and any `add_on` items, each once
  (`selectionProblem`). Only admission tickets count against the type's capacity.
- **Per-type capacity** is a counter on the type row (`quantity_held + quantity_sold ≤ capacity`, a CHECK). Checkout
  locks the type row, checks the room left beyond the type's waitlist (places waited for and open offers kept back,
  like M3.10a) and claims the place in the same transaction as the ticketing hold. `capacity_claims` records what
  each order counts; the `registration.capacity` subscriber (`order.paid`, `order.expired`, `order.refunded`,
  `order.payment_orphaned`, `tickets.cancelled`, all v1) recomputes the claim from orders and tickets and applies
  only the difference, so replayed or reordered events release a place exactly once. A late payment that no
  longer fits is not counted and emits `registration.type.over_capacity@1`.
- **Eligibility** (open, access code, email domain; subdomains match) is checked in `registration.startCheckout`
  and `registration.joinWaitlist` whatever the client sends (`forbidden`, reason `code_required`, `code_wrong` or
  `domain_not_allowed`). Pages show a buyer only the types they may pick (`publicRegistration`); codes and domains
  never leave the console.
- **Per-type waitlist** is M3.10a's: a full type's buyer joins the line of the admission item they want (managed
  lines have automatic offers off; the organizer's console can't offer on them). When places free (a release, an
  offer lapsing or given up — `waitlist.offer_expired@1`, `waitlist.offer_released@1` — or a capacity raise),
  registration offers them through `offerWaitlistEntryTx` in one queue across the type's lines, in line order;
  open offers count against the type, so each place is offered once. The offer is bought through
  `registration.startCheckout` with its link.
- **Conference pack (P5-11).** Setup commands activate the `conference_pack` event add-on (billing; free in beta,
  `beta_free`) and enforce its per-event quotas (`registrationTypes`, `admissionItems`, `registrants`). A catalog
  price later makes activation a purchase with no code change here.
- **Entitlement and permissions.** Every command and query needs the `registration` module key (P5-1). Reading the
  page is `events:read`; every organizer write `events:write`; checkout `public:checkout`; joining a line
  `public:waitlist`.
- **Public output** is an allowlist (`PublicRegistrationDto`): per type its name, description, all-in price range
  and whether it is full; per offered item its name, description, kind and all-in price.
- **Events:** `registration.type.{created,updated,archived}@1`, `registration.item.{created,updated,archived}@1`,
  `registration.cell.{enabled,disabled}@1` (ids and keys only), `registration.type.over_capacity@1`.
- **`RegistrationTypeRef`** (id, key, name) is the stable reference for other modules (M5.1b form paths, badges).

**M5.1c: approval, groups and +1**
- **Registrants** are one named person each: `pending` (applied) → `approved` → `confirmed`, or `denied`; a public,
  group or +1 checkout makes `reserved` registrants of its order, `confirmed` when it is paid (each with one of the
  order's admission tickets, named for them; `registration.registrants` subscriber) or `cancelled` when it lapses.
  An approved applicant whose order lapses stays approved (order cleared) and may pay again.
- **Apply-to-attend** (`approval = 'manual'` on the type): `registration.apply` makes a pending application with no
  order: **nobody is charged before approval**. The public checkout, groups and the waitlist refuse approval types
  (`approval_required`). Auto-approval on applying: an address at an auto-approve domain (subdomains match), else on
  the type's member list (CSV or an audience snapshot taken by the app). A free selection is confirmed on approval;
  a paid one is paid from the applicant's signed link (`registration.payApproved`, which returns the open order of
  an earlier attempt instead of a second one).
- **Capacity on approval:** approved places count against the type's room like open waitlist offers
  (`typeDemandTx().approved`; public room, offer room and the capacity floor subtract them). Approval locks the
  registrant, then the type row, so concurrent approvals never pass the capacity. Every path locks registrant →
  type, and multi-type checkouts lock types in id order.
- **Decisions** (`registration.decide`, bulk `registration.decide` action = `registration.startDecide`): deciding
  what is already decided changes nothing (no second email); bulk runs 50 per chunk, each registrant in its own
  savepoint (a full type fails alone with its code); a crash replays only the uncommitted chunk. Approval and denial
  emails (`registration.approved` / `registration.denied`, dedupe per decision time) carry the reason (typed or a
  reason template).
- **Groups:** one payer, up to 20 named registrants each with a type and pass, one order; capacity claimed per type
  (`capacity_claims` unique per order and type). **Substitution** until the type's cut-off
  (`substitution_cutoff_hours` before the start) by the payer (group link) or the organizer: the ticket is reissued
  (new signed code and short code, the old ones stop), so exactly one credential stays valid; the attendee moves.
  A domain rule binds the new person. Audited (`registration.substitute`).
- **+1:** a type of `kind = 'guest'` is never sold directly or listed publicly; a confirmed host adds guests from
  their own link (up to `guests_per_host`), paid by the host in its own order, linked by `host_registrant_id`.
- **Events:** `registration.registrant.{applied,approved,denied,confirmed,substituted}@1` (ids only).

**Session enrollment and waitlists (M5.2b)** — `src/enrollment.ts`, pure rules in `src/domain/enrollment.ts`:
- **A registrant is their admission ticket** (`registrant_id` → `ticketing.tickets`; one per registrant since M5.1a, so an
  M5.1c substitution keeps the enrollments). The attendee's credential is the order's manage link (`myScheduleQuery`,
  `enrollSessionCommand`, `dropSessionCommand`, `acceptSessionOfferCommand`; `public:enrollment`).
- **Availability by admission item** (`item_sessions`): an `admission` item listing nothing gives every session; a listing
  gives only those; an `add_on` gives only what it lists. A registrant's items are their pass and the order's add-ons.
- **Atomic claim**: every decision runs under the session's counter row lock (`lockEnrollableSessionTx`, program) and a
  per-registrant advisory lock; places move only through program's `claimSessionPlaceTx` / `releaseSessionPlaceTx`, whose
  CHECK (`enrolled <= capacity`) is the last line of defence. Sessions are locked in id order (no deadlocks on swaps).
- **Conflicts**: a pick-one group allows one pick (program's `session_group_picks` is the DB guard); overlapping sessions
  (half-open) are refused with the session in the way (`conflict`, reason `overlap` / `one_per_group`), replaced on
  request (`choice: 'replace'`), or kept both only when neither has a capacity (P5-9, `keep_both`).
- **The line** (`session_enrollments.status = 'waiting'`, FIFO by `(position_at, id)`): a full session's line is joined
  only without conflicts and until the close. A free place belongs to the line first (enrolling promotes before it
  decides). Promotion (`planPromotion`) re-checks each person (still registered, still given the session, no overlap or
  group pick) and passes over for good (`skipped`, with the reason) whoever no longer fits, so it never loops. Per event
  (`enrollment_settings`, default `auto`): `auto` enrols at once; `offer` holds the place as an offer for `offer_minutes`
  (never past the close), accepted from the schedule; the sweeper expires lapsed offers.
- **P5-9 close**: promotion stops 24 h before the session starts (`promotionOpen`); then a free place goes to whoever
  enrols first, and the line takes nobody new (`waitlist_closed`). "Promote now" is refused after the close.
- **Organizer** (`events:write`): `setEnrollmentSettingsCommand`, `setItemSessionsCommand`, `promoteSessionNowCommand`;
  `enrollmentOverviewQuery` (`events:read`): per session places, waiting, offered, the close time.
- **Workers**: `sweepEnrollmentsCommand` (`platform:registration.sweep`, every 30 s after the waitlist sweeper);
  `registrationEnrollment()` ends a cancelled or refunded registrant's sessions (`tickets.cancelled@1`,
  `order.refunded@1`) and promotes; `enrollmentMailer` emails promotions (`registration.session-enrolled`,
  `registration.session-offer`). Events: `registration.session.enrollment_changed@1` (`{ eventId, sessionId, registrantId, status: enrolled | dropped }`, M5.7b: a place taken directly or by an accepted offer, or dropped) and `registration.session.promoted@1` (`{ eventId, sessionId, enrollmentId,
  registrantId, status, offer }`).
- Entitlement `registration` for every command and query.

**M5.1d: pay later by invoice**
- Per type (`pay_later`, `po_number` off/optional/required; `registration.setPayLater`, `events:write`); never for approval or +1 types. `registration.startCheckout` with `payLater` checks the type and the PO rule (`pay_later_off`, `po_required`), then invoices the order in the same transaction (`issueInvoiceTx`): the place counts as sold and the registrant is confirmed at once; the balance is the invoice's business. `order.voided@1` releases the claim and cancels the registrant.

**M5.10a: the attendee conference hub**
- **Favorites** (`session_favorites`, one per registrant and session) hold no place and never touch the enrollment counter.
  `favoriteSessionCommand` (`public:enrollment`, the manage link) stars only sessions the registrant's items give; an
  overlap with the personal schedule (enrolled, offered or starred) is refused with the sessions in the way unless the
  attendee chose `keep_both`, or `replace` (un-stars overlapping favorites; refused while an enrolment is in the way:
  enrolments are dropped only by `dropSessionCommand`). At most 300 per registrant. Decisions per registrant are
  serialized by an advisory lock.
- **Calendar feed**: a signed link `{org}~{registrant}~{version}~{hmac}` (`signFeedToken`, the app token secret, its own
  purpose string). `calendarFeedTarget` checks the signature, then `registration.calendar_feed_target` (SECURITY
  DEFINER: active ticket, live org, version only); `calendarFeedQuery` checks the version again under RLS. The feed
  (`calendarFeedIcs`) carries enrolled (CONFIRMED), offered and starred (TENTATIVE) sessions: title, times, room; a
  session keeps its UID and its SEQUENCE grows with the session's (or room's) last change, so a calendar follows a
  moved session. `rotateCalendarFeedCommand` bumps the version (every earlier link stops).
- `conferenceHubQuery`: the hub's allowlisted view (M5.2b states plus `favorite`, `onSchedule`, `conflicts`).


### Source index

- [packages/modules/registration/src/approvals.ts](../../packages/modules/registration/src/approvals.ts)
- [packages/modules/registration/src/capacity.ts](../../packages/modules/registration/src/capacity.ts)
- [packages/modules/registration/src/checkout.ts](../../packages/modules/registration/src/checkout.ts)
- [packages/modules/registration/src/client.ts](../../packages/modules/registration/src/client.ts)
- [packages/modules/registration/src/comp-codes.ts](../../packages/modules/registration/src/comp-codes.ts)
- [packages/modules/registration/src/conference-facts.ts](../../packages/modules/registration/src/conference-facts.ts)
- [packages/modules/registration/src/data-subject.ts](../../packages/modules/registration/src/data-subject.ts)
- [packages/modules/registration/src/domain/approval.ts](../../packages/modules/registration/src/domain/approval.ts)
- [packages/modules/registration/src/domain/capacity.ts](../../packages/modules/registration/src/domain/capacity.ts)
- [packages/modules/registration/src/domain/eligibility.ts](../../packages/modules/registration/src/domain/eligibility.ts)
- [packages/modules/registration/src/domain/enrollment.ts](../../packages/modules/registration/src/domain/enrollment.ts)
- [packages/modules/registration/src/domain/hub.ts](../../packages/modules/registration/src/domain/hub.ts)
- [packages/modules/registration/src/domain/matrix.ts](../../packages/modules/registration/src/domain/matrix.ts)
- [packages/modules/registration/src/dto.ts](../../packages/modules/registration/src/dto.ts)
- [packages/modules/registration/src/enrollment-dto.ts](../../packages/modules/registration/src/enrollment-dto.ts)
- [packages/modules/registration/src/enrollment-mailer.ts](../../packages/modules/registration/src/enrollment-mailer.ts)
- [packages/modules/registration/src/enrollment.ts](../../packages/modules/registration/src/enrollment.ts)
- [packages/modules/registration/src/groups.ts](../../packages/modules/registration/src/groups.ts)
- [packages/modules/registration/src/hub-dto.ts](../../packages/modules/registration/src/hub-dto.ts)
- [packages/modules/registration/src/hub.ts](../../packages/modules/registration/src/hub.ts)
- [packages/modules/registration/src/index.ts](../../packages/modules/registration/src/index.ts)
- [packages/modules/registration/src/kiosk.ts](../../packages/modules/registration/src/kiosk.ts)
- [packages/modules/registration/src/lead-person.ts](../../packages/modules/registration/src/lead-person.ts)
- [packages/modules/registration/src/lifecycle.ts](../../packages/modules/registration/src/lifecycle.ts)
- [packages/modules/registration/src/pay-later.ts](../../packages/modules/registration/src/pay-later.ts)
- [packages/modules/registration/src/private-columns.ts](../../packages/modules/registration/src/private-columns.ts)
- [packages/modules/registration/src/queue.ts](../../packages/modules/registration/src/queue.ts)
- [packages/modules/registration/src/ref.ts](../../packages/modules/registration/src/ref.ts)
- [packages/modules/registration/src/registrant-checkout.ts](../../packages/modules/registration/src/registrant-checkout.ts)
- [packages/modules/registration/src/registrant-records.ts](../../packages/modules/registration/src/registrant-records.ts)
- [packages/modules/registration/src/schema.ts](../../packages/modules/registration/src/schema.ts)
- [packages/modules/registration/src/session-access.ts](../../packages/modules/registration/src/session-access.ts)
- [packages/modules/registration/src/setup.ts](../../packages/modules/registration/src/setup.ts)

## reports

Tier 5; 24 source files; 5 test files.

Declared connections: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Source imports: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/orders, @yayatoh/payments, @yayatoh/platform, @yayatoh/seating, @yayatoh/tenancy, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: system, vocab.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| reports.attendeeList | attendees:read | attendees | [source](../../packages/modules/reports/src/attendee-list.ts#L67) |
| reports.matchingAttendeeIds | attendees:read | attendees | [source](../../packages/modules/reports/src/attendee-list.ts#L95) |
| reports.disputeEvidence | finance:read | null or not captured | [source](../../packages/modules/reports/src/dispute-evidence.ts#L111) |
| reports.disputeEvidencePacket | finance:read | null or not captured | [source](../../packages/modules/reports/src/dispute-evidence.ts#L222) |
| reports.disputeQueue | finance:read | null or not captured | [source](../../packages/modules/reports/src/dispute-queue.ts#L43) |
| reports.eventReport | orders:read | reports | [source](../../packages/modules/reports/src/metrics/event-report.ts#L67) |
| reports.eventFinance | finance:read | reports | [source](../../packages/modules/reports/src/metrics/event-report.ts#L152) |
| reports.orgReport | orders:read | reports | [source](../../packages/modules/reports/src/metrics/org-report.ts#L70) |
| reports.orgFinance | finance:read | reports | [source](../../packages/modules/reports/src/metrics/org-report.ts#L104) |
| reports.eventKpis | orders:read | reports | [source](../../packages/modules/reports/src/metrics/read.ts#L121) |
| reports.eventFinanceKpis | finance:read | reports | [source](../../packages/modules/reports/src/metrics/read.ts#L145) |
| reports.eventMetrics | orders:read | reports | [source](../../packages/modules/reports/src/metrics/read.ts#L241) |
| reports.eventFinanceMetrics | finance:read | reports | [source](../../packages/modules/reports/src/metrics/read.ts#L254) |
| reports.eventTimeseries | orders:read | reports | [source](../../packages/modules/reports/src/metrics/read.ts#L279) |
| reports.metricsPipeline | orders:read | reports | [source](../../packages/modules/reports/src/metrics/read.ts#L351) |
| reports.rebuildEventMetrics | events:write | reports | [source](../../packages/modules/reports/src/metrics/rebuild.ts#L12) |
| reports.moneyOverview | finance:read | reports | [source](../../packages/modules/reports/src/money.ts#L153) |
| reports.eventMoney | finance:read | reports | [source](../../packages/modules/reports/src/money.ts#L259) |
| reports.payoutsDashboard | finance:read | reports | [source](../../packages/modules/reports/src/money.ts#L374) |
| reports.payoutDetail | finance:read | reports | [source](../../packages/modules/reports/src/money.ts#L479) |
| reports.fees | finance:read | reports | [source](../../packages/modules/reports/src/money.ts#L581) |
| reports.orderTimeline | orders:read | ticketing | [source](../../packages/modules/reports/src/order-timeline.ts#L125) |
| reports.contactTimeline | contacts:read | attendees | [source](../../packages/modules/reports/src/timeline.ts#L43) |

### Feature rules and lifecycle

#### reports (tier 5)

Exports and (from M1.12) reports that read across modules, and (from M3.1a) the metric
projections and the analytics sink. It reads other modules only through their exported
functions, writes files through the platform bulk framework, and owns four tables in the
`reports` schema: `metric_snapshots`, `metric_timeseries`, `projector_lag` and
`analytics_events`. The projections live here, not in a new module, because they materialize the
registry's metrics from the same exported facts (`gatherFactsTx`), so a projected number and a
report number are one definition; a separate module would have to sit at tier 6 and then the
reports module (tier 5) could not read it for the dashboard tiles.

**Invariants**
- Every export is an allowlist of columns. Contact ids, tokens, answers marked sensitive and payment data never leave.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'`, so spreadsheet apps don't run them as formulas (CSV injection).
- Exports run as bulk operations: the selection is snapshotted, progress is visible, and the file expires after 7 days.
- Starting an export needs a recent step-up (bulk actions with a file default to `stepUp`, M1.2c).
- Times are rendered in the event's timezone.
- Every number a report, dashboard or export shows comes from the metric registry (`src/metrics/registry.ts`): one definition per key, each value stamped with `asOf`. Money is per currency and never summed across currencies.
- Reports read other modules only through their exported read functions (`*FactsTx`, `salesBy*Tx`, …) inside the caller's tenant transaction; they never import another module's schema.
- Finance figures (platform fees, disputes, net revenue) need `finance:read`; sales and counts need `orders:read`.
- **Attendee list (M1.8f):** `reports.attendeeList` adds ticket-type and check-in (today in the event's time zone / any day / never) filters to the attendees module's own, as subqueries from ticketing and check-in. Exports and "everything matching" selections (`reports.matchingAttendeeIds`) use the same filter.
- Metric projections (M3.1) are projections, never the system of record: `rebuildEventMetricsTx` recomputes them from the sources and must give the same values the projector converges to (property test).
- Every projected value is recomputed from its sources after taking its advisory lock (event snapshot → counter shards ascending → series lock → series buckets sorted), never incremented, so replays, duplicates and out-of-order deliveries converge. Hot counters (check-ins) spread over `COUNTER_SHARDS` shards keyed by the ticket id's last byte, summed on read.
- Backfilled (`replayed`) events update projections but record no lag sample and call no `onChange`.
- The analytics sink takes only `AnalyticsEvent` (a Zod allowlist): no names, emails, phone numbers, free text or ids of people. `analytics_events` is append-only for the runtime role.
- **Dispute queue (M3.10c):** `reports.disputeQueue` (`finance:read`) lists the org's disputes with buyer, event, amount, status and hours to the evidence deadline (open soonest first, closed newest first). The evidence packet also carries the refund terms snapshotted at purchase and the order's ticket transfers; the order timeline adds credit notes, store credit used/given back and macro runs.


### Source index

- [packages/modules/reports/src/analytics.ts](../../packages/modules/reports/src/analytics.ts)
- [packages/modules/reports/src/attendee-export.ts](../../packages/modules/reports/src/attendee-export.ts)
- [packages/modules/reports/src/attendee-list.ts](../../packages/modules/reports/src/attendee-list.ts)
- [packages/modules/reports/src/bookings-export.ts](../../packages/modules/reports/src/bookings-export.ts)
- [packages/modules/reports/src/dispute-evidence.ts](../../packages/modules/reports/src/dispute-evidence.ts)
- [packages/modules/reports/src/dispute-queue.ts](../../packages/modules/reports/src/dispute-queue.ts)
- [packages/modules/reports/src/format.ts](../../packages/modules/reports/src/format.ts)
- [packages/modules/reports/src/index.ts](../../packages/modules/reports/src/index.ts)
- [packages/modules/reports/src/metrics/catalog.ts](../../packages/modules/reports/src/metrics/catalog.ts)
- [packages/modules/reports/src/metrics/event-report.ts](../../packages/modules/reports/src/metrics/event-report.ts)
- [packages/modules/reports/src/metrics/facts.ts](../../packages/modules/reports/src/metrics/facts.ts)
- [packages/modules/reports/src/metrics/headline.ts](../../packages/modules/reports/src/metrics/headline.ts)
- [packages/modules/reports/src/metrics/org-report.ts](../../packages/modules/reports/src/metrics/org-report.ts)
- [packages/modules/reports/src/metrics/projector.ts](../../packages/modules/reports/src/metrics/projector.ts)
- [packages/modules/reports/src/metrics/read.ts](../../packages/modules/reports/src/metrics/read.ts)
- [packages/modules/reports/src/metrics/rebuild.ts](../../packages/modules/reports/src/metrics/rebuild.ts)
- [packages/modules/reports/src/metrics/registry.ts](../../packages/modules/reports/src/metrics/registry.ts)
- [packages/modules/reports/src/money-buckets.ts](../../packages/modules/reports/src/money-buckets.ts)
- [packages/modules/reports/src/money-csv.ts](../../packages/modules/reports/src/money-csv.ts)
- [packages/modules/reports/src/money.ts](../../packages/modules/reports/src/money.ts)
- [packages/modules/reports/src/order-timeline.ts](../../packages/modules/reports/src/order-timeline.ts)
- [packages/modules/reports/src/private-columns.ts](../../packages/modules/reports/src/private-columns.ts)
- [packages/modules/reports/src/schema.ts](../../packages/modules/reports/src/schema.ts)
- [packages/modules/reports/src/timeline.ts](../../packages/modules/reports/src/timeline.ts)

## reviews

Tier 5; 11 source files; 1 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/orders, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: review.hidden, review.reported, review.submitted, review.unhidden, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| reviews.submitReview | public:review_submit | core | [source](../../packages/modules/reviews/src/reviews.ts#L83) |
| reviews.hideReview | events:write | core | [source](../../packages/modules/reviews/src/reviews.ts#L158) |
| reviews.unhideReview | events:write | core | [source](../../packages/modules/reviews/src/reviews.ts#L198) |
| reviews.dismissReports | events:write | core | [source](../../packages/modules/reviews/src/reviews.ts#L235) |
| reviews.reportReview | public:review_report | core | [source](../../packages/modules/reviews/src/reviews.ts#L262) |
| reviews.listReviews | events:read | core | [source](../../packages/modules/reviews/src/reviews.ts#L318) |

### Feature rules and lifecycle

#### reviews (tier 5)

Event reviews by ticket holders (M1.4g). Owns Postgres schema `reviews`.

**Tier:** 5. Eligibility reads the buyer's order and tickets (`orders`, tier 4, which composes
`ticketing` and `events`) inside the review's own tenant transaction; nothing below needs
reviews. The composite FKs point down: `reviews → events.events` (tier 2) and
`reviews → orders.orders` (tier 4).

**Invariants**
- Only a buyer who **still holds a live ticket** may review, from their order page (the manage
  link token is re-verified under the org's RLS), once their ticket's date has **ended** (an
  instant; a multi-date ticket uses its own date), for an event that took place (not cancelled
  or postponed), until the end of the local day 90 days later in the event's timezone.
  Check-in is not required (pending owner).
- **One review per holder per event**: `UNIQUE (org_id, event_id, author_key)`, where
  `author_key` = SHA-256(org id ∶ normalized buyer email). The email is never stored here; the
  public name is "First L." (`reviewerDisplayName`).
- Rating 1–5; optional plain text ≤ 1000 characters (control and bidi-override characters
  stripped; rendered as text, never Markdown or HTML).
- The public sees only `visible` reviews, through `PublicReviewDto` (rating, text, "First L.",
  date, and an id to report it). JSON-LD `aggregateRating` only from `MIN_REVIEWS_FOR_RATING`
  (3, pending owner) visible reviews.
- Moderation (`events:write`, event roles included): hide/unhide with a reason, dismiss reports.
  Each is audited with the reason. Viewers read the list only. Reports are one per device per
  review; hiding marks open reports `actioned`.
- Events: `review.submitted@1`, `review.hidden@1`, `review.unhidden@1`, `review.reported@1`.
- Submissions and reports are rate-limited by the caller (M1.14 policies `reviewSubmit`,
  `reviewReport`).


### Source index

- [packages/modules/reviews/src/data-subject.ts](../../packages/modules/reviews/src/data-subject.ts)
- [packages/modules/reviews/src/domain/constants.ts](../../packages/modules/reviews/src/domain/constants.ts)
- [packages/modules/reviews/src/domain/eligibility.ts](../../packages/modules/reviews/src/domain/eligibility.ts)
- [packages/modules/reviews/src/dto.ts](../../packages/modules/reviews/src/dto.ts)
- [packages/modules/reviews/src/index.ts](../../packages/modules/reviews/src/index.ts)
- [packages/modules/reviews/src/popularity.ts](../../packages/modules/reviews/src/popularity.ts)
- [packages/modules/reviews/src/private-columns.ts](../../packages/modules/reviews/src/private-columns.ts)
- [packages/modules/reviews/src/reviews.ts](../../packages/modules/reviews/src/reviews.ts)
- [packages/modules/reviews/src/schema.ts](../../packages/modules/reviews/src/schema.ts)
- [packages/modules/reviews/src/testing.ts](../../packages/modules/reviews/src/testing.ts)
- [packages/modules/reviews/src/ui.ts](../../packages/modules/reviews/src/ui.ts)

## seating

Tier 3; 46 source files; 15 test files.

Declared connections: @yayatoh/attendees, @yayatoh/db, @yayatoh/events, @yayatoh/floorplan, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui.

Source imports: @yayatoh/attendees, @yayatoh/db, @yayatoh/events, @yayatoh/floorplan, @yayatoh/kernel, @yayatoh/pdf, @yayatoh/platform, @yayatoh/tenancy, @yayatoh/ui/tokens.

Tables detected: see schema source.

Event type literals detected: seating.assignments_changed, seating.finder_code_created, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| seating.assign | seating:write | seating | [source](../../packages/modules/seating/src/assignments.ts#L144) |
| seating.unassign | seating:write | seating | [source](../../packages/modules/seating/src/assignments.ts#L401) |
| seating.assignments | attendees:read | seating | [source](../../packages/modules/seating/src/assignments.ts#L484) |
| seating.selectionPage | events:read | advanced_seating | [source](../../packages/modules/seating/src/best-available.ts#L127) |
| seating.setSelectionSettings | seating:write | advanced_seating | [source](../../packages/modules/seating/src/best-available.ts#L168) |
| seating.setCompanionSeats | seating:write | advanced_seating | [source](../../packages/modules/seating/src/best-available.ts#L213) |
| seating.holdBestAvailable | public:checkout | advanced_seating | [source](../../packages/modules/seating/src/best-available.ts#L555) |
| seating.holdBestAvailableStaff | orders:sell | advanced_seating | [source](../../packages/modules/seating/src/best-available.ts#L578) |
| seating.releaseBestAvailable | public:checkout | advanced_seating | [source](../../packages/modules/seating/src/best-available.ts#L604) |
| seating.cards | guests:read | seating | [source](../../packages/modules/seating/src/cards.ts#L76) |
| seating.exportGuestSeating | attendees:export | seating | [source](../../packages/modules/seating/src/cards.ts#L111) |
| seating.channels | events:read | advanced_seating | [source](../../packages/modules/seating/src/channels.ts#L185) |
| seating.saveChannel | seating:write | advanced_seating | [source](../../packages/modules/seating/src/channels.ts#L233) |
| seating.deleteChannel | seating:write | advanced_seating | [source](../../packages/modules/seating/src/channels.ts#L308) |
| seating.allotSeats | seating:write | advanced_seating | [source](../../packages/modules/seating/src/channels.ts#L341) |
| seating.allocateGroup | seating:write | seating | [source](../../packages/modules/seating/src/groups.ts#L33) |
| seating.releaseGroup | seating:write | seating | [source](../../packages/modules/seating/src/groups.ts#L113) |
| seating.groups | events:read | seating | [source](../../packages/modules/seating/src/groups.ts#L158) |
| seating.partySeats | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/guest-finder.ts#L138) |
| seating.findGuestSeatByPin | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/guest-finder.ts#L221) |
| seating.guestSeating | guests:read | seating | [source](../../packages/modules/seating/src/guest-seating.ts#L303) |
| seating.seatGuests | seating:write | seating | [source](../../packages/modules/seating/src/guest-seating.ts#L404) |
| seating.unseatGuests | seating:write | seating | [source](../../packages/modules/seating/src/guest-seating.ts#L475) |
| seating.setVipTable | seating:write | seating | [source](../../packages/modules/seating/src/guest-seating.ts#L514) |
| seating.saveLayout | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L74) |
| seating.listLayouts | events:read | seating | [source](../../packages/modules/seating/src/layouts.ts#L95) |
| seating.getLayout | events:read | seating | [source](../../packages/modules/seating/src/layouts.ts#L112) |
| seating.setEventLayout | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L149) |
| seating.publishEventLayout | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L266) |
| seating.assignSeatCategory | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L309) |
| seating.blockSeats | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L333) |
| seating.eventSeating | events:read | seating | [source](../../packages/modules/seating/src/layouts.ts#L394) |
| seating.dateCharts | events:read | seating | [source](../../packages/modules/seating/src/layouts.ts#L567) |
| seating.giveDateOwnChart | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L613) |
| seating.removeDateChart | seating:write | seating | [source](../../packages/modules/seating/src/layouts.ts#L752) |
| seating.layoutLibrary | events:read | seating | [source](../../packages/modules/seating/src/library.ts#L29) |
| seating.renameLayout | seating:write | seating | [source](../../packages/modules/seating/src/library.ts#L60) |
| seating.deleteLayout | seating:write | seating | [source](../../packages/modules/seating/src/library.ts#L79) |
| seating.liveAccess | events:read | seating | [source](../../packages/modules/seating/src/live.ts#L163) |
| seating.layoutRevisions | events:read | advanced_seating | [source](../../packages/modules/seating/src/revisions.ts#L127) |
| seating.layoutRevision | events:read | advanced_seating | [source](../../packages/modules/seating/src/revisions.ts#L231) |
| seating.restoreLayoutRevision | seating:write | advanced_seating | [source](../../packages/modules/seating/src/revisions.ts#L305) |
| seating.setRules | seating:write | seating | [source](../../packages/modules/seating/src/rules.ts#L106) |
| seating.rules | events:read | seating | [source](../../packages/modules/seating/src/rules.ts#L156) |
| seating.setFinderSettings | seating:write | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L188) |
| seating.finderSettings | events:read | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L212) |
| seating.finderPoster | attendees:read | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L249) |
| seating.publicVenueMap | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L317) |
| seating.requestFinderCode | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L343) |
| seating.verifyFinderCode | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L432) |
| seating.finderResult | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L485) |
| seating.findSeatByName | public:seat_finder | seat_finder | [source](../../packages/modules/seating/src/seat-finder.ts#L508) |
| seating.attendeeSeatLabels | attendees:read | seating | [source](../../packages/modules/seating/src/seat-labels.ts#L112) |
| seating.ticketSeatLabels | attendees:read | seating | [source](../../packages/modules/seating/src/seat-labels.ts#L129) |
| seating.solverSetup | guests:read | ai_seating | [source](../../packages/modules/seating/src/solver.ts#L135) |
| seating.solverRules | guests:read | ai_seating | [source](../../packages/modules/seating/src/solver.ts#L146) |
| seating.addSolverRule | seating:write | ai_seating | [source](../../packages/modules/seating/src/solver.ts#L178) |
| seating.updateSolverRule | seating:write | ai_seating | [source](../../packages/modules/seating/src/solver.ts#L228) |
| seating.removeSolverRule | seating:write | ai_seating | [source](../../packages/modules/seating/src/solver.ts#L257) |
| seating.acceptSeatingProposal | seating:write | ai_seating | [source](../../packages/modules/seating/src/solver.ts#L322) |
| seating.subEventCharts | events:read | seating | [source](../../packages/modules/seating/src/sub-event-charts.ts#L74) |
| seating.giveSubEventOwnChart | seating:write | seating | [source](../../packages/modules/seating/src/sub-event-charts.ts#L93) |
| seating.removeSubEventChart | seating:write | seating | [source](../../packages/modules/seating/src/sub-event-charts.ts#L160) |
| seating.planTables | events:read | seating | [source](../../packages/modules/seating/src/table-sponsors.ts#L61) |
| seating.setTableSponsor | seating:write | seating | [source](../../packages/modules/seating/src/table-sponsors.ts#L93) |
| seating.removeTableSponsor | seating:write | seating | [source](../../packages/modules/seating/src/table-sponsors.ts#L139) |
| seating.venuePortal | events:read | advanced_seating | [source](../../packages/modules/seating/src/venue-sharing.ts#L78) |
| seating.shareLayout | org:update | advanced_seating | [source](../../packages/modules/seating/src/venue-sharing.ts#L111) |
| seating.unshareLayout | org:update | advanced_seating | [source](../../packages/modules/seating/src/venue-sharing.ts#L138) |
| seating.sharedLayouts | events:read | advanced_seating | [source](../../packages/modules/seating/src/venue-sharing.ts#L200) |
| seating.useSharedLayout | seating:write | advanced_seating | [source](../../packages/modules/seating/src/venue-sharing.ts#L228) |

### Feature rules and lifecycle

#### seating (tier 3)

Floor plans and per-event seats (ADR 0012). Owns Postgres schema `seating`.

**Invariants**
- A layout document is a `@yayatoh/floorplan` v1 document in centimetres; it must parse and have no layout problems (unique ids and labels, known sections, seats inside the room, ≤ 20,000 seats).
- `seat_uuid` is stable: it is the seat's id in the document, and an event's seats are materialized from its layout once.
- An event layout moves `draft → published → locked`. It locks at the first sale; a locked layout's document and seats never change (categories and blocks of unsold seats still may), except through a revision restore (M6.11b) that keeps every held and sold seat exactly as it is.
- Seat state: `available → held` (one `UPDATE … WHERE status = 'available'` for all requested seats under a lock timeout; fewer rows than asked → the whole hold fails), `held → sold | available`, `available ⇄ blocked`, `sold → available` only when its ticket is voided. Nothing else.
- Expired holds are released by the sweeper; a hold never outlives its checkout hold.
- **Seat assignment (M1.7d):** an organizer seats an attendee in exactly one seat of a table or row (`seat_assignments`, one per attendee per event, one attendee per seat). The seat is blocked with reason `assigned`, so it is off sale; only `available` seats (and, when chosen explicitly, seats blocked for `channel` or `ada`, whose block is remembered in `prior_block`) can be assigned — never held, sold or killed ones. Unblocking never frees an `assigned` seat; deleting the assignment does (the `seat_assignment_released` trigger restores the seat's prior state, whatever deleted the row). Ticket holders who bought a seat are seated by their ticket and can't also be assigned.
- A group is seated all or nothing: if fewer seats are free than people, nothing changes (`not_enough_seats`, with how many fit). Automatic placement uses free seats in plan order, accessible seats last; a guest placed automatically may be moved within the table to make room for a chosen seat.
- Assignments follow plan edits: seats that keep their id keep their guest; guests whose seat disappeared are unseated.
- Assignments are released when the attendee stops attending: refunds and lost disputes call `releaseAttendeeSeatsTx` in their transaction; a guest taken off the list emits `attendee.cancelled@1`, handled by the `seating.release-cancelled` subscriber.
- **Seat finder (M1.7e, entitlement `seat_finder`):** nothing about the plan or who sits where is public until the organizer opens it (`event_layouts.public_map`); then the venue map shows the plan as drawn (`publicVenueMapQuery`: the document and the lookup mode only). Lookups never reveal who is on the list: `requestFinderCode` answers and works the same for any address (a `finder_codes` row, an outbox event and an audit row every time; only rows for listed addresses keep the address and a matchable code hash). The six-digit code is derived from the row id under the app secret and never stored; only its HMAC is. A code works once, for ten minutes, and locks after five wrong tries (outcomes are returned, not thrown, so the count commits). At most five codes per address per event per hour. Every lookup counts against the device's budget (30 a minute per device and event, `platform.rate_limits`); past it, the caller must pass a human check. Results carry seats and table/row labels only, never names. Instant name lookup (`finder_mode = 'name'`) is an organizer opt-in and matches exact full names only.
- **Live availability (M1.7f):** statement-level triggers on `event_seats` (and row triggers on `seating_rules` and on an event layout's status) `NOTIFY seating_seats` with `"{org}:{event}"` — sent on commit only, deduplicated per transaction, never who. The seat feed (`createSeatFeed`, one per server process, `listenForSeatChanges`) re-reads a watched event under that org's RLS, diffs it against what it last published and publishes one coalesced message per burst (at most one per event per 500 ms) through the platform `RealtimePublisher` to two org-scoped channels: `org:{o}:event:{e}:seats` (public: seat ids on/off only) and `org:{o}:event:{e}:seat-states` (staff: states and counts). Message ids are `{epoch}-{seq}`: a reconnecting client gets what it missed, or a snapshot. Only the route decides which org and event a stream carries; watching reads under that org's RLS, so another org's event is simply not there.
- **Seat states on the plan:** a guest's seat (`blocked` with reason `assigned`) is shown and counted as `assigned`, apart from `blocked` (`liveSeatState`).
- **Seating rules (M1.7f, decision D18):** at most one rule of each kind per event (`seating_rules`): `ada_reserved` keeps accessible seats back until `releaseDays` before the event starts; `max_per_order_seats` caps seats per order (checkout and box office, never guest seating). Each warns (default) or is enforced: enforced rules refuse online checkout (`seat_rule`, the holds roll back) and keep kept-back accessible seats off the public map; staff (box office, seating guests) may override on purpose, which is audited. Rules are evaluated by the pure `evaluateSeatRules`, the same in the browser and on the server.
- **Groups (M1.8f):** a block of seats can be kept for a group (an attendee label, e.g. a company): `blocked` with reason `group` and the group's name in `group_label` (a check: a `group` block always has a name). Only `available` seats join a block (plan order, accessible seats last, none while an enforced keep-back applies); "release unused seats" gives the group's still-blocked seats back to sale. A member seated in the block takes the seat (`assigned`, `prior_block = 'group'`, the label stays on the seat), so unseating them returns it to the group. Unblocking a group seat by hand frees it and clears its label.
- **Bulk seat assignment (M1.8f):** `seating.bulkAssign` (the platform bulk framework, `seating:write`, 100 per chunk) seats the selected attendees, or everyone matching the list filters, at a table/row, in a section, in the best available seats of the whole plan, or in their group's block — through the same seat statements as one-by-one assignment (so the live feed publishes each chunk). It is a partial result: people who don't fit fail `not_enough_seats`; `seated_by_ticket`, `attendee_cancelled` and `not_found` are reported per person. People already seated in the target stay put. Accessible seats kept back by `ada_reserved` are used last and each such placement is a warning (`ada_kept_back`); enforced, they are skipped unless `overrideRules` (audited). Undo (10 minutes) unseats everyone still in the seat the operation gave them and puts them back in their previous seat (pinned flag and prior block included) when it is still free; anyone moved since is left alone.
- **Per-date charts (M1.7g):** a chart is an event layout with its seats and guest seats, keyed by `occurrence_id` (`ChartKey`): null = the event plan (every date without a chart of its own, and single-date events), else the date that has its own copy. Every read and write of `event_layouts`, `event_seats` and `seat_assignments` names the chart (`onChart`); a date resolves to its chart with `chartKeyTx` (its own, else the event plan), so checkout, the box office, holds, sales, rules, guest seating, groups, bulk assignment, the live feed and the seat finder all follow the chosen date. Seat ids repeat across charts (a copy keeps them), so partial unique indexes are per chart.
  - `seating.giveDateOwnChart` copies the event plan (drawing, prices, organizer blocks, group blocks with their names; a guest's seat comes back with the block it had) and never holds, sales or guests; refused while any seat of the event plan is held or sold for that date or for an unknown date (`event_seats.held_for_occurrence_id`, set when a seat of the event plan is held for a date and cleared on release, expiry and void; a CHECK keeps it to held/sold seats of the event plan). The copy is on sale when the plan is, never locked. `seating.removeDateChart` (category `delete`: it unseats the guests on that chart) is refused once the chart is locked or while seats are held there.
  - The seat release trigger frees a guest's seat on the assignment's own chart. Seating rules and finder settings stay per event (the finder settings are read from the event plan); "days before" count from the date's start.
  - Live feed: the event plan keeps `org:{o}:event:{e}:seats`; a date's own chart publishes on `org:{o}:event:{e}:date:{d}:seats` / `…:seat-states`. A notification names the event, and every watched chart of it re-reads.
- **Floor plan image (M1.7g):** a document's `underlay` may be an organizer's image (media slot `floorplan`): `mediaId`, natural size, place and size in centimetres (the scale), `opacity`, `locked`, `showOnMap`. `validDoc(doc, orgId)` accepts only `/media/{org}/{asset}/{file}` of the org itself. Public maps (`publicDoc`) carry it only when `showOnMap`; the media route serves a `floorplan` file publicly only while `publicUnderlayShown` (a chart on sale shows it), cached 5 minutes; otherwise members only.
- **Seat labels (M1.7g):** `attendeeSeatLabelsTx` / `seating.attendeeSeatLabels` / `seating.ticketSeatLabels`: the seat bought with the ticket, else the organizer's seat on the chart of the ticket's date, with the section's name first.
- **Permission (M4.2a):** every seating write needs `seating:write` (owners, admins, managers; event-scoped for co-hosts, planners and event managers), so a planner can seat guests without `events:write` on the event itself.
- **Per-sub-event charts (M4.1c):** a wedding sub-event (guests module) may have its own drawing (`sub_event_charts`, one per sub-event): a copy of a saved floor plan or of the chart it used. `resolveSubEventChartTx` / `seating.subEventCharts`: its own chart, else the chart of its date (`chartKeyTx`: the date's own chart, else the event plan), else the event plan, else none. A drawing only (no seats, holds or sales; guests are seated on it with M4.3a). The caller passes the sub-event's id and date; a hand-written FK `(org_id, event_id, sub_event_id)` → `guests.sub_events` keeps it on a sub-event of the same event and removes it with the sub-event. `seating.giveSubEventOwnChart` / `seating.removeSubEventChart` need `seating:write`.
- **Hosted tables (M4.2b):** `table_sponsors` gives a table of the event plan (its item id, so every chart's copy) a sponsor name, an optional logo (only `/media/{org}/…` of the same org) and `published`. The console always sees it (`seating.planTables`, the editor); guests only through `publicTableSponsorsTx` — published sponsors on a plan that is on sale (published or locked), behind the finder's own `public_map` check — in the seat finder result and the venue map data.
- **Guest seating (M4.3a):** the guests module's guests (parties, plus-ones) are seated at a table or row of a chart (`guest_seats`): the event plan (`sub_event_id` null) or the chart a sub-event uses (`resolveSubEventChartTx`: its own, its date's, else the event plan), seated separately. A place is table-level: no seat of the plan is held, blocked or sold, so guest seating never changes what is on sale; on the event plan, seats sold or held to buyers, given to an attendee (M1.7d) or killed count as taken. One place per guest per chart (partial uniques); a place whose table the chart no longer has is ignored (the guest is back in the queue) and replaced when they are seated again. Hand-written FKs: `(org_id, guest_id)` → `guests.guests` and `(org_id, event_id, sub_event_id)` → `guests.sub_events`, both `ON DELETE CASCADE`.
- **Guest seat finder (M4.4a):** names leave this module only on `partySeatsQuery`, the page of a party signed in through its own link (`PartyCredentials.partyByLinkTx`, implemented by guests; seating never imports guests): its places per chart, its own guests and its tablemates (other parties' guests at the same table or row; declined guests left out; `domain/guest-finder.ts`). PIN mode (`finder_mode = 'pin'`, `findGuestSeatByPinCommand`) answers with table labels, counts and the plan only, `no_match` for every miss after the same work (`partyByNamePinTx`), behind the device budget and its `challenge`. Both need the finder open (`public_map`); only charts where the party has a place are returned.
  - Guests is the same tier, so seating reads it through the **`OccupantDirectory`** port (`setOccupantDirectory`, registered by the web app's and the test ports' composition roots; guests implements it as `guestsOccupantDirectory`). Never an import either way.
  - `seating.seatGuests` is **all or nothing** under a per-chart advisory lock: guests already at the table need no seat again; when the rest don't fit, nothing changes (`conflict` / `cant_fit` with `asked` and `fits`). Declined guests are refused (`declined`); guests not on the chart's list (not invited to the sub-event, another event's) are `unknown_guest`. Moving is seating at another table. `seating.unseatGuests` sends guests back to the queue.
  - **VIP zones** (`vip_tables`, per event and item id, every chart): marked by the host, or a table in a VIP section of the plan document. They only warn (`vip_outside`, `not_vip_inside`), never refuse.
  - The editor's DTO (`seating.guestSeating`, `guests:read`) carries names, meals and RSVP states for the console only; no private answer (P4-3). Writes need `seating:write`.
  - **Live:** every seating write publishes `seats {subEventId, itemIds}` (ids only) on `org:{o}:event:{e}:guest-seats` (`GUEST_SEATS_CHANNEL`, `guests:read`, entitlement `seating`) in its transaction; the guest list publishes on the guests module's `event.guests` channel.
- **Cards and exports (M4.3b):** pure and table-level, from the guest seating view (`guestSeatingViewTx`): `seatingSheet` orders places by their bare label in natural order ("2" before "10") and guests by party; `nameSheet` gives them the reader's names ("Table 3"). Declined guests are never printed and never counted for the caterer (the chart export lists them, flagged); coming guests without a place on the chart get a "Not seated" row so meal totals are whole. Cards: place (per seated guest), escort (per party per table), table (per place); `sheetLayout` puts them on A4, Letter, A5 or Legal inside 10 mm margins, mirrored in RTL. `cardsHtml` is self-contained (no remote assets, no scripts; names in `<bdi>`). Printing needs `guests:read` (`seating.cards`); the CSV/XLSX export is the audited command `seating.exportGuestSeating` (`attendees:export`; audit `seating.guests.export` with kind, format and row count). Nothing here holds private answers (meals only; dietary and accessibility stay sealed in guests).
- **Best available and the ADA engine (M6.11a, entitlement `advanced_seating`):** per event, the organizer offers best available and scores sections (`selection_settings`, `{ sectionId: 0–100 }`, never public), and marks companion seats (`companion_seats`, per event; only in a row or at a table with an accessible seat, never an accessible seat itself). `bestAvailable` (pure) picks the party's seats at one price: together = one table or consecutive seats of a row; ranked by section score (else distance to the stage), row, unused accessible/companion seats, companion use (wheelchair party), centre. It never splits a party when a block fits; otherwise as few pieces as possible, and the caller says so. `holdBestAvailableTx` serializes pickers per chart (`pg_advisory_xact_lock`) and claims every chosen seat or none (`FOR UPDATE SKIP LOCKED` + row count, in a savepoint; a miss excludes the seat and picks again, 5 attempts, then `seats_taken`). The hold's id is derived from a random token (`holdIdForToken`, a UUIDv4 shape; order ids are UUIDv7), held 10 minutes; checkout and the box office take it over (`adoptSeatHoldTx`), the token's holder may release it. Kept-back accessible seats and companion seats (while their rules apply) are never picked for a buyer who did not say someone needs an accessible seat (`accessibleNeed`), whatever the severity.
- **Companion rule (`ada_companion`, M6.11a):** companion seats sell only with an accessible seat in the same order, at most `maxPerAccessible` (1–3) each; checkout, the box office and best available; never the organizer seating guests. It ends with the `ada_reserved` release when that rule exists. `accessibleNeed` lifts the `ada_reserved` keep-back for that order, never the companion limit.
- **Sales channels and allotments (M6.11b, entitlement `advanced_seating`):** an event's channels (`seat_channels`: `public` = online without a code, `box_office`, `sponsor` and `promoter` = online with the channel's upper-case code; at most one public and one box office) and allotments (`channel_seats`, one channel per seat per event; every chart follows). A sale goes through exactly one channel (`resolveSaleChannelTx`; an unknown code is refused, never the public) or "no channel". **A seat in one channel is never sold through another** until the channel's `release_at`: `holdSeatsTx` checks it in the same UPDATE that takes the seat (`sellableThroughSql`; a caller that names no channel gets "no channel"), `adoptSeatHoldTx` re-checks an adopted hold, best available skips other channels' seats; refusals are `seat_channel`. An order's channel is recorded (`channel_orders`, sold at payment) and a late-paid order re-holds through it. The public map marks other channels' seats (`otherChannel`) so the live feed never re-opens them. Allotments apply with or without the module.
- **Layout revisions (M6.11b):** every save of a chart's plan is a numbered revision (`layout_revisions`, the newest 100 per chart; unchanged saves aren't repeated; removing a date's chart removes its revisions). Restoring (`restoreLayoutRevisionCommand`) keeps every held and sold seat: same id and label → kept; else a free seat with the same label in the revision takes the seat's id (remapped); else refused (`restore_conflicts`, the seats named). Pure: `diffDocs`, `planRestore`.
- **Library (M6.11b):** the org's `layouts` are its venue layout library: listed with their use (`event_layouts.source_layout_id`), renamed, removed (events keep their copy).
- **Seating rules and solver (M6.12a, P6-10; module `ai_seating`, P6-13):** the host keeps rules per event (`solver_rules`, every chart reads them): `keep_together` (each party, or everyone with a tag or side), `keep_apart` (two parties, tags or sides), `vip_near_stage`, `access_near_exit` (parties with a tag; sealed answers are never read, P4-3), `table_max`; each `hard` or `soft` with a weight 1–10; at most 50, no two saying the same thing, parties named must be on the event's list. `seating.solverSetup` gives the solver a chart (`SolverProblem`): each table's room (seats less tickets, attendee seats and guests who declined but are still seated), its centre, the stages and exits (entrances count), everyone still coming and who sits where now. The tabu search (`domain/solver.ts`) is pure and deterministic for a seed; it runs in the editor's Web Worker in steps (progress, cancel). **Manual placements are fixed inputs**: every guest already seated counts towards the rules and is never part of a proposal. A hard together group that fits a table moves as one unit; hard zones (VIP near the stage, accessibility near exits: the nearest tables whose room holds everyone concerned) restrict where its guests may go; a hard group bigger than any table is kept on as few tables as possible (never a violation); capacity is never exceeded. Nothing is stored until `seating.acceptSeatingProposal` (`seating:write`, **idempotent**: the editor sends an Idempotency-Key derived from the proposal and tables): all or nothing under the chart's lock; refused when a guest is seated elsewhere since (`already_seated`), declined, unknown, when a table can't hold them (`cant_fit`) or when the result would break a hard rule the state didn't already break (`hard_rule`, judged by the solver's own `evaluate`). It writes `guest_seats` like `seating.seatGuests` and publishes on the guest-seats channel; audited with counts only.
- **Venue sharing (M6.14b, `advanced_seating`):** a venue (this org) shares library plans with partner organizers (`layout_shares`; partners are tenancy's `venue_partner` relationships). Organizers read shared plans only through the SECURITY DEFINER `partner_shared_layouts()` / `partner_shared_layout_doc(id)`, and the venue reads its plans' uses only through `venue_layout_uses()` (plan, organizer name, event name/start/time zone/status): all bound to the caller's own `app.org_id`, re-checking the share and an active partnership on every call (revokes apply on the next request). `useSharedLayout` is copy-on-use through `applyEventLayoutTx` (the event keeps its copy and revisions; the venue's underlay is dropped) and records `shared_layout_uses` (one per event); giving the event plan one of the org's own library plans removes it.


### Source index

- [packages/modules/seating/src/alert-facts.ts](../../packages/modules/seating/src/alert-facts.ts)
- [packages/modules/seating/src/assignments.ts](../../packages/modules/seating/src/assignments.ts)
- [packages/modules/seating/src/best-available.ts](../../packages/modules/seating/src/best-available.ts)
- [packages/modules/seating/src/bulk-assign.ts](../../packages/modules/seating/src/bulk-assign.ts)
- [packages/modules/seating/src/cards-document.ts](../../packages/modules/seating/src/cards-document.ts)
- [packages/modules/seating/src/cards.ts](../../packages/modules/seating/src/cards.ts)
- [packages/modules/seating/src/channels.ts](../../packages/modules/seating/src/channels.ts)
- [packages/modules/seating/src/chart.ts](../../packages/modules/seating/src/chart.ts)
- [packages/modules/seating/src/client.ts](../../packages/modules/seating/src/client.ts)
- [packages/modules/seating/src/copy.ts](../../packages/modules/seating/src/copy.ts)
- [packages/modules/seating/src/data-subject.ts](../../packages/modules/seating/src/data-subject.ts)
- [packages/modules/seating/src/domain/assign.ts](../../packages/modules/seating/src/domain/assign.ts)
- [packages/modules/seating/src/domain/best-available.ts](../../packages/modules/seating/src/domain/best-available.ts)
- [packages/modules/seating/src/domain/bulk-assign.ts](../../packages/modules/seating/src/domain/bulk-assign.ts)
- [packages/modules/seating/src/domain/cards.ts](../../packages/modules/seating/src/domain/cards.ts)
- [packages/modules/seating/src/domain/channels.ts](../../packages/modules/seating/src/domain/channels.ts)
- [packages/modules/seating/src/domain/guest-finder.ts](../../packages/modules/seating/src/domain/guest-finder.ts)
- [packages/modules/seating/src/domain/guest-seating.ts](../../packages/modules/seating/src/domain/guest-seating.ts)
- [packages/modules/seating/src/domain/live.ts](../../packages/modules/seating/src/domain/live.ts)
- [packages/modules/seating/src/domain/revisions.ts](../../packages/modules/seating/src/domain/revisions.ts)
- [packages/modules/seating/src/domain/rules.ts](../../packages/modules/seating/src/domain/rules.ts)
- [packages/modules/seating/src/domain/seat-state.ts](../../packages/modules/seating/src/domain/seat-state.ts)
- [packages/modules/seating/src/domain/solver-rules.ts](../../packages/modules/seating/src/domain/solver-rules.ts)
- [packages/modules/seating/src/domain/solver.ts](../../packages/modules/seating/src/domain/solver.ts)
- [packages/modules/seating/src/groups.ts](../../packages/modules/seating/src/groups.ts)
- [packages/modules/seating/src/guest-day-of.ts](../../packages/modules/seating/src/guest-day-of.ts)
- [packages/modules/seating/src/guest-finder.ts](../../packages/modules/seating/src/guest-finder.ts)
- [packages/modules/seating/src/guest-seating.ts](../../packages/modules/seating/src/guest-seating.ts)
- [packages/modules/seating/src/holds.ts](../../packages/modules/seating/src/holds.ts)
- [packages/modules/seating/src/index.ts](../../packages/modules/seating/src/index.ts)
- [packages/modules/seating/src/layouts.ts](../../packages/modules/seating/src/layouts.ts)
- [packages/modules/seating/src/library.ts](../../packages/modules/seating/src/library.ts)
- [packages/modules/seating/src/live.ts](../../packages/modules/seating/src/live.ts)
- [packages/modules/seating/src/participation.ts](../../packages/modules/seating/src/participation.ts)
- [packages/modules/seating/src/party-seats.ts](../../packages/modules/seating/src/party-seats.ts)
- [packages/modules/seating/src/private-columns.ts](../../packages/modules/seating/src/private-columns.ts)
- [packages/modules/seating/src/revisions.ts](../../packages/modules/seating/src/revisions.ts)
- [packages/modules/seating/src/rules.ts](../../packages/modules/seating/src/rules.ts)
- [packages/modules/seating/src/schema.ts](../../packages/modules/seating/src/schema.ts)
- [packages/modules/seating/src/seat-finder.ts](../../packages/modules/seating/src/seat-finder.ts)
- [packages/modules/seating/src/seat-labels.ts](../../packages/modules/seating/src/seat-labels.ts)
- [packages/modules/seating/src/solver.ts](../../packages/modules/seating/src/solver.ts)
- [packages/modules/seating/src/sub-event-charts.ts](../../packages/modules/seating/src/sub-event-charts.ts)
- [packages/modules/seating/src/table-sponsors.ts](../../packages/modules/seating/src/table-sponsors.ts)
- [packages/modules/seating/src/testing.ts](../../packages/modules/seating/src/testing.ts)
- [packages/modules/seating/src/venue-sharing.ts](../../packages/modules/seating/src/venue-sharing.ts)

## sso

Tier 6; 16 source files; 3 test files.

Declared connections: @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/tenancy.

Source imports: @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/ssrf, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: membership.added, oauthbearertoken, system, work.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| sso.saveConnection | sso:manage | enterprise | [source](../../packages/modules/sso/src/connections.ts#L187) |
| sso.recordConnectionTest | sso:manage | enterprise | [source](../../packages/modules/sso/src/connections.ts#L266) |
| sso.setConnectionStatus | sso:manage | enterprise | [source](../../packages/modules/sso/src/connections.ts#L306) |
| sso.deleteConnection | sso:manage | enterprise | [source](../../packages/modules/sso/src/connections.ts#L344) |
| sso.settings | sso:manage | enterprise | [source](../../packages/modules/sso/src/connections.ts#L406) |
| sso.addDomain | sso:manage | enterprise | [source](../../packages/modules/sso/src/domains.ts#L30) |
| sso.checkDomain | sso:manage | enterprise | [source](../../packages/modules/sso/src/domains.ts#L74) |
| sso.removeDomain | sso:manage | enterprise | [source](../../packages/modules/sso/src/domains.ts#L137) |
| sso.setDomainEnforcement | sso:manage | enterprise | [source](../../packages/modules/sso/src/domains.ts#L163) |
| sso.completeLogin | platform:sso.login | enterprise | [source](../../packages/modules/sso/src/login.ts#L94) |
| sso.createScimToken | sso:manage | enterprise | [source](../../packages/modules/sso/src/scim.ts#L43) |
| sso.revokeScimToken | sso:manage | enterprise | [source](../../packages/modules/sso/src/scim.ts#L76) |
| sso.scimCreateUser | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L258) |
| sso.scimUpdateUser | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L302) |
| sso.scimDeleteUser | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L353) |
| sso.scimUserFields | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L374) |
| sso.scimGetUser | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L395) |
| sso.scimListUsers | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L413) |
| sso.scimCreateGroup | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L532) |
| sso.scimUpdateGroup | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L566) |
| sso.scimDeleteGroup | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L598) |
| sso.scimGroupFields | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L614) |
| sso.scimGetGroup | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L630) |
| sso.scimListGroups | dynamic or not captured | null or not captured | [source](../../packages/modules/sso/src/scim.ts#L641) |
| sso.setGroupRole | sso:manage | enterprise | [source](../../packages/modules/sso/src/scim.ts#L681) |

### Feature rules and lifecycle

#### sso (tier 6)

Single sign-on and SCIM provisioning per org (M6.5a, decision P6-5), behind the `enterprise` module
key (P6-13). Owns Postgres schema `sso`: `connections`, `domains`, `identities`, `scim_tokens`,
`scim_users`, `scim_groups` and `scim_group_members`. The identity side (global accounts, sessions)
is in `packages/auth/src/sso.ts`; memberships are written through tenancy's
`ensureManagedMembershipTx` / `removeManagedMembershipTx` (down the tiers).

**Invariants**
- **One connection per org**, SAML 2.0 or OpenID Connect, behind the `IdentityProviderPort`
  (`src/ports.ts`). Dev/CI/previews use the recorded fake IdP (`src/fake.ts`: HMAC-signed answers
  per org and connection; issuer, audience, request (InResponseTo/nonce) and expiry checked);
  production has no adapter until the owner's IdP test tenant exists (owner inbox), and SSO then
  reads as unavailable. An OIDC client secret is sealed with the org's key vault and never read
  back to a page. A connection signs people in only when `active`, which needs a passed test
  sign-in with its current settings and a verified domain; changing the IdP settings of an active
  connection puts it back to `draft`.
- **Domains** are verified with a DNS TXT record (`yayatoh-verification=<token>` at
  `_yayatoh-sso.<domain>`) through the `TxtResolver` port (fake resolver in dev/CI). One org can
  have a domain verified platform-wide (a deliberately global partial unique index); a loser gets
  `claimed_elsewhere`. **An SSO sign-in or a SCIM user may only name an address in a verified
  domain of that org**: an IdP never vouches for anyone else's address.
- **Enforcement** (a verified domain + an active connection): members with an address in the
  domain open this org's console only with a session from its IdP. Owners are exempt
  (break-glass). Disabling or deleting the connection ends enforcement.
- **Sessions from SSO are bound to their org** (`auth.sessions.sso_org_id`): they open that org's
  console only. The org comes from the pending sign-in started for it (from the email's verified
  domain), never from a header. People with two-step verification and every platform staff member
  answer their authenticator code after the IdP (D14); staff without it are refused.
- **Identity links** (`identities`): one IdP subject ↔ one account per connection; a different
  pairing is refused (`identity_conflict`).
- **Just-in-time provisioning** (`connections.jit`): a first sign-in makes the person a member with
  the role their SCIM groups map (strongest wins), else the connection's default role. SSO and SCIM
  never make anyone an owner and never change or demote an owner.
- **SCIM 2.0** at `/api/scim/v2` (Users, Groups, ServiceProviderConfig, ResourceTypes): bearer token
  `yy_scim_…` (SHA-256 at rest, shown once, one live token per org, creating a new one rotates),
  resolved through `sso.scim_token_by_hash` (the org comes from the token). Commands run as the
  system actor `scim:<token id>` (`platform:sso.scim`). Deactivating or deleting a SCIM user
  removes the membership and ends every session and /v1 refresh token of the person at once
  (no cached access: sessions are read from the database on every request). The org's last owner
  is never removed (409).
- **Group → role mapping** is set in the console (`setGroupRoleCommand`, step-up), never by the IdP.
  A member in no mapped group keeps the role they have.
- Settings changes that decide who can sign in (connection, status, enforcement, domain removal,
  SCIM token, group roles) are step-up commands with `sso:manage` (owners and admins).

**Public surface:** `.` (commands, queries, ports, fakes, SCIM helpers).


### Source index

- [packages/modules/sso/src/config.ts](../../packages/modules/sso/src/config.ts)
- [packages/modules/sso/src/connections.ts](../../packages/modules/sso/src/connections.ts)
- [packages/modules/sso/src/data-subject.ts](../../packages/modules/sso/src/data-subject.ts)
- [packages/modules/sso/src/domain/config.ts](../../packages/modules/sso/src/domain/config.ts)
- [packages/modules/sso/src/domain/domains.ts](../../packages/modules/sso/src/domain/domains.ts)
- [packages/modules/sso/src/domain/roles.ts](../../packages/modules/sso/src/domain/roles.ts)
- [packages/modules/sso/src/domain/scim.ts](../../packages/modules/sso/src/domain/scim.ts)
- [packages/modules/sso/src/domains.ts](../../packages/modules/sso/src/domains.ts)
- [packages/modules/sso/src/fake.ts](../../packages/modules/sso/src/fake.ts)
- [packages/modules/sso/src/fixtures.ts](../../packages/modules/sso/src/fixtures.ts)
- [packages/modules/sso/src/index.ts](../../packages/modules/sso/src/index.ts)
- [packages/modules/sso/src/login.ts](../../packages/modules/sso/src/login.ts)
- [packages/modules/sso/src/ports.ts](../../packages/modules/sso/src/ports.ts)
- [packages/modules/sso/src/private-columns.ts](../../packages/modules/sso/src/private-columns.ts)
- [packages/modules/sso/src/schema.ts](../../packages/modules/sso/src/schema.ts)
- [packages/modules/sso/src/scim.ts](../../packages/modules/sso/src/scim.ts)

## surveys

Tier 5; 11 source files; 2 test files.

Declared connections: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/tenancy.

Source imports: @yayatoh/attendees, @yayatoh/checkin, @yayatoh/crm, @yayatoh/csv, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/notifications, @yayatoh/platform, @yayatoh/program, @yayatoh/tenancy.

Tables detected: see schema source.

Event type literals detected: survey.responded, survey.sent, system.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| surveys.feedbackPrompt | public:survey | messaging | [source](../../packages/modules/surveys/src/prompt.ts#L78) |
| surveys.openFeedback | public:survey | messaging | [source](../../packages/modules/surveys/src/prompt.ts#L100) |
| surveys.createSurvey | messages:send | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L100) |
| surveys.updateSurvey | messages:send | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L148) |
| surveys.saveQuestions | messages:send | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L169) |
| surveys.setClosed | messages:send | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L192) |
| surveys.sendSurvey | messages:send | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L332) |
| surveys.sendSurveyStep | messages:send | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L461) |
| surveys.submitResponse | public:survey | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L608) |
| surveys.listSurveys | messages:read | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L750) |
| surveys.targets | messages:read | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L790) |
| surveys.getSurvey | messages:read | messaging | [source](../../packages/modules/surveys/src/surveys.ts#L849) |

### Feature rules and lifecycle

#### surveys (tier 5)

Post-event surveys and session feedback (M3.9a). Owns Postgres schema `surveys`. Questions live in
the forms engine (form kind `survey`, subject `survey` + the survey id): versioned there, answers
validated there, stored in `forms.form_responses` (respondent `survey_invitation`).

**Invariants**
- One post-event survey per event and one feedback survey per program session (partial unique
  indexes). Composite FKs to `events.events`, `program.sessions` and `attendees.attendees` (lower
  tiers) are hand-written in the migration.
- Surveys go out only once their event (or session) has ended, to the event's active attendees or
  only those with a live admission, one invitation per **person** (`contact_id`) per survey.
  Sending again reaches only people not yet invited. `messaging` pause (M1.3e) blocks sending.
- A survey link is `<invitationId>~<hmac>` (purpose `surveys.invitation`); nothing secret is stored.
  The org comes from the signed invitation id via `surveys.invitation_org()` (SECURITY DEFINER,
  ids only), never from the request.
- **One response per person:** the invitation row is locked while answering, and
  `surveys.responses` is unique per (survey, contact) and per invitation; a second attempt is
  `conflict` / `already_answered`. Links expire (`expires_at`, 1–90 days) and stop when the survey
  is closed.
- Emails go through the notifications dispatcher as `surveys.invite` / `surveys.reminder`
  (category `event_updates`: preferences, unsubscribe, quiet hours and the pause apply). Dedupe keys
  `survey-invite:{invitationId}` / `survey-reminder:{invitationId}`. A reminder is queued for its
  time; answering cancels it (`answered`), closing the survey cancels the rest (`survey_closed`).
- Reports (NPS, response rate, per-question summaries) need `messages:read`; building and sending
  need `messages:send`; the CSV export (names and emails) needs `attendees:export` and a recent
  step-up, like every export.
- `sendSurveyStepTx` is the journey step "After event → Survey" (M3.7a): it never throws for a
  missing/closed survey or an already-invited person, it reports why it skipped.
- **Session-end prompt (M5.7b).** `feedbackPromptQuery` / `openFeedbackCommand` (`public:survey`):
  once a session feedback survey can be answered (open, with questions, its session over, the
  event published and public), the signed-in attendee (the actor must be the `account`; contact by
  account link, else email; an active attendee) gets their invitation: the existing one, or a new
  one recorded as a `prompt` send without an email. Answered → `conflict` / `already_answered`;
  an expired emailed link → `invalid_state` / `expired`. `survey.responded@1` carries `contactId`
  and `sessionId` (engagement scores).


### Source index

- [packages/modules/surveys/src/contact-merge.ts](../../packages/modules/surveys/src/contact-merge.ts)
- [packages/modules/surveys/src/data-subject.ts](../../packages/modules/surveys/src/data-subject.ts)
- [packages/modules/surveys/src/domain/report.ts](../../packages/modules/surveys/src/domain/report.ts)
- [packages/modules/surveys/src/export.ts](../../packages/modules/surveys/src/export.ts)
- [packages/modules/surveys/src/index.ts](../../packages/modules/surveys/src/index.ts)
- [packages/modules/surveys/src/private-columns.ts](../../packages/modules/surveys/src/private-columns.ts)
- [packages/modules/surveys/src/prompt.ts](../../packages/modules/surveys/src/prompt.ts)
- [packages/modules/surveys/src/schema.ts](../../packages/modules/surveys/src/schema.ts)
- [packages/modules/surveys/src/surveys.ts](../../packages/modules/surveys/src/surveys.ts)
- [packages/modules/surveys/src/timeline.ts](../../packages/modules/surveys/src/timeline.ts)
- [packages/modules/surveys/src/ui.ts](../../packages/modules/surveys/src/ui.ts)

## templates

Tier 5; 8 source files; 0 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ticketing.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/forms, @yayatoh/kernel, @yayatoh/platform, @yayatoh/seating, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: event.created.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| templates.createTemplate | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L133) |
| templates.updateTemplate | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L157) |
| templates.addTicketType | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L197) |
| templates.removeTicketType | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L242) |
| templates.addSection | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L262) |
| templates.removeSection | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L286) |
| templates.moveSection | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L302) |
| templates.addChecklistItem | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L321) |
| templates.removeChecklistItem | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L336) |
| templates.duplicateTemplate | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L352) |
| templates.setArchived | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L375) |
| templates.copyStarter | events:write | core | [source](../../packages/modules/templates/src/builder.ts#L401) |
| templates.getTemplate | events:read | core | [source](../../packages/modules/templates/src/builder.ts#L461) |
| templates.duplicateEvent | events:write | core | [source](../../packages/modules/templates/src/templates.ts#L111) |
| templates.saveTemplate | events:write | core | [source](../../packages/modules/templates/src/templates.ts#L180) |
| templates.createFromTemplate | events:write | core | [source](../../packages/modules/templates/src/templates.ts#L221) |
| templates.deleteTemplate | events:write | core | [source](../../packages/modules/templates/src/templates.ts#L249) |
| templates.listTemplates | events:read | core | [source](../../packages/modules/templates/src/templates.ts#L268) |

### Feature rules and lifecycle

#### templates (tier 5)

Event templates and "duplicate event" (M1.4b). Owns Postgres schema `templates`.

**Invariants**
- A copy (duplicate, or an event created from a template) is a new **draft** event with a new slug. It takes the event settings, the live ticket types (nothing sold, valid for every date), the checkout questions and the seating plan document (seat categories remapped, organizer blocks kept, not on sale). It **never** copies orders, tickets, attendees, check-ins, payouts, holds, guest seat assignments, dates (occurrences) or promo codes.
- Instants in a snapshot are stored relative to the event's start and re-anchored on the copy's start; access days as day offsets.
- Templates are org-owned (RLS) and named uniquely per org; the snapshot is versioned (`version: 1`).
- Writes compose the lower tiers inside one tenant transaction (`events`, `ticketing`, `forms`, `seating` copy helpers); this module never touches their schemas.


### Source index

- [packages/modules/templates/src/builder.ts](../../packages/modules/templates/src/builder.ts)
- [packages/modules/templates/src/copy.ts](../../packages/modules/templates/src/copy.ts)
- [packages/modules/templates/src/index.ts](../../packages/modules/templates/src/index.ts)
- [packages/modules/templates/src/private-columns.ts](../../packages/modules/templates/src/private-columns.ts)
- [packages/modules/templates/src/schema.ts](../../packages/modules/templates/src/schema.ts)
- [packages/modules/templates/src/starters.ts](../../packages/modules/templates/src/starters.ts)
- [packages/modules/templates/src/templates.ts](../../packages/modules/templates/src/templates.ts)
- [packages/modules/templates/src/testing.ts](../../packages/modules/templates/src/testing.ts)

## tenancy

Tier 1; 36 source files; 8 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: domain.activated, domain.added, domain.primary_changed, domain.removed, invitation.created, membership.added, org.suspension_changed, organization.created, organization.updated, system, tenancy.agency_grant_changed, tenancy.agency_grant_created, tenancy.agency_grant_revoked.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| tenancy.listAgencyStaffGrants | members:read | core | [source](../../packages/modules/tenancy/src/commands/agency-staff.ts#L193) |
| tenancy.revokeAgencyStaffGrant | members:manage | core | [source](../../packages/modules/tenancy/src/commands/agency-staff.ts#L203) |
| tenancy.grantAgencyAccess | members:manage | core | [source](../../packages/modules/tenancy/src/commands/agency.ts#L76) |
| tenancy.updateAgencyGrant | members:manage | core | [source](../../packages/modules/tenancy/src/commands/agency.ts#L141) |
| tenancy.revokeAgencyGrant | members:manage | core | [source](../../packages/modules/tenancy/src/commands/agency.ts#L218) |
| tenancy.listAgencyGrants | members:read | core | [source](../../packages/modules/tenancy/src/commands/agency.ts#L241) |
| tenancy.apiUsage | api_keys:manage | core | [source](../../packages/modules/tenancy/src/commands/api-key-usage.ts#L67) |
| tenancy.summarizeApiKeyUsage | platform:api_usage.summarize | null or not captured | [source](../../packages/modules/tenancy/src/commands/api-key-usage.ts#L134) |
| tenancy.createApiKey | api_keys:manage | api_access | [source](../../packages/modules/tenancy/src/commands/api-keys.ts#L85) |
| tenancy.rotateApiKey | api_keys:manage | api_access | [source](../../packages/modules/tenancy/src/commands/api-keys.ts#L153) |
| tenancy.revokeApiKey | api_keys:manage | core | [source](../../packages/modules/tenancy/src/commands/api-keys.ts#L207) |
| tenancy.listApiKeys | api_keys:manage | core | [source](../../packages/modules/tenancy/src/commands/api-keys.ts#L234) |
| tenancy.listDomains | org:read | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L81) |
| tenancy.ensureManagedDomain | org:update | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L94) |
| tenancy.addDomain | org:update | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L112) |
| tenancy.recordDomainCheck | org:update | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L177) |
| tenancy.recordDomainWallets | org:update | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L255) |
| tenancy.setPrimaryDomain | org:update | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L276) |
| tenancy.removeDomain | org:update | core | [source](../../packages/modules/tenancy/src/commands/domains.ts#L311) |
| tenancy.startImpersonation | platform:impersonate | null or not captured | [source](../../packages/modules/tenancy/src/commands/impersonation.ts#L28) |
| tenancy.endImpersonation | platform:impersonate | null or not captured | [source](../../packages/modules/tenancy/src/commands/impersonation.ts#L79) |
| tenancy.inviteMember | members:manage | core | [source](../../packages/modules/tenancy/src/commands/invitations.ts#L138) |
| tenancy.revokeInvitation | members:manage | core | [source](../../packages/modules/tenancy/src/commands/invitations.ts#L193) |
| tenancy.acceptInvitation | invitation:accept | null or not captured | [source](../../packages/modules/tenancy/src/commands/invitations.ts#L240) |
| tenancy.addMember | members:manage | core | [source](../../packages/modules/tenancy/src/commands/members.ts#L33) |
| tenancy.changeMemberRole | members:manage | core | [source](../../packages/modules/tenancy/src/commands/members.ts#L72) |
| tenancy.removeMember | members:manage | core | [source](../../packages/modules/tenancy/src/commands/members.ts#L111) |
| tenancy.onboarding | org:read | null or not captured | [source](../../packages/modules/tenancy/src/commands/onboarding.ts#L130) |
| tenancy.completeOnboarding | org:update | null or not captured | [source](../../packages/modules/tenancy/src/commands/onboarding.ts#L145) |
| tenancy.setOrgStatus | platform:org.status | null or not captured | [source](../../packages/modules/tenancy/src/commands/org-status.ts#L39) |
| tenancy.restoreOrg | platform:org.restore | null or not captured | [source](../../packages/modules/tenancy/src/commands/org-status.ts#L114) |
| tenancy.orgStatusHistory | platform:org.status | null or not captured | [source](../../packages/modules/tenancy/src/commands/org-status.ts#L195) |
| tenancy.signUpOrganization | platform:org.create | null or not captured | [source](../../packages/modules/tenancy/src/commands/organizations.ts#L132) |
| tenancy.createOrganization | platform:org.create | core | [source](../../packages/modules/tenancy/src/commands/organizations.ts#L186) |
| tenancy.updateOrganization | org:update | core | [source](../../packages/modules/tenancy/src/commands/organizations.ts#L205) |
| tenancy.createSandbox | sandbox:manage | api_access | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L68) |
| tenancy.provisionSandboxOrg | platform:sandbox.provision | null or not captured | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L129) |
| tenancy.discardSandboxLink | platform:sandbox.provision | null or not captured | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L188) |
| tenancy.listSandboxes | sandbox:manage | core | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L259) |
| tenancy.deleteSandbox | sandbox:manage | core | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L276) |
| tenancy.retireSandboxOrg | platform:sandbox.retire | null or not captured | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L310) |
| tenancy.restoreSandboxLink | platform:sandbox.retire | null or not captured | [source](../../packages/modules/tenancy/src/commands/sandbox.ts#L371) |
| tenancy.setLegalPage | org:update | core | [source](../../packages/modules/tenancy/src/commands/settings.ts#L25) |
| tenancy.legalPages | org:read | core | [source](../../packages/modules/tenancy/src/commands/settings.ts#L59) |
| tenancy.agreements | org:read | core | [source](../../packages/modules/tenancy/src/commands/settings.ts#L137) |
| tenancy.acceptAgreement | members:manage | core | [source](../../packages/modules/tenancy/src/commands/settings.ts#L162) |
| tenancy.setSuspension | platform:org.suspend | null or not captured | [source](../../packages/modules/tenancy/src/commands/suspensions.ts#L87) |
| tenancy.suspensions | org:read | null or not captured | [source](../../packages/modules/tenancy/src/commands/suspensions.ts#L136) |
| tenancy.suspensionHistory | platform:org.suspend | null or not captured | [source](../../packages/modules/tenancy/src/commands/suspensions.ts#L152) |
| tenancy.venuePartners | events:read | advanced_seating | [source](../../packages/modules/tenancy/src/commands/venue-partners.ts#L49) |
| tenancy.addVenuePartner | org:update | advanced_seating | [source](../../packages/modules/tenancy/src/commands/venue-partners.ts#L60) |
| tenancy.removeVenuePartner | org:update | advanced_seating | [source](../../packages/modules/tenancy/src/commands/venue-partners.ts#L93) |
| tenancy.getOrganization | org:read | core | [source](../../packages/modules/tenancy/src/queries.ts#L16) |
| tenancy.listMembers | members:read | core | [source](../../packages/modules/tenancy/src/queries.ts#L32) |
| tenancy.listInvitations | members:read | core | [source](../../packages/modules/tenancy/src/queries.ts#L41) |

### Feature rules and lifecycle

#### tenancy (tier 1)

Organizations and memberships. Owns Postgres schema `tenancy`.

**Invariants**
- `organizations.org_id = organizations.id` (CHECK). An org row is visible only inside its own tenant context.
- An org always has at least one `owner` membership; the last owner cannot be removed or demoted.
- Slugs are global and immutable once an event is published on them (enforced from M1.4).
- Cross-org reads (slug → id, "my orgs") go only through the SECURITY DEFINER functions
  `tenancy.resolve_org_slug(slug)` and `tenancy.user_memberships(user_id)`, which return allowlisted columns.
- Owner, admin and finance (`TWO_FACTOR_ROLES`) must use two-step verification; `twoFactorRequiredBy(userId)` lists the memberships that require it (M1.2c). The console refuses them until it is on.
- Org status (M1.3f): only platform actors change it (`tenancy.setOrgStatus`); `terminated` is final from the console. Every status change is recorded in `org_status_changes` and emitted as `org.status_changed@1`. `orgStatusGate` (the command pipeline's org gate) makes suspended orgs read-only for members, API keys and the public, and terminated orgs read-only except personal actions and owners' exports.
- Signup (M3.11a): without a code only while the platform switch `open_signup` is on, read inside the signup transaction through `platform.flag_enabled` (app_user never touches `platform.flags`); self-serve orgs start `limited`. A `limited` org can't start guest bulk messaging (`assertNotPausedTx(tx, 'pause_messaging')` → `org_limited`) and becomes `active` only through `tenancy.completeOnboarding` once the required steps are done.
- Onboarding progress (`org_onboarding`, M3.11a) is written only by `markOnboardingStepTx`, inside the transaction of the command that did the step (other modules call it down the tiers); a step's first time is kept.
- Domain changes (add, primary, remove), invitations, role grants/changes/removals and API key creation/revocation are step-up commands (`stepUp: true`).
- **Event teams (M4.2a, P4-8):** `EVENT_ROLE_PERMISSIONS` lists what each event role adds for one event (exact permissions or `module:*` wildcards); `eventRoleCan` never grants `platform:`, `payouts:`, `billing:`, `members:`, `api_keys:`, `audit:`, `privacy:` or `org:` permissions. The `collaborator` org role (only `org:read`) is given only by accepting an event invitation (`invitations.event_id` + `event_role`, same token rules); `GRANTABLE_ORG_ROLES` leaves it out. `EVENT_ROLE_SECTIONS` lists the console sections a team role opens.

- **Agency grants (M6.7a, P6-8):** `org_access_grants` is owned by the client; one live grant per agency, a role ceiling (`AGENCY_GRANT_ROLES`) and the explicit `finance` opt-in. A user reaches a client only through a live grant read on every check (`tenancy.agency_access()`, org and user from the transaction) that matches `ctx.viaAgency`; the agency console roles (`AGENCY_ROLE_PERMISSIONS`) never carry `AGENCY_NEVER` permissions. Granting and changing are step-up commands; revoking is not. Money tables (`MONEY_TABLES`) carry a RESTRICTIVE policy (`tenancy.money_access_allowed()`) that refuses their rows to a transaction acting through a grant without `finance`.

**Public surface:** `.` (commands, queries, authorizer, DTOs), `./testing` (fixtures).
- **Venue partners (M6.14b):** a venue adds partner organizers by slug (`venue_partner` in `org_relationships`, parent = venue); removing sets `detached_at`. Names reach the venue only through `tenancy.venue_partners()` (slug and name).


### Source index

- [packages/modules/tenancy/src/authorizer.ts](../../packages/modules/tenancy/src/authorizer.ts)
- [packages/modules/tenancy/src/commands/agency-staff.ts](../../packages/modules/tenancy/src/commands/agency-staff.ts)
- [packages/modules/tenancy/src/commands/agency.ts](../../packages/modules/tenancy/src/commands/agency.ts)
- [packages/modules/tenancy/src/commands/api-key-usage.ts](../../packages/modules/tenancy/src/commands/api-key-usage.ts)
- [packages/modules/tenancy/src/commands/api-keys.ts](../../packages/modules/tenancy/src/commands/api-keys.ts)
- [packages/modules/tenancy/src/commands/brand.ts](../../packages/modules/tenancy/src/commands/brand.ts)
- [packages/modules/tenancy/src/commands/domains.ts](../../packages/modules/tenancy/src/commands/domains.ts)
- [packages/modules/tenancy/src/commands/impersonation.ts](../../packages/modules/tenancy/src/commands/impersonation.ts)
- [packages/modules/tenancy/src/commands/invitations.ts](../../packages/modules/tenancy/src/commands/invitations.ts)
- [packages/modules/tenancy/src/commands/managed-members.ts](../../packages/modules/tenancy/src/commands/managed-members.ts)
- [packages/modules/tenancy/src/commands/members.ts](../../packages/modules/tenancy/src/commands/members.ts)
- [packages/modules/tenancy/src/commands/onboarding.ts](../../packages/modules/tenancy/src/commands/onboarding.ts)
- [packages/modules/tenancy/src/commands/org-status.ts](../../packages/modules/tenancy/src/commands/org-status.ts)
- [packages/modules/tenancy/src/commands/organizations.ts](../../packages/modules/tenancy/src/commands/organizations.ts)
- [packages/modules/tenancy/src/commands/sandbox.ts](../../packages/modules/tenancy/src/commands/sandbox.ts)
- [packages/modules/tenancy/src/commands/settings.ts](../../packages/modules/tenancy/src/commands/settings.ts)
- [packages/modules/tenancy/src/commands/suspensions.ts](../../packages/modules/tenancy/src/commands/suspensions.ts)
- [packages/modules/tenancy/src/commands/venue-partners.ts](../../packages/modules/tenancy/src/commands/venue-partners.ts)
- [packages/modules/tenancy/src/data-subject.ts](../../packages/modules/tenancy/src/data-subject.ts)
- [packages/modules/tenancy/src/domain/agreements.ts](../../packages/modules/tenancy/src/domain/agreements.ts)
- [packages/modules/tenancy/src/domain/invitation-token.ts](../../packages/modules/tenancy/src/domain/invitation-token.ts)
- [packages/modules/tenancy/src/domain/onboarding.ts](../../packages/modules/tenancy/src/domain/onboarding.ts)
- [packages/modules/tenancy/src/domain/org-status.ts](../../packages/modules/tenancy/src/domain/org-status.ts)
- [packages/modules/tenancy/src/domain/permissions.ts](../../packages/modules/tenancy/src/domain/permissions.ts)
- [packages/modules/tenancy/src/dsar.ts](../../packages/modules/tenancy/src/dsar.ts)
- [packages/modules/tenancy/src/dto.ts](../../packages/modules/tenancy/src/dto.ts)
- [packages/modules/tenancy/src/hosting/hostnames.ts](../../packages/modules/tenancy/src/hosting/hostnames.ts)
- [packages/modules/tenancy/src/hosting/provider.ts](../../packages/modules/tenancy/src/hosting/provider.ts)
- [packages/modules/tenancy/src/hosting/recheck.ts](../../packages/modules/tenancy/src/hosting/recheck.ts)
- [packages/modules/tenancy/src/hosting/self-hosted.ts](../../packages/modules/tenancy/src/hosting/self-hosted.ts)
- [packages/modules/tenancy/src/index.ts](../../packages/modules/tenancy/src/index.ts)
- [packages/modules/tenancy/src/private-columns.ts](../../packages/modules/tenancy/src/private-columns.ts)
- [packages/modules/tenancy/src/queries.ts](../../packages/modules/tenancy/src/queries.ts)
- [packages/modules/tenancy/src/schema.ts](../../packages/modules/tenancy/src/schema.ts)
- [packages/modules/tenancy/src/subscribers.ts](../../packages/modules/tenancy/src/subscribers.ts)
- [packages/modules/tenancy/src/testing.ts](../../packages/modules/tenancy/src/testing.ts)

## ticketing

Tier 3; 37 source files; 1 test files.

Declared connections: @yayatoh/attendees, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ticket-crypto.

Source imports: @yayatoh/attendees, @yayatoh/billing, @yayatoh/contracts, @yayatoh/crm, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/ticket-crypto.

Tables detected: see schema source.

Event type literals detected: system, ticket.claim_link_created, ticket.claimed, ticket.holder_link_created, ticket.resend_requested, ticket.transfer_cancelled, ticket.transfer_offered, ticket.transferred, ticket_type.archived, ticket_type.created, ticket_type.updated.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| ticketing.createTicketType | events:write | ticketing | [source](../../packages/modules/ticketing/src/commands/ticket-types.ts#L80) |
| ticketing.updateTicketType | events:write | ticketing | [source](../../packages/modules/ticketing/src/commands/ticket-types.ts#L139) |
| ticketing.archiveTicketType | events:write | ticketing | [source](../../packages/modules/ticketing/src/commands/ticket-types.ts#L154) |
| ticketing.sellsPaidTickets | events:read | ticketing | [source](../../packages/modules/ticketing/src/commands/ticket-types.ts#L196) |
| ticketing.listTicketTypes | events:read | ticketing | [source](../../packages/modules/ticketing/src/commands/ticket-types.ts#L217) |
| ticketing.createCoupon | events:write | ticketing | [source](../../packages/modules/ticketing/src/coupons.ts#L226) |
| ticketing.setCouponActive | events:write | ticketing | [source](../../packages/modules/ticketing/src/coupons.ts#L269) |
| ticketing.listCoupons | events:read | ticketing | [source](../../packages/modules/ticketing/src/coupons.ts#L291) |
| ticketing.createClaimLinks | attendees:write | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L114) |
| ticketing.revokeClaimLink | attendees:write | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L148) |
| ticketing.listClaimLinks | attendees:read | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L190) |
| ticketing.claimDetails | public:claim | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L228) |
| ticketing.claimTicket | public:claim | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L311) |
| ticketing.requestHolderLink | public:holder | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L359) |
| ticketing.holderTickets | public:holder | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L433) |
| ticketing.giveTicket | public:holder | ticketing | [source](../../packages/modules/ticketing/src/distribution.ts#L514) |
| ticketing.ticketSummaries | events:read | ticketing | [source](../../packages/modules/ticketing/src/issue.ts#L244) |
| ticketing.findByCode | attendees:read | ticketing | [source](../../packages/modules/ticketing/src/issue.ts#L285) |
| ticketing.occurrenceSales | events:read | ticketing | [source](../../packages/modules/ticketing/src/occurrences.ts#L49) |
| ticketing.createPromoCode | events:write | ticketing | [source](../../packages/modules/ticketing/src/promo.ts#L138) |
| ticketing.setPromoCodeActive | events:write | ticketing | [source](../../packages/modules/ticketing/src/promo.ts#L178) |
| ticketing.listPromoCodes | events:read | ticketing | [source](../../packages/modules/ticketing/src/promo.ts#L200) |
| ticketing.listOrgPromoCodes | events:read | ticketing | [source](../../packages/modules/ticketing/src/promo.ts#L215) |
| ticketing.startTransfer | orders:support | ticketing | [source](../../packages/modules/ticketing/src/transfers.ts#L263) |
| ticketing.cancelTransfer | orders:support | ticketing | [source](../../packages/modules/ticketing/src/transfers.ts#L288) |
| ticketing.startHolderTransfer | public:holder | ticketing | [source](../../packages/modules/ticketing/src/transfers.ts#L314) |
| ticketing.cancelHolderTransfer | public:holder | ticketing | [source](../../packages/modules/ticketing/src/transfers.ts#L356) |
| ticketing.orderTransfers | orders:read | ticketing | [source](../../packages/modules/ticketing/src/transfers.ts#L426) |
| ticketing.orderWalletPasses | orders:read | ticketing | [source](../../packages/modules/ticketing/src/wallet.ts#L123) |

### Feature rules and lifecycle

#### ticketing (tier 3)

Ticket types, inventory and (from M1.5b) holds, tickets and barcodes. Owns Postgres schema `ticketing`.

**Invariants**
- Money is integer minor units in the event's currency; every price shown to a buyer is **all-in** (face + mandatory fees; billing `priceBreakdown`).
- Inventory: `quantity_sold + quantity_held ≤ quantity_total` is a CHECK constraint, so no code path can oversell.
- A ticket type belongs to one event (composite FK `(org_id, event_id)`), and its currency is the event's.
- Public reads go only through `ticketing.public_ticket_types(event_slug)` (SECURITY DEFINER, allowlisted, public + active + published events only).
- **Dates (M1.4b):** a ticket type lists the occurrences it sells for (`occurrence_ids`, empty = every date; each must be a date of its event). A ticket bought for a date carries `occurrence_id` (FK to `events.occurrences`, hand-written); check-in refuses it elsewhere (`wrong_date`). Access dates remain a separate, additional rule.

- **Bulk ticket actions (M1.8f):** `ticketing.resendTickets` (`attendees:write`) emits `ticket.resend_requested@1` per chunk; the resend mailer sends one email per active ticket to its holder with a fresh holder link (the public per-hour limit doesn't apply to organizer resends), deduplicated by `ticket-resend:{operation}:{ticket}`. `tickets.cancelled@1` (from `orders.cancelTickets`) is mailed once per ticket (`ticket-cancelled:{ticket}`). Attendee filters get ticket-type subqueries from `ticketIdsOfTypesSql` (never this schema).
- **Transfers (M3.10c):** `ticket_transfers` records a transfer to a named recipient behind a claim link (`ticket_claims`, signed, single use, expiring after `TRANSFER_CLAIM_DAYS` = 7 or at the event's end). At most one pending transfer per ticket (partial unique); a new claim link or transfer cancels the pending one. Claiming needs the address the transfer was sent to; it reissues the ticket (rev + 1: the old QR, short code and wallet pass stop working), marks the transfer claimed with `UPDATE … WHERE status = 'pending'` in the claim's transaction (exactly once), rotates the wallet pass and emits `ticket.transferred@1`. Holder transfers follow the ticket type's rules (`transfers_allowed`, `transfer_cutoff_hours` before the start (none: until the end), `transfer_fee_minor`, pure in `domain/transfer-rules.ts`); organizers are bound only by a valid ticket and a running event, and pay no fee. Open give-away links follow the same rules and refuse types with a fee.
- **Wallet passes (M3.10c):** `wallet_passes` is the provider's view, one row per ticket code revision, at most one active per ticket. The `WalletPassProvider` port has a fake adapter only (Apple/Google need the owner's accounts); `ticketing.wallet-pass-sync` pushes voids and new passes after commit and stamps `pushed_at`.
- **Store credit on a cart (M3.10c):** `quoteTx(…, { creditBudgetMinor })` takes store credit off the tickets after any promo, the same amount per ticket of a line (`allocateCredit`), never below zero, donations excluded; `Quote.creditMinor` is what it used.
- **Table tickets (M4.2b):** a ticket type with `table_size` (2–20, never a donation pass) sells tables: price, inventory and per-order limits count tables. Issuing a table writes one `table_units` row and `table_size` tickets pointing at it (`tickets.table_unit_id`) in the same transaction, so a table always has exactly its size in guest slots. Voiding returns a table to inventory only when none of its seats is left active; the cancellation preview counts a table once. The claim link token is `<table id>~hmac` (purpose `table-naming`), resolved by `ticketing.table_unit_org` (SECURITY DEFINER).
- **Balance due (M5.1d):** `tickets.payment_due` marks tickets sold on an invoice whose balance is still due (`setOrderPaymentDueTx`, set and cleared by orders); `ScannableTicket.paymentDue` and `BadgeTicket.paymentDue` expose it to the door and the badge desk.
- **Org coupons (U9):** `coupons` (one code per org, never also an event promo code's) apply to all events or `event_ids`; an amount coupon only in its own currency. Checkout resolves the event's promo code first, then a coupon (`resolveCodeTx`); `claimCouponTx` claims with a conditional UPDATE (total limit) and counts the buyer's live `coupon_redemptions` under that row lock (per-buyer limit, by CRM contact; merges move them via `ticketingContactOwner`). Lapsed or voided orders release (`releaseCouponTx`); a late payment reclaims if a use is left.
- **Event currency (U9):** ticket types and promo codes reference `(org, event, currency)` with ON UPDATE CASCADE, so they always carry the event's currency.


### Source index

- [packages/modules/ticketing/src/badges.ts](../../packages/modules/ticketing/src/badges.ts)
- [packages/modules/ticketing/src/bulk.ts](../../packages/modules/ticketing/src/bulk.ts)
- [packages/modules/ticketing/src/commands/ticket-types.ts](../../packages/modules/ticketing/src/commands/ticket-types.ts)
- [packages/modules/ticketing/src/contact-merge.ts](../../packages/modules/ticketing/src/contact-merge.ts)
- [packages/modules/ticketing/src/copy.ts](../../packages/modules/ticketing/src/copy.ts)
- [packages/modules/ticketing/src/coupons.ts](../../packages/modules/ticketing/src/coupons.ts)
- [packages/modules/ticketing/src/data-subject.ts](../../packages/modules/ticketing/src/data-subject.ts)
- [packages/modules/ticketing/src/distribution.ts](../../packages/modules/ticketing/src/distribution.ts)
- [packages/modules/ticketing/src/domain/credit.ts](../../packages/modules/ticketing/src/domain/credit.ts)
- [packages/modules/ticketing/src/domain/transfer-rules.ts](../../packages/modules/ticketing/src/domain/transfer-rules.ts)
- [packages/modules/ticketing/src/dsar.ts](../../packages/modules/ticketing/src/dsar.ts)
- [packages/modules/ticketing/src/dto.ts](../../packages/modules/ticketing/src/dto.ts)
- [packages/modules/ticketing/src/fair-value-facts.ts](../../packages/modules/ticketing/src/fair-value-facts.ts)
- [packages/modules/ticketing/src/holder-facts.ts](../../packages/modules/ticketing/src/holder-facts.ts)
- [packages/modules/ticketing/src/holder-leads.ts](../../packages/modules/ticketing/src/holder-leads.ts)
- [packages/modules/ticketing/src/index.ts](../../packages/modules/ticketing/src/index.ts)
- [packages/modules/ticketing/src/inventory.ts](../../packages/modules/ticketing/src/inventory.ts)
- [packages/modules/ticketing/src/issue.ts](../../packages/modules/ticketing/src/issue.ts)
- [packages/modules/ticketing/src/kiosk.ts](../../packages/modules/ticketing/src/kiosk.ts)
- [packages/modules/ticketing/src/naming.ts](../../packages/modules/ticketing/src/naming.ts)
- [packages/modules/ticketing/src/occurrences.ts](../../packages/modules/ticketing/src/occurrences.ts)
- [packages/modules/ticketing/src/order-siblings.ts](../../packages/modules/ticketing/src/order-siblings.ts)
- [packages/modules/ticketing/src/order-ticket-counts.ts](../../packages/modules/ticketing/src/order-ticket-counts.ts)
- [packages/modules/ticketing/src/participation.ts](../../packages/modules/ticketing/src/participation.ts)
- [packages/modules/ticketing/src/party-tickets.ts](../../packages/modules/ticketing/src/party-tickets.ts)
- [packages/modules/ticketing/src/payment-due.ts](../../packages/modules/ticketing/src/payment-due.ts)
- [packages/modules/ticketing/src/private-columns.ts](../../packages/modules/ticketing/src/private-columns.ts)
- [packages/modules/ticketing/src/promo.ts](../../packages/modules/ticketing/src/promo.ts)
- [packages/modules/ticketing/src/public.ts](../../packages/modules/ticketing/src/public.ts)
- [packages/modules/ticketing/src/schema.ts](../../packages/modules/ticketing/src/schema.ts)
- [packages/modules/ticketing/src/stats.ts](../../packages/modules/ticketing/src/stats.ts)
- [packages/modules/ticketing/src/subscribers.ts](../../packages/modules/ticketing/src/subscribers.ts)
- [packages/modules/ticketing/src/tables.ts](../../packages/modules/ticketing/src/tables.ts)
- [packages/modules/ticketing/src/testing.ts](../../packages/modules/ticketing/src/testing.ts)
- [packages/modules/ticketing/src/transfers.ts](../../packages/modules/ticketing/src/transfers.ts)
- [packages/modules/ticketing/src/virtual-facts.ts](../../packages/modules/ticketing/src/virtual-facts.ts)
- [packages/modules/ticketing/src/wallet.ts](../../packages/modules/ticketing/src/wallet.ts)

## venues

Tier 1; 7 source files; 0 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Tables detected: see schema source.

Event type literals detected: venue.created, venue.quote_requested, venue.updated.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| venues.createVenue | events:write | core | [source](../../packages/modules/venues/src/venues.ts#L41) |
| venues.updateVenue | events:write | core | [source](../../packages/modules/venues/src/venues.ts#L78) |
| venues.setVenueArchived | events:write | core | [source](../../packages/modules/venues/src/venues.ts#L118) |
| venues.listVenues | events:read | core | [source](../../packages/modules/venues/src/venues.ts#L146) |
| venues.getVenue | events:read | core | [source](../../packages/modules/venues/src/venues.ts#L162) |
| venues.submitQuoteRequest | public:venue_quote | core | [source](../../packages/modules/venues/src/venues.ts#L181) |
| venues.listQuoteRequests | events:write | core | [source](../../packages/modules/venues/src/venues.ts#L221) |
| venues.setQuoteRequestStatus | events:write | core | [source](../../packages/modules/venues/src/venues.ts#L236) |

### Feature rules and lifecycle

#### venues (tier 1)

Org-owned venues, the platform venue directory and quote requests. Owns Postgres schema `venues`.

**Invariants**
- Venue slugs are global (public URL `yayatoh.com/venues/{slug}`), lowercase, and generated from the name (a random suffix on a clash).
- Countries are ISO 3166-1 alpha-2; latitude and longitude come as a pair or not at all; map links are `https://` only.
- Only `directory_listed`, non-archived venues of active or limited orgs are public, and only through the SECURITY DEFINER functions `venues.directory()`, `venues.public_venue(slug)` and `venues.quote_target(slug)` with allowlisted columns (`PublicVenueDto`, `DirectoryVenueDto`).
- Venues are archived, never deleted (events keep their `venue_id`); archiving unlists the venue.
- Quote requests are public (`public:venue_quote`), limited to `QUOTES_PER_HOUR` per sender key per org and per email per venue, and stored with an HMAC of the sender's network key, never the address. Reading them needs `events:write` (contact data).
- `venue.quote_requested@1` is emitted for notifications (M1.10); this module sends no email.


### Source index

- [packages/modules/venues/src/data-subject.ts](../../packages/modules/venues/src/data-subject.ts)
- [packages/modules/venues/src/dto.ts](../../packages/modules/venues/src/dto.ts)
- [packages/modules/venues/src/index.ts](../../packages/modules/venues/src/index.ts)
- [packages/modules/venues/src/private-columns.ts](../../packages/modules/venues/src/private-columns.ts)
- [packages/modules/venues/src/schema.ts](../../packages/modules/venues/src/schema.ts)
- [packages/modules/venues/src/testing.ts](../../packages/modules/venues/src/testing.ts)
- [packages/modules/venues/src/venues.ts](../../packages/modules/venues/src/venues.ts)

## virtual

Tier 4; 18 source files; 2 test files.

Declared connections: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/ticketing.

Source imports: @yayatoh/contracts, @yayatoh/db, @yayatoh/events, @yayatoh/kernel, @yayatoh/platform, @yayatoh/program, @yayatoh/ticketing.

Tables detected: see schema source.

Event type literals detected: system, virtual.attended.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| virtual.setup | events:read | virtual | [source](../../packages/modules/virtual/src/commands.ts#L84) |
| virtual.setTicketAccess | events:write | virtual | [source](../../packages/modules/virtual/src/commands.ts#L136) |
| virtual.createStream | events:write | virtual | [source](../../packages/modules/virtual/src/commands.ts#L181) |
| virtual.switchStreamProvider | events:write | virtual | [source](../../packages/modules/virtual/src/commands.ts#L243) |
| virtual.setActiveIngest | events:write | virtual | [source](../../packages/modules/virtual/src/commands.ts#L293) |
| virtual.setStreamEnabled | events:write | virtual | [source](../../packages/modules/virtual/src/commands.ts#L323) |
| virtual.revealStreamKey | events:write | virtual | [source](../../packages/modules/virtual/src/commands.ts#L352) |
| virtual.streamingUsage | events:read | virtual | [source](../../packages/modules/virtual/src/commands.ts#L385) |
| virtual.viewer | public:virtual | virtual | [source](../../packages/modules/virtual/src/viewer.ts#L69) |
| virtual.startPlayback | public:virtual | virtual | [source](../../packages/modules/virtual/src/viewer.ts#L115) |
| virtual.heartbeat | public:virtual | virtual | [source](../../packages/modules/virtual/src/viewer.ts#L199) |
| virtual.watchableTickets | public:virtual | virtual | [source](../../packages/modules/virtual/src/viewer.ts#L276) |
| virtual.recordZoomParticipant | platform:virtual.zoom_webhook | virtual | [source](../../packages/modules/virtual/src/zoom-webhook.ts#L115) |
| virtual.zoomSetup | events:read | virtual | [source](../../packages/modules/virtual/src/zoom.ts#L146) |
| virtual.linkZoomWebinar | events:write | virtual | [source](../../packages/modules/virtual/src/zoom.ts#L240) |
| virtual.syncZoomRegistrants | events:write | virtual | [source](../../packages/modules/virtual/src/zoom.ts#L256) |

### Feature rules and lifecycle

#### virtual (tier 4)

Virtual and hybrid delivery v1 (M6.9a, decision P6-9). Owns Postgres schema `virtual`. Events come from `events` (tier 2), sessions from `program` (tier 3), tickets and ticket types from `ticketing` (tier 3), all through their exports; the composite foreign keys to `events.events`, `ticketing.ticket_types`, `ticketing.tickets` and `program.sessions` are hand-written in the migration (cascade on delete). Entitlement `virtual` (P6-13); streaming is metered from day one (D24).

**Invariants**
- **Delivery mode is the event's attendance mode** (`events.attendance_mode`: in person, online, hybrid; set with `events.setEventDetails`). There is no second copy. An in-person event never streams: `createStream` refuses it and every ticket's effective access is in person.
- **Access mode per ticket type** (`ticket_access`: `in_person`, `virtual`, `both`), set by the organizer. Without a choice an online event's tickets are virtual and a hybrid event's are in person (`effectiveAccess`), so nobody receives a metered stream the organizer did not grant.
- **An in-person-only ticket never gets a playback token**: `startPlayback` refuses it (`forbidden`, `in_person_only`), the watch page lists no sessions for it, and a heartbeat for a ticket whose access was taken away is refused.
- **Video goes through the `VideoProvider` port** (`provider/port.ts`): Mux in production (signed playback, RS256 under the org's signing key; the Video API calls are a stub until the owner's account exists), the fake in dev, CI and previews (`VIDEO_PROVIDER`, `videoProviderFromEnv`; each composition root calls `configureVirtual`). Without a provider streaming is off (`invalid_state`, `video_off`). **Stream keys are never stored**: `revealStreamKey` (audited, `events:write`) asks the provider.
- **Playback tokens are short-lived and personal**: one `views` row per token (one ticket, one session, `PLAYBACK_TTL_MS` = 10 minutes); the JWT carries the playback id (`sub`), the expiry and Yayatoh's org and viewing ids (`yy`). The CDN (the fake's `fakePlaybackCheck`) plays only that session's playback id; heartbeats land on that viewing's ticket and session only. At most `VIEWS_PER_HOUR` viewings per ticket per session per hour.
- **The holder proves the ticket with its watch link** (`virtual.ticket`: `<ticketId>~<hmac>`), shown on their order page; the org comes from the event slug, never a header. Only active tickets of published or postponed events.
- **Watch time counts once per minute**: a heartbeat counts the server's current minute (never the client's) for its viewing's ticket and session; the unique key `(org, session, ticket, minute)` ignores more heartbeats in that minute (tabs, retries), and a sequence number not above the viewing's last accepted one is a replay (`replayed`, nothing counted). The viewing row is locked for the heartbeat.
- **The virtual checkpoint**: a ticket's first counted minute of a session emits `virtual.attended@1` (`{ orgId, eventId, sessionId, ticketId, at }`, ids only); check-in's `checkin.virtual-attendance` subscriber records it at the session's virtual checkpoint (`checkin.checkpoints` kind `virtual`), once per ticket.
- **Meter (D24)**: `watch_minutes` rows are viewer-minutes; `streamingUsageQuery` sums them per period for billing's meters (M6.6b).
- Organizer reads need `events:read`, changes `events:write`; the holder side is `public:virtual`. The setup page shows totals per session (viewers, minutes), never who watched.

**M6.10a (virtual v2)**
- **Several providers, chosen per session**: `configureVirtual({ provider, providers })` registers them (`videoProvidersFromEnv`: both fakes in dev and CI, `fake` = Mux and `fake_cloudflare`; Mux and Cloudflare Stream with their keys). A stream names its provider; tokens are checked by whichever registered provider signed them (`verifyPlaybackAny`), and each fake CDN plays only its own tokens.
- **Switching a session's provider keeps grants and watch-time history**: `switchStreamProviderCommand` creates the stream at the new provider (keyed by session and provider) and updates the same `streams` row (id, on/off state, viewings and minutes stay; the ingest returns to primary). A player holding the old provider's token gets `invalid_state` `provider_changed` on its next heartbeat and starts a new viewing; the ticket's access and its minutes are untouched. Each `watch_minutes` row records the provider that served it (the meter is priced per provider, D24).
- **RTMP overflow**: a stream keeps the provider's backup ingest (`backup_ingest_url`); `setActiveIngestCommand` points the encoder at it (same key, same playback: viewers are not interrupted) or back; `revealStreamKey` returns the active ingest.
- **Zoom webinars created from Yayatoh** (`integrations.createZoomWebinar`, the network call between two transactions) are linked with `origin = 'created'`; typed ids stay `linked`.
- **Zoom join/leave webhooks are verified before anything else** (`processZoomWebhook`: Zoom's `v0` HMAC of `v0:{timestamp}:{raw body}` with the app's secret, five-minute window; nothing is parsed before), the org comes from the webinar in the verified body (`virtual.org_for_zoom_webinar`, SECURITY DEFINER: a created webinar wins, an ambiguous linked id resolves to no one), and **each provider event is recorded once** (`zoom_participant_events`, unique hashed provider event id): a replay records and counts nothing. Joins and leaves pair into `zoom_attendance` segments keyed like the report pull (`segment_key`), so one stay counts once for CE; a registered ticket's first join emits `virtual.attended@1`. `recordZoomParticipantCommand` runs only as the webhook's system actor (`platform:virtual.zoom_webhook`).


### Source index

- [packages/modules/virtual/src/commands.ts](../../packages/modules/virtual/src/commands.ts)
- [packages/modules/virtual/src/data-subject.ts](../../packages/modules/virtual/src/data-subject.ts)
- [packages/modules/virtual/src/domain/access.ts](../../packages/modules/virtual/src/domain/access.ts)
- [packages/modules/virtual/src/domain/watch.ts](../../packages/modules/virtual/src/domain/watch.ts)
- [packages/modules/virtual/src/dto.ts](../../packages/modules/virtual/src/dto.ts)
- [packages/modules/virtual/src/index.ts](../../packages/modules/virtual/src/index.ts)
- [packages/modules/virtual/src/private-columns.ts](../../packages/modules/virtual/src/private-columns.ts)
- [packages/modules/virtual/src/provider/cloudflare.ts](../../packages/modules/virtual/src/provider/cloudflare.ts)
- [packages/modules/virtual/src/provider/fake.ts](../../packages/modules/virtual/src/provider/fake.ts)
- [packages/modules/virtual/src/provider/jwt.ts](../../packages/modules/virtual/src/provider/jwt.ts)
- [packages/modules/virtual/src/provider/mux.ts](../../packages/modules/virtual/src/provider/mux.ts)
- [packages/modules/virtual/src/provider/port.ts](../../packages/modules/virtual/src/provider/port.ts)
- [packages/modules/virtual/src/provider/registry.ts](../../packages/modules/virtual/src/provider/registry.ts)
- [packages/modules/virtual/src/schema.ts](../../packages/modules/virtual/src/schema.ts)
- [packages/modules/virtual/src/viewer.ts](../../packages/modules/virtual/src/viewer.ts)
- [packages/modules/virtual/src/zoom-keys.ts](../../packages/modules/virtual/src/zoom-keys.ts)
- [packages/modules/virtual/src/zoom-webhook.ts](../../packages/modules/virtual/src/zoom-webhook.ts)
- [packages/modules/virtual/src/zoom.ts](../../packages/modules/virtual/src/zoom.ts)

## webhooks

Tier 6; 15 source files; 5 test files.

Declared connections: @yayatoh/billing, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform.

Source imports: @yayatoh/billing, @yayatoh/db, @yayatoh/kernel, @yayatoh/platform, @yayatoh/platform/ssrf.

Tables detected: see schema source.

Event type literals detected: event.created, event.occurrence_cancelled, event.updated, form.registration_submitted, order.dispute_closed, order.disputed, order.expired, order.paid, order.payment_failed, order.refunded, program.agenda_published, review.submitted, survey.responded, ticket.admission_undone, ticket.admitted, ticket.claimed, ticket.transferred, ticket_type.archived, ticket_type.created, ticket_type.updated, tickets.cancelled, waitlist.joined, waitlist.offered, webhook.test.

### Commands and queries

| Operation | Permission | Entitlement | Source |
|---|---|---|---|
| webhooks.listEndpoints | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L126) |
| webhooks.getEndpoint | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L138) |
| webhooks.endpointAttempts | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L148) |
| webhooks.portal | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L165) |
| webhooks.createEndpoint | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L179) |
| webhooks.updateEndpoint | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L226) |
| webhooks.deleteEndpoint | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L270) |
| webhooks.revealSecret | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L292) |
| webhooks.rotateSecret | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L312) |
| webhooks.sendTest | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L337) |
| webhooks.resend | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L378) |
| webhooks.recover | webhooks:manage | api_access | [source](../../packages/modules/webhooks/src/commands.ts#L399) |
| webhooks.subscribeHook | webhooks:subscribe | api_access | [source](../../packages/modules/webhooks/src/rest-hooks.ts#L43) |
| webhooks.unsubscribeHook | webhooks:subscribe | api_access | [source](../../packages/modules/webhooks/src/rest-hooks.ts#L92) |
| webhooks.hookSample | webhooks:subscribe | api_access | [source](../../packages/modules/webhooks/src/rest-hooks.ts#L117) |
| webhooks.listRestHooks | integrations:read | api_access | [source](../../packages/modules/webhooks/src/rest-hooks.ts#L132) |

### Feature rules and lifecycle

#### webhooks (tier 6)

Outbound webhooks (M6.3b, roadmap §6.3, P6-3, D21): the public event catalog, the org's webhook endpoints, and the outbox subscriber that hands public events to Svix. Owns Postgres schema `webhooks`.

**Invariants**
- **The catalog is the only way out.** `EVENT_CATALOG` lists every public event with a versioned Zod schema, a description and an example; `INTERNAL_EVENTS` lists every other outbox event with a reason. `catalog.test.ts` scans the code for emitted and subscribed `type@version` keys and fails on any that is in neither list or in both.
- **Thin payloads (D21).** Every catalog field is in `THIN_FIELDS` and every string is a uuid, a date, a date-time, an enum or a short pattern: no names, emails, phones, addresses, answers, notes or messages. `toPublicData` parses the internal payload through the schema (the allowlist), so unknown keys never leave; the leak canary (`catalog.test.ts`, `webhooks.int.test.ts`) plants personal data in payloads and checks none of it reaches a delivery.
- **Versioned.** A breaking change is a new `version` (and Svix event type) next to the old one; v1 keeps flowing.
- `WebhookPublisher` is a port: `svixPublisher` (REST, `SVIX_API_KEY`, owner inbox) and `fakePublisher` (dev, preview, CI: signs and records deliveries, never sends; a URL path segment `fail` answers 503). Production without Svix has no publisher: the console says webhooks are not available and nothing is sent.
- Svix holds secrets, messages, attempts and the customer portal; `webhooks.endpoints` mirrors the org's endpoints (url, description, event types, status) so the console lists them and the publisher can skip orgs with no active endpoint. Application uid = org id, endpoint uid = our row id, message eventId = the outbox event id: every provider call is safe to retry.
- Endpoint URLs: https on 443, no credentials, public names and addresses only (`@yayatoh/platform/ssrf` at registration; Svix re-checks at send). The fake publisher resolves reserved test names (`.test`, `example.com`) to a public address.
- Everything needs `webhooks:manage` (owners and admins) and the `api_access` module. Rotating a secret needs step-up; revealing one is audited. Audit entries name the endpoint's host only (a URL's path can carry the receiver's token).
- Signatures are Standard Webhooks (`signing.ts`); the receiver example on the docs (`examples.ts`) is run by `examples.test.ts` against deliveries the fake signed.
- **REST hooks (M6.4c):** `subscribeHookCommand` / `unsubscribeHookCommand` (/v1 `hooks`, scope and permission `webhooks:subscribe`) make and remove an endpoint with `source = 'rest_hook'` for one event type (Zapier's triggers); a tool can remove only hooks made this way, never the organizer's endpoints. `hookSampleQuery` returns the catalog example. They count towards `MAX_ENDPOINTS` and show in Settings → Webhooks.



### Source index

- [packages/modules/webhooks/src/catalog.ts](../../packages/modules/webhooks/src/catalog.ts)
- [packages/modules/webhooks/src/commands.ts](../../packages/modules/webhooks/src/commands.ts)
- [packages/modules/webhooks/src/config.ts](../../packages/modules/webhooks/src/config.ts)
- [packages/modules/webhooks/src/examples.ts](../../packages/modules/webhooks/src/examples.ts)
- [packages/modules/webhooks/src/fake.ts](../../packages/modules/webhooks/src/fake.ts)
- [packages/modules/webhooks/src/index.ts](../../packages/modules/webhooks/src/index.ts)
- [packages/modules/webhooks/src/internal-events.ts](../../packages/modules/webhooks/src/internal-events.ts)
- [packages/modules/webhooks/src/port.ts](../../packages/modules/webhooks/src/port.ts)
- [packages/modules/webhooks/src/private-columns.ts](../../packages/modules/webhooks/src/private-columns.ts)
- [packages/modules/webhooks/src/rest-hooks.ts](../../packages/modules/webhooks/src/rest-hooks.ts)
- [packages/modules/webhooks/src/schema.ts](../../packages/modules/webhooks/src/schema.ts)
- [packages/modules/webhooks/src/signing.ts](../../packages/modules/webhooks/src/signing.ts)
- [packages/modules/webhooks/src/subscriber.ts](../../packages/modules/webhooks/src/subscriber.ts)
- [packages/modules/webhooks/src/svix.ts](../../packages/modules/webhooks/src/svix.ts)
- [packages/modules/webhooks/src/url.ts](../../packages/modules/webhooks/src/url.ts)
