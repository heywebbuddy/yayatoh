import { readFileSync } from 'node:fs';
import { EVENT_CATALOG } from '@yayatoh/webhooks/catalog';
import { describe, expect, it } from 'vitest';
import { GUIDES } from '../src/lib/developer-guides.ts';
import { type DocsEntry, matchDocs } from '../src/lib/docs-search.ts';
import { type OpenApiLike, referenceFromDocument, typeOf } from '../src/lib/openapi-docs.ts';

const doc = JSON.parse(
  readFileSync(new URL('../../api/openapi.json', import.meta.url), 'utf8'),
) as OpenApiLike & { webhooks: Record<string, unknown> };

describe('API reference from OpenAPI (M6.3b)', () => {
  const tags = referenceFromDocument(doc);
  it('lists every operation of the committed document exactly once', () => {
    const want = Object.entries(doc.paths ?? {}).flatMap(([path, item]) =>
      Object.keys(item)
        .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m))
        .map((m) => `${m.toUpperCase()} ${path}`),
    );
    const got = tags.flatMap((t) => t.operations.map((o) => `${o.method} ${o.path}`));
    expect(got.sort()).toEqual(want.sort());
    expect(new Set(tags.flatMap((t) => t.operations.map((o) => o.id))).size).toBe(got.length);
  });

  it('keeps summaries, parameters with descriptions and response codes', () => {
    const op = tags
      .flatMap((t) => t.operations)
      .find((o) => o.path === '/v1/orgs/{org}/events' && o.method === 'GET');
    expect(op?.summary).toBeTruthy();
    expect(op?.parameters.map((p) => p.name)).toEqual(expect.arrayContaining(['org', 'limit', 'cursor']));
    expect(op?.parameters.every((p) => p.description.length > 0)).toBe(true);
    expect(op?.responses.map((r) => r.status)).toContain('200');
  });

  it('documents every catalog event in the document’s webhooks', () => {
    expect(Object.keys(doc.webhooks).sort()).toEqual(EVENT_CATALOG.map((e) => e.type).sort());
  });

  it('writes one-line types', () => {
    expect(typeOf({ type: 'string', format: 'uuid' })).toBe('uuid');
    expect(typeOf({ type: 'array', items: { $ref: '#/components/schemas/Event' } })).toBe('Event[]');
    expect(typeOf({ $ref: '#/components/schemas/S' }, { S: { enum: ['a', 'b'] } })).toBe('"a" | "b"');
    expect(typeOf({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null');
  });
});

describe('docs search (M6.3b)', () => {
  const index: DocsEntry[] = [
    {
      kind: 'operation',
      title: 'GET /v1/orgs/{org}/orders',
      detail: 'List orders',
      href: '/r#a',
      text: 'get /v1/orgs/{org}/orders list orders',
    },
    {
      kind: 'event',
      title: 'order.paid',
      detail: 'An order was paid',
      href: '/e#b',
      text: 'order.paid an order was paid orderid',
    },
    {
      kind: 'guide',
      title: 'Webhooks and signature verification',
      detail: 'Verify',
      href: '/g/webhooks',
      text: 'webhooks signature verification hmac order',
    },
  ];
  it('needs every word; guides then events then operations; title matches first', () => {
    expect(matchDocs(index, 'order').map((e) => e.kind)).toEqual(['event', 'operation', 'guide']);
    expect(matchDocs(index, 'signature hmac').map((e) => e.href)).toEqual(['/g/webhooks']);
    expect(matchDocs(index, 'order paid').map((e) => e.title)).toEqual(['order.paid']);
  });
  it('ignores one-letter and empty queries, and finds nothing for nonsense', () => {
    expect(matchDocs(index, 'o')).toEqual([]);
    expect(matchDocs(index, '   ')).toEqual([]);
    expect(matchDocs(index, 'zzzz')).toEqual([]);
  });
  it('the guides cover auth, pagination, idempotency, webhooks and sandbox', () => {
    expect(GUIDES.map((g) => g.slug)).toEqual([
      'authentication',
      'pagination',
      'idempotency',
      'webhooks',
      'sandbox',
    ]);
    const webhooks = GUIDES.find((g) => g.slug === 'webhooks');
    expect(webhooks?.blocks.some((b) => b.kind === 'code' && b.code.includes('verifyYayatohWebhook'))).toBe(
      true,
    );
  });
});
