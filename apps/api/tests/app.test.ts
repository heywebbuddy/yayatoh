import { describe, expect, it } from 'vitest';
import { createApp, openApiDocument } from '../src/app.ts';

describe('/v1', () => {
  const app = createApp();

  it('GET /v1/health returns the allowlisted health DTO', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['service', 'status', 'time', 'version']);
    expect(body).toMatchObject({ status: 'ok', service: 'api' });
  });

  it('serves an OpenAPI 3.1 document that includes /v1/health', async () => {
    const res = await app.request('/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/v1/health']).toBeDefined();
    expect(openApiDocument().paths?.['/v1/health']).toBeDefined();
  });

  it('returns the error envelope for unknown routes', async () => {
    const res = await app.request('/v1/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found' } });
  });

  it('sets secure headers', async () => {
    const res = await app.request('/v1/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
