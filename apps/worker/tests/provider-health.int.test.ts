import { withoutTenant, withTenant } from '@yayatoh/db';
import { databaseAuditSink, setPlatformAuditSink, withPlatformReader } from '@yayatoh/db/platform';
import { closePools } from '@yayatoh/db/testing';
import {
  createNotifier,
  dispatchDue,
  fakeDeliveryAdapter,
  fakeWebhookAdapter,
  handleProviderWebhook,
  memoryTransports,
  providerHealthTx,
  signFakeDeliveryEvents,
} from '@yayatoh/notifications';
import { type OrgFixture, ports, systemCtx, twoOrgs } from '@yayatoh/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Provider health (M3.5b) as apps/admin reads it: counters written by the dispatcher and the
 * webhook pipeline (a SECURITY DEFINER function; app_user has no other access), read through
 * platform_reader with the read in the access log; config checked by name only.
 */
let a: OrgFixture;
const STAFF = 'staff:01900000-0000-7000-8000-00000000cafe';
const ORIGIN = 'https://app.yayatoh.test';
const read = (env: Record<string, string | undefined>, reason = `test: provider health ${Date.now()}`) =>
  withPlatformReader({ actor: STAFF, reason }, (tx) => providerHealthTx(tx, env));

beforeAll(async () => {
  setPlatformAuditSink(databaseAuditSink);
  ({ a } = await twoOrgs());
});
afterAll(closePools);

describe('provider health', () => {
  it('counts sends, send errors, verified and refused webhooks; logs the read', async () => {
    const before = (await read({})).find((r) => r.provider === 'memory');
    const notifier = createNotifier();
    const key = `health-${Date.now()}`;
    await withTenant(systemCtx(a.org.id), (tx) =>
      notifier.enqueue(tx, {
        kind: 'orders.tickets',
        to: { email: `health-${Date.now()}@example.test`, phone: '+13125550777' },
        params: { url: `${ORIGIN}/o`, name: 'Rae', eventName: 'Night', count: 1 },
        dedupeKey: key,
        channels: ['email', 'whatsapp'],
      }),
    );
    const mem = memoryTransports();
    mem.notOnWhatsApp.add('+13125550777');
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    const secret = 'synthetic-fake-secret';
    const adapter = fakeWebhookAdapter(fakeDeliveryAdapter(secret));
    const signed = signFakeDeliveryEvents(secret, [
      { type: 'delivered', messageId: '0190f3a2-7c1d-7e55-9a4b-5d2c3e4f5a6b' },
    ]);
    const ok = await handleProviderWebhook(
      adapter,
      {
        rawBody: signed.body,
        headers: new Headers({ 'x-fake-email-signature': signed.signature }),
        url: ORIGIN,
      },
      ports,
    );
    expect(ok.ok).toBe(true);
    const forged = await handleProviderWebhook(
      adapter,
      { rawBody: signed.body, headers: new Headers({ 'x-fake-email-signature': 't=1,v1=00' }), url: ORIGIN },
      ports,
    );
    expect(forged).toEqual({ ok: false, failure: 'malformed' });

    const reason = `test: provider health read ${Date.now()}`;
    const rows = await read({}, reason);
    const memory = rows.find((r) => r.provider === 'memory');
    expect(memory?.sends24h).toBeGreaterThanOrEqual((before?.sends24h ?? 0) + 1);
    expect(memory?.sendErrors24h).toBeGreaterThanOrEqual((before?.sendErrors24h ?? 0) + 1);
    expect(memory?.lastError).toMatch(/^(not_on_channel 131026|error|webhook \w+)$/);
    const fake = rows.find((r) => r.provider === 'fake');
    expect(fake).toMatchObject({ real: false, mode: 'fake' });
    expect(fake?.webhooks24h).toBeGreaterThanOrEqual(1);
    expect(fake?.webhooksRejected24h).toBeGreaterThanOrEqual(1);
    expect(fake?.lastWebhookAt).toBeInstanceOf(Date);
    // The four real providers are always listed; unconfigured here.
    expect(rows.slice(0, 4).map((r) => [r.provider, r.mode])).toEqual([
      ['ses', 'off'],
      ['twilio', 'off'],
      ['whatsapp_cloud', 'off'],
      ['whatsapp_gateway', 'off'],
    ]);
    const log = await withPlatformReader({ actor: STAFF, reason: 'test: check the access log' }, (tx) =>
      tx.execute<{ actor: string }>(sql`select actor from platform.access_log where reason = ${reason}`),
    );
    expect([...log].map((r) => r.actor)).toEqual([STAFF]);
  });

  it('the checklist follows config names, the webhook and the switch', async () => {
    const env = {
      SMS_PROVIDER: 'twilio',
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_API_KEY_SID: 'SK1',
      TWILIO_API_KEY_SECRET: 's',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_MESSAGING_SERVICE_SID: 'MG1',
      WHATSAPP_GATEWAY_URL: 'https://gateway.test',
    };
    const rows = await read(env);
    const twilio = rows.find((r) => r.provider === 'twilio');
    expect(twilio).toMatchObject({ mode: 'live', missing: [] });
    expect(twilio?.checklist.map((c) => [c.id, c.done])).toEqual([
      ['twilio.registration', null],
      ['twilio.service', null],
      ['env', true],
      // Done once a verified Twilio webhook arrived (other suites may have sent one already).
      ['twilio.webhook', twilio?.lastWebhookAt !== null],
      ['twilio.switch', true],
    ]);
    const gateway = rows.find((r) => r.provider === 'whatsapp_gateway');
    expect(gateway).toMatchObject({
      mode: 'off',
      missing: ['WHATSAPP_GATEWAY_KEY_ID', 'WHATSAPP_GATEWAY_SECRET'],
    });
    // Names only: no config value reaches the output.
    expect(JSON.stringify(rows)).not.toContain('https://gateway.test');
  });

  it('app_user can only count through the function; it cannot read or write the table', async () => {
    const denied = (e: unknown) => (e as { cause?: { code?: string } }).cause?.code === '42501';
    await expect(
      withoutTenant((tx) => tx.execute(sql`select * from notifications.provider_health`)),
    ).rejects.toSatisfy(denied);
    await expect(
      withoutTenant((tx) => tx.execute(sql`delete from notifications.provider_health`)),
    ).rejects.toSatisfy(denied);
  });
});
