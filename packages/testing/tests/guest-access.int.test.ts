import { withoutTenant, withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  checkoutSettingsQuery,
  checkoutVerificationRequired,
  consumeGuestLink,
  createGuestSession,
  endGuestSession,
  eraseOrdersDsarTx,
  GUEST_CODE_TTL_MS,
  GUEST_RESEND_COOLDOWN_MS,
  guestOrders,
  guestSessionByToken,
  orderByManageToken,
  orderLinkMailer,
  reissueManageLinkCommand,
  requestGuestChallenge,
  requestOrderLinksCommand,
  revokeGuestSessions,
  setCheckoutSettingsCommand,
  startCheckoutCommand,
  verifyGuestChallenge,
} from '@yayatoh/orders';
import { consumeEvent, memoryNotifier, postgresRateLimitStore } from '@yayatoh/platform';
import { createRateLimiter, type RateLimiter } from '@yayatoh/platform/security';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/** M1.5f: guest email codes, magic links, attendee sessions, order links. */
let a: OrgFixture;
let b: OrgFixture;
let eventA: string;
let eventB: string;
let viewer: string;
const limiter: RateLimiter = createRateLimiter(postgresRateLimitStore);
const run = uuidv7().slice(-12);
const device = () => `dev${uuidv7().replace(/-/g, '')}`;
const addr = (tag: string) => `guest.${tag}.${run}@example.test`;
const limits = (d = device()) => ({ limiter, subject: { device: d, ip: null } });
/** Each call is 31 s after the previous one, so cooldowns never get in the way unless meant to. */
let clock = Date.now();
const later = () => {
  clock += GUEST_RESEND_COOLDOWN_MS + 1_000;
  return new Date(clock);
};

async function freeEvent(org: OrgFixture, name: string) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone: 'UTC', startsAt: '2029-03-01T18:00:00Z', endsAt: '2029-03-01T22:00:00Z' },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, org.ctx(), ports);
  const tt = await executeCommand(
    createTicketTypeCommand,
    { eventId: e.id, name: 'Free', priceMinor: 0, quantityTotal: 100 },
    org.ctx(),
    ports,
  );
  return { eventId: e.id, typeId: tt.id };
}
const types = new Map<string, string>();
async function buy(org: OrgFixture, eventId: string, email: string) {
  return executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items: [{ ticketTypeId: types.get(eventId) ?? '', quantity: 1 }],
      buyer: { email, name: 'Guest Buyer' },
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
}
const challengeRow = (id: string) =>
  withoutTenant(
    async (tx) => (await tx.execute(sql`select * from orders.guest_challenges where id = ${id}`))[0],
  );

async function sent(
  email: string,
  now = later(),
  opts: { purpose?: 'checkout' | 'sign_in'; org?: string | null; d?: string } = {},
) {
  const r = await requestGuestChallenge(
    {
      purpose: opts.purpose ?? 'checkout',
      scopeOrgId: opts.org === undefined ? a.org.id : opts.org,
      email,
      browserState: opts.purpose === 'sign_in' ? 'b'.repeat(43) : null,
    },
    limits(opts.d),
    now,
  );
  if (r.status !== 'sent') throw new Error(`expected sent, got ${r.status}`);
  return { ...r, at: now };
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  const ea = await freeEvent(a, `Guest access ${run}`);
  const eb = await freeEvent(b, `Guest access B ${run}`);
  eventA = ea.eventId;
  eventB = eb.eventId;
  types.set(eventA, ea.typeId);
  types.set(eventB, eb.typeId);
  viewer = uuidv7();
  await executeCommand(addMemberCommand, { userId: viewer, role: 'viewer' }, a.ctx(), ports);
});
afterAll(closePools);

describe('guest codes (M1.5f)', () => {
  it('are random, stored only as an HMAC with the address hashed, and expire in ten minutes', async () => {
    const s = await sent(addr('hash'));
    expect(s.code).toMatch(/^\d{6}$/);
    const row = await challengeRow(s.challengeId);
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(`"${s.code}"`);
    expect(row?.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(String(row?.expires_at)).getTime() - s.at.getTime()).toBe(GUEST_CODE_TTL_MS);
    // No code is in any column: only the hash.
    expect(Object.values(row ?? {}).some((v) => v === s.code)).toBe(false);
  });

  it('verify once, for the address, site and purpose they were made for', async () => {
    const email = addr('once');
    const s = await sent(email);
    const base = {
      challengeId: s.challengeId,
      code: s.code,
      purpose: 'checkout' as const,
      scopeOrgId: a.org.id,
    };
    // Another site, purpose or address: looks expired, and costs nothing.
    expect((await verifyGuestChallenge({ ...base, scopeOrgId: b.org.id }, limits(), s.at)).status).toBe(
      'expired',
    );
    expect((await verifyGuestChallenge({ ...base, scopeOrgId: null }, limits(), s.at)).status).toBe(
      'expired',
    );
    expect((await verifyGuestChallenge({ ...base, purpose: 'sign_in' }, limits(), s.at)).status).toBe(
      'expired',
    );
    expect((await verifyGuestChallenge({ ...base, email: addr('other') }, limits(), s.at)).status).toBe(
      'expired',
    );
    const ok = await verifyGuestChallenge({ ...base, email: email.toUpperCase() }, limits(), s.at);
    expect(ok).toMatchObject({ status: 'ok', email });
    expect((await verifyGuestChallenge(base, limits(), s.at)).status).toBe('used');
  });

  it('expire after ten minutes', async () => {
    const s = await sent(addr('expire'));
    const at = new Date(s.at.getTime() + GUEST_CODE_TTL_MS + 1);
    const r = await verifyGuestChallenge(
      { challengeId: s.challengeId, code: s.code, purpose: 'checkout', scopeOrgId: a.org.id },
      limits(),
      at,
    );
    expect(r.status).toBe('expired');
  });

  it('lock after five wrong tries, even against the right code; the count commits', async () => {
    const s = await sent(addr('lock'));
    const wrong = s.code === '000000' ? '111111' : '000000';
    const attempt = (code: string) =>
      verifyGuestChallenge(
        { challengeId: s.challengeId, code, purpose: 'checkout', scopeOrgId: a.org.id },
        limits(),
        s.at,
      );
    for (const left of [4, 3, 2, 1])
      expect(await attempt(wrong)).toMatchObject({ status: 'wrong', attemptsLeft: left });
    expect(await attempt(wrong)).toMatchObject({ status: 'locked', attemptsLeft: 0 });
    expect((await attempt(s.code)).status).toBe('locked');
    expect((await challengeRow(s.challengeId))?.attempts).toBe(5);
  });

  it('a resend within 30 seconds sends nothing and points at the live code; after it, a new code retires the old', async () => {
    const email = addr('cooldown');
    const first = await sent(email);
    const again = await requestGuestChallenge(
      { purpose: 'checkout', scopeOrgId: a.org.id, email },
      limits(),
      new Date(first.at.getTime() + 5_000),
    );
    expect(again).toEqual({
      status: 'cooldown',
      challengeId: first.challengeId,
      resendAt: new Date(first.at.getTime() + GUEST_RESEND_COOLDOWN_MS),
    });
    const second = await sent(email, new Date(first.at.getTime() + GUEST_RESEND_COOLDOWN_MS));
    expect(second.challengeId).not.toBe(first.challengeId);
    const old = await verifyGuestChallenge(
      { challengeId: first.challengeId, code: first.code, purpose: 'checkout', scopeOrgId: a.org.id },
      limits(),
      second.at,
    );
    expect(old.status).toBe('expired');
  });
});

describe('rate limits through the M1.14 limiter', () => {
  it('per destination: at most 5 codes per address in 15 minutes, whatever the device', async () => {
    const email = addr('dest');
    // 31 s apart (past the cooldown), well inside the 15-minute window.
    for (let i = 0; i < 5; i++) await sent(email);
    const r = await requestGuestChallenge(
      { purpose: 'checkout', scopeOrgId: a.org.id, email },
      limits(),
      later(),
    );
    expect(r.status).toBe('rate_limited');
    // Another address is unaffected.
    await sent(addr('dest-other'));
  });

  it('per device (yy_did): at most 10 codes in 10 minutes across addresses; other devices unaffected', async () => {
    const d = device();
    // Different addresses need no cooldown: all at one instant, inside one window.
    const at = later();
    for (let i = 0; i < 10; i++) await sent(addr(`dev-${i}`), at, { d });
    const r = await requestGuestChallenge(
      { purpose: 'checkout', scopeOrgId: a.org.id, email: addr('dev-11') },
      limits(d),
      at,
    );
    expect(r.status).toBe('rate_limited');
    await sent(addr('dev-11'), later(), { d: device() });
  });

  it('per destination for checks too (20 in 15 minutes across codes and devices)', async () => {
    // One address: 25 checks across five codes and devices; past 20 the address is refused.
    const one = addr('verify-one');
    const results: string[] = [];
    for (let round = 0; round < 5; round++) {
      const s = await sent(one, later(), { d: device() });
      for (let i = 0; i < 5; i++)
        results.push(
          (
            await verifyGuestChallenge(
              { challengeId: s.challengeId, code: '999999', purpose: 'checkout', scopeOrgId: a.org.id },
              limits(),
              s.at,
            )
          ).status,
        );
    }
    expect(results.filter((s) => s === 'rate_limited').length).toBeGreaterThan(0);
  });
});

describe('no enumeration', () => {
  it('addresses with and without orders get the same answer and leave the same kind of row', async () => {
    const known = addr('known');
    await buy(a, eventA, known);
    const unknown = addr('unknown');
    const k = await sent(known, later(), { purpose: 'sign_in' });
    const u = await sent(unknown, later(), { purpose: 'sign_in' });
    expect(Object.keys(k).sort()).toEqual(Object.keys(u).sort());
    expect(k.linkToken).toBeTruthy();
    expect(u.linkToken).toBeTruthy();
    const [rk, ru] = await Promise.all([challengeRow(k.challengeId), challengeRow(u.challengeId)]);
    const shape = (r: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(r ?? {}).map(([key, v]) => [key, v === null ? 'null' : typeof v]));
    expect(shape(rk)).toEqual(shape(ru));
    // "Email me my order links" answers, audits and emits alike; only the known address has ids.
    const ctx = () => createCtx({ orgId: a.org.id });
    await executeCommand(requestOrderLinksCommand, { email: known }, ctx(), ports);
    await executeCommand(requestOrderLinksCommand, { email: unknown }, ctx(), ports);
    const events = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ payload: { orderIds: string[] } }>(
        sql`select payload from platform.domain_events where type = 'order.links_requested' order by created_at desc, id desc limit 2`,
      ),
    );
    expect(events).toHaveLength(2);
    const audits = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ data: unknown; target_id: string | null }>(
        sql`select data, target_id from platform.audit_events where action = 'orders.links_requested' order by seq desc limit 2`,
      ),
    );
    expect(audits[0]).toEqual(audits[1]);
  });
});

describe('magic links', () => {
  it('open in the requesting browser once; another browser is asked for the code and spends nothing', async () => {
    const email = addr('link');
    const state = 's'.repeat(43);
    const r = await requestGuestChallenge(
      { purpose: 'sign_in', scopeOrgId: a.org.id, email, browserState: state },
      limits(),
      later(),
    );
    if (r.status !== 'sent' || !r.linkToken) throw new Error('no link');
    const token = r.linkToken;
    expect(await consumeGuestLink({ token, browserState: 't'.repeat(43), scopeOrgId: a.org.id })).toEqual({
      status: 'other_browser',
      challengeId: r.challengeId,
    });
    expect(await consumeGuestLink({ token, browserState: null, scopeOrgId: a.org.id })).toMatchObject({
      status: 'other_browser',
    });
    // Another site's page never opens it.
    expect(await consumeGuestLink({ token, browserState: state, scopeOrgId: b.org.id })).toEqual({
      status: 'invalid',
    });
    // Peeking spends nothing; opening does, once.
    expect(
      await consumeGuestLink({ token, browserState: state, scopeOrgId: a.org.id, spend: false }),
    ).toMatchObject({
      status: 'ok',
      email,
    });
    expect(await consumeGuestLink({ token, browserState: state, scopeOrgId: a.org.id })).toMatchObject({
      status: 'ok',
      email,
    });
    expect(await consumeGuestLink({ token, browserState: state, scopeOrgId: a.org.id })).toEqual({
      status: 'invalid',
    });
    // The code from the same email is spent with it.
    const v = await verifyGuestChallenge(
      { challengeId: r.challengeId, code: r.code, purpose: 'sign_in', scopeOrgId: a.org.id },
      limits(),
    );
    expect(v.status).toBe('used');
  });

  it('expire after 15 minutes; a forged secret never opens', async () => {
    const r = await sent(addr('link-expire'), later(), { purpose: 'sign_in' });
    const token = r.linkToken ?? '';
    const forged = `${r.challengeId}~${'A'.repeat(43)}`;
    expect(
      await consumeGuestLink({ token: forged, browserState: 'b'.repeat(43), scopeOrgId: a.org.id }),
    ).toEqual({
      status: 'invalid',
    });
    expect(
      await consumeGuestLink(
        { token, browserState: 'b'.repeat(43), scopeOrgId: a.org.id },
        new Date(r.at.getTime() + 15 * 60_000),
      ),
    ).toEqual({ status: 'invalid' });
  });
});

describe('attendee sessions', () => {
  it('are bound to their host and site; sign out and sign out everywhere revoke them', async () => {
    const email = addr('session');
    const host = 'lakeside.test.example';
    const one = await createGuestSession({ email, scopeOrgId: a.org.id, host });
    const two = await createGuestSession({ email, scopeOrgId: a.org.id, host });
    const where = { scopeOrgId: a.org.id, host };
    expect((await guestSessionByToken(one.token, where))?.email).toBe(email);
    expect(await guestSessionByToken(one.token, { ...where, host: 'other.test.example' })).toBeNull();
    expect(await guestSessionByToken(one.token, { ...where, scopeOrgId: null })).toBeNull();
    expect(await guestSessionByToken(one.token, { ...where, scopeOrgId: b.org.id })).toBeNull();
    expect(await guestSessionByToken('x'.repeat(43), where)).toBeNull();
    const token = await withoutTenant((tx) =>
      tx.execute<{ token_hash: string }>(
        sql`select token_hash from orders.guest_sessions where email = ${email}`,
      ),
    );
    expect(token.every((t) => t.token_hash !== one.token && t.token_hash.length === 64)).toBe(true);
    await endGuestSession(one.token);
    expect(await guestSessionByToken(one.token, where)).toBeNull();
    expect(await guestSessionByToken(two.token, where)).not.toBeNull();
    expect(await revokeGuestSessions(email, a.org.id)).toBe(1);
    expect(await guestSessionByToken(two.token, where)).toBeNull();
  });
});

describe('My tickets: orders of a verified address', () => {
  it('an org site lists its own orders; the marketplace lists every org’s; allowlisted; links open the order', async () => {
    const email = addr('orders');
    await buy(a, eventA, email);
    await buy(b, eventB, email);
    await buy(a, eventA, addr('someone-else'));
    const onA = await guestOrders(email, a.org.id);
    expect(onA.map((o) => o.orgName)).toEqual([a.org.name]);
    const onB = await guestOrders(email, b.org.id);
    expect(onB.map((o) => o.orgName)).toEqual([b.org.name]);
    const everywhere = await guestOrders(email.toUpperCase(), null);
    expect(everywhere.map((o) => o.orgName).sort()).toEqual([a.org.name, b.org.name].sort());
    expect(Object.keys(onA[0] ?? {}).sort()).toEqual(
      [
        'createdAt',
        'currency',
        'endsAt',
        'eventName',
        'managePath',
        'orderId',
        'orgName',
        'startsAt',
        'status',
        'tickets',
        'timeZone',
        'totalMinor',
      ].sort(),
    );
    const token = onA[0]?.managePath.replace('/orders/', '') ?? '';
    expect((await orderByManageToken(token))?.id).toBe(onA[0]?.orderId);
    expect(await guestOrders(addr('nobody'), null)).toEqual([]);
  });
});

describe('manage links: revoke and reissue (organizer)', () => {
  it('replaces the link, emails the new one, audits; the old link stops working', async () => {
    const email = addr('reissue');
    const { order, manageToken } = await buy(a, eventA, email);
    expect((await orderByManageToken(manageToken))?.id).toBe(order.id);
    await executeCommand(reissueManageLinkCommand, { orderId: order.id }, a.ctx(), ports);
    expect(await orderByManageToken(manageToken)).toBeNull();
    const [evt] = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ id: string; payload: unknown }>(
        sql`select id, payload from platform.domain_events where type = 'order.manage_link_reissued' and aggregate_id = ${order.id}`,
      ),
    );
    if (!evt) throw new Error('no event');
    expect(JSON.stringify(evt.payload)).not.toContain(manageToken);
    const { notifier, sent: mails } = memoryNotifier();
    await consumeEvent(orderLinkMailer({ notifier, appOrigin: 'https://app.test' }), {
      id: evt.id,
      orgId: a.org.id,
      type: 'order.manage_link_reissued',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: evt.payload,
      logSeq: 1,
    });
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({
      kind: 'orders.order-link',
      to: { email },
      params: { reason: 'reissued' },
    });
    const fresh = String(mails[0]?.params.url).replace('https://app.test/orders/', '');
    expect(fresh).not.toBe(manageToken);
    expect((await orderByManageToken(fresh))?.id).toBe(order.id);
    const audits = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ target_id: string }>(
        sql`select target_id from platform.audit_events where action = 'orders.manage_link_reissue' and target_id = ${order.id}`,
      ),
    );
    expect(audits).toHaveLength(1);
  });

  it('viewers cannot reissue; another org cannot touch this org’s orders', async () => {
    const { order, manageToken } = await buy(a, eventA, addr('reissue-deny'));
    await expect(
      executeCommand(reissueManageLinkCommand, { orderId: order.id }, userCtx(viewer, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(reissueManageLinkCommand, { orderId: order.id }, b.ctx(), ports),
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await orderByManageToken(manageToken))?.id).toBe(order.id);
  });

  it('"email me my links" queues one message per order of that address, none for others', async () => {
    const email = addr('resend');
    await buy(a, eventA, email);
    await buy(a, eventA, email);
    const run = async (who: string) => {
      await executeCommand(requestOrderLinksCommand, { email: who }, createCtx({ orgId: a.org.id }), ports);
      const [evt] = await withTenant(a.ctx(), (tx) =>
        tx.execute<{ id: string; payload: unknown; aggregate_id: string }>(
          sql`select id, payload, aggregate_id from platform.domain_events where type = 'order.links_requested' order by created_at desc, id desc limit 1`,
        ),
      );
      if (!evt) throw new Error('no event');
      const { notifier, sent: mails } = memoryNotifier();
      await consumeEvent(orderLinkMailer({ notifier, appOrigin: 'https://app.test' }), {
        id: evt.id,
        orgId: a.org.id,
        type: 'order.links_requested',
        version: 1,
        aggregateType: 'order_links',
        aggregateId: evt.aggregate_id,
        payload: evt.payload,
        logSeq: 1,
      });
      return mails;
    };
    const mails = await run(email);
    expect(mails).toHaveLength(2);
    expect(mails.every((m) => m.kind === 'orders.order-link' && m.params.reason === 'resend')).toBe(true);
    expect(await run(addr('resend-nobody'))).toEqual([]);
  });
});

describe('checkout settings', () => {
  it('verification is on by default; organizers turn it off; viewers cannot; other orgs see their own', async () => {
    const { eventId } = await freeEvent(a, `Settings ${run}`);
    expect(await checkoutVerificationRequired(a.org.id, eventId)).toBe(true);
    await expect(
      executeCommand(
        setCheckoutSettingsCommand,
        { eventId, verifyEmail: false },
        userCtx(viewer, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(setCheckoutSettingsCommand, { eventId, verifyEmail: false }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(setCheckoutSettingsCommand, { eventId, verifyEmail: false }, a.ctx(), ports);
    expect(await checkoutVerificationRequired(a.org.id, eventId)).toBe(false);
    expect(await executeQuery(checkoutSettingsQuery, { eventId }, userCtx(viewer, a.org.id), ports)).toEqual({
      verifyEmail: false,
    });
    // Under org B's RLS the row does not exist: B's default applies.
    expect(await checkoutVerificationRequired(b.org.id, eventId)).toBe(true);
    const audits = await withTenant(a.ctx(), (tx) =>
      tx.execute(
        sql`select 1 from platform.audit_events where action = 'orders.checkout_settings' and target_id = ${eventId}`,
      ),
    );
    expect(audits).toHaveLength(1);
  });
});

describe('privacy', () => {
  it('erasing a person removes their site sessions and pending codes for that org only', async () => {
    const email = addr('erase');
    const onA = await createGuestSession({ email, scopeOrgId: a.org.id, host: 'a.test.example' });
    const onB = await createGuestSession({ email, scopeOrgId: b.org.id, host: 'b.test.example' });
    await sent(email);
    await withTenant(a.ctx(), (tx) => eraseOrdersDsarTx(tx, email, new Date()));
    expect(await guestSessionByToken(onA.token, { scopeOrgId: a.org.id, host: 'a.test.example' })).toBeNull();
    expect(
      await guestSessionByToken(onB.token, { scopeOrgId: b.org.id, host: 'b.test.example' }),
    ).not.toBeNull();
    const left = await withoutTenant((tx) =>
      tx.execute(
        sql`select 1 from orders.guest_challenges where email = ${email} and scope_org_id = ${a.org.id}`,
      ),
    );
    expect(left).toHaveLength(0);
  });
});
