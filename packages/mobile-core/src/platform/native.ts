/**
 * What the phone and the build tell the app about itself: the app version and build for
 * `X-Yayatoh-Client`, and the values `app.config.ts` put in `extra` (API URL, public sign-in client
 * ids, the Sentry DSN). The only place mobile-core reads `expo-application` and `expo-constants`.
 */
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ClientIdentity, MobileApp, MobilePlatform } from '../client';
import type { GoogleProviderOptions } from '../session/providers';

export interface AppExtra {
  readonly appEnv: string;
  readonly apiBaseUrl: string;
  readonly sentryDsn?: string;
  readonly googleIosClientId?: string;
  readonly googleAndroidClientId?: string;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** `extra` from the Expo config, checked; throws if the build has no API URL (a broken build). */
export function readAppExtra(
  extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra,
): AppExtra {
  const apiBaseUrl = text(extra?.apiBaseUrl);
  if (!apiBaseUrl) throw new Error('The build has no apiBaseUrl: check app.config.ts');
  return {
    appEnv: text(extra?.appEnv) ?? 'development',
    apiBaseUrl,
    ...(text(extra?.sentryDsn) ? { sentryDsn: text(extra?.sentryDsn) } : {}),
    ...(text(extra?.googleIosClientId) ? { googleIosClientId: text(extra?.googleIosClientId) } : {}),
    ...(text(extra?.googleAndroidClientId)
      ? { googleAndroidClientId: text(extra?.googleAndroidClientId) }
      : {}),
  };
}

/** The version and build of this install, for the client header. */
export function nativeIdentity(app: MobileApp): ClientIdentity {
  const platform: MobilePlatform = Platform.OS === 'android' ? 'android' : 'ios';
  return {
    app,
    platform,
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0',
    ...(Application.nativeBuildVersion ? { build: Application.nativeBuildVersion } : {}),
  };
}

/**
 * Google's OAuth client and redirect for this platform, or null when none is configured (then the
 * app simply has no Google button). iOS clients redirect to `com.googleusercontent.apps.<id>:/oauthredirect`,
 * Android clients to `<package>:/oauth2redirect`.
 */
export function googleOptions(
  extra: AppExtra,
  platform: MobilePlatform,
  androidPackage?: string,
): GoogleProviderOptions | null {
  if (platform === 'ios' && extra.googleIosClientId) {
    const id = extra.googleIosClientId.split('.apps.googleusercontent.com')[0];
    return {
      clientId: extra.googleIosClientId,
      redirectUri: `com.googleusercontent.apps.${id}:/oauthredirect`,
    };
  }
  const pkg = androidPackage ?? Application.applicationId;
  if (platform === 'android' && extra.googleAndroidClientId && pkg) {
    return { clientId: extra.googleAndroidClientId, redirectUri: `${pkg}:/oauth2redirect` };
  }
  return null;
}
