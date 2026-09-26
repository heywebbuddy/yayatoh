# Mobile App Product Roadmap

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.

> **Superseded in part:** building mobile apps in this build. Mobile is planned but deferred (docs/roadmap.md §8.3).


## Topic

mobile-app-product-roadmap

# Yayatoh 2.0 Mobile Product Roadmap (researched 2026-09-26)

Grounded in the vision doc (`~/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx`), goal 4: keep the apps, give them a stable API, and don't let the web platform limit where they go next. Goals 5, 6, 7 and 9 add scanning, session check-in, lead retrieval, seat finder, push and offline entry. Legacy continuity through the `/api/v2` facade is covered elsewhere. This report decides what the mobile product should become.

## 1. Current state (checked on the store listings)

| Listing | Seller | Facts |
|---|---|---|
| Yayatoh iOS (id6755224885) | Pani Digital Services, LLC | v1.0.0 13 Nov 2025, v1.0.1 (chat, social, "Join Event Via Code"), v1.0.3 12 Mar 2026. Min iOS 15.1, 41.8 MB, English only. **The privacy policy URL points to `https://staging.yayatoh.com/pages/privacy`.** Declares "Advertising Data" as linked to identity. |
| Yayatoh Android `com.yayatoh.yayatohapp` | Pani Digital Services, LLC | Play page details could not be fetched (UNVERIFIED: Data safety section, IAP label). |
| ABC Chicago 2026 iOS (id6760401721) | Pani Digital Services, LLC (developer shown as "Yayatoh") | v1.0 16 Mar to v1.2.3 31 Aug 2026 ("Update scan features"). Sells tickets and badges, and includes scanning. Privacy label lists only Contact Info and User Content. Privacy URL is `abc.yayatoh.com/pages/privacy`. |
| ABC Chicago Android `com.abcchicago.app` | Same account, which also holds the unrelated app `com.panitechacademy` | UNVERIFIED details. |

The minimum of iOS 15.1 and the ~42–45 MB size fit React Native 0.76–0.83 or Expo SDK 52–55. UNVERIFIED until the source is audited. The Yayatoh app is already structured as a "picker" app ("Join Event Via Code"). ABC Chicago is a template-branded app submitted by the platform vendor, which is exactly what Apple guideline 4.2.6 prohibits.

## 2. Framework decision: Expo apps inside the web monorepo

**Recommendation:** use Expo SDK 57 (released 30 Jun 2026: React Native 0.86, React 19.2, min iOS 16.4, Android 7+, compileSdk/targetSdk 36, Xcode 26.4+, New Architecture only since SDK 55). Build with EAS Build/Submit/Update, with the apps living under `apps/` in the same pnpm/Turborepo monorepo as the Next.js web app.
- **Why:** 2–3 mobile engineers cannot maintain Swift and Kotlin versions of two apps. The TypeScript domain logic (QR crypto, check-in rules, seating geometry, zod schemas, i18n) is shared as-is. EAS Update allows JS-only hotfixes during events. The existing apps are already React Native lineage.
- **Runner-up:** native Swift/Kotlin apps built on OpenAPI-generated SDKs. They lost because they need about twice the headcount and share no logic with the web. Revisit only if a native team is hired.
- **Consequence:** moving to SDK 57 drops iOS 15 devices. Measure the iOS 15 share of legacy users first. Those users stay on the legacy binary plus the `/api/v2` facade until they drop off.

## 3. App portfolio after the rebuild

1. **"Yayatoh", the attendee app.** Ship it as a new version of the existing bundle IDs so installs and ratings are kept. It uses a picker/container model: an org or event picker, event codes, universal links and a "My tickets" view across all tenants. Tenant theming is applied at runtime (logo, colors and fonts fetched from `/v3/tenants/{id}/branding` and cached) whenever the user is inside a tenant's space. Apple's guideline 4.2.6 names this model explicitly as acceptable ("an event app with separate entries for each client event").
2. **"Yayatoh Staff", the organizer and scanner app (new listing).** It covers door scanning, lookup, manual check-in, session check-in, exhibitor lead retrieval and a lite Command Center. Access is role-gated, so this one app serves organizers, door staff, session monitors and licensed exhibitor reps.
3. **Premium tenant-branded builds, a paid add-on.** These are compiled from the attendee app with `APP_VARIANT=<tenantSlug>`: `app.config.ts` sets name, bundle ID, icon, splash, associated domains and a locked `tenantId`, and `eas.json` has one profile per tenant. They contain **attendee features only** (scanning stays in the Staff app). They are **published under the tenant's own Apple and Google developer accounts**, with Yayatoh added as a team member and the App Store Connect API key stored per EAS submit profile. Swapcard runs the same model ("publish under your Apple/Google developer accounts", 4–6 weeks). Plan 6–8 weeks for a tenant's first launch: Apple org enrollment with a D-U-N-S number takes 2–4 weeks and costs $99/yr, plus $25 one-time for Google.
   - Why not per-tenant apps on Yayatoh's own account: guideline 4.2.6 ("services should not submit apps on behalf of their clients"), guideline 4.3(a) (no multiple bundle IDs of the same app), and Google, which "strongly recommends decentralized account management" because a policy strike on one account can remove every app on it, PaniTech Academy included.
   - Each tenant needs a unique store listing (description, screenshots, icon). Google's repetitive-content policy is triggered by reused metadata.

## 4. Tickets: in-app first, Wallet passes as well

- **The in-app ticket is primary.** It is cached offline and supports seat info, transfer, and a rotating or signed QR for fraud control. Eventbrite dropped PDF tickets in April 2024 to push tickets into its app and into Wallet.
- **Wallet passes ship in phase M1 anyway,** for three reasons. (a) Most wedding, gala and one-off concert guests will never install an app, and an "Add to Apple/Google Wallet" button in the confirmation email reaches them. (b) A pass carries the tenant's branding with no app-store risk; Stova's advice after 4.2.6 was the same. (c) Apple Poster Event Tickets (iOS 18+) use semantic tags for section, row and seat plus a venue map. iOS 26 adds `upcomingPassInformation`, so one pass can cover a multi-day convention such as ABC.
- **Security difference.** Google Wallet supports TOTP **rotating barcodes** and Smart Tap. Apple passes are static, so use a signed QR and push pass updates through the PassKit web service to revoke a pass on transfer.
- **Stack:** `passkit-generator` for Apple and the Google Wallet REST API with "Save to Google Wallet" JWT links on the backend. In the app, `@premieroctet/react-native-wallet` or `expo-wallet`, both built on Expo Modules (community projects; maturity UNVERIFIED).
- **Caveats:** wallet search demand is falling (−45% YoY for "add tickets to apple wallet", Venuera, July 2026), and about half of wallet-related searches are about transferring or fixing passes. Treat Wallet as a convenience, not the door strategy. Plan for Pass Type ID certificate expiry.

## 5. Seat maps on mobile

| Option | Verdict |
|---|---|
| **@shopify/react-native-skia 2.x** (2.12.0, May 2026; needs RN ≥0.79) driven by a shared pure-TS `seating-core` (layout JSON, geometry, spatial-index hit-testing) and Reanimated pinch/zoom | **Chosen.** GPU rendering on the UI thread handles thousands of seats smoothly. Adds about 10–15 MB to the binary, which is acceptable. |
| Expo DOM component (`'use dom'`) or a WebView wrapping the web Konva viewer | Runner-up. It looks identical to the web and ships fastest, but Expo says it parses slower than Hermes bytecode, uses an async JSON bridge and fights native gestures. Acceptable as an M1 stopgap for read-only "Find My Seat" only. |
| react-native-svg | Lost. Light (<2 MB) and fine for a 30-table wedding, but it stutters at arena scale. |

Web keeps Konva. Skia-on-web (CanvasKit, 2.9 MB gzipped) is not needed.

## 6. Offline scanning stack (Staff app)

- **Camera:** `react-native-vision-camera` v5 (Nitro rewrite; 5.1.0 on 1 Jul 2026 added `scanCodesInImage`) with `react-native-vision-camera-barcode-scanner` (ML Kit), restricted to `['qr-code']` for speed. On iOS, VisionCamera can use `AVCaptureMetadataOutput` instead, which adds no binary size. Runner-up: `expo-camera` barcode scanning, which is simpler and first-party but gives less control over focus and throughput.
- **Local store:** `expo-sqlite` (SDK 57) with the `useSQLCipher` config plugin. It is version-locked to the SDK, needs a dev client (no Expo Go) and has a changeset/session extension for delta sync. The key is a random 256-bit key held in `expo-secure-store` (Keychain/Keystore). The database is wiped on logout, at event end, or by a remote-wipe flag from the device registry. Runner-up: `op-sqlite` with `sqlcipher: true`, which is faster but is one more native dependency to track. UNVERIFIED: whether Expo issue #39792 (16 KB page size with SQLCipher on Android) is fixed.
- **Validation:** Ed25519-signed QR payloads verified offline with `@noble/curves`, so tickets issued after the last sync still validate. The QR carries no personal data. Scans go into an append-only outbox with device ID and a hybrid logical clock, and sync through `/v3/checkin/sync?since=`. Two devices offline at the same time can both admit one ticket. Handle this with gate partitioning plus server-side conflict flags; an optional LAN "hub device" relay comes in M3.
- **Hardware:** Zebra/Honeywell scanners through DataWedge intents on Android, and Bluetooth HID ring scanners. Eventbrite Organizer supports Zebra scanners.

## 7. Staff app: lead retrieval, session check-in, Command Center lite

- **Lead retrieval:** reps log in with a license seat tied to an exhibitor. The market rate is about $350–$599 for the first app license and $149–$200 per extra rep at 2026 US shows, and roughly $250 per Cvent LeadCapture license. Features: scan, custom qualifiers from the exhibitor portal, 1–5 rating, notes, and an offline queue. Leads are resolved on sync, and reps **never get the attendee database offline**. Only fields the attendee consented to share are returned. Export to CSV, HubSpot or Salesforce from the web exhibitor portal.
- **Session check-in:** a session-monitor role scans at the door, with a live capacity counter over SSE or WebSocket and a soft local count when offline. Attendee self-check-in by scanning a rotating session QR shown on a kiosk screen comes in M3.
- **Command Center lite:** read-only event-day tiles from the same `/v3/events/{id}/ops` endpoints as the web: check-ins against expected, throughput per gate per minute, duplicate and invalid scans, device status, and pushed critical alerts. Every Staff device sends a heartbeat (battery, queue depth, last sync). That heartbeat feeds the vision's "three check-in devices are offline" alert.
- **Later:** a box office with Stripe Terminal Tap to Pay (Eventbrite Organizer offers this in the US, Canada and UK).

## 8. How competitors split their apps

| Vendor | Attendee side | Staff / exhibitor side |
|---|---|---|
| Eventbrite | "Eventbrite" (discovery, tickets, Apple Wallet) | "Eventbrite Organizer" (offline check-in, multi-device, Tap to Pay, sales dashboard) |
| Cvent | Attendee Hub / "Cvent Events" app | OnArrival (check-in, badge printing, offline) and LeadCapture (a separate exhibitor app) |
| Whova | One app: attendee features, exhibitor lead retrieval and check-in QR; Wallet Event Pass since 2023 | Same app |
| Swapcard | Container app or branded app on the client's accounts; lead capture inside the app | SwapAccess for session access |

Yayatoh's core is ticketing and check-in, which is the Eventbrite pattern. Conference features are a module. Two apps plus optional branded builds is the right split. A Whova-style single app would put an encrypted offline attendee database and staff tools into a consumer app, which is a larger attack surface and harder to get through review.

## 9. Features per app per phase

| Phase | Attendee app / branded builds | Staff app |
|---|---|---|
| **M0 (now, 4–6 wks)** | Compliance hotfix on the legacy binaries (§11) | — (ABC's scanning stays as-is) |
| **M1 (mobile months 1–4, needs API v3 for tickets, orders and check-in)** | Login (OAuth 2.1 PKCE), org picker and event code, tickets offline, signed/rotating QR, Wallet add, transfer, orders, RSVP with plus-ones, read-only Find My Seat, push and in-app inbox, account deletion, 12 locales with RTL Arabic | Event and gate selection, offline QR scan, name/phone/email lookup, manual check-in, duplicate and fraud flags, device heartbeat, Command Center lite |
| **M2 (months 5–8)** | Agenda, tracks, speakers, session registration and waitlist, personal schedule, badge QR, surveys and polls, interactive Skia seat selection for purchase, chat carried over from legacy | Session check-in with capacity, lead retrieval with licenses, hardware scanners, remote wipe |
| **M3 (months 9–12)** | Branded-build pipeline live, ABC migrated to it, networking and meetings, self session check-in, multi-day Wallet passes | Tap to Pay box office, LAN hub mode, kiosk (Guided Access / Android lock task) |

## 10. Packages shared with the web monorepo

`@yayatoh/api-client` (generated from OpenAPI 3.1 with TanStack Query hooks), `@yayatoh/schemas` (zod), `@yayatoh/i18n` (ICU catalogs for 12 languages), `@yayatoh/design-tokens` (JSON tokens compiled to Tailwind v4 CSS variables on web and a Unistyles 3 theme on native; Unistyles `updateTheme` switches themes at runtime without re-renders; NativeWind v5 is still RC), `@yayatoh/seating-core`, `@yayatoh/ticket-crypto`, `@yayatoh/checkin-engine` (a state machine shared by the web PWA scanner and the Staff app), and `@yayatoh/tenant-modules` (feature flags). **UI components are not shared**: Next.js RSC plus shadcn does not map onto native primitives, and react-native-web or Solito adds cost for no gain.

## 11. Store-compliance fixes to make now

1. Change the Yayatoh iOS privacy policy URL from staging to `https://yayatoh.com/pages/privacy` in App Store Connect, and fix the in-app link (guideline 5.1.1(i)). UNVERIFIED whether this needs a new binary.
2. Re-derive the privacy labels from the SDKs actually in the apps. Remove "Advertising Data" unless an ads SDK is present. Add Purchases (and Financial Info if Stripe collects card data in-app), user IDs and device IDs for push, and User Content for chat. The ABC label is under-declared. Update Play Data safety to match (UNVERIFIED current state).
3. **In-App Purchases flag:** event tickets and badges are physical services under guideline 3.1.3(e) and must **not** use IAP or Play Billing. Clear any IAP declaration or label that doesn't apply (UNVERIFIED on Play). Do not sell livestream or virtual access consumed in the app: one-to-many real-time services require IAP under 3.1.3(d). US-storefront link-outs to external purchase are allowed (3.1.1(a)).
4. In-app account deletion plus a web deletion URL: Apple 5.1.1(v), and Play since 15 Apr 2024.
5. Deadlines: iOS uploads need the Xcode 26 / iOS 26 SDK since 28 Apr 2026, and the age-rating questionnaire was due 31 Jan 2026. Play updates must target API 36 since 31 Aug 2026, with an extension to 1 Nov 2026 available. **Any legacy Android hotfix now needs targetSdk 36.**
6. If chat or photos use `READ_MEDIA_IMAGES`, switch to the Android Photo Picker (Play policy enforced since 28 May 2025).
7. ABC Chicago and guideline 4.2.6: either transfer the app to ABC's own developer accounts (both Apple and Google support app transfers), or retire it into the container app after the 2026 convention. Give reviewers demo credentials for the scanning feature.
8. Localize the store listings; only English is declared today.

## 12. Release cadence and forced-upgrade policy

- **Binaries** every 4 weeks, rolled out with Apple phased release and Play staged rollout (10% → 50% → 100%). **OTA** through EAS Update weekly or as hotfixes, using the `fingerprint` runtime-version policy with percentage rollouts. **Event freeze:** no binary release within 72 h of a large tenant event on the calendar; OTA only.
- **Expo SDK upgrades** twice a year, timed to Apple's April SDK cutoff and Play's 31 Aug target-API deadline.
- **Server-driven gate:** `GET /v3/app-config?app&platform&version` returns `{minSupported, recommended, message}`. A soft nudge is the default. A hard block is only for security or protocol breaks, using the Play In-App Updates immediate flow on Android and a modal with a store link on iOS. **Never hard-block the Staff app during an active event window.** Support the current and two previous binaries (about 90 days). Send `Deprecation` and `Sunset` headers on API versions. Retire the legacy `/api/v2` facade once legacy clients are under 2% of active devices for 30 days.

## 13. Team and cost

- **Team:** 1 senior Expo/React Native lead (1.0 FTE), 1 mid React Native developer (1.0), QA with a device matrix and Maestro E2E (0.5), design (0.25), and about 0.5 FTE of backend work from the web team (API v3 sync endpoints, pass service, push fan-out). That is about 2.75 FTE, or roughly 440 h/month.
- **Rates in 2026:** US mid-level freelance $108–$165/h; Mexico mid-level $56–$86/h; Colombia $30–$55/h.
- **Year-1 labor:** about **$290k–$420k nearshore** or **$650k–$900k US**. A lean M1-only plan (1.5 FTE for 5 months) is about $70k–$110k nearshore.
- **Tooling:** EAS Production at $199/mo includes $225 of build credit, 2 concurrent builds and 50k update MAUs. iOS builds are $2–$4 and Android $1–$2. Branded-tenant builds are negligible (about $6 per tenant per release); the real cost is 1–2 h of submission labor per tenant per release. Add Apple $99/yr per account and Google $25 once, plus Sentry and a device cloud (about $5–10k/yr in total; UNVERIFIED).
- **Branded-app pricing:** charge it as an add-on. For reference, EventMobi starts at $3,500 per event or $7,900/yr, with the branded app priced separately. Competitors' branded add-on prices are not public (UNVERIFIED).



## Key recommendations

- Build the future mobile apps with Expo SDK 57 (React Native 0.86, New Architecture only, min iOS 16.4) and EAS Build/Submit/Update, as apps in the Next.js pnpm/Turborepo monorepo. Native Swift/Kotlin apps consuming generated SDKs came second; they lost because they need about twice the team and share no TypeScript logic with the web.
- After the rebuild, run two public apps: 'Yayatoh' (the attendee picker/container app, shipped as an update to the existing bundle IDs) and a new 'Yayatoh Staff' app (scanning, lookup, session check-in, lead retrieval, lite Command Center).
- Offer premium tenant-branded builds as a paid add-on: the attendee app compiled with APP_VARIANT=<tenant>, attendee features only, published under the TENANT's own Apple and Google developer accounts. This avoids Apple 4.2.6 and 4.3(a) rejections and Play repetitive-content risk.
- Fix now: change the Yayatoh iOS privacy URL from staging.yayatoh.com to yayatoh.com, correct the privacy labels (remove Advertising Data, add Purchases, identifiers and chat content; ABC is under-declared), and confirm tickets never use IAP or Play Billing (guideline 3.1.3(e)).
- Any legacy hotfix now needs targetSdk 36 on Play (deadline Aug 31 2026, extension to Nov 1 2026) and Xcode 26 / iOS 26 SDK on iOS (since Apr 28 2026). Budget an SDK upgrade before the next emergency fix.
- Resolve ABC Chicago 2026's 4.2.6 exposure: transfer the app to ABC's own developer accounts, or fold it into the container app after the 2026 convention. Move its scanning into the Staff app.
- Make the in-app ticket (offline, signed or rotating QR) the primary ticket, and also ship Apple and Google Wallet passes in M1. Passes reach guests who never install the app and carry tenant branding with no store risk. Use Apple Poster Event Tickets with seat semantics, iOS 26 upcomingPassInformation for multi-day events, and Google rotating barcodes.
- Render seat maps with @shopify/react-native-skia 2.x on top of a shared pure-TS seating-core package. An Expo DOM component wrapping the web Konva viewer is acceptable only as an M1 read-only Find My Seat stopgap. react-native-svg lost because it does not scale to arena-size maps.
- Offline scanning stack: VisionCamera v5 with the ML Kit barcode scanner (QR only), expo-sqlite with SQLCipher and the key in SecureStore, Ed25519-signed QR payloads verified offline, an HLC-stamped outbox with delta sync, and a device heartbeat that feeds Command Center alerts.
- Put lead retrieval (license seats, qualifiers, consent-scoped lead data, no offline attendee database for exhibitor reps) and session check-in in the Staff app, not the consumer app.
- Share only non-UI packages with the web: api-client, zod schemas, i18n, design-tokens, seating-core, ticket-crypto, checkin-engine, tenant-modules. Apply tenant theming at runtime through Unistyles 3 updateTheme.
- Release binaries every 4 weeks with staged rollouts and push weekly OTA updates using the fingerprint runtime policy. Freeze binaries for 72 h before a major event, gate upgrades server-side through /v3/app-config, never hard-block the Staff app during a live event, and support N-2 binaries.
- Staff the program at about 2.75 FTE (senior lead, mid React Native developer, 0.5 QA, 0.25 design, plus 0.5 backend from the web team): about $290k–$420k/yr nearshore or $650k–$900k/yr US, plus about $5–10k/yr in tooling.


## Data model implications

- mobile_app: id, kind (attendee_container | staff | tenant_branded), platform, bundle_id/package, store_app_id, owning_developer_account (yayatoh | tenant), tenant_id (null for container), push_credentials_ref, associated_domains[]
- app_release_policy: app_id, platform, min_supported_version, recommended_version, message_i18n, hard_block_reason, staff_event_grace flag; served by GET /v3/app-config
- device_installation: id, app_id, user_id (nullable), tenant_scope[], push_token, platform, locale, app_version, runtime_version (EAS fingerprint), last_seen_at
- scanner_device: id, installation_id, tenant_id, event_id, gate_id, assigned_role, battery, outbox_depth, last_sync_at, last_heartbeat_at, remote_wipe_requested; feeds the Command Center 'devices offline' alert
- checkin_event (append-only): ticket_id, event_id, gate_id/session_id, device_id, scanned_at_device (HLC), received_at_server, result (admitted | duplicate | invalid | revoked | override), offline flag, conflict_group_id
- ticket_credential: ticket_id, qr_payload_version, signing_key_id (Ed25519 key rotation per tenant/event), rotating_secret (TOTP seed for Google Wallet and in-app rotation), revoked_at
- wallet_pass: id, ticket_id, platform (apple | google), pass_serial, pass_type_id / google_class_id, auth_token, device_registrations (Apple PassKit web service), last_pushed_at, upcoming_events[] for multi-day passes
- tenant_branding: logo, colors, fonts and design tokens JSON versioned for runtime theming in the container app; store_listing assets for branded builds
- exhibitor_license: exhibitor_id, event_id, seats_purchased, seats_assigned (user_ids), price, status
- lead: id, exhibitor_id, event_id, attendee_id (resolved on sync), raw_scan_payload, captured_by_user_id, device_id, captured_at, rating 1–5, qualifier_answers JSON, notes, consent_scope snapshot, sync_state
- session_checkin plus session capacity counters (live and soft offline), and staff role assignments per event: door_staff, session_monitor, exhibitor_rep, organizer
- tenant_developer_account: tenant_id, apple_team_id, asc_api_key_ref, google_play_account_ref, duns_status; drives the per-tenant EAS submit profiles


## Risks

- Apple 4.2.6 and 4.3(a): the ABC Chicago 2026 app is a vendor-submitted template app on Pani Digital Services' account. Any future update review could be rejected, and adding more tenant apps to that account compounds the risk.
- Account-level blast radius: Yayatoh, ABC Chicago and the unrelated PaniTech Academy app share one Google Play and Apple account. A spam or repetitive-content strike could affect all of them.
- The staging privacy policy URL and inaccurate privacy labels (Advertising Data declared; Purchases missing; ABC under-declared) can trigger rejection or removal and damage user trust.
- Deadline trap: legacy Android updates are blocked unless they target API 36 (Aug 31 2026, extension to Nov 1 2026), and iOS uploads need Xcode 26. An emergency fix to a legacy app may first require an unplanned Expo SDK upgrade.
- Expo SDK 57 raises the iOS minimum to 16.4. Legacy users on iOS 15 cannot move to the new app, which extends the life of the /api/v2 facade.
- Offline multi-device scanning cannot prevent the same ticket being admitted twice when two devices are both offline. Gate partitioning, server conflict flags and an optional LAN hub are needed; the vision's promise of duplicate-scan prevention must be qualified for offline mode.
- Community Wallet libraries (@premieroctet/react-native-wallet, expo-wallet) are not first-party; their maintenance and New Architecture support are UNVERIFIED.
- The expo-sqlite SQLCipher Android 16 KB page-size issue (#39792) may not be resolved; the fallback is op-sqlite.
- Branded builds carry per-tenant operational overhead: D-U-N-S and enrollment take 2–4 weeks, and every release needs review cycles and unique store assets. If priced too low, the add-on loses money.
- Selling virtual or livestream access consumed inside the app would require IAP under guideline 3.1.3(d), which conflicts with Stripe checkout; keep hybrid access purchases on the web or use the US link-out.
- Staff-app devices hold encrypted attendee data. Lost devices need remote wipe and key destruction, and consent-scoped lead data must be enforced to avoid CCPA/GDPR exposure.
- Scope creep in the attendee app (networking, chat, gamification) could delay the M1 launch; conference features must stay module-gated.


## Open questions

- Is the legacy mobile source bare React Native or Expo, and on which SDK/RN version? This decides whether a legacy hotfix is feasible before the API 36 and Xcode 26 requirements bite.
- What share of active legacy-app users are on iOS 15.x, and on which Android versions? This decides how long the /api/v2 facade must live.
- Does ABC (the All Bamiléké Convention organization) have, or want, its own Apple and Google developer accounts? Or should ABC Chicago be retired into the Yayatoh container app after the 2026 convention?
- Which third-party SDKs are in the current apps (analytics, ads, Firebase, Stripe, chat), so the privacy labels and Play Data safety can be declared accurately? Is there any ads SDK behind the 'Advertising Data' declaration?
- Does the current Google Play listing show an 'In-app purchases' label or a Data safety mismatch? These could not be fetched in this research.
- Do the current apps support in-app account deletion, and is there a public web deletion URL?
- Will Yayatoh sell virtual or hybrid (livestream) access in the apps? That triggers the guideline 3.1.3(d) IAP requirement.
- What price point and minimum commitment will the premium tenant-branded app carry, and will tenants accept the 6–8 week lead time and owning their own developer accounts?
- Should the Staff app be public in the stores (like Eventbrite Organizer), or distributed privately to vetted organizers?
- What mobile budget and hiring model (US, nearshore, agency) is acceptable, and must M1 ship alongside the web platform launch or after it?
- Should the existing in-app chat and social features (added in v1.0.1) be kept in 2.0, or deferred to the networking module in M3?
- What check-in hardware do current customers use (phones only, Zebra scanners, badge printers, NFC)?


## Sources

- https://apps.apple.com/us/app/yayatoh/id6755224885
- https://apps.apple.com/us/app/abc-chicago-2026/id6760401721
- https://play.google.com/store/apps/developer?id=Pani+Digital+Services,+LLC
- https://yayatoh.com/
- https://developer.apple.com/app-store/review/guidelines/
- https://support.google.com/googleplay/android-developer/answer/15884185?hl=en
- https://stova.io/apple-says-white-labeled-event-apps-are-in-the-past/
- https://www.nunify.com/blogs/white-label-event-app-guide
- https://www.swapcard.com/features/branded-white-label-event-apps
- https://expo.dev/changelog/sdk-57
- https://docs.expo.dev/versions/latest/
- https://docs.expo.dev/tutorial/eas/multiple-app-variants/
- https://www.sabatino.dev/how-i-maintain-100-apps-using-expo-eas/
- https://expo.dev/pricing
- https://docs.expo.dev/eas-update/runtime-versions/
- https://docs.expo.dev/guides/dom-components/
- https://docs.expo.dev/versions/latest/sdk/sqlite/
- https://github.com/expo/expo/issues/39792
- https://op-engineering.github.io/op-sqlite/docs/installation/
- https://margelo.com/blog/react-native-qr-barcode-scanner-visioncamera-v5
- https://github.com/mrousavy/react-native-vision-camera/releases/tag/v5.1.0
- https://www.npmjs.com/package/@shopify/react-native-skia
- https://www.pkgpulse.com/guides/react-native-skia-vs-react-native-svg-vs-react-native-2026
- https://unistyl.es/v3/guides/theming/
- https://www.nativewind.dev/v5
- https://developer.apple.com/videos/play/wwdc2025/202/
- https://developer.apple.com/documentation/walletpasses/creating-an-event-pass-using-semantic-tags
- https://developers.google.com/wallet/tickets/events/resources/rotating-barcodes
- https://venuera.com/apple-wallet-event-tickets-analysis/
- https://github.com/premieroctet/react-native-wallet
- https://github.com/Kyzegs/expo-wallet
- https://www.eventbrite.com/blog/eventbrite-app-tickets/
- https://www.eventbrite.com/blog/onsite-operations-tools-eventbrite/
- https://www.eventbrite.com/organizer/features/organizer-check-in-app/
- https://www.cvent.com/en/event-marketing-management/mobile-event-apps
- https://www.cvent.com/en/event-marketing-management/onarrival-event-check-in-software
- https://apps.apple.com/us/app/cvent-leadcapture/id1020425235
- https://whova.com/blog/digital-wallet-checkin/
- https://whova.com/trade-show-app-lead-retrieval/lead-retrieval-app/
- https://www.swapcard.com/event-mobile-app
- https://www.luminik.io/blog/2026/trade-show-lead-retrieval-costs-and-options/
- https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
- https://developer.apple.com/news/upcoming-requirements/?id=07242025a
- https://expo.dev/blog/app-store-connect-minimum-sdk-26
- https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- https://support.google.com/googleplay/android-developer/answer/15800983?hl=en
- https://www.mobiloud.com/blog/cost-to-hire-react-native-developer
- https://korebpo.com/react-native-developer-cost-by-country-2026/
- https://www.amego.com/blog/best-white-label-event-apps-large-conferences
