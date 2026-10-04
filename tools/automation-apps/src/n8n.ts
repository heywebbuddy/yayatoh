import { type AppModel, type Field, type FieldKind, labelOf, type Operation, type Trigger } from './model.ts';

/**
 * The n8n community node (M6.5c), generated from the model as node descriptions: the `yayatohApi`
 * credential (API key, org, base URL; tested with `GET /v1/orgs/{org}/api-key`), the declarative
 * `Yayatoh` node (resource → operation, one per `/v1` operation, routed requests) and the
 * `Yayatoh Trigger` node (a webhook node that subscribes to the chosen event types over `/v1` when
 * the workflow is activated and unsubscribes when it is deactivated: `subscription`). The node
 * package's classes load these files; publishing it to npm is the owner's (owner inbox).
 */

const N8N_TYPE: Record<FieldKind, string> = {
  text: 'string',
  number: 'number',
  boolean: 'boolean',
  datetime: 'dateTime',
  select: 'options',
  text_list: 'string',
  json: 'json',
};

const DEFAULTS: Record<FieldKind, unknown> = {
  text: '',
  number: 0,
  boolean: false,
  datetime: '',
  select: '',
  text_list: '',
  json: '{}',
};

/** The value sent for a field: lists from comma-separated text, JSON fields parsed. */
const sendValue = (kind: FieldKind) =>
  kind === 'text_list'
    ? '={{ String($value).split(",").map((s) => s.trim()).filter(Boolean) }}'
    : kind === 'json'
      ? '={{ typeof $value === "string" ? JSON.parse($value) : $value }}'
      : '={{ $value }}';

function fieldProperty(f: Field, show: Record<string, string[]> | null) {
  return {
    displayName: f.label,
    name: f.name,
    type: N8N_TYPE[f.kind],
    default: f.kind === 'select' ? (f.options?.[0] ?? '') : DEFAULTS[f.kind],
    ...(f.required ? { required: true } : {}),
    ...(f.description ? { description: f.description } : {}),
    ...(f.kind === 'select'
      ? { options: (f.options ?? []).map((v) => ({ name: labelOf(v), value: v })) }
      : {}),
    ...(f.kind === 'text_list' ? { hint: 'Comma-separated' } : {}),
    ...(show ? { displayOptions: { show } } : {}),
    ...(f.where === 'path'
      ? {}
      : {
          routing: {
            send: {
              type: f.where === 'query' ? 'query' : 'body',
              property: f.name,
              value: sendValue(f.kind),
            },
          },
        }),
  };
}

const resourceKey = (r: string) => r.replace(/[^a-z0-9]+/gi, '_').toLowerCase();

function operationOption(o: Operation) {
  const url = `=${o.path.replace(/\{([A-Za-z]+)\}/g, '{{ encodeURIComponent($parameter["$1"]) }}')}`;
  return {
    name: o.label,
    value: o.key,
    action: o.label,
    description: `${o.description.split('\n')[0] ?? ''} Needs the ${o.scope} scope.`.trim(),
    routing: {
      request: {
        method: o.method,
        url,
        ...(o.idempotencyKey
          ? { headers: { 'Idempotency-Key': '={{ $execution.id + "-" + $itemIndex }}' } }
          : {}),
      },
      ...(o.returnsList
        ? { output: { postReceive: [{ type: 'rootProperty', properties: { property: 'data' } }] } }
        : {}),
    },
  };
}

export function n8nCredentials() {
  return {
    name: 'yayatohApi',
    displayName: 'Yayatoh API',
    documentationUrl: 'https://app.yayatoh.com/developers',
    properties: [
      {
        displayName: 'API Key',
        name: 'apiKey',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        description:
          'Create one under Settings → API keys with the scopes your workflow needs (the trigger needs webhooks:manage).',
      },
      { displayName: 'Organization (ID or Slug)', name: 'org', type: 'string', default: '', required: true },
      { displayName: 'Base URL', name: 'baseUrl', type: 'string', default: 'https://app.yayatoh.com/api' },
    ],
    authenticate: {
      type: 'generic',
      properties: { headers: { Authorization: '=Bearer {{$credentials.apiKey}}' } },
    },
    test: {
      request: { baseURL: '={{$credentials.baseUrl}}', url: '=/v1/orgs/{{$credentials.org}}/api-key' },
    },
  };
}

export function n8nNode(model: AppModel, apiVersion: string) {
  const resources = [...new Set(model.operations.map((o) => o.resource))];
  const properties: unknown[] = [
    {
      displayName: 'Resource',
      name: 'resource',
      type: 'options',
      noDataExpression: true,
      options: resources.map((r) => ({ name: labelOf(r), value: resourceKey(r) })),
      default: resourceKey(resources[0] ?? ''),
    },
  ];
  for (const r of resources) {
    const ops = model.operations.filter((o) => o.resource === r);
    properties.push({
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: [resourceKey(r)] } },
      options: ops.map(operationOption),
      default: ops[0]?.key ?? '',
    });
    for (const o of ops) {
      const show = { resource: [resourceKey(r)], operation: [o.key] };
      for (const f of o.fields.filter((x) => x.required)) properties.push(fieldProperty(f, show));
      const optional = o.fields.filter((x) => !x.required);
      if (optional.length)
        properties.push({
          displayName: 'Additional Fields',
          name: 'additionalFields',
          type: 'collection',
          placeholder: 'Add Field',
          default: {},
          displayOptions: { show },
          options: optional.map((f) => fieldProperty(f, null)),
        });
    }
  }
  const description = {
    displayName: 'Yayatoh',
    name: 'yayatoh',
    icon: 'file:yayatoh.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: `Events, orders, attendees and check-in from Yayatoh (generated from /v1 ${apiVersion}).`,
    defaults: { name: 'Yayatoh' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'yayatohApi', required: true }],
    requestDefaults: {
      baseURL: '={{$credentials.baseUrl}}/v1/orgs/{{$credentials.org}}',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    },
    properties,
  };
  // Not part of n8n's description: what each operation calls and the scope it needs (CI checks it).
  const operations = Object.fromEntries(
    model.operations.map((o) => [
      o.key,
      { method: o.method, path: o.fullPath, scope: o.scope, resource: resourceKey(o.resource) },
    ]),
  );
  return { description, yayatoh: { api: apiVersion, operations } };
}

const triggerOption = (t: Trigger) => ({ name: t.label, value: t.type, description: t.description });

export function n8nTrigger(model: AppModel, apiVersion: string) {
  const description = {
    displayName: 'Yayatoh Trigger',
    name: 'yayatohTrigger',
    icon: 'file:yayatoh.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: `Starts the workflow when Yayatoh sends a webhook (generated from /v1 ${apiVersion}).`,
    defaults: { name: 'Yayatoh Trigger' },
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'yayatohApi', required: true }],
    webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: [],
        options: model.triggers.map(triggerOption),
      },
    ],
  };
  return {
    description,
    // Not part of n8n's description: what the node's webhook methods call (create on activation,
    // delete on deactivation) and the scope they need.
    yayatoh: {
      api: apiVersion,
      eventTypes: model.triggers.map((t) => t.type),
      subscription: {
        scope: 'webhooks:manage',
        create: {
          method: 'POST',
          url: '/webhook-endpoints',
          body: { url: '={{$webhookUrl}}', description: 'n8n', eventTypes: '={{$parameter["events"]}}' },
          idField: 'id',
          operation: { method: 'POST', path: '/v1/orgs/{org}/webhook-endpoints' },
        },
        delete: {
          method: 'DELETE',
          url: '/webhook-endpoints/{id}',
          operation: { method: 'DELETE', path: '/v1/orgs/{org}/webhook-endpoints/{endpointId}' },
        },
      },
    },
  };
}
