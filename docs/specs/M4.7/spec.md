# Spec: M4.7 — Mobile-web guest hub

- **Milestone:** M4.7 (roadmap §10 Phase 4 "Guest features ship as mobile-first web pages plus Wallet passes (M4.7, M5.10)"; Phase 4 plan `docs/plans/phase-4.md`, row M4.7a)
- **Status:** M4.7a built (2026-10-03)
- **Risk tags:** `tenancy`, `infra` (proxy header, root layout messages, CI step); no migration
- **Related ADRs:** 0018 / 0022 (tokens and design v2 components only), 0019 (toolchain)

## M4.7a — mobile-web guest hub (done)

### 1. Goal and users
A wedding or gala party gets **one page on their phone** with everything for the day: their RSVP
(and a way to answer or change it), the parts of the celebration they're invited to, their seats
once the hosts share the seating, and their tickets with the door QR codes. No app: the page adds
itself to the home screen, opens offline at the venue, and can be saved as a wallet pass.

### 2. References
- **Plan row:** M4.7a "One page per party covering RSVP, seat, tickets and program, installable to the home screen. A Wallet pass port with a fake adapter; live passes need your Apple and Google accounts (M1.5e2)". Acceptance: "Lighthouse mobile thresholds met; no app install needed".
- **Decisions:** P4-2 (party magic link is the key), P4-3 (guest privacy: nothing private, nobody outside the party, never indexed, never marketing). Roadmap §8.3 (no native apps in this build), §9 / M1.11 (public pages: Lighthouse performance ≥ 90).
- **Builds on:** M4.1d RSVP link and page, M4.1c sub-events and invitations, M4.5a guest website, M1.7c/d/e seats and the seat finder, M4.2b gala tables (a guest's ticket), M3.10c wallet pass port (ticketing), the M1.14a token-page CSP.

### 3. Scope
**In (built):**
- **Page** `/{locale}/hub/{token}` (`apps/web/src/app/[locale]/hub/[token]/page.tsx`), phone first with design v2 components only: the party's welcome and the event's dates; "On this page" jump links (44 px); **Up next / Happening now** (the next part of the celebration, in the event's time zone); **RSVP** (state pill "Waiting for your answer / Answered / RSVPs closed", counts attending / can't attend / awaiting over every invitation of the party, the deadline or the answered date, the one primary action "Answer the RSVP" / "Change your answers" / "See your answers" to `/rsvp/{token}`); **Program** (`ScheduleLane`: only the sub-events the party is invited to, now/next/over, "N going" or "No answer yet"); **Your seats** ("Table 4 · Seat 2", published table sponsors, "N people have no seat yet"; "Seating isn't shared yet" until the host opens the seat finder; "No seats for your party yet"); **Tickets** (QR code, type, holder, short code; "No tickets needed" otherwise); **Keep this page handy** (add to home screen, wallet passes, the hosts' guest website when published, "don't share the link"). An expired link shows the event's name and "ask the hosts for a new link" only. The first open records `viewed` like the RSVP page.
- **Data** (`guests`, `src/hub.ts`): `partyHubQuery(readers)`, permission `public:rsvp`, entitlement `guests`; the party comes from the signed RSVP token (`linkPartyTx`), the org from the token (`rsvp_link_org`), never a header. Seats and tickets belong to seating and ticketing (same tier), so the app passes their readers in: `partySeatsTx` (seating; the seat finder's answer for the party's guest-list entries and tickets, null while the finder is closed) and `partyTicketsTx` (ticketing; active tickets with their current signed code). The output `PartyHubDto` is the allowlist: no attendee, contact, order or party ids beyond the guests' own ids, no private answers (dietary, access, address, meal), nobody outside the party. Pure rules in `domain/hub.ts` (`hubTally`, `nextProgramItem`, `guestPassContent`, `guestPassSerial`).
- **Installable, no app:** a per-party web app manifest at `/hub/{token}/manifest` (start URL and scope = the party's page, named after the event, in the visitor's language and direction, PNG icons 192/512 plus a maskable 512; `private, no-store`); apple-touch-icon and icon links; `HubInstall` registers `public/hub-sw.js` with the page's own path as scope and opens Chromium's install prompt where offered, else writes out the iPhone/Android steps. The service worker keeps the last copy of that page (network first; the saved copy when offline, with an "You're offline" note; a 404 after a reset drops the copy) and Next's hashed assets.
- **Wallet pass port** (`guests`, `src/wallet-pass.ts`): `GuestPassProvider.issuePass({ platform: apple | google, content, barcode, locale, labels, when })` → a file, a redirect or unavailable. `fakeGuestPassProvider` records each issue and returns a JSON stand-in (`application/vnd.yayatoh.fake-pass+json`). The route `/hub/{token}/pass/{apple|google}` builds the pass from the hub's allowlisted payload (event, envelope name, when and where the first invited part starts, seats once shared, at most six plus "+N"); its QR code opens the hub; one serial per party (`yyg-{partyId}`), so a re-issue updates the same pass.
- **Private by construction:** page type `token` for `/hub` (strict CSP, `Referrer-Policy: no-referrer`, never framed, `X-Robots-Tag: noindex`), `robots` meta `noindex, nofollow`, `Disallow: /hub/` in robots.txt, no sitemap entry; the front door treats `/hub` as a new-app path.
- **Lean page:** the root layout sends client components the whole message catalogue (~500 KB) unless proxy.ts marks the request with an intl scope (`apps/web/src/lib/intl-scope.ts`; the header is stripped from clients). The hub's scope sends only `hub`, so its HTML is ~65 KB instead of ~520 KB. Because a client-side navigation keeps the layout, the hub links out with plain links (full page loads).
- **Host:** the party's RSVP page in the console shows "Guest page link for {party}" (copy) under the RSVP link, for hosts with `guests:write` (viewers see no links). The guest's RSVP page links to "your guest page".
- **Messages:** `hub.*` (54 keys) and `rsvpHost.hubLinkLabel` / `hubLinkHint` in all 13 locales with per-locale plurals (Arabic zero–other, Russian one/few/many/other, Japanese and Chinese other).

**Later / not yet:**
- Live Apple and Google passes (owner accounts, M1.5e2) and pass updates pushed when seats or times change (the serial is ready for it); voiding a party's pass when its link is reset (today the pass's QR simply stops opening anything).
- Tablemates for parties signed in through their link, the map highlight and the guest seat finder modes (M4.4a); guest check-in from the hub's QR (M4.4b).
- Guest seating from the M4.3a editor (today seats come from the seat assignments and seated tickets the seat finder already reads).
- The leak crawler visiting a canary party's hub with its own allowlist (M4.x hardening: no new tables here).
- Sending the hub link with invitations and reminders (invitations carry the RSVP link, whose page links to the hub).
- The same lean-messages scope for other public pages (event pages, checkout, RSVP): see the owner inbox finding.

### 4. Acceptance
| # | Criterion | Test |
|---|---|---|
| AC1 | **Lighthouse mobile thresholds met**: Lighthouse's mobile profile (simulated slow 4G, 4× CPU), median of 3 runs on a hub with a seat and a ticket: performance ≥ 0.90, accessibility ≥ 0.95, best practices ≥ 0.95, CLS ≤ 0.1, mobile viewport | `apps/web/e2e/guest-hub-lighthouse.spec.ts` (project `lighthouse`, run alone: `pnpm --filter @yayatoh/web e2e:lighthouse`; CI after shard 5's suite) |
| AC2 | **No app install needed**: a per-party manifest (start URL, scope, standalone, icons that load), apple touch icon, the service worker scoped to the party's page, the saved copy opening offline with the offline note | `apps/web/e2e/guest-hub.spec.ts` ("installable with no app …") |
| AC3 | One page per party with RSVP, program, seat and ticket; answering updates it; saved after reload; only the party's own people and parts | `guest-hub.spec.ts` (first test), `packages/testing/tests/guest-hub.int.test.ts` |
| AC4 | Empty states: no tickets, no seats yet, seating not shared (tickets still shown) | `guest-hub.spec.ts` ("empty states …"), `guest-hub.int.test.ts` |
| AC5 | Wallet pass port with a fake adapter: both platforms download a pass with event, party, when, where, seat; QR opens the hub; nothing private | `guest-hub.spec.ts` ("wallet passes …"), `guest-hub.int.test.ts` ("the guest wallet pass"), `packages/modules/guests/tests/hub.test.ts` |
| AC6 | The link is the only key: reset link → page, manifest and pass 404; expired link → event name only; another org's context and forged tokens fail | `guest-hub.spec.ts` ("the link is the key …"), `guest-hub.int.test.ts` |
| AC7 | Privacy (P4-3): allowlisted keys only; no private answers, contact or attendee ids; no-referrer, noindex, never framed, robots disallow | `guest-hub.int.test.ts` ("never carries private answers", key list), `guest-hub.spec.ts` ("a private, lean page …") |
| AC8 | Lean page: only the hub's messages travel; a client can't scope another page (header stripped) | `guest-hub.spec.ts` ("a private, lean page …"), `apps/web/tests/intl-scope.test.ts` |
| AC9 | Keyboard only: jump to a section, open the RSVP | `guest-hub.spec.ts` ("keyboard only …") |
| AC10 | axe in light and dark on every state; Arabic right to left (page and manifest) | `guest-hub.spec.ts` (each test; "Arabic, right to left"), `apps/web/tests/messages.test.ts` |
| AC11 | Host copies the hub link; viewers see none; the hub links to the published guest website | `guest-hub.spec.ts` ("the link is the key …", "a viewer sees no guest page link …") |
| AC12 | Tenant isolation: ticketing's reader under RLS never returns another org's or event's ticket | `guest-hub.int.test.ts` ("ticketing's reader …") |
| AC13 | Pure rules: tally, up next (now / next / over, end exclusive), pass content (relevance, expiry, clipping, seat cap) | `packages/modules/guests/tests/hub.test.ts` |

**Lighthouse numbers (local, 2026-10-03, built app, run alone):** performance 0.95–0.96, accessibility 1.0, best practices 1.0, CLS 0, TBT 100–200 ms, simulated LCP 2.1–3.0 s. Lighthouse's simulated LCP on this page is set by the framework's own scripts every page loads (Next's root bundle, about 260 KB compressed), not by the hub, so it is recorded with each run rather than gated; the performance score (which weighs it) is. Before the lean-messages scope the hub scored 0.82–0.90 with 340–360 ms of blocking time.

**Gate (M4.7a, 2026-10-03, on the build branch + merge/next-3g + merge/next-3h + agent/m4.5a):** lint and check:modules clean; typecheck 59/59; unit 2707 passed; integration 1522 passed (166 files, isolation included). e2e on all three projects: `guest-hub.spec.ts` 27/27; `guest-hub-lighthouse.spec.ts` (project `lighthouse`, alone) passed; related specs `rsvp`, `guest-site`, `guest-invites`, `security`, `noindex`, `front-door`, `theme`, `maintenance`, `seo`: 290 passed, 28 skipped (their own project-conditional skips), 0 failed.
