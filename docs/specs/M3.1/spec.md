# Spec: M3.1 — Event pipeline and realtime platform

M3.1 is built in parallel slices: **M3.1a** (metric projectors, analytics sink) and **M3.1b**
(the generalized realtime publisher). Each slice has its own self-contained section below.

---

## M3.1b — Generalized realtime publisher

- **Milestone:** M3.1 (roadmap Phase 3, "Generalized realtime publisher"); Phase 3 plan wave A (`docs/plans/phase-3.md`)
- **Status:** Built (owner decision 2026-09-28, P3-3: "SSE now, Ably adapter behind the same port")
- **Risk tags:** db-migration, tenancy, infra
- **Related ADRs:** 0009 (realtime), 0008 (outbox), 0012 (live seats)

### 1. Goal and users
The live seat map (M1.7f) proved Server-Sent Events with Postgres LISTEN/NOTIFY, Last-Event-ID
resume and snapshots. The Command Center (M3.2/M3.3) needs the same for many more feeds: check-ins,
devices, metrics, alerts. M3.1b turns the one-off seat stream into a platform: any module publishes
`publish(orgId, channel, event)` after commit, a registry says who may attach to each channel and
which payload fields may travel on it, and one SSE endpoint serves every channel with resume,
heartbeat, backpressure and connection limits. Ably slots in behind the same port when the owner
opens the account. Users: door staff and organizers (live door screen today), buyers (seat maps),
and the M3.2/M3.3 Command Center next.

### 2. References
- **Vision / plan:** `docs/plans/phase-3.md` M3.1b row ("Cross-org channel attach is denied").
- **Decisions:** `docs/decisions.md` 2026-09-28 (P3-3 realtime: SSE first, Ably adapter later).
- **Legacy evidence:** none (the legacy platform has no realtime).

### 3. Scope
**In:**
- Channel registry (`packages/platform/src/realtime-channels.ts`): `defineRealtimeChannel`, wire
  names `org:{org}:{topic}` / `org:{org}:event:{event}:{topic}`, per-channel access (public /
  members by permission, incl. event roles / the org's check-in devices), payload allowlists per
  message type and for snapshots, optional module entitlement.
- Message log `platform.realtime_messages` + `publishRealtimeTx` (inside a command handler or an
  outbox subscriber; `realtimeSubscriber` helper), NOTIFY `"{seq} {channel}"` on commit, one
  LISTEN per web process, rows fetched by id under the org's RLS (no payload in NOTIFY).
- SSE core (`packages/platform/src/realtime-sse.ts`): retry hint, catch-up then live with no
  duplicates, heartbeat every 20 s, backpressure (a client more than 1 MiB behind is disconnected
  and resumes by id), per-process and per-org stream limits, the dev "drop all streams" switch.
- Endpoints: `GET /api/realtime/{channel}` on every host (a tenant host serves only its own org's
  channels), `GET {tenant host}/realtime/{channel}` (proxy rewrite to
  `/[locale]/t/[org]/realtime/[channel]`), `GET /api/realtime/{channel}/token` (Ably only).
- Seat map migrated: `event.seats` / `event.seat-states` registry entries served by the seat feed
  through the same core (same rate limits, resume ids, snapshots and 404 rules). The seat pickers,
  the box office and the seating page keep their M1.7f URLs, which are now aliases of those
  channels, so nothing changes for them; the same channels are also reachable at
  `/api/realtime/{channel}`.
- Channels for the next wave: `event.checkins` (published by check-in now), `event.devices`,
  `event.metrics` (placeholder for M3.1a), `org.alerts` — defined and tested, minimal payloads.
- Ably adapter: `ablyTokenRequest` (locally signed TokenRequest, `ablySubscribeCapability`),
  publisher switched on by `REALTIME_PROVIDER=ably` + `ABLY_API_KEY`, CSP `connect-src` widened
  only then. Never called in tests.
- Door screen (`/o/{org}/e/{event}/onsite`): live status and "N check-ins since you opened this
  page" (polite live region); counts re-read within a moment of any scanner's admission.

**Out:**
- Command Center tiles, device board and alert engine (M3.2/M3.3) — they publish to the channels
  defined here. Device presence publishing (heartbeats → `event.devices`) lands with the device board.
- Worker-side Ably publishing: with Ably on, each web process publishes what it fans out.

### 4. `touches:`
```yaml
touches:
  - packages/platform/src/{realtime,realtime-channels,realtime-log,realtime-sse,schema,index}.ts
  - packages/platform/src/security/{realtime-csp,index}.ts
  - packages/modules/checkin/src/{scan,devices}.ts, MODULE.md
  - packages/modules/seating/src/{live,index}.ts
  - packages/modules/events/src/{queries,index}.ts
  - packages/db/drizzle/0054_realtime_messages.sql (+ meta)
  - packages/testing/src/fixtures.ts, tests/realtime.int.test.ts
  - apps/web/src/server/{realtime,realtime-host}.ts (seat-stream.ts removed)
  - apps/web/src/app/api/realtime/**, apps/web/src/app/[locale]/t/[org]/realtime/**
  - apps/web/src/app/api/dev/seat-streams/route.ts, the three seat stream routes (import only), proxy.ts, onsite page
  - apps/web/src/lib/{use-realtime,use-seat-stream,realtime-url}.ts, components/live-checkins.tsx
  - apps/web/messages/*.json (checkinLive), apps/web/e2e/realtime.spec.ts
  - apps/worker/src/main.ts (5-minute purge)
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `platform.realtime_messages` | new (tenantTable) | `seq` bigint identity (the SSE id), `channel`, `event`, `data` jsonb |

- **RLS:** tenantTable (org_id NOT NULL, ENABLE + FORCE, canonical policy); indexes lead with
  `org_id` (`(org_id, seq)` unique, `(org_id, channel, seq)`, `(org_id, created_at)`).
- CHECKs: the channel must name the row's own org (`channel like 'org:' || org_id || ':%'`),
  ≤160 chars; event 1–40 chars; payload ≤16 KiB.
- **Append-only for the app:** `REVOKE UPDATE, DELETE … FROM app_user`; only
  `platform.purge_realtime_messages()` (SECURITY DEFINER) deletes rows older than 1 hour.
- Fixture rows for both orgs (`createOrgFixture`: one `org.alerts` message).
- **Migration** `0054_realtime_messages.sql` (renumbered at merge). New table only (no locks on
  existing tables). Hand-written block: the REVOKE, the NOTIFY trigger function and trigger, the
  purge function (+ grants), and `events.public_event_target(org, event)` (SECURITY DEFINER, same
  rule as `events.checkout_target(slug)`, returns ids only).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **HTTP (web):** `GET /api/realtime/{channel}` (text/event-stream; 200 / 401 not signed in /
  403 refused / 404 unknown channel, not public, module off or no such event / 429 / 503 busy),
  `GET {tenant}/realtime/{channel}`, `GET /api/realtime/{channel}/token` (404 unless Ably).
- **Commands:** `checkin.scanTicket`, `checkin.undoAdmission`, `checkin.syncScans` now publish to
  `event.checkins` in their transaction (no new permission or entitlement).

### 7. Events
| Channel | Messages | Access | Producer |
|---|---|---|---|
| `org:{o}:event:{e}:checkins` | `admission {change: admitted/undone/synced, checkpointId, count, at}`; snapshot `{admitted, tickets}` | `checkin:scan` (org or event role), org devices; entitlement `checkin` | checkin commands |
| `org:{o}:event:{e}:devices` | `device {deviceId, state, batteryPct, queueDepth, at}` | `checkin:scan`, org devices | M3.3 |
| `org:{o}:event:{e}:metrics` | `metric {metric, value, at}` | `events:read`; entitlement `reports` | M3.1a |
| `org:{o}:alerts` | `alert {alertId, eventId, state, severity, at}` | `events:read` | M3.2 |
| `org:{o}:event:{e}:seats` | `snapshot`/`delta {on, off}`, `refresh` | public (event published & listed, map on sale) | seat feed |
| `org:{o}:event:{e}:seat-states` | `snapshot`/`delta {counts, seats}`, `refresh` | `events:read`; entitlement `seating` | seat feed |

No new domain events; `realtimeSubscriber` maps outbox events to channels for later producers.

### 8. Entitlements and flags
- Module keys per channel as above; no release flag (SSE is the default transport).
- Config switch: `REALTIME_PROVIDER=ably` + `ABLY_API_KEY`; `REALTIME_MAX_STREAMS_PER_ORG`.

### 9. ELT impact
None.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M3.1b-01 | **Given** two door screens **When** one scans a ticket **Then** the other shows it within 3 s (and an undo too) | `apps/web/e2e/realtime.spec.ts` (e2e ×3 viewports) |
| AC-M3.1b-02 | **Given** a viewer, another org's owner, a signed-out visitor, a forged token or another org's device **When** they attach to an org's check-in channel **Then** 403 / 403 / 401 / 401 / 403; the viewer's page shows no live control | `realtime.spec.ts`; unit `realtime-channels.test.ts` |
| AC-M3.1b-03 | **Given** a tenant host **When** another org's channel is requested on `/realtime/…` or `/api/realtime/…` **Then** 403 | `realtime.spec.ts` |
| AC-M3.1b-04 | **Given** a message committed in one transaction **When** two processes listen on separate connections **Then** each delivers it once; a rolled-back one never | `packages/testing/tests/realtime.int.test.ts` |
| AC-M3.1b-05 | **Given** another org's message **Then** it never reaches this org's channel, its rows are invisible under RLS, and a row can't be filed under another org's channel | `realtime.int.test.ts` (+ isolation suite) |
| AC-M3.1b-06 | **Given** a dropped stream **When** it reconnects with Last-Event-ID **Then** it is replayed exactly what it missed; unknown, pruned, foreign or too-old ids get a snapshot | `realtime.int.test.ts`, `realtime.spec.ts`, unit `realtime-fanout.test.ts` |
| AC-M3.1b-07 | Payloads pass the channel allowlist (extra fields dropped, unknown types refused) before storage and again before sending | unit `realtime-channels.test.ts`, `realtime-sse.test.ts`; int check-in test (no ticket/holder) |
| AC-M3.1b-08 | Heartbeat, backpressure disconnect, abort release, per-org/per-process limits | unit `realtime-sse.test.ts` |
| AC-M3.1b-09 | The seat map still updates live on the migrated endpoint | `apps/web/e2e/seat-live.spec.ts` (unchanged, green) |
| AC-M3.1b-10 | Ably TokenRequests carry `subscribe` on exactly one org channel and never the secret; SSE unless configured | unit `realtime-channels.test.ts` |
| AC-M3.1b-11 | Arabic RTL and axe on the door screen's live status | `realtime.spec.ts` |

### 11. Security and privacy
- The org is always the channel name's; the caller is checked against that org (membership + role
  or event role, device token's org, or the public rule). Headers never pick the tenant; the Host
  only narrows (a tenant host serves its own org's channels only). A presented `Authorization`
  header must be a live device token (never silently ignored for a cookie).
- Payload allowlists on publish and on send; NOTIFY carries only `"{seq} {channel}"`.
- Rate limit 30 (re)connections per caller per channel per minute (hashed keys, never raw ids).
- Messages retained 1 hour; derived data (screens re-read on snapshot).

### 12. Performance budget
- NOTIFY → delivery: one batched id fetch per org per 5 ms; the door screen re-reads within 250 ms
  of a burst. Streams: 64 KiB high-water mark, 1 MiB allowance before disconnect.
- Known limit: two publishers to one channel can commit out of id order; live delivery carries
  both, a resume exactly between them may skip the earlier one until the next snapshot.

### 13. Rollout
No flag: SSE everywhere. Ably by config when the owner's account exists. Migration adds a table only.

### 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | Registry, log, fan-out, SSE core, endpoints, seat migration, check-in channel, Ably token auth | this branch | db-migration, tenancy, infra |

### 15. Demo checklist
- [ ] Open an event happening now → Check-in on two browsers; scan on one; the other says "1 check-in since you opened this page" and its counts change without a reload.
- [ ] Sign in as the viewer (jordan@lakeside.test): the door screen shows no live status; the stream URL answers 403.
- [ ] Seat map: hold a seat in one browser, watch it grey out in another.

### 16. Owner tasks
- [ ] Ably account (see `docs/owner-inbox.md` → "Ably for realtime").
- [ ] Confirm the realtime defaults (owner inbox → "Realtime defaults, pending owner").
