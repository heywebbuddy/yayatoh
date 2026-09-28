import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { healthSerializer } from '@yayatoh/contracts';
import { Health } from '../resources.ts';
import { API_VERSION } from './version.ts';

const route = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  tags: ['system'],
  summary: 'Liveness check',
  description:
    'Answers 200 while the API is up. No credential; not rate limited beyond the anonymous budget.',
  responses: {
    200: { description: 'The API is up', content: { 'application/json': { schema: Health } } },
  },
});

export const health = new OpenAPIHono().openapi(route, (c) =>
  c.json(
    healthSerializer.serialize({
      status: 'ok',
      service: 'api',
      version: API_VERSION,
      time: new Date().toISOString(),
    }),
    200,
  ),
);
