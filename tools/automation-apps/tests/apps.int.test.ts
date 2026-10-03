import { randomBytes } from 'node:crypto';
import { createV1, type V1Deps } from '@yayatoh/api-v1';
import { bearerSessions, createAuth, memoryMailer } from '@yayatoh/auth';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { API_KEY_SCOPES, type ApiKeyScope, createApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateApps, readOpenApi } from '../src/index.ts';

/**
 * M6.5c acceptance: Make and n8n actions can't exceed their API key's scopes or org. Each
 * generated module's request (as Make or n8n would send it from the checked-in definition) goes
 * to the real /v1 app: a key without the module's scope never succeeds (reads: 403); a key of
 * another org, with the connection naming this org, gets 404; a key with just that scope passes
 * the scope check. Trigger subscriptions work with `webhooks:manage` and only with it.
 */

const secret = randomBytes(32).toString('hex');
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer: memoryMailer().mailer });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = {
  ports,
  sessions: () => bearerSessions(auth),
  payments: () => payments,
  telemetry: false,
};
const app = new Hono();
app.route('/v1', createV1(deps));

const { files, model } = generateApps(readOpenApi());
/** Required query fields get a plain value (as a scenario would map them), so reads reach the scope check. */
const query = (opKey: string) => {
  const q = (model.operations.find((o) => o.key === opKey)?.fields ?? [])
    .filter((f) => f.where === 'query' && f.required)
    .map((f) => `${f.name}=test`)
    .join('&');
  return q ? `?${q}` : '';
};
const ID = '00000000-0000-4000-8000-000000000000';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
}, 240_000);
afterAll(closePools);

const key = async (org: OrgFixture, scopes: readonly ApiKeyScope[]) =>
  (
    await executeCommand(
      createApiKeyCommand,
      { name: `Apps ${randomBytes(3).toString('hex')}`, scopes },
      org.ctx(),
      ports,
    )
  ).key;

async function send(method: string, url: string, token: string, body?: unknown) {
  const res = await app.request(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': `apps-${randomBytes(6).toString('hex')}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

/** A request as Make builds it: the connection's base URL and org, then the module's URL. */
function makeRequest(org: string, m: { name: string; communication: { url: string; method?: string } }) {
  const base = files.make.base.baseUrl
    .replace('{{connection.baseUrl}}', '')
    .replace('{{connection.org}}', org);
  return {
    method: m.communication.method ?? 'GET',
    url: base + m.communication.url.replace(/\{\{parameters\.[A-Za-z]+\}\}/g, ID) + query(m.name),
  };
}

/** A request as n8n builds it: requestDefaults.baseURL with the credential, then the routed URL. */
function n8nRequest(org: string, opKey: string) {
  const props = files.n8nNode.description.properties as {
    name: string;
    options?: { value: string; routing?: { request: { method: string; url: string } } }[];
  }[];
  const option = props
    .filter((p) => p.name === 'operation')
    .flatMap((p) => p.options ?? [])
    .find((o) => o.value === opKey);
  if (!option?.routing) throw new Error(`no routing for ${opKey}`);
  const base = files.n8nNode.description.requestDefaults.baseURL
    .replace('={{$credentials.baseUrl}}', '')
    .replace('{{$credentials.org}}', org);
  return {
    method: option.routing.request.method,
    url: base + option.routing.request.url.replace(/^=/, '').replace(/\{\{[^}]+\}\}/g, ID) + query(opKey),
  };
}

describe('Make and n8n actions stay inside their key (M6.5c)', () => {
  it('a key without the module’s scope never succeeds; reads are 403; with only that scope they pass', async () => {
    const actions = files.make.modules.filter((m) => m.typeName !== 'instant_trigger') as unknown as {
      name: string;
      scope: ApiKeyScope;
      communication: { url: string; method?: string };
    }[];
    expect(actions.length).toBeGreaterThanOrEqual(25);
    const without = new Map<string, string>();
    const only = new Map<string, string>();
    for (const m of actions) {
      if (!without.has(m.scope))
        without.set(
          m.scope,
          await key(
            a,
            API_KEY_SCOPES.filter((s) => s !== m.scope),
          ),
        );
      if (!only.has(m.scope)) only.set(m.scope, await key(a, [m.scope]));
      for (const req of [makeRequest(a.org.slug, m), n8nRequest(a.org.slug, m.name)]) {
        const body = req.method === 'GET' ? undefined : {};
        const denied = await send(req.method, req.url, without.get(m.scope) as string, body);
        expect(denied.status, `${m.name} ${req.method} ${req.url} without ${m.scope}`).toBeGreaterThanOrEqual(
          400,
        );
        if (req.method === 'GET') {
          expect(denied.status, `${m.name} without ${m.scope}`).toBe(403);
          const ok = await send(req.method, req.url, only.get(m.scope) as string);
          expect(ok.status, `${m.name} with ${m.scope}`).not.toBe(403);
        }
      }
    }
  });

  it('a connection naming another org gets 404 on every module, even with every scope', async () => {
    const bKey = await key(b, API_KEY_SCOPES);
    for (const m of files.make.modules.filter((x) => x.typeName !== 'instant_trigger') as unknown as {
      name: string;
      communication: { url: string; method?: string };
    }[])
      for (const req of [makeRequest(a.org.slug, m), n8nRequest(a.org.slug, m.name)]) {
        const r = await send(req.method, req.url, bKey, req.method === 'GET' ? undefined : {});
        expect(r.status, `${m.name} ${req.method} ${req.url}`).toBe(404);
      }
  });

  it('trigger subscriptions: subscribe and unsubscribe with webhooks:manage, refused without it or across orgs', async () => {
    const hook = files.make.webhooks.find((w) => w.eventType === 'order.paid');
    if (!hook) throw new Error('no order.paid webhook');
    const url = hook.attach.url
      .replace('{{connection.baseUrl}}', '')
      .replace('{{connection.org}}', a.org.slug);
    const body = { ...hook.attach.body, url: 'https://hook.eu1.make.com/apps-test' };
    const manage = await key(a, ['webhooks:manage']);
    const created = await send('POST', url, manage, body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      eventTypes: ['order.paid'],
      status: 'active',
      description: 'Make: order.paid',
    });
    expect(JSON.stringify(created.body)).not.toMatch(/whsec_/);
    const listed = await send('GET', url, manage);
    expect(((listed.body?.data ?? []) as { id: string }[]).map((e) => e.id)).toContain(created.body?.id);
    expect((await send('POST', url, await key(a, ['events:read']), body)).status).toBe(403);
    expect((await send('GET', url, await key(a, ['events:read']))).status).toBe(403);
    expect((await send('POST', url, await key(b, ['webhooks:manage']), body)).status).toBe(404);
    // An unknown event type, or a URL that is not public https, is refused.
    expect((await send('POST', url, manage, { ...body, eventTypes: ['order.nope'] })).status).toBe(400);
    expect(
      (await send('POST', url, manage, { ...body, url: 'http://localhost/hook' })).status,
    ).toBeGreaterThanOrEqual(400);
    const detach = hook.detach.url
      .replace('{{connection.baseUrl}}', '')
      .replace('{{connection.org}}', a.org.slug)
      .replace('{{webhook.externalHookId}}', String(created.body?.id));
    expect((await send('DELETE', detach, await key(b, ['webhooks:manage']))).status).toBe(404);
    expect((await send('DELETE', detach, manage)).status).toBe(200);
    expect((await send('DELETE', detach, manage)).status).toBe(404);
  });
});
