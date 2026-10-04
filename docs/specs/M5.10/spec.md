# Spec: M5.10 — Attendee conference hub

- **Milestone:** M5.10 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, row M5.10a)
- **Status:** M5.10a built (2026-10-03)
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** M5.2a/b (agenda, enrollment and "My schedule"), M5.7a (polls and Q&A), M5.8a
  (networking), M5.5a (badge QR = the ticket code, ADR 0011), M4.7a (guest hub: installable
  page, intl scope, Lighthouse harness), M1.14a (strict CSP, rate limits); owner decisions P5-1,
  P5-9 (favorites without enrolling), §8.3 (native apps deferred)

## M5.10a — Attendee conference hub (done)

### 1. Goal and users
One mobile-first page per registrant, reached from the order page by its manage link (no account,
no app): what is on now and next (with the session's polls and Q&A), the agenda with stars
("favorites") and enrolment, the personal schedule (enrolled vs starred, with overlaps flagged),
a signed calendar feed that follows the organizer's changes, the badge QR, and the way into
networking; installable to the home screen and readable offline. Native apps stay deferred (§8.3).

### 2. References
- **Phase 5 plan:** row M5.10a ("One mobile-first page per registrant: agenda, personal schedule
  (favorites vs enrolled, conflict prompts), signed ICS feed, badge QR, polls and Q&A for the
  current session, networking entry; installable to the home screen"; acceptance "Lighthouse
  mobile thresholds met; the ICS feed updates when a session moves").
- **Legacy evidence:** none (Eventmie Pro has no attendee app).

### 3. Scope (built)
**Model** (module `registration`, tier 5; migration `0114_cold_expediter.sql`, renumbered at merge):
- `session_favorites` (event, session, registrant = admission ticket): one row per registrant and
  session. A favorite holds no place.
- `calendar_feeds` (event, registrant, `version` 1…1,000,000): the feed link's version; no row =
  version 1. "Replace the link" bumps it.
- Both: `org_id`, ENABLE + FORCE RLS (NULLIF policy), org-leading indexes, composite FKs
  (hand-written, down the tiers to `events.events`, `program.sessions`, `ticketing.tickets`, cascade),
  fixture rows for both orgs. No text/jsonb columns (nothing for `private-columns.ts`).
- SECURITY DEFINER `registration.calendar_feed_target(org, registrant)`: event id and feed version
  only, for an active ticket of a live org (like `engagement.display_target`); EXECUTE to `app_user`.

**Pure rules** (`registration/src/domain/hub.ts`): `overlaps` (half-open), `favoriteDecision`
(no-op / add / refuse with the sessions in the way; `keep_both`; `replace` un-stars overlapping
favorites and is refused while an enrolment is in the way; at most 300), `scheduleConflicts`,
`nowAndNext` (12 h window, ties together), `signFeedToken` / `verifyFeedToken`
(`{org}~{registrant}~{version}~{hmac}` under the app token secret, its own purpose string,
constant-time), `calendarFeedIcs` (UTC times, stable `UID` per session, `SEQUENCE` and
`LAST-MODIFIED` from the session's or its room's last change, CONFIRMED for enrolled, TENTATIVE for
offered or starred, RFC 5545 escaping and 75-octet folding, `REFRESH-INTERVAL` 1 h; no links or
names).

**Commands and queries** (`registration/src/hub.ts`; `public:enrollment`, entitlement
`registration`, the manage link re-checked in every call):
- `favoriteSession` (star / un-star, idempotent; `conflict` with the sessions in the way and
  whether "replace" is offered; a per-registrant advisory lock serializes decisions), audited.
- `rotateCalendarFeed` ("Replace the link"), audited.
- `conferenceHub` (allowlisted `ConferenceHubDto`: event basics, the order's registrants, every
  session the registrant's items give with M5.2b's state, `favorite`, `onSchedule`, `conflicts`,
  and the feed version).
- `calendarFeed` (by a verified link: the version is checked again under RLS) and
  `calendarFeedTarget(token, secret)`.
- Program gains `sessionStampsTx` (when a session or its room last changed). M5.2b's enrollment
  helpers (`registrantOfLinkTx`, `availableTx`, `liveEntriesTx`, `stateOf`, `positionOf`, …) are
  exported inside the module for reuse; no logic change.

**Web** (`apps/web`):
- **Hub** `/orders/{token}/hub` (`?registrant=` picks one of an order's registrants; `?view=`
  `today | schedule | agenda | badge`), linked from the order page ("Open my conference hub").
  - *Today*: "Happening now" and "Up next" from the personal schedule (or, when it is empty, the
    included sessions), "Polls and Q&A" (the one primary action) for sessions with M5.7a engagement
    on a public event, then "Your tools": badge, networking (M5.8a, when on), calendar, install.
  - *My schedule*: enrolled, offered, waitlisted and starred sessions by day in the event's time
    zone with "Overlaps …" markers and a summary; the calendar feed (subscribe via `webcal:`,
    download, copy, "Replace the link" behind a confirmation).
  - *Agenda*: every session the registrant's items give, with its state, the star (toggle,
    `aria-pressed`; conflict prompt with "Keep both", "Replace", "Cancel", focus moved to it) and
    M5.2b's enrolment buttons.
  - *Badge*: the admission ticket's signed yy1 QR (the same code the Scan PWA reads), name, type
    and short code.
  - Empty states say what to do next; success is announced politely; refusals are inline; 44 px
    targets; tokens and `@yayatoh/ui` components only; strict CSP (no inline styles); 13 locales
    (namespace `conferenceHub`) with Arabic RTL. Rate limited with M5.2b's `sessionEnrollment` policy.
- **Calendar feed** `/api/calendar/{signed}.ics`: `text/calendar`, `private, no-cache`, an ETag
  (304 when unchanged), `noindex`; a forged or replaced link, a cancelled ticket or a suspended org
  is a 404.
- **Installable**: a per-registrant manifest (`/orders/{token}/hub/manifest`: start URL the hub,
  scope the hub's path, standalone, PNG icons 192/512 + maskable, the visitor's language and
  direction), `apple-touch-icon`, a service worker (`public/conference-hub-sw.js`) scoped to the
  hub that keeps the last copy of each view for offline use (a 404 drops it), the install prompt
  where offered and written steps elsewhere.
- **Lean page** (Lighthouse): the hub sends client components only the `conferenceHub`,
  `mySchedule` and `errors` namespaces through M4.7a's intl scope (`src/lib/intl-scope.ts`, a
  superset of M4.7a's file; the layout and proxy hunks are M4.7a's, byte for byte). Links leave
  the hub with full page loads.

### 4. Later / not yet
- Embedding the live poll in the hub (today it links to M5.7a's participant page, which only
  exists for published, non-private events).
- Speakers and tracks on the hub's agenda cards; session feedback (M5.7b); session check-in
  (M5.6a); the networking booth link (M5.8a's "Later").
- Wallet passes for the badge (M4.7a's port could serve it); push reminders before a starred
  session.
- Hub on an org's own site (tenant host) and a `/v1` hub API (mobile apps are not built here).
- The canary crawl does not visit a hub yet (its tables have no text columns; every payload is an
  allowlist).
- Owner decisions pending: see `docs/owner-inbox.md` (M5.10a).

### 5. Acceptance (M5.10a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | **Lighthouse mobile thresholds met** (performance ≥ 0.90, accessibility and best practices ≥ 0.95, CLS ≤ 0.1, median of 3, default mobile profile) on the hub's today and agenda views | `apps/web/e2e/conference-hub-lighthouse.spec.ts` (`pnpm --filter @yayatoh/web e2e:lighthouse`, also in CI after shard 5; 2026-10-03, two runs: today 0.90 and 0.93, agenda 0.91 and 0.91 performance; accessibility 1, best practices 1, CLS 0) |
| AC2 | **The ICS feed updates when a session moves** (same UID, new DTSTART/DTEND, higher SEQUENCE; unchanged sessions keep theirs; un-starring removes it) | `packages/testing/tests/conference-hub.int.test.ts` ("the ICS feed updates when a session moves"); `packages/modules/registration/tests/hub.test.ts`; e2e "calendar feed: … it follows a moved session …" |
| AC3 | Signed feed: forged, other-secret, cross-org and replaced links refused; a cancelled ticket ends it; ETag 304 | `conference-hub.int.test.ts` ("a forged, replaced or cross-org link …"); `hub.test.ts` (tokens); e2e (304, replace, forged 404) |
| AC4 | Favorites vs enrolled; conflict prompts (refuse with the sessions in the way, keep both, replace favorites only, never an enrolment); concurrent overlapping stars: one wins | `hub.test.ts`; `conference-hub.int.test.ts` (favorites describe); e2e "agenda: star, conflict prompt …" |
| AC5 | Only sessions the registrant's items give can be starred | `conference-hub.int.test.ts` ("only sessions the registrant's items give …") |
| AC6 | Badge QR = the admission ticket's code | e2e "today: … badge" (QR image named for the holder); code from `orderByManageToken` (M5.5a: badge QR = ticket code) |
| AC7 | Polls and Q&A for the current session; up next; networking entry | e2e "today: …" (link to `/events/{slug}/live/{session}` opens the participant page; networking link) |
| AC8 | Installable: manifest (start URL, scope, standalone, icons, language and direction), service worker scoped to the hub, install steps | e2e "installable: …"; Arabic manifest in the RTL test |
| AC9 | Isolation (another org, forged registrant, raw rows under the other org's RLS) and fixture rows for both orgs | `conference-hub.int.test.ts` ("another org sees nothing …"); `isolation.int.test.ts` |
| AC10 | Gated by the `registration` module | `conference-hub.int.test.ts` ("a revoked registration module …") |
| AC11 | Freeze and impersonation sweeps cover the new commands | `freeze.int.test.ts`, `impersonation.int.test.ts` (whole-module sweeps) |
| AC12 | 375/768/1280, keyboard only, axe light and dark on every view and state, empty states, persistence after reload, Arabic RTL; messages in 13 locales | `apps/web/e2e/conference-hub.spec.ts`; `apps/web/tests/messages.test.ts`; `apps/web/tests/intl-scope.test.ts` |

### 6. Gate (2026-10-03, after merging the build branch and `merge/next-3h`)
- lint, check:modules, typecheck (59 packages, turbo `--concurrency=2`), 2,718 unit tests: green.
- Integration: 1,528 of 1,528 passed (166 files; isolation, freeze and impersonation sweeps included).
- E2E (375/768/1280, `--workers=2`): `conference-hub.spec.ts` 18/18; related `enrollment`, `checkout`,
  `security`, `noindex`, `front-door`, `theme`, `maintenance`, `seo`, `engagement`, `canary-crawl`,
  `networking`: 292 passed, 44 skipped (the specs' own skips), 0 failed. Lighthouse project: 2/2.
- The whole web suite was not run (builder rule, 2026-10-03); the root layout and `proxy.ts` hunks
  are M4.7a's, so the merge batch's full run covers them.
