# Maestro flows for the Staff app

`journeys.json` is the index (see `apps/mobile/.maestro/README.md` and `docs/specs/M7.X/maestro.md`); check it with
`node tools/check-maestro/cli.ts`. Written, not run: cloud sessions have no simulator or emulator. The flows target
the preview-id build (`com.yayatoh.staff.preview`, EAS profiles `e2e-ios` and `e2e-android`).

- **Run in EAS:** `launch`, `organizer-sign-in`, `organizer-event-day`, `exhibitor-sign-in`, `leads-offline-sync`
  (Android). They make their accounts through the dev routes (`scripts/`); `totp.js` computes the organizer's
  authenticator code from the setup key.
- **Need an enrolled door device** (pass `-e ENROL_EVENT=<event id> -e ENROL_KEY=<device token>` from the pairing link
  on the event's devices page, plus the values each flow's top comment names): the scan flows, `pick-checkpoint`,
  `lookup`, `guest-list`, `assistance-queue`, `door-manual-checkin`, `remote-wipe`, `revoke`,
  `update-required-in-event-window`, and the two-phone drill (`offline-drill-phone-a` and `-b`, run together).
- **Need a special server or phone:** `update-required` (a server whose minimum version is above the build),
  `arabic-rtl-smoke` (the phone in Arabic), `enrol-scan-screen` (a camera).
