import { createHash, createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FALLBACK_CHAINS, isFallbackReason, planFallback } from '../src/fallback.ts';
import { missingEnv, providerMode, switchedOn, whatsappRoutes } from '../src/providers/config.ts';
import { helpReply, parseKeyword } from '../src/providers/keywords.ts';
import {
  identityPortFromEnv,
  liveTransports,
  liveWebhookAdapter,
  senderStatusFromEnv,
  whatsappVerifyToken,
} from '../src/providers/select.ts';
import {
  checkDmarc,
  fakeIdentityPort,
  fakeResolveTxt,
  formatFrom,
  identityRecords,
  SES_TAG_MESSAGE,
  sesEmailTransport,
  sesIdentityPort,
} from '../src/providers/ses.ts';
import { signAwsRequest } from '../src/providers/sigv4.ts';
import {
  isSnsUrl,
  type SnsMessage,
  sesEventToDeliveryEvents,
  sesWebhookAdapter,
  snsCertKeys,
  snsStringToSign,
} from '../src/providers/sns.ts';
import {
  fakeSenderStatus,
  twilioSenderStatus,
  twilioSignature,
  twilioSmsTransport,
  twilioWebhookAdapter,
} from '../src/providers/twilio.ts';
import {
  errorProvider,
  isProviderRejection,
  ProviderRejection,
  WebhookVerificationError,
} from '../src/providers/types.ts';
import {
  cloudStatusToEvent,
  gatewaySignature,
  metaChallenge,
  metaSignature,
  routedWhatsAppTransport,
  whatsappCloudTransport,
  whatsappCloudWebhookAdapter,
  whatsappGatewayTransport,
  whatsappGatewayWebhookAdapter,
  whatsappTemplate,
} from '../src/providers/whatsapp.ts';
import { memoryTransports } from '../src/transports.ts';

/**
 * M3.5b provider adapters against recorded, synthetic payloads (made up for these tests; no real
 * account, key or number). Every webhook adapter is checked for a good signature, a wrong one, a
 * missing one and a replay; every send adapter for its request and its error mapping.
 */
const MSG = '0190f3a2-7c1d-7e55-9a4b-5d2c3e4f5a6b';
const NOW = new Date('2026-09-29T12:00:00Z');
const headers = (h: Record<string, string>) => new Headers(h);

type Call = { url: string; init: RequestInit | undefined };
function fakeFetch(respond: (url: string, init?: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  };
  return { fn, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof WebhookVerificationError) return err.failure;
    throw err;
  }
  throw new Error('expected a verification failure');
}

describe('AWS SigV4', () => {
  const credentials = {
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  };
  const at = new Date('2015-08-30T12:36:00Z');
  it('reproduces the AWS test suite vectors (get-vanilla, query order)', () => {
    const vanilla = signAwsRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      region: 'us-east-1',
      service: 'service',
      credentials,
      now: at,
    });
    expect(vanilla.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
    expect(vanilla['x-amz-date']).toBe('20150830T123600Z');
    const ordered = signAwsRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/?Param2=value2&Param1=value1',
      region: 'us-east-1',
      service: 'service',
      credentials,
      now: at,
    });
    expect(ordered.authorization).toContain(
      'Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500',
    );
  });
  it('signs the session token and the body', () => {
    const a = signAwsRequest({
      method: 'POST',
      url: 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
      region: 'us-east-1',
      service: 'ses',
      body: '{"a":1}',
      credentials: { ...credentials, sessionToken: 'token' },
      now: at,
    });
    expect(a['x-amz-security-token']).toBe('token');
    expect(a.authorization).toContain('SignedHeaders=host;x-amz-date;x-amz-security-token');
    const b = signAwsRequest({
      method: 'POST',
      url: 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails',
      region: 'us-east-1',
      service: 'ses',
      body: '{"a":2}',
      credentials: { ...credentials, sessionToken: 'token' },
      now: at,
    });
    expect(a.authorization).not.toBe(b.authorization);
  });
});

describe('SES sending', () => {
  const cfg = {
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIDTEST', secretAccessKey: 'test-secret' },
    configurationSet: 'yayatoh-events',
    now: () => NOW,
  };
  const email = {
    from: { name: 'Lakeside "Events"', address: 'notifications@mail.yayatoh.com' },
    to: 'fan@example.test',
    subject: 'Your tickets',
    html: '<p>Hi</p>',
    text: 'Hi',
    headers: { 'List-Unsubscribe': '<https://app.yayatoh.test/api/unsubscribe/x>' },
    idempotencyKey: MSG,
  };
  it('sends through the configuration set with our message id and the org as tags', async () => {
    const f = fakeFetch(() => json(200, { MessageId: '0100018f-ses-id' }));
    const out = await sesEmailTransport({ ...cfg, fetch: f.fn }).send({ ...email, orgId: 'org-1' });
    expect(out).toEqual({ providerMessageId: '0100018f-ses-id', provider: 'ses' });
    const call = f.calls[0];
    expect(call?.url).toBe('https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
    const body = JSON.parse(String(call?.init?.body));
    expect(body.FromEmailAddress).toBe('"Lakeside \\"Events\\"" <notifications@mail.yayatoh.com>');
    expect(body.ConfigurationSetName).toBe('yayatoh-events');
    expect(body.EmailTags).toEqual([
      { Name: SES_TAG_MESSAGE, Value: MSG },
      { Name: 'yayatoh-org', Value: 'org-1' },
    ]);
    expect(body.Content.Simple.Headers).toEqual([
      { Name: 'List-Unsubscribe', Value: '<https://app.yayatoh.test/api/unsubscribe/x>' },
    ]);
    const sent = (call?.init?.headers ?? {}) as Record<string, string>;
    expect(String(sent.authorization)).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDTEST\/20260929\/us-east-1\/ses\/aws4_request/,
    );
  });
  it("uses the org's verified domain as the From address", async () => {
    const f = fakeFetch(() => json(200, { MessageId: 'x' }));
    await sesEmailTransport({ ...cfg, fetch: f.fn }).send({
      ...email,
      sender: { address: 'notifications@mail.lakeside.test' },
    });
    expect(JSON.parse(String(f.calls[0]?.init?.body)).FromEmailAddress).toBe(
      '"Lakeside \\"Events\\"" <notifications@mail.lakeside.test>',
    );
  });
  it('encodes non-ASCII display names (RFC 2047)', () => {
    expect(formatFrom('مهرجان', 'a@b.test')).toBe(
      `=?UTF-8?B?${Buffer.from('مهرجان').toString('base64')}?= <a@b.test>`,
    );
    expect(formatFrom('', 'a@b.test')).toBe('a@b.test');
  });
  it('maps permanent refusals to a rejection and throttling to a retry', async () => {
    const rejected = sesEmailTransport({
      ...cfg,
      fetch: fakeFetch(() => json(400, { __type: 'MessageRejected' })).fn,
    });
    await expect(rejected.send(email)).rejects.toBeInstanceOf(ProviderRejection);
    const throttled = sesEmailTransport({
      ...cfg,
      fetch: fakeFetch(() => json(429, { __type: 'TooManyRequestsException' })).fn,
    });
    await expect(throttled.send(email)).rejects.not.toBeInstanceOf(ProviderRejection);
    await expect(throttled.send(email)).rejects.toThrow(/TooManyRequests/);
  });
  it('creates identities with Easy DKIM and a custom MAIL FROM, and reads their checks', async () => {
    const f = fakeFetch((_url, init) => {
      if (init?.method === 'POST')
        return json(200, { DkimAttributes: { Status: 'PENDING', Tokens: ['tok1', 'tok2', 'tok3'] } });
      if (init?.method === 'PUT') return json(200, {});
      return json(200, {
        DkimAttributes: { Status: 'SUCCESS', Tokens: ['tok1', 'tok2', 'tok3'] },
        MailFromAttributes: { MailFromDomainStatus: 'SUCCESS' },
      });
    });
    const port = sesIdentityPort({ ...cfg, fetch: f.fn });
    const created = await port.create('mail.lakeside.test');
    expect(created.dkim).toBe('pending');
    expect(created.records.filter((r) => r.purpose === 'dkim')).toHaveLength(3);
    expect(f.calls[1]?.url).toBe(
      'https://email.us-east-1.amazonaws.com/v2/email/identities/mail.lakeside.test/mail-from',
    );
    expect(JSON.parse(String(f.calls[1]?.init?.body)).MailFromDomain).toBe('bounce.mail.lakeside.test');
    const status = await port.status('mail.lakeside.test');
    expect(status).toMatchObject({ dkim: 'verified', spf: 'verified' });
  });
  it('lists the DNS records to publish', () => {
    expect(identityRecords('mail.x.test', ['t1'], 'eu-west-1')).toEqual([
      { type: 'CNAME', name: 't1._domainkey.mail.x.test', value: 't1.dkim.amazonses.com', purpose: 'dkim' },
      {
        type: 'MX',
        name: 'bounce.mail.x.test',
        value: '10 feedback-smtp.eu-west-1.amazonses.com',
        purpose: 'spf',
      },
      { type: 'TXT', name: 'bounce.mail.x.test', value: 'v=spf1 include:amazonses.com ~all', purpose: 'spf' },
    ]);
  });
  it('the fake identity port is deterministic (fail/pending labels)', async () => {
    const fake = fakeIdentityPort();
    expect((await fake.create('mail.ok.test')).dkim).toBe('pending');
    expect((await fake.status('mail.ok.test')).dkim).toBe('verified');
    expect((await fake.status('mail.fail.test')).dkim).toBe('failed');
    expect((await fake.status('mail.pending.test')).spf).toBe('pending');
    expect((await fake.create('mail.ok.test')).records).toEqual((await fake.status('mail.ok.test')).records);
  });
  it('checks DMARC at the domain, then its organizational domain', async () => {
    const dns: Record<string, string[][]> = {
      '_dmarc.lakeside.test': [['v=DMARC1; p=quarantine; rua=mailto:d@lakeside.test']],
      '_dmarc.bad.test': [['v=DMARC1; rua=mailto:x@bad.test']],
    };
    const resolve = async (name: string) => {
      const r = dns[name];
      if (!r) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
      return r;
    };
    expect(await checkDmarc('mail.lakeside.test', resolve)).toEqual({
      status: 'verified',
      policy: 'quarantine',
      at: 'lakeside.test',
    });
    expect(await checkDmarc('mail.bad.test', resolve)).toMatchObject({ status: 'failed', policy: null });
    expect(await checkDmarc('mail.none.test', resolve)).toEqual({
      status: 'missing',
      policy: null,
      at: null,
    });
    expect((await checkDmarc('mail.x.nodmarc.test', fakeResolveTxt)).status).toBe('missing');
    expect((await checkDmarc('mail.x.test', fakeResolveTxt)).policy).toBe('none');
  });
});

describe('SNS signatures (SES events)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const TOPIC = 'arn:aws:sns:us-east-1:123456789012:yayatoh-ses-events';
  const CERT = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-synthetic.pem';
  const certKey = async (url: string) => {
    if (url !== CERT) throw new Error('unexpected cert url');
    return publicKey;
  };
  const sesBounce = JSON.stringify({
    eventType: 'Bounce',
    bounce: {
      bounceType: 'Permanent',
      bounceSubType: 'General',
      bouncedRecipients: [
        { emailAddress: 'bounce@example.test', diagnosticCode: 'smtp; 550 5.1.1 user unknown' },
      ],
      timestamp: '2026-09-29T11:59:00.000Z',
    },
    mail: {
      messageId: '0100018f-ses-id',
      destination: ['bounce@example.test'],
      tags: { [SES_TAG_MESSAGE]: [MSG] },
    },
  });
  function signed(overrides: Partial<SnsMessage> = {}, version: '1' | '2' = '2', key = privateKey) {
    const m: SnsMessage = {
      Type: 'Notification',
      MessageId: 'b0b7f0d6-2d5e-5f0e-9c4d-000000000001',
      TopicArn: TOPIC,
      Message: sesBounce,
      Timestamp: '2026-09-29T11:59:30.000Z',
      SignatureVersion: version,
      Signature: '',
      SigningCertURL: CERT,
      ...overrides,
    };
    const sig = sign(
      version === '1' ? 'RSA-SHA1' : 'RSA-SHA256',
      Buffer.from(snsStringToSign(m)),
      key,
    ).toString('base64');
    return JSON.stringify({ ...m, Signature: overrides.Signature ?? sig });
  }
  const adapter = (confirm?: (u: string) => Promise<void>) =>
    sesWebhookAdapter({ topicArns: [TOPIC], certKey, now: () => NOW, ...(confirm ? { confirm } : {}) });
  const req = (rawBody: string) => ({
    rawBody,
    headers: headers({}),
    url: 'https://app.yayatoh.test/api/webhooks/email/ses',
  });

  it('accepts a v2 (SHA256) and a v1 (SHA1) signature and maps the SES bounce', async () => {
    for (const v of ['2', '1'] as const) {
      const out = await adapter().verify(req(signed({}, v)));
      expect(out.events).toEqual([
        expect.objectContaining({
          id: 'sns:b0b7f0d6-2d5e-5f0e-9c4d-000000000001',
          type: 'bounced',
          bounceType: 'hard',
          messageId: MSG,
          providerMessageId: '0100018f-ses-id',
          recipient: 'bounce@example.test',
        }),
      ]);
    }
  });
  it('refuses a wrong signature, a missing one, another key, a tampered body', async () => {
    expect(await failure(adapter().verify(req(signed({ Signature: 'AAAA' }))))).toBe('invalid');
    const missing = JSON.parse(signed());
    delete missing.Signature;
    expect(await failure(adapter().verify(req(JSON.stringify(missing))))).toBe('missing');
    expect(await failure(adapter().verify(req(signed({}, '2', other.privateKey))))).toBe('invalid');
    const tampered = JSON.parse(signed()) as SnsMessage;
    (tampered as { Message: string }).Message = tampered.Message.replace('Permanent', 'Transient');
    expect(await failure(adapter().verify(req(JSON.stringify(tampered))))).toBe('invalid');
    expect(await failure(adapter().verify(req('not json')))).toBe('malformed');
  });
  it('refuses replays (older than an hour), foreign topics and certificate hosts', async () => {
    expect(await failure(adapter().verify(req(signed({ Timestamp: '2026-09-29T10:30:00.000Z' }))))).toBe(
      'replayed',
    );
    expect(await failure(adapter().verify(req(signed({ TopicArn: 'arn:aws:sns:us-east-1:999:evil' }))))).toBe(
      'untrusted',
    );
    expect(
      await failure(
        adapter().verify(req(signed({ SigningCertURL: 'https://sns.us-east-1.evil.test/x.pem' }))),
      ),
    ).toBe('untrusted');
  });
  it('confirms a subscription only through an SNS SubscribeURL', async () => {
    const visited: string[] = [];
    const confirm = async (u: string) => {
      visited.push(u);
    };
    const good = 'https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=x&Token=t';
    const sub = { Type: 'SubscriptionConfirmation', Token: 't', SubscribeURL: good, Message: 'confirm' };
    const out = await adapter(confirm).verify(req(signed(sub)));
    expect(out).toEqual({ events: [], inbound: [], confirmed: true });
    expect(visited).toEqual([good]);
    expect(
      await failure(
        adapter(confirm).verify(req(signed({ ...sub, SubscribeURL: 'https://evil.test/confirm' }))),
      ),
    ).toBe('untrusted');
    expect(visited).toHaveLength(1);
  });
  it('maps deliveries, soft bounces and complaints; ignores other mail and events', () => {
    const at = new Date('2026-09-29T12:00:00Z');
    const mail = { messageId: 'm1', tags: { [SES_TAG_MESSAGE]: [MSG] } };
    expect(
      sesEventToDeliveryEvents(
        'e1',
        JSON.stringify({ eventType: 'Delivery', mail, delivery: { recipients: ['a@x.test'] } }),
        at,
      ),
    ).toMatchObject([{ type: 'delivered', recipient: 'a@x.test' }]);
    expect(
      sesEventToDeliveryEvents(
        'e2',
        JSON.stringify({
          eventType: 'Bounce',
          mail,
          bounce: { bounceType: 'Transient', bouncedRecipients: [{}] },
        }),
        at,
      ),
    ).toMatchObject([{ type: 'bounced', bounceType: 'soft' }]);
    expect(
      sesEventToDeliveryEvents(
        'e3',
        JSON.stringify({
          notificationType: 'Complaint',
          mail,
          complaint: { complaintFeedbackType: 'abuse' },
        }),
        at,
      ),
    ).toMatchObject([{ type: 'complained', detail: 'abuse' }]);
    expect(sesEventToDeliveryEvents('e4', JSON.stringify({ eventType: 'Open', mail }), at)).toEqual([]);
    expect(
      sesEventToDeliveryEvents(
        'e5',
        JSON.stringify({ eventType: 'Delivery', mail: { messageId: 'x', tags: {} } }),
        at,
      ),
    ).toEqual([]);
  });
  it('only trusts HTTPS certificates on sns.<region>.amazonaws.com, issued to sns.amazonaws.com and valid', async () => {
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/cert.pem')).toBe(true);
    expect(isSnsUrl('http://sns.eu-west-1.amazonaws.com/cert.pem')).toBe(false);
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com.evil.test/cert.pem')).toBe(false);
    expect(isSnsUrl('https://sns.eu-west-1.amazonaws.com/cert.txt')).toBe(false);
    const pem = readFileSync(new URL('./fixtures/synthetic-sns-cert.pem', import.meta.url), 'utf8');
    const otherPem = readFileSync(new URL('./fixtures/synthetic-other-cert.pem', import.meta.url), 'utf8');
    const url = 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-synthetic.pem';
    const served = fakeFetch(() => new Response(pem));
    const keys = snsCertKeys(served.fn, () => new Date('2030-01-01T00:00:00Z'));
    expect((await keys(url)).asymmetricKeyType).toBe('rsa');
    await keys(url);
    expect(served.calls).toHaveLength(1);
    await expect(
      snsCertKeys(fakeFetch(() => new Response(otherPem)).fn, () => new Date('2030-01-01'))(url),
    ).rejects.toThrow(/subject/);
    await expect(snsCertKeys(served.fn, () => new Date('2040-01-01'))(url)).rejects.toThrow(/expired/);
    const never = fakeFetch(() => new Response(pem));
    await expect(snsCertKeys(never.fn)('https://evil.test/x.pem')).rejects.toThrow(/certificate URL/);
    expect(never.calls).toHaveLength(0);
  });
});

describe('Twilio', () => {
  const TOKEN = 'synthetic-auth-token';
  const statusUrl = `https://app.yayatoh.test/api/webhooks/sms/twilio?m=${MSG}`;
  const inboundUrl = 'https://app.yayatoh.test/api/webhooks/sms/twilio/inbound';
  const form = (p: Record<string, string>) => new URLSearchParams(p).toString();
  const signedReq = (url: string, params: Record<string, string>, token = TOKEN) => ({
    rawBody: form(params),
    url,
    headers: headers({ 'x-twilio-signature': twilioSignature(token, url, Object.entries(params)) }),
  });
  const adapter = twilioWebhookAdapter({ authToken: TOKEN, now: () => NOW });

  it("matches Twilio's documented signature example", () => {
    // From Twilio's "Webhooks security" documentation.
    expect(
      twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', [
        ['CallSid', 'CA1234567890ABCDE'],
        ['Caller', '+12349013030'],
        ['Digits', '1234'],
        ['From', '+12349013030'],
        ['To', '+18005551212'],
      ]),
    ).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  });
  it('verifies status callbacks and maps delivered / undelivered by error code', async () => {
    const delivered = await adapter.verify(
      signedReq(statusUrl, { MessageSid: 'SM1', MessageStatus: 'delivered' }),
    );
    expect(delivered.events).toMatchObject([
      { id: 'SM1:delivered', type: 'delivered', messageId: MSG, providerMessageId: 'SM1' },
    ]);
    const hard = await adapter.verify(
      signedReq(statusUrl, { MessageSid: 'SM2', MessageStatus: 'undelivered', ErrorCode: '30006' }),
    );
    expect(hard.events).toMatchObject([
      { type: 'bounced', bounceType: 'hard', detail: 'twilio undelivered 30006' },
    ]);
    const soft = await adapter.verify(
      signedReq(statusUrl, { MessageSid: 'SM3', MessageStatus: 'failed', ErrorCode: '30003' }),
    );
    expect(soft.events).toMatchObject([{ bounceType: 'soft' }]);
    // Our sender's fault (10DLC): not the number's, so no delivery event.
    const sender = await adapter.verify(
      signedReq(statusUrl, { MessageSid: 'SM4', MessageStatus: 'undelivered', ErrorCode: '30034' }),
    );
    expect(sender.events).toEqual([]);
    const sent = await adapter.verify(signedReq(statusUrl, { MessageSid: 'SM5', MessageStatus: 'sent' }));
    expect(sent.events).toEqual([]);
  });
  it('refuses wrong, missing and re-targeted signatures; a replay is the same event id', async () => {
    const params = { MessageSid: 'SM1', MessageStatus: 'delivered' };
    expect(await failure(adapter.verify(signedReq(statusUrl, params, 'wrong-token')))).toBe('invalid');
    expect(await failure(adapter.verify({ ...signedReq(statusUrl, params), headers: headers({}) }))).toBe(
      'missing',
    );
    // Signed for one message, replayed against another message id in the URL.
    const other = signedReq(statusUrl, params);
    expect(
      await failure(
        adapter.verify({ ...other, url: statusUrl.replace(MSG, '0190f3a2-7c1d-7e55-9a4b-000000000000') }),
      ),
    ).toBe('invalid');
    // Tampered body.
    expect(
      await failure(adapter.verify({ ...other, rawBody: form({ ...params, MessageStatus: 'failed' }) })),
    ).toBe('invalid');
    // A replay carries the same (sid, status) id, which the webhook deduplicates.
    const a = await adapter.verify(signedReq(statusUrl, params));
    const b = await adapter.verify(signedReq(statusUrl, params));
    expect(a.events[0]?.id).toBe(b.events[0]?.id);
  });
  it('verifies JSON bodies with bodySHA256', async () => {
    const raw = JSON.stringify({ hello: 'world' });
    const url = `https://app.yayatoh.test/api/webhooks/sms/twilio?bodySHA256=${createHash('sha256').update(raw).digest('hex')}`;
    const sig = twilioSignature(TOKEN, url, []);
    await expect(
      adapter.verify({ rawBody: raw, url, headers: headers({ 'x-twilio-signature': sig }) }),
    ).resolves.toEqual({
      events: [],
      inbound: [],
    });
    expect(
      await failure(
        adapter.verify({ rawBody: `${raw} `, url, headers: headers({ 'x-twilio-signature': sig }) }),
      ),
    ).toBe('invalid');
  });
  it('turns inbound STOP / HELP / START into keywords (Advanced Opt-Out or the text)', async () => {
    const stop = await adapter.verify(
      signedReq(inboundUrl, {
        MessageSid: 'SMin1',
        From: '+15125550100',
        To: '+15125550199',
        Body: ' Stop! ',
        MessagingServiceSid: 'MG1',
      }),
    );
    expect(stop.inbound).toEqual([
      {
        id: 'SMin1',
        channel: 'sms',
        keyword: 'stop',
        from: '+15125550100',
        senderRef: 'MG1',
        receivedAt: NOW,
      },
    ]);
    const optOut = await adapter.verify(
      signedReq(inboundUrl, { MessageSid: 'SMin2', From: '+15125550100', Body: 'arret', OptOutType: 'HELP' }),
    );
    expect(optOut.inbound[0]?.keyword).toBe('help');
    const chat = await adapter.verify(
      signedReq(inboundUrl, { MessageSid: 'SMin3', From: '+15125550100', Body: 'see you there' }),
    );
    expect(chat.inbound).toEqual([]);
  });
  it('sends through the org or platform Messaging Service with our status callback', async () => {
    const f = fakeFetch(() => json(201, { sid: 'SM123', status: 'accepted' }));
    const t = twilioSmsTransport({
      accountSid: 'AC00000000000000000000000000000000',
      apiKeySid: 'SK1',
      apiKeySecret: 'secret',
      authToken: TOKEN,
      messagingServiceSid: 'MG00000000000000000000000000000000',
      callbackOrigin: 'https://app.yayatoh.test',
      fetch: f.fn,
    });
    expect(await t.send({ to: '+15125550100', body: 'Hi', idempotencyKey: MSG })).toEqual({
      providerMessageId: 'SM123',
      provider: 'twilio',
    });
    const body = new URLSearchParams(String(f.calls[0]?.init?.body));
    expect(body.get('MessagingServiceSid')).toBe('MG00000000000000000000000000000000');
    expect(body.get('StatusCallback')).toBe(statusUrl);
    await t.send({
      to: '+15125550100',
      body: 'Hi',
      idempotencyKey: MSG,
      sender: { messagingServiceSid: 'MG11111111111111111111111111111111' },
    });
    expect(new URLSearchParams(String(f.calls[1]?.init?.body)).get('MessagingServiceSid')).toBe(
      'MG11111111111111111111111111111111',
    );
  });
  it('maps Twilio errors: invalid number, opted out, refused, retry', async () => {
    const send = (status: number, code?: number) =>
      twilioSmsTransport({
        accountSid: 'AC1',
        apiKeySid: 'SK1',
        apiKeySecret: 's',
        authToken: TOKEN,
        messagingServiceSid: 'MG1',
        callbackOrigin: 'https://app.yayatoh.test',
        fetch: fakeFetch(() => json(status, code ? { code } : {})).fn,
      }).send({ to: '+15125550100', body: 'x', idempotencyKey: MSG });
    await expect(send(400, 21614)).rejects.toMatchObject({ code: 'invalid_address' });
    await expect(send(400, 21610)).rejects.toMatchObject({ code: 'opted_out' });
    await expect(send(400, 21602)).rejects.toMatchObject({ code: 'rejected' });
    await expect(send(503)).rejects.not.toBeInstanceOf(ProviderRejection);
  });
  it('reads the 10DLC campaign status; the fake is deterministic', async () => {
    const status = (compliance: unknown[]) =>
      twilioSenderStatus({
        apiKeySid: 'SK',
        apiKeySecret: 's',
        fetch: fakeFetch(() => json(200, { compliance })).fn,
      }).campaignStatus('MG00000000000000000000000000000000');
    expect(await status([{ campaign_status: 'VERIFIED' }])).toBe('verified');
    expect(await status([{ campaign_status: 'IN_PROGRESS' }])).toBe('pending');
    expect(await status([{ campaign_status: 'FAILED' }])).toBe('failed');
    expect(await status([])).toBe('not_registered');
    expect(await fakeSenderStatus().campaignStatus('MG0000000000000000000000000000000f')).toBe('failed');
    expect(await fakeSenderStatus().campaignStatus('MG0000000000000000000000000000000e')).toBe('pending');
    expect(await fakeSenderStatus().campaignStatus('MG00000000000000000000000000000001')).toBe('verified');
  });
});

describe('WhatsApp Cloud API', () => {
  const SECRET = 'synthetic-app-secret';
  const adapter = whatsappCloudWebhookAdapter({ appSecret: SECRET, now: () => NOW });
  const payload = (value: unknown) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }],
    });
  const signedReq = (raw: string, secret = SECRET) => ({
    rawBody: raw,
    url: 'https://app.yayatoh.test/api/webhooks/whatsapp/cloud',
    headers: headers({ 'x-hub-signature-256': metaSignature(secret, raw) }),
  });
  const statuses = (list: unknown[]) => payload({ metadata: { phone_number_id: '1098765' }, statuses: list });

  it('verifies X-Hub-Signature-256 and maps statuses (read = delivered, one event)', async () => {
    const raw = statuses([
      { id: 'wamid.A', status: 'sent', timestamp: '1790683200', biz_opaque_callback_data: MSG },
      { id: 'wamid.A', status: 'delivered', timestamp: '1790683210', biz_opaque_callback_data: MSG },
      { id: 'wamid.A', status: 'read', timestamp: '1790683220', biz_opaque_callback_data: MSG },
    ]);
    const out = await adapter.verify(signedReq(raw));
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ id: 'wamid.A:delivered', type: 'delivered', messageId: MSG });
  });
  it('a failed status: not on WhatsApp is a hard failure; template errors are ours', async () => {
    const out = await adapter.verify(
      signedReq(
        statuses([
          { id: 'wamid.B', status: 'failed', biz_opaque_callback_data: MSG, errors: [{ code: 131026 }] },
          { id: 'wamid.C', status: 'failed', biz_opaque_callback_data: MSG, errors: [{ code: 132001 }] },
          { id: 'wamid.D', status: 'failed', biz_opaque_callback_data: 'not-ours' },
        ]),
      ),
    );
    expect(out.events).toMatchObject([{ id: 'wamid.B:failed', type: 'bounced', bounceType: 'hard' }]);
    expect(
      cloudStatusToEvent({ id: 'w', status: 'failed', biz_opaque_callback_data: MSG, errors: [{ code: 1 }] }),
    ).toMatchObject({
      bounceType: 'soft',
    });
  });
  it('refuses wrong, missing and malformed signatures and tampered bodies', async () => {
    const raw = statuses([{ id: 'wamid.A', status: 'delivered', biz_opaque_callback_data: MSG }]);
    expect(await failure(adapter.verify(signedReq(raw, 'other-secret')))).toBe('invalid');
    expect(await failure(adapter.verify({ ...signedReq(raw), headers: headers({}) }))).toBe('missing');
    expect(
      await failure(
        adapter.verify({ ...signedReq(raw), headers: headers({ 'x-hub-signature-256': 'sha1=abc' }) }),
      ),
    ).toBe('malformed');
    expect(
      await failure(adapter.verify({ ...signedReq(raw), rawBody: raw.replace('delivered', 'failed') })),
    ).toBe('invalid');
  });
  it('a replayed delivery has the same event id (deduplicated downstream)', async () => {
    const raw = statuses([{ id: 'wamid.A', status: 'delivered', biz_opaque_callback_data: MSG }]);
    const a = await adapter.verify(signedReq(raw));
    const b = await adapter.verify(signedReq(raw));
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
  });
  it('inbound STOP (text or quick-reply button) becomes a keyword', async () => {
    const out = await adapter.verify(
      signedReq(
        payload({
          metadata: { phone_number_id: '1098765' },
          messages: [
            {
              id: 'wamid.in1',
              from: '15125550100',
              timestamp: '1790683200',
              type: 'text',
              text: { body: 'STOP' },
            },
            { id: 'wamid.in2', from: '15125550101', type: 'button', button: { text: 'Stop' } },
            { id: 'wamid.in3', from: '15125550102', type: 'text', text: { body: 'thanks!' } },
          ],
        }),
      ),
    );
    expect(out.inbound.map((k) => [k.id, k.keyword, k.from, k.senderRef])).toEqual([
      ['wamid.in1', 'stop', '+15125550100', '1098765'],
      ['wamid.in2', 'stop', '+15125550101', '1098765'],
    ]);
  });
  it("answers Meta's subscription challenge only with the verify token", () => {
    const url = (token: string) =>
      `https://app.yayatoh.test/api/webhooks/whatsapp/cloud?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=1158201444`;
    expect(metaChallenge('verify-me', url('verify-me'))).toBe('1158201444');
    expect(metaChallenge('verify-me', url('nope'))).toBeNull();
    expect(metaChallenge('', url(''))).toBeNull();
  });
  it('sends utility templates with the org name and text, and our id for callbacks', async () => {
    const f = fakeFetch(() => json(200, { messages: [{ id: 'wamid.OUT' }] }));
    const t = whatsappCloudTransport({
      accessToken: 't',
      phoneNumberId: '1098765',
      appSecret: SECRET,
      verifyToken: 'v',
      fetch: f.fn,
    });
    expect(
      await t.send({
        to: '+15125550100',
        body: 'Doors at 7',
        category: 'utility',
        idempotencyKey: MSG,
        locale: 'ar',
        orgName: 'Lakeside',
      }),
    ).toEqual({ providerMessageId: 'wamid.OUT', provider: 'whatsapp_cloud' });
    expect(f.calls[0]?.url).toBe('https://graph.facebook.com/v23.0/1098765/messages');
    const body = JSON.parse(String(f.calls[0]?.init?.body));
    expect(body).toMatchObject({
      to: '15125550100',
      type: 'template',
      biz_opaque_callback_data: MSG,
      template: {
        name: 'yayatoh_update',
        language: { code: 'ar' },
        components: [{ type: 'body', parameters: [{ text: 'Lakeside' }, { text: 'Doors at 7' }] }],
      },
    });
    // The org's own number when it has one.
    await t.send({
      to: '+1',
      body: 'x',
      category: 'utility',
      idempotencyKey: MSG,
      sender: { route: 'cloud', phoneNumberId: '555000' },
    });
    expect(f.calls[1]?.url).toBe('https://graph.facebook.com/v23.0/555000/messages');
  });
  it('maps Cloud API errors: not on WhatsApp, refused, retry', async () => {
    const send = (status: number, code: number) =>
      whatsappCloudTransport({
        accessToken: 't',
        phoneNumberId: '1',
        appSecret: 's',
        verifyToken: 'v',
        fetch: fakeFetch(() => json(status, { error: { code } })).fn,
      }).send({ to: '+15125550100', body: 'x', category: 'utility', idempotencyKey: MSG });
    await expect(send(400, 131026)).rejects.toMatchObject({ code: 'not_on_channel' });
    await expect(send(400, 132001)).rejects.toMatchObject({ code: 'rejected' });
    await expect(send(400, 130429)).rejects.not.toBeInstanceOf(ProviderRejection);
    await expect(send(500, 1)).rejects.not.toBeInstanceOf(ProviderRejection);
  });
  it('templates cut long text on a character boundary', () => {
    const long = '😀'.repeat(2000);
    const tpl = whatsappTemplate({ to: '+1', body: long, category: 'utility', idempotencyKey: MSG });
    expect([...(tpl.components[0]?.parameters[1]?.text ?? '')]).toHaveLength(1024);
    expect(tpl.language.code).toBe('en_US');
  });
});

describe("the owner's WhatsApp gateway", () => {
  const cfg = { keyId: 'key-1', secret: 'synthetic-gateway-secret', now: () => NOW };
  const adapter = whatsappGatewayWebhookAdapter(cfg);
  const t = Math.floor(NOW.getTime() / 1000);
  const body = JSON.stringify({
    events: [{ id: 'ev1', reference: MSG, message_id: 'gw-1', status: 'failed', error: 'not_on_whatsapp' }],
    inbound: [{ id: 'in1', from: '+15125550100', text: 'STOP', sender: 'pani-main' }],
  });
  const signedReq = (raw: string, ts = t, secret = cfg.secret, key = cfg.keyId) => ({
    rawBody: raw,
    url: 'https://app.yayatoh.test/api/webhooks/whatsapp/gateway',
    headers: headers({
      'x-pani-key': key,
      'x-pani-timestamp': String(ts),
      'x-pani-signature': gatewaySignature(secret, ts, raw),
    }),
  });
  it('verifies signed callbacks and maps events and keywords', async () => {
    const out = await adapter.verify(signedReq(body));
    expect(out.events).toMatchObject([{ id: 'gw:ev1', type: 'bounced', bounceType: 'hard', messageId: MSG }]);
    expect(out.inbound).toMatchObject([
      { id: 'gw:in1', keyword: 'stop', from: '+15125550100', senderRef: 'pani-main' },
    ]);
  });
  it('refuses wrong, missing, other-key and replayed (older than 5 minutes) callbacks', async () => {
    expect(await failure(adapter.verify(signedReq(body, t, 'wrong')))).toBe('invalid');
    expect(await failure(adapter.verify(signedReq(body, t, cfg.secret, 'key-2')))).toBe('invalid');
    expect(await failure(adapter.verify({ ...signedReq(body), headers: headers({}) }))).toBe('missing');
    expect(await failure(adapter.verify(signedReq(body, t - 301)))).toBe('replayed');
    expect(
      await failure(adapter.verify({ ...signedReq(body), rawBody: body.replace('failed', 'delivered') })),
    ).toBe('invalid');
  });
  it('signs sends with the key id, timestamp and HMAC of timestamp.body', async () => {
    const f = fakeFetch(() => json(200, { id: 'gw-out-1' }));
    const g = whatsappGatewayTransport({
      baseUrl: 'https://whatsapp.gateway.test/',
      keyId: 'key-1',
      secret: cfg.secret,
      callbackOrigin: 'https://app.yayatoh.test',
      fetch: f.fn,
      now: () => NOW,
    });
    expect(
      await g.send({
        to: '+15125550100',
        body: 'Hi',
        category: 'utility',
        idempotencyKey: MSG,
        orgName: 'Lakeside',
      }),
    ).toEqual({
      providerMessageId: 'gw-out-1',
      provider: 'whatsapp_gateway',
    });
    const call = f.calls[0];
    expect(call?.url).toBe('https://whatsapp.gateway.test/v1/messages');
    const h = call?.init?.headers as Record<string, string>;
    const raw = String(call?.init?.body);
    expect(h['x-pani-signature']).toBe(
      `v1=${createHmac('sha256', cfg.secret).update(`${t}.${raw}`).digest('hex')}`,
    );
    expect(JSON.parse(raw)).toMatchObject({
      reference: MSG,
      template: 'yayatoh_update',
      callback_url: 'https://app.yayatoh.test/api/webhooks/whatsapp/gateway',
    });
    const refused = whatsappGatewayTransport({
      baseUrl: 'https://whatsapp.gateway.test',
      keyId: 'k',
      secret: 's',
      callbackOrigin: 'https://app.yayatoh.test',
      fetch: fakeFetch(() => json(422, { error: 'not_on_whatsapp' })).fn,
    });
    await expect(
      refused.send({ to: '+1', body: 'x', category: 'utility', idempotencyKey: MSG }),
    ).rejects.toMatchObject({
      code: 'not_on_channel',
    });
  });
  it('one port, two adapters: the org route, else the default', async () => {
    const seen: string[] = [];
    const mk = (name: string) => ({
      send: async () => {
        seen.push(name);
        return { providerMessageId: name };
      },
    });
    const router = routedWhatsAppTransport({
      cloud: mk('cloud'),
      gateway: mk('gateway'),
      defaultRoute: 'cloud',
    });
    const m = { to: '+1', body: 'x', category: 'utility' as const, idempotencyKey: MSG };
    expect((await router.send(m)).provider).toBe('whatsapp_cloud');
    expect((await router.send({ ...m, sender: { route: 'gateway' } })).provider).toBe('whatsapp_gateway');
    expect(seen).toEqual(['cloud', 'gateway']);
    await expect(routedWhatsAppTransport({ cloud: null, defaultRoute: 'cloud' }).send(m)).rejects.toThrow(
      /no WhatsApp cloud/,
    );
  });

  it('attributes a routed send error to the real provider (provider health), not the router', async () => {
    const refused = new ProviderRejection('not_on_channel', '131026');
    const router = routedWhatsAppTransport({
      cloud: { send: async () => ({ providerMessageId: 'c' }) },
      gateway: {
        send: async () => {
          throw refused;
        },
      },
      defaultRoute: 'gateway',
    });
    const m = { to: '+1', body: 'x', category: 'utility' as const, idempotencyKey: MSG };
    const err = await router.send(m).catch((e: unknown) => e);
    expect(err).toBe(refused);
    expect(isProviderRejection(err)).toBe(true);
    expect(errorProvider(err)).toBe('whatsapp_gateway');
    const missing = await routedWhatsAppTransport({ defaultRoute: 'cloud' })
      .send(m)
      .catch((e: unknown) => e);
    expect(errorProvider(missing)).toBe('whatsapp_cloud');
    expect(errorProvider(new Error('plain'))).toBeUndefined();
  });
});

describe('keywords', () => {
  it('recognises the opt-out, opt-in and help words alone', () => {
    for (const w of [
      'STOP',
      'stop',
      ' Stop. ',
      'StopAll',
      'unsubscribe',
      'CANCEL',
      'end',
      'quit',
      'Revoke',
      'opt out',
      'OPTOUT',
    ])
      expect(parseKeyword(w)).toBe('stop');
    for (const w of ['START', 'unstop', 'Yes']) expect(parseKeyword(w)).toBe('start');
    for (const w of ['HELP', 'info?']) expect(parseKeyword(w)).toBe('help');
    for (const w of ['please stop texting me', 'stopping by', '', null, 'thanks'])
      expect(parseKeyword(w)).toBeNull();
  });
  it('the help reply names the sender and how to stop', () => {
    expect(helpReply('Lakeside', 'https://yayatoh.com/help')).toMatch(
      /^Lakeside via Yayatoh: .*Reply STOP to opt out\. Help: https:\/\/yayatoh\.com\/help$/,
    );
    expect(helpReply(null, 'https://yayatoh.com/help')).toMatch(/^Yayatoh: /);
  });
});

describe('fallback chains', () => {
  it('WhatsApp → SMS → email for tickets, reminders and updates; marketing never falls back', () => {
    expect(FALLBACK_CHAINS.transactional).toEqual(['whatsapp', 'sms', 'email']);
    expect(planFallback({ category: 'reminders', channel: 'whatsapp', reason: 'not_on_whatsapp' })).toEqual([
      'sms',
      'email',
    ]);
    expect(planFallback({ category: 'event_updates', channel: 'sms', reason: 'undelivered' })).toEqual([
      'email',
    ]);
    expect(
      planFallback({ category: 'marketing', channel: 'whatsapp', reason: 'not_on_whatsapp' }),
    ).toBeNull();
    expect(planFallback({ category: 'sales', channel: 'push', reason: 'no_device' })).toEqual(['email']);
  });
  it('the end of a chain, or a channel outside it, has nothing next', () => {
    expect(planFallback({ category: 'transactional', channel: 'email', reason: 'bounced' })).toBeNull();
    expect(planFallback({ category: 'transactional', channel: 'push', reason: 'no_device' })).toBeNull();
  });
  it("never for the person's own choices, the rules or holds", () => {
    for (const reason of [
      'unsubscribed',
      'preference',
      'consent_missing',
      'consent_withdrawn',
      'whatsapp_marketing_us',
      'opted_out',
      'complained',
      'erased',
      'quiet_hours',
      'frequency_cap',
      'quota_reached',
      'messaging_paused',
      null,
    ])
      expect(planFallback({ category: 'transactional', channel: 'whatsapp', reason })).toBeNull();
    for (const reason of [
      'no_address',
      'not_on_whatsapp',
      'invalid_number',
      'provider_error',
      'undelivered',
      'no_device',
      'bounced',
    ])
      expect(isFallbackReason(reason)).toBe(true);
  });
});

describe('provider config', () => {
  const env = {
    EMAIL_PROVIDER: 'ses',
    AWS_SES_REGION: 'us-east-1',
    AWS_SES_ACCESS_KEY_ID: 'x',
    AWS_SES_SECRET_ACCESS_KEY: 'x',
    SES_CONFIGURATION_SET: 'x',
    SES_SNS_TOPIC_ARN: 'x',
    WHATSAPP_PROVIDER: 'gateway, cloud',
    WHATSAPP_GATEWAY_URL: 'https://x',
  };
  it('a provider is live only when switched on and fully configured', () => {
    expect(providerMode('ses', env)).toBe('live');
    expect(providerMode('ses', { ...env, EMAIL_PROVIDER: '' })).toBe('ready');
    expect(providerMode('twilio', env)).toBe('off');
    expect(missingEnv('whatsapp_gateway', env)).toEqual([
      'WHATSAPP_GATEWAY_KEY_ID',
      'WHATSAPP_GATEWAY_SECRET',
    ]);
    expect(providerMode('whatsapp_gateway', env)).toBe('off');
    expect(whatsappRoutes(env)).toEqual(['gateway', 'cloud']);
    expect(switchedOn('whatsapp_cloud', env)).toBe(true);
    expect(switchedOn('twilio', {})).toBe(false);
  });
});

describe('provider selection by config names', () => {
  const ses = {
    EMAIL_PROVIDER: 'ses',
    AWS_SES_REGION: 'us-east-1',
    AWS_SES_ACCESS_KEY_ID: 'x',
    AWS_SES_SECRET_ACCESS_KEY: 'x',
    SES_CONFIGURATION_SET: 'set',
    SES_SNS_TOPIC_ARN: 'arn:aws:sns:us-east-1:1:t',
  };
  const twilio = {
    SMS_PROVIDER: 'twilio',
    TWILIO_ACCOUNT_SID: 'AC1',
    TWILIO_API_KEY_SID: 'SK1',
    TWILIO_API_KEY_SECRET: 's',
    TWILIO_AUTH_TOKEN: 't',
    TWILIO_MESSAGING_SERVICE_SID: 'MG1',
  };
  const wa = {
    WHATSAPP_PROVIDER: 'gateway,cloud',
    WHATSAPP_CLOUD_ACCESS_TOKEN: 't',
    WHATSAPP_CLOUD_PHONE_NUMBER_ID: '1',
    WHATSAPP_CLOUD_APP_SECRET: 's',
    WHATSAPP_CLOUD_VERIFY_TOKEN: 'v',
    WHATSAPP_GATEWAY_URL: 'https://gw.test',
    WHATSAPP_GATEWAY_KEY_ID: 'k',
    WHATSAPP_GATEWAY_SECRET: 's',
  };
  it('only live providers replace the fallback transports, channel by channel', () => {
    const base = memoryTransports().transports;
    expect(liveTransports({}, 'https://app.test', base)).toMatchObject({ email: base.email, sms: base.sms });
    const live = liveTransports({ ...ses, ...twilio, ...wa }, 'https://app.test', base);
    expect(live?.email.name).toBe('ses');
    expect(live?.sms?.name).toBe('twilio');
    expect(live?.whatsapp?.name).toBe('whatsapp_router');
    expect(live?.push).toBe(base.push);
    // Production without a live email provider sends nothing.
    expect(liveTransports({ ...twilio }, 'https://app.test', null)).toBeNull();
  });
  it('webhook endpoints answer only for live providers', () => {
    expect(liveWebhookAdapter('email', 'ses', {})).toBeNull();
    expect(liveWebhookAdapter('email', 'ses', ses)?.name).toBe('ses');
    expect(liveWebhookAdapter('sms', 'twilio', twilio)?.name).toBe('twilio');
    expect(liveWebhookAdapter('sms', 'twilio', { ...twilio, TWILIO_AUTH_TOKEN: '' })).toBeNull();
    expect(liveWebhookAdapter('whatsapp', 'cloud', wa)?.name).toBe('whatsapp_cloud');
    expect(liveWebhookAdapter('whatsapp', 'gateway', wa)?.name).toBe('whatsapp_gateway');
    expect(liveWebhookAdapter('whatsapp', 'other', wa)).toBeNull();
    expect(whatsappVerifyToken(wa)).toBe('v');
    expect(whatsappVerifyToken({})).toBeNull();
  });
  it('identities and 10DLC status: real when live, fakes outside production, none in production', () => {
    expect(identityPortFromEnv(ses)?.name).toBe('ses');
    expect(identityPortFromEnv({})?.name).toBe('fake');
    expect(identityPortFromEnv({ VERCEL_ENV: 'production' })).toBeNull();
    expect(senderStatusFromEnv(twilio)?.name).toBe('twilio');
    expect(senderStatusFromEnv({ NODE_ENV: 'production' })).toBeNull();
    expect(senderStatusFromEnv({ NODE_ENV: 'production', YAYATOH_DEV_AUTH: '1' })?.name).toBe('fake');
  });
});
