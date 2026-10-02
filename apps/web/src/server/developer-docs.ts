import 'server-only';
import { openApiDocument } from '@yayatoh/api-v1';
import { type CatalogEntry, EVENT_CATALOG, EVENT_GROUPS, exampleEnvelope } from '@yayatoh/webhooks/catalog';
import { z } from 'zod';
import { GUIDES } from '@/lib/developer-guides.ts';
import {
  type DocEvent,
  type DocField,
  type DocTag,
  type Json,
  type OpenApiLike,
  referenceFromDocument,
  type SearchEntry,
  slugOf,
  typeOf,
} from '@/lib/openapi-docs.ts';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';

/**
 * The public developer docs' data (M6.3b), generated from the `/v1` OpenAPI document (the same
 * one `apps/api/openapi.json` commits) and the webhook event catalog. Built once per process.
 */

let reference: readonly DocTag[] | undefined;

/** The API reference, from the same OpenAPI document `/v1` serves and `apps/api` commits. */
export function apiReference(): readonly DocTag[] {
  reference ??= referenceFromDocument(
    openApiDocument({ ports, payments: getPaymentProvider }) as unknown as OpenApiLike,
  );
  return reference;
}

function fieldsOf(e: CatalogEntry): DocField[] {
  const schema = z.toJSONSchema(e.schema, { io: 'output' }) as Json;
  const props = (schema.properties ?? {}) as Record<string, Json>;
  const required = new Set((schema.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, node]) => ({
    name,
    type: typeOf(node),
    required: required.has(name),
  }));
}

/** The event catalog for the docs, grouped. */
export function eventDocs(): readonly { group: string; events: readonly DocEvent[] }[] {
  return EVENT_GROUPS.map((group) => ({
    group,
    events: (EVENT_CATALOG as readonly CatalogEntry[])
      .filter((e) => e.group === group)
      .map((e) => ({
        type: e.type,
        version: e.version,
        anchor: slugOf(`${e.type}-v${e.version}`),
        summary: e.summary,
        description: e.description,
        fields: fieldsOf(e),
        example: JSON.stringify(exampleEnvelope(e), null, 2),
      })),
  }));
}

let index: SearchEntry[] | undefined;

/** Everything the docs search finds: guides, operations and events. */
export function searchIndex(): readonly SearchEntry[] {
  if (index) return index;
  const entries: SearchEntry[] = [];
  for (const g of GUIDES)
    entries.push({
      kind: 'guide',
      title: g.title,
      detail: g.summary.replaceAll('`', ''),
      href: `/developers/guides/${g.slug}`,
      text: [g.title, g.summary, ...g.blocks.map((b) => (b.kind === 'md' ? b.text : b.title))]
        .join(' ')
        .toLowerCase(),
    });
  for (const tag of apiReference())
    for (const op of tag.operations)
      entries.push({
        kind: 'operation',
        title: `${op.method} ${op.path}`,
        detail: op.summary,
        href: `/developers/reference#${op.id}`,
        text: `${op.method} ${op.path} ${op.summary} ${op.id} ${tag.name}`.toLowerCase(),
      });
  for (const { events } of eventDocs())
    for (const e of events)
      entries.push({
        kind: 'event',
        title: e.type,
        detail: e.summary,
        href: `/developers/events#${e.anchor}`,
        text: `${e.type} ${e.summary} ${e.description} ${e.fields.map((f) => f.name).join(' ')}`.toLowerCase(),
      });
  index = entries;
  return index;
}
