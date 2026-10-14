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
- Maestro: one launch smoke flow per app (`apps/<app>/.maestro/launch.yaml`, written, not run: no simulator in cloud sessions). Journey flows land with M7.2 onwards.
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
| Apps run on an iOS simulator and an Android emulator; launch smoke flows pass | device pass (`apps/<app>/.maestro/launch.yaml`) |

---

## M7.1c — Mobile core

- **Built:** 2026-10-14, branch `agent/m7.1c` (Phase 7 plan Wave 2). **Risk tags:** `mobile-contract` (the `X-Yayatoh-Client` identifiers; see below), `infra` (catalog entries, app config).
- **Related:** P7-5, P7-9, P7-11; ADR 0002, 0010, 0011, 0014, 0025; M7.2a (app sign-in grants), M7.2d (version gate, `426`).

### 1. Goal
Fill `packages/mobile-core` so M7.3 and M7.4 build screens, not plumbing: one object that owns the session, the `/v1` clients, the encrypted query cache, the sign-in helpers and the version gate, plus the theme, translations, deep links, offline banner and crash reporting both apps need.

### 2. Scope (built)
`createCore(options)` (`src/core.ts`) builds the pieces below and wires them so each rule holds everywhere; `CoreProvider` (`src/provider.tsx`) mounts them in the order theme, language, persisted query cache, version gate. Every native dependency is behind a port (`src/ports.ts`) with an Expo adapter (`src/platform/`) and an in-memory fake, so the logic runs under Jest.

| Area | What it does | Files |
|---|---|---|
| **API client** | The SDK with the base URL from config (`…/api/v1` is cut back to the SDK's base, whose paths already start with `/v1`), a token callback, and `X-Yayatoh-Client: yayatoh-ios/<version> (<build>)` (also `yayatoh-android`, `yayatoh-staff-ios`, `yayatoh-staff-android`). A 401 `unauthenticated` refreshes once and repeats the request; any other 401 (a `step_up_required` answer) passes through untouched; token routes are never refreshed. A 426 reaches the version gate. The four identifiers were already in `KNOWN_CLIENTS` (M7.2d), so this increment makes **no server change**. | `client.ts`, `problem.ts` |
| **Session store** | Access and refresh tokens (one JSON value) in `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). **One refresh at a time:** concurrent callers await a single request; a request that 401s after another refreshed repeats without refreshing. The access token is refreshed 30 s before it ends. A refresh the server answers 401 (reused, revoked, expired, unknown) **signs out and wipes**: secure storage, the query cache and its key, and every `onSignedOut` callback. A network error, 429 or 5xx keeps the session. Sign-out revokes the refresh token first (best effort) and then wipes. | `session/session-store.ts` |
| **Sign-in helpers** | Email code (`requestEmailCode`, `withEmailCode`), Apple (`withApple`), Google (`withGoogle`), password (`withPassword`), the two-factor step (`completeTwoFactor`), the email-proof step that links a provider to an existing account (`completeLinkProof`), and step-up (`startStepUp`, `stepUp`). Each returns an outcome (`signedIn`, `twoFactor`, `emailProof`, `failed` with the server's `details.reason`, `rateLimited`, `cancelled`, `unsupported`, `unavailable`); none throws for something a person did. | `session/sign-in.ts` |
| **Apple and Google** | **Apple:** `expo-apple-authentication`; the app makes a 32-byte nonce per attempt, gives the sheet its SHA-256 (hex) and sends the raw nonce, plus the first-time name, to the server (the rule in `packages/auth/src/id-token.ts`). **Google:** `expo-auth-session` (the system browser session with PKCE, code exchange for the id_token), because the server requires a `nonce` claim and the free native Google Sign-In library (`@react-native-google-signin/google-signin` 16) has no nonce option; its token would be refused. Google is behind a port, so a native library can replace it without touching the helpers. | `session/providers.ts` |
| **Server state** | TanStack Query: queries pause offline (`networkMode: 'offlineFirst'`, bound to `expo-network`), retry only transient failures (network, 408, 429, 5xx), keep data 7 days. The cache is persisted as **one encrypted file**: XChaCha20-Poly1305 (`@noble/ciphers`, plain JavaScript so it runs on Hermes), a random 24-byte nonce per write, the header as associated data. The **32-byte key is random and lives only in secure storage** (secure storage is too small for the cache itself). Sign-out deletes the key first, then the file. A file that does not decrypt (no key, another key, tampering) reads as an empty cache. Queries opt out with `meta: { persist: false }`. | `cache/*` |
| **Theme** | Light and dark from `@yayatoh/ui/tokens`, following the system with an in-app override (`system`, `light`, `dark`, kept in secure storage). A tenant brand colour (from an API response, so untrusted) must be an opaque `#rgb`/`#rrggbb` that reaches **4.5:1 against the mode's surface**; then it replaces `primary`, `primaryInk`, hover and pressed, with `onPrimary` the token's own colour or black, whichever reaches 4.5:1. Otherwise the default colours stay. `BrandScope` applies a colour to one screen's subtree. | `theme/*` |
| **Translations** | `use-intl`; shared strings in `packages/mobile-core/messages/<locale>.json` (13 locales, under the `core` namespace) merged with each app's `messages/`. The phone's languages (first one with a catalog), with an in-app override. **Right to left:** `I18nManager.allowRTL/forceRTL`, then a reload (`expo-updates`, or the dev menu) when the direction changes; at most one reload request per direction per run, and the root view also sets `direction`, so the first render is right while the reload is pending. `validateCatalogs` (exported as `@yayatoh/mobile-core/catalog-check`) checks every locale: exactly the English keys, no empty value, valid ICU, the same placeholders as English, and the plural forms the language needs (Arabic zero, one, two, few, many, other; Russian one, few, many, other; Japanese and Chinese other only). Both apps' catalog tests use it. | `i18n/*`, `messages/*` |
| **Deep links** | `routeForLink(url, { app })` maps a universal link or app-scheme link to `{ pathname, params }` using the server's AASA allowlist (`/events/*`, `/e/*`, `/my-tickets/*`, `/orders/*`, `/claim/*`; Staff `/scan#e=…&k=…`), with an optional locale prefix; `routeForPush(data)` maps a push's `data.path` (`/tickets/{id}`, `/orders/{id}`, `/events/{slug}`; M7.2c). Anything else is `null`: foreign hosts, look-alike hosts, other paths, odd segments, an enrolment key in the query string. Values fill route params; nothing is spliced into a string. | `links/routes.ts` |
| **Version gate** | At launch, `GET /v1/mobile/config`, this app's entry in `apps`: below `minimumVersion` an update screen replaces the app (store link from the config, https only); below `latestVersion` a dismissible nudge. Any 426 shows the update screen with the link it carried. A check that cannot be made never blocks. `suppressRequiredUpdate` lets Staff (M7.4a) turn the block into the nudge during a device's event window. | `version/*` |
| **Network and crash reports** | `OfflineBanner` / `useIsOffline` (`expo-network`). Sentry (`@sentry/react-native`) starts only with a valid `https` DSN (`SENTRY_DSN`, via `extra`); `sendDefaultPii: false`, no screenshots or view hierarchy, no tracing; `scrubEvent` removes the user, request headers, cookies and bodies, query strings and fragments, device name and location, and masks emails, phone numbers, bearer and `yy*_` tokens, JWTs, long hex strings and identifier-like URL segments in every string. | `platform/*` |
| **App config** | `expo-secure-store`, `expo-file-system`, `expo-crypto`, `expo-localization`, `expo-network`, `expo-application`, `expo-auth-session`, `expo-web-browser`, `expo-apple-authentication` and `@sentry/react-native` are dependencies of the apps (for autolinking). `ios.usesAppleSignIn` for the attendee app only. Google's redirect schemes (`com.googleusercontent.apps.<id>`, the Android package) are added to `scheme` only when `GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID` are set; they, `SENTRY_DSN` and the API URL reach the app through `extra`. **No permission string was added.** | `app-config.ts` |
| **Apps** | Both apps use `CoreProvider`, the core theme and `LocaleProvider` in place of the M7.1b placeholders; the offline banner shows under the status bar. | `apps/*/src` |

### 3. Later / not yet
- Sign-in, ticket, order and account **screens**: M7.3. Push registration and the permission prompt: M7.3d. Staff device-token session, heartbeat and the event-window check behind `suppressRequiredUpdate`: M7.4a. The Staff manifest database (SQLCipher) registers its wipe with `core.session.onSignedOut`.
- Cache entries are not keyed by person. They do not need to be today (the cache is wiped at every sign-out), but screens that cache `/v1/me/*` should still put the user id in their query keys.
- `Sentry.wrap`, the Sentry Expo config plugin and source-map upload need the owner's Sentry project (`docs/owner-inbox.md`); crash reports work without them but with unsymbolicated native stacks.
- Everything that needs a phone: the real keychain, the Apple and Google sheets, VoiceOver and TalkBack, the largest text size, a real right-to-left reload, EAS Update and the store links (device pass).

### 4. Acceptance
| Criterion | Test or check |
|---|---|
| Two simultaneous 401s cause exactly one refresh | `packages/mobile-core/tests/session.test.ts` ("two simultaneous 401s…", "a request that 401s after another already refreshed…", rotation) |
| A reused refresh token signs the app out and wipes local data (tokens, cache file, cache key, callbacks); a network error or 5xx does not | `session.test.ts` ("a reused refresh token…", "a revoked family…", "…during refresh keeps the person signed in"); `tests/core.test.tsx` (cache and key gone) |
| The persisted cache file can't be read without the key (the test reads the raw file) | `tests/cache.test.ts` ("the file on disk is unreadable without the key…", tampering, lost key, wipe) |
| Every catalog has every key with valid ICU plurals per locale; Arabic renders right to left (component test) | `tests/i18n.test.tsx` (`validateCatalogs`, "Arabic renders right to left…"); `apps/mobile/tests/i18n.test.ts`, `apps/staff/tests/i18n.test.ts`; `apps/*/tests/home.test.tsx` |
| A brand colour with poor contrast falls back to the default | `tests/theme.test.tsx` ("a brand colour with poor contrast…", the 4.5:1 threshold, dark mode, non-hex values, `BrandScope`) |
| A 426 or a below-minimum `/v1/mobile/config` shows the update screen with the right store link | `tests/version.test.tsx` ("a 426 from the API shows the update screen…", "a below-minimum /v1/mobile/config blocks…"); `tests/core.test.tsx` |
| `X-Yayatoh-Client` is `yayatoh-ios/<version> (<build>)` and the three siblings | `tests/client.test.ts`; `tests/core.test.tsx` |
| A `step_up_required` 401 is not mistaken for a stale token | `tests/client.test.ts` |
| Every sign-in grant (email code, Apple with nonce, Google, password, two-factor, link proof, step-up) | `tests/sign-in.test.ts`, `tests/providers.test.ts` |
| Deep links and push payloads map to routes; foreign hosts, odd paths and a fragment key in the query are refused | `tests/links.test.ts` |
| Sentry is off without a DSN; events carry no personal data | `tests/sentry.test.ts` |
| Offline banner (online, offline, queued count with plural, Arabic) and Query pauses offline | `tests/network.test.tsx` |
| Sign in with Apple and Google sheets; the keychain; VoiceOver and TalkBack; a real direction reload; the update screen on a build below the minimum; the offline banner in airplane mode | device pass (`apps/*/.maestro/update-required.yaml`, `apps/mobile/.maestro/offline-banner.yaml`) |

### 5. Gate results (2026-10-14, Linux cloud session, Node 24.21, pnpm 12.6)
| Check | Result |
|---|---|
| `pnpm lint`, `pnpm check:modules` | clean |
| `pnpm typecheck` (turbo, 63 tasks incl. the three mobile packages) | pass |
| `pnpm test:mobile` | `mobile-core` 277 tests in 14 suites, `mobile` 10, `staff` 11: pass |
| `pnpm test` (Vitest unit, 336 files) | 4591 pass; 1 fails: `packages/modules/media/tests/golden.test.ts > logo.svg → the recorded variants` (the avif/webp/png hashes of a rasterised SVG differ in this container; nothing in this branch touches `packages/modules/media`) |
| `pnpm test:int` | the full suite (251 files) did not finish inside the container's two-hour background limit and reported no failure; `packages/sdk/tests/sdk.int.test.ts` passes. This branch changes no server code, schema or SDK; the merge session's full run is the gate |
| `expo export` iOS and Android, both apps | pass (1696 iOS and 1832 Android modules each) |
| `expo-doctor`, `expo install --check` | 21/21 checks, dependencies up to date, both apps |
| `pnpm why react` | `react@19.2.3` (Expo) and `react@19.3.0` (web) only; `@sentry/react` resolves to 19.2.3 |

