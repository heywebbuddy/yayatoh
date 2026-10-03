import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { DomainError } from '@yayatoh/kernel';
import { apiKeySelf } from '@yayatoh/tenancy';
import type { V1Env } from '../context.ts';
import { ApiKeyInfo, toWire } from '../resources.ts';
import { json, OrgParam, problems } from './common.ts';

const route = createRoute({
  method: 'get',
  path: '/orgs/{org}/api-key',
  operationId: 'getCurrentApiKey',
  tags: ['organizations'],
  summary: 'The calling API key: scopes, expiry and rate limits (any scope)',
  description:
    'Who am I, for an org API key (M6.3a): its name, prefix, scopes, expiry (rotation sets one) and the per-minute quotas of the org’s plan. Never the secret. A user session gets `403`.',
  security: [{ apiKey: [] }],
  request: { params: OrgParam },
  responses: { 200: json(ApiKeyInfo, 'The calling key'), ...problems },
});

/** `GET /v1/orgs/{org}/api-key` (M6.3a). */
export function keyRoutes(
  quotas: (
    orgId: string,
    key: { sandbox: boolean; orgSandbox: boolean },
  ) => Promise<{
    keyPerMinute: number;
    orgPerMinute: number;
  } | null>,
) {
  return new OpenAPIHono<V1Env>().openapi(route, async (c) => {
    const p = c.get('principal');
    if (p?.kind !== 'api_key') throw new DomainError('forbidden', 'Only an API key can describe itself');
    const self = await apiKeySelf(c.get('ctx'));
    if (!self) throw new DomainError('unauthenticated', 'Unknown, expired or revoked API key');
    const rateLimit = await quotas(p.key.orgId, p.key);
    if (!rateLimit) throw new DomainError('module_not_enabled', 'API access is not part of this plan');
    return c.json(
      toWire(ApiKeyInfo, {
        id: self.id,
        name: self.name,
        prefix: self.prefix,
        scopes: self.scopes,
        test: self.sandbox,
        sandboxOrg: p.key.orgSandbox,
        createdAt: self.createdAt,
        expiresAt: self.expiresAt,
        rotated: self.replacedById !== null,
        rateLimit,
      }),
      200,
    );
  });
}
