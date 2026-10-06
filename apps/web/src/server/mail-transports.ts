import 'server-only';
import { isProductionEnv } from '@yayatoh/kernel';
import { devMailboxTransports, liveTransports, type Transports } from '@yayatoh/notifications';

let transports: Transports | null | undefined;

/**
 * Where the web app's at-once email goes (guest codes, account sign-in mail; never queued, so no
 * code is ever stored): the live provider once it is switched on and configured
 * (`EMAIL_PROVIDER=ses` with its names, M3.5b), as the worker does; otherwise the dev mailbox in
 * development, preview and CI, and nothing in production, where callers refuse to pretend.
 */
export function webTransports(): Transports | null {
  if (transports !== undefined) return transports;
  const production = process.env.NODE_ENV === 'production' && isProductionEnv();
  const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || process.env.BETTER_AUTH_URL || 'http://localhost:3000';
  transports = liveTransports(process.env, origin, production ? null : devMailboxTransports());
  return transports;
}
