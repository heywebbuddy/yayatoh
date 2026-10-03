import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createV1 } from '@yayatoh/api-v1';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { ZAPIER_SCOPES, ZAPIER_TRIGGERS } from '@yayatoh/integrations';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { catchUpSubscriber, emitEvents } from '@yayatoh/platform';
import { createApiKeyCommand } from '@yayatoh/tenancy';
import { type OrgFixture, ports, systemCtx, twoOrgs, webhookPublisher } from '@yayatoh/testing';
import { listEndpointsQuery, webhookPublisherSubscriber } from '@yayatoh/webhooks';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * M6.4c: the Zapier app's triggers and actions through Zapier's test harness against the REAL /v1
 * (served on a local port, real Postgres, the fake webhook publisher): the fake API the unit test
 * uses cannot drift from what the app meets in production.
 */

const require = createRequire(import.meta.url);
type Bundle = Record<string, unknown>;
const zapier = require('zapier-platform-core') as {
  createAppTester: (app: unknown) => (fn: never, bundle?: Bundle) => Promise<unknown>;
};
const App = require('../index.js') as Record<string, unknown>;
const tester = zapier.createAppTester(App);
const run = (path: string, bundle?: Bundle) => {
  const fn = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], App);
  if (typeof fn !== 'function') throw new Error(`No function at ${path}`);
  return tester(fn as never, bundle);
};

let a: OrgFixture;
let server: ReturnType<typeof serve>;
let key: string;
const auth = () => ({ apiKey: key, org: a.org.slug });

beforeAll(async () => {
  ({ a } = await twoOrgs());
  key = (
    await executeCommand(createApiKeyCommand, { name: 'Zapier', scopes: [...ZAPIER_SCOPES] }, a.ctx(), ports)
  ).key;
  const secret = 'zapier-int-'.padEnd(64, '0');
  const app = new Hono();
  app.route(
    '/v1',
    createV1({
      ports,
      payments: () => fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' }),
      telemetry: false,
    }),
  );
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((r) => server.once('listening', r));
  process.env.YAYATOH_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180_000);

afterAll(async () => {
  delete process.env.YAYATOH_API_URL;
  await new Promise((r) => server.close(r));
  await closePools();
});

describe('the Zapier app against the real /v1', () => {
  it('authenticates with an org API key and reads its scopes', async () => {
    const info = (await run('authentication.test', { authData: auth() })) as {
      name: string;
      scopes: string[];
    };
    expect(info.name).toBe('Zapier');
    expect([...info.scopes].sort()).toEqual([...ZAPIER_SCOPES].sort());
  });

  it('every trigger subscribes, lists a sample, receives a real delivery and unsubscribes', async () => {
    const subscriber = webhookPublisherSubscriber({ publisher: () => webhookPublisher });
    await catchUpSubscriber(subscriber, a.org.id);
    for (const t of ZAPIER_TRIGGERS) {
      const targetUrl = `https://hooks.example.com/zapier/${t.key}`;
      const sub = (await run(`triggers.${t.key}.operation.performSubscribe`, {
        authData: auth(),
        targetUrl,
      })) as { id: string; event: string };
      expect(sub.event).toBe(t.event);
      const endpoints = await executeQuery(listEndpointsQuery, {}, a.ctx(), ports);
      expect(endpoints.find((e) => e.id === sub.id)).toMatchObject({ url: targetUrl, eventTypes: [t.event] });
      const samples = (await run(`triggers.${t.key}.operation.performList`, { authData: auth() })) as Record<
        string,
        unknown
      >[];
      expect(samples[0]).toMatchObject({ type: t.event });
      if (t.event === 'event.published') {
        await withTenant(systemCtx(a.org.id), (tx) =>
          emitEvents(tx, systemCtx(a.org.id), [
            {
              type: 'event.published',
              version: 1,
              aggregateType: 'event',
              aggregateId: a.event.id,
              payload: { orgId: a.org.id, eventId: a.event.id, from: 'draft', to: 'published' },
            },
          ]),
        );
        await catchUpSubscriber(subscriber, a.org.id);
        const delivered = webhookPublisher.recorded(a.org.id).filter((d) => d.url === targetUrl);
        expect(delivered).toHaveLength(1);
        const records = (await run(`triggers.${t.key}.operation.perform`, {
          authData: auth(),
          cleanedRequest: JSON.parse(delivered[0]?.body ?? '{}'),
        })) as Record<string, unknown>[];
        expect(records).toEqual([
          expect.objectContaining({
            type: 'event.published',
            eventId: a.event.id,
            from: 'draft',
            to: 'published',
          }),
        ]);
        // Thin: ids and facts, never a name or an email.
        expect(JSON.stringify(records)).not.toMatch(/@|name/i);
      }
      await run(`triggers.${t.key}.operation.performUnsubscribe`, { authData: auth(), subscribeData: sub });
      expect((await executeQuery(listEndpointsQuery, {}, a.ctx(), ports)).some((e) => e.id === sub.id)).toBe(
        false,
      );
    }
  });

  it('the event picker, create registration, add contact and check in', async () => {
    const events = (await run('triggers.event_list.operation.perform', { authData: auth() })) as {
      id: string;
    }[];
    expect(events.map((e) => e.id)).toContain(a.event.id);
    const email = `zapier.${Date.now()}@example.com`;
    const reg = (await run('creates.create_registration.operation.perform', {
      authData: auth(),
      inputData: { eventId: a.event.id, name: 'Zapier Person', email, labels: ['zapier'] },
      meta: { zap: { id: 1 } },
    })) as Record<string, unknown>;
    expect(reg).toMatchObject({ eventId: a.event.id, email, source: 'guest', status: 'active' });
    await expect(
      run('creates.create_registration.operation.perform', {
        authData: auth(),
        inputData: { eventId: a.event.id, name: 'Zapier Person', email },
        meta: { zap: { id: 2 } },
      }),
    ).rejects.toThrow(/Already on the guest list/);

    const c1 = (await run('creates.add_contact.operation.perform', {
      authData: auth(),
      inputData: { email, name: 'Zapier Person' },
    })) as { id: string; created: boolean };
    // The registration already made the contact: found, not duplicated.
    expect(c1.created).toBe(false);
    const c2 = (await run('creates.add_contact.operation.perform', {
      authData: auth(),
      inputData: { email: `new.${email}` },
    })) as { id: string; created: boolean };
    expect(c2.created).toBe(true);

    const [ticket] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ short_code: string }>(
        sql`select short_code from ticketing.tickets where event_id = ${a.event.id}::uuid and status = 'active' order by serial limit 1`,
      ),
    );
    const code = ticket?.short_code ?? 'NOPE-0000';
    const verdict = (await run('creates.check_in.operation.perform', {
      authData: auth(),
      inputData: { eventId: a.event.id, code },
      meta: { zap: { id: 3 } },
    })) as { result: string };
    expect(ticket ? ['admitted', 'not_today', 'outside_window', 'duplicate'] : ['invalid']).toContain(
      verdict.result,
    );
    const bogus = (await run('creates.check_in.operation.perform', {
      authData: auth(),
      inputData: { eventId: a.event.id, code: 'ZZZZ-0000' },
    })) as { result: string; ticket: unknown };
    expect(bogus).toMatchObject({ result: 'invalid', ticket: null });
  });

  it('a key without the scopes is refused with a clear message', async () => {
    const narrow = (
      await executeCommand(createApiKeyCommand, { name: 'Narrow', scopes: ['events:read'] }, a.ctx(), ports)
    ).key;
    await expect(
      run('creates.add_contact.operation.perform', {
        authData: { apiKey: narrow, org: a.org.slug },
        inputData: { email: 'x@example.com' },
      }),
    ).rejects.toThrow(/missing a scope/);
    await expect(
      run('authentication.test', { authData: { apiKey: 'yy_live_nope', org: a.org.slug } }),
    ).rejects.toThrow(/unknown, expired or revoked/);
  });
});
