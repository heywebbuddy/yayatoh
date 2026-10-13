# Phase 7 plan — Mobile apps

Status: **build started 2026-10-13 at the owner's request.** The owner asked to build the mobile apps now, **from scratch** (the current React Native store apps are not reused), as fast as possible, and chose **Expo** over fully native Swift/Kotlin (`docs/decisions.md`, 2026-10-13). P7-2 is decided. The other decisions are built as recommended unless the owner changes them. Build sessions run on Sonnet 5.5 at high effort. This replaces the 2026-09-26 decision "mobile apps planned, not built in this build" and roadmap §8.3. Background research: `docs/research/36-gap-mobile-roadmap.md`. Its `/v3` endpoint names and its OAuth/PKCE login are out of date: the API is `/v1` with opaque bearer tokens (M1.2f).

Prices marked UNVERIFIED are from memory or old research. Check them before signing anything.

## 1. What I'm asking you to decide

| # | Decision | Recommendation |
|---|---|---|
| P7-1 | **When to build.** Everything the apps need on the server is additive `/v1` work over commands that already exist (ADR 0002), so like P3-1 to P6-1 it needs no cutover. | Wave 1 (server sign-in, links and app foundations) starts as soon as cloud slots free; each later wave starts when the one before merges. `auth`, `payments`, `tenancy` and `mobile-contract` increments wait for your approval before `main`, as usual. |
| P7-2 | **Framework** (decided 2026-10-13). | **Expo SDK 57** (React Native 0.86, New Architecture, Hermes) with Expo Router, and EAS Build, Submit and Update. Native code only as small Expo modules where a feature needs it (later: Wallet extras, Live Activities, Zebra scanners). Fully native Swift/Kotlin was considered and rejected: four projects instead of two, door rules duplicated in three languages, no over-the-air fixes during events, and iOS builds only on macOS. |
| P7-3 | **How many apps.** | **Two apps from one repo.** **Yayatoh** (`apps/mobile`) for buyers, guests and attendees. **Yayatoh Staff** (`apps/staff`) for door staff, session scanners, exhibitor reps and organizers on event day. Both share `packages/mobile-core`. The encrypted offline door list never ships in the consumer app, and each app gets a focused store review. Runner-up: one app with a staff mode. |
| P7-4 | **The current store apps** (Yayatoh and ABC Chicago). | **Use the existing listings if we can.** The new attendee app goes on the existing Yayatoh listing (same bundle ID and package name), which keeps installs and ratings. That needs App Store Connect and Play Console access plus Android signing (Play App Signing or the upload key). Without them, it gets new listings.<br>**Don't build the `/api/v2` facade (ADR 0007).** Old installs keep working until the yayatoh.com cutover and then stop, so **the new app must be in the stores before B-Y**. A new ADR (0026) supersedes 0007.<br>**ABC Chicago:** leave the app alone until ABC 2026 is over, then remove it from sale. ABC attendees use the Yayatoh app through `abc.yayatoh.com` links. |
| P7-5 | **How attendees sign in** (`auth`). | **Email code**: the first sign-in creates an account, and the code verifies the email. Also **Sign in with Apple**, **Google**, and a password for people who already have one. Accounts with two-factor get a TOTP step. Tickets are found by verified email, exactly as on the web's My tickets. The web's email-code guest session stays web-only. |
| P7-6 | **How staff sign in** (`auth`). | **Door devices enrol by QR**, like the Scan PWA. An organizer shows an enrolment QR (the `yyd_` device token) and the Staff app scans it, so the device needs no personal account; revoke and remote wipe work as today. **Organizers** sign in with their account (TOTP required) for the event-day view. **Exhibitor reps** sign in to their portal by email code (P5-7) and use their lead licence (P5-4). |
| P7-7 | **Payments in the app** (`payments`). | **Stripe Checkout** (already built), opened in a secure in-app browser session that returns to the app.<br>No Apple or Google in-app purchase: event tickets are physical services (App Review 3.1.3(e)).<br>**Virtual and livestream access is not sold in the app**, because Apple requires in-app purchase for one-to-many live services; those ticket types show "Buy on the web".<br>Carts that need checkout questions, seat selection, approval or a transfer fee also finish on the web checkout, in the same browser session.<br>A native payment sheet with Apple Pay and Google Pay comes later. |
| P7-8 | **Push notifications** (`legal-copy`). | **When to ask:** after the first purchase or when a ticket is first opened, never at launch.<br>**Lock screen:** no personal data, only the event name and what changed.<br>**Types:** order confirmed, ticket received or transferred, event changed or cancelled, reminders 24 h and 2 h before start, and staff alerts.<br>**Marketing pushes** stay off unless the person opts in through the consent ledger. |
| P7-9 | **Releases and updates.** | **Store builds** about every 4 weeks, with phased release on Apple and staged rollout on Play.<br>**JavaScript fixes** go over the air with EAS Update (`fingerprint` runtime versions).<br>**Event freeze:** no store builds in the 72 h before a large event; over-the-air fixes only.<br>**Minimum version:** enforced by a `426 Upgrade Required` from `/v1`, but **never for a Staff device during its event window** (24 h before start to 2 h after end).<br>**Support window:** the current and two previous versions. |
| P7-10 | **Devices and OS versions.** | Expo SDK 57's defaults (iOS 16.4+, Android 7+; UNVERIFIED until M7.1b checks). The Staff app supports iPad (doors often use iPads) and Android scanners; the attendee app is phone-first and also runs on iPad. |
| P7-11 | **Crash and error reporting.** | **Sentry** (`@sentry/react-native`; roadmap §3.1 already names Sentry), with personal data scrubbed before sending. Free or Team tier at first (UNVERIFIED). |
| P7-12 | **Out of scope for Phase 7.** | Tenant-branded apps (M6.13), a Tap to Pay box office, interactive seat selection (read-only "find my seat" is in M7.6), attendee-to-attendee chat, kiosk mode, the LAN hub, Apple Watch, widgets and Live Activities. |
| P7-13 | **Paid or free.** | The apps are free for every org: they are a channel, not a module. Features inside them keep their existing entitlements (lead licences P5-4, the conference pack P5-11, and so on). |

## 2. Starting point

**Built and merged:**
- **`/v1` API:** Hono with `@hono/zod-openapi` (`packages/api-v1`), served at `app.yayatoh.com/api/v1`. It has OpenAPI in `apps/api/openapi.json`, Spectral and oasdiff gates (changes must be additive), and a generated SDK.
  - The SDK (`packages/sdk`, openapi-fetch) uses only `fetch` and already sends `X-Yayatoh-Client`.
  - Swift and Kotlin clients are generated in CI (`sdk-mobile`) but not used.
- **Bearer sign-in:** `POST /v1/auth/token` returns a 15-minute opaque access token and a rotating 30-day refresh token (`yyr_`). Reusing a refresh token revokes its whole family (M1.2f).
- **`GET /v1/mobile/config`:** minimum and latest versions, base URLs and feature flags (`MOBILE_CONFIG_JSON`).
- **Scanner routes on `/v1`** with device tokens (`yyd_`): manifest, `scans/batch`, heartbeat, check-ins and session override (`packages/modules/checkin/src/routes.ts`). Device enrolment, revoke and remote wipe live in `devices.ts`.
- **Shared door logic:** the offline check-in engine (`packages/checkin-engine`) and the Ed25519 QR format (`packages/ticket-crypto`, ADR 0011). Both are "universal" packages.
- **Push:** tokens are modelled for `fcm | apns | webpush` (`notifications.push_tokens`) behind a `PushTransport` port with `routedPushTransport`. Only web push is real.
- **Wallet passes:** a `WalletPassProvider` port with a fake. The real Apple and Google adapters wait for your accounts.
- **Design and languages:** design tokens are plain TypeScript with hex colours (`packages/ui/src/tokens.ts`, importable as `@yayatoh/ui/tokens`). The web has 13 locales with Arabic RTL.

**Not built (Phase 7 builds it):**
- **Attendee routes on `/v1`:** my tickets and orders, ticket QR, refund requests, transfer and claim, wallet links, event search and checkout. The web reaches these through Server Actions and an email-keyed guest session.
- **Sign-in on `/v1` other than password:** no email code, no Apple or Google id_token and no two-factor step. Two-factor accounts are refused today, so **no organizer could sign in to an app**. Bearer sessions also have no step-up, so account deletion over `/v1` fails.
- **Native push:** no APNs or FCM sender, and no `/v1` route to register a phone.
- **Deep-link files:** `apple-app-site-association` and `assetlinks.json` (nothing serves `/.well-known/`).
- **A `426` upgrade path:** `X-Yayatoh-Client` is read for telemetry only.
- **Staff tools on `/v1`:** `/api/scan/{staff,guests,assistance,leads,push}` are web route handlers. Leads use the exhibitor portal cookie.
- **React Native support in the universal packages:** `ticket-crypto` and `checkin-engine` use `crypto.subtle` (Ed25519 and SHA-256), which Hermes doesn't have. They also have no fixed test vectors.

## 3. Increments

18 increments in four waves. Each is sized for one agent session. A wave starts when the one before it is merged; increments inside a wave run in parallel. To go faster, two Wave 2 increments (M7.2c and M7.2e) start early, with Wave 1, stacked on M7.2a's branch. Anything that needs an account you don't have yet runs against a fake.

**New apps and packages** (M7.1b writes ADR 0025):
- `apps/mobile`: Yayatoh, the attendee app (Expo Router).
- `apps/staff`: Yayatoh Staff (Expo Router).
- `packages/mobile-core`: sign-in and token storage, the `/v1` client and query cache, theme, translations, push registration, deep links and the version gate. React Native only; the web never imports it.
- A new check-modules rule: the apps may import only universal packages, `@yayatoh/sdk`, `@yayatoh/ui/tokens` and `mobile-core`. They never import a module or the database.

**How mobile work is tested** (details in `docs/agent-briefs/mobile-common.md`):
- **Server increments** follow `common.md` unchanged: integration tests on Postgres, isolation tests, oasdiff, and a regenerated SDK.
- **App increments** use unit and component tests (jest-expo with React Native Testing Library), `expo export` for both platforms and `expo-doctor`. Cloud sessions run Linux and have no simulator, so they also write the Maestro flows but can't run them.
- **A device pass** ends each app wave:
  1. Maestro flows run on the iOS simulator and Android emulator (on the Mac or in EAS Workflows).
  2. An accessibility check: VoiceOver, TalkBack, the largest text size, and Arabic RTL.
  3. Preview builds go to you on TestFlight and the Play internal track.

### Wave 1 — sign-in, links and foundations (no app screens)
| Increment | Scope | Acceptance |
|---|---|---|
| **M7.1a** Universal crypto and test vectors | Move `ticket-crypto` and `checkin-engine` from `crypto.subtle` to `@noble/curves` and `@noble/hashes`, so the same code runs in browsers, Node and Hermes. Commit fixed test vectors covering keys, codes (valid, tampered, wrong key, superseded `rev`, legacy), manifests, and scan sequences with their expected verdicts (the ADR 0011 table). Add a check-modules rule: no `crypto.subtle` in universal packages. | Every vector gives the same verdict in Node and through the Scan PWA; existing offline tests pass unchanged; codes issued by the server verify; a Node benchmark is recorded |
| **M7.1b** Expo workspace (`infra`) | `apps/mobile` and `apps/staff` on Expo SDK 57 with Expo Router and development builds; `app.config.ts` per environment (names, bundle IDs, API URL, link domains); `eas.json` profiles without credentials; pnpm and Metro set up for the monorepo; jest-expo; a `mobile` CI job; check-modules rules for the apps; ADR 0025 (mobile apps) and ADR 0026 (no `/api/v2` facade) as drafts for your approval | Both apps export for iOS and Android in CI; importing `@yayatoh/db`, a module, `next` or `react-dom` from an app fails `check:modules`; the web's React version and build are unchanged |
| **M7.2a** App sign-in (`auth`, `mobile-contract`) | On `/v1/auth`: an email-code request and `email_code` grant; `apple` and `google` grants that verify a native id_token; a two-factor step (a single-use challenge, then TOTP or a backup code); `POST /v1/auth/step-up` so step-up commands work on bearer sessions; `emailVerified` on the session; a `/v1/me` scope for a signed-in person with a verified email | A two-factor account gets tokens only after TOTP; an id_token with the wrong audience, issuer, nonce or expiry is refused; unknown emails get the same response as known ones; a step-up command fails without a fresh step-up and passes with one; refresh rotation and family revoke are unchanged |
| **M7.2d** Links and versions (`mobile-contract`, `infra`) | Serve `apple-app-site-association` and `assetlinks.json` on `yayatoh.com`, `app.yayatoh.com` and tenant subdomains, built from env; a path allowlist (tickets, orders, claims, events, staff enrolment); the device-enrolment screen also shows a QR (a universal link that opens the Staff app, or the Scan PWA when the app isn't installed); `X-Yayatoh-Client` checked against per-app minimum versions with a `426` | Both files return 200 `application/json` with no redirect; a below-minimum attendee app gets 426; a Staff device never gets 426 in its event window; requests without the header are never refused; the enrolment token stays in the URL fragment |

### Wave 2 — attendee, push and staff API, and the mobile core
| Increment | Scope | Acceptance |
|---|---|---|
| **M7.1c** Mobile core | `packages/mobile-core`:<br>• the SDK client, with tokens in secure storage and one refresh at a time<br>• sign-in helpers for every M7.2a grant<br>• TanStack Query with a cache persisted encrypted<br>• theme from the tokens (light, dark, tenant colours with a contrast fallback)<br>• `use-intl` with 13-locale catalogs and RTL<br>• the deep-link router and the version gate<br>• Sentry with scrubbing | Two simultaneous 401s refresh once; a reused refresh token signs the app out and wipes its data; the cache file is unreadable without the key; every catalog has every key with valid plurals; a 426 shows the update screen |
| **M7.2b** My tickets API (`tenancy`, `mobile-contract`) | `/v1/me/tickets` and ticket detail (QR code, short code, `rev`, seat, entrance, event, organizer branding); `/v1/me/orders` and order detail; refund requests; transfer start and cancel; claim; a wallet-pass link (fake until your accounts). Everything goes through the same queries and commands as the web, with allowlist serializers | For every seeded persona, `/v1/me/tickets` equals the web's My tickets; nobody reads a ticket not bought by or held by their verified email (isolation test); after a transfer the old code is refused at the door and the old pass is voided |
| **M7.2c** Native push (`infra`) | APNs and FCM adapters behind `PushTransport`, with fakes in CI; `POST/DELETE /v1/me/devices` stores a phone per org where the person has tickets (like buyer web push) and follows them to new orgs; the P7-8 notification types in all 13 locales; invalid tokens disabled | A token the provider rejects is never sent to again; a phone never gets pushes from an org where its owner has no tickets; no push text contains an email, phone number, amount or ticket code; reminders fire once in the event's time zone |
| **M7.2e** Staff API (`mobile-contract`, `auth`) | Device-token `/v1` routes for what the Scan PWA reads from `/api/scan/*`: counts, device board, alerts, guest list, assistance queue, and device push for staff alerts. The PWA and `/v1` share one implementation. Exhibitor reps get a bearer form of the portal session, plus lead routes. Organizers get a read-only event-day view (`/v1/orgs/{org}/events/{event}/ops`) | A revoked or wiped device gets 401 everywhere at once; a rep sees only their exhibitor's leads and only consented fields (P5-8); the ops numbers equal the web Command Center; the Scan PWA's e2e passes unchanged |
| **M7.2f** Browse and checkout API (`payments`, `mobile-contract`) | Public event search over the marketplace read model; checkout over the same steps as the web (`startCheckoutCommand`, payment, `attachPaymentCommand`) returning a payment URL with return links to the app; carts that need the web (questions, seats, approval, transfer fees) get the web checkout URL; virtual tickets are refused (P7-7) | A fake-provider purchase via `/v1` produces the same order, fees and ledger entries as the web for the same cart; one idempotency key makes one order; private and wedding events never appear in search (D13) |

### Wave 3 — the apps (attendee and staff in parallel)
| Increment | Scope | Acceptance |
|---|---|---|
| **M7.3a** Attendee sign-in and account | Welcome screen; email code, Apple, Google and password, with the two-factor step; the account screen (name, language, theme, notifications); sign out everywhere; **account deletion** with step-up (App Review 5.1.1(v)); a clear state for first launch without a network | Every sign-in path works through the fakes; deletion removes the account and signs out; every control has a screen-reader label (component tests; Maestro in the device pass) |
| **M7.3b** Tickets | My tickets (upcoming and past, by event); ticket detail with the QR at full brightness, seat and entrance; offline use (cached encrypted, cleared at sign-out); add to calendar and directions; transfer and cancel; claim from a link; Add to Apple Wallet and Save to Google Wallet; refund requests | Tickets open with the network off after one sync; a transferred ticket leaves the sender's list; the QR has a spoken description |
| **M7.3c** Discover and buy (`payments`) | Search and event pages; ticket selection with the web's rules; checkout in a secure browser session that returns to the order confirmation; orders list and detail; "Buy on the web" for virtual tickets | A fake-provider purchase ends on the confirmation, with the tickets in My tickets; cancelling returns to the event; no virtual ticket can be bought in the app |
| **M7.3d** Push and links | The permission prompt at the P7-8 moments; device registration; a tapped push or universal link opens the right screen (ticket, order, claim, event); notification settings | Every push type and link opens its screen from a cold start; denying permission never blocks anything |
| **M7.4a** Staff enrolment and devices | Enrol by scanning the QR or opening its link; the device token in secure storage; event and checkpoint picker; heartbeat (battery, queue depth, clock offset) every 30 s while scanning; remote wipe and revoke; organizer sign-in with TOTP; exhibitor sign-in | A wiped device erases its data within one heartbeat; a revoked device returns to the enrolment screen |
| **M7.4b** Offline scanning | VisionCamera v5 scanning QR codes only; the manifest in `expo-sqlite` with SQLCipher (key in the keychain); verdicts from `checkin-engine`; the scan outbox in batches of up to 500; admit, duplicate and reject shown with colour, text, sound and haptics; torch; manifest expiry 24 h after the event | All M7.1a vectors give the same verdicts in the app. **Offline drill (X):** two phones offline admit the same ticket, reconnect, and the duplicate is flagged within 60 s. Verdict in under 300 ms on a mid-range Android phone (device pass) |
| **M7.4c** Door tools | Lookup by name, phone or email (exact salted-hash match offline); manual check-in with a reason; guest-list check-in; the assistance queue; event-day counts and alerts; staff push alerts; lead retrieval (scan, rate, qualifiers, notes, offline queue); the organizer's event-day view | Offline lookup never shows a field the manifest excludes; one exhibitor's leads are never visible to another; lead consent as P5-8 |

### Wave 4 — store launch and hardening
| Increment | Scope | Acceptance |
|---|---|---|
| **M7.5a** Store launch kit | Store listings for both apps (English, then the other 12 locales); screenshots from the simulator; privacy labels and Play Data safety derived from the SDKs actually used; export-compliance answers and age rating; reviewer demo accounts and a demo event; EAS Submit profiles; TestFlight and Play testing tracks; `docs/runbooks/mobile-release.md` (phased rollout, over-the-air policy, event freeze, rollback) | The runbook alone gets each app built, submitted and rolled back; a script confirms the privacy labels match the dependency list |
| **M7.x** Hardening | Maestro flows for every journey on both platforms in CI (EAS Workflows); an accessibility audit (VoiceOver, TalkBack, largest text, 44 pt targets); k6 for the new `/v1` routes (my tickets and checkout at peak, scan batches at 3× peak); a security review (token storage, link hijacking, log scrubbing, push content); leak-crawler coverage for every new response | Maestro, k6 and crawler gates are green, with no open high findings |

### After the first release
| Milestone | Scope |
|---|---|
| **M7.6** Attendee app v2 | Agenda and personal schedule, session enrolment, polls and Q&A, surveys, guest hub and RSVP with plus-ones, read-only "find my seat" (the web viewer first, Skia later), an inbox of organizer messages, multi-day Wallet passes |
| **M7.7** Staff app v2 | Session check-in with live capacity, badge printing at the desk, hardware scanners (Zebra DataWedge, Bluetooth ring scanners), Command Center alerts as push |
| Later | Tenant-branded apps (M6.13) on tenants' own developer accounts, Tap to Pay, Live Activities and widgets, seat selection in the app |

## 4. Timing

18 sessions in 4 waves, at Phase 6's pace (5–8 hours each, up to 10 slots): roughly 100–140 agent-hours plus merging, or **about 1–1.5 weeks of agent time** behind the other phases. Agents can't speed up the rest of the calendar:
- **Device passes** after Waves 3 and 4: simulator runs, fixes, then your phones. About 3–5 days.
- **Your accounts** (section 5). The build uses fakes until then, but TestFlight, push and Wallet need the real ones.
- **First store reviews.** Apple usually takes 1–3 days, but a first submission often gets one or two rejections. Play review for a new app can take several days (UNVERIFIED). A **personal** Play account (not an organization one) must also run a 14-day closed test with 12 testers before production (UNVERIFIED for your account).

**Estimate: about 4–6 weeks from approval to both apps live in the stores**, if your accounts are ready in week 1. As in Phase 6, the weekly usage limit is the main pace risk.

## 5. What waits for you

**Decisions:** P7-1 to P7-13. P7-4 has a deadline: the attendee app must be in the stores before B-Y.

**Accounts** (start now):
- **Apple:**
  - Developer Program (organization) access, and App Store Connect access to the Yayatoh listing (P7-4).
  - Rights to create App IDs with push, Associated Domains and Sign in with Apple, and the APNs `.p8` key.
  - A Pass Type ID (already in `owner-inbox.md`).
- **Google:**
  - Play Console (organization) access to the Yayatoh listing and its signing (Play App Signing or the upload key).
  - A Firebase project with an FCM service account, and Google sign-in client IDs for iOS and Android.
  - The Google Wallet issuer account (already in the inbox).
- **Expo account with EAS.** The Production plan is about $199/mo with build credits; Starter may do at first (UNVERIFIED).
- **Sentry** (P7-11).
- **Test devices:** an older iPhone, an iPad, a mid-range Android phone, and a Zebra scanner if your door teams use them.

**Store and legal** (`legal-copy`):
- App names, icons and short descriptions (we draft; you approve).
- Privacy policy updates: push tokens, camera use in the Staff app, crash reporting.
- Support and marketing URLs, and export-compliance answers (standard encryption only). We seed the reviewer demo accounts.

**Monthly cost** (all UNVERIFIED): EAS $0–199/mo, Sentry $0–26/mo, Apple $99/yr, Google $25 once. APNs and FCM are free.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Store rejection: minimum functionality (4.2), login (4.8), account deletion (5.1.1(v)), payments (3.1) | Sign in with Apple beside Google; in-app account deletion; no in-app purchase and no virtual sales; a reviewer demo event; reviewer instructions for scanning in the Staff app |
| The door gives different answers on the web and the phone | One `checkin-engine` and `ticket-crypto` for both; the M7.1a vectors run in Node, the browser and the app |
| Hermes is slow or lacks an API (Ed25519, `Intl` plurals) | M7.1a moves to pure-JavaScript crypto; M7.4b measures verification time on a mid-range phone. If too slow, a small native verifier (CryptoKit, Tink) as an Expo module behind the same function |
| Cloud sessions can't run a simulator | Unit and component tests plus `expo export` in every session; Maestro and accessibility in the device pass after each app wave; your TestFlight checks |
| Tenant custom domains can't open the app: Apple needs every link domain in the build | Links on `yayatoh.com`, `app.yayatoh.com` and tenant subdomains open the app; custom domains open the web page, which offers "Open in the app" through `app.yayatoh.com` |
| The old store apps stop at cutover (P7-4) | Ship the attendee app to the existing listing before B-Y; tell buyers in the cutover emails; tickets stay available on the web and by email |
| Tickets on a lost or shared phone | Tickets are encrypted on the phone and cleared at sign-out; a transfer bumps `rev`, so an old screenshot is refused at the door |
| Token theft from a device | Secure storage only, 15-minute access tokens, refresh-family revoke, and "sign out everywhere". No certificate pinning: it breaks when certificates rotate, and TLS is enough |
| Scope creep (seat maps, chat, branded apps) | P7-12 lists what is out |
