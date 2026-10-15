/**
 * Expo app configuration shared by `apps/mobile` and `apps/staff` (M7.1b, ADR 0025).
 *
 * Each app's `app.config.ts` is a one-liner over `buildExpoConfig`, so the two apps differ only in
 * their identity (name, scheme, bundle ID) and in what they are allowed to ask the phone for. The
 * build is chosen by `APP_ENV` (development | preview | production); everything that belongs to an
 * owner account (EAS project, Expo owner, store identifiers for production) comes from the
 * environment, and nothing in this file is a credential.
 *
 * This file runs in Node, when Expo reads the config, never on the phone. It must not import
 * anything that needs React Native.
 */
import type { ExpoConfig } from 'expo/config';

export const APP_ENVS = ['development', 'preview', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];
export type AppId = 'mobile' | 'staff';

/** Tenant hosts are `{slug}.yayatoh.events` (ADR 0024); the wildcard is not part of the apex. */
export const DEFAULT_TENANT_LINK_DOMAIN = 'yayatoh.events';
export const PRODUCTION_API_BASE_URL = 'https://app.yayatoh.com/api/v1';
/** `pnpm dev` serves the web app (and `/api/v1`) on 3000. A phone needs the Mac's LAN address. */
export const DEVELOPMENT_API_BASE_URL = 'http://localhost:3000/api/v1';
/** The apex and app hosts that open the apps (P7-4, docs/plans/mobile.md section 6). */
export const LINK_HOSTS = ['yayatoh.com', 'app.yayatoh.com'] as const;

/** The locales of the web app (ADR 0016), as Expo names them (`zh-Hans`, `zh-Hant`). */
export const NATIVE_LOCALES = [
  'ar',
  'de',
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'nl',
  'pt',
  'ru',
  'zh-Hans',
  'zh-Hant',
] as const;

interface AppIdentity {
  readonly name: string;
  readonly slug: string;
  readonly scheme: string;
  /** Production identifiers. Env `IOS_BUNDLE_ID` / `ANDROID_PACKAGE` override them (P7-4). */
  readonly iosBundleId: string;
  readonly androidPackage: string;
  /** Only the Staff app scans: the attendee app never asks for the camera. */
  readonly camera: boolean;
  /** Only the attendee app adds an event to the phone's calendar (write-only on iOS 17+). */
  readonly calendar: boolean;
  /** Sign in with Apple is an attendee sign-in (P7-5); Staff signs in by enrolment QR or account. */
  readonly appleSignIn: boolean;
}

const APPS: Record<AppId, AppIdentity> = {
  mobile: {
    name: 'Yayatoh',
    slug: 'yayatoh',
    scheme: 'yayatoh',
    // The listed Android package (docs/research/36-gap-mobile-roadmap.md). The iOS bundle ID of the
    // existing listing is not in the repo: the owner sets IOS_BUNDLE_ID for production (P7-4).
    iosBundleId: 'com.yayatoh.yayatohapp',
    androidPackage: 'com.yayatoh.yayatohapp',
    camera: false,
    calendar: true,
    appleSignIn: true,
  },
  staff: {
    name: 'Yayatoh Staff',
    slug: 'yayatoh-staff',
    scheme: 'yayatoh-staff',
    iosBundleId: 'com.yayatoh.staff',
    androidPackage: 'com.yayatoh.staff',
    camera: true,
    calendar: false,
    appleSignIn: false,
  },
};

const VARIANTS: Record<AppEnv, { nameSuffix: string; schemeSuffix: string; idSuffix: string }> = {
  development: { nameSuffix: ' (Dev)', schemeSuffix: '-dev', idSuffix: '.dev' },
  preview: { nameSuffix: ' (Preview)', schemeSuffix: '-preview', idSuffix: '.preview' },
  production: { nameSuffix: '', schemeSuffix: '', idSuffix: '' },
};

/** Shown by iOS when the Staff app asks for the camera (the permission string, English). */
export const STAFF_CAMERA_USAGE = 'Yayatoh Staff uses the camera to scan ticket QR codes at the door.';

/** Shown by iOS when the attendee app adds a ticket's event to the calendar (English). */
export const ATTENDEE_CALENDAR_USAGE = 'Yayatoh adds the events you choose to your calendar.';

export type EnvVars = Readonly<Record<string, string | undefined>>;

/** `123-abc.apps.googleusercontent.com` -> `com.googleusercontent.apps.123-abc` (Google's iOS redirect scheme). */
export function googleIosRedirectScheme(clientId: string): string {
  const [first] = clientId.split('.apps.googleusercontent.com');
  return `com.googleusercontent.apps.${first}`;
}

export function resolveAppEnv(raw: string | undefined): AppEnv {
  const value = (raw ?? 'development').trim();
  if ((APP_ENVS as readonly string[]).includes(value)) return value as AppEnv;
  throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')} (got "${value}")`);
}

const clean = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

export function resolveApiBaseUrl(appEnv: AppEnv, env: EnvVars): string {
  const explicit = clean(env.API_BASE_URL);
  const url = explicit ?? (appEnv === 'development' ? DEVELOPMENT_API_BASE_URL : PRODUCTION_API_BASE_URL);
  if (!/^https?:\/\//.test(url))
    throw new Error(`API_BASE_URL must start with http:// or https:// (got "${url}")`);
  // Plain http is for a developer's own machine only; a build that ships must talk TLS.
  if (appEnv !== 'development' && url.startsWith('http://'))
    throw new Error('API_BASE_URL must be https:// for preview and production builds');
  return url.replace(/\/+$/, '');
}

/** `applinks:` entries for the iOS Associated Domains entitlement. */
export function associatedDomains(env: EnvVars): string[] {
  const tenant = clean(env.TENANT_LINK_DOMAIN) ?? DEFAULT_TENANT_LINK_DOMAIN;
  return [...LINK_HOSTS, `*.${tenant}`].map((h) => `applinks:${h}`);
}

function androidIntentFilters(env: EnvVars) {
  const tenant = clean(env.TENANT_LINK_DOMAIN) ?? DEFAULT_TENANT_LINK_DOMAIN;
  return [
    {
      action: 'VIEW',
      autoVerify: true,
      data: [
        ...LINK_HOSTS.map((host) => ({ scheme: 'https', host })),
        { scheme: 'https', host: `*.${tenant}` },
      ],
      category: ['BROWSABLE', 'DEFAULT'],
    },
  ];
}

export interface BuildOptions {
  readonly app: AppId;
  readonly env?: EnvVars;
  /** Colours for the splash screen, taken from the design tokens by the app (never typed here). */
  readonly splash: { readonly light: string; readonly dark: string };
  /** App-relative path to the 1024 px icon, the adaptive-icon foreground and the splash image. */
  readonly assets: { readonly icon: string; readonly adaptiveForeground: string; readonly splash: string };
  /** Adaptive-icon background colour (a token). */
  readonly adaptiveBackground: string;
  /** App-relative locale files for the iOS/Android native strings (Expo `locales`). */
  readonly locales?: Readonly<Record<string, string>>;
}

export function buildExpoConfig(opts: BuildOptions): ExpoConfig {
  const env = opts.env ?? process.env;
  const appEnv = resolveAppEnv(env.APP_ENV);
  const id = APPS[opts.app];
  const variant = VARIANTS[appEnv];
  const production = appEnv === 'production';

  const iosBundleId = production
    ? (clean(env.IOS_BUNDLE_ID) ?? id.iosBundleId)
    : `${clean(env.IOS_BUNDLE_ID) ?? id.iosBundleId}${variant.idSuffix}`;
  const androidPackage = production
    ? (clean(env.ANDROID_PACKAGE) ?? id.androidPackage)
    : `${clean(env.ANDROID_PACKAGE) ?? id.androidPackage}${variant.idSuffix}`;

  const projectId = clean(env.EAS_PROJECT_ID);
  const owner = clean(env.EXPO_OWNER);
  const apiBaseUrl = resolveApiBaseUrl(appEnv, env);

  const plugins: NonNullable<ExpoConfig['plugins']> = [
    'expo-router',
    'expo-dev-client',
    [
      'expo-splash-screen',
      {
        image: opts.assets.splash,
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: opts.splash.light,
        dark: { image: opts.assets.splash, backgroundColor: opts.splash.dark },
      },
    ],
  ];
  // Add to calendar (M7.3b): write-only access, so the app can add an event but never reads one.
  if (id.calendar) {
    plugins.push([
      'expo-calendar',
      {
        writeOnlyAccess: true,
        calendarPermission: ATTENDEE_CALENDAR_USAGE,
        writeOnlyCalendarPermission: ATTENDEE_CALENDAR_USAGE,
        remindersPermission: false,
      },
    ]);
  }
  // Only a development build may talk to a plain-http API on a developer's machine.
  if (!production && apiBaseUrl.startsWith('http://')) {
    plugins.push(['expo-build-properties', { android: { usesCleartextTraffic: true } }]);
  }

  // Google sign-in returns through the OAuth client's own redirect scheme (M7.1c): iOS clients use
  // `com.googleusercontent.apps.<id>`, Android clients their package name. Public identifiers, set
  // per environment; without them the app has no Google button.
  const googleIosClientId = clean(env.GOOGLE_IOS_CLIENT_ID);
  const googleAndroidClientId = clean(env.GOOGLE_ANDROID_CLIENT_ID);
  const sentryDsn = clean(env.SENTRY_DSN);
  const appScheme = `${id.scheme}${variant.schemeSuffix}`;
  const googleSchemes = [
    ...(googleIosClientId ? [googleIosRedirectScheme(googleIosClientId)] : []),
    ...(googleAndroidClientId ? [androidPackage] : []),
  ];

  const config: ExpoConfig = {
    name: `${id.name}${variant.nameSuffix}`,
    slug: id.slug,
    scheme: googleSchemes.length ? [appScheme, ...googleSchemes] : appScheme,
    version: '0.1.0',
    orientation: opts.app === 'staff' ? 'default' : 'portrait',
    icon: opts.assets.icon,
    userInterfaceStyle: 'automatic',
    platforms: ['ios', 'android'],
    runtimeVersion: { policy: 'fingerprint' },
    updates: projectId
      ? { url: `https://u.expo.dev/${projectId}`, enabled: appEnv !== 'development' }
      : { enabled: false },
    ...(owner ? { owner } : {}),
    // The Staff app supports iPad (doors often use iPads, P7-10); the attendee app is phone-first
    // and also runs on iPad.
    ios: {
      bundleIdentifier: iosBundleId,
      supportsTablet: true,
      ...(id.appleSignIn ? { usesAppleSignIn: true } : {}),
      associatedDomains: associatedDomains(env),
      infoPlist: {
        CFBundleAllowMixedLocalizations: true,
        ...(id.camera ? { NSCameraUsageDescription: STAFF_CAMERA_USAGE } : {}),
        ...(appEnv === 'development' ? { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } } : {}),
      },
    },
    android: {
      package: androidPackage,
      adaptiveIcon: {
        foregroundImage: opts.assets.adaptiveForeground,
        backgroundColor: opts.adaptiveBackground,
      },
      intentFilters: androidIntentFilters(env),
      // The attendee app never scans; keep a library from adding the permission by accident.
      permissions: id.camera ? ['android.permission.CAMERA'] : [],
      blockedPermissions: id.camera ? [] : ['android.permission.CAMERA'],
    },
    ...(opts.locales ? { locales: { ...opts.locales } } : {}),
    plugins,
    experiments: { typedRoutes: true },
    extra: {
      appEnv,
      apiBaseUrl,
      ...(sentryDsn ? { sentryDsn } : {}),
      ...(googleIosClientId ? { googleIosClientId } : {}),
      ...(googleAndroidClientId ? { googleAndroidClientId } : {}),
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
  return config;
}
