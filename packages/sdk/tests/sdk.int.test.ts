import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createV1 } from '@yayatoh/api-v1';
import { closePools } from '@yayatoh/db/testing';
import { type OrgFixture, ports, twoOrgs } from '@yayatoh/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createYayatohClient,
  idempotencyKey,
  paginate,
  type Schemas,
  unwrap,
  YayatohApiError,
} from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
let baseUrl: string;
let server: ReturnType<typeof serve>;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const app = new Hono().route(
    '/v1',
    createV1({
      ports,
      payments: () => {
        throw new Error('payments are not used here');
      },
      telemetry: false,
    }),
  );
  // A real HTTP server on a free port: the SDK talks to it over fetch like any client.
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
      baseUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closePools();
});

describe('@yayatoh/sdk against a running /v1', () => {
  it('reads the organization and pages every event with paginate()', async () => {
    const api = createYayatohClient({ baseUrl, token: a.apiKey });
    const org = await unwrap(api.GET('/v1/orgs/{org}', { params: { path: { org: a.org.slug } } }));
    expect(org.slug).toBe(a.org.slug);
    const events: Schemas['Event'][] = [];
    for await (const e of paginate((cursor) =>
      unwrap(
        api.GET('/v1/orgs/{org}/events', {
          params: { path: { org: a.org.slug }, query: { limit: 1, cursor } },
        }),
      ),
    ))
      events.push(e);
    expect(events.map((e) => e.id)).toContain(a.event.id);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
  });

  it('creates an event idempotently: the same key returns the same event', async () => {
    const api = createYayatohClient({ baseUrl, token: () => a.apiKey });
    const key = idempotencyKey();
    const body = {
      name: 'SDK launch',
      timezone: 'Europe/Paris',
      startsAt: '2030-03-01T18:00:00Z',
      endsAt: '2030-03-01T21:00:00Z',
    };
    const create = () =>
      unwrap(
        api.POST('/v1/orgs/{org}/events', {
          params: { path: { org: a.org.slug }, header: { 'idempotency-key': key } },
          body,
        }),
      );
    const first = await create();
    const again = await create();
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'draft', timezone: 'Europe/Paris' });
  });

  it('throws YayatohApiError with the stable code, status and request id', async () => {
    const api = createYayatohClient({ baseUrl, token: a.apiKey });
    const err = await unwrap(api.GET('/v1/orgs/{org}', { params: { path: { org: b.org.slug } } })).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(YayatohApiError);
    expect(err).toMatchObject({ status: 404, code: 'not_found' });
    expect(err.requestId).toMatch(/\S+/);
    const anon = createYayatohClient({ baseUrl });
    await expect(unwrap(anon.GET('/v1/me'))).rejects.toMatchObject({ status: 401, code: 'unauthenticated' });
  });

  it('reads public data without a credential and sends its client header', async () => {
    let seen: string | null = null;
    const api = createYayatohClient({
      baseUrl,
      client: 'ios/3.2.1',
      fetch: (input, init) => {
        seen = new Request(input, init).headers.get('x-yayatoh-client');
        return fetch(input, init);
      },
    });
    const cfg = await unwrap(api.GET('/v1/mobile/config'));
    expect(cfg.minimumVersions.ios).toEqual(expect.any(String));
    expect(seen).toBe('ios/3.2.1');
    const pub = await unwrap(
      api.GET('/v1/public/events/{slug}', { params: { path: { slug: a.event.slug } } }),
    );
    expect(pub.slug).toBe(a.event.slug);
  });

  it('runs a bulk action: start with an Idempotency-Key, poll its status, undo it (M1.13d)', async () => {
    const api = createYayatohClient({ baseUrl, token: a.apiKey });
    const key = idempotencyKey();
    const start = () =>
      unwrap(
        api.POST('/v1/orgs/{org}/events/{eventId}/bulk/labels', {
          params: {
            path: { org: a.org.slug, eventId: a.event.id },
            header: { 'idempotency-key': key },
          },
          body: { selection: { filter: {} }, add: ['sdk'] },
        }),
      );
    const op: Schemas['BulkOperation'] = await start();
    expect(op).toMatchObject({ kind: 'labels', eventId: a.event.id });
    expect(op.total).toBeGreaterThan(0);
    expect((await start()).id).toBe(op.id);
    // Poll until it settles (small jobs are done inline).
    let status = op;
    for (let i = 0; i < 20 && !['done', 'failed'].includes(status.status); i++)
      status = await unwrap(
        api.GET('/v1/orgs/{org}/bulk/{kind}/{operationId}', {
          params: { path: { org: a.org.slug, kind: 'labels', operationId: op.id } },
        }),
      );
    expect(status).toMatchObject({ status: 'done', processed: op.total, failed: 0 });
    expect(status.undoUntil).toEqual(expect.any(String));
    const undone = await unwrap(
      api.POST('/v1/orgs/{org}/bulk/{kind}/{operationId}/undo', {
        params: {
          path: { org: a.org.slug, kind: 'labels', operationId: op.id },
          header: { 'idempotency-key': idempotencyKey() },
        },
      }),
    );
    expect(undone.status).toBe('undone');
    // Another org's key can't see it.
    const other = createYayatohClient({ baseUrl, token: b.apiKey });
    await expect(
      unwrap(
        other.GET('/v1/orgs/{org}/bulk/{kind}/{operationId}', {
          params: { path: { org: b.org.slug, kind: 'labels', operationId: op.id } },
        }),
      ),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
  });
});
