/**
 * `@yayatoh/mobile-core` — what the two Expo apps share (ADR 0025, M7.1c).
 *
 * - `createCore` / `CoreProvider`: the session, the `/v1` clients, the encrypted query cache, the
 *   sign-in helpers and the version gate, wired together.
 * - Theme, translations (13 locales, right to left), deep links, offline banner, Sentry scrubbing.
 *
 * React Native only: the web never imports it, and it never imports a module, the database, `next`
 * or `react-dom` (`pnpm check:modules`). `@yayatoh/mobile-core/app-config` is separate because it
 * runs in Node when Expo reads `app.config.ts`.
 */
export { fromBase64, open as openSealed, seal, toBase64 } from './cache/encryption';
export {
  bindOnlineManager,
  clearServerState,
  createAppQueryClient,
  persistOptions,
} from './cache/query-client';
export {
  type ApiClientOptions,
  type ClientIdentity,
  type ClientName,
  clientHeader,
  clientName,
  createApiClient,
  type MobileApp,
  type MobilePlatform,
  sdkBaseUrl,
  type TokenSource,
  type UpgradeInfo,
} from './client';
export { type Core, type CoreAdapters, type CoreOptions, createCore } from './core';
export { type MessageTree, messagesFor } from './i18n/catalogs';
export {
  type AppLocale,
  DEFAULT_LOCALE,
  isRtlLocale,
  LOCALE_NAMES,
  LOCALES,
  pickFromPreferences,
  pickLocale,
} from './i18n/locales';
export { type LocaleApi, type LocaleChoice, LocaleProvider, useLocaleSettings } from './i18n/provider';
export { type AppRoute, ROUTES, routeForLink, routeForPush } from './links/routes';
export { nativeAdapters } from './platform/adapters';
export { type AppExtra, nativeIdentity, readAppExtra } from './platform/native';
export { OfflineBanner, useIsOffline } from './platform/network';
export { initSentry, reportError, scrubEvent, scrubText } from './platform/sentry';
export { documentFileStore, secureKeyValueStore } from './platform/stores';
export { type FileStore, type KeyValueStore, memoryFileStore, memoryKeyValueStore } from './ports';
export { CoreProvider, type CoreProviderProps, useCore, useSession } from './provider';
export {
  type AppleSignInProvider,
  expoAppleProvider,
  expoGoogleProvider,
  type GoogleSignInProvider,
} from './session/providers';
export {
  createSessionStore,
  type SessionState,
  type SessionStore,
  type SessionUser,
  type SignOutReason,
} from './session/session-store';
export {
  createSignIn,
  type EmailCodeOutcome,
  type SignIn,
  type SignInFailure,
  type SignInOutcome,
  type StepUpMethod,
  type StepUpOutcome,
  type StepUpProof,
} from './session/sign-in';
export { BrandScope, type ThemeApi, ThemeProvider, useColors, useTheme } from './theme/provider';
export { px, radius, space, TOUCH_TARGET_PX, type } from './theme/theme';
export { SoftUpdateBanner, UpdateScreen, VersionGateView } from './version/components';
export { createVersionGate, evaluateVersion, type GateState, type VersionGate } from './version/gate';
