import { generateKeyPairSync, sign } from 'node:crypto';
import { currentConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  addressSuppressionsQuery,
  addSendingDomainCommand,
  createNotifier,
  dispatchDue,
  fakeIdentityPort,
  handleProviderWebhook,
  liftAddressSuppressionCommand,
  memoryTransports,
  metaSignature,
  preferencesPath,
  recordInboundKeywordCommand,
  recordSendingDomainCheckCommand,
  removeSendingDomainCommand,
  SES_TAG_MESSAGE,
  type SnsMessage,
  savePreferenceCenterCommand,
  sendingSetupQuery,
  sesWebhookAdapter,
  setChannelSenderCommand,
  snsStringToSign,
  twilioSignature,
  twilioWebhookAdapter,
  whatsappCloudWebhookAdapter,
} from '@yayatoh/notifications';
import type { NotificationIntent } from '@yayatoh/platform';
import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M3.5b provider adapters end to end on Postgres, with recorded (synthetic) provider payloads
 * signed by test keys: webhook → delivery status, suppression and consent; deduplication under
 * retried and concurrent deliveries; idempotent fallback across providers; sending setup;
 * isolation.
 */
const ORIGIN = 'https://app.yayatoh.test';
const notifier = createNotifier();
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const tag = () => uuidv7().slice(-8);
/** A weekday noon in Chicago: no quiet hours anywhere in the US. */
const WEEKDAY = () => new Date('2030-07-16T17:00:00Z');
const phoneOf = (n: number) => `+1312${String(5_550_000 + (n % 10_000)).padStart(7, '0')}`;
let phoneSeq = Math.floor(Math.random() * 9000);
const newPhone = () => phoneOf(phoneSeq++);

async function enqueue(orgId: string, intent: NotificationIntent) {
  return withTenant(systemCtx(orgId), (tx) => notifier.enqueue(tx, intent));
}

async function rows(orgId: string, q: SQL) {
  return withTenant(systemCtx(orgId), (tx) => tx.execute<Record<string, unknown>>(q));
}

async function messagesFor(orgId: string, dedupeKey: string) {
  return rows(
    orgId,
    sql`select id, channel, status, reason, provider, fallback_of, fallback_reason, provider_message_id, delivery
        from notifications.messages where dedupe_key = ${dedupeKey} order by created_at, channel`,
  );
}

async function contact(org: OrgFixture, email: string, phone: string | null = null) {
  const c = await withTenant(systemCtx(org.org.id), (tx) =>
    upsertContactTx(tx, systemCtx(org.org.id), { email, name: 'Rae Contact', source: 'manual' }),
  );
  if (phone) {
    const token = preferencesPath(org.org.id, c.id).split('/').pop() ?? '';
    await executeCommand(
      savePreferenceCenterCommand,
      {
        token,
        emailCategories: { reminders: true, event_updates: true, marketing: false },
        phone,
        sms: { informational: true, marketing: true },
        whatsapp: { informational: true, marketing: false },
      },
      createCtx({ orgId: org.org.id }),
      ports,
    );
  }
  return c;
}

const ticketIntent = (email: string, phone: string, key: string, channels: NotificationIntent['channels']) =>
  ({
    kind: 'orders.tickets',
    to: { email, phone, timeZone: 'America/Chicago' },
    params: { url: `${ORIGIN}/orders/x`, name: 'Rae', eventName: 'Fixture Night', count: 1 },
    dedupeKey: key,
    channels,
  }) satisfies NotificationIntent;

// ── SES (SNS-signed) ───────────────────────────────────────────────────────────────────────

describe('SES events through SNS', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const TOPIC = 'arn:aws:sns:us-east-1:123456789012:yayatoh-ses-events';
  const CERT = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-synthetic.pem';
  const adapter = sesWebhookAdapter({ topicArns: [TOPIC], certKey: async () => publicKey });
  const notification = (event: Record<string, unknown>, snsId = uuidv7()) => {
    const m: SnsMessage = {
      Type: 'Notification',
      MessageId: snsId,
      TopicArn: TOPIC,
      Message: JSON.stringify(event),
      Timestamp: new Date().toISOString(),
      SignatureVersion: '2',
      Signature: '',
      SigningCertURL: CERT,
    };
    const Signature = sign('RSA-SHA256', Buffer.from(snsStringToSign(m)), privateKey).toString('base64');
    return {
      rawBody: JSON.stringify({ ...m, Signature }),
      headers: new Headers({ 'x-amz-sns-message-type': 'Notification' }),
      url: `${ORIGIN}/api/webhooks/email/ses`,
    };
  };

  async function sentEmail(org: OrgFixture, email: string) {
    const key = `ses-${tag()}`;
    await enqueue(org.org.id, ticketIntent(email, '', key, ['email']));
    const mem = memoryTransports();
    await dispatchDue(org.org.id, { transports: mem.transports, appOrigin: ORIGIN });
    const [msg] = await messagesFor(org.org.id, key);
    return { id: String(msg?.id), providerId: String(msg?.provider_message_id), key, mem };
  }

  it('a hard bounce suppresses the address; retried and concurrent deliveries record once', async () => {
    const email = `ses-bounce-${tag()}@example.test`;
    const sent = await sentEmail(a, email);
    const bounce = notification({
      eventType: 'Bounce',
      bounce: {
        bounceType: 'Permanent',
        bouncedRecipients: [{ emailAddress: email, diagnosticCode: 'smtp; 550' }],
      },
      mail: { messageId: sent.providerId, tags: { [SES_TAG_MESSAGE]: [sent.id] } },
    });
    const first = await handleProviderWebhook(adapter, bounce, ports);
    expect(first).toMatchObject({ ok: true, result: { recorded: 1, suppressed: 1, duplicate: 0 } });
    // SNS retries (and a burst of parallel retries) change nothing.
    const again = await Promise.all([1, 2, 3].map(() => handleProviderWebhook(adapter, bounce, ports)));
    expect(again.map((r) => r.result?.recorded)).toEqual([0, 0, 0]);
    expect(again.map((r) => r.result?.duplicate)).toEqual([1, 1, 1]);
    const [msg] = await messagesFor(a.org.id, sent.key);
    expect(msg?.delivery).toBe('bounced');
    const events = await rows(
      a.org.id,
      sql`select provider, type, bounce_type from notifications.message_events where message_id = ${sent.id}::uuid`,
    );
    expect(events).toEqual([{ provider: 'ses', type: 'bounced', bounce_type: 'hard' }]);
    // The next email to that address is suppressed, transactional included.
    const next = await sentEmail(a, email);
    const [row] = await messagesFor(a.org.id, next.key);
    expect(row).toMatchObject({ status: 'suppressed', reason: 'bounced' });
    expect(next.mem.emails).toHaveLength(0);
  });

  it('a complaint suppresses; a delivery is recorded; another org never sees them', async () => {
    const email = `ses-complaint-${tag()}@example.test`;
    const sent = await sentEmail(a, email);
    const mail = { messageId: sent.providerId, tags: { [SES_TAG_MESSAGE]: [sent.id] } };
    const r1 = await handleProviderWebhook(
      adapter,
      notification({ eventType: 'Delivery', mail, delivery: { recipients: [email] } }),
      ports,
    );
    const r2 = await handleProviderWebhook(
      adapter,
      notification({ eventType: 'Complaint', mail, complaint: { complaintFeedbackType: 'abuse' } }),
      ports,
    );
    expect(r1.result?.recorded).toBe(1);
    expect(r2.result).toMatchObject({ recorded: 1, suppressed: 1 });
    const [msg] = await messagesFor(a.org.id, sent.key);
    expect(msg?.delivery).toBe('complained');
    const other = await rows(
      b.org.id,
      sql`select 1 from notifications.message_events where message_id = ${sent.id}::uuid`,
    );
    expect(other).toHaveLength(0);
  });

  it('refuses forged, replayed and foreign-topic deliveries and events naming unknown or mismatched sends', async () => {
    const sent = await sentEmail(a, `ses-forged-${tag()}@example.test`);
    const good = notification({
      eventType: 'Bounce',
      bounce: { bounceType: 'Permanent' },
      mail: { messageId: sent.providerId, tags: { [SES_TAG_MESSAGE]: [sent.id] } },
    });
    const forged = { ...good, rawBody: good.rawBody.replace('Permanent', 'Transient') };
    expect(await handleProviderWebhook(adapter, forged, ports)).toEqual({ ok: false, failure: 'invalid' });
    const other = sesWebhookAdapter({
      topicArns: ['arn:aws:sns:us-east-1:1:other'],
      certKey: async () => publicKey,
    });
    expect(await handleProviderWebhook(other, good, ports)).toEqual({ ok: false, failure: 'untrusted' });
    // A signed event for a send we don't know, or with another provider id, records nothing.
    const unknown = await handleProviderWebhook(
      adapter,
      notification({
        eventType: 'Delivery',
        mail: { messageId: 'x', tags: { [SES_TAG_MESSAGE]: [uuidv7()] } },
      }),
      ports,
    );
    expect(unknown.result).toMatchObject({ recorded: 0, unknown: 1 });
    const mismatched = await handleProviderWebhook(
      adapter,
      notification({
        eventType: 'Delivery',
        mail: { messageId: 'not-ours', tags: { [SES_TAG_MESSAGE]: [sent.id] } },
      }),
      ports,
    );
    expect(mismatched.result).toMatchObject({ recorded: 0, unknown: 1 });
  });
});

// ── Twilio ─────────────────────────────────────────────────────────────────────────────────

describe('Twilio status callbacks and inbound keywords', () => {
  /** The fixture gives each org its own verified Messaging Service (`MG` + the org id's hex). */
  const serviceOf = (org: OrgFixture) => `MG${org.org.id.replace(/-/g, '')}`;
  const TOKEN = 'synthetic-auth-token';
  const adapter = twilioWebhookAdapter({ authToken: TOKEN });
  const signed = (path: string, params: Record<string, string>) => {
    const url = `${ORIGIN}${path}`;
    return {
      rawBody: new URLSearchParams(params).toString(),
      url,
      headers: new Headers({ 'x-twilio-signature': twilioSignature(TOKEN, url, Object.entries(params)) }),
    };
  };

  async function sentText(org: OrgFixture, email: string, phone: string) {
    const key = `sms-${tag()}`;
    await enqueue(org.org.id, ticketIntent(email, phone, key, ['sms']));
    const mem = memoryTransports();
    await dispatchDue(org.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    const [msg] = await messagesFor(org.org.id, key);
    expect(msg).toMatchObject({ status: 'sent', provider: 'memory' });
    return { id: String(msg?.id), sid: String(msg?.provider_message_id), key, mem };
  }

  it('undelivered → the address is suppressed and email carries the message, once under retries', async () => {
    const email = `sms-undelivered-${tag()}@example.test`;
    const phone = newPhone();
    // The buyer's contact (orders create it): SMS rows keep no email; the contact has it.
    await contact(a, email);
    const sent = await sentText(a, email, phone);
    const callback = signed(`/api/webhooks/sms/twilio?m=${sent.id}`, {
      MessageSid: sent.sid,
      MessageStatus: 'undelivered',
      ErrorCode: '30006',
      To: phone,
    });
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => handleProviderWebhook(adapter, callback, ports)),
    );
    expect(results.map((r) => r.result?.recorded).sort()).toEqual([0, 0, 0, 1]);
    expect(results.reduce((n, r) => n + (r.result?.fellBack ?? 0), 0)).toBe(1);
    const chain = await messagesFor(a.org.id, sent.key);
    expect(chain.map((m) => [m.channel, m.status, m.fallback_reason])).toEqual([
      ['sms', 'sent', null],
      ['email', 'queued', 'undelivered'],
    ]);
    expect(chain[1]?.fallback_of).toBe(sent.id);
    // Three dispatchers at once: the email goes out once.
    const mem = memoryTransports();
    await Promise.all(
      [1, 2, 3].map(() =>
        dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY }),
      ),
    );
    expect(mem.emails.filter((m) => m.to === email)).toHaveLength(1);
    const suppressed = await rows(
      a.org.id,
      sql`select reason from notifications.address_suppressions where channel = 'sms' and address_norm = ${phone}`,
    );
    expect(suppressed).toEqual([{ reason: 'hard_bounce' }]);
    // A later "delivered" for the same message never un-does the fallback or the log.
    const late = await handleProviderWebhook(
      adapter,
      signed(`/api/webhooks/sms/twilio?m=${sent.id}`, { MessageSid: sent.sid, MessageStatus: 'delivered' }),
      ports,
    );
    expect(late.result).toMatchObject({ recorded: 1, fellBack: 0 });
  });

  it('a callback signed for another message, or with the wrong token, is refused', async () => {
    const sent = await sentText(a, `sms-forged-${tag()}@example.test`, newPhone());
    const good = signed(`/api/webhooks/sms/twilio?m=${sent.id}`, {
      MessageSid: sent.sid,
      MessageStatus: 'undelivered',
    });
    const retargeted = { ...good, url: `${ORIGIN}/api/webhooks/sms/twilio?m=${uuidv7()}` };
    expect(await handleProviderWebhook(adapter, retargeted, ports)).toEqual({
      ok: false,
      failure: 'invalid',
    });
    const wrongToken = twilioWebhookAdapter({ authToken: 'other' });
    expect(await handleProviderWebhook(wrongToken, good, ports)).toEqual({ ok: false, failure: 'invalid' });
    const [msg] = await messagesFor(a.org.id, sent.key);
    expect(msg?.delivery).toBeNull();
  });

  it('STOP withdraws text consent and suppresses the number; START lets informational texts back', async () => {
    const email = `stop-${tag()}@example.test`;
    const phone = newPhone();
    const c = await contact(a, email, phone);
    const cb = await contact(b, email, phone);
    await sentText(a, email, phone);
    await sentText(b, email, phone);
    // To org a's own number: org a only (org b texted the same person from its own number).
    const stop = signed('/api/webhooks/sms/twilio/inbound', {
      MessageSid: `SM${tag()}`,
      From: phone,
      To: '+13125559999',
      Body: 'STOP',
      MessagingServiceSid: serviceOf(a),
    });
    const out = await handleProviderWebhook(adapter, stop, ports);
    expect(out).toMatchObject({ ok: true, result: { keywords: 1 }, help: null });
    const consent = (org: OrgFixture, id: string, purpose: 'marketing' | 'informational') =>
      withTenant(systemCtx(org.org.id), (tx) => currentConsentTx(tx, id, 'sms', purpose));
    expect(await consent(a, c.id, 'marketing')).toBe('withdrawn');
    expect(await consent(a, c.id, 'informational')).toBe('withdrawn');
    // Org b's own number was not the one they answered: untouched.
    expect(await consent(b, cb.id, 'informational')).toBe('granted');
    const ledger = await rows(
      a.org.id,
      sql`select evidence from crm.consents where contact_id = ${c.id}::uuid and status = 'withdrawn' order by captured_at`,
    );
    expect(ledger.map((r) => String(r.evidence))).toEqual([
      expect.stringMatching(/^keyword:STOP:twilio:SM/),
      expect.stringMatching(/^keyword:STOP:twilio:SM/),
    ]);
    // The provider retries the inbound webhook: applied once.
    expect((await handleProviderWebhook(adapter, stop, ports)).result?.keywords).toBe(0);
    // The next text (even a ticket) is suppressed as opted out, and doesn't fall back to email.
    const after = `after-stop-${tag()}`;
    await enqueue(a.org.id, ticketIntent(email, phone, after, ['sms']));
    const mem = memoryTransports();
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    expect((await messagesFor(a.org.id, after)).map((m) => [m.channel, m.status, m.reason])).toEqual([
      ['sms', 'suppressed', 'opted_out'],
    ]);
    // The organizer sees it, masked; it can't be lifted by the org.
    const list = await executeQuery(addressSuppressionsQuery, {}, a.ctx(), ports);
    const row = list.find((s) => s.reason === 'opt_out' && s.address.endsWith(phone.slice(-4)));
    expect(row).toMatchObject({ channel: 'sms', liftable: false });
    expect(row?.address).not.toContain(phone);
    await expect(
      executeCommand(liftAddressSuppressionCommand, { id: String(row?.id), note: 'please' }, a.ctx(), ports),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.details?.reason === 'opt_out_not_liftable');
    // START: the number is reachable again; informational consent back, marketing still withdrawn.
    await handleProviderWebhook(
      adapter,
      signed('/api/webhooks/sms/twilio/inbound', {
        MessageSid: `SM${tag()}`,
        From: phone,
        Body: 'start',
        MessagingServiceSid: serviceOf(a),
      }),
      ports,
    );
    expect(await consent(a, c.id, 'informational')).toBe('granted');
    expect(await consent(a, c.id, 'marketing')).toBe('withdrawn');
    const again = `after-start-${tag()}`;
    await enqueue(a.org.id, ticketIntent(email, phone, again, ['sms']));
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    expect((await messagesFor(a.org.id, again))[0]).toMatchObject({ status: 'sent' });
    // The audit never holds the number.
    const audit = await rows(
      a.org.id,
      sql`select data::text as data from platform.audit_events where action = 'notifications.inbound_keyword' order by created_at desc limit 2`,
    );
    for (const r of audit) expect(String(r.data)).not.toContain(phone.slice(1));
  });

  it('HELP names the org on its own number; on the shared number STOP reaches every org that texted it', async () => {
    const phone = newPhone();
    const email = `help-${tag()}@example.test`;
    const help = await handleProviderWebhook(
      adapter,
      signed('/api/webhooks/sms/twilio/inbound', {
        MessageSid: `SM${tag()}`,
        From: phone,
        Body: 'HELP',
        MessagingServiceSid: serviceOf(b),
      }),
      ports,
    );
    expect(help.help).toEqual({ sender: b.org.name });
    // Org b goes back to the shared sender for the rest of this test.
    await executeCommand(
      setChannelSenderCommand,
      { kind: 'clear', channel: 'sms' },
      systemCtx(b.org.id),
      ports,
    );
    try {
      await sentText(a, email, phone);
      await sentText(b, email, phone);
      const shared = { MessagingServiceSid: 'MG00000000000000000000000000000000', From: phone };
      const sharedHelp = await handleProviderWebhook(
        adapter,
        signed('/api/webhooks/sms/twilio/inbound', { ...shared, MessageSid: `SM${tag()}`, Body: 'info' }),
        ports,
      );
      expect(sharedHelp.help).toEqual({ sender: null });
      const stop = await handleProviderWebhook(
        adapter,
        signed('/api/webhooks/sms/twilio/inbound', { ...shared, MessageSid: `SM${tag()}`, Body: 'stop' }),
        ports,
      );
      expect(stop.result?.keywords).toBe(1);
      const inA = await rows(
        a.org.id,
        sql`select 1 from notifications.address_suppressions where address_norm = ${phone}`,
      );
      const inB = await rows(
        b.org.id,
        sql`select reason from notifications.address_suppressions where address_norm = ${phone}`,
      );
      // Org a texts from its own number: a STOP to the shared one isn't about it.
      expect(inA).toHaveLength(0);
      expect(inB).toEqual([{ reason: 'opt_out' }]);
    } finally {
      await executeCommand(
        setChannelSenderCommand,
        { kind: 'sms', messagingServiceSid: serviceOf(b), displayNumber: null, campaignStatus: 'verified' },
        systemCtx(b.org.id),
        ports,
      );
    }
  });

  it('only a platform actor records inbound keywords', async () => {
    await expect(
      executeCommand(
        recordInboundKeywordCommand,
        {
          provider: 'twilio',
          id: 'x',
          channel: 'sms',
          keyword: 'stop',
          from: '+13125550000',
          receivedAt: new Date(),
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.code === 'forbidden');
  });
});

// ── WhatsApp and fallback chains ───────────────────────────────────────────────────────────

describe('fallback chains across providers', () => {
  const SECRET = 'synthetic-app-secret';
  const cloud = whatsappCloudWebhookAdapter({ appSecret: SECRET });

  it('WhatsApp → SMS when the number is not on WhatsApp; never twice under concurrent dispatchers', async () => {
    const phone = newPhone();
    const email = `wa-${tag()}@example.test`;
    const key = `wa-${tag()}`;
    await enqueue(a.org.id, ticketIntent(email, phone, key, ['whatsapp']));
    const mem = memoryTransports();
    mem.notOnWhatsApp.add(phone);
    const deps = { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY };
    await dispatchDue(a.org.id, deps);
    let chain = await messagesFor(a.org.id, key);
    expect(chain.map((m) => [m.channel, m.status, m.reason, m.fallback_reason])).toEqual([
      ['whatsapp', 'failed', 'not_on_whatsapp', null],
      ['sms', 'queued', null, 'not_on_whatsapp'],
    ]);
    await Promise.all([1, 2, 3].map(() => dispatchDue(a.org.id, deps)));
    chain = await messagesFor(a.org.id, key);
    expect(chain.map((m) => [m.channel, m.status])).toEqual([
      ['whatsapp', 'failed'],
      ['sms', 'sent'],
    ]);
    expect(mem.sms.filter((m) => m.to === phone)).toHaveLength(1);
    expect(mem.whatsapp).toHaveLength(0);
  });

  it('a failed WhatsApp status (webhook) falls back to SMS once, however often it is delivered', async () => {
    const phone = newPhone();
    const key = `wa-hook-${tag()}`;
    await enqueue(a.org.id, ticketIntent(`wa-hook-${tag()}@example.test`, phone, key, ['whatsapp']));
    const mem = memoryTransports();
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    const [wa] = await messagesFor(a.org.id, key);
    expect(mem.whatsapp[0]).toMatchObject({ to: phone, category: 'utility', orgName: a.org.name });
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: String(wa?.provider_message_id),
                    status: 'failed',
                    biz_opaque_callback_data: String(wa?.id),
                    errors: [{ code: 131026 }],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const req = {
      rawBody: raw,
      url: `${ORIGIN}/api/webhooks/whatsapp/cloud`,
      headers: new Headers({ 'x-hub-signature-256': metaSignature(SECRET, raw) }),
    };
    const out = await Promise.all([1, 2, 3].map(() => handleProviderWebhook(cloud, req, ports)));
    expect(out.reduce((n, r) => n + (r.result?.fellBack ?? 0), 0)).toBe(1);
    const chain = await messagesFor(a.org.id, key);
    expect(chain.map((m) => [m.channel, m.fallback_reason])).toEqual([
      ['whatsapp', null],
      ['sms', 'undelivered'],
    ]);
    // WhatsApp now knows this number isn't on it: the next WhatsApp message falls back at once.
    const next = `wa-next-${tag()}`;
    await enqueue(a.org.id, ticketIntent(`n-${tag()}@example.test`, phone, next, ['whatsapp']));
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    expect((await messagesFor(a.org.id, next)).map((m) => [m.channel, m.reason, m.fallback_reason])).toEqual([
      ['whatsapp', 'bounced', null],
      ['sms', null, 'bounced'],
    ]);
  });

  it('a channel that already has the message ends the chain; the chain runs to email', async () => {
    const phone = newPhone();
    const email = `both-${tag()}@example.test`;
    const key = `both-${tag()}`;
    // The intent asked for WhatsApp and SMS: the WhatsApp failure adds nothing.
    await enqueue(a.org.id, ticketIntent(email, phone, key, ['whatsapp', 'sms']));
    const mem = memoryTransports();
    mem.notOnWhatsApp.add(phone);
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    const chain = await messagesFor(a.org.id, key);
    expect(chain.map((m) => [m.channel, m.status])).toEqual([
      ['sms', 'sent'],
      ['whatsapp', 'failed'],
    ]);
    expect(mem.sms.filter((m) => m.to === phone)).toHaveLength(1);
    // An invalid mobile number: WhatsApp → SMS → email.
    const bad = newPhone();
    const key2 = `bad-${tag()}`;
    const email2 = `bad-${tag()}@example.test`;
    await contact(a, email2);
    await enqueue(a.org.id, ticketIntent(email2, bad, key2, ['whatsapp']));
    mem.notOnWhatsApp.add(bad);
    mem.badNumbers.add(bad);
    for (let i = 0; i < 3; i++)
      await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    expect(
      (await messagesFor(a.org.id, key2)).map((m) => [m.channel, m.status, m.reason, m.fallback_reason]),
    ).toEqual([
      ['whatsapp', 'failed', 'not_on_whatsapp', null],
      ['sms', 'failed', 'invalid_number', 'not_on_whatsapp'],
      ['email', 'sent', null, 'invalid_number'],
    ]);
    expect(mem.emails.filter((m) => m.to === email2)).toHaveLength(1);
  });

  it('a provider outage retries, then falls back after the last attempt', async () => {
    const phone = newPhone();
    const key = `outage-${tag()}`;
    await enqueue(a.org.id, ticketIntent(`outage-${tag()}@example.test`, phone, key, ['whatsapp']));
    const mem = memoryTransports();
    mem.failing.add('whatsapp');
    let t = WEEKDAY().getTime();
    for (let i = 0; i < 5; i++) {
      await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: () => new Date(t) });
      t += 2 * 3_600_000;
    }
    const chain = await messagesFor(a.org.id, key);
    expect(chain.map((m) => [m.channel, m.status, m.reason, m.fallback_reason])).toEqual([
      ['whatsapp', 'failed', 'provider_error', null],
      ['sms', 'queued', null, 'provider_error'],
    ]);
  });

  it('marketing never escalates to another channel', async () => {
    const phone = newPhone();
    const email = `mkt-${tag()}@example.test`;
    const c = await contact(a, email, phone);
    const key = `mkt-${tag()}`;
    await enqueue(a.org.id, {
      kind: 'marketing.message',
      to: { email, phone, contactId: c.id, timeZone: 'America/Chicago' },
      params: { subject: 'Sale', body: 'Half price', name: 'Rae' },
      dedupeKey: key,
      channels: ['whatsapp'],
    });
    const mem = memoryTransports();
    await dispatchDue(a.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
    // Blocked on WhatsApp (no marketing consent there), and no SMS or email is added for it.
    const chain = await messagesFor(a.org.id, key);
    expect(chain.map((m) => [m.channel, m.status, m.reason])).toEqual([
      ['whatsapp', 'suppressed', 'consent_missing'],
    ]);
  });
});

// ── Sending setup ──────────────────────────────────────────────────────────────────────────

describe('sending domains and dedicated senders', () => {
  it('owners add, check and remove a domain; validation, one per org, one org per domain; viewers refused', async () => {
    const domain = `mail.${tag()}.example.test`;
    for (const bad of ['not a domain', 'localhost', 'yayatoh.com', 'x.yayatoh.events', '127.0.0.1'])
      await expect(
        executeCommand(addSendingDomainCommand, { domain: bad, provider: 'fake' }, b.ctx(), ports),
      ).rejects.toSatisfy((e) => isDomainError(e) && e.details?.reason === 'invalid_domain');
    await expect(
      executeCommand(
        addSendingDomainCommand,
        { domain, provider: 'fake' },
        userCtx(b.viewerId, b.org.id),
        ports,
      ),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.code === 'forbidden');
    // Org a already has one (the fixture's): a second is refused.
    await expect(
      executeCommand(addSendingDomainCommand, { domain, provider: 'fake' }, a.ctx(), ports),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.details?.reason === 'already_set');
    // Org b removes its fixture domain, then adds this one; org a's domain is taken.
    const before = await executeQuery(sendingSetupQuery, {}, b.ctx(), ports);
    await executeCommand(removeSendingDomainCommand, { id: String(before.domain?.id) }, b.ctx(), ports);
    const aDomain = (await executeQuery(sendingSetupQuery, {}, a.ctx(), ports)).domain?.domain ?? '';
    await expect(
      executeCommand(
        addSendingDomainCommand,
        { domain: aDomain.toUpperCase(), provider: 'fake' },
        b.ctx(),
        ports,
      ),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.details?.reason === 'domain_taken');
    const added = await executeCommand(
      addSendingDomainCommand,
      { domain: `https://${domain.toUpperCase()}/`, provider: 'fake' },
      b.ctx(),
      ports,
    );
    expect(added).toMatchObject({ domain, status: 'pending', fromAddress: `notifications@${domain}` });
    // Pending: mail still goes out from the platform sender.
    const key = `from-${tag()}`;
    await enqueue(b.org.id, ticketIntent(`from-${tag()}@example.test`, '', key, ['email']));
    const mem = memoryTransports();
    await dispatchDue(b.org.id, { transports: mem.transports, appOrigin: ORIGIN });
    expect(mem.emails.at(-1)?.sender ?? null).toBeNull();
    const identity = await fakeIdentityPort().status(domain);
    const checked = await executeCommand(
      recordSendingDomainCheckCommand,
      {
        id: added.id,
        dkim: identity.dkim,
        spf: identity.spf,
        dmarc: 'missing',
        dmarcPolicy: null,
        records: identity.records,
        providerRef: domain,
      },
      b.ctx(),
      ports,
    );
    expect(checked).toMatchObject({
      status: 'verified',
      dkim: 'verified',
      spf: 'verified',
      dmarc: 'missing',
    });
    expect(checked.verifiedAt).toBeInstanceOf(Date);
    // Verified: the org's own From address.
    const key2 = `from-${tag()}`;
    await enqueue(b.org.id, ticketIntent(`from-${tag()}@example.test`, '', key2, ['email']));
    await dispatchDue(b.org.id, { transports: mem.transports, appOrigin: ORIGIN });
    expect(mem.emails.at(-1)?.sender).toEqual({ address: `notifications@${domain}` });
    // A failed DKIM: failed, and back to the platform sender.
    const failed = await executeCommand(
      recordSendingDomainCheckCommand,
      {
        id: added.id,
        dkim: 'failed',
        spf: 'verified',
        dmarc: 'missing',
        dmarcPolicy: null,
        records: identity.records,
        providerRef: domain,
      },
      b.ctx(),
      ports,
    );
    expect(failed.status).toBe('failed');
    // Audited, isolated.
    const audit = await rows(
      b.org.id,
      sql`select action from platform.audit_events where target_id = ${added.id} order by created_at`,
    );
    expect(audit.map((r) => r.action)).toEqual([
      'notifications.sending_domain.add',
      'notifications.sending_domain.check',
      'notifications.sending_domain.check',
    ]);
    const seenByA = await executeQuery(sendingSetupQuery, {}, a.ctx(), ports);
    expect(seenByA.domain?.domain).not.toBe(domain);
    await expect(
      executeCommand(removeSendingDomainCommand, { id: added.id }, a.ctx(), ports),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.code === 'not_found');
  });

  it('staff set dedicated senders; SMS uses a service only once its 10DLC campaign is verified', async () => {
    await expect(
      executeCommand(
        setChannelSenderCommand,
        {
          kind: 'sms',
          messagingServiceSid: `MG${'1'.repeat(32)}`,
          displayNumber: null,
          campaignStatus: 'verified',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.code === 'forbidden');
    const sid = `MG${uuidv7().replace(/-/g, '')}`;
    const pending = await executeCommand(
      setChannelSenderCommand,
      { kind: 'sms', messagingServiceSid: sid, displayNumber: '+13125550002', campaignStatus: 'pending' },
      systemCtx(b.org.id),
      ports,
    );
    expect(pending).toMatchObject({
      dedicated: true,
      active: false,
      refHint: sid.slice(-4),
      campaignStatus: 'pending',
    });
    expect(JSON.stringify(pending)).not.toContain(sid);
    // The same service can't belong to two orgs.
    await expect(
      executeCommand(
        setChannelSenderCommand,
        { kind: 'sms', messagingServiceSid: sid, displayNumber: null, campaignStatus: 'verified' },
        systemCtx(a.org.id),
        ports,
      ),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.details?.reason === 'sender_taken');
    const phone = newPhone();
    const send = async () => {
      const key = `svc-${tag()}`;
      await enqueue(b.org.id, ticketIntent(`svc-${tag()}@example.test`, phone, key, ['sms', 'whatsapp']));
      const mem = memoryTransports();
      await dispatchDue(b.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: WEEKDAY });
      return mem;
    };
    expect((await send()).sms[0]?.sender ?? null).toBeNull();
    await executeCommand(
      setChannelSenderCommand,
      { kind: 'sms', messagingServiceSid: sid, displayNumber: '+13125550002', campaignStatus: 'verified' },
      systemCtx(b.org.id),
      ports,
    );
    await executeCommand(
      setChannelSenderCommand,
      { kind: 'whatsapp', route: 'gateway', senderRef: null, displayNumber: null },
      systemCtx(b.org.id),
      ports,
    );
    const mem = await send();
    expect(mem.sms[0]?.sender).toEqual({ messagingServiceSid: sid });
    expect(mem.whatsapp[0]?.sender).toEqual({ route: 'gateway', phoneNumberId: null });
    await expect(
      executeCommand(
        setChannelSenderCommand,
        { kind: 'whatsapp', route: 'cloud', senderRef: null, displayNumber: null },
        systemCtx(b.org.id),
        ports,
      ),
    ).rejects.toSatisfy((e) => isDomainError(e) && e.details?.reason === 'phone_number_id');
    const setup = await executeQuery(sendingSetupQuery, {}, userCtx(b.viewerId, b.org.id), ports);
    expect(setup.sms).toMatchObject({ dedicated: true, active: true, displayNumber: '+13125550002' });
    expect(setup.whatsapp).toMatchObject({ dedicated: true, provider: 'whatsapp_gateway' });
    expect(setup.fallbacks.find((f) => f.category === 'transactional')?.chain).toEqual([
      'whatsapp',
      'sms',
      'email',
    ]);
    await executeCommand(
      setChannelSenderCommand,
      { kind: 'clear', channel: 'sms' },
      systemCtx(b.org.id),
      ports,
    );
    await executeCommand(
      setChannelSenderCommand,
      { kind: 'clear', channel: 'whatsapp' },
      systemCtx(b.org.id),
      ports,
    );
    expect((await executeQuery(sendingSetupQuery, {}, b.ctx(), ports)).sms.dedicated).toBe(false);
    const audit = await rows(
      b.org.id,
      sql`select data::text as data from platform.audit_events where action = 'messaging.sender.set' order by created_at desc limit 6`,
    );
    expect(audit.length).toBeGreaterThan(0);
    for (const r of audit) expect(String(r.data)).not.toContain(sid);
  });
});
