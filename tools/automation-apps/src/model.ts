/**
 * The automation apps' model (M6.5c), read from the `/v1` OpenAPI document (`apps/api/openapi.json`):
 * Make and n8n get the same actions, searches and triggers, generated, never hand-listed.
 *
 * - **Actions and searches:** every org operation (`/v1/orgs/{org}/…`) an API key can call that
 *   documents its scope (`scope \`x:y\``), except the plumbing the apps use themselves (the
 *   connection test and webhook subscriptions). `GET`s are searches, the rest actions.
 * - **Triggers:** every subscribable message in the document's `webhooks` (the M6.3b catalog,
 *   minus `webhook.test`). A trigger subscribes through `POST /v1/orgs/{org}/webhook-endpoints`
 *   when it is turned on and unsubscribes with `DELETE` when it is turned off.
 *
 * The org is never a module input: it comes from the connection (credential), next to the API
 * key, and `/v1` refuses an org that is not the key's (404). Each action declares the scope it
 * needs, so the apps can say which key to create; `/v1` refuses a key without it (403).
 */

export interface OpenApiDoc {
  readonly paths: Record<string, Record<string, OpenApiOperation>>;
  readonly webhooks?: Record<string, { post: OpenApiOperation }>;
  readonly components: { readonly schemas: Record<string, JsonSchema> };
  readonly tags?: readonly { name: string; description?: string }[];
}

export interface OpenApiOperation {
  readonly operationId: string;
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly description?: string;
  readonly security?: readonly Record<string, readonly string[]>[];
  readonly parameters?: readonly {
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: JsonSchema;
  }[];
  readonly requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
}

export interface JsonSchema {
  readonly $ref?: string;
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly enum?: readonly unknown[];
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly description?: string;
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly default?: unknown;
  readonly maximum?: number;
  readonly minimum?: number;
}

/** A field's kind in the apps (both map it to their own types). */
export type FieldKind = 'text' | 'number' | 'boolean' | 'datetime' | 'select' | 'text_list' | 'json';

export interface Field {
  readonly name: string;
  readonly label: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  readonly description: string;
  readonly options?: readonly string[];
  readonly where: 'path' | 'query' | 'body';
}

export interface Operation {
  /** The OpenAPI `operationId`: the module's stable key. */
  readonly key: string;
  readonly kind: 'action' | 'search';
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** The path below the org (`/events/{eventId}`); the org comes from the connection. */
  readonly path: string;
  readonly fullPath: string;
  readonly resource: string;
  readonly label: string;
  readonly description: string;
  /** The API key scope the operation needs. */
  readonly scope: string;
  readonly fields: readonly Field[];
  /** A page (`{ data, nextCursor }`) or a list (`{ data }`): searches return its items. */
  readonly returnsList: boolean;
  /** Takes `cursor` and answers `nextCursor` (searches fetch every page). */
  readonly paged: boolean;
  readonly idempotencyKey: boolean;
}

export interface Trigger {
  /** The webhook event type (`order.paid`). */
  readonly type: string;
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  /** The `data` fields of the message (thin: ids and facts). */
  readonly fields: readonly { name: string; kind: FieldKind; label: string }[];
}

export interface AppModel {
  readonly operations: readonly Operation[];
  readonly triggers: readonly Trigger[];
  readonly scopes: readonly string[];
}

const ORG_PREFIX = '/v1/orgs/{org}';
/**
 * What the apps call themselves (the connection test and webhook subscriptions), and the org
 * itself (the connection names it; its label comes from the connection test).
 */
export const PLUMBING = new Set([
  'getOrganization',
  'getCurrentApiKey',
  'listWebhookEndpoints',
  'createWebhookEndpoint',
  'deleteWebhookEndpoint',
]);
const SCOPE = /scope `([a-z_]+:[a-z_]+)`/i;
const METHODS = ['get', 'post', 'patch', 'put', 'delete'] as const;

const resolve = (doc: OpenApiDoc, s: JsonSchema | undefined): JsonSchema => {
  let cur = s ?? {};
  for (let i = 0; cur.$ref && i < 10; i++) {
    const name = cur.$ref.replace('#/components/schemas/', '');
    cur = doc.components.schemas[name] ?? {};
  }
  return cur;
};

const types = (s: JsonSchema) => (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []) as string[];

function kindOf(doc: OpenApiDoc, raw: JsonSchema | undefined): { kind: FieldKind; options?: string[] } {
  const s = resolve(doc, raw);
  if (s.enum?.every((v) => typeof v === 'string'))
    return { kind: 'select', options: [...(s.enum as string[])] };
  const t = types(s).filter((x) => x !== 'null');
  if (s.anyOf || s.oneOf) return { kind: 'json' };
  if (t.includes('string')) return { kind: s.format === 'date-time' ? 'datetime' : 'text' };
  if (t.includes('integer') || t.includes('number')) return { kind: 'number' };
  if (t.includes('boolean')) return { kind: 'boolean' };
  if (t.includes('array')) {
    const item = resolve(doc, s.items);
    return types(item).includes('string') && !item.enum ? { kind: 'text_list' } : { kind: 'json' };
  }
  return { kind: 'json' };
}

/** `ticketTypeId` → `Ticket type id`. */
export const labelOf = (name: string) => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .toLowerCase()
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const firstLine = (text: string | undefined) =>
  (text ?? '')
    .split('\n')[0]
    ?.replace(/\s*\(scope `[^`]+`[^)]*\)\s*$/, '')
    .trim() ?? '';

function operationOf(
  doc: OpenApiDoc,
  path: string,
  method: (typeof METHODS)[number],
  op: OpenApiOperation,
): Operation | null {
  if (!path.startsWith(ORG_PREFIX) || PLUMBING.has(op.operationId)) return null;
  if (!op.security?.some((s) => 'apiKey' in s)) return null;
  const scope = SCOPE.exec(`${op.summary ?? ''} ${op.description ?? ''}`)?.[1];
  if (!scope) return null;
  const fields: Field[] = [];
  for (const p of op.parameters ?? []) {
    if (p.in === 'header' || p.name === 'org' || p.name === 'cursor') continue;
    if (p.in !== 'path' && p.in !== 'query') continue;
    const k = kindOf(doc, p.schema);
    fields.push({
      name: p.name,
      label: labelOf(p.name),
      kind: k.kind,
      ...(k.options ? { options: k.options } : {}),
      required: p.in === 'path' || p.required === true,
      description: p.description ?? resolve(doc, p.schema).description ?? '',
      where: p.in,
    });
  }
  const bodySchema = resolve(doc, op.requestBody?.content?.['application/json']?.schema);
  for (const [name, raw] of Object.entries(bodySchema.properties ?? {})) {
    const k = kindOf(doc, raw);
    fields.push({
      name,
      label: labelOf(name),
      kind: k.kind,
      ...(k.options ? { options: k.options } : {}),
      required: (bodySchema.required ?? []).includes(name),
      description: resolve(doc, raw).description ?? raw.description ?? '',
      where: 'body',
    });
  }
  const ok = (op as { responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }> })
    .responses;
  const success = Object.entries(ok ?? {}).find(([code]) => code.startsWith('2'))?.[1];
  const out = resolve(doc, success?.content?.['application/json']?.schema);
  const returnsList = types(resolve(doc, out.properties?.data)).includes('array');
  const sub = path.slice(ORG_PREFIX.length) || '/';
  return {
    key: op.operationId,
    kind: method === 'get' ? 'search' : 'action',
    method: method.toUpperCase() as Operation['method'],
    path: sub,
    fullPath: path,
    resource: op.tags?.[0] ?? 'other',
    label: firstLine(op.summary) || labelOf(op.operationId),
    description: (op.description ?? op.summary ?? '').trim(),
    scope,
    fields,
    returnsList,
    paged: (op.parameters ?? []).some((p) => p.in === 'query' && p.name === 'cursor'),
    idempotencyKey: method !== 'get',
  };
}

function triggerOf(doc: OpenApiDoc, type: string, post: OpenApiOperation): Trigger | null {
  if (type === 'webhook.test') return null;
  const message = resolve(doc, post.requestBody?.content?.['application/json']?.schema);
  const data = resolve(doc, message.properties?.data);
  return {
    type,
    key: `watch_${type.replace(/[^a-z0-9]+/g, '_')}`,
    label: post.summary?.replace(/\.$/, '') ?? type,
    description: (post.description ?? '').split('\n\n')[0]?.trim() ?? '',
    group: type.split('.')[0] ?? 'other',
    fields: Object.entries(data.properties ?? {}).map(([name, raw]) => ({
      name,
      label: labelOf(name),
      kind: kindOf(doc, raw).kind,
    })),
  };
}

/** Build the model from the OpenAPI document. Sorted, so the generated files are stable. */
export function buildModel(doc: OpenApiDoc): AppModel {
  const operations: Operation[] = [];
  for (const [path, ops] of Object.entries(doc.paths))
    for (const m of METHODS) {
      const op = ops[m];
      if (!op) continue;
      const o = operationOf(doc, path, m, op);
      if (o) operations.push(o);
    }
  operations.sort((a, b) => a.key.localeCompare(b.key));
  const triggers = Object.entries(doc.webhooks ?? {})
    .map(([type, w]) => triggerOf(doc, type, w.post))
    .filter((t): t is Trigger => t !== null)
    .sort((a, b) => a.type.localeCompare(b.type));
  const scopes = [...new Set([...operations.map((o) => o.scope), 'webhooks:manage'])].sort();
  return { operations, triggers, scopes };
}
