import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { DomainError, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { catchUpSubscriber, consumeEvent, emitEvents } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import {
  configureWebhooks,
  createEndpointCommand,
  deleteEndpointCommand,
  endpointAttemptsQuery,
  getEndpointQuery,
  listEndpointsQuery,
  MAX_ENDPOINTS,
  recoverFailedCommand,
  resendMessageCommand,
  revealEndpointSecretCommand,
  rotateEndpointSecretCommand,
  sendTestCommand,
  THIN_FIELDS,
  updateEndpointCommand,
  verifyWebhook,
  WebhookEnvelopeBase,
  webhookPublisherSubscriber,
  webhooksRuntime,
} from '@yayatoh/webhooks';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type OrgFixture,
  ports,
  staleCtx,
  systemCtx,
  twoOrgs,
  userCtx,
  webhookPublisher,
} from '../src/index.ts';

let a: OrgFixture;
let b: OrgFixture;
beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const subscriber = webhookPublisherSubscriber({ publisher: () => webhookPublisher });

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (isDomainError(err)) return err.code;
    throw err;
  }
};
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (err instanceof DomainError) return String(err.details?.reason ?? err.code);
    throw err;
  }
};

const create = (f: OrgFixture, url: string, eventTypes: string[] = []) =>
  executeCommand(createEndpointCommand, { url, description: 'Receiver', eventTypes }, f.ctx(), ports);

describe('webhook endpoints (M6.3b)', () => {
  it('owners create endpoints; types are checked, deduplicated and sorted', async () => {
    const ep = await create(a, 'https://hooks.example.com/a1', [
      'order.refunded',
      'order.paid',
      'order.paid',
    ]);
    expect(ep).toMatchObject({ status: 'active', eventTypes: ['order.paid', 'order.refunded'] });
    expect(await code(create(a, 'https://hooks.example.com/a2', ['not.an_event']))).toBe('validation_failed');
    expect(await code(create(a, 'https://hooks.example.com/a2', ['webhook.test']))).toBe('validation_failed');
    const list = await executeQuery(listEndpointsQuery, {}, a.ctx(), ports);
    expect(list.map((e) => e.id)).toContain(ep.id);
  });

  it('refuses URLs that are not public https (SSRF)', async () => {
    for (const [url, why] of [
      ['http://hooks.example.com/x', 'scheme'],
      ['https://10.0.0.5/x', 'address'],
      ['https://169.254.169.254/latest', 'address'],
      ['https://localhost/x', 'host'],
      ['https://hooks.example.com:8080/x', 'port'],
      ['https://me:pw@hooks.example.com/x', 'credentials'],
    ] as const)
      expect(await reason(create(a, url)), url).toBe(why);
    // The same check applies when the URL changes.
    const ep = await create(a, 'https://hooks.example.com/change');
    expect(
      await reason(
        executeCommand(
          updateEndpointCommand,
          { endpointId: ep.id, url: 'https://127.0.0.1/x' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('address');
  });

  it('only owners and admins manage webhooks', async () => {
    const managerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: managerId, role: 'manager' }, a.ctx(), ports);
    for (const userId of [a.viewerId, managerId]) {
      const ctx = userCtx(userId, a.org.id);
      expect(await code(executeQuery(listEndpointsQuery, {}, ctx, ports))).toBe('forbidden');
      expect(
        await code(executeCommand(createEndpointCommand, { url: 'https://hooks.example.com/v' }, ctx, ports)),
      ).toBe('forbidden');
    }
  });

  it('isolation: another org cannot see, change, test, reveal or delete an endpoint', async () => {
    const ep = await create(a, 'https://hooks.example.com/iso');
    const ctxB = b.ctx();
    expect((await executeQuery(listEndpointsQuery, {}, ctxB, ports)).map((e) => e.id)).not.toContain(ep.id);
    const id = { endpointId: ep.id };
    expect(await code(executeQuery(getEndpointQuery, id, ctxB, ports))).toBe('not_found');
    expect(await code(executeQuery(endpointAttemptsQuery, id, ctxB, ports))).toBe('not_found');
    expect(await code(executeCommand(updateEndpointCommand, { ...id, enabled: false }, ctxB, ports))).toBe(
      'not_found',
    );
    expect(await code(executeCommand(revealEndpointSecretCommand, id, ctxB, ports))).toBe('not_found');
    expect(await code(executeCommand(rotateEndpointSecretCommand, id, ctxB, ports))).toBe('not_found');
    expect(await code(executeCommand(sendTestCommand, id, ctxB, ports))).toBe('not_found');
    expect(await code(executeCommand(deleteEndpointCommand, id, ctxB, ports))).toBe('not_found');
    // The rows themselves: B's tenant transaction sees none of A's.
    const rows = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from webhooks.endpoints where org_id = ${a.org.id}`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
    expect((await executeQuery(getEndpointQuery, id, a.ctx(), ports)).status).toBe('active');
  });

  it('test send: a signed webhook.test reaches that endpoint only and shows in its deliveries', async () => {
    const ep = await create(a, 'https://hooks.example.com/test-send', ['order.paid']);
    const other = await create(a, 'https://hooks.example.com/other');
    const before = webhookPublisher.recorded(a.org.id).length;
    const { messageId } = await executeCommand(sendTestCommand, { endpointId: ep.id }, a.ctx(), ports);
    const sent = webhookPublisher.recorded(a.org.id).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('https://hooks.example.com/test-send');
    const body = JSON.parse(sent[0]?.body as string);
    expect(body).toMatchObject({
      type: 'webhook.test',
      version: 1,
      orgId: a.org.id,
      data: { endpointId: ep.id, test: true },
    });
    expect(WebhookEnvelopeBase.safeParse(body).success).toBe(true);
    const { secret } = await executeCommand(
      revealEndpointSecretCommand,
      { endpointId: ep.id },
      a.ctx(),
      ports,
    );
    const d = sent[0];
    if (!d) throw new Error('no delivery');
    expect(() =>
      verifyWebhook(secret, { ...d.headers }, d.body, Number(d.headers['webhook-timestamp'])),
    ).not.toThrow();
    const attempts = await executeQuery(endpointAttemptsQuery, { endpointId: ep.id }, a.ctx(), ports);
    expect(attempts[0]).toMatchObject({
      messageId,
      eventType: 'webhook.test',
      status: 'succeeded',
      responseStatus: 200,
    });
    expect(await executeQuery(endpointAttemptsQuery, { endpointId: other.id }, a.ctx(), ports)).toEqual([]);
    // Any catalog type can be sent with its documented example.
    await executeCommand(sendTestCommand, { endpointId: ep.id, eventType: 'order.refunded' }, a.ctx(), ports);
    expect(JSON.parse(webhookPublisher.recorded(a.org.id).at(-1)?.body as string).type).toBe(
      'order.refunded',
    );
    expect(
      await code(executeCommand(sendTestCommand, { endpointId: ep.id, eventType: 'nope.x' }, a.ctx(), ports)),
    ).toBe('validation_failed');
  });

  it('rotating the secret needs step-up; the old one still verifies alongside the new one', async () => {
    const ep = await create(a, 'https://hooks.example.com/rotate');
    const id = { endpointId: ep.id };
    const old = (await executeCommand(revealEndpointSecretCommand, id, a.ctx(), ports)).secret;
    expect(await code(executeCommand(rotateEndpointSecretCommand, id, staleCtx(a.ctx()), ports))).toBe(
      'step_up_required',
    );
    await executeCommand(rotateEndpointSecretCommand, id, a.ctx(), ports);
    const fresh = (await executeCommand(revealEndpointSecretCommand, id, a.ctx(), ports)).secret;
    expect(fresh).not.toBe(old);
    await executeCommand(sendTestCommand, id, a.ctx(), ports);
    const d = webhookPublisher.recorded(a.org.id).at(-1);
    if (!d) throw new Error('no delivery');
    const ts = Number(d.headers['webhook-timestamp']);
    expect(() => verifyWebhook(fresh, { ...d.headers }, d.body, ts)).not.toThrow();
    expect(() => verifyWebhook(old, { ...d.headers }, d.body, ts)).not.toThrow();
  });

  it('replay: a failed delivery is resent once the URL is fixed; recovery resends failures since a time', async () => {
    const ep = await create(a, 'https://hooks.example.com/fail/here');
    const id = { endpointId: ep.id };
    await executeCommand(sendTestCommand, id, a.ctx(), ports);
    const [failed] = await executeQuery(endpointAttemptsQuery, id, a.ctx(), ports);
    expect(failed).toMatchObject({ status: 'failed', responseStatus: 503 });
    await executeCommand(
      updateEndpointCommand,
      { ...id, url: 'https://hooks.example.com/fixed' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      resendMessageCommand,
      { ...id, messageId: failed?.messageId as string },
      a.ctx(),
      ports,
    );
    const [resent] = await executeQuery(endpointAttemptsQuery, id, a.ctx(), ports);
    expect(resent).toMatchObject({ status: 'succeeded', trigger: 'manual', messageId: failed?.messageId });
    await executeCommand(
      recoverFailedCommand,
      { ...id, since: new Date(Date.now() - 3600_000) },
      a.ctx(),
      ports,
    );
    expect(
      await code(
        executeCommand(
          recoverFailedCommand,
          { ...id, since: new Date(Date.now() - 30 * 86_400_000) },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed');
    expect(
      await code(
        executeCommand(resendMessageCommand, { ...id, messageId: 'msg_doesnotexist' }, a.ctx(), ports),
      ),
    ).toBe('not_found');
  });

  it('disable, enable and delete; the audit log names the host, never the URL path', async () => {
    const ep = await create(a, 'https://hooks.example.com/secret-token-in-path');
    const off = await executeCommand(
      updateEndpointCommand,
      { endpointId: ep.id, enabled: false },
      a.ctx(),
      ports,
    );
    expect(off.status).toBe('disabled');
    const on = await executeCommand(
      updateEndpointCommand,
      { endpointId: ep.id, enabled: true },
      a.ctx(),
      ports,
    );
    expect(on.status).toBe('active');
    await executeCommand(deleteEndpointCommand, { endpointId: ep.id }, a.ctx(), ports);
    expect(await code(executeQuery(getEndpointQuery, { endpointId: ep.id }, a.ctx(), ports))).toBe(
      'not_found',
    );
    const audit = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ action: string; data: unknown }>(
        sql`select action, data from platform.audit_events where target_id = ${ep.id} order by seq`,
      ),
    );
    expect(audit.map((r) => r.action)).toEqual([
      'webhooks.endpoint.create',
      'webhooks.endpoint.update',
      'webhooks.endpoint.update',
      'webhooks.endpoint.delete',
    ]);
    expect(JSON.stringify(audit)).not.toContain('secret-token-in-path');
    expect(JSON.stringify(audit)).toContain('hooks.example.com');
  });

  it(`at most ${MAX_ENDPOINTS} endpoints per org`, async () => {
    const { b: fresh } = await twoOrgs();
    const existing = (await executeQuery(listEndpointsQuery, {}, fresh.ctx(), ports)).length;
    for (let i = existing; i < MAX_ENDPOINTS; i++) await create(fresh, `https://hooks.example.com/n${i}`);
    expect(await reason(create(fresh, 'https://hooks.example.com/one-too-many'))).toBe('endpoint_limit');
  });

  it('without the api_access module, webhooks are refused', async () => {
    const { b: off } = await twoOrgs();
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'api_access', effect: 'revoke', reason: 'test' },
      systemCtx(off.org.id),
      ports,
    );
    expect(await code(executeQuery(listEndpointsQuery, {}, off.ctx(), ports))).toBe('module_not_enabled');
  });

  it('with no publisher configured (production without Svix), commands say so', async () => {
    const saved = webhooksRuntime();
    configureWebhooks({ ...saved, publisher: null });
    try {
      expect(await reason(create(a, 'https://hooks.example.com/none'))).toBe('webhooks_unavailable');
    } finally {
      configureWebhooks(saved);
    }
  });
});

describe('outbox → webhooks (M6.3b)', () => {
  it('publishes public events to subscribed endpoints, thin and signed; skips internal and replayed ones', async () => {
    const { a: org } = await twoOrgs();
    const all = await create(org, 'https://hooks.example.com/all');
    const lifecycle = await create(org, 'https://hooks.example.com/lifecycle', ['event.published']);
    const before = webhookPublisher.recorded(org.org.id).length;
    const ev = await executeCommand(
      createEventCommand,
      {
        name: 'Webhook Night',
        timezone: 'America/Chicago',
        startsAt: '2031-05-01T23:00:00Z',
        endsAt: '2031-05-02T02:00:00Z',
      },
      org.ctx(),
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
    // A backfilled event (legacy migration) is history, never a webhook.
    await withTenant(systemCtx(org.org.id), (tx) =>
      emitEvents(
        tx,
        systemCtx(org.org.id),
        [
          {
            type: 'event.updated',
            version: 1,
            aggregateType: 'event',
            aggregateId: ev.id,
            payload: { orgId: org.org.id, eventId: ev.id, fields: ['name'] },
          },
        ],
        { replayed: true },
      ),
    );
    await catchUpSubscriber(subscriber, org.org.id);
    // Exactly once: a second catch-up sends nothing more.
    const afterFirst = webhookPublisher.recorded(org.org.id).length;
    await catchUpSubscriber(subscriber, org.org.id);
    expect(webhookPublisher.recorded(org.org.id).length).toBe(afterFirst);

    const sent = webhookPublisher.recorded(org.org.id).slice(before);
    const bodies = sent.map((d) => ({ url: d.url, body: JSON.parse(d.body) }));
    const toAll = bodies.filter((d) => d.url.endsWith('/all')).map((d) => d.body);
    const created = toAll.find((x) => x.type === 'event.created' && x.data.eventId === ev.id);
    expect(created).toMatchObject({
      version: 1,
      apiVersion: 'v1',
      orgId: org.org.id,
      data: { eventId: ev.id, profile: expect.any(String) },
    });
    expect(toAll.find((x) => x.type === 'event.published' && x.data.eventId === ev.id)?.data).toEqual({
      eventId: ev.id,
      from: 'draft',
      to: 'published',
    });
    expect(toAll.some((x) => x.type === 'event.updated' && x.data.eventId === ev.id)).toBe(false);
    // Internal events (organization.created, membership.added…) never leave.
    expect(toAll.some((x) => x.type.startsWith('organization.') || x.type.startsWith('membership.'))).toBe(
      false,
    );
    const toLifecycle = bodies.filter((d) => d.url.endsWith('/lifecycle')).map((d) => d.body.type);
    expect(new Set(toLifecycle)).toEqual(new Set(['event.published']));
    // Signed with the endpoint's secret.
    const { secret } = await executeCommand(
      revealEndpointSecretCommand,
      { endpointId: all.id },
      org.ctx(),
      ports,
    );
    for (const d of sent.filter((x) => x.url.endsWith('/all')))
      expect(() =>
        verifyWebhook(secret, { ...d.headers }, d.body, Number(d.headers['webhook-timestamp'])),
      ).not.toThrow();
    expect(lifecycle.id).toBeTruthy();
  });

  it('leak canary: the fixture org’s whole history publishes no personal data', async () => {
    const { a: org } = await twoOrgs();
    // The fixture's own orders, guests, forms, surveys, reviews… all go to one all-types endpoint.
    await create(org, 'https://hooks.example.com/canary');
    // Plus events whose internal payloads would carry a person's details if they were public.
    await withTenant(systemCtx(org.org.id), (tx) =>
      emitEvents(tx, systemCtx(org.org.id), [
        {
          type: 'order.paid',
          version: 1,
          aggregateType: 'order',
          aggregateId: org.event.id,
          payload: {
            orgId: org.org.id,
            orderId: uuidv7(),
            eventId: org.event.id,
            totalMinor: 100,
            currency: 'USD',
            via: 'fake',
            buyerEmail: 'canary.buyer@leak.example',
            buyerName: 'Canary Buyer',
          },
        },
        {
          type: 'form.registration_submitted',
          version: 1,
          aggregateType: 'form_respondent',
          aggregateId: org.event.id,
          payload: {
            orgId: org.org.id,
            respondentId: uuidv7(),
            eventId: org.event.id,
            registrationTypeId: null,
            version: 1,
            answers: { name: 'Canary Registrant', phone: '+15555550199' },
          },
        },
      ]),
    );
    const before = webhookPublisher.recorded(org.org.id).length;
    await catchUpSubscriber(subscriber, org.org.id);
    const sent = webhookPublisher.recorded(org.org.id).slice(before);
    expect(sent.length).toBeGreaterThan(5);
    for (const d of sent) {
      expect(d.body).not.toMatch(/@|Canary|\+1555|__CANARY/);
      const body = JSON.parse(d.body);
      for (const k of Object.keys(body.data))
        expect(THIN_FIELDS as readonly string[], `${body.type}.${k}`).toContain(k);
    }
    expect(new Set(sent.map((d) => JSON.parse(d.body).type)).size).toBeGreaterThan(3);
  });

  it('an org with no active endpoint sends nothing', async () => {
    const { a: quiet } = await twoOrgs();
    for (const e of await executeQuery(listEndpointsQuery, {}, quiet.ctx(), ports))
      await executeCommand(updateEndpointCommand, { endpointId: e.id, enabled: false }, quiet.ctx(), ports);
    const before = webhookPublisher.recorded(quiet.org.id).length;
    await catchUpSubscriber(subscriber, quiet.org.id);
    expect(webhookPublisher.recorded(quiet.org.id).length).toBe(before);
  });

  it('a public event whose payload does not fit its schema is not sent (the relay retries it)', async () => {
    const { a: org } = await twoOrgs();
    await create(org, 'https://hooks.example.com/strict');
    const [row] = await withTenant(systemCtx(org.org.id), async (tx) => {
      await emitEvents(tx, systemCtx(org.org.id), [
        {
          type: 'order.paid',
          version: 1,
          aggregateType: 'order',
          aggregateId: org.event.id,
          payload: {
            orgId: org.org.id,
            orderId: 'not-a-uuid',
            eventId: org.event.id,
            totalMinor: 1,
            currency: 'USD',
            via: 'fake',
          },
        },
      ]);
      return tx.execute<{ id: string }>(
        sql`select id from platform.domain_events where type = 'order.paid' and payload->>'orderId' = 'not-a-uuid'`,
      );
    });
    const before = webhookPublisher.recorded(org.org.id).length;
    await expect(
      consumeEvent(subscriber, {
        id: row?.id as string,
        orgId: org.org.id,
        type: 'order.paid',
        version: 1,
        aggregateType: 'order',
        aggregateId: org.event.id,
        payload: { orgId: org.org.id, orderId: 'not-a-uuid' },
        logSeq: 0,
      }),
    ).rejects.toThrow();
    expect(webhookPublisher.recorded(org.org.id).length).toBe(before);
  });
});
