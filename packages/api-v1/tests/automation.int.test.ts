import { randomBytes } from 'node:crypto';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { catchUpSubscriber, emitEvents } from '@yayatoh/platform';
import { type ApiKeyScope, createApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs, webhookPublisher } from '@yayatoh/testing';
import {
  createEndpointCommand,
  listEndpointsQuery,
  listRestHooksQuery,
  webhookPublisherSubscriber,
} from '@yayatoh/webhooks';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, type V1Deps } from '../src/index.ts';

/**
 * M6.4c /v1 automation routes (what the Zapier app calls): REST hooks (subscribe, deliveries,
 * unsubscribe, samples), add contact and create registration, with scopes, idempotency and
 * isolation, on real Postgres and the fake webhook publisher.
 */

const secret = randomBytes(32).toString('hex');
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const deps: V1Deps = { ports, payments: () => payments, telemetry: false };
const app = new Hono();
app.route('/v1', createV1(deps));

type Json = Record<string, unknown>;
async function call(method: string, path: string, token?: string, body?: unknown, idem = true) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(idem && method !== 'GET' && method !== 'DELETE'
        ? { 'idempotency-key': `k-${randomBytes(8).toString('hex')}` }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
}
const key = async (org: OrgFixture, scopes: readonly ApiKeyScope[]) =>
  (
    await executeCommand(
      createApiKeyCommand,
      { name: `Zapier ${randomBytes(3).toString('hex')}`, scopes },
      org.ctx(),
      ports,
    )
  ).key;

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

describe('REST hooks (M6.4c)', () => {
  it('subscribe, receive the signed thin delivery, unsubscribe', async () => {
    const subscriber = webhookPublisherSubscriber({ publisher: () => webhookPublisher });
    // Whatever the fixture already emitted is handed over first (a running worker would have).
    await catchUpSubscriber(subscriber, a.org.id);
    const k = await key(a, ['webhooks:subscribe']);
    const url = `https://hooks.example.com/zapier/${randomBytes(4).toString('hex')}`;
    const sub = await call('POST', `/orgs/${a.org.slug}/hooks`, k, { url, event: 'event.updated' });
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({ event: 'event.updated' });
    const hookId = String(sub.body.id);
    // It is an endpoint like any other (Settings → Webhooks lists it), marked as a REST hook.
    const endpoints = await executeQuery(listEndpointsQuery, {}, a.ctx(), ports);
    expect(endpoints.find((e) => e.id === hookId)).toMatchObject({ eventTypes: ['event.updated'], url });
    const hooks = await executeQuery(listRestHooksQuery, {}, a.ctx(), ports);
    expect(hooks.find((h) => h.id === hookId)).toMatchObject({
      host: 'hooks.example.com',
      event: 'event.updated',
    });

    await withTenant(systemCtx(a.org.id), (tx) =>
      emitEvents(tx, systemCtx(a.org.id), [
        {
          type: 'event.updated',
          version: 1,
          aggregateType: 'event',
          aggregateId: a.event.id,
          payload: { orgId: a.org.id, eventId: a.event.id, fields: ['name'] },
        },
      ]),
    );
    await catchUpSubscriber(subscriber, a.org.id);
    const delivered = webhookPublisher.recorded(a.org.id).filter((d) => d.url === url);
    expect(delivered).toHaveLength(1);
    const msg = JSON.parse(delivered[0]?.body ?? '{}') as Json;
    expect(msg).toMatchObject({ type: 'event.updated', orgId: a.org.id, data: { eventId: a.event.id } });

    expect((await call('DELETE', `/orgs/${a.org.slug}/hooks/${hookId}`, k)).status).toBe(204);
    // Unsubscribing twice is fine (Zapier retries); the hook is gone everywhere.
    expect((await call('DELETE', `/orgs/${a.org.slug}/hooks/${hookId}`, k)).status).toBe(204);
    expect((await executeQuery(listEndpointsQuery, {}, a.ctx(), ports)).some((e) => e.id === hookId)).toBe(
      false,
    );
  });

  it('samples have the delivery’s shape; unknown or internal types are refused', async () => {
    const k = await key(a, ['webhooks:subscribe']);
    const s = await call('GET', `/orgs/${a.org.slug}/hooks/samples?event=order.paid`, k);
    expect(s.status).toBe(200);
    const [sample] = s.body.data as Json[];
    expect(sample).toMatchObject({ type: 'order.paid', version: 1 });
    expect(Object.keys((sample?.data ?? {}) as Json)).toEqual(expect.arrayContaining(['orderId', 'eventId']));
    expect((await call('GET', `/orgs/${a.org.slug}/hooks/samples?event=nope.nope`, k)).status).toBe(400);
    const bad = await call('POST', `/orgs/${a.org.slug}/hooks`, k, {
      url: 'https://hooks.example.com/x',
      event: 'webhook.test',
    });
    expect(bad.status).toBe(400);
    const ssrf = await call('POST', `/orgs/${a.org.slug}/hooks`, k, {
      url: 'https://127.0.0.1/x',
      event: 'order.paid',
    });
    expect(ssrf.status).toBe(400);
  });

  it('needs the scope; a hook can only remove hooks, and only its own org’s', async () => {
    const none = await key(a, ['events:read']);
    expect(
      (
        await call('POST', `/orgs/${a.org.slug}/hooks`, none, {
          url: 'https://hooks.example.com/n',
          event: 'order.paid',
        })
      ).status,
    ).toBe(403);
    expect((await call('GET', `/orgs/${a.org.slug}/hooks/samples?event=order.paid`, a.testKey)).status).toBe(
      403,
    );
    const ka = await key(a, ['webhooks:subscribe']);
    const kb = await key(b, ['webhooks:subscribe']);
    // The organizer's own endpoint cannot be removed through /v1 hooks.
    const own = await executeCommand(
      createEndpointCommand,
      { url: 'https://hooks.example.com/own', description: 'Mine', eventTypes: [] },
      a.ctx(),
      ports,
    );
    expect((await call('DELETE', `/orgs/${a.org.slug}/hooks/${own.id}`, ka)).status).toBe(404);
    // b's hook is invisible to a's key: "already gone" for a, still there for b.
    const hb = await call('POST', `/orgs/${b.org.slug}/hooks`, kb, {
      url: 'https://hooks.example.com/b',
      event: 'order.paid',
    });
    expect((await call('DELETE', `/orgs/${a.org.slug}/hooks/${hb.body.id}`, ka)).status).toBe(204);
    expect(
      (await executeQuery(listEndpointsQuery, {}, b.ctx(), ports)).some((e) => e.id === hb.body.id),
    ).toBe(true);
    // A key works in its own org only.
    expect(
      (
        await call('POST', `/orgs/${b.org.slug}/hooks`, ka, {
          url: 'https://hooks.example.com/x',
          event: 'order.paid',
        })
      ).status,
    ).toBe(404);
  });
});

describe('add contact and create registration (M6.4c)', () => {
  it('adds a contact once (the same email again finds it), with scope and validation', async () => {
    const k = await key(a, ['contacts:write']);
    const email = `zap.${randomBytes(3).toString('hex')}@example.com`;
    const first = await call('POST', `/orgs/${a.org.slug}/contacts`, k, { email, name: 'Zap Person' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: true });
    const again = await call('POST', `/orgs/${a.org.slug}/contacts`, k, { email: email.toUpperCase() });
    expect(again.body).toMatchObject({ id: first.body.id, created: false });
    expect(Object.keys(again.body).sort()).toEqual(['created', 'id']);
    expect((await call('POST', `/orgs/${a.org.slug}/contacts`, k, { email: 'not-an-email' })).status).toBe(
      400,
    );
    expect((await call('POST', `/orgs/${a.org.slug}/contacts`, k, { email }, false)).status).toBe(400);
    expect(
      (await call('POST', `/orgs/${a.org.slug}/contacts`, await key(a, ['attendees:write']), { email }))
        .status,
    ).toBe(403);
    // Replaying with the same Idempotency-Key returns the stored answer.
    const idem = { 'idempotency-key': `idem-${randomBytes(6).toString('hex')}` };
    const r1 = await app.request(`/v1/orgs/${a.org.slug}/contacts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json', ...idem },
      body: JSON.stringify({ email: `idem.${email}` }),
    });
    const r2 = await app.request(`/v1/orgs/${a.org.slug}/contacts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json', ...idem },
      body: JSON.stringify({ email: `idem.${email}` }),
    });
    expect(await r2.json()).toEqual(await r1.json());
  });

  it('registers someone on the guest list; a second time is a conflict; other orgs’ events are not found', async () => {
    const k = await key(a, ['attendees:write']);
    const email = `reg.${randomBytes(3).toString('hex')}@example.com`;
    const r = await call('POST', `/orgs/${a.org.slug}/events/${a.event.id}/registrations`, k, {
      name: 'Grace Hopper',
      email,
      labels: ['zapier'],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      eventId: a.event.id,
      name: 'Grace Hopper',
      email,
      source: 'guest',
      labels: ['zapier'],
    });
    expect(
      (await call('POST', `/orgs/${a.org.slug}/events/${a.event.id}/registrations`, k, { name: 'G', email }))
        .status,
    ).toBe(409);
    expect(
      (
        await call('POST', `/orgs/${a.org.slug}/events/${b.event.id}/registrations`, k, {
          name: 'G',
          email: `x.${email}`,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          'POST',
          `/orgs/${a.org.slug}/events/${a.event.id}/registrations`,
          await key(a, ['attendees:read']),
          { name: 'G', email: `y.${email}` },
        )
      ).status,
    ).toBe(403);
  });
});
