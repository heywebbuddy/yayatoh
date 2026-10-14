# Spec: M7.4a — Staff enrolment and devices

- **Milestone:** M7.4a (Phase 7 plan `docs/plans/mobile.md`, Wave 3; brief `docs/agent-briefs/m7.4a.md`). Built 2026-10-14, branch `agent/m7.4a`.
- **Status:** Built (app code only; Maestro flows and device behaviour wait for the device pass)
- **Risk tags:** `mobile-contract` (uses `/v1/staff`, `/v1/devices`, `/v1/events/{id}/manifest`, `/v1/auth`, `/v1/portal/auth`; **no server change**), `infra` (two Expo modules in the catalog)
- **Related:** P7-6 (how staff sign in), P7-9 (version gate), P7-10 (iPad); ADR 0010, 0011, 0025; M7.2a (sign-in grants), M7.2d (426 rule), M7.2e (staff API)

## 1. Goal
A door device needs no personal account: an organizer shows an enrolment QR code and the Staff app scans it (or opens its link), keeps the device token in the keychain, picks where it scans, reports its health every 30 seconds and erases itself when an organizer revokes or wipes it. Organizers (with two-step verification) and exhibitor reps (with an emailed code) sign in without a device.

## 2. Scope (built)
All under `apps/staff`; strings in `apps/staff/messages/<locale>.json` (namespaces `enrol`, `device`, `organizer`, `exhibitor`, all 13 locales).

| Area | What it does | Files |
|---|---|---|
| **Device session** (`src/device/`, pushed first for M7.4b and M7.4c) | The `yyd_` token in secure storage (`yayatoh.staff.device.v1`). `useDevice()` returns `{ loaded, status: 'unenrolled' \| 'enrolled' \| 'revoked' \| 'wiped', deviceId, eventId, checkpointId, checkpointChosen, token, event, checkpoints, lastHeartbeatAt }` plus `enrol(link)`, `selectCheckpoint(id)`, `forget()`, `acknowledgeEnded()`, `onWipe(cb)`, `onSyncRequested(cb)`, `setQueueDepthSource(fn)`, `api` (the only `/v1` client that carries the token), `refreshEvent()`, `heartbeat()`, `clockOffsetMs`. Plain TypeScript with every native part injected (`createDeviceSession`). | `session.ts`, `provider.tsx`, `link.ts`, `battery.ts`, `bridge.tsx`, `navigation.tsx`, `index.ts` |
| **Enrolment** | `enrol(link)` accepts the QR's link (`…/scan#e=<event>&k=<token>`, any host, optional locale prefix, or `yayatoh-staff://scan#…`) or its two parts. The key must be in the fragment. One call proves it (`GET /v1/staff/events/{eventId}/overview`, which also names the device); only then is anything stored. Outcomes: `enrolled`, `invalid_link`, `rejected` (401), `wrong_event` (403/404), `rateLimited`, `unavailable`. Enrolling over a different token asks first and erases the old device's local data (`onWipe('replaced')`). | `session.ts`, `app/enrol/index.tsx` |
| **Camera scan** | `app/enrol/scan.tsx`: `expo-camera` `CameraView` for QR codes only; permission states (checking, ask, denied for good with an "open settings" button); a QR that is not an enrolment code is ignored with a message; the same code seen repeatedly is one scan; one enrolment at a time. | `app/enrol/scan.tsx` |
| **Opening a link** | `EnrolmentLinks` (root layout) reads the full URL from `expo-linking` and navigates to `/enrol` with `event` and `key` params; the screen takes them once and clears them from the route. `+native-intent.ts` keeps the router from opening `/scan` for an enrolment link. | `device/navigation.tsx`, `app/+native-intent.ts` |
| **Picker** | `app/select/index.tsx`: the enrolled event (name, dates in the event's time zone), the whole event and each entrance from the manifest header (`GET /v1/events/{eventId}/manifest?limit=1`, so a scoped device sees only its own); the choice is stored and reported with the next heartbeat; the chosen one is marked in words; retry when the event could not be read; "Remove this device" with confirmation. | `app/select/index.tsx` |
| **Heartbeat** | `POST /v1/devices/heartbeat` every 30 s while enrolled and the app is in the foreground: battery (`expo-battery`), queue depth (from `setQueueDepthSource`, 0 until M7.4b registers its outbox), clock offset (the Scan PWA's estimate, sent back on the next beat), event, place, app version. A supervisor's checkpoint directive is applied once; a sync request runs the `onSyncRequested` callbacks once. | `session.ts`, `provider.tsx` |
| **Revoke and wipe** | A 401 on the heartbeat means revoked, a `wipe` command means wiped. Either way, in that heartbeat: the token is deleted first (nothing can use it), the screen leaves the scanner (`DeviceGuard`), then every `onWipe` callback runs (M7.4b deletes the manifest database; the app clears the cached server state), then the marker `…ended.v1` says the wipe finished. If the app was closed mid-wipe, the callbacks run at next start. A 401 on any other device call asks the heartbeat at once (a wiped device is refused everywhere but the heartbeat). The enrolment screen says why until the next enrolment. | `session.ts`, `device/navigation.tsx`, `device/bridge.tsx` |
| **Version gate** | `suppressRequiredUpdate` is the device's `insideEventWindow()`: from 24 h before the event starts to 2 h after it ends (the server's own window, M7.2d). An enrolled device whose dates are not known yet counts as inside (the door must never be stranded; the server applies the real window to the device's own calls). The gate is asked again when the dates become known. | `services.ts`, `device/bridge.tsx` |
| **Organizer sign-in** | `app/sign-in/organizer.tsx`: email and password, then the authenticator (or backup) code, through mobile-core's `signIn.withPassword` and `completeTwoFactor`. **Two-step verification is required:** an account whose password sign-in returns tokens without the second step is signed out again and told to turn it on. Shared error strings come from the `core` catalog. | `app/sign-in/organizer.tsx` |
| **Exhibitor sign-in** | `app/sign-in/exhibitor.tsx`: the rep pastes the invitation link (or token), asks for a six-digit code (`POST /v1/portal/auth/code`), types it (`POST /v1/portal/auth/token`). The portal session (`yyp_` access token, rotating refresh token) reuses mobile-core's session store under its own key prefix, so it never touches an organizer's account session. `usePortal()` returns `{ status, api, requestCode, verifyCode, signOut, onSignedOut }` for the lead screens (M7.4c). | `src/portal/*`, `app/sign-in/exhibitor.tsx` |
| **Gate and wiring** | `app/index.tsx` sends an enrolled device to `/scan` (or `/select` until it has a place), a signed-in organizer or rep to `/tools`, anyone else to `/enrol`. `services.ts` builds the core, the device session and the portal session together; `core.ts` calls it with the phone's parts. | `app/index.tsx`, `services.ts`, `core.ts`, `app/_layout.tsx` |

**Interface for M7.4b and M7.4c.** `/scan` (M7.4b) and `/tools` (M7.4c) are the routes the gate and the screens here send people to. M7.4b: call `useDevice().setQueueDepthSource(() => outbox depth)`, `onWipe(() => delete the manifest database)` and `onSyncRequested(...)`; use `device.api` for `manifest` and `scans/batch`; read `eventId`, `checkpointId`, `event.startsAt`/`endsAt`. M7.4c: `device.api` for the staff routes; `usePortal().api` for `/v1/portal/leads/*`; `useCore().api` (the organizer's session) for `/v1/orgs/{org}/events/{event}/ops`; register `onSignedOut` / `onWipe` to clear what you cache.

## 3. Choices made (pending owner)
- **The enrolment key is the device token itself** (`k=<yyd_…>`), as in the Scan PWA's link. It is validated against the token format before anything is sent.
- **`expo-camera` for the enrolment scan**, because it is an Expo module with a ready permission hook. M7.4b scans tickets with VisionCamera; if two camera libraries are not wanted, the enrolment screen can use M7.4b's later (the scanner is one component).
- **Heartbeat runs whenever the device is enrolled and the app is in the foreground**, not only on the scan screen, so the device board shows it online and a wipe reaches it promptly.
- **Event dates come from the manifest header** (`limit=1`): the staff overview carries no start or end. A small additive field on the overview would save that call.
- **A wipe or revoke does not sign out an organizer or rep** on the same phone (their sessions are separate); screens that cache their data clear it with `onSignedOut`.
- **Exhibitor sign-in needs the invitation link pasted**: the app-links allowlist (M7.2d) has no `/event-portal/invite/…` path, so the email's link opens in the browser. "Email me my invitation again" (`/portal/auth/invitations`, needs the event's sign-in page token) is not built.

## 4. Later / not yet
- Kiosk mode and the kiosk fields of the heartbeat answer (the PWA's self check-in); the app ignores them.
- Universal link for the exhibitor invitation; "send my invitation again".
- Scanning, the manifest, the outbox (M7.4b); lookup, assistance, counts, lead capture, the organizer's ops view (M7.4c).
- Running on a simulator or phone: device pass.

## 5. Acceptance
| Criterion | Test or check |
|---|---|
| A wiped device erases its token and data within one heartbeat | `tests/device-session.test.ts` ("a wiped device…", "is wiped within one heartbeat of the timer", "a 401 on any other device call…"); `tests/navigation.test.tsx` (guard returns to enrolment); `tests/enrol-screen.test.tsx` |
| A revoked device returns to enrolment | `tests/device-session.test.ts` ("a revoked device…", "shows why after a restart"); `tests/navigation.test.tsx`; `tests/gate.test.tsx` |
| The enrolment key never appears in a request URL, a log or a crash report | `tests/device-session.test.ts` ("sends the key only in the Authorization header", "privacy: …"); `tests/device-link.test.ts` ("redaction"); `tests/enrol-screen.test.tsx`, `tests/enrol-scan.test.tsx`, `tests/navigation.test.tsx` (no URL, route or navigation call carries it after use) |
| No required-update screen inside an event window, even when the server says the version is below minimum | `tests/version-gate.test.tsx` (inside, 23 h before, 1 h after, boundaries, dates unknown, 426 inside and outside) |
| Component tests for every state; Arabic right to left | `tests/enrol-screen.test.tsx`, `tests/enrol-scan.test.tsx`, `tests/select-screen.test.tsx`, `tests/organizer-sign-in.test.tsx`, `tests/exhibitor-sign-in.test.tsx`, `tests/sign-in-chooser.test.tsx`, `tests/gate.test.tsx` |
| iPad layout: a readable column, 44 pt targets, start-aligned text | `tests/ui-kit.test.tsx`; `ios.supportsTablet` in app config (M7.1b) |
| Catalogs: 13 locales, valid ICU, plural forms per language | `tests/i18n.test.ts` |
| Exhibitor portal session: refresh, reuse ends the session, kept apart from the account session | `tests/portal-session.test.ts` |
| Maestro: enrol by link, pick a checkpoint, remote wipe (and revoke), organizer and exhibitor sign-in | `.maestro/enrol-by-link.yaml`, `pick-checkpoint.yaml`, `remote-wipe.yaml`, `organizer-sign-in.yaml`, `exhibitor-sign-in.yaml` — **device pass** |
| Camera scan of a real QR code, heartbeat battery reading, iPad layout | **device pass** |
