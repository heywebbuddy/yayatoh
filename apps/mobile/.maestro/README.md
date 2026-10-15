# Maestro flows for the attendee app

`journeys.json` is the index: every journey of the plan, the flows that cover it, the platforms, whether the flow runs
in EAS and why not when it does not. `node tools/check-maestro/cli.ts` checks it against this directory (CI runs it).
`docs/specs/M7.X/maestro.md` has the journey table, the fixture contract and how to run the flows.

Written, not run: cloud sessions have no simulator or emulator. The flows target the **preview-id** build
(`com.yayatoh.yayatohapp.preview`; the EAS profiles `e2e-ios` and `e2e-android` build it), not a development build,
which opens the dev launcher first.

- Server and password are passed at run time, never written here:
  `maestro test -e DEV_SERVER=https://<server> -e DEV_PERSONA_PASSWORD=... apps/mobile/.maestro/<flow>.yaml`
  (or `MAESTRO_DEV_SERVER` and `MAESTRO_DEV_PERSONA_PASSWORD` in the environment). The server runs with
  `YAYATOH_DEV_AUTH=1` and the seed.
- `scripts/` makes accounts, events and ticket holders through the dev routes; `subflows/` holds the shared starts
  (`sign-in`, `sign-in-code`, `acquire-ticket`, `prelude-*`).
- `payloads/` and `send-push.sh` send a push to a booted iOS simulator (`APP_ID` defaults to the e2e build) for the
  two push-tap flows, which no CI runner can do.
- Add a flow: put the file here, add it to `journeys.json` (flow entry and journey), start it with the three header
  comments (`# Journey:`, `# Preconditions:`, `# Personas:`), and run the checker.
