import { z } from 'zod';
import type { AppModel, OpenApiDoc } from './model.ts';

/**
 * CI validation of the generated apps (M6.5c): their shapes (the parts of Make's app definition
 * and n8n's node description we produce), and that they cannot do more than `/v1` allows. Every
 * action is an existing OpenAPI operation with the same method, path and scope; no module or
 * operation takes the org or a credential as input (the org comes from the connection, next to
 * the key, and `/v1` refuses another org); triggers are exactly the catalog's subscribable types.
 */

const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const SCOPE = /^[a-z_]+:[a-z_]+$/;
const Method = z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const Op = z.object({ method: Method, path: z.string().startsWith('/v1/orgs/{org}') });

const MakeParameter = z
  .object({
    name: z.string().regex(NAME),
    label: z.string().min(1),
    type: z.enum([
      'text',
      'number',
      'boolean',
      'date',
      'select',
      'array',
      'any',
      'password',
      'url',
      'collection',
    ]),
    required: z.boolean().optional(),
    help: z.string().optional(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    spec: z.unknown().optional(),
    default: z.unknown().optional(),
    advanced: z.boolean().optional(),
  })
  .strict();

const Communication = z.object({
  url: z.string().min(1),
  method: Method.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  qs: z.unknown().optional(),
  body: z.unknown().optional(),
  response: z.unknown().optional(),
  pagination: z.unknown().optional(),
});

const TriggerModule = z
  .object({
    typeName: z.literal('instant_trigger'),
    name: z.string().regex(NAME),
    label: z.string().min(1),
    description: z.string(),
    connection: z.literal('yayatoh'),
    scope: z.literal('webhooks:manage'),
    webhook: z.string().regex(NAME),
    eventType: z.string(),
    communication: z.object({ output: z.string() }),
    interface: z.array(z.unknown()),
  })
  .strict();

const operationModule = <T extends 'action' | 'search'>(typeName: T) =>
  z
    .object({
      typeName: z.literal(typeName),
      name: z.string().regex(NAME),
      label: z.string().min(1),
      description: z.string(),
      connection: z.literal('yayatoh'),
      scope: z.string().regex(SCOPE),
      resource: z.string(),
      operation: Op,
      // Relative to the base URL (which carries the connection's org): never an absolute URL.
      communication: Communication.extend({ url: z.string().regex(/^\/[^:]*$/) }),
      parameters: z.array(MakeParameter).max(0),
      expect: z.array(MakeParameter),
    })
    .strict();

const MakeModule = z.discriminatedUnion('typeName', [
  TriggerModule,
  operationModule('action'),
  operationModule('search'),
]);

export const MakeAppSchema = z
  .object({
    $schema: z.literal('yayatoh.make-app/1'),
    name: z.literal('yayatoh'),
    label: z.string(),
    description: z.string(),
    generatedFrom: z.object({ api: z.string(), operations: z.int(), triggers: z.int() }),
    base: z.object({
      baseUrl: z.literal('{{connection.baseUrl}}/v1/orgs/{{connection.org}}'),
      headers: z.record(z.string(), z.string()),
      response: z.unknown(),
    }),
    connections: z
      .array(
        z.object({
          name: z.literal('yayatoh'),
          label: z.string(),
          type: z.literal('basic'),
          scopes: z.array(z.string().regex(SCOPE)),
          parameters: z.array(MakeParameter),
          communication: Communication,
        }),
      )
      .length(1),
    webhooks: z.array(
      z
        .object({
          name: z.string().regex(NAME),
          label: z.string(),
          type: z.literal('dedicated'),
          connection: z.literal('yayatoh'),
          eventType: z.string(),
          attach: Communication,
          detach: Communication,
        })
        .strict(),
    ),
    modules: z.array(MakeModule),
  })
  .strict();

const N8nProperty: z.ZodType<unknown> = z.lazy(() =>
  z
    .object({
      displayName: z.string().min(1),
      name: z.string().regex(NAME),
      type: z.enum([
        'string',
        'number',
        'boolean',
        'dateTime',
        'options',
        'multiOptions',
        'json',
        'collection',
      ]),
      default: z.unknown(),
      required: z.boolean().optional(),
      noDataExpression: z.boolean().optional(),
      description: z.string().optional(),
      hint: z.string().optional(),
      placeholder: z.string().optional(),
      typeOptions: z.record(z.string(), z.unknown()).optional(),
      displayOptions: z.object({ show: z.record(z.string(), z.array(z.string())) }).optional(),
      options: z.array(z.union([N8nOption, N8nProperty])).optional(),
      routing: z.unknown().optional(),
    })
    .strict(),
);
const N8nOption = z
  .object({
    name: z.string().min(1),
    value: z.string(),
    action: z.string().optional(),
    description: z.string().optional(),
    routing: z
      .object({
        request: z.object({
          method: Method,
          // Below the credential's org (requestDefaults.baseURL): a path, never a host.
          url: z.string().regex(/^=\/[^:]*$/),
          headers: z.record(z.string(), z.string()).optional(),
        }),
        output: z.unknown().optional(),
      })
      .optional(),
  })
  .strict();

const N8nDescription = z.object({
  displayName: z.string(),
  name: z.string().regex(NAME),
  icon: z.string(),
  group: z.array(z.string()),
  version: z.literal(1),
  subtitle: z.string(),
  description: z.string(),
  defaults: z.object({ name: z.string() }),
  inputs: z.array(z.string()),
  outputs: z.array(z.string()),
  credentials: z.array(z.object({ name: z.literal('yayatohApi'), required: z.literal(true) })),
  requestDefaults: z
    .object({
      baseURL: z.literal('={{$credentials.baseUrl}}/v1/orgs/{{$credentials.org}}'),
      headers: z.record(z.string(), z.string()),
    })
    .optional(),
  webhooks: z.array(z.unknown()).optional(),
  properties: z.array(N8nProperty),
});

export const N8nNodeSchema = z.object({
  description: N8nDescription,
  yayatoh: z.object({
    api: z.string(),
    operations: z.record(z.string(), Op.extend({ scope: z.string().regex(SCOPE), resource: z.string() })),
  }),
});

export const N8nTriggerSchema = z.object({
  description: N8nDescription,
  yayatoh: z.object({
    api: z.string(),
    eventTypes: z.array(z.string()),
    subscription: z.object({
      scope: z.literal('webhooks:manage'),
      create: z.object({
        method: z.literal('POST'),
        url: z.string(),
        body: z.unknown(),
        idField: z.string(),
        operation: Op,
      }),
      delete: z.object({ method: z.literal('DELETE'), url: z.string(), operation: Op }),
    }),
  }),
});

export const N8nCredentialsSchema = z.object({
  name: z.literal('yayatohApi'),
  displayName: z.string(),
  documentationUrl: z.string(),
  properties: z.array(N8nProperty),
  authenticate: z.object({
    type: z.literal('generic'),
    properties: z.object({
      headers: z.object({ Authorization: z.literal('=Bearer {{$credentials.apiKey}}') }),
    }),
  }),
  test: z.object({
    request: z.object({ baseURL: z.string(), url: z.literal('=/v1/orgs/{{$credentials.org}}/api-key') }),
  }),
});

/** Names a module or node may never take as input (the connection owns them). */
const FORBIDDEN_INPUTS = new Set(['org', 'orgId', 'apiKey', 'authorization', 'Authorization']);

const SCOPE_TEXT = /scope `([a-z_]+:[a-z_]+)`/i;

/** Every problem with the generated files, as readable lines (empty: valid). */
export function validateApps(
  doc: OpenApiDoc,
  model: AppModel,
  files: { make: unknown; n8nNode: unknown; n8nTrigger: unknown; n8nCredentials: unknown },
): string[] {
  const problems: string[] = [];
  const shape = (name: string, schema: z.ZodType, value: unknown) => {
    const r = schema.safeParse(value);
    if (!r.success)
      for (const i of r.error.issues.slice(0, 20)) problems.push(`${name}: ${i.path.join('.')} ${i.message}`);
    return r.success;
  };
  const opAt = (method: string, path: string) => doc.paths[path]?.[method.toLowerCase()];
  const checkOp = (where: string, o: { method: string; path: string }, scope: string) => {
    const op = opAt(o.method, o.path);
    if (!op) return problems.push(`${where}: ${o.method} ${o.path} is not a /v1 operation`);
    const documented = SCOPE_TEXT.exec(`${op.summary ?? ''} ${op.description ?? ''}`)?.[1];
    if (documented !== scope) problems.push(`${where}: scope ${scope} is not the documented ${documented}`);
    if (!op.security?.some((s) => 'apiKey' in s)) problems.push(`${where}: not callable with an API key`);
  };
  const triggerTypes = model.triggers.map((t) => t.type).sort();
  const catalog = Object.keys(doc.webhooks ?? {})
    .filter((t) => t !== 'webhook.test')
    .sort();
  if (JSON.stringify(triggerTypes) !== JSON.stringify(catalog))
    problems.push('triggers: not exactly the subscribable webhook event types');

  if (shape('make', MakeAppSchema, files.make)) {
    const app = files.make as z.infer<typeof MakeAppSchema>;
    const hooks = new Set(app.webhooks.map((w) => w.name));
    for (const m of app.modules as Record<string, unknown>[]) {
      const where = `make.${String(m.name)}`;
      if (m.typeName === 'instant_trigger') {
        if (!hooks.has(String(m.webhook))) problems.push(`${where}: unknown webhook ${String(m.webhook)}`);
        if (!catalog.includes(String(m.eventType))) problems.push(`${where}: unknown event type`);
        continue;
      }
      checkOp(where, m.operation as { method: string; path: string }, String(m.scope));
      const inputs = (m.expect as { name: string }[]).map((p) => p.name);
      for (const name of inputs)
        if (FORBIDDEN_INPUTS.has(name)) problems.push(`${where}: takes ${name} as input`);
      const url = (m.communication as { url: string }).url;
      for (const ref of url.matchAll(/\{\{parameters\.([A-Za-z]+)\}\}/g))
        if (!inputs.includes(ref[1] as string)) problems.push(`${where}: url uses unknown ${ref[1]}`);
      const path = (m.operation as { path: string }).path.replace('/v1/orgs/{org}', '');
      if (url.replace(/\{\{parameters\.([A-Za-z]+)\}\}/g, '{$1}') !== path)
        problems.push(`${where}: url ${url} is not the operation's path`);
    }
    for (const w of app.webhooks) {
      if (!String(w.attach.url).endsWith('/v1/orgs/{{connection.org}}/webhook-endpoints'))
        problems.push(`make.${w.name}: attach is not the subscription endpoint`);
      checkOp(
        `make.${w.name}.attach`,
        { method: 'POST', path: '/v1/orgs/{org}/webhook-endpoints' },
        'webhooks:manage',
      );
    }
  }
  if (shape('n8n.node', N8nNodeSchema, files.n8nNode)) {
    const node = files.n8nNode as z.infer<typeof N8nNodeSchema>;
    for (const [key, o] of Object.entries(node.yayatoh.operations)) checkOp(`n8n.${key}`, o, o.scope);
    const names = JSON.stringify(node.description.properties);
    for (const f of FORBIDDEN_INPUTS)
      if (names.includes(`"name":"${f}"`)) problems.push(`n8n.node: takes ${f} as input`);
    if (Object.keys(node.yayatoh.operations).length !== model.operations.length)
      problems.push('n8n.node: not every operation');
  }
  if (shape('n8n.trigger', N8nTriggerSchema, files.n8nTrigger)) {
    const t = files.n8nTrigger as z.infer<typeof N8nTriggerSchema>;
    if (JSON.stringify([...t.yayatoh.eventTypes].sort()) !== JSON.stringify(catalog))
      problems.push('n8n.trigger: not exactly the subscribable event types');
    checkOp('n8n.trigger.create', t.yayatoh.subscription.create.operation, 'webhooks:manage');
    checkOp('n8n.trigger.delete', t.yayatoh.subscription.delete.operation, 'webhooks:manage');
  }
  shape('n8n.credentials', N8nCredentialsSchema, files.n8nCredentials);
  return problems;
}
