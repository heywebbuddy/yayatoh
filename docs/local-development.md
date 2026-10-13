# Local development

## Requirements

- Node.js 24 or later
- pnpm 12.6.0 (`corepack enable` or `npx pnpm@12.6.0`)
- Docker Desktop with Compose
- Doppler CLI, authenticated to the team that owns the `yayatoh` project

## Configure secrets

Store the environment variables for the desired environment in the Doppler project and config. Do not paste an entire `.env` file into one secret value; use Doppler's import flow so each `NAME=value` line becomes its own secret.

Run commands with the selected config injected into the process:

```powershell
doppler run --project yayatoh --config dev -- pnpm dev
```

To run a setup command with the same config, use the same prefix, for example:

```powershell
doppler run --project yayatoh --config dev -- pnpm db:bootstrap
doppler run --project yayatoh --config dev -- pnpm db:migrate
```

Choose the Doppler project and config that match the environment you intend to use. Never copy secret values into this document or commit them to the repository.

To use the email settings from `yayatoh/prd` while retaining the local service and database values in the root `.env.local`, run:

```powershell
doppler run --project yayatoh --config prd -- node tools/run-local-dev.cjs
```

The launcher applies `.env.local` overrides explicitly, retains Doppler's SES settings, and verifies that all database connections point to localhost. Restart this command after changing Doppler settings.

## Start local dependencies

Create a local `.env` from `.env.example` for Docker Compose values such as `LOCAL_POSTGRES_PASSWORD`, then start the local services:

```powershell
docker compose up -d
```

The compose stack provides PostgreSQL with pgvector, Redis, Gotenberg, and Mailpit. Confirm the containers are healthy with `docker compose ps`.

## Install and run

```powershell
pnpm install
pnpm db:bootstrap
pnpm db:migrate
pnpm dev
```

When using Doppler for the app process, replace the last command with the `doppler run` command above. The monorepo's `dev` script starts the workspace applications through Turbo. Check each app's package scripts and startup output for its local URL and any additional setup it requires.

## Useful commands

```powershell
pnpm test
pnpm typecheck
pnpm lint
docker compose logs -f
docker compose down
```

## Mobile apps

Two Expo apps live in the workspace (ADR 0025, `docs/plans/mobile.md`): **Yayatoh** (`apps/mobile`, `@yayatoh/mobile`) and **Yayatoh Staff** (`apps/staff`, `@yayatoh/staff`), with `packages/mobile-core` shared between them. They are React Native code on Expo SDK 57. They use Expo's own React (19.2.3), not the web's, so run Expo commands through the app's own package (`pnpm --filter @yayatoh/mobile ...`).

Requirements beyond the table at the top: **Xcode** (macOS only) for the iOS simulator, **Android Studio** with an emulator for Android. Cloud sessions and CI have neither: they run the unit tests and `expo export` only.

### Run an app on a simulator against the local web app
1. Start the web app and its dependencies as above (`pnpm dev`). It serves `/api/v1` on `http://localhost:3000`.
2. Build and start the app (first run builds the development client, which takes a few minutes):
   ```bash
   pnpm --filter @yayatoh/mobile ios        # or: android
   pnpm --filter @yayatoh/staff ios         # or: android
   ```
   Later runs only need the Metro server: `pnpm --filter @yayatoh/mobile start`, then press `i` or `a`.
3. `APP_ENV` defaults to `development`: the app is named "Yayatoh (Dev)" or "Yayatoh Staff (Dev)", its scheme ends in `-dev`, and its bundle ID ends in `.dev`, so it installs next to the store and preview builds. The iOS simulator and Android emulator reach the Mac at `localhost` (Android emulator: `http://10.0.2.2:3000/api/v1`, set through `API_BASE_URL`).

### Development builds, never Expo Go
The apps use native code (secure storage, SQLCipher, the camera), so Expo Go cannot run them. A development build is the app plus `expo-dev-client`:
- Locally: `expo run:ios` / `expo run:android` (the `ios` and `android` scripts) generate the native projects in `apps/<app>/ios` and `apps/<app>/android`. They are git-ignored; delete them any time and they are regenerated from `app.config.ts`.
- On EAS: `eas build --profile development` builds the same client in the cloud. It needs the owner's Expo account (`EAS_PROJECT_ID`, `EXPO_OWNER`), and builders never run it against a real project. `eas.json` holds the `development`, `preview` and `production` profiles and no credentials.

### Point the API URL at the Mac's LAN address
A physical phone cannot reach `localhost`. With the phone on the same Wi-Fi as the Mac:
1. Find the address: `ipconfig getifaddr en0` (macOS).
2. Copy `apps/<app>/.env.example` to `apps/<app>/.env` and set `API_BASE_URL=http://192.168.1.20:3000/api/v1` (your address).
3. Make the web app listen on all interfaces: after one normal `pnpm dev` run (it copies the zxing files first), start `pnpm --filter @yayatoh/web exec next dev --port 3000 --hostname 0.0.0.0` instead. Restart the Metro server so `app.config.ts` is read again (`--clear` if the old URL sticks).

Plain `http://` is accepted only in `development`; `preview` and `production` need `https://`, and a development build is the only one that allows cleartext traffic.

### Checks
```bash
pnpm test:mobile                                          # jest-expo for both apps and mobile-core
pnpm turbo run typecheck --filter=@yayatoh/mobile --filter=@yayatoh/staff --filter=@yayatoh/mobile-core
pnpm check:modules                                        # import, colour and string rules for the apps
pnpm --filter @yayatoh/mobile exec expo export --platform ios
pnpm --filter @yayatoh/mobile exec expo export --platform android
pnpm --filter @yayatoh/mobile exec expo-doctor            # needs api.expo.dev and reactnative.directory
```
(the same for `@yayatoh/staff`). CI runs all of them in the `mobile` job; `pnpm verify` runs the unit tests and the type checks.

### How the workspace is wired
- **No `.npmrc` or hoisting change.** Expo SDK 57's Metro configuration finds the workspace root, watches it and follows pnpm's symlinks. `.npmrc` stays `engine-strict=true`.
- **Two Reacts, one workspace.** The web uses the root catalog's React 19.3; the apps use the named `mobile` catalog in `pnpm-workspace.yaml` (React 19.2.3, React Native 0.86.3, the other Expo packages). Bump the catalog's Expo entries together (`npx expo install --check`). Universal packages declare React only as an optional peer, so installing the apps adds no second copy to them, and `singletonReact` in `packages/mobile-core/metro.cjs` makes Metro resolve `react` and `react-native` from the app's own directory.
- **Import rules.** An app may import only universal packages, `@yayatoh/sdk`, `@yayatoh/ui/tokens` and `@yayatoh/mobile-core`; no colour literals and no literal strings in `.tsx` (`pnpm check:modules`). Strings live in `apps/<app>/messages/<locale>.json`; the iOS camera text for Staff lives in `apps/staff/locales/<locale>.json`.
