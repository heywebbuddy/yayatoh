# Spec: M7.1 — Mobile foundations

- **Milestone:** M7.1 (Phase 7 plan `docs/plans/mobile.md`, Wave 1). This file holds **M7.1b — Expo workspace** (built 2026-10-13). M7.1a (universal crypto) and M7.1c (`mobile-core` contents) add their own sections.
- **Status:** M7.1b built
- **Risk tags:** `infra` (workspace and CI). No schema, no `/v1` change.
- **Related:** P7-2, P7-3, P7-4, P7-9, P7-10; ADR 0025 (mobile apps, Proposed), ADR 0026 (no `/api/v2` facade, Proposed); ADR 0001 (stack), ADR 0007

## M7.1b — Expo workspace

### 1. Goal
Give the later mobile increments a place to land: two Expo apps that build, test and bundle in CI, a shared package, and gate rules that keep web and server code out of the apps.

### 2. Scope (built)
- **`apps/mobile`** (`@yayatoh/mobile`, "Yayatoh") and **`apps/staff`** (`@yayatoh/staff`, "Yayatoh Staff"): Expo SDK 57, Expo Router, TypeScript, `expo-dev-client`. One placeholder home screen each, coloured from `@yayatoh/ui/tokens` (light and dark) with one translated string. Catalogs in all 13 locales (`apps/<app>/messages/<locale>.json`, `use-intl`); parity is tested.
- **`app.config.ts` per environment** through `@yayatoh/mobile-core/app-config` (`buildExpoConfig`), by `APP_ENV` = `development` | `preview` | `production`: name suffix (`(Dev)`, `(Preview)`), scheme suffix, bundle ID and package suffix (`.dev`, `.preview`) so builds install side by side; API base URL (`API_BASE_URL`, default `localhost:3000` in development and `app.yayatoh.com` otherwise; plain http refused outside development); associated domains `applinks:yayatoh.com`, `applinks:app.yayatoh.com`, `applinks:*.yayatoh.events` (`TENANT_LINK_DOMAIN`) and matching Android intent filters; production bundle ID and package from `IOS_BUNDLE_ID` / `ANDROID_PACKAGE` (P7-4); `runtimeVersion` by fingerprint (P7-9); EAS project and owner from `EAS_PROJECT_ID` / `EXPO_OWNER`. **Camera: Staff only** (iOS usage string localised in `apps/staff/locales/*.json`; Android permission blocked in the attendee app).
- **`eas.json`** per app: `development`, `preview` and `production` profiles, channels, `APP_ENV`; no credentials.
- **pnpm and Metro:** named catalog `mobile` in `pnpm-workspace.yaml` (Expo's React 19.2.3 and React Native 0.86.3); `@yayatoh/ui` lists React as an optional peer; `packages/mobile-core/metro.cjs` (`singletonReact`) resolves `react` and `react-native` from the app. **No `.npmrc` change and no hoisting** (documented in `docs/local-development.md` and ADR 0025). The new `minimumReleaseAgeExclude` entries are the Expo SDK 57 packages the lockfile resolved inside pnpm's release-age window.
- **`packages/mobile-core`:** package kind `mobile`, empty exports apart from `./app-config` and `./metro`; M7.1c fills it.
- **Tests:** jest-expo and React Native Testing Library; Vitest excludes the three mobile packages. `pnpm test:mobile` is part of `pnpm verify`.
- **CI job `mobile`** (`.github/workflows/ci.yml`): Biome on the three packages, `check:modules`, typecheck and jest-expo, `expo export` for iOS and Android for both apps, `expo-doctor` for both.
- **check-modules** (`tools/check-modules/src/check.ts`): rule `mobile-imports` (only universal packages, `@yayatoh/sdk`, `@yayatoh/ui/tokens`, `@yayatoh/mobile-core`; no module, db, `next`, `next-intl`, `react-dom`, server libraries; Node modules only in config files; the same for what a package.json declares), `design-tokens` (no hex, `rgb()`/`hsl()`/`oklch()` or colour-prop literals in app `.tsx`), `i18n-literal` (no literal JSX text or `accessibilityLabel`, `title`, `placeholder`, ...). Canary repos under `tools/check-modules/canaries/mobile-*` are run by the `gate-canaries` job.
- **Docs:** ADR 0025, ADR 0026 (both **Proposed**), `docs/adr/README.md`, "Mobile apps" in `docs/local-development.md`, `.env.example` per app.

### 3. Later / not yet
- Contents of `mobile-core` (client, token storage, theme, translations, deep links, version gate, crash reporting): M7.1c. Real screens: M7.2 onwards.
- Maestro flows: none yet, there is no journey to drive (the first land with M7.2).
- Real store identifiers, EAS project, signing, the Apple and Google accounts, the `/.well-known` files: owner actions (`docs/owner-inbox.md`).
- Running on a simulator or an emulator, and `expo-doctor` network checks if the cloud runner cannot reach them: device pass and CI.

### 4. Acceptance
| Criterion | Test or check |
|---|---|
| App config per environment: names, schemes, IDs, API URL, link domains, camera only in Staff | `packages/mobile-core/tests/app-config.test.ts`, `apps/mobile/tests/app-config.test.ts`, `apps/staff/tests/app-config.test.ts` |
| One component test per app; tokens in light and dark; every locale renders, Arabic included | `apps/mobile/tests/home.test.tsx`, `apps/staff/tests/home.test.tsx` |
| Catalog parity across the 13 locales | `apps/mobile/tests/i18n.test.ts`, `apps/staff/tests/i18n.test.ts` |
| Universal packages cannot pull a second React into an app | `packages/mobile-core/tests/metro.test.ts`; `pnpm why react` diff in the commit report |
| An app importing `@yayatoh/db`, a module, `next`, `react-dom` or a Node module fails `check:modules` | `tools/check-modules/tests/mobile.test.ts`; canary `mobile-imports` |
| A hex colour or literal string in an app `.tsx` fails `check:modules` | `tools/check-modules/tests/mobile.test.ts`; canaries `mobile-colour`, `mobile-literal` |
| Both apps export for iOS and Android; `expo-doctor` is clean | CI job `mobile` (results in the commit report) |
| `pnpm --filter @yayatoh/web build` and the web's React are unchanged | `pnpm why react` diff; web build (report) |
| `pnpm install --frozen-lockfile` works on a clean checkout | CI `checks`; run in the report |
| Apps run on an iOS simulator and an Android emulator | device pass |
