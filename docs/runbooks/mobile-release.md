# Mobile release (Yayatoh and Yayatoh Staff)

**Who:** the owner runs every step marked **(owner)**: they need the Apple, Google, Expo and Sentry accounts. Claude Code wrote the files and scripts this runbook uses and never touches a store, EAS or any account (`docs/plans/mobile.md` §5, decisions P7-4, P7-7, P7-8, P7-9, P7-10).
**When:** every store build (about every 4 weeks), every over-the-air fix, every minimum-version bump, every rollback, and the first submission of each app.
**Duration:** a store build is 1–2 hours of your time over 2–4 days (reviews wait on Apple and Google).

> Steps marked **(UNVERIFIED)** use a store or EAS option that could not be checked from a cloud session (no network to the vendors' docs, no accounts). Check them against the vendor's current documentation the first time, and fix this page if they differ.

Commands are copy-paste ready. Set the app once per shell: `APP=mobile` (Yayatoh) or `APP=staff` (Yayatoh Staff), and run from the repository root unless a step says `cd apps/$APP`. Install `eas-cli` once: `npm install -g eas-cli`, then `eas login`.

| Label | Meaning |
|---|---|
| **(local)** | Runs on your machine, touches no account. |
| **(owner)** | Uses an owner account (Expo, Apple, Google, Sentry, Doppler). |
| **(device)** | Needs a phone, simulator or emulator. |

## 0. What is where

| Thing | Where |
|---|---|
| Build, update and submit profiles | `apps/$APP/eas.json` |
| App identity, permissions, export-compliance flag | `apps/$APP/app.config.ts` over `packages/mobile-core/src/app-config.ts` |
| App Store listing in 13 locales, review contact and notes (EAS Metadata format) | `apps/$APP/store/store.config.json` |
| Google Play listing in 13 locales | `apps/$APP/store/play.json` |
| Privacy labels and Data safety answers | `apps/$APP/store/privacy.json` |
| Export compliance, age ratings, guideline answers | `apps/$APP/store/compliance.json` |
| Screenshot plan, flows and capture script | `apps/$APP/store/screenshots.json`, `apps/$APP/.maestro/store/`, `apps/$APP/store/capture.sh` |
| Checks and renderer for all of the above | `tools/store-kit/` (`node tools/store-kit/cli.ts`) |
| Reviewer demo (organization, event, reviewer account, door link) | `pnpm reviewer-demo` (`apps/web/scripts/reviewer-demo.ts`) |
| Minimum versions and store links the apps check | `MOBILE_CONFIG_JSON`, `IOS_ATTENDEE_STORE_URL` and the other three store links (`.env.example`) |

Rendered store files (`apps/$APP/store/dist/`) and screenshots (`apps/$APP/store/screenshots/`) are generated and git-ignored. Nothing in the repository holds a credential, an account id or a real contact address: those come from the environment names in `apps/$APP/.env.example`.

## 1. First submission of each app: the owner's checklist

Do this once per app. It is the only part of the process that depends on your accounts; the rest of this page repeats every release. Everything here is **(owner)**.

### 1.1 Accounts and access
1. **Apple Developer Program (organization)** with App Store Connect access. Yayatoh goes on the **existing Yayatoh listing** (decision P7-4: same bundle ID, so installs and ratings carry over); Yayatoh Staff is a **new app record** with bundle ID `com.yayatoh.staff`. If you cannot reach the existing listing, create a new record for Yayatoh as well and say so in `docs/owner-inbox.md`.
2. **Google Play Console (organization)** with the existing Yayatoh listing (`com.yayatoh.yayatohapp`) and its signing (Play App Signing, or the upload key), and a new app for Staff (`com.yayatoh.staff`).
3. **Expo organization with EAS**, Expo's GitHub app on this repository, and an App Store Connect API key and a Play service-account key uploaded **to EAS** (`docs/cloud-environment.md`, "EAS: Expo's build cloud"). Never put either key in the repository.
4. **Sentry** project for each app (decision P7-11), and a **Firebase** project with FCM for Android push. Apple's APNs key goes on the server (`docs/owner-inbox.md`, M7.2c).
5. **Production identifiers.** In EAS environment `production` set `IOS_BUNDLE_ID` (the existing listing's, if it differs from `com.yayatoh.yayatohapp`), `ANDROID_PACKAGE`, `EAS_PROJECT_ID`, `EXPO_OWNER`, `SENTRY_DSN`, `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` and, for Yayatoh, the file secret `GOOGLE_SERVICES_FILE`. Create the same names for the `preview` and `development` environments (they build `.preview` and `.dev` apps that install beside the real one).
6. On the web host set the link files and store links: `APPLE_TEAM_ID`, the bundle-ID and package lists, the signing fingerprints, and the four store URLs (`docs/owner-inbox.md`, "M7.2d"). Until they are set, universal links do not open the apps and nobody gets an update prompt.

### 1.2 Words, links and contacts
1. Choose the public values and put them in the EAS `production` environment (names in `apps/$APP/.env.example`): `STORE_SUPPORT_URL`, `STORE_MARKETING_URL`, `STORE_PRIVACY_URL`, `STORE_SUPPORT_EMAIL`, `STORE_ACCOUNT_DELETION_URL`, and the App Review contact `STORE_REVIEW_FIRST_NAME`, `STORE_REVIEW_LAST_NAME`, `STORE_REVIEW_EMAIL`, `STORE_REVIEW_PHONE`.
2. **Privacy policy.** Add to it what `privacy.json` says the apps collect: push tokens (Yayatoh), the door device's heartbeat and the camera, used only to read QR codes (Staff), and crash reports (both). Counsel signs off. Put the page at `STORE_PRIVACY_URL`.
3. **Read the listings** (`apps/$APP/store/store.config.json`, `play.json`) in English and have a native reader look at the other 12 locales before the first release. They are drafts (`legal-copy`): names, promises and the rating answers are yours to approve.
4. **Export compliance** (`compliance.json`): the apps use standard algorithms for ticket verification and local encryption, so the answer is "uses encryption, standard algorithms only" (`ITSAppUsesNonExemptEncryption = true`). Counsel confirms the mass-market self-classification and the yearly BIS report. When Apple accepts the documents it gives a code: set `IOS_ENCRYPTION_COMPLIANCE_CODE` in the EAS `production` environment and TestFlight stops asking per build.
5. **Age rating.** Enter the answers from `compliance.json` (Apple's `advisory` block and `contentRating.apple`; Google's IARC questionnaire in `contentRating.play`). The expected results are written next to them; if the store's result differs, do not release until you have read why.
6. **Design assets nobody generated:** the 1024 px icon is in `apps/$APP/assets/`; the Play **feature graphic (1024×500)** and the Play 512 px icon are yours to supply.

### 1.3 The reviewer demo
App Review signs in with a fixed email code, which exists only outside production (the server ignores it in production, whatever is set). So the reviewer demo lives on a **review server** that runs the same code as production with its own database.
1. **(owner)** Stand up the review server (same container, its own database, `YAYATOH_ENV=review`, `PAYMENTS_PROVIDER` unset so the fake payment page is used). Set on it `REVIEWER_DEMO_EMAIL=app-review@yayatoh.test` and `REVIEWER_DEMO_CODE=<six digits you choose>`.
2. **(owner)** Point at its database and create the demo (idempotent; refuses production by environment name, database host and payment provider):
   ```bash
   REVIEWER_DEMO_HOSTS=<review database host> pnpm reviewer-demo --target=staging --base-url https://<review server>
   ```
   It prints the Staff enrolment link (once), the door ticket codes and the reviewer's ticket. For a rehearsal on your own machine use `--target=local`.
3. **(owner)** Put the values where the listing expects them (EAS `production` environment, or your shell when rendering): `REVIEW_DEMO_EMAIL`, `REVIEW_DEMO_CODE` (the same six digits) and `REVIEW_STAFF_ENROL_LINK`. In App Store Connect attach to the Staff submission an image with a door ticket's QR code and its code (the review notes refer to "the attached image").
4. **Which API App Review reaches.** The review notes tell the reviewer to sign in and scan, so the **build under review must talk to the review server**. A store build points at the production API, where the fixed code does not exist. **Pending owner (default taken): the first submission of each app uses a one-off `API_BASE_URL` for the review server, set in the EAS `production` environment for that build only; once the app is approved, build again against production and release that build** (Apple lets a new version go through review faster once the app exists). If you prefer a permanent reviewer account on production with a password, say so in `docs/owner-inbox.md`; it needs a new, reviewed change because the code path refuses to create one.
5. **(device)** Before submitting, sign in with the demo on a fresh TestFlight build exactly as the notes say, and scan a door ticket twice (admit, then repeat).

### 1.4 Create the app records
1. App Store Connect → create the Staff app (name "Yayatoh Staff", bundle `com.yayatoh.staff`, SKU of your choice). The Yayatoh record already exists.
2. Play Console → create the Staff app; fill in App content (privacy policy URL, ads: none, target audience, data safety, content rating, account deletion URL, government apps: no, financial features: none). The answers are in `privacy.json` and `compliance.json`.
3. Play personal accounts only: a closed test with 12 testers for 14 days is required before production (UNVERIFIED for your account type). Organization accounts skip it.

## 2. Every release

### 2.1 Before you build
1. **(local)** Check for an event freeze (section 4). No store build in the 72 hours before a large event.
2. **(local)** Everything is merged and green: `pnpm verify` passes on `main`, the mobile CI job (`expo export`, `expo-doctor`) passes, and the device pass on a preview build is done.
3. **(local)** The store files are consistent with the code:
   ```bash
   pnpm --filter @yayatoh/$APP privacy:check
   pnpm --filter @yayatoh/$APP store:check
   ```
   `privacy:check` fails when a dependency or permission was added or removed without a label decision. If it fails, read `apps/$APP/store/privacy.json`, decide what the new library collects, update the data types, then update App Store Connect (App Privacy) and Play Console (Data safety) in section 2.7. Never silence the check by adding the library with `collects: []` if it collects anything.
4. **(local)** Bump `version` in `packages/mobile-core/src/app-config.ts` (marketing version, shared by both apps) for a new release. The first Yayatoh release on the existing listing must be **higher than the version live there now**; Apple and Google refuse a lower one. The build number (iOS) and version code (Android) go up by themselves (`autoIncrement`, `appVersionSource: remote`).
5. **(local)** Write the release notes in `releaseNotes` for the 13 locales in `store.config.json` and `play.json` (Play: 500 characters at most). `store:check` enforces the limits.

### 2.2 Build **(owner)**
```bash
cd apps/$APP
eas build --profile production --platform all
```
The `production` profile builds with `APP_ENV=production`, the `production` channel and EAS environment `production`; the app version counter is kept by EAS. Note the build ids it prints. For a build that talks to the review server (section 1.3) set `API_BASE_URL` in the environment for that build only.

Check on the EAS page: the runtime version (a fingerprint) is shown for each build. A new fingerprint means native code or configuration changed; over-the-air updates only reach builds with the **same** fingerprint (section 3).

### 2.3 Internal testing: TestFlight and Play internal **(owner)**
```bash
cd apps/$APP
eas submit --profile testflight --platform ios --latest
eas submit --profile play-internal --platform android --latest
```
Both profiles take the latest `production` build. iOS: the build appears in TestFlight after Apple's processing (about 15–60 minutes); answer the export-compliance question if `IOS_ENCRYPTION_COMPLIANCE_CODE` is not set yet. Add yourself and the team to the internal testing group. Android: the build appears on the Internal testing track at once (UNVERIFIED: the first upload of a new app needs the Play Console's "App content" forms done).

**(device)** Run the device pass on this build: the Maestro flows in `apps/$APP/.maestro/` (the journeys listed in the specs, `docs/specs/M7.3/` and `docs/specs/M7.4*/`) and the manual checks: sign in, buy with the fake provider (review server only), open a ticket offline, scan (Staff), delete an account (Yayatoh), and the accessibility pass at the largest text size. Anything that fails stops the release.

### 2.4 Closed testing **(owner)**
```bash
cd apps/$APP
eas submit --profile play-closed --platform android --latest
```
This sends the same build to the Play **closed** track (`alpha`). Invite the tester group (Google Group or email list) and give it at least 48 hours; the first-ever release of a personal account needs the 14-day run (section 1.4). On iOS, add external TestFlight testers if you want people outside the team; the first external build goes through a short Beta App Review.

### 2.5 Store metadata and screenshots **(owner)**
1. **(local)** Render the listing with your values (it stops and names any value that is missing, and refuses a URL that is not `https://`):
   ```bash
   pnpm --filter @yayatoh/$APP store:render
   ```
   This writes `apps/$APP/store/dist/store.config.json` and `play.json`.
2. **(owner)** Check and push the Apple listing (UNVERIFIED: the schema follows EAS Metadata; `lint` reports anything the current CLI rejects, which is the cue to fix `store.config.json`):
   ```bash
   cd apps/$APP
   eas metadata:lint --profile production
   eas metadata:push --profile production
   ```
   The `testflight` and `production` submit profiles point at `store/dist/store.config.json` (`metadataPath`), so `eas metadata:push` reads the rendered file. If `lint` rejects a field or your `eas-cli` reads the path differently, copy the fields from `store/dist/store.config.json` into App Store Connect by hand; nothing else depends on the push.
3. **(owner)** Google Play has no EAS Metadata. Open `store/dist/play.json` and paste the title, short description, full description and release notes for each of the 13 languages in Play Console → Store presence → Main store listing → Translations, then set the category, contact details and privacy policy URL from the same file.
4. **(device)** Screenshots. They come from a preview build and the reviewer demo; see `apps/$APP/store/screenshots.json` for the screens, devices and sizes. For each required device (iPhone 6.9″, iPad 13″, Android phone) and each theme:
   ```bash
   apps/$APP/store/capture.sh --device iphone-6.9 --theme light --env REVIEW_DEMO_EMAIL=… --env REVIEW_DEMO_CODE=…
   apps/$APP/store/capture.sh --device iphone-6.9 --theme dark  --env REVIEW_DEMO_EMAIL=… --env REVIEW_DEMO_CODE=…
   ```
   (Staff takes `--env ENROL_EVENT=… --env ENROL_KEY=… --env TICKET_CODE=… --env HOLDER_NAME=…` instead; the reviewer demo prints them.) The PNGs land in `apps/$APP/store/screenshots/<platform>/<locale>/<device>/<theme>/<order>-<screen>.png`. Check the whole folder, then upload by hand:
   ```bash
   node tools/store-kit/cli.ts shots --app $APP
   ```
   Apple takes 3 to 10 screenshots per device size and the 6.9″ set scales down to smaller iPhones; the app runs on iPad, so the 13″ iPad set is required for both apps. Play wants at least 2 phone screenshots, and a 1024×500 feature graphic you supply.
5. **Privacy answers (owner):** App Store Connect → App Privacy and Play Console → Data safety. Copy from `privacy.json`: each data type's Apple and Play names, "linked to the user", purposes and "optional". Tracking: no. Play also asks where deletion happens (`play.deletionPath`).

### 2.6 Submit for review and release **(owner)**
1. **iOS.** In App Store Connect select the TestFlight-tested build for the new version, check the listing, the review notes (from `store.config.json`) and the attachment (Staff), and **Submit for Review**. `store.config.json` sets **phased release on** and **automatic release off** (decision P7-9): after approval you press **Release**, and the release rolls out over 7 days.
2. **Android.** Promote the closed-track build to production:
   ```bash
   cd apps/$APP
   eas submit --profile production --platform android --latest
   ```
   The `production` submit profile sets `releaseStatus: inProgress` with `rollout: 0.05` (a staged rollout: 5% of users). (UNVERIFIED for a brand-new app: if Play refuses a staged first release, submit as a draft and release from the Console.) The same `production` profile also uploads the iOS build when run with `--platform ios`; normally use `testflight` for that and promote inside App Store Connect.
3. **Raise the rollout.** After 24 hours with no new crash clusters (Sentry) and no rise in `5xx` on `/v1`, raise Play to 20%, then 50%, then 100% in Play Console → Production → Releases → Update rollout. Check the phased release on iOS the same way (App Store Connect → the version → Phased Release for Automatic Updates). Between each step check section 5's signals.
4. **Update the store links and the minimum version** only after the build is available to everyone (section 5).

### 2.7 After the release
1. Tag the commit `mobile-<version>` and note the build ids and rollout dates in the release notes.
2. Watch Sentry (new issues per release), App Store Connect → Crashes, Play Console → Android vitals, and support mail for the first 48 hours.
3. If the privacy labels changed, confirm both stores show the new answers.

## 3. Over-the-air fixes (EAS Update)

JavaScript and assets can be fixed without a store review, for builds that share a **fingerprint** runtime version. This is for fixing bugs, not for shipping features around review.

**Use an over-the-air update when:** the fix is JavaScript or an asset or a catalog string; a store build would arrive too late for the problem; and `expo-doctor` and the tests pass.
**Do not use one when:**
- native code, a config plugin, a permission, an entitlement, an SDK or a dependency changed (the fingerprint changes; the update will not reach existing builds, and shipping it anyway can crash them): do a store build;
- the change alters what the app does or collects in a way a reviewer or the privacy labels would care about (new data, a new permission prompt, selling something): it needs review and a label update;
- a Staff device is inside an event window (24 hours before start to 2 hours after end) unless the fix unblocks the door. Then test it on the spare device first, publish at a quiet moment, and tell the on-site lead. Never push a convenience update to Staff during an event.

Steps **(owner)**:
1. Check the fix does not change the fingerprint: in `apps/$APP` run `eas fingerprint:compare` against the build you want to reach (UNVERIFIED command name; the EAS dashboard shows the same comparison). If it differs, stop and do a store build.
2. Publish to the preview channel first and try it on a preview build **(device)**:
   ```bash
   cd apps/$APP
   eas update --channel preview --environment preview --message "Fix <what>"
   ```
3. Publish to production (UNVERIFIED: the `--environment` flag name; the EAS dashboard shows which environment an update used):
   ```bash
   eas update --channel production --environment production --message "Fix <what>"
   ```
   Apps check for an update at launch and apply it on the next start. Confirm in Sentry that the new update id appears and the error stops.
4. To undo a bad update, republish the last good one or roll back to the embedded build:
   ```bash
   eas update:rollback --channel production
   ```
   (UNVERIFIED; the EAS dashboard → Updates also offers "Republish" of an earlier update.)

Every over-the-air fix still needs a normal store build in the next regular release, so the stores' binaries carry the fix.

## 4. The 72-hour event freeze

**Rule (P7-9):** no store build is **submitted or released** in the 72 hours before a large event starts, and not while it runs. Over-the-air fixes only, under section 3.

1. Look at the event calendar for events with more than 1 000 expected scans, and at the Staff devices enrolled for upcoming events (the console's device board).
2. If a freeze starts before the release finishes, **pause** the Play rollout at its current percentage (Play Console → Update rollout → Halt) and press **Pause phased release** on iOS. Do not raise either until the event has ended and been reconciled.
3. A critical fix during a freeze goes over the air (section 3), unless the fingerprint changed. In that case ask the event lead: a build that takes a day to review cannot save the door, and the previous version keeps working (the server stays backward compatible; `/api/v2` is frozen and `/v1` is additive only).

## 5. Minimum versions

The apps ask the server for their minimum version at launch. The server answers **426 Upgrade Required** to an app below it and shows a full-screen "Update required" with the store link. The support window is the current and the two previous releases (P7-9).

**Never raise the minimum for Staff while any Staff device is inside an event window** (24 hours before start to 2 hours after end). The server already refuses to enforce it for a device in its window, but do not rely on that: a bump during an event is a mistake.

Steps **(owner)**, in Doppler for the production web and API hosts (names in `.env.example`):
1. Wait until the new version is available to **100%** of users in both stores, and at least a week has passed.
2. Check the calendar (decision P7-9): no Staff event window now or in the next 24 hours.
3. Set the new minimum for one app and platform at a time, for example Yayatoh on iOS:
   ```text
   MOBILE_CONFIG_JSON={"apps":{"yayatoh-ios":{"minimumVersion":"3.0.0"}}}
   ```
   The app ids are `yayatoh-ios`, `yayatoh-android`, `yayatoh-staff-ios` and `yayatoh-staff-android`. Keep entries you set before: the value is one JSON document.
4. Deploy the config (`deploy.md`); check an old build now shows the update screen and a current build does not.
5. **To lift it** (a bad release, a store delay), remove or lower the entry and deploy. This is the fastest rollback for a forced upgrade.

## 6. Rollback

Store releases cannot be un-released: pick the fastest action that stops the harm.

| Problem | First action | Then |
|---|---|---|
| A JavaScript bug in a build that has an update channel | `eas update:rollback --channel production` or republish the last good update (section 3) | Fix forward in the next build |
| A bad staged rollout on Play | Play Console → Production → **Halt rollout** | Fix forward; submit a new build with a higher version code. A halted release is never "rolled back" to an older version code: Google only accepts a higher one |
| A bad phased release on iOS | App Store Connect → **Pause phased release** (up to 30 days) | Submit the fix and ask for an expedited review if users are harmed (App Store Connect → Contact Us → Request an Expedited App Review) |
| A server change broke an old build | Roll back the server first ([rollback.md](rollback.md)); the apps are written to tolerate older servers | |
| The forced upgrade (section 5) locks people out | Lower or remove the minimum version and deploy | |
| A Staff build misbehaves during an event | Do not update. Use the web Scan PWA on the same event as a fallback ([checkin-drill.md](checkin-drill.md)); the enrolled devices keep scanning offline from the saved guest list | Fix after the event |

For a full outage or data exposure start with [incident.md](incident.md). Remove an app from sale only for a legal or safety reason, and only the owner does it.

## 7. When a review comes back rejected

Read the message, answer inside App Store Connect (or the Play Console policy page), and change only what it asks. Common ones for these apps, with the answer already written down in `compliance.json`:

| Rejection | Answer |
|---|---|
| 3.1.1 / 3.1.3(e): payments | Tickets are admission to physical events, a real-world service; they are paid in a web checkout, and no virtual or livestream access is sold in the app. Point to the review notes. |
| 4.8: login | Sign in with Apple is offered beside Google (Yayatoh). Staff has no third-party login. |
| 5.1.1(v): account deletion | Yayatoh → Account → Delete account. Staff has no personal account for a door device; organizers' and reps' accounts are deleted on the web. |
| 4.2: minimum functionality | Describe the offline tickets, QR codes, checkout, transfers and notifications (Yayatoh), or offline door scanning with an encrypted guest list (Staff). |
| 2.1: needs demo access | Check the review server is up, the demo values are current (rotate with `pnpm reviewer-demo --target=staging --rotate-door`), and reply with the exact steps. |
| 5.1.2: privacy | Show `privacy.json` and the in-app prompts: notifications after the first purchase or ticket, location only after "Near me", camera only for QR codes. |
| Missing export compliance | Section 1.2 step 4. |

## 8. Related
- [deploy.md](deploy.md), [rollback.md](rollback.md), [incident.md](incident.md), [checkin-drill.md](checkin-drill.md)
- `docs/plans/mobile.md`, `docs/adr/0025-mobile-apps.md`, `docs/specs/M7.5a/spec.md`
- `docs/owner-inbox.md` ("M7.5a")
