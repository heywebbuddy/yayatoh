import { getCore } from '../core';
import { resolveIncomingUrl } from '../links/incoming';
import { reportPushMoment } from '../push/signals';

/**
 * Expo Router calls this for every URL that opens the app: a cold start, a warm start and while the
 * app is in front (M7.3d). The logic is in `links/incoming.ts`.
 */
export async function redirectSystemPath({ path }: { path: string | null; initial: boolean }) {
  try {
    const core = getCore();
    return await resolveIncomingUrl(path, {
      isSignedIn: async () => (await core.session.restore()).status === 'signedIn',
      onPurchase: () => reportPushMoment('purchase_completed'),
    });
  } catch {
    // Never crash the launch over a link: Home is always a safe place to land.
    return '/';
  }
}
