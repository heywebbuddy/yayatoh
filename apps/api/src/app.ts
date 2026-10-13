import { OpenAPIHono } from '@hono/zod-openapi';
import {
  createV1,
  mobileSettingsFromEnv,
  OPENAPI_INFO,
  type V1Deps,
  openApiDocument as v1Document,
} from '@yayatoh/api-v1';
import { bearerSessions } from '@yayatoh/auth';
import { type PaymentProvider, paymentProviderFromEnv } from '@yayatoh/payments';
import { secureHeaders } from 'hono/secure-headers';
import { getAppSignIn, getAuth } from './auth.ts';
import { notFound, onError } from './errors.ts';
import { ports } from './ports.ts';

export { OPENAPI_INFO };

let payments: PaymentProvider | undefined;

/** api.yayatoh.com: sessions are the web's Better Auth sessions, carried as bearer tokens. */
export const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(getAuth()),
  appSignIn: getAppSignIn,
  payments: () => {
    payments ??= paymentProviderFromEnv(process.env, process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
    return payments;
  },
  mobile: mobileSettingsFromEnv(),
  // Images are served by the web app (`/media/…`); /v1 hands out absolute URLs on its origin.
  publicOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || undefined,
};

export function createApp(overrides: Partial<V1Deps> = {}) {
  const app = new OpenAPIHono();
  app.use('*', secureHeaders());
  app.route('/v1', createV1({ ...deps, ...overrides, basePath: '/v1' }));
  app.onError(onError);
  app.notFound(notFound);
  return app;
}

export function openApiDocument() {
  return v1Document(deps);
}
