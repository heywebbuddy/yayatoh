import type { AppModel, Field, FieldKind, Operation, Trigger } from './model.ts';

/**
 * The Make custom app (M6.5c), generated from the model: one API-key connection (key, org, base
 * URL; tested with `GET /v1/orgs/{org}/api-key`), an instant trigger per webhook event type (a
 * dedicated webhook that subscribes itself over `/v1` when the scenario is turned on and
 * unsubscribes when it is turned off), and an action or search per `/v1` operation. Written as one
 * JSON bundle in Make's app-definition shape (base, connections, webhooks, modules with IML
 * communication); the owner imports it into Make's app editor (owner inbox).
 */

export const MAKE_APP_NAME = 'yayatoh';
const CONNECTION = 'yayatoh';
const API = '{{connection.baseUrl}}/v1/orgs/{{connection.org}}';
const AUTH = { authorization: 'Bearer {{connection.apiKey}}' };
/** Make retries a failed bundle with a new request; the key is per request (IML `uuid`). */
const IDEMPOTENCY = { 'idempotency-key': '{{uuid}}' };

const MAKE_TYPE: Record<FieldKind, string> = {
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  datetime: 'date',
  select: 'select',
  text_list: 'array',
  json: 'any',
};

function parameter(f: Field) {
  return {
    name: f.name,
    label: f.label,
    type: MAKE_TYPE[f.kind],
    required: f.required,
    ...(f.description ? { help: f.description } : {}),
    ...(f.kind === 'select' ? { options: (f.options ?? []).map((v) => ({ label: v, value: v })) } : {}),
    ...(f.kind === 'text_list' ? { spec: { type: 'text' } } : {}),
  };
}

const iml = (names: readonly string[]) => names.map((n) => `'${n}'`).join(', ');

function operationModule(o: Operation) {
  const inQuery = o.fields.filter((f) => f.where === 'query').map((f) => f.name);
  const inBody = o.fields.filter((f) => f.where === 'body').map((f) => f.name);
  const url = o.path.replace(/\{([A-Za-z]+)\}/g, '{{parameters.$1}}');
  const communication: Record<string, unknown> = {
    url,
    method: o.method,
    ...(o.idempotencyKey ? { headers: IDEMPOTENCY } : {}),
    ...(inQuery.length ? { qs: `{{pick(parameters, ${iml(inQuery)})}}` } : {}),
    ...(inBody.length ? { body: `{{pick(parameters, ${iml(inBody)})}}` } : {}),
    response: o.returnsList ? { iterate: '{{body.data}}', output: '{{item}}' } : { output: '{{body}}' },
    ...(o.paged
      ? { pagination: { qs: { cursor: '{{body.nextCursor}}' }, condition: '{{body.nextCursor}}' } }
      : {}),
  };
  return {
    name: o.key,
    label: o.label,
    description: o.description.split('\n')[0] ?? '',
    typeName: o.kind,
    connection: CONNECTION,
    scope: o.scope,
    resource: o.resource,
    operation: { method: o.method, path: o.fullPath },
    communication,
    parameters: [],
    expect: o.fields.map(parameter),
  };
}

const webhookName = (t: Trigger) => `${MAKE_APP_NAME}_${t.key}`;

function webhook(t: Trigger) {
  return {
    name: webhookName(t),
    label: t.label,
    type: 'dedicated',
    connection: CONNECTION,
    eventType: t.type,
    attach: {
      url: `${API}/webhook-endpoints`,
      method: 'POST',
      headers: { ...AUTH, ...IDEMPOTENCY },
      body: { url: '{{webhook.url}}', description: `Make: ${t.type}`, eventTypes: [t.type] },
      response: { data: { externalHookId: '{{body.id}}' } },
    },
    detach: {
      url: `${API}/webhook-endpoints/{{webhook.externalHookId}}`,
      method: 'DELETE',
      headers: { ...AUTH, ...IDEMPOTENCY },
    },
  };
}

function triggerModule(t: Trigger) {
  return {
    name: t.key,
    label: `Watch: ${t.label}`,
    description: t.description,
    typeName: 'instant_trigger',
    connection: CONNECTION,
    scope: 'webhooks:manage',
    webhook: webhookName(t),
    eventType: t.type,
    communication: { output: '{{body}}' },
    interface: [
      { name: 'id', label: 'Message id', type: 'text' },
      { name: 'type', label: 'Event type', type: 'text' },
      { name: 'occurredAt', label: 'Occurred at', type: 'date' },
      {
        name: 'data',
        label: 'Data',
        type: 'collection',
        spec: t.fields.map((f) => ({ name: f.name, label: f.label, type: MAKE_TYPE[f.kind] })),
      },
    ],
  };
}

export function makeApp(model: AppModel, apiVersion: string) {
  return {
    $schema: 'yayatoh.make-app/1',
    name: MAKE_APP_NAME,
    label: 'Yayatoh',
    description:
      'Events, orders, attendees and check-in from Yayatoh. Generated from the /v1 OpenAPI document.',
    generatedFrom: { api: apiVersion, operations: model.operations.length, triggers: model.triggers.length },
    base: {
      baseUrl: API,
      headers: { ...AUTH, accept: 'application/json' },
      response: { error: { type: '{{body.code}}', message: '[{{statusCode}}] {{body.detail}}' } },
    },
    connections: [
      {
        name: CONNECTION,
        label: 'Yayatoh API key',
        type: 'basic',
        scopes: model.scopes,
        parameters: [
          {
            name: 'apiKey',
            label: 'API key',
            type: 'password',
            required: true,
            help: 'Create one under Settings → API keys with the scopes your scenario needs (triggers need webhooks:manage).',
          },
          { name: 'org', label: 'Organization (id or slug)', type: 'text', required: true },
          {
            name: 'baseUrl',
            label: 'Base URL',
            type: 'url',
            required: true,
            default: 'https://app.yayatoh.com/api',
            advanced: true,
          },
        ],
        communication: {
          url: '{{parameters.baseUrl}}/v1/orgs/{{parameters.org}}/api-key',
          method: 'GET',
          headers: { authorization: 'Bearer {{parameters.apiKey}}' },
          response: {
            metadata: { type: 'text', value: '{{body.name}} ({{body.prefix}})' },
            error: { message: '[{{statusCode}}] {{body.detail}}' },
          },
        },
      },
    ],
    webhooks: model.triggers.map(webhook),
    modules: [...model.triggers.map(triggerModule), ...model.operations.map(operationModule)],
  };
}

export type MakeApp = ReturnType<typeof makeApp>;
