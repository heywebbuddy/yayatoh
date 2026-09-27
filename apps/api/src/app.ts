import { OpenAPIHono } from '@hono/zod-openapi';
import { DEVICE_TOKEN_SCHEME, scannerRoutes } from '@yayatoh/checkin/routes';
import { secureHeaders } from 'hono/secure-headers';
import { notFound, onError, validationFailed } from './errors.ts';
import { ports } from './ports.ts';
import { API_VERSION, health } from './routes/health.ts';

export const OPENAPI_INFO = {
  openapi: '3.1.0',
  info: {
    title: 'Yayatoh API',
    version: API_VERSION,
    description: 'Yayatoh /v1. Changes are additive only (oasdiff gate).',
  },
} as const;

export function createApp() {
  const v1 = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return validationFailed(c);
      }
    },
  });
  v1.route('/', health);
  v1.route('/', scannerRoutes(ports));
  v1.openAPIRegistry.registerComponent('securitySchemes', 'deviceToken', DEVICE_TOKEN_SCHEME);

  const app = new OpenAPIHono();
  app.use('*', secureHeaders());
  app.route('/v1', v1);
  app.doc31('/v1/openapi.json', OPENAPI_INFO);
  app.onError(onError);
  app.notFound(notFound);
  return app;
}

export function openApiDocument() {
  return createApp().getOpenAPI31Document(OPENAPI_INFO);
}
