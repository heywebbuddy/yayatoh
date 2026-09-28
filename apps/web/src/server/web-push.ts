import 'server-only';
import { type VapidConfig, vapidConfig } from '@yayatoh/notifications';

let cached: { config: VapidConfig | null } | undefined;

/**
 * This deployment's VAPID keys (M1.10e): the owner's `VAPID_*` in production; development and CI
 * derive a stable pair from APP_TOKEN_SECRET. A broken configuration turns web push off (logged)
 * rather than failing the page.
 */
export function webPushConfig(): VapidConfig | null {
  if (!cached) {
    try {
      cached = { config: vapidConfig() };
    } catch (err) {
      console.error(JSON.stringify({ webPush: 'config_error', message: String(err) }));
      cached = { config: null };
    }
  }
  return cached.config;
}

/** The `applicationServerKey` browsers subscribe with, or null when web push is off. */
export function webPushPublicKey(): string | null {
  return webPushConfig()?.keys.publicKey ?? null;
}
