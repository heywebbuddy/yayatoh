import { readAppExtra } from '@yayatoh/mobile-core';
import { Platform } from 'react-native';

/** The build's extra config, or none: a build that cannot read it simply offers no Google button. */
function readExtra(): { googleIosClientId?: string; googleAndroidClientId?: string } {
  try {
    return readAppExtra();
  } catch {
    return {};
  }
}

/** Which one-tap sign-in buttons this phone offers. Email code and password are always there. */
export interface AuthMethods {
  readonly apple: boolean;
  readonly google: boolean;
}

/**
 * Sign in with Apple on iOS only. Google when the build has an OAuth client for this platform
 * (`GOOGLE_IOS_CLIENT_ID` / `GOOGLE_ANDROID_CLIENT_ID`): without one the button is not shown.
 */
export function availableMethods(
  platform: string = Platform.OS,
  extra: { googleIosClientId?: string; googleAndroidClientId?: string } = readExtra(),
): AuthMethods {
  return {
    apple: platform === 'ios',
    google: platform === 'ios' ? Boolean(extra.googleIosClientId) : Boolean(extra.googleAndroidClientId),
  };
}
