import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { HealthDto, healthSerializer } from '@yayatoh/contracts';

export const API_VERSION = '0.1.0';

const route = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Liveness check',
  responses: {
    200: { description: 'The API is up', content: { 'application/json': { schema: HealthDto } } },
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
