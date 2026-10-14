/**
 * The phone side of push for the real app: the Expo port and the facts about this build that the
 * server stores with the token. Imported by the root layout only, so tests that render screens never
 * load `expo-notifications`.
 */

import { readAppExtra } from '@yayatoh/mobile-core';
import { type AppEnv, apnsEnvironment } from '@yayatoh/mobile-core/app-config';
import * as Application from 'expo-application';
import { expoPushPort } from './expo-port';
import type { PushPort } from './port';
import type { DeviceFacts } from './registration';

/** The production id of the listed app; only used if the OS cannot say (it always can on a phone). */
const FALLBACK_APP_ID = 'com.yayatoh.yayatohapp';

export function nativeDeviceFacts(appVersion: string): DeviceFacts {
  const appEnv = readAppExtra().appEnv as AppEnv;
  return {
    // The bundle id (iOS) or package name (Android) of this build; the server may list the ones it accepts.
    appId: Application.applicationId ?? FALLBACK_APP_ID,
    appVersion,
    environment: apnsEnvironment(appEnv),
  };
}

export function nativePushPort(): PushPort {
  return expoPushPort();
}
