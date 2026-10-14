# ADR 0025 — Mobile apps: Expo, two apps, package rules, release policy

- **Status:** Proposed (M7.1b, 2026-10-13; draft for the owner's approval)
- **Relates to:** `docs/plans/mobile.md` (decisions P7-2, P7-3, P7-9, P7-10), ADR 0002 (one command model), ADR 0010 (auth), ADR 0011 (QR and offline check-in), ADR 0014 (allowlists), ADR 0026 (no `/api/v2` facade)

## Context
- The owner decided on 2026-10-13 to build the mobile apps now, from scratch, on Expo rather than fully native Swift and Kotlin (`docs/decisions.md`).
- The workspace already holds one React, the web's (19.3, root catalog). Expo SDK 57 pins its own React (19.2.3) and React Native (0.86).
- The server side is ready: `/v1` with opaque bearer tokens, an OpenAPI contract and a generated `@yayatoh/sdk`.

## Decision
- **Framework:** Expo SDK 57 (React Native 0.86, New Architecture, Hermes) with Expo Router, TypeScript and development builds (`expo-dev-client`). Never Expo Go: SQLCipher and the camera need native code. Native code only as small Expo modules.
- **Two apps from one repo (P7-3):** `apps/mobile` is **Yayatoh** (buyers, guests, attendees); `apps/staff` is **Yayatoh Staff** (door staff, scanners, exhibitor reps, organizers on event day). The encrypted offline door list never ships in the attendee app, and each app gets a focused store review. Only Staff asks for the camera.
- **`packages/mobile-core`** (package kind `mobile`, M7.1c) holds what both apps share, wired by `createCore` and mounted by `CoreProvider`: the `/v1` client (the SDK with a token callback, `X-Yayatoh-Client`, one refresh on a 401, the 426 hook), the session store (tokens in `expo-secure-store`, one refresh at a time, a dead refresh token signs out and wipes), sign-in helpers for every `/v1/auth/token` grant, TanStack Query with a cache persisted as one file encrypted with a random key held in secure storage, the theme (tokens, light and dark, tenant colours behind a 4.5:1 contrast fallback), `use-intl` with 13 locales and right-to-left through `I18nManager`, the deep-link router, the version gate, the offline banner and Sentry with scrubbing. Native modules sit behind small ports with Expo adapters and in-memory fakes. **Google sign-in** goes through `expo-auth-session` (system browser, PKCE) because the server requires a `nonce` in the id_token and the free native Google Sign-In library cannot set one. The web never imports the package.
- **One config source:** `@yayatoh/mobile-core/app-config` builds each app's `app.config.ts` from `APP_ENV` (`development` | `preview` | `production`): name suffix, scheme, bundle ID and Android package, API base URL, associated domains (`applinks:yayatoh.com`, `applinks:app.yayatoh.com`, the tenant wildcard) and permission strings. Production IDs and everything account-bound (EAS project ID, Expo owner) come from the environment; `eas.json` carries no credentials.
- **Package rules (`pnpm check:modules`):** an app or `mobile-core` may import only universal packages, `@yayatoh/sdk`, `@yayatoh/ui/tokens` and `@yayatoh/mobile-core`. It may not import or declare a module, `@yayatoh/db`, `next`, `next-intl`, `react-dom`, `server-only` or server libraries. No colour literals and no literal UI strings in `.tsx` (rules `design-tokens`, `i18n-literal`, `mobile-imports`). Config files, which run in Node, may import `node:` modules.
- **Two Reacts, one workspace:** the apps pin Expo's React and React Native from a named pnpm catalog (`catalogs.mobile`), so the web's `catalog:` React is untouched. Universal packages hold React only as an optional peer. Metro resolves `react` and `react-native` from the app's own directory (`singletonReact`), so a stray second copy cannot enter a bundle. No `.npmrc` change and no hoisting were needed: Expo SDK 57's Metro config follows pnpm's symlinks and watches the workspace root.
- **Tests:** jest-expo and React Native Testing Library in the apps and `mobile-core` (`pnpm test:mobile`, part of `pnpm verify`); Vitest stays for the server and universal packages. Maestro flows per journey in `apps/<app>/.maestro/`, run in the device pass.
- **CI:** a `mobile` job runs lint, typecheck and unit for the three packages, `expo export` for iOS and Android for both apps, and `expo-doctor`.
- **Release policy (P7-9):**
  - Store builds about every 4 weeks, with phased release on Apple and staged rollout on Play.
  - JavaScript fixes go over the air with EAS Update (`fingerprint` runtime versions).
  - Event freeze: no store builds in the 72 hours before a large event; over-the-air fixes only.
  - Minimum version is enforced by `426 Upgrade Required` from `/v1`, never for a Staff device during its event window (24 hours before start to 2 hours after end).
  - Support window: the current and two previous versions.
- **Devices (P7-10):** Expo SDK 57 defaults. Staff supports iPad and Android scanners; the attendee app is phone-first and also runs on iPad.

## Alternatives
- **Fully native Swift and Kotlin:** four projects instead of two, door rules in three languages, no over-the-air fixes, iOS builds only on macOS. Rejected (P7-2).
- **One app with a staff mode:** the offline door list would ship to every attendee and store review would cover both. Runner-up (P7-3).
- **Hoist React to the root (`public-hoist-pattern`, `node-linker=hoisted`):** it would disturb the web's resolution. Rejected in favour of a named catalog and a Metro singleton.

## Consequences
- The web build and its React version are unchanged.
- Bumping Expo means bumping the `mobile` catalog together (`npx expo install --check`).
- Store identifiers, signing and EAS access are owner actions (`docs/owner-inbox.md`); until then builds use development and preview identifiers.

## Revisit when
- Expo or React Native changes its monorepo support, or the owner reverses P7-2 or P7-3.
