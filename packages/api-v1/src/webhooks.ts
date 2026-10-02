import { type OpenAPIHono, z } from '@hono/zod-openapi';
import { type CatalogEntry, EVENT_CATALOG, WebhookEnvelopeBase } from '@yayatoh/webhooks/catalog';

/**
 * The event catalog in the OpenAPI document's top-level `webhooks` (OpenAPI 3.1; M6.3b): one
 * operation per public event and version, its message schema named `<Schema>Message`. Generated
 * clients (the TypeScript SDK, later Swift and Kotlin) get typed payloads, and the docs read the
 * same source. Registered on the document root, not under `/v1`: webhook names are not paths.
 */
export function registerWebhooks(app: OpenAPIHono): void {
  const headers = z.object({
    'webhook-id': z
      .string()
      .openapi({ description: 'The message id; retries and replays reuse it. Deduplicate on it.' }),
    'webhook-timestamp': z
      .string()
      .openapi({
        description: 'Unix seconds when this attempt was signed. Refuse it if more than 5 minutes away.',
      }),
    'webhook-signature': z.string().openapi({
      description:
        'Space-separated `v1,<base64 HMAC-SHA256>` signatures of `<id>.<timestamp>.<raw body>` with the endpoint secret (two during a rotation).',
    }),
  });
  for (const e of EVENT_CATALOG as readonly CatalogEntry[]) {
    const message = WebhookEnvelopeBase.extend({
      type: z.literal(e.type),
      version: z.literal(e.version),
      data: e.schema.openapi(e.schemaName),
    }).openapi(`${e.schemaName}Message`, { description: e.summary });
    app.openAPIRegistry.registerWebhook({
      method: 'post',
      path: e.type,
      operationId: `webhook_${e.type.replaceAll('.', '_')}_v${e.version}`,
      tags: ['webhooks'],
      summary: e.summary,
      description: `${e.description}\n\nVersion ${e.version}. Sent as a Standard Webhooks message (see the verification guide).`,
      request: {
        headers,
        body: { required: true, content: { 'application/json': { schema: message } } },
      },
      responses: {
        200: {
          description:
            'Any 2xx answer acknowledges the message; anything else is retried for about 28 hours.',
        },
      },
    });
  }
}
