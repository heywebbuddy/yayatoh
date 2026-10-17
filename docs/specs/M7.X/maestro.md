# Spec: M7.X — Maestro in CI

- **Milestone:** M7.x (Phase 7 plan `docs/plans/mobile.md`, row M7.x "Hardening"; brief `docs/agent-briefs/m7.x.md`, bullet "Maestro in CI")
- **Status:** Built (2026-10-15). Nothing here could be run: the cloud session has no iOS simulator, no Android emulator, no Maestro and no Expo account. The static checks and their tests run; the flows and the EAS workflows are **written, not run**.
- **Risk tags:** `infra`. No server code, no `/v1` response, no migration.
- **Related:** `docs/specs/M7.3/*`, `docs/specs/M7.4*/*` (the flows they list as "written but not run"), `docs/owner-inbox.md` (section "M7.x — Maestro in CI")

## 1. What was built

| Piece | Where |
|---|---|
| Journey inventory and checker | `tools/check-maestro/` (`cli.ts`, `src/check.ts`, tests), run by CI in the `mobile` job (`node tools/check-maestro/cli.ts`) |
| One manifest per app, mapping every journey of the plan to its flows | `apps/mobile/.maestro/journeys.json`, `apps/staff/.maestro/journeys.json` |
| Gap flows and repaired flows (16 new journey flows, 5 attendee sub-flows, 5 helper scripts) | `apps/mobile/.maestro/`, `apps/staff/.maestro/` |
| EAS Workflows, one per app | `.eas/workflows/maestro-mobile.yml`, `.eas/workflows/maestro-staff.yml` |
| Simulator and emulator build profiles (the existing profiles are untouched) | `e2e-ios`, `e2e-android` in `apps/mobile/eas.json` and `apps/staff/eas.json` |
| The GitHub Action that starts the EAS workflows, and skips cleanly without the secret | `.github/workflows/maestro.yml` |
| Tests for all of it | `tools/check-maestro/tests/` (`check`, `scripts`, `workflows`; 70 tests, run by `pnpm test`) |

### The checker (`tools/check-maestro`)
`node tools/check-maestro/cli.ts [--app mobile|staff]` exits 1 when:
- a journey of the plan is missing from a manifest (`REQUIRED_JOURNEYS` in `src/check.ts` is the plan's list), or a journey has no flow and no `manual` reason, or a platform it applies to has no flow and no `manualPlatforms` reason;
- a flow named by a journey or the manifest does not exist, or a flow in the directory is not in the manifest, or a flow belongs to no journey, or a sub-flow is run by nothing;
- a flow has no `appId`, an `appId` that is a variable or not the app's e2e build id, or a top comment without `# Journey:`, `# Preconditions:` and `# Personas:`;
- a flow the manifest calls `clean` does not start from `launchApp` with `clearState: true` (it follows `runFlow` into sub-flows; later restarts may keep state);
- a flow sleeps: `waitForAnimationToEnd` over 3 s, an optional `extendedWaitUntil` over 3 s (only the two-phone drill flows may hold a phone this way, up to 60 s), a `sleep`-like command, or a script with `sleep`/`setTimeout`. Waiting for the thing itself with `extendedWaitUntil` is how every flow waits;
- a flow, script or payload holds something that looks like a real secret (keys, tokens, JWTs, private keys, `yyd_`/`yyr_`/`yyp_` tokens), a literal value for an env entry named like a password or token, or a URL whose host is not a test host or one of our domains (no Apple, Google or Stripe pages);
- a flow that toggles airplane mode is tagged for iOS (Maestro's `setAirplaneMode` does not work on the iOS simulator);
- the manifest marks a flow `ci` but it needs something the EAS runner does not have (`CI_PROVIDED`: `dev-server`, `seeded-data`, `fake-providers`), or a flow stays out of CI without a `ciReason`.

`--print-flows <app>:<ios|android>` prints the flows the EAS workflow runs; `workflows.test.ts` fails when the `.eas` files list anything else, so the manifest is the one place that decides. `--table <app>` prints the tables in section 4.

### The manifest
Per flow: `kind` (`flow` or `subflow`), `platforms` (`ios`, `android`, `both`), `clean`, `ci`, `ciReason`, `needs`, `twoDevices`. Per journey: `id`, `title`, `platforms`, `flows`, optionally `manual` (the whole journey needs a person; flows listed cover only a part), `manualPlatforms` (a platform no flow covers, with the reason), `devicePass` (steps for the device pass) and `notes`.

`needs` vocabulary: `dev-server` (a server with `YAYATOH_DEV_AUTH=1`, so `/api/dev/*` exists), `seeded-data` (`pnpm seed` and the seeded organization `lakeside-events`), `fake-providers` (fake payments, wallet, mail), `two-devices`, `door-device` (an enrolled door device), `online-event`, `console-actor` (a person acting in the organizer console during the flow), `push-sender`, `min-version-server`, `camera-hardware`, `real-accounts`, `signed-build`, `device-locale`, `system-ui`.

## 2. How the flows get their data (the e2e server)
Every CI flow makes what it needs through routes that already exist and answer 404 unless `YAYATOH_DEV_AUTH` is on (never in production). **No endpoint was invented.** The server the EAS builds talk to is the owner's (section 6) and needs: `pnpm db:bootstrap && pnpm db:migrate && pnpm seed`, `YAYATOH_DEV_AUTH=1`, `DEV_PERSONA_PASSWORD`, `PAYMENTS_PROVIDER` unset (fake payments), and the fake mail and wallet providers.

| Script (`.maestro/scripts/`) | Route | Gives the flow |
|---|---|---|
| `new-user.js` | `POST /api/dev/user` (`signIn=0`, optional `twoFactor=1`) | a throwaway account: email, password (the server's `DEV_PERSONA_PASSWORD`), a backup code |
| `new-event.js` | `POST /api/dev/user` (`password=0&org=new&event=published&payouts=active`) | a published event 30 days out with a free pass "Free entry" and a paid pass "Supporter", refund page "up to a week before", listed on the marketplace, with a fake connected account for the fake provider |
| `last-code.js` | `GET /api/dev/last-code` | the emailed sign-in code (attendee email code, exhibitor code) |
| `last-claim-link.js` | `GET /api/dev/mailbox?to=` | the claim token from the transfer email |
| `new-holder.js` | `POST /api/dev/leads` (`org=lakeside-events`) | a ticket holder with no account, their "My tickets" link |
| `new-organizer.js` + `totp.js` | `POST /api/dev/user` (`twoFactor=1&org=new&event=published`) | an organizer with two-step verification; `totp.js` computes the current authenticator code from the setup key (pure JavaScript SHA-1/HMAC; tested against the RFC 6238 vectors and Node's HMAC) |
| `new-exhibitor.js` | `POST /api/dev/leads` (`ready=1`) | an exhibitor admin with a lead licence, their invitation link, a badge code |

The server's origin and the dev password are never in a flow: pass them with `maestro test -e DEV_SERVER=https://... -e DEV_PERSONA_PASSWORD=...`, or as `MAESTRO_DEV_SERVER` and `MAESTRO_DEV_PERSONA_PASSWORD` in the environment (the scripts read both).

The e2e builds use `APP_ENV=preview` (the flows' `appId` is the preview id: `com.yayatoh.yayatohapp.preview`, `com.yayatoh.staff.preview`). `APP_ENV=e2e`, as the brief wrote it, is not an environment `buildExpoConfig` knows (it throws), and preview requires an https API. `API_BASE_URL` in the e2e profiles is the placeholder `https://e2e-server.invalid/api/v1`, so a build that was never pointed at a server fails loudly instead of talking to production.

## 3. How it runs in CI
`.github/workflows/maestro.yml`, on `pull_request` into `main` and `workflow_dispatch`, with `contents: read` only:
1. **`gate`** reads `secrets.EXPO_TOKEN` into an environment variable, answers `has_token=true|false` (`[ -n "$EXPO_TOKEN" ]`; the value is never printed or passed on) and, when it is empty, writes the notice *"Maestro on EAS skipped: EXPO_TOKEN is not set (owner: add it as a GitHub secret; see docs/specs/M7.X/maestro.md)"* and a run summary. Fork pull requests have no secrets, so they take this path.
2. **`maestro`** (`needs: gate`, `if: needs.gate.outputs.has_token == 'true'`, matrix `mobile` and `staff`) installs, runs the inventory, then runs `eas workflow:run ../../.eas/workflows/maestro-<app>.yml --non-interactive --wait` from the app's directory with `EXPO_TOKEN`, and fails when the EAS run fails.

**Without the secret the whole workflow is green** (`gate` succeeds, `maestro` is skipped). The offline inventory still runs on every pull request in the `mobile` job of `ci.yml` (one additive step).

Each EAS workflow fingerprints the project, reuses an e2e build with the same fingerprint (`get-build`) or builds a new one, then runs the CI flows on the iOS simulator build and on the Android emulator build. EAS shows each flow's result on the run's page (expo.dev, the project's Workflows tab); the CLI prints the run's address in the Action's log (unverified).

Only one trigger should start the run. By default it is the Action. If the owner links the Expo GitHub app, EAS also starts the workflow on its own from the `on.pull_request` block, and the `maestro` job in `maestro.yml` should then be deleted (otherwise each pull request runs twice and spends build credits twice).

### Not verified offline
Written from memory of Expo's documentation; no EAS account or token was used, and `eas` was never run. Each of these may need a one-line change at the first real run (the same list is in the workflow files' header):
- the EAS job types `fingerprint`, `get-build`, `build`, `maestro` and their `params` (`fingerprint_hash`, `profile`, `platform`, `build_id`, `flow_path`), the output names `ios_fingerprint_hash`, `android_fingerprint_hash`, `build_id`, and the `if:` expressions (`always()`, `||`) that choose between the cached and the new build;
- that a repository-root `.eas/workflows` is found for an app in a subdirectory, and that `flow_path` is relative to the repository root (otherwise move each file to `apps/<app>/.eas/workflows/` and drop the `apps/<app>/` prefix; the test reads one constant);
- that `eas workflow:run --wait` exists and exits non-zero on a failed run (fallback: `--json`, then poll `eas workflow:status <id> --json`);
- that job `env` reaches Maestro and that Maestro exposes `MAESTRO_`-prefixed variables to flows;
- that `on.pull_request.branches` is the trigger key (there is no `workflow_dispatch` in EAS: a manual run is `eas workflow:run`).
Also unverified: that Maestro's `setAirplaneMode` is Android-only (it is why offline flows are tagged `android`), and the system-sheet button names the push and location flows tap ("Allow", "Don't allow", "Allow While Using App", "While using the app").

## 4. Journeys

Source: `node tools/check-maestro/cli.ts --table <app>`. "Runs in EAS" means the flow is in the workflow for that platform; a journey that is "no" or "Android only" says why. **Manual-only** journeys are marked "manual:".

### Attendee app (`apps/mobile`)
| Journey | Flow | Platforms | Runs in EAS | Why not, or what stays manual |
|---|---|---|---|---|
| Launch: a fresh install opens on the welcome screen | `launch.yaml` | iOS, Android | yes | - |
| Sign in by email code (new account, wrong code, right code) | `sign-in-email-code.yaml` | iOS, Android | yes | - |
| Sign in with Apple | `welcome-methods.yaml` | iOS | yes | manual: Completing Sign in with Apple needs the system's Apple ID sheet and a real Apple account, and the app has no test seam for it; the flow proves only that the button shows on iOS and not on Android. The server side is covered by the api-v1 integration tests. device pass: Sign in with Apple on a real iPhone with a sandbox Apple ID. |
| Sign in with Google | `welcome-methods.yaml` | iOS, Android | yes | manual: Completing Google sign-in needs a real Google account and the owner's OAuth client ids; the e2e build has none, so the button is absent by design and the flow asserts that. The server side is covered by the api-v1 integration tests. device pass: Google sign-in on a real iPhone and an Android phone, once the owner adds the OAuth client ids. |
| Sign in with a password and the two-step code | `password-two-factor.yaml` | iOS, Android | yes | - |
| Sign out (and sign out everywhere asks first) | `sign-out.yaml` | iOS, Android | yes | - |
| Sign out removes the push registration | `sign-out-removes-device.yaml` | iOS, Android | yes | - |
| Delete account (App Review 5.1.1(v)) | `delete-account.yaml` | iOS, Android | yes | - |
| Tickets open offline after one sync | `tickets-open-offline.yaml` | iOS, Android | Android only | iOS: Maestro's setAirplaneMode does not work on the iOS simulator, so the offline half is a device-pass step with airplane mode turned on by hand. |
| Transfer a ticket and cancel the transfer | `tickets-transfer-cancel.yaml` | iOS, Android | yes | - |
| Claim a ticket from a link | `claim-from-link.yaml` | iOS, Android | yes | - |
| Request a refund | `refund-request.yaml` | iOS, Android | yes | - |
| Add the ticket to Apple Wallet / Google Wallet | `wallet-add.yaml` | iOS, Android | no | manual: A real pass needs the owner's Apple Pass Type ID and Google Wallet issuer account; with the fakes the wallet link is a placeholder and the system sheet is outside the app. The flow checks the button and that the fake link causes no failure message. device pass: Add a real pass to Apple Wallet and Google Wallet once the owner adds the accounts. |
| Add to calendar and directions | `calendar-directions.yaml` | iOS, Android | no | Hands off to the system Calendar and Maps, whose screens differ by OS version and emulator image. device pass: Watch the calendar form and the maps hand-off by eye on each OS version. |
| Discover: search, empty state, clear filters | `discover-search.yaml` | iOS, Android | yes | - |
| Event page: details and passes with all-in prices | `event-page.yaml` | iOS, Android | yes | - |
| Discover: near me asks for the location only when tapped | `near-me.yaml` | iOS, Android | no | Needs a simulated device location, which the EAS runner does not set. |
| Buy a ticket through the fake payment provider | `search-and-buy.yaml` | iOS, Android | yes | - |
| Cancel payment returns to the event, then pay again (one order) | `cancel-payment.yaml` | iOS, Android | yes | - |
| Orders: the order screen (the list has no entry point yet) | `orders-detail.yaml` | iOS, Android | yes | device pass: Open the orders list from the "still confirming" screen once a payment is slow. |
| A virtual ticket shows "Buy on the web", never a checkout | `virtual-ticket.yaml` | iOS, Android | no | Needs an online event, and no dev route or seed creates one (the organizer console does). |
| Push prompt after the first purchase, explanation before the phone sheet | `push-prompt-after-purchase.yaml` | iOS, Android | yes | - |
| Push prompt: "Not now" | `push-not-now.yaml` | iOS, Android | yes | - |
| Push prompt: denied blocks nothing | `push-denied-blocks-nothing.yaml` | iOS, Android | yes | - |
| Push tap while the app is open | `push-tap-foreground.yaml` | iOS, Android | no | Android: Android pushes come from the owner's FCM project; nothing can send one to an emulator from outside, so the Android check is a device-pass step with a real push. device pass: Real APNs and FCM delivery, and the tap from the lock screen. |
| Push tap from a closed app, every push type | `push-tap-cold-start.yaml` | iOS, Android | no | Android: Android pushes come from the owner's FCM project; nothing can send one to an emulator from outside, so the Android check is a device-pass step with a real push. device pass: Real APNs and FCM delivery, and the tap from the lock screen. |
| App links and universal links open the right screen from a closed app | `link-cold-start.yaml`, `link-universal.yaml` | iOS, Android | yes | device pass: Universal links (https) on a store-signed or TestFlight / Play internal build: the OS verifies apple-app-site-association and assetlinks.json. |
| A link that needs sign-in resumes after sign-in | `link-resume-after-sign-in.yaml` | iOS, Android | yes | - |
| A web "My tickets" link opens the ticket | `ticket-link.yaml` | iOS, Android | yes | - |
| Account > Notification settings in each permission state | `notification-settings.yaml` | iOS, Android | yes | - |
| Offline banner | `offline-banner.yaml` | iOS, Android | Android only | iOS: Maestro's setAirplaneMode does not work on the iOS simulator, so the offline half is a device-pass step with airplane mode turned on by hand. |
| Update required (426) screen | `update-required.yaml` | iOS, Android | no | Needs a server whose minimum app version is above the build's; the shared e2e server is not. |
| Arabic right-to-left smoke | `arabic-rtl-smoke.yaml` | iOS, Android | yes | device pass: Layout direction, VoiceOver and TalkBack in Arabic. |

### Staff app (`apps/staff`)
| Journey | Flow | Platforms | Runs in EAS | Why not, or what stays manual |
|---|---|---|---|---|
| Launch: a fresh install opens on enrolment | `launch.yaml` | iOS, Android | yes | - |
| Enrol a door device by opening the enrolment link | `enrol-by-link.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Enrol a door device by scanning the enrolment QR code | `enrol-scan-screen.yaml` | iOS, Android | no | manual: Reading a QR code needs a camera, and the iOS simulator has none; the flow covers the scanner screen around the scan (hint, permission, "enter the link instead"). device pass: Scan a real enrolment QR code from the console on an iPhone and an Android phone. |
| Pick the entrance this device scans at | `pick-checkpoint.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Scan: admit once, then the repeat is flagged | `scan-admit-and-repeat.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. device pass: Scan real printed and on-screen QR codes, in daylight and dark with the torch. device pass: Verdict time under 300 ms on a mid-range Android phone. |
| Scan: unknown and refunded codes are refused | `scan-refusals.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Scan: camera denied still lets staff type a code | `scan-camera-denied.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Scan: typed-code validation | `scan-manual-validation.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Offline drill (X): two phones admit the same ticket offline; the duplicate is flagged within 60 s | `offline-drill-phone-a.yaml`, `offline-drill-phone-b.yaml` | iOS, Android | no | iOS: Maestro's setAirplaneMode does not work on the iOS simulator, so the offline half is a device-pass step with airplane mode turned on by hand. device pass: Run on two real phones at once. |
| Door: find a guest and check them in by hand, with a reason, offline | `door-manual-checkin.yaml` | iOS, Android | no | iOS: Maestro's setAirplaneMode does not work on the iOS simulator, so the offline half is a device-pass step with airplane mode turned on by hand. |
| Door: guest list check-in | `guest-list.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Door: help requests (raise, take, start, resolve) | `assistance-queue.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Door: lookup by name, phone or email | `lookup.yaml` | iOS, Android | no | Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Leads: capture offline, then sync (shared fields only) | `leads-offline-sync.yaml` | iOS, Android | Android only | iOS: Maestro's setAirplaneMode does not work on the iOS simulator, so the offline half is a device-pass step with airplane mode turned on by hand. device pass: Scan a real badge with the camera. |
| Organizer sign-in with the authenticator code | `organizer-sign-in.yaml` | iOS, Android | yes | - |
| Organizer event-day view (read only) | `organizer-event-day.yaml` | iOS, Android | yes | - |
| Exhibitor sign-in by invitation link and emailed code | `exhibitor-sign-in.yaml` | iOS, Android | yes | - |
| Remote wipe erases the device within a heartbeat | `remote-wipe.yaml` | iOS, Android | no | An organizer must click Wipe in the console while the flow waits; Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Revoke returns the device to enrolment within a heartbeat | `revoke.yaml` | iOS, Android | no | An organizer must click Revoke in the console while the flow waits; Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Update required (426) outside an event window | `update-required.yaml` | iOS, Android | no | Needs a server whose minimum Staff version is above the build's; the shared e2e server is not. |
| No update screen inside an event window | `update-required-in-event-window.yaml` | iOS, Android | no | Needs a door device and a server whose minimum Staff version is above the build's; Needs an enrolled door device (ENROL_EVENT and ENROL_KEY); only the organizer console makes one, and no HTTP route does. |
| Arabic right-to-left smoke | `arabic-rtl-smoke.yaml` | iOS, Android | no | Needs the phone's language set to Arabic; Maestro can only try an iOS launch argument (unverified) and cannot change an emulator's language. device pass: Layout direction, VoiceOver and TalkBack in Arabic. |

### What stays manual, and why
- **Sign in with Apple and with Google** (attendee): the system sheet and a real account, and the app has no test seam; the e2e build has no Google client id by design. `welcome-methods.yaml` proves which buttons show. The server side of both grants is covered by the api-v1 integration tests.
- **Add to Wallet** (attendee): a real pass needs the owner's Apple Pass Type ID and Google Wallet issuer account; with the fakes the link is a placeholder.
- **Enrol by scanning the QR code** (Staff): needs a camera. `enrol-scan-screen.yaml` covers the screen around the scan.
- **Real push delivery and the tap from the lock screen** (APNs, FCM): needs the owner's accounts. `send-push.sh` sends a payload to a booted iOS simulator for the local Mac run; Android has no equivalent.
- **Universal (https) links**: the operating system verifies them only for a store-signed build against the production domains; CI builds are unsigned, so CI runs the same routes through the app scheme (`link-cold-start.yaml`) and `link-universal.yaml` waits for a TestFlight / Play internal build.
- **Offline half of the offline journeys on iOS**: no airplane-mode command for the simulator.
- **Hardware**: real camera scanning in daylight and dark, torch, verdict time under 300 ms on a mid-range Android phone, haptics and sound, VoiceOver and TalkBack, largest text, the layout direction in Arabic (M7.x accessibility audit, `a11y.md`).

### What stays out of EAS until a door device can be made by a script
Sixteen Staff flows need an enrolled door device (`ENROL_EVENT`, `ENROL_KEY`, ticket codes). Only the organizer console makes one (a Server Action), and no HTTP route or seed does, so a runner cannot. They are complete and run on a Mac or phones with values passed by `-e`. To bring them into EAS, add a dev-only route beside the others (for example `POST /api/dev/staff-device`, 404 unless dev auth is on) that makes a device with a ticket, a refunded ticket and a guest, and returns `eventId`, the device token and the codes; then add a `scripts/new-door-device.js` that calls it, set `ci: true` and replace `door-device` by `dev-server` in those flows' manifest entries. That route belongs to a server increment, not to this one (`apps/web` is not in this increment's scope).

## 5. Running the flows by hand
On a Mac with Xcode or an Android emulator and `maestro` installed (https://maestro.mobile.dev, not run here):
```
# 1. a server: pnpm dev, with YAYATOH_DEV_AUTH=1 and DEV_PERSONA_PASSWORD set; seeded (pnpm seed)
# 2. a preview-id build pointed at it over https (a tunnel works): APP_ENV=preview API_BASE_URL=https://<tunnel>/api/v1
#      pnpm --filter @yayatoh/mobile exec expo run:ios       # or run:android; same for @yayatoh/staff
#    or the EAS build of the same profile: eas build --profile e2e-ios   (owner's account)
# 3. one flow
maestro test -e DEV_SERVER=https://<tunnel> -e DEV_PERSONA_PASSWORD=... apps/mobile/.maestro/sign-in-email-code.yaml
# 4. every flow CI would run, for one platform
node tools/check-maestro/cli.ts --print-flows mobile:android | xargs maestro test -e DEV_SERVER=https://<tunnel> -e DEV_PERSONA_PASSWORD=...
```
Staff door flows take `-e ENROL_EVENT=<event id> -e ENROL_KEY=<device token>` (the pairing link on the event's devices page) plus the per-flow values in each flow's top comment (`TICKET_CODE`, `VOID_TICKET_CODE`, `GUEST_*`, `CHECKPOINT`). The two-phone drill runs `offline-drill-phone-a.yaml` and `offline-drill-phone-b.yaml` at the same moment (`maestro --device <id> test ...`). `remote-wipe.yaml` and `revoke.yaml` wait for an organizer to click Wipe or Revoke in the console. The push flows need `apps/mobile/.maestro/send-push.sh <name>` in a second terminal. A development build opens the dev launcher first, so these flows target the preview-id build.

## 6. What the owner does
Listed in `docs/owner-inbox.md`, section "M7.x — Maestro in CI": add the `EXPO_TOKEN` secret, link both Expo projects (`EAS_PROJECT_ID`), host the e2e server and replace the placeholder `API_BASE_URL`, give the flows the server and password (`MAESTRO_*`), and choose between the Action and the Expo GitHub app as the trigger. Until then the check is skipped, green.

## 7. Findings while writing the flows (for the next increments)
- **The orders list has no entry point.** `/orders` (`orders/index.tsx`) is reachable only from the "still confirming" screen; no tab, Account row or link opens it (the link allowlist has no `/orders` index). The journey "orders list/detail" is covered through the order screen only.
- **A door device cannot reach the door tools by tapping.** The scan screen links nowhere; `/tools/lookup`, `/tools/guests` and `/tools/assistance` are reached by deep link (`yayatoh-staff-preview://tools/...`, which the flows use and which depends on `+native-intent` letting the path through), and the hub (`/tools`) opens only for a signed-in organizer or rep.
- **The older flows were written against screens that were not built that way**, and are corrected here: M7.3b used personas that do not exist (`tess@example.test`, a fixed code `000000`, an event "Summer Night"); M7.3d's `buy-ticket.yaml` and `sign-in-seeded.yaml` tapped buttons that do not exist ("Buy tickets", "Checkout", "Send code") and `${APP_ID}` in the `appId`; M7.3c's flows bought a seeded event whose pass is free and then looked for a payment page; M7.3c/d used dev and preview ids in the same suite; M7.4a-c read the exhibitor code from a local Mailpit that the e2e server does not have, took the organizer's code from the environment (it expires in 30 s), and opened `tools/*` by link where an organizer reaches it through the hub. They now use the dev routes above, one app id, exact strings from the catalogs, and the ids the screens declare (`testID`).
- **Verification still open for every flow:** they match the catalogs and `testID`s in the source at this commit (checked by script), not a running app. Expect the first device pass to need small changes (timing, a system sheet's button name, a tap target hidden by the keyboard).

## 8. Acceptance
| Criterion (brief `m7.x.md`) | Where |
|---|---|
| Every journey in the plan has a flow, or a manual reason | `tools/check-maestro` (`required` and `no-flow` rules) and `tests/check.test.ts` |
| An EAS Workflows definition builds simulator and emulator builds and runs every flow for both apps on iOS and Android, on the merge PR | `.eas/workflows/maestro-*.yml`, `e2e-*` profiles; **not run** (no account), see "Not verified offline" |
| The workflow skips cleanly without `EXPO_TOKEN`, with a clear notice | `.github/workflows/maestro.yml` (`gate`); `tests/workflows.test.ts` |
| No step echoes the secret; least privilege; pinned actions | `tests/workflows.test.ts` |
| Every flow path in the `.eas` workflows exists and equals the manifest's CI list | `tests/workflows.test.ts` |
| No credentials in flows, scripts, workflows or `eas.json`; existing profiles unchanged | `tests/check.test.ts`, `tests/workflows.test.ts` |
| Maestro green in EAS when the secret exists | **device pass / first run after the owner adds the secret** |

## 9. Device pass (what a person does)
1. Add the secret and the server (section 6); run the workflow once by hand (`eas workflow:run`); fix the unverified fields it reports.
2. Run `link-universal.yaml` on a TestFlight build and a Play internal build.
3. The `devicePass` steps of the journey tables above: Apple and Google sign-in, real wallet add, real push on both platforms, QR scan of a real code, the two-phone drill on real phones, the offline halves on iOS, the 300 ms verdict time, VoiceOver, TalkBack and Arabic layout.
4. Make a door device by script (section 4) and move the Staff door flows into CI.
