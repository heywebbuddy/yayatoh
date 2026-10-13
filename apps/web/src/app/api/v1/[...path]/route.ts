import { createV1 } from '@yayatoh/api-v1';
import { type AppSignIn, appSignIn, bearerSessions, idTokenVerifierFromEnv } from '@yayatoh/auth';
import { isProductionEnv } from '@yayatoh/kernel';
import { Hono } from 'hono';
import { authMailer, getAuth, getTwoFactor } from '@/server/auth.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

/**
 * `/v1` on the web app's own origin (the Scan PWA, and API clients during development). The
 * router is the one `apps/api` serves at `api.yayatoh.com/v1`; only the mount point differs.
 * No cookies are read here: API keys, bearer sessions and device tokens only.
 */
let signIn: AppSignIn | undefined;
/** App sign-in (M7.2a) on this origin: the web's mailer, sealed two-step secrets and step-up rules. */
const getAppSignIn = (): AppSignIn =>
  (signIn ??= appSignIn(getAuth(), {
    mailer: authMailer,
    twoFactor: getTwoFactor(),
    verifier: idTokenVerifierFromEnv(process.env, { production: isProductionEnv() }),
  }));

const app = new Hono().route(
  '/api/v1',
  createV1({
    ports,
    sessions: () => bearerSessions(getAuth()),
    appSignIn: getAppSignIn,
    payments: getPaymentProvider,
    basePath: '/api/v1',
  }),
);

const handle = (req: Request) => app.fetch(req);
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
// M6.4c: `DELETE /v1/orgs/{org}/hooks/{hookId}` (Zapier unsubscribing a REST hook).
export const DELETE = handle;
