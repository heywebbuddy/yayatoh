/**
 * The app-link identifiers (M7.2d) the e2e server is started with: test values in the shapes the
 * real ones have, so the well-known files carry content. Never real team, bundle or key values.
 */
export const APP_TEAM_ID = 'ABCDE12345';
export const ATTENDEE_BUNDLE = 'com.yayatoh.tickets';
export const STAFF_BUNDLE = 'com.yayatoh.staff';
export const ATTENDEE_PACKAGE = 'com.yayatoh.tickets';
export const STAFF_PACKAGE = 'com.yayatoh.staff';
export const FINGERPRINT = Array.from({ length: 32 }, (_, i) =>
  (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase(),
).join(':');

export const appLinksEnv: Record<string, string> = {
  APPLE_TEAM_ID: APP_TEAM_ID,
  IOS_ATTENDEE_BUNDLE_IDS: `${ATTENDEE_BUNDLE},${ATTENDEE_BUNDLE}.dev`,
  IOS_STAFF_BUNDLE_IDS: STAFF_BUNDLE,
  ANDROID_ATTENDEE_PACKAGES: ATTENDEE_PACKAGE,
  ANDROID_ATTENDEE_SHA256_FINGERPRINTS: FINGERPRINT,
  ANDROID_STAFF_PACKAGES: STAFF_PACKAGE,
  ANDROID_STAFF_SHA256_FINGERPRINTS: FINGERPRINT,
};
