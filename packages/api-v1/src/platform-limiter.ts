import { postgresRateLimitStore } from '@yayatoh/platform';
import {
  createRateLimiter,
  type RateLimiter as PlatformRateLimiter,
  type RateLimitStore,
  upstashRateLimitStore,
} from '@yayatoh/platform/security';

let defaultLimiter: PlatformRateLimiter | undefined;

/**
 * The M1.14 limiter as the web app builds it: Upstash when configured, otherwise Postgres counters.
 * The portal sign-in (M7.2e) and the apps' checkout (M7.2f) count against its policies, so a
 * phone and a browser share one set of abuse rules.
 */
export function platformLimiter(): PlatformRateLimiter {
  if (!defaultLimiter) {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    const store: RateLimitStore =
      url && token ? upstashRateLimitStore({ url, token }) : postgresRateLimitStore;
    defaultLimiter = createRateLimiter(store, (err) =>
      console.error(JSON.stringify({ rateLimit: 'store_error', message: String(err) })),
    );
  }
  return defaultLimiter;
}
