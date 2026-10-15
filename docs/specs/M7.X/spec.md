# Spec: M7.X — Mobile hardening

- **Milestone:** M7.x (Phase 7 plan `docs/plans/mobile.md`, Wave 4)
- **Status:** Built (2026-10-15), branch `agent/m7.x`. No migration. One server change (below).
- **Risk tags:** `mobile-contract` (response *headers* of `/v1` changed; no body, field or path changed, so oasdiff is unaffected), `auth` (new rate-limit policies on the sign-in routes).
- **Detail pages:** `a11y.md` (accessibility audit), `maestro.md` (Maestro in CI), `load.md` (k6), and `docs/ops/security-review-phase7.md` (security review).

## 1. Goal
Close Phase 7 before the device pass: every journey has a Maestro flow and a CI path for it, every screen has been audited against the accessibility rules, the new routes have load tests, the whole Phase 7 surface has been reviewed for security, and every new response is checked for leaks.

## 2. What was built
| Area | What | Where |
|---|---|---|
| **Maestro in CI** | A journey inventory per app (`journeys.json`) and a checker that fails on a journey without a flow, a flow outside the manifest, a missing header, a banned sleep or a secret-shaped literal; 16 new flows and the old ones rewritten against the real dev routes; two EAS Workflows (build a simulator and an emulator build, run every non-manual flow); a GitHub Action that starts them only when the `EXPO_TOKEN` secret exists and otherwise ends green with a notice. | `tools/check-maestro`, `apps/*/.maestro`, `.eas/workflows`, `.github/workflows/maestro.yml`, `apps/*/eas.json` (`e2e-*` profiles), `maestro.md` |
| **Accessibility audit** | A static scan (TypeScript parser) and a rendered audit (React Native Testing Library, English and Arabic, font scale 2) over every screen and state of both apps; 18 findings fixed (scrolling state screens, live regions, field errors linked to fields, switch targets, colour-only selection, the scan screen's radio and fixed heights). | `packages/mobile-core/tests/support`, `apps/*/tests/a11y-*.test.ts(x)`, `a11y.md` |
| **Load tests** | k6 scripts for my tickets and orders, the app checkout start, `scans/batch` at 3× peak and the heartbeat from 500 devices, with data prepared by `load:prepare`. | `k6/`, `apps/web/scripts/load-prepare.ts`, `load.md` |
| **Security review** | `docs/ops/security-review-phase7.md`: 4 findings fixed (2 medium, 2 low), 4 open with owners (3 medium, 1 low), no high. | below and the review |
| **Leak coverage** | Every Phase 7 route is called with the credential its app uses (attendee, door device, exhibitor rep, organizer, nobody) against an org with a canary in every private column; a final test fails when a Phase 7 operation of the OpenAPI document was not called. | `packages/api-v1/tests/canary-mobile.int.test.ts`, `packages/testing/src/canary/allowlists.ts` |

### Server and package changes (from the security review)
- **S1.** `appEmailCode`, `appSignInVerify` and `appStepUpMail` policies on the M1.14 limiter; `POST /auth/email-code`, the `email_code`, `two_factor` and `link_proof` grants and `POST /auth/step-up/start` count against it in the shared store. `V1Deps.authLimiter` (default: Upstash, else Postgres counters). The old per-instance limits stay.
- **S2.** `Cache-Control: private, no-store` on `/me/*`, and by default on any answer sent to a credential, any write and anything under `/auth/` (`packages/api-v1/src/index.ts`, `caching.ts`). Public reads and the org reads keep their own headers.
- **S3.** `scrubText` masks `YY1…` ticket codes.
- **S4.** `android.allowBackup: false` for both apps.
- `@yayatoh/mobile-core` exports `testing/a11y-audit` and `testing/a11y-scan` for the two apps' tests.
- The canary fixture check "leaves the other orgs alone" ignores other canary orgs.

## 3. Native dependencies and permissions
None added. No permission string added or changed.

## 4. Later / not yet
- Open findings O1–O5 of the security review (refresh-token reuse window, Staff device token lifetime and single-use enrolment, code-signed over-the-air updates, the reviewer demo's environment check, the per-event lock in `scans/batch`).
- **`scans/batch` does not meet its latency bars at 3×** on this VM (`load.md` §5): the per-event advisory lock serialises syncs. In the Staff app's own closed loop the sync self-regulates and the oldest unsynced scan stays under 5 s (p95 1.5 s), but batches of ≤ 3 scans take 0.96 s (2×) and 1.5 s (3×), above 300 ms. The fix is in the check-in module (chunk uploads, narrow the lock) and is an owner decision; this increment did not change it.
- Maestro: 16 Staff flows need an enrolled door device, and only the console makes one; a dev-only route for it would let them run in EAS. Sign in with Apple and Google, wallet add and the QR enrolment scan stay manual (no test seam, owner accounts, camera).
- The EAS Workflows field names were written without an account to check them (`maestro.md`, "Not verified offline"). The first run with the owner's token is the check.
- Device pass: VoiceOver and TalkBack, true largest sizes, verdict sound and haptics, Maestro on simulator and emulator, the URL-cache and backup checks (security review §6).

## 5. Acceptance
| Criterion | Test or file |
|---|---|
| Maestro in CI; every journey has a flow | `tools/check-maestro` (70 tests), `node tools/check-maestro/cli.ts`, journeys in `apps/*/.maestro/journeys.json`; the EAS run itself: **device pass / owner token** |
| The workflow skips cleanly without `EXPO_TOKEN` | `tools/check-maestro/tests/workflows.test.ts` (gate job, `needs`, `if`, no echo of the secret); `.github/workflows/maestro.yml` |
| Accessibility audit covers every screen of both apps, fixes merged, tests in place | `a11y.md` §3 and §6; `apps/mobile/tests/a11y-*.test.ts(x)`, `apps/staff/tests/a11y-*.test.ts(x)`; screen-reader speech and largest sizes on a phone: **device pass** |
| k6 for my tickets and orders, checkout, scan batches at 3×, heartbeat from 500 devices | `k6/me-tickets.js`, `k6/app-checkout.js`, `k6/scan-batch-peak.js`, `k6/staff-heartbeat.js`; results and thresholds in `load.md`. **Met locally:** my tickets and orders (3× too), checkout, heartbeat from 500 devices. **Not met:** `scans/batch` latency at 3× (finding O5, `load.md` §5.1, §5.2); the 3× staging run needs the **owner's staging URL** |
| Security review has no open high finding; mediums listed with owners | `docs/ops/security-review-phase7.md` §1–§4 |
| S1: sign-in counters are shared across instances | `packages/api-v1/tests/hardening.int.test.ts` |
| S2: credentials and personal answers are not cached | `packages/api-v1/tests/hardening.int.test.ts`, `me-tickets.int.test.ts` |
| S3, S4: ticket codes scrubbed; no Android backup | `packages/mobile-core/tests/sentry.test.ts`, `app-config.test.ts` |
| Link hijacking, connector-free builds | `packages/mobile-core/tests/links.test.ts` ("link hijacking"), `connector-free.test.ts` |
| Leak crawler green: every new response reached, no private column beyond each allowlist | `packages/api-v1/tests/canary-mobile.int.test.ts` (11 tests, including "every Phase 7 route is reached"); the browser crawl `apps/web/e2e/canary-crawl.spec.ts` is unchanged |

## 6. Gate results
Run on the VM (Linux, no simulator) on 2026-10-15:
- `pnpm lint` clean (9 warnings, all in files this branch did not touch); `pnpm check:modules` ok; full `turbo run typecheck` ok (75 tasks; `apps/api` needs to run alone on a 16 GB VM).
- `pnpm test` (unit): 4 671 of 4 672 pass. The one failure is `packages/modules/media/tests/golden.test.ts` (the SVG logo's rasterised hashes differ on this VM's image library); nothing in this branch touches it.
- `pnpm test:mobile` equivalents, run in band: mobile-core 398, mobile 845, staff 873 tests, all pass.
- `pnpm test:int`: 2 555 of 2 557 pass. `apps/worker/tests/analytics-pro.int.test.ts` fails only inside the full run (it lists at most 500 orgs and the full run creates more) and passes alone; `tools/automation-apps/tests/apps.int.test.ts` (trigger subscriptions) needs public DNS for its `hook.eu1.make.com` URL and fails here with 400 in isolation too. Neither touches code changed here.
- `expo export` for iOS and Android and `expo-doctor` (21 of 21) for both apps.
- k6, Maestro and EAS: see `load.md` and `maestro.md`; the Maestro flows and EAS workflows were not run (no simulator, no EAS account).
