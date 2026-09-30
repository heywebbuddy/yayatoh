import { OpenAPIHono } from '@hono/zod-openapi';
import { createV1, OPENAPI_INFO, type V1Deps, openApiDocument as v1Document } from '@yayatoh/api-v1';
import { type Auth, bearerSessions, consoleMailer, createAuth } from '@yayatoh/auth';
import { type PaymentProvider, paymentProviderFromEnv } from '@yayatoh/payments';
import { secureHeaders } from 'hono/secure-headers';
import { notFound, onError } from './errors.ts';
import { ports } from './ports.ts';

export { OPENAPI_INFO };

let auth: Auth | undefined;
let payments: PaymentProvider | undefined;

/** api.yayatoh.com: sessions are the web's Better Auth sessions, carried as bearer tokens. */
export const deps: V1Deps = {
  ports,
  sessions: () => {
    if (!auth) {
      const secret = process.env.BETTER_AUTH_SECRET;
      if (!secret) throw new Error('BETTER_AUTH_SECRET is not set (see .env.example)');
      auth = createAuth({
        baseURL: process.env.API_PUBLIC_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:4000',
        secret,
        mailer: consoleMailer,
      });
    }
    return bearerSessions(auth);
  },
  payments: () => {
    payments ??= paymentProviderFromEnv(process.env, process.env.BETTER_AUTH_URL ?? 'http://localhost:3000');
    return payments;
  },
  mobile: process.env.MOBILE_CONFIG_JSON ? JSON.parse(process.env.MOBILE_CONFIG_JSON) : undefined,
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
