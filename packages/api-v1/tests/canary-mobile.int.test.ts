import { randomBytes } from 'node:crypto';
import {
  appSignIn,
  bearerSessions,
  createAuth,
  fakeIdTokenVerifier,
  memoryMailer,
  twoFactorService,
} from '@yayatoh/auth';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import { createPortalBearerSession } from '@yayatoh/events';
import { executeCommand } from '@yayatoh/kernel';
import { fakePaymentProvider } from '@yayatoh/payments';
import { createRateLimiter, memoryRateLimitStore } from '@yayatoh/platform/security';
import { addMemberCommand } from '@yayatoh/tenancy';
import { type CanaryOrg, canaryOrg, ports, systemCtx, userCtx } from '@yayatoh/testing';
import {
  type ColumnId,
  DEVICE_API_ALLOW,
  findCanaries,
  formatLeaks,
  ME_ALLOW,
  ME_IDENTITY_ALLOW,
  OPS_ALLOW,
  PORTAL_API_ALLOW,
  type Leak,
  leaksIn,
} from '@yayatoh/testing/canary';
import { issueHolderLinkTx } from '@yayatoh/ticketing';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createV1, openApiDocument } from '../src/index.ts';
import { memoryRateLimiter } from '../src/rate-limit.ts';

/**
 * Leak coverage for everything Phase 7 added to `/v1` (M7.x). The canary org has a canary in every
 * private column of every row; each Phase 7 route is called through the real router with the
 * credential the apps use for it (a signed-in attendee, a Staff app door device, an exhibitor rep, an
 * organizer's session, nobody) and every response is searched for canaries that credential may not
 * see. A final test fails when a Phase 7 route in the OpenAPI document was not reached.
 *
 * It is the HTTP twin of `apps/web/e2e/canary-crawl.spec.ts`, which crawls the older surfaces and
 * the attendee's `/me` routes in a browser against a built server; this one needs no build.
 */
const secret = randomBytes(32).toString('hex');
const { mailer } = memoryMailer();
const auth = createAuth({ baseURL: 'http://localhost:4000', secret, mailer });
const twoFactor = twoFactorService(auth, { mailer });
const verifier = fakeIdTokenVerifier({
  secret: 'e'.repeat(64),
  audiences: { apple: ['com.yayatoh.app'], google: ['google-ios-client'] },
});
const signIn = appSignIn(auth, { mailer, twoFactor, verifier });
const payments = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
const limiter = createRateLimiter(memoryRateLimitStore());
const portalMails: { to: string; params: Record<string, string | number> }[] = [];
const deps = {
  ports,
  sessions: () => bearerSessions(auth),
  appSignIn: () => signIn,
  payments: () => payments,
  telemetry: false,
  rateLimiter: memoryRateLimiter(),
  authLimiter: limiter,
  portalLimiter: limiter,
  checkoutLimiter: limiter,
  portalMail: async (m: { to: string; params: Record<string, string | number> }) => {
    portalMails.push(m);
  },
};
const app = new Hono().route('/v1', createV1(deps));

const admin = adminClient();
const PASSWORD = 'canary-mobile-password-1';
let canary: CanaryOrg;
let ipCounter = 0;

type Kind = 'anonymous' | 'attendee' | 'device' | 'portal' | 'organizer';
const ALLOW: Record<Kind, readonly ColumnId[]> = {
  // Nothing private reaches a stranger, and the sign-in answers carry the identity database's
  // fields only.
  anonymous: [],
  attendee: ME_ALLOW,
  device: DEVICE_API_ALLOW,
  portal: PORTAL_API_ALLOW,
  organizer: OPS_ALLOW,
};
const leaks: Record<Kind, Leak[]> = { anonymous: [], attendee: [], device: [], portal: [], organizer: [] };
const seen: Record<Kind, Set<string>> = {
  anonymous: new Set(),
  attendee: new Set(),
  device: new Set(),
  portal: new Set(),
  organizer: new Set(),
};
/** `METHOD /pattern` of every route reached (the pattern as the OpenAPI document spells it). */
const reached = new Set<string>();

interface Reply {
  status: number;
  text: string;
  body: Record<string, unknown>;
}

async function hit(
  kind: Kind,
  token: string | null,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  pattern: string,
  o: { path?: string; body?: unknown; headers?: Record<string, string>; allow?: readonly ColumnId[] } = {},
): Promise<Reply> {
  const path = o.path ?? pattern;
  // The person's own address is theirs to read on the sign-in and identity routes.
  const identityRoute =
    kind === 'attendee' && (pattern.startsWith('/auth/') || pattern === '/me' || pattern === '/me/organizations');
  const res = await app.request(`/v1${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      'idempotency-key': `canary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      'x-forwarded-for': `10.8.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
      ...(o.headers ?? {}),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  const text = await res.text();
  expect(res.status, `${method} ${path}`).toBeLessThan(500);
  reached.add(`${method} ${pattern}`);
  for (const h of findCanaries(text)) seen[kind].add(h.column);
  leaks[kind].push(
    ...leaksIn(`${method} ${path}`, text, { kind: 'scoped', allow: (o.allow ?? (identityRoute ? ME_IDENTITY_ALLOW : ALLOW[kind])) as ColumnId[] }),
  );
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // Not JSON (a 204, a redirect): nothing to read.
  }
  return { status: res.status, text, body };
}

beforeAll(async () => {
  canary = await canaryOrg({ admin, auth });
}, 240_000);

afterAll(async () => {
  await admin.end();
  await closePools();
});

const asList = (r: Reply) => (r.body.data ?? []) as { id: string }[];

describe('nobody signed in', () => {
  it('the public reads, the config and the refused sign-ins carry no private column', async () => {
    const slug = canary.event.slug;
    await hit('anonymous', null, 'GET', '/mobile/config');
    await hit('anonymous', null, 'GET', '/public/events', { path: '/public/events?q=canary&limit=50' });
    await hit('anonymous', null, 'GET', '/public/events', { path: '/public/events?limit=50&near=41.88,-87.63' });
    await hit('anonymous', null, 'GET', '/public/events/{slug}', { path: `/public/events/${slug}` });
    await hit('anonymous', null, 'GET', '/public/events/{slug}/ticket-types', {
      path: `/public/events/${slug}/ticket-types`,
    });
    // Sign-in attempts that fail say nothing about the account or the org.
    await hit('anonymous', null, 'POST', '/auth/email-code', {
      body: { email: 'nobody-canary@example.test' },
    });
    await hit('anonymous', null, 'POST', '/auth/token', {
      body: { grantType: 'email_code', email: 'nobody-canary@example.test', code: '000000' },
    });
    await hit('anonymous', null, 'POST', '/auth/token', {
      body: { grantType: 'two_factor', challenge: `yyc_${randomBytes(32).toString('base64url')}`, code: '1' },
    });
    await hit('anonymous', null, 'POST', '/auth/revoke', { body: { refreshToken: 'yyr_unknown' } });
    // The portal's sign-in with an invitation that does not exist.
    const invite = 'x'.repeat(60);
    await hit('anonymous', null, 'POST', '/portal/auth/code', { body: { inviteToken: invite } });
    await hit('anonymous', null, 'POST', '/portal/auth/invitations', {
      body: { token: invite, email: 'nobody-canary@example.test' },
    });
    await hit('anonymous', null, 'POST', '/portal/auth/revoke', { body: { refreshToken: 'yyr_unknown' } });
    expect(formatLeaks(leaks.anonymous)).toBe('no canary leaks');
  });

  it('every credentialed route refuses a stranger without a body worth reading', async () => {
    for (const [method, pattern] of [
      ['GET', '/me/tickets'],
      ['GET', '/staff/events/{eventId}/guests'],
      ['GET', '/portal/leads'],
      ['GET', '/orgs/{org}/events/{eventId}/ops'],
    ] as const) {
      const path = pattern
        .replace('{eventId}', canary.event.id)
        .replace('{org}', canary.slug);
      const r = await hit('anonymous', null, method, `${pattern}#refused`, { path });
      expect(r.status, path).toBe(401);
    }
    expect(formatLeaks(leaks.anonymous)).toBe('no canary leaks');
  });
});

describe('a signed-in attendee (the apps’ /v1/me, /v1/claims and checkout)', () => {
  let access = '';
  let refresh = '';
  let ticketId = '';
  let code = '';

  it('signs in and reads only their own columns', async () => {
    const who = canary.attendee as NonNullable<CanaryOrg['attendee']>;
    expect(who, 'the canary org makes the attendee').not.toBeNull();
    const tokens = await hit('attendee', null, 'POST', '/auth/token', {
      body: { grantType: 'password', email: who.email, password: who.password },
    });
    expect(tokens.status).toBe(200);
    access = String(tokens.body.accessToken);
    refresh = String(tokens.body.refreshToken);
    expect(access).not.toBe('');

    await hit('attendee', access, 'GET', '/me');
    await hit('attendee', access, 'GET', '/me/organizations');
    const upcoming = asList(
      await hit('attendee', access, 'GET', '/me/tickets', { path: '/me/tickets?when=upcoming&limit=100' }),
    );
    const past = asList(
      await hit('attendee', access, 'GET', '/me/tickets', { path: '/me/tickets?when=past&limit=100' }),
    );
    const tickets = [...upcoming, ...past];
    expect(tickets.length, 'the attendee holds a canary ticket').toBeGreaterThan(0);
    for (const t of tickets) {
      const detail = await hit('attendee', access, 'GET', '/me/tickets/{id}', { path: `/me/tickets/${t.id}` });
      if (!ticketId && detail.status === 200) {
        ticketId = t.id;
        code = String((detail.body.qrCode as string | undefined) ?? '');
      }
      for (const platform of ['apple', 'google'])
        await hit('attendee', access, 'GET', '/me/tickets/{id}/wallet', {
          path: `/me/tickets/${t.id}/wallet?platform=${platform}`,
        });
      const started = await hit('attendee', access, 'POST', '/me/tickets/{id}/transfers', {
        path: `/me/tickets/${t.id}/transfers`,
        body: { toName: 'Canary Recipient', toEmail: 'canary-recipient@example.test' },
      });
      const transferId = started.body.transferId as string | null | undefined;
      // Put it back as it was: a pending transfer would show on the next answer.
      if (transferId)
        await hit('attendee', access, 'DELETE', '/me/tickets/{id}/transfers/{transferId}', {
          path: `/me/tickets/${t.id}/transfers/${transferId}`,
        });
    }
    const orders = asList(
      await hit('attendee', access, 'GET', '/me/orders', { path: '/me/orders?limit=100' }),
    );
    expect(orders.length, 'the attendee bought a canary order').toBeGreaterThan(0);
    for (const o of orders) {
      await hit('attendee', access, 'GET', '/me/orders/{id}', { path: `/me/orders/${o.id}` });
      await hit('attendee', access, 'POST', '/me/orders/{id}/refund-requests', {
        path: `/me/orders/${o.id}/refund-requests`,
        body: { message: 'Canary refund request' },
      });
    }
    if (who.claimToken) {
      await hit('attendee', access, 'GET', '/claims/{token}', {
        path: `/claims/${encodeURIComponent(who.claimToken)}`,
      });
      // Claiming would move the canary ticket to the attendee for good: only the refusals run.
      await hit('attendee', access, 'POST', '/claims/{token}', {
        path: `/claims/${encodeURIComponent(`${who.claimToken}x`)}`,
      });
    }
    expect(formatLeaks(leaks.attendee)).toBe('no canary leaks');
    // The check is live: the attendee's own columns do come back (and are allowed).
    expect([...seen.attendee]).toEqual(
      expect.arrayContaining(['ticketing.tickets.short_code', 'ticketing.ticket_barcodes.payload']),
    );
  });

  it('the web ticket link opens the same tickets and nothing more', async () => {
    const who = canary.attendee as NonNullable<CanaryOrg['attendee']>;
    const ctx = systemCtx(canary.orgId);
    const link = await withTenant(ctx, (tx) => issueHolderLinkTx(tx, ctx, canary.event.id, who.email));
    await hit('attendee', access, 'GET', '/me/ticket-links/{token}', {
      path: `/me/ticket-links/${encodeURIComponent(link.token)}`,
    });
    // A link for someone else's address is a plain 404.
    const other = await hit('attendee', access, 'GET', '/me/ticket-links/{token}', {
      path: `/me/ticket-links/${'z'.repeat(40)}`,
    });
    expect(other.status).toBe(404);
    expect(formatLeaks(leaks.attendee)).toBe('no canary leaks');
  });

  it('registers and removes a phone, starts a checkout and steps up', async () => {
    const register = await hit('attendee', access, 'POST', '/me/devices', {
      body: {
        platform: 'fcm',
        token: `canary-token-${randomBytes(8).toString('hex')}`,
        appId: 'com.yayatoh.yayatohapp',
        appVersion: '1.0.0',
        locale: 'en',
        timeZone: 'Europe/Lisbon',
      },
    });
    expect(register.status).toBe(200);
    await hit('attendee', access, 'DELETE', '/me/devices/{token}', {
      path: `/me/devices/${encodeURIComponent('canary-token-unknown')}`,
    });

    const types = (
      await hit('attendee', access, 'GET', '/public/events/{slug}/ticket-types', {
        path: `/public/events/${canary.event.slug}/ticket-types`,
      })
    ).body.data as { id: string; priceMinor?: number }[] | undefined;
    const free = types?.find((t) => t.priceMinor === 0) ?? types?.[0];
    expect(free, 'the canary event sells a pass').toBeDefined();
    const checkout = await hit('attendee', access, 'POST', '/public/events/{slug}/checkout', {
      path: `/public/events/${canary.event.slug}/checkout`,
      body: { items: [{ ticketTypeId: free?.id, quantity: 1 }] },
    });
    // Whatever the cart ends as (paid, a payment link, the web, a refusal), no private column leaks.
    expect([200, 201, 400, 403, 409, 429]).toContain(checkout.status);

    await hit('attendee', access, 'POST', '/auth/step-up/start');
    await hit('attendee', access, 'POST', '/auth/step-up', { body: { method: 'password', password: 'wrong' } });
    await hit('attendee', access, 'POST', '/auth/step-up', {
      body: { method: 'password', password: PASSWORD },
    });
    expect(formatLeaks(leaks.attendee)).toBe('no canary leaks');
  });

  it('refreshes, signs out and deletes an account without exposing a column', async () => {
    const who = canary.attendee as NonNullable<CanaryOrg['attendee']>;
    const refreshed = await hit('attendee', null, 'POST', '/auth/token', {
      body: { grantType: 'refresh_token', refreshToken: refresh },
    });
    expect(refreshed.status).toBe(200);
    access = String(refreshed.body.accessToken);
    await hit('attendee', access, 'POST', '/auth/refresh');
    // A throwaway account for the destructive routes.
    const email = `canary-delete-${randomBytes(3).toString('hex')}@example.test`;
    const made = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Canary Delete' } });
    await (await auth.$context).internalAdapter.updateUser(made.user.id, { emailVerified: true });
    const login = await hit('attendee', null, 'POST', '/auth/login', { body: { email, password: PASSWORD } });
    const bearer = String(login.body.token);
    await hit('attendee', bearer, 'DELETE', '/me');
    const again = await hit('attendee', null, 'POST', '/auth/login', { body: { email, password: PASSWORD } });
    expect(again.status).toBe(401);
    const second = await hit('attendee', null, 'POST', '/auth/login', {
      body: { email: who.email, password: who.password },
    });
    await hit('attendee', String(second.body.token), 'POST', '/auth/logout');
    const third = await hit('attendee', null, 'POST', '/auth/token', {
      body: { grantType: 'password', email: who.email, password: who.password },
    });
    await hit('attendee', String(third.body.accessToken), 'POST', '/auth/sign-out-everywhere');
    await hit('attendee', null, 'POST', '/auth/revoke', { body: { refreshToken: refresh } });
    expect(formatLeaks(leaks.attendee)).toBe('no canary leaks');
    expect(ticketId, 'read a ticket above').not.toBe('');
    expect(code).not.toBe('');
  });
});

describe('a Staff app door device (/v1/staff)', () => {
  it('reads and works the door without a private column beyond the door’s allowlist', async () => {
    const t = canary.deviceToken;
    const event = canary.event.id;
    const E = (p: string) => p.replace('{eventId}', event);
    await hit('device', t, 'GET', '/staff/events/{eventId}/overview', {
      path: E('/staff/events/{eventId}/overview'),
    });
    const guests = await hit('device', t, 'GET', '/staff/events/{eventId}/guests', {
      path: E('/staff/events/{eventId}/guests'),
    });
    const guest = (guests.body.parties as { guests: { id: string }[] }[] | undefined)?.[0]?.guests[0];
    if (guest)
      await hit('device', t, 'POST', '/staff/guest-arrivals', {
        body: {
          eventId: event,
          arrivals: [
            {
              clientId: crypto.randomUUID(),
              guestId: guest.id,
              deviceTs: new Date().toISOString(),
              clockOffsetMs: 0,
              source: 'scanner',
            },
          ],
        },
      });
    await hit('device', t, 'GET', '/staff/events/{eventId}/assistance', {
      path: E('/staff/events/{eventId}/assistance'),
    });
    const raised = await hit('device', t, 'POST', '/staff/assistance', {
      body: { eventId: event, reason: 'backup', note: 'canary' },
    });
    const requestId = raised.body.requestId as string | undefined;
    if (requestId)
      for (const action of ['take', 'start', 'resolve'])
        await hit('device', t, 'POST', '/staff/assistance/{requestId}/{action}', {
          path: `/staff/assistance/${requestId}/${action}`,
          body: { eventId: event },
        });
    await hit('device', t, 'GET', '/staff/push');
    const copy = { title: 'Alert', body: '{label} {percent}' };
    await hit('device', t, 'PUT', '/staff/push', {
      body: {
        platform: 'apns',
        token: 'b'.repeat(64),
        appId: 'com.yayatoh.staff',
        locale: 'en',
        copy: { device_offline: copy, device_low_battery: copy, device_backlog: copy, capacity_near: copy },
      },
    });
    await hit('device', t, 'DELETE', '/staff/push');
    // The routes the Scan PWA and the Staff app share: the manifest, the heartbeat and the scans.
    await hit('device', t, 'GET', '/events/{eventId}/manifest', {
      path: E('/events/{eventId}/manifest?limit=2000'),
    });
    await hit('device', t, 'POST', '/scans/batch', {
      body: {
        eventId: event,
        scans: [
          {
            scanId: crypto.randomUUID(),
            code: 'YY1NOTATICKETCODE',
            deviceTs: new Date().toISOString(),
            clockOffsetMs: 0,
            verdict: 'invalid',
          },
        ],
      },
    });
    await hit('device', t, 'POST', '/devices/heartbeat', {
      body: {
        eventId: event,
        batteryPct: 80,
        queueDepth: 0,
        clockOffsetMs: 0,
        appVersion: '1.0.0',
      },
    });
    expect(formatLeaks(leaks.device)).toBe('no canary leaks');
    expect([...seen.device].length, 'the door does see some of its data').toBeGreaterThan(0);
  });

  it('a revoked device is refused everywhere at once without a body worth reading', async () => {
    const r = await hit('device', `yyd_${randomBytes(32).toString('base64url')}`, 'GET', '/staff/push#unknown', {
      path: '/staff/push',
    });
    expect(r.status).toBe(401);
    expect(formatLeaks(leaks.device)).toBe('no canary leaks');
  });
});

describe('an exhibitor rep (/v1/portal)', () => {
  it('reads and captures leads with only the fields the attendee shared', async () => {
    const [account] = await admin.unsafe(
      "select id from events.portal_accounts where org_id = $1 and subject_kind = 'exhibitor' order by created_at limit 1",
      [canary.orgId],
    );
    expect(account, 'the canary org has a portal account').toBeDefined();
    const tokens = await createPortalBearerSession({ orgId: canary.orgId, accountId: account?.id as string });
    const t = tokens.accessToken;
    await hit('portal', t, 'GET', '/portal/leads/setup');
    const list = await hit('portal', t, 'GET', '/portal/leads');
    const leads = (list.body.leads ?? []) as { id: string }[];
    await hit('portal', t, 'POST', '/portal/leads/scans', {
      body: {
        scans: [
          {
            scanId: `canary-${randomBytes(6).toString('hex')}`,
            code: 'CANARY-NOT-A-BADGE',
            capturedAt: new Date().toISOString(),
            offline: false,
          },
        ],
      },
    });
    for (const lead of leads.slice(0, 5))
      await hit('portal', t, 'PATCH', '/portal/leads/{leadId}', {
        path: `/portal/leads/${lead.id}`,
        body: { rating: null, qualifiers: [], notes: 'canary note' },
      });
    if (leads.length === 0)
      await hit('portal', t, 'PATCH', '/portal/leads/{leadId}', {
        path: `/portal/leads/${crypto.randomUUID()}`,
        body: { rating: null, qualifiers: [], notes: 'canary note' },
      });
    // Another exhibitor's lead (an id that is not theirs) is the same 404 as an unknown one.
    const stranger = await hit('portal', t, 'PATCH', '/portal/leads/{leadId}#stranger', {
      path: `/portal/leads/${crypto.randomUUID()}`,
      body: { rating: null, qualifiers: [], notes: 'x' },
    });
    expect([403, 404, 409]).toContain(stranger.status);
    const refreshed = await hit('portal', null, 'POST', '/portal/auth/token', {
      body: { grantType: 'refresh_token', refreshToken: tokens.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    await hit('portal', null, 'POST', '/portal/auth/revoke', {
      body: { refreshToken: String(refreshed.body.refreshToken) },
    });
    expect(formatLeaks(leaks.portal)).toBe('no canary leaks');
  });
});

describe('an organizer’s session (/v1/orgs/{org}/events/{eventId}/ops)', () => {
  it('sees the event-day numbers and not a private column', async () => {
    const email = `canary-organizer-${randomBytes(3).toString('hex')}@example.test`;
    const made = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name: 'Canary Organizer' } });
    await (await auth.$context).internalAdapter.updateUser(made.user.id, { emailVerified: true });
    await executeCommand(
      addMemberCommand,
      { userId: made.user.id, role: 'admin' },
      userCtx(canary.ownerId, canary.orgId),
      ports,
    );
    const login = await hit('organizer', null, 'POST', '/auth/token', {
      body: { grantType: 'password', email, password: PASSWORD },
    });
    const bearer = String(login.body.accessToken);
    const ops = await hit('organizer', bearer, 'GET', '/orgs/{org}/events/{eventId}/ops', {
      path: `/orgs/${canary.slug}/events/${canary.event.id}/ops`,
    });
    expect(ops.status).toBe(200);
    // An API key is not a member: the Command Center is for people.
    const key = await hit('organizer', canary.apiKey, 'GET', '/orgs/{org}/events/{eventId}/ops#key', {
      path: `/orgs/${canary.slug}/events/${canary.event.id}/ops`,
    });
    expect(key.status).toBe(403);
    expect(formatLeaks(leaks.organizer)).toBe('no canary leaks');
  });
});

describe('every Phase 7 route is reached', () => {
  /** Phase 7's surface in the OpenAPI document (paths are written under `/v1`). */
  const PHASE7 = [
    /^\/v1\/auth\/(token|email-code|step-up|step-up\/start|revoke|sign-out-everywhere|login|refresh|logout)$/,
    /^\/v1\/me(\/.*)?$/,
    /^\/v1\/claims\/\{token\}$/,
    /^\/v1\/mobile\/config$/,
    /^\/v1\/public\/events$/,
    /^\/v1\/public\/events\/\{slug\}$/,
    /^\/v1\/public\/events\/\{slug\}\/(ticket-types|checkout)$/,
    /^\/v1\/staff\/.*$/,
    /^\/v1\/portal\/.*$/,
    /^\/v1\/orgs\/\{org\}\/events\/\{eventId\}\/ops$/,
    /^\/v1\/events\/\{eventId\}\/manifest$/,
    /^\/v1\/devices\/heartbeat$/,
    /^\/v1\/scans\/batch$/,
  ];
  /** Routes not driven here, each with the reason and where its answer is checked instead. */
  const NOT_DRIVEN: Readonly<Record<string, string>> = {
    // Moves the canary ticket to the attendee for good; the refusals and the read run above.
    // (Reached through the refused path, so it is listed as reached.)
  };

  it('has no Phase 7 operation the canary test did not call', () => {
    const doc = openApiDocument(deps);
    const missing: string[] = [];
    let count = 0;
    for (const [path, ops] of Object.entries(doc.paths ?? {})) {
      if (!PHASE7.some((re) => re.test(path))) continue;
      for (const method of Object.keys(ops as object)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
        count++;
        const key = `${method.toUpperCase()} ${path.replace(/^\/v1/, '')}`;
        if (!reached.has(key) && !(key in NOT_DRIVEN)) missing.push(key);
      }
    }
    expect(count).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });
});
