# Shared rules for Phase 7 (mobile) builders

The owner started Phase 7 on 2026-10-13. Decisions P7-1 to P7-13 in `docs/plans/mobile.md` are built as recommended. If something is still ambiguous, follow `common.md`: choose the recommendation and log it in `docs/owner-inbox.md` as "pending owner".

Read `common.md` first. It applies in full to server work (`packages/*`, `apps/web`, `apps/api`, `apps/worker`). The rules below add to it, and for code in `apps/mobile`, `apps/staff` and `packages/mobile-core` they replace its end-to-end test section.

## Base
Start from `origin/main`, not the branch `common.md` names:
```
git fetch origin && git checkout -B {BRANCH} origin/main
```
Until the plan and briefs are on `main`, also `git merge --no-edit origin/docs/mobile-plan` (docs only). If your brief stacks on another Phase 7 branch, merge it too (`git merge --no-edit origin/agent/<id>`) when it exists and isn't already an ancestor. Re-merge `origin/main` (and any stacked branch) every couple of hours and before your final gate.

## Read
`docs/plans/mobile.md` (decisions P7-1 to P7-13 and your row), ADR 0002 (one command model), ADR 0010 (auth), ADR 0011 (QR and offline check-in), ADR 0014 (allowlists), and ADR 0025 (mobile apps) once it exists.

## Stack (don't swap without asking in your report)
- Expo SDK 57 (React Native 0.86, New Architecture, Hermes) and Expo Router. Use the React and React Native versions Expo expects (`npx expo install --check`), not the catalog's web React.
- Development builds (`expo-dev-client`), never Expo Go: SQLCipher and VisionCamera need native code.
- Every API call goes through `@yayatoh/sdk` via `packages/mobile-core`. Never `fetch` a `/v1` path by hand. If a route is missing, it belongs in a server increment.
- **Libraries:**
  - TanStack Query for server state.
  - `expo-secure-store` for tokens and keys.
  - `expo-sqlite` with SQLCipher for the Staff manifest.
  - `react-native-vision-camera` v5 for scanning.
  - `use-intl` for translations.
  - `@sentry/react-native` for crashes.
- Native code only as an Expo module, with a JavaScript fallback or a clear error.

## Rules
- **Imports:** the apps import only universal packages, `@yayatoh/sdk`, `@yayatoh/ui/tokens` and `@yayatoh/mobile-core`. `check:modules` enforces this from M7.1b.
- **Styling:**
  - Colours, spacing, radius and type come from the tokens only; light and dark both work.
  - Tenant brand colours go through the theme only, with the contrast fallback.
- **Strings:**
  - Every user-visible string lives in the app's catalogs (`apps/<app>/messages/<locale>.json`, shared strings in `packages/mobile-core/messages/`).
  - English first, then all 12 other locales with valid ICU plurals (same rules as `common.md`).
  - Right-to-left through `I18nManager` and logical styles (`start`/`end`, never `left`/`right`).
- **Accessibility:**
  - Every control has an accessibility label and role, with 44 pt minimum touch targets.
  - Layouts work at the largest system font size.
  - Never rely on colour alone: scan verdicts also have text, sound and haptics.
- **Privacy:**
  - No personal data in logs, crash reports or push text.
  - Tokens never leave secure storage except in the `Authorization` header.
- **No real accounts:**
  - No App Store, Play, EAS, APNs, FCM, Google, Apple or Sentry credentials in the repo or your session. Use fakes and `.env.example` names.
  - Never run `eas build`, `eas submit` or `eas update` against a real project.

## Tests and gate for app code
Cloud sessions run Linux with no iOS simulator or Android emulator.
1. **Tests:** unit tests for logic (Vitest in universal packages; jest-expo in the apps and `mobile-core`). Component tests with React Native Testing Library for every screen and state:
   - happy path, validation errors, empty, loading and error states
   - offline and permission denied
   - the Arabic RTL render, with accessibility labels present
2. **Maestro flows** for each journey, in `apps/<app>/.maestro/`. You can't run them here; the device pass runs them. Keep them deterministic: seeded personas and the fake providers.
3. **Gate:**
   - `pnpm verify`
   - for each app you touched: `pnpm --filter <app> exec expo export --platform ios`, the same with `--platform android`, and `pnpm --filter <app> exec expo-doctor`
   - for server changes on the same branch: `common.md`'s gate
4. **Spec:** add your section to `docs/specs/<milestone>/spec.md` with the acceptance table. Mark criteria that need a simulator or a phone as "device pass".

## Report
As in `common.md`. Also list:
- every native dependency added, with its version
- every permission string added to `app.config.ts` (camera, notifications)
- the Maestro flows written but not run
