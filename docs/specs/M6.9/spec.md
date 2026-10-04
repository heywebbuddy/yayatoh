# Spec: M6.9 — Virtual and hybrid v1

- **Milestone:** M6.9 (roadmap §10 Phase 6; Phase 6 plan `docs/plans/phase-6.md`, decisions P6-1, P6-9, P6-13; D24)
- **Status:** M6.9a built (2026-10-03; gate: lint, check:modules, typecheck 55/55, unit 3455/3455, integration 1940/1941 — the one failure, `audit.int.test.ts` › hash chain, timed out at 30 s under full-suite load and passes 9/9 on its own; e2e `virtual.spec.ts` 15/15 on three viewports plus the related checkout, enrollment, assistance, check-in, checkpoints, session check-in, program, conference pack, security and canary crawl specs), behind the `virtual` module key and the `VideoProvider` port (the Mux fake in dev/CI; streaming off in production until the owner's Mux account exists). M6.9b (Zoom and CE credits) stacks on it.
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0001 (modular monolith: same-tier modules talk through events), 0008 (outbox), 0023 (Phase 6 module layout: `virtual` tier 4)

## M6.9a — virtual v1 (done)

### 1. Goal and users
Organizers of online and hybrid conferences stream their sessions to the attendees whose tickets
include it, and see who watched as totals (viewers, minutes, virtual check-ins). Attendees open a
"Watch online" link from their order and watch on their phone. Streaming is metered from day one
(D24), so nobody gets a stream the organizer did not grant.

### 2. References
- **Decision P6-9:** Mux for video, signed playback tokens tied to the attendee's grant, heartbeat
  watch time feeding a virtual checkpoint (and CE credits in M6.9b). **D24:** streaming is metered
  and resold at a markup. **P6-13:** entitlement key `virtual`. **P6-1:** behind flags, fakes only.
- **Plan row M6.9A** acceptance: a playback token works only for its attendee and session; watch
  time counts once per minute. **Brief** (`docs/agent-briefs/m6.9a.md`): an in-person-only ticket
  never gets a playback token; e2e (organizer sets up, attendee watches, watch time and checkpoint
  appear; keyboard only, axe both themes, RTL).

### 3. Scope
**In (built):**
- **Module `@yayatoh/virtual`** (tier 4, schema `virtual`, `MODULE.md`): `ticket_access`,
  `streams`, `views`, `watch_minutes` (tenant tables, FORCE RLS, org-leading indexes, composite FKs
  to `events.events`, `ticketing.ticket_types`, `ticketing.tickets` and `program.sessions`, cascade).
- **Delivery modes per event** are the event's existing attendance mode (`in_person`, `online`,
  `hybrid`; M1.4d), set from the stream setup page through `events.setEventDetails`: one source of
  truth for the public page and streaming. Read through the new `eventDeliveryTx` (events exports).
- **Access modes per ticket type** (`in_person`, `virtual`, `both`; `setTicketAccessCommand`).
  Without a choice an online event's tickets are virtual and a hybrid event's in person
  (`effectiveAccess`); an in-person event never streams. Ticket type names come from the new
  `ticketTypeNamesTx` (ticketing exports).
- **`VideoProvider` port** (`src/provider/port.ts`): `createLiveStream` (idempotency key = the
  session), `streamKey` (asked on demand, never stored), `signPlayback` / `verifyPlayback`
  (JWT: Mux's `sub` = playback id, `aud` = `v`, `exp`, plus Yayatoh's `yy` = org and viewing),
  `playbackUrl`.
  - **Fake** (`src/provider/fake.ts`): no network; ids derived from a seed and the idempotency key;
    HS256 tokens; its "CDN" (`fakePlaybackCheck`, served at the dev route `/api/dev/video/{id}`)
    plays only an authentic, unexpired token for that very playback id.
  - **Mux** (`src/provider/mux.ts`): real RS256 playback tokens under `MUX_SIGNING_KEY_ID` /
    `MUX_SIGNING_PRIVATE_KEY` (signed locally, unit-tested with a generated key); the Video API
    calls (create stream, stream key) are a stub that refuses until the owner's account exists.
  - `videoProviderFromEnv`: `VIDEO_PROVIDER=fake|mux`; fake by default outside production (seeded
    from `APP_TOKEN_SECRET`), refused on `VERCEL_ENV=production`; null (streaming off) otherwise.
    Composition roots call `configureVirtual` (web, api, testing).
- **Streams:** `createStreamCommand` (one per session; refuses in-person events), `setStreamEnabledCommand`
  (off: no new tokens, heartbeats refused), `revealStreamKeyCommand` (audited, `events:write`).
- **Playback tokens per attendee and session:** a ticket's watch link (`virtual.ticket`,
  `<ticketId>~<hmac>`, like the assistance help link) proves the holder; `startPlaybackCommand`
  creates a viewing (`views`: one ticket, one session, 10 minutes) and signs the token for it.
  Refused for an in-person-only ticket (`forbidden` / `in_person_only`), a stream that is off or
  missing (`not_found`), a void ticket or another event's ticket (`not_found`), and beyond 60
  viewings per ticket per session per hour (`rate_limited`).
- **Heartbeat watch time:** `heartbeatCommand` (`POST /api/virtual/heartbeat`, `{ token, seq }`;
  the org comes from the verified token) counts the server's current minute once per ticket and
  session (unique key), ignores sequences not above the viewing's last (replays), and refuses
  forged/expired/other-org tokens, a void ticket, lost virtual access or a stream that is off.
- **Virtual checkpoint:** the first counted minute emits `virtual.attended@1` (ids only; webhooks:
  internal, `personal`); check-in's `checkin.virtual-attendance` subscriber (worker and the dev
  drain) creates the session's checkpoint of the new kind `virtual` ("Online · {session}") and
  records `checkin.virtual_attendance` once per ticket. Virtual checkpoints never appear in
  scanner lists or scan lookups (`checkpointsTx`, `scanCheckpointTx`). `virtualCheckpointsQuery`
  gives counts.
- **Meter (D24):** `watch_minutes` rows are viewer-minutes; `streamingUsageQuery` sums a period.
- **Web:** the conference nav's **Stream setup** page (`/o/{org}/e/{event}/virtual`): delivery
  (radio group), access per ticket type, session streams (status, viewers, minutes, virtual
  check-ins; set up, show key, turn off/on), viewer read-only, empty and in-person states. The
  order page shows **Watch online** per ticket with virtual access. The phone-first watch page
  (`/events/{slug}/watch/{ticketLink}`) lists streamed sessions with the holder's minutes; the
  player (`…/{session}`) starts a viewing, checks the CDN, heartbeats every 30 s, renews the token
  before it expires and shows the minutes watched. Messages in 13 locales (`virtual.*`, `nav.virtual`).
- **DSAR:** `virtualDataSubjects` exports watch time per session for the person's tickets; streams
  are not about anyone; viewings and minutes are kept as the meter (ticket ids only).
- **Dev/CI:** `/api/dev/virtual` (a conference under way with Ana's full pass and Ben's day pass).

**Later / not yet:**
- A virtual-only ticket is still admitted at the door (check-in does not read access modes yet;
  a same-tier port from check-in to virtual is the planned route).
- Mux Video API calls (create live stream, stream key, webhooks for stream state), HLS playback
  outside Safari (hls.js), captions, recordings/on-demand, Zoom (M6.9b/M6.10a), Cloudflare Stream
  and RTMP overflow (v2).
- The meter is not yet pushed to billing (M6.6b meters read `streamingUsageQuery` when merged).
- Stream setup for profiles without program sessions (weddings' livestream) and per-session
  access (today access is per ticket type for every stream of the event).
- U1 form controls (Select etc.) and U2 navigation were not on `merge/next-3u` when this was built;
  the page uses radio groups (no selects) and the conference profile's event nav.

### 4. Acceptance
| Criterion | Test |
|---|---|
| A playback token works only for its attendee and session, and expires | `packages/testing/tests/virtual.int.test.ts` › works only for its attendee and session, and expires; `packages/modules/virtual/tests/virtual.test.ts` › fake video provider / Mux adapter |
| Watch time counts once per minute (duplicates, tabs, replays and concurrent beats ignored) | `virtual.int.test.ts` › counts once per minute…; `virtual.test.ts` › watch time |
| An in-person-only ticket never gets a playback token | `virtual.int.test.ts` › an in-person-only ticket never gets a playback token; e2e › Ben's day pass |
| The virtual checkpoint, once per ticket and session; never offered to scanners | `virtual.int.test.ts` › feeds the virtual checkpoint once per ticket and session |
| Permissions, entitlement, tenant isolation | `virtual.int.test.ts` › organizer writes need events:write…; without the virtual module…; `isolation.int.test.ts` (fixture rows for both orgs) |
| Streams idempotent; the key is never stored and its reveal is audited | `virtual.int.test.ts` › streams: one per session… |
| The meter sums viewer-minutes | `virtual.int.test.ts` › the streaming meter… |
| E2E: organizer sets up a virtual session, the attendee watches, watch time and checkpoint appear | `apps/web/e2e/virtual.spec.ts` › organizer sets up… |
| Validation and refusals (forged link, no stream, fake CDN, heartbeat) | `virtual.spec.ts` › a forged watch link… |
| Viewer read-only; empty state | `virtual.spec.ts` › a viewer sees the setup read-only… |
| Keyboard only | `virtual.spec.ts` › keyboard only… |
| axe in both themes; Arabic RTL | `virtual.spec.ts` (every screen) › Arabic (RTL)… |

## M6.9b — Zoom and CE credits (done)

### 1. Goal and users
Organizers of conferences that award continuing-education (CE) credits deliver sessions as Zoom
webinars and give sessions credit rules; attendees earn credits from session door scans, heartbeat
watch time (M6.9a) and Zoom attendance, and receive a certificate (PDF, all 13 locales, Arabic
right to left) by email and on their order page, with a public verification code. Phase 6 plan
row M6.9B, decision P6-9 (Zoom for live webinars), P6-13 (entitlement `virtual`).

### 2. References
`docs/plans/phase-6.md` (P6-9, P6-13), M6.9a (this file), M6.4a integrations framework
(`packages/modules/integrations/MODULE.md`), M5.6a session doors (`checkin`), M4.8b receipts
(the legal-copy + PDF + signed-link pattern followed here), ADR 0017 (PDF via Gotenberg).

### 3. Scope
- **Zoom connector** (`integrations/src/connectors/zoom.ts`, through the `IntegrationAuth` port;
  Nango in production, the fake in dev and CI, `availability: 'general'`, entitlement `virtual`):
  - `registrants` (push): `virtual.zoom_registrants` rows → `POST /webinars/{id}/registrants`.
    **Never duplicates**: one row per session and ticket (and one per webinar and email); the
    engine's record link (one Zoom registrant per row); an `Idempotency-Key` per row and content
    (a send whose answer was lost is applied once); Zoom (and the fake) keep one registrant per
    address and webinar.
  - `participants` (pull): after a session ends (and for 30 days), the webinar's participant
    report (`GET /report/webinars/{id}/participants`, paged) → `virtual.zoom_attendance`, one row
    per join → leave segment, matched to the ticket registered with that email (unmatched
    participants are kept with no ticket and earn nothing). Stable record ids and a version of the
    segment's times: a report pulled again writes nothing. A webinar Zoom has no report for (404)
    is skipped.
  - **Framework change (additive):** `SyncIO.read(fn)` runs a read in the org's tenant transaction
    so a pull can scope its provider calls to what is linked here (the webinars to report on).
- **Virtual (tier 4)**: `zoom_webinars` (a session's webinar id, one per session and per org),
  `zoom_registrants`, `zoom_attendance`; `linkZoomWebinar` (events:write; normalizes "812 3456
  7890"; refuses in-person events and a webinar already linked to another session; re-linking
  moves registrants to the new webinar), `syncZoomRegistrants` (reconcile: holders with online
  access, renamed holders), the `virtual.zoom-registrants` subscriber (`order.paid@1`: new holders
  become registrants), `zoomSetupQuery` (counts only), `onlineAttendanceTx` for CE.
- **CE module** (`packages/modules/ce`, tier 5, schema `ce`): `settings` (credit name, accreditor),
  `session_rules` (credits in hundredths 1–10 000, minimum minutes 1–1440, count in person and/or
  online), `certificates` (one per ticket; code `XXXXX-XXXXX`, Crockford, unique per org; revision,
  content hash, status issued/revoked, holder name/email/locale), `awards` (the minutes and credits
  per session behind a certificate).
  - **Arithmetic** (`domain/credits.ts`, pure): minute buckets inside the session window; a visit
    (scan in → out; never scanned out: until the session ends) and a Zoom segment count every UTC
    minute they overlap; a watched minute is its own bucket; a minute counts once whatever covers
    it; a session qualifies at its minimum; the certificate totals qualifying sessions.
  - **`ce.calculate`** (events:write; the settings row is the lock): ended sessions only; same
    inputs → nothing changes and nothing is sent; a different result → a new revision (emailed);
    nothing qualifying any more (or a voided ticket) → withdrawn. Emits `ce.certificate_issued@1`
    and `ce.certificate_revoked@1` (ids and revision; internal events, `personal`).
  - **Certificate document** (`certificate-document.ts`) and its words
    (`legal/certificate-copy.ts`, **LEGAL-COPY: placeholder wording pending counsel**, 13 locales,
    `CERTIFICATE_COPY_VERSION` stored per certificate): A4 landscape, `dir="rtl"` for Arabic,
    session dates in the event timezone, credits in the holder's locale, the verification URL
    and code. The same words make the email body.
  - **Mail**: `ce.certificate-mailer` → notification kind `ce.certificate` (13 locales), once per
    revision (dedupe key), to the ticket holder only, with the signed PDF link
    (`ce.certificate` token).
  - **Public verification** (`public:ce`): status, a masked name ("Ana L."), event, organizer,
    accreditor, credits and dates; never the address, the ticket or the full name.
- **Web**: the conference nav's **CE credits** page (`/o/{org}/e/{event}/ce-credits`, build group,
  `virtual` module): one primary action (Calculate credits and issue certificates) with its
  summary, certificate details form, a rule form per session (inline validation for credits,
  minutes and the attendance kinds), the certificates table with each PDF; read-only for viewers;
  empty states with their next step. The **Stream setup** page gets a **Zoom webinars** section
  (connect hint, a webinar ID form per session, registrants/attended counts, Sync with Zoom now).
  Public: the holder's PDF `/{locale}/certificates/{org}/{token}` (`?format=html` for the HTML
  alternative), the verification page `/{locale}/certificates/{org}/verify/{code}` and the code
  form `/{locale}/certificates/{org}/verify` (no script needed). The order page shows **Download
  your CE certificate** per ticket with an issued certificate. Messages in 13 locales (`ce.*`,
  `virtual.zoom.*`, `nav.ceCredits`, `notifications.kinds.ce.certificate`, Zoom's
  `integrations.*` labels).
- **DSAR**: `ceDataSubjects` exports and deletes the person's certificates and awards; virtual's
  contributor now exports Zoom registrations and attendance, deletes registrant rows and redacts
  attendance (times kept, no address or ticket).
- **Dev/CI**: `/api/dev/ce` (a hybrid conference with two ended sessions, Ana's 50 minutes at the
  keynote door and 15 minutes watched online, Ben's 20 minutes, recorded through the real
  commands at past times), `/api/dev/zoom` (attend at the fake Zoom; list its registrants).

**Migration:** one generated migration (`0141_greedy_mathemanic.sql`, renumbered at merge): schema
`ce` and its four tables, three `virtual.zoom_*` tables, FORCE RLS; hand-written block: the
cross-module composite FKs to `events.events`, `program.sessions` and `ticketing.tickets` (cascade;
`zoom_attendance.ticket_id` is `ON DELETE SET NULL ("ticket_id")`).

**Later / not yet:**
- Calculation runs when the organizer presses the button (and is idempotent); a worker pass after
  sessions end is later.
- A transferred ticket's old Zoom registrant is not cancelled at Zoom yet (the new holder is
  registered); Zoom join/leave webhooks (live attendance) and creating webinars from Yayatoh are
  later; registrants' personal join links are sent by Zoom's own confirmation email.
- Two tickets with one holder email register once per webinar; their Zoom minutes land on the
  first ticket registered.
- Prorated credits (credits per hour attended) and per-ticket-type rules.
- Zoom Marketplace app review and the Nango Zoom integration (owner inbox).

### 4. Acceptance
| Criterion | Test |
|---|---|
| A fixture attendee's CE certificate reproduces exactly from scans and watch time | `packages/testing/tests/ce-credits.int.test.ts` › a fixture attendee's certificate reproduces exactly from scans, watch time and Zoom (golden certificate text); `packages/modules/ce/tests/credits.test.ts` (bucket arithmetic) |
| An attendee below the threshold gets no certificate | `ce-credits.int.test.ts` (Ben, Cara); e2e › Ben has no link |
| Re-running the calculation is idempotent | `ce-credits.int.test.ts` › re-running the calculation is idempotent; e2e › "Unchanged: 1" |
| Zoom registrant sync never duplicates registrants | `ce-credits.int.test.ts` › linking a webinar registers every holder… once (lost answers re-sent with the same keys), › a new holder (order.paid)…; e2e › Zoom: … registrants sync once |
| Revisions, withdrawals, mail once per revision | `ce-credits.int.test.ts` › a stricter rule revises… |
| Public verification never shows the full name or address; other orgs can't read it | `ce-credits.int.test.ts` › the public verification and the order page link…; e2e › verify |
| Permissions, entitlement, tenant isolation | `ce-credits.int.test.ts` › organizer views…; `isolation.int.test.ts` (fixture rows for both orgs: `packages/testing/src/ce.ts`) |
| E2E: configure CE rules, attend (scan + fake watch time), receive the certificate | `apps/web/e2e/ce-credits.spec.ts` › an owner sets CE rules and calculates; the attendee receives, downloads and verifies… |
| RTL certificate | `ce-credits.spec.ts` › Arabic (RTL): the CE page, the certificate and its verification; `ce-credits.int.test.ts` (Arabic text) |
| Keyboard only; axe both themes; RTL | `ce-credits.spec.ts` › a viewer sees CE credits read-only; keyboard only…; axe on every screen |
