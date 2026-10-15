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

## Wave 3: app screens built in parallel (added 2026-10-14)
Seven builders work on the two apps at the same time: M7.3a–d on `apps/mobile` and M7.4a–c on `apps/staff`. To keep the merge clean:

- **Base:** `origin/main` after Wave 2 (M7.1c, M7.2b and M7.2f merged). Until the Wave 3 briefs are on `main`, also `git merge --no-edit origin/docs/wave3-briefs`.
- **Ownership.** Each increment owns its route folders and a catalog namespace. Put your screens and strings only there:

  | Increment | Routes (under `src/app/`) | Catalog namespaces |
  |---|---|---|
  | M7.3a | `(auth)/`, `(tabs)/_layout.tsx`, `(tabs)/account.tsx`, `account/` (except `account/notifications.tsx`) | `welcome`, `signIn`, `account` |
  | M7.3b | `(tabs)/tickets.tsx`, `tickets/`, `claim/` | `tickets` |
  | M7.3c | `(tabs)/discover.tsx`, `events/`, `e/`, `orders/`, `checkout/` | `discover`, `checkout`, `orders` |
  | M7.3d | `account/notifications.tsx`, link and push handling in the root layout | `push` |
  | M7.4a | `enrol/`, `select/`, `sign-in/`, the device gate in the root layout | `enrol`, `device`, `organizer`, `exhibitor` |
  | M7.4b | `scan/` | `scan` |
  | M7.4c | `tools/` | `tools`, `leads`, `ops` |

- **The attendee tabs** are Tickets, Discover and Account, in `(tabs)/_layout.tsx` (M7.3a). If you need the tab shell before M7.3a pushes it, add a minimal one; the merge keeps M7.3a's.
- **Routes** use `ROUTES` from `@yayatoh/mobile-core` (`/tickets/[id]`, `/orders/[id]`, `/events/[slug]`, `/claim/[token]`, `/enrol`, …), so links and pushes from M7.3d land on the screens M7.3b and M7.3c build.
- **Shared files** (the root `_layout.tsx`, `src/core.ts`, `app.config.ts`, `package.json`, the catalogs): small additive edits only. Add keys only under your namespace, in all 13 locales; never reorder or reformat other keys.
- **Staff stacking:** M7.4b and M7.4c build on M7.4a's device session. Merge `origin/agent/m7.4a` once it has pushed `src/device/` (the token in secure storage and `useDevice()`), and re-merge it before your final gate. Until then, code against the interface in `m7.4a.md`.
- **Server gaps:** if a screen needs a `/v1` route that doesn't exist, use the closest one and list the gap in your report. Add a server route only if it is small and additive, with tests, and then `common.md`'s gate applies to it.
- **The cloud VM has 16 GB.** Run the full typecheck one package at a time in the background (`NODE_OPTIONS=--max-old-space-size=11000 pnpm turbo run typecheck --concurrency=1`). If your branch changes no server code, skip `pnpm test:int` (it takes over two hours there) and say so in your report; CI runs it on the merge PR.
