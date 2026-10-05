import type { OutboundEmail } from '../transports.ts';
import { type AwsCredentials, signAwsRequest } from './sigv4.ts';
import { type Fetch, ProviderRejection } from './types.ts';

/**
 * Amazon SES v2 (M3.5b): sending, and per-org sending identities (Easy DKIM, a custom MAIL FROM
 * domain, and a DMARC check through DNS). Every send carries our message id and the org as
 * message tags and uses the configuration set whose event destination is the SNS topic behind
 * `/api/webhooks/email/ses` (delivery, bounce, complaint).
 */
export interface SesConfig {
  readonly region: string;
  readonly credentials: AwsCredentials;
  /** The configuration set with the SNS event destination (`SES_CONFIGURATION_SET`). */
  readonly configurationSet: string;
  readonly fetch?: Fetch;
  readonly now?: () => Date;
}

/** Message tags on every send; SNS notifications carry them back (`mail.tags`). */
export const SES_TAG_MESSAGE = 'yayatoh-message';
export const SES_TAG_ORG = 'yayatoh-org';

const endpoint = (region: string) => `https://email.${region}.amazonaws.com`;

/** `"Name" <address>`, RFC 2047 encoded when the name is not plain ASCII. */
export function formatFrom(name: string, address: string): string {
  const clean = name.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return address;
  if (/^[\x20-\x7e]*$/.test(clean)) return `"${clean.replace(/(["\\])/g, '\\$1')}" <${address}>`;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?= <${address}>`;
}

async function call(
  cfg: SesConfig,
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = `${endpoint(cfg.region)}${path}`;
  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers = signAwsRequest({
    method,
    url,
    region: cfg.region,
    service: 'ses',
    headers: { 'content-type': 'application/json' },
    body: payload,
    credentials: cfg.credentials,
    now: cfg.now?.() ?? new Date(),
  });
  delete headers.host;
  const res = await (cfg.fetch ?? fetch)(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: payload }),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

/** SES error types that will never succeed on retry. */
const PERMANENT = new Set([
  'MessageRejected',
  'BadRequestException',
  'MailFromDomainNotVerifiedException',
  'NotFoundException',
]);

const errorType = (res: { json: Record<string, unknown> }, fallback: string) =>
  String(res.json.__type ?? res.json.code ?? fallback)
    .split('#')
    .pop() ?? fallback;

export interface SesSendExtra {
  readonly orgId?: string | null;
}

/** The SES email adapter behind `EmailTransport`. */
export function sesEmailTransport(cfg: SesConfig) {
  return {
    name: 'ses' as const,
    async send(m: OutboundEmail & SesSendExtra) {
      const from = m.sender?.address ?? m.from.address;
      const res = await call(cfg, 'POST', '/v2/email/outbound-emails', {
        FromEmailAddress: formatFrom(m.from.name, from),
        Destination: { ToAddresses: [m.to] },
        ...(m.replyTo ? { ReplyToAddresses: [m.replyTo] } : {}),
        Content: {
          Simple: {
            Subject: { Data: m.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: m.html, Charset: 'UTF-8' }, Text: { Data: m.text, Charset: 'UTF-8' } },
            Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })),
          },
        },
        ConfigurationSetName: m.sender?.configurationSet ?? cfg.configurationSet,
        EmailTags: [
          { Name: SES_TAG_MESSAGE, Value: m.idempotencyKey },
          ...(m.orgId ? [{ Name: SES_TAG_ORG, Value: m.orgId }] : []),
        ],
      });
      if (res.status >= 200 && res.status < 300 && typeof res.json.MessageId === 'string')
        return { providerMessageId: res.json.MessageId, provider: 'ses' as const };
      const type = errorType(res, `HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429 && PERMANENT.has(type))
        throw new ProviderRejection('rejected', type);
      throw new Error(`ses: ${type}`);
    },
  };
}

export const CHECK_STATUSES = ['pending', 'verified', 'failed', 'missing'] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface DnsRecord {
  readonly type: 'CNAME' | 'MX' | 'TXT';
  readonly name: string;
  readonly value: string;
  /** Which check the record serves. */
  readonly purpose: 'dkim' | 'spf' | 'dmarc';
}

export interface IdentityStatus {
  readonly dkim: CheckStatus;
  readonly spf: CheckStatus;
  readonly records: DnsRecord[];
  /** The identity's reference at the provider (SES identity name). */
  readonly providerRef: string;
}

/** Sending identities per org: SES in production, the fake below in development and CI. */
export interface SendingIdentityPort {
  readonly name: 'ses' | 'fake';
  create(domain: string): Promise<IdentityStatus>;
  status(domain: string): Promise<IdentityStatus>;
  remove(domain: string): Promise<void>;
}

/** The custom MAIL FROM (bounce) subdomain: SPF passes for it and it aligns with DMARC. */
export const mailFromDomain = (domain: string) => `bounce.${domain}`;

export function identityRecords(domain: string, dkimTokens: readonly string[], region: string): DnsRecord[] {
  return [
    ...dkimTokens.map(
      (t): DnsRecord => ({
        type: 'CNAME',
        name: `${t}._domainkey.${domain}`,
        value: `${t}.dkim.amazonses.com`,
        purpose: 'dkim',
      }),
    ),
    {
      type: 'MX',
      name: mailFromDomain(domain),
      value: `10 feedback-smtp.${region}.amazonses.com`,
      purpose: 'spf',
    },
    { type: 'TXT', name: mailFromDomain(domain), value: 'v=spf1 include:amazonses.com ~all', purpose: 'spf' },
  ];
}

const sesStatus = (s: unknown): CheckStatus =>
  s === 'SUCCESS' ? 'verified' : s === 'FAILED' ? 'failed' : 'pending';

/** SES identities (CreateEmailIdentity + custom MAIL FROM; GetEmailIdentity for the checks). */
export function sesIdentityPort(cfg: SesConfig): SendingIdentityPort {
  const read = (domain: string, json: Record<string, unknown>): IdentityStatus => {
    const dkim = (json.DkimAttributes ?? {}) as { Status?: string; Tokens?: string[] };
    const mailFrom = (json.MailFromAttributes ?? {}) as { MailFromDomainStatus?: string };
    return {
      dkim: sesStatus(dkim.Status),
      spf: sesStatus(mailFrom.MailFromDomainStatus),
      records: identityRecords(domain, dkim.Tokens ?? [], cfg.region),
      providerRef: domain,
    };
  };
  const ensureOk = (res: { status: number; json: Record<string, unknown> }, what: string) => {
    if (res.status < 200 || res.status >= 300)
      throw new Error(`ses ${what}: ${errorType(res, `HTTP ${res.status}`)}`);
  };
  return {
    name: 'ses',
    async create(domain) {
      const res = await call(cfg, 'POST', '/v2/email/identities', {
        EmailIdentity: domain,
        ConfigurationSetName: cfg.configurationSet,
        DkimSigningAttributes: { NextSigningKeyLength: 'RSA_2048_BIT' },
      });
      // Already created (a retry after a timeout): read it instead.
      if (res.status === 400 && errorType(res, '') === 'AlreadyExistsException') return this.status(domain);
      ensureOk(res, 'create identity');
      const mf = await call(cfg, 'PUT', `/v2/email/identities/${encodeURIComponent(domain)}/mail-from`, {
        MailFromDomain: mailFromDomain(domain),
        BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
      });
      ensureOk(mf, 'mail from');
      return read(domain, res.json);
    },
    async status(domain) {
      const res = await call(cfg, 'GET', `/v2/email/identities/${encodeURIComponent(domain)}`, undefined);
      ensureOk(res, 'get identity');
      return read(domain, res.json);
    },
    async remove(domain) {
      const res = await call(cfg, 'DELETE', `/v2/email/identities/${encodeURIComponent(domain)}`, undefined);
      if (res.status === 404) return;
      ensureOk(res, 'delete identity');
    },
  };
}

/**
 * Development and CI: a deterministic stand-in for SES identities. Tokens come from the domain;
 * a domain with a `fail` label fails DKIM, one with a `pending` label stays pending; everything
 * else verifies on the first check after creation.
 */
export function fakeIdentityPort(): SendingIdentityPort {
  const tokens = (domain: string) =>
    [1, 2, 3].map((i) =>
      Buffer.from(`${domain}:${i}`)
        .toString('hex')
        .replace(/[^a-z0-9]/g, '')
        .slice(-32)
        .padStart(32, 'a'),
    );
  const labels = (domain: string) => domain.split('.');
  const check = (domain: string, created: boolean): IdentityStatus => {
    const l = labels(domain);
    const verdict: CheckStatus = created
      ? 'pending'
      : l.includes('fail')
        ? 'failed'
        : l.includes('pending')
          ? 'pending'
          : 'verified';
    return {
      dkim: verdict,
      spf: verdict === 'failed' ? 'pending' : verdict,
      records: identityRecords(domain, tokens(domain), 'us-east-1'),
      providerRef: domain,
    };
  };
  return {
    name: 'fake',
    create: async (domain) => check(domain, true),
    status: async (domain) => check(domain, false),
    remove: async () => undefined,
  };
}

/** DNS TXT lookups (node:dns/promises `resolveTxt` in production; a map in tests). */
export type ResolveTxt = (name: string) => Promise<string[][]>;

export interface DmarcResult {
  readonly status: CheckStatus;
  /** `none`, `quarantine` or `reject`; null when there is no record. */
  readonly policy: string | null;
  /** Where the record was found (the domain or its organizational domain). */
  readonly at: string | null;
}

/** The organizational domain, without a public-suffix list: the last two labels. */
export const organizationalDomain = (domain: string) => domain.split('.').slice(-2).join('.');

/**
 * DMARC for a sending domain: `_dmarc.{domain}`, else the organizational domain's record (RFC
 * 7489 §6.6.3). A record with `p=` counts; `p=none` still passes (monitoring) and is shown.
 */
export async function checkDmarc(domain: string, resolveTxt: ResolveTxt): Promise<DmarcResult> {
  const candidates = [...new Set([domain, organizationalDomain(domain)])];
  for (const d of candidates) {
    let records: string[][] = [];
    try {
      records = await resolveTxt(`_dmarc.${d}`);
    } catch {
      records = [];
    }
    const txt = records.map((r) => r.join('')).find((r) => /^v=DMARC1\b/i.test(r.trim()));
    if (!txt) continue;
    const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i.exec(txt)?.[1]?.toLowerCase();
    return policy ? { status: 'verified', policy, at: d } : { status: 'failed', policy: null, at: d };
  }
  return { status: 'missing', policy: null, at: null };
}

/** The DMARC record we suggest when there is none (monitoring first, reports to the org). */
export const suggestedDmarcRecord = (domain: string): DnsRecord => ({
  type: 'TXT',
  name: `_dmarc.${organizationalDomain(domain)}`,
  value: 'v=DMARC1; p=none;',
  purpose: 'dmarc',
});

/** Development and CI: a domain with a `nodmarc` label has no DMARC record; others `p=none`. */
export const fakeResolveTxt: ResolveTxt = async (name) =>
  name.split('.').includes('nodmarc') ? [] : [['v=DMARC1; p=none;']];
