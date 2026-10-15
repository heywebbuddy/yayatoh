# M7.4b — Offline scanning (`apps/staff`)

The Staff app scans tickets at the door with no connection: the guest list sits in an encrypted database on the phone, every verdict comes from `@yayatoh/checkin-engine`, and every scan waits in an outbox until the server has it. It stacks on M7.4a (the enrolled device: `useDevice()`, `onWipe`, the heartbeat).

## What was built
- **Camera** (`src/scan/ui/qr-camera.tsx`): `react-native-vision-camera` v5 with an object output restricted to `qr`, so no other barcode can become a scan. A torch toggle (shown only when the phone has one) and a manual code entry (`manual-entry.tsx`). A permission gate (`camera-gate.tsx`): "allow", or, when denied or restricted, how to turn it back on in Settings with a button that opens them, and a way to keep going by typing a code.
- **Manifest** (`src/scan/engine.ts`, `store.ts`, `db.ts`, `native-db.ts`):
  - Pages from `GET /v1/events/{id}/manifest` (cursor, overlap on the first page, 2000 rows a page) into `expo-sqlite` built with SQLCipher. The key is 256 random bits made once and kept only in the keychain (`expo-secure-store`, this device only); `PRAGMA key` is the first statement, in raw form.
  - The signed scope is verified before a page is written (a tampered scope is never used); an older manifest format is fetched again from scratch; a reissued ticket's old short code stops working; the clock offset is measured from the server time on every sync.
  - A database the key cannot open (a lost key) is deleted and started again. A database left by another event is emptied.
  - Refreshed every five minutes, on reconnect and on "Sync now" (`scheduler.ts`), always off the scanning path. An OS background task (app closed) is not built (see "Not yet").
  - Deleted 24 h after the event ends (`expireIfDue`, at start-up, on the tick and on returning to the foreground): one last send is attempted, then the tables are emptied, the file deleted and the key removed. Deleted on revoke, wipe or removal through M7.4a's `onWipe` (`runtime.ts`, `provider.tsx`), registered by the provider in the root layout so it works whether or not the scan screen was ever opened.
- **Verdicts** (`src/scan/verdicts.ts`, `ui/verdict-panel.tsx`, `feedback.ts`): from `offlineVerdict` only (nothing re-implemented). 22 results are shown (admit, granted, entered, scanned out, provisional, duplicate, duplicate found after sync, superseded, void/refunded, unknown, wrong event, doors closed, wrong date, not today, no access, wrong entrance, balance due, not in the room, not signed up, not included, room full). Each has a solid colour block (success, warning, danger tokens; the text colour is whichever of white and black has more contrast, at least 4.5:1 in both modes), a glyph (✓ ! ✕), a 36-point headline, the holder and ticket type, and a sound and a haptic. Four sounds (admit, flagged pass, repeat, refusal) and four vibration patterns are all different (`tools/make-staff-sounds.mjs` makes the WAV files). A repeat says when and where this phone first admitted the ticket, in the event's time zone.
- **Outbox** (`engine.ts`, `backoff.ts`, `scheduler.ts`): every scan is saved with its admission in one transaction before the verdict is returned, then sent to `POST /v1/scans/batch` in batches of up to 500, oldest first, one run at a time, with exponential backoff (2 s doubling to 5 min, ±20 %). A scan leaves the queue only after the server answered for it, and the server applies each scan id once, so a flush cut off half-way is sent again safely. A batch the server refuses as malformed is halved until the bad scan stands alone, then dropped and reported. A refused device token stops the queue (M7.4a's client handles the wipe). The queue depth feeds M7.4a's heartbeat through `setQueueDepthSource`; a supervisor's sync request runs `syncNow` through `onSyncRequested`.
- **Duplicates found after sync** (`ui/flagged-panel.tsx`): when the server judges a scan the phone admitted differently (another door was first), the scan is kept as a flag, shown above the camera with the holder, the time and a repeat sound and vibration, and stays until staff dismiss it. Flags survive a restart.
- **Session doors** (M5.6a): who this phone let into a room and the room's count survive a restart; an In/Out switch appears at a session door.
- **Speed** (`timing.ts`): each verdict's time is kept (`engine.timings`) and, in development builds, logged every 25 scans (durations only) for the device pass.

## Files
`apps/staff/src/scan/` (engine, store, db, native-db, runtime, scheduler, provider, api, verdicts, feedback, timing, backoff, ids, session-door, types, use-scan, `ui/*`), `apps/staff/src/app/scan/index.tsx`, `apps/staff/tests/scan/*`, `apps/staff/tests/mocks/vision-camera.tsx`, `apps/staff/.maestro/{scan-*,offline-drill-*}.yaml`, `apps/staff/assets/sounds/*.wav`, `tools/make-staff-sounds.mjs`, `docs/specs/M7.4b/spec.md`. Small additive edits to shared files: `src/app/_layout.tsx` (one provider around `ThemedStack`), `app.config.ts` (the SQLCipher plugin), `package.json`, `pnpm-workspace.yaml`, `messages/*.json` (namespace `scan`, placed first so other builders' additions after `home` never touch it).

## Native dependencies added (`apps/staff`)
| Package | Version | For |
|---|---|---|
| `react-native-vision-camera` | 5.2.3 | QR scanning, torch |
| `react-native-nitro-modules` | 0.37.0 | peer of VisionCamera v5 |
| `react-native-nitro-image` | 0.15.2 | peer of VisionCamera v5 |
| `expo-sqlite` | ~57.0.4 (57.0.4) | the encrypted manifest (config plugin `useSQLCipher`) |
| `expo-haptics` | ~57.0.3 (57.0.3) | verdict vibration |
| `expo-audio` | ~57.0.5 (57.0.5) | verdict sounds |
| `expo-asset` | 57.0.19 | required peer of `expo-audio` (pinned to the version `expo@57.0.28` ships, so `expo-doctor` finds no duplicate) |

No new JavaScript crypto: verification is `@yayatoh/ticket-crypto` (pure JavaScript, M7.1a).

## Permission strings
None added. `NSCameraUsageDescription` and `android.permission.CAMERA` were already in `app.config.ts` for the Staff app (M7.1b); a test pins that the app asks for nothing else (no microphone, location or photos). `expo-audio` and `expo-haptics` are used without their config plugins, so no microphone permission is requested.

## Measured
`pnpm --filter @yayatoh/staff exec jest tests/scan/speed.test.ts` (Node 24.22, linux/x64, 300 distinct signed codes after 20 warm-up) runs the whole app path (verify the signature, find the ticket, apply the event rules, write the admission and the outbox row to SQLite) and logs about 3 to 4 ms mean and under 10 ms p95 per verdict; the M7.1a benchmark for the engine alone is 2.1 ms mean. Hermes on a mid-range phone is slower by an unknown factor; **the target (every verdict under 300 ms) is checked in the device pass** from the log lines the app prints. If it is missed, the plan's fallback applies: a small native verifier (CryptoKit, Tink) as an Expo module behind `verifyTicketCode`. Hermes has no VM binary in this environment, so it could not be measured here.

## Not yet / later
- **Hermes timings and real SQLCipher encryption** on a phone (device pass below).
- **The OS background refresh** of the list while the app is closed (`expo-background-task`): the list refreshes while the app is open, which is where a door phone sits.
- **The phone that wins a race is not told.** When two phones admit the same ticket offline, the server keeps the earlier one and the later one's sync returns `duplicate_offline`; that later phone flags it on screen. If the earlier scan syncs second, the server flips the first phone's stored result and raises the `checkin.duplicate_offline` alert (supervisors, the ops view in M7.4c), but the first phone's sync had already returned "admitted" and the API has no way to tell it. Both phones admitted the person; the alert still reaches a supervisor within the minute.
- **Where/when for a duplicate another door admitted** (the API does not return it). The "first admitted at … at …" line is this phone's own record.
- **Guest check-in by name, the kiosk and the A–Z board** (Scan PWA features) are later increments; M7.4b is the QR and typed-code path.
- A session door's **override** (admit past a gate with a reason) is online only and not built here.

## Pending the owner
None new. The decision to build a native verifier is conditional on the device pass (above).

## Device pass (needs a phone)
1. Run every Maestro flow in `apps/staff/.maestro/` (`scan-admit-and-repeat`, `scan-refusals`, `scan-camera-denied`, `scan-manual-validation`) against a preview build with a seeded event, and the two-phone `offline-drill-phone-a.yaml` / `offline-drill-phone-b.yaml`.
2. Read the verdict-time log lines (`[scan] verdict … p95 …`) on a mid-range Android phone and an iPhone; every verdict under 300 ms.
3. Pull `yayatoh-scan.db` from the app's container and open it with `sqlite3`: it must say "file is not a database". Wipe from the console and check the file is gone within one heartbeat.
4. Scan real printed and on-screen QR codes in daylight and in a dark room with the torch, and check the camera never reports a non-QR barcode.
5. Check the four sounds and four vibrations are told apart at arm's length, with the ringer switch off.

## Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | Every M7.1a test vector gives the same verdict through the app's path (download through the engine's sync, save, reload from SQLite, scan) | `tests/scan/vectors.test.ts` (69 scenarios, 7 manifests) |
| AC2 | **Offline drill (X):** two phones, two outboxes, offline, admit the same ticket, reconnect: the duplicate is flagged within 60 s | `tests/scan/drill.test.ts`; Maestro `offline-drill-phone-a/b.yaml` (device pass) |
| AC3 | The manifest file cannot be read without the key: `PRAGMA key` first and in raw form; the key is 256 random bits in the keychain only; a wrong key is refused; deleting the file also deletes the key | `tests/scan/db.test.ts`; opening the real file without the key is the device pass |
| AC4 | Remote wipe, revocation and removal delete the database and key, with the scan screen never opened | `tests/scan/runtime.test.ts`, `tests/scan/provider.test.tsx` |
| AC5 | The list is deleted 24 h after the event ends (not before), after one last send | `tests/scan/engine.test.ts` (expiry), `tests/scan/drill.test.ts` (the tick), `tests/scan/runtime.test.ts` |
| AC6 | Verdict time is measured and inside the budget on Node; the 300 ms target on a phone is logged | `tests/scan/speed.test.ts`; device pass |
| AC7 | Every verdict is shown with colour, words, glyph, sound and haptic, in English and Arabic; the text colour is readable in light and dark | `tests/scan/verdict-panel.test.tsx` (22 verdicts × 2 locales), `tests/scan/verdicts.test.ts`, `tests/scan/screen.test.tsx` |
| AC8 | Denied (and restricted) camera permission explains how to allow it and still lets staff type a code; first use asks; no camera is handled | `tests/scan/screen.test.tsx`; Maestro `scan-camera-denied.yaml` (device pass) |
| AC9 | QR codes only; torch; manual entry with validation | `tests/scan/screen.test.tsx`; Maestro `scan-manual-validation.yaml` (device pass) |
| AC10 | The outbox sends batches of at most 500, retries with backoff, survives a restart, and a cut-off flush is safe to repeat; a refused token stops it; a malformed scan is isolated | `tests/scan/outbox.test.ts` |
| AC11 | A duplicate the server finds after sync is flagged on screen, survives a restart and can be dismissed | `tests/scan/outbox.test.ts`, `tests/scan/screen.test.tsx` |
| AC12 | The queue depth feeds the heartbeat; a supervisor's sync request runs; the phone being offline holds the network off | `tests/scan/provider.test.tsx` |
| AC13 | The server calls go through `@yayatoh/sdk` with the device token and map refusals correctly | `tests/scan/api.test.ts` |
| AC14 | Arabic right to left, with accessibility labels on every control | `tests/scan/screen.test.tsx`, `tests/scan/verdict-panel.test.tsx` |
| AC15 | The `scan` catalog has the same keys, placeholders and plural forms in all 13 locales | `tests/i18n.test.ts` |
| AC16 | The build uses SQLCipher and asks only for the camera | `tests/scan/app-config.test.ts` |
| AC17 | Session doors keep the room across a restart and use the In/Out switch | `tests/scan/session-door.test.tsx` |
| AC18 | Native modules: both platforms bundle | `expo export --platform ios` and `--platform android` (gate) |
