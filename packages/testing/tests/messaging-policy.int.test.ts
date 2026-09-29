import { upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  addressSuppressionsQuery,
  autoPauseQuery,
  createNotifier,
  dispatchDue,
  frequencyCapsQuery,
  liftAddressSuppressionCommand,
  liftAutoPauseCommand,
  memoryTransports,
  messagingUsageQuery,
  policyLogQuery,
  preferenceCenterInfo,
  preferencesPath,
  recordDeliveryEventsCommand,
  savePreferenceCenterCommand,
  setFrequencyCapsCommand,
  setQuotaLimitCommand,
  smsSegments,
  unsubscribeInfo,
  unsubscribeUrls,
} from '@yayatoh/notifications';
import type { NotificationIntent } from '@yayatoh/platform';
import { activeSuspensionsTx } from '@yayatoh/tenancy';
import { type SQL, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
const notifier = createNotifier();
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const tag = () => uuidv7().slice(-8);
const at = (iso: string) => () => new Date(iso);
/** A weekday noon in Chicago (no quiet hours anywhere in the US). */
const WEEKDAY = '2030-07-16T17:00:00Z';

async function enqueue(orgId: string, intent: NotificationIntent) {
  return withTenant(systemCtx(orgId), (tx) => notifier.enqueue(tx, intent));
}

async function contact(org: OrgFixture, email: string) {
  return withTenant(systemCtx(org.org.id), (tx) =>
    upsertContactTx(tx, systemCtx(org.org.id), { email, name: 'Rae Contact', source: 'manual' }),
  );
}

/** The recipient opts in through the preference center (the only way texts get consent). */
async function optIn(
  org: OrgFixture,
  contactId: string,
  choices: {
    phone?: string | null;
    sms?: { informational: boolean; marketing: boolean };
    whatsapp?: { informational: boolean; marketing: boolean };
    marketingEmail?: boolean;
  },
) {
  const token = preferencesPath(org.org.id, contactId).split('/').pop() ?? '';
  return executeCommand(
    savePreferenceCenterCommand,
    {
      token,
      emailCategories: { reminders: true, event_updates: true, marketing: choices.marketingEmail ?? false },
      phone: choices.phone ?? null,
      sms: choices.sms ?? { informational: false, marketing: false },
      whatsapp: choices.whatsapp ?? { informational: false, marketing: false },
    },
    createCtx({ orgId: org.org.id }),
    ports,
  );
}

async function rows(orgId: string, where: SQL) {
  return withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{
      id: string;
      status: string;
      reason: string | null;
      send_after: string;
      segments: number | null;
      channel: string;
    }>(
      sql`select id, status, reason, send_after, segments, channel from notifications.messages where ${where} order by created_at`,
    ),
  );
}

async function audits(orgId: string, action: string) {
  return withTenant(systemCtx(orgId), (tx) =>
    tx.execute<{ actor: string; data: Record<string, unknown>; target_id: string | null }>(
      sql`select actor, data, target_id from platform.audit_events where action = ${action} order by seq`,
    ),
  );
}

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return isDomainError(err) ? `${err.code}:${String(err.details?.reason ?? '')}` : String(err);
  }
};

describe('policy gate v2: consent for texts', () => {
  it('a marketing SMS without express written consent is blocked with a reason; with consent it sends', async () => {
    const t = tag();
    const email = `sms-${t}@example.test`;
    const phone = '+12125550142';
    const c = await contact(a, email);
    const marketing = (key: string) =>
      enqueue(a.org.id, {
        kind: 'marketing.message',
        to: { email, phone, contactId: c.id, timeZone: 'America/New_York' },
        channels: ['sms'],
        params: { subject: 'Autumn season', body: 'Early-bird tickets are back.', name: 'Rae' },
        dedupeKey: key,
      });
    await marketing(`mkt1:${t}`);
    const { transports, sms } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: at(WEEKDAY) });
    expect(sms.filter((m) => m.to === phone)).toHaveLength(0);
    expect(await rows(a.org.id, sql`dedupe_key = ${`mkt1:${t}`}`)).toMatchObject([
      { status: 'suppressed', reason: 'consent_missing', channel: 'sms' },
    ]);
    // The organizer sees it, with its reason (masked, never the number).
    const log = await executeQuery(policyLogQuery, { channel: 'sms' }, a.ctx(), ports);
    expect(log.find((l) => l.kind === 'marketing.message' && l.reason === 'consent_missing')).toMatchObject({
      status: 'blocked',
      channel: 'sms',
      recipient: null,
    });
    expect(JSON.stringify(log)).not.toContain(phone);

    // Consent to informational texts only: marketing is still blocked.
    await optIn(a, c.id, { phone, sms: { informational: true, marketing: false } });
    await marketing(`mkt2:${t}`);
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: at(WEEKDAY) });
    expect(await rows(a.org.id, sql`dedupe_key = ${`mkt2:${t}`}`)).toMatchObject([
      { status: 'suppressed', reason: 'consent_missing' },
    ]);
    // Express written consent to marketing texts: it sends, with the org's name and how to stop.
    await optIn(a, c.id, { sms: { informational: true, marketing: true } });
    await marketing(`mkt3:${t}`);
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: at(WEEKDAY) });
    const sent = sms.filter((m) => m.to === phone);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBe(
      'Alpha Events: Autumn season\nEarly-bird tickets are back.\nReply STOP to opt out.',
    );
    const [row] = await rows(a.org.id, sql`dedupe_key = ${`mkt3:${t}`}`);
    expect(row).toMatchObject({ status: 'sent', segments: smsSegments(sent[0]?.body ?? '').segments });
    // Withdrawn: blocked again, with the other reason.
    await optIn(a, c.id, { sms: { informational: true, marketing: false } });
    await marketing(`mkt4:${t}`);
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: at(WEEKDAY) });
    expect(await rows(a.org.id, sql`dedupe_key = ${`mkt4:${t}`}`)).toMatchObject([
      { status: 'suppressed', reason: 'consent_withdrawn' },
    ]);
    // The ledger kept the evidence of every change (disclosure version, channel, last digits).
    const ledger = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ channel: string; purpose: string; status: string; evidence: string }>(
        sql`select channel, purpose, status, evidence from crm.consents where contact_id = ${c.id} order by captured_at, id`,
      ),
    );
    expect(ledger.map((l) => `${l.channel}:${l.purpose}:${l.status}`)).toEqual([
      'sms:informational:granted',
      'sms:marketing:granted',
      'sms:marketing:withdrawn',
    ]);
    expect(ledger[0]?.evidence).toBe('preference_center:text-consent-v1:sms:informational:0142');
  });

  it('event updates by text need consent to informational texts; transactional texts need none', async () => {
    const t = tag();
    const email = `upd-${t}@example.test`;
    const phone = '+12125550143';
    const c = await contact(a, email);
    await enqueue(a.org.id, {
      kind: 'attendees.message',
      to: { email, phone, contactId: c.id },
      channels: ['sms'],
      params: { subject: 'Parking', body: 'Use lot C.', name: 'Rae', eventName: 'Gala' },
      dedupeKey: `upd1:${t}`,
    });
    await enqueue(a.org.id, {
      kind: 'ticketing.holder-link',
      to: { phone, contactId: c.id },
      channels: ['sms'],
      params: { url: `${ORIGIN}/my-tickets/x`, eventName: 'Gala' },
      dedupeKey: `tx1:${t}`,
    });
    const { transports, sms } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: at(WEEKDAY) });
    // The text is blocked with its reason; the update goes to the category's next channel
    // (M3.5b fallback chains: SMS → email), recorded with why.
    expect(await rows(a.org.id, sql`dedupe_key = ${`upd1:${t}`} and channel = 'sms'`)).toMatchObject([
      { status: 'suppressed', reason: 'consent_missing' },
    ]);
    expect(
      await rows(
        a.org.id,
        sql`dedupe_key = ${`upd1:${t}`} and channel = 'email' and fallback_reason = 'consent_missing'`,
      ),
    ).toHaveLength(1);
    expect(sms.filter((m) => m.to === phone).map((m) => m.body.split('\n')[0])).toEqual([
      'Alpha Events: Your link to your tickets for Gala',
    ]);
    // Transactional texts carry no STOP line (they are not optional).
    expect(sms.find((m) => m.to === phone)?.body).not.toContain('STOP');
  });

  it('WhatsApp: utility goes out with consent; marketing to a US number is blocked (D16); elsewhere it sends', async () => {
    const t = tag();
    const us = await contact(a, `wa-us-${t}@example.test`);
    const uk = await contact(a, `wa-uk-${t}@example.test`);
    await optIn(a, us.id, { phone: '+13125550150', whatsapp: { informational: true, marketing: true } });
    await optIn(a, uk.id, { phone: '+447700900150', whatsapp: { informational: false, marketing: true } });
    const send = (
      c: { id: string },
      phone: string,
      kind: 'marketing.message' | 'attendees.message',
      key: string,
    ) =>
      enqueue(a.org.id, {
        kind,
        to: { phone, contactId: c.id },
        channels: ['whatsapp'],
        params: { subject: 'News', body: 'Hello', name: 'Rae', eventName: 'Gala' },
        dedupeKey: key,
      });
    await send(us, '+13125550150', 'marketing.message', `wa1:${t}`);
    await send(us, '+13125550150', 'attendees.message', `wa2:${t}`);
    await send(uk, '+447700900150', 'marketing.message', `wa3:${t}`);
    const { transports, whatsapp } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, now: at(WEEKDAY) });
    expect(await rows(a.org.id, sql`dedupe_key = ${`wa1:${t}`}`)).toMatchObject([
      { status: 'suppressed', reason: 'whatsapp_marketing_us', channel: 'whatsapp' },
    ]);
    expect(whatsapp.map((m) => `${m.to}:${m.category}`).sort()).toEqual([
      '+13125550150:utility',
      '+447700900150:marketing',
    ]);
  });
});

describe('policy gate v2: state quiet hours', () => {
  it('Texas Sunday: a text at 10:00 waits for noon, then sends; email is not held by state rules', async () => {
    const t = tag();
    const email = `tx-${t}@example.test`;
    const phone = '+15125550160';
    const c = await contact(b, email);
    await optIn(b, c.id, { phone, sms: { informational: true, marketing: false } });
    await enqueue(b.org.id, {
      kind: 'attendees.message',
      to: { email, phone, contactId: c.id, timeZone: 'America/Chicago' },
      channels: ['sms', 'email'],
      params: { subject: 'Doors', body: 'Doors at 7.', name: 'Rae', eventName: 'Gala' },
      dedupeKey: `tx:${t}`,
    });
    const { transports, sms, emails } = memoryTransports();
    // Sunday 14 July 2030, 10:00 CDT.
    await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, now: at('2030-07-14T15:00:00Z') });
    const [held] = await rows(b.org.id, sql`dedupe_key = ${`tx:${t}`} and channel = 'sms'`);
    expect(held).toMatchObject({ status: 'queued', reason: 'state_quiet_hours' });
    expect(new Date(held?.send_after ?? '').toISOString()).toBe('2030-07-14T17:00:00.000Z');
    expect(emails.filter((e) => e.to === email)).toHaveLength(1);
    expect(sms.filter((m) => m.to === phone)).toHaveLength(0);
    // Deferral, not drop: at noon it goes out.
    await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, now: at('2030-07-14T17:00:00Z') });
    expect(sms.filter((m) => m.to === phone)).toHaveLength(1);
  });

  it('an address in Texas counts even with an out-of-state number', async () => {
    const t = tag();
    const phone = '+12125550161';
    const c = await contact(b, `txaddr-${t}@example.test`);
    await optIn(b, c.id, { phone, sms: { informational: true, marketing: false } });
    await enqueue(b.org.id, {
      kind: 'attendees.message',
      to: { phone, contactId: c.id, region: 'US-TX', timeZone: 'America/New_York' },
      channels: ['sms'],
      params: { subject: 'Doors', body: 'Doors at 7.', name: 'Rae', eventName: 'Gala' },
      dedupeKey: `txaddr:${t}`,
    });
    const { transports } = memoryTransports();
    await dispatchDue(b.org.id, { transports, appOrigin: ORIGIN, now: at('2030-07-14T15:00:00Z') });
    const [held] = await rows(b.org.id, sql`dedupe_key = ${`txaddr:${t}`}`);
    expect(held).toMatchObject({ status: 'queued', reason: 'state_quiet_hours' });
    expect(new Date(held?.send_after ?? '').toISOString()).toBe('2030-07-14T18:00:00.000Z'); // noon MDT
  });
});

describe('policy gate v2: frequency caps', () => {
  it('a fourth event update in a day waits; marketing over its cap is skipped; the log says why', async () => {
    const t = tag();
    const email = `cap-${t}@example.test`;
    const c = await contact(a, email);
    await optIn(a, c.id, { marketingEmail: true });
    const { transports, emails } = memoryTransports();
    for (let i = 1; i <= 4; i += 1) {
      await enqueue(a.org.id, {
        kind: 'attendees.message',
        to: { email },
        params: { subject: `Update ${i}`, body: 'x', name: 'Rae', eventName: 'Gala' },
        dedupeKey: `cap${i}:${t}`,
      });
      await dispatchDue(a.org.id, {
        transports,
        appOrigin: ORIGIN,
        now: at(new Date(Date.parse(WEEKDAY) + i * 60_000).toISOString()),
      });
    }
    expect(emails.filter((e) => e.to === email).map((e) => e.subject)).toEqual([
      'Update 1',
      'Update 2',
      'Update 3',
    ]);
    const [fourth] = await rows(a.org.id, sql`dedupe_key = ${`cap4:${t}`}`);
    expect(fourth).toMatchObject({ status: 'queued', reason: 'frequency_cap' });
    // Room again 24 h after the first one.
    expect(new Date(fourth?.send_after ?? '').toISOString()).toBe('2030-07-17T17:01:01.000Z');

    // Marketing: the org's cap (fixture: 1 per 72 h) — the second is skipped, not deferred.
    for (let i = 1; i <= 2; i += 1) {
      await enqueue(a.org.id, {
        kind: 'marketing.message',
        to: { email },
        params: { subject: `Offer ${i}`, body: 'x', name: 'Rae' },
        dedupeKey: `mcap${i}:${t}`,
      });
      await dispatchDue(a.org.id, {
        transports,
        appOrigin: ORIGIN,
        now: at(new Date(Date.parse(WEEKDAY) + (10 + i) * 60_000).toISOString()),
      });
    }
    expect(
      emails.filter((e) => e.to === email && e.subject.startsWith('Offer')).map((e) => e.subject),
    ).toEqual(['Offer 1']);
    expect(await rows(a.org.id, sql`dedupe_key = ${`mcap2:${t}`}`)).toMatchObject([
      { status: 'suppressed', reason: 'frequency_cap' },
    ]);
  });

  it('owners set caps within bounds; viewers are refused; the change is audited', async () => {
    const caps = await executeQuery(frequencyCapsQuery, {}, a.ctx(), ports);
    expect(caps.find((c) => c.scope === 'marketing')).toMatchObject({
      maxMessages: 1,
      windowHours: 72,
      isDefault: false,
    });
    expect(caps.find((c) => c.scope === 'reminders')).toMatchObject({
      maxMessages: 3,
      windowHours: 24,
      isDefault: true,
    });
    expect(
      await refusal(
        executeCommand(
          setFrequencyCapsCommand,
          { caps: [{ scope: 'all', maxMessages: 0, windowHours: 24 }] },
          a.ctx(),
          ports,
        ),
      ),
    ).toMatch(/^validation_failed/);
    expect(
      await refusal(
        executeCommand(
          setFrequencyCapsCommand,
          { caps: [{ scope: 'all', maxMessages: 4, windowHours: 24 }] },
          userCtx(a.viewerId, a.org.id),
          ports,
        ),
      ),
    ).toMatch(/^forbidden/);
    await executeCommand(
      setFrequencyCapsCommand,
      { caps: [{ scope: 'all', maxMessages: 6, windowHours: 24 }] },
      a.ctx(),
      ports,
    );
    expect((await audits(a.org.id, 'messaging.caps.set')).at(-1)?.data).toEqual({ caps: ['all:6/24h'] });
    // Bravo's caps are its own.
    const bcaps = await executeQuery(frequencyCapsQuery, {}, b.ctx(), ports);
    expect(bcaps.find((c) => c.scope === 'all')).toMatchObject({ maxMessages: 5, isDefault: true });
  });
});

describe('policy gate v2: usage metering and quotas', () => {
  it('over-quota optional messages are held (not dropped); tickets still go; raising the limit releases them', async () => {
    const { a: q } = await twoOrgs();
    const t = tag();
    // Send what the fixture left queued first, so the numbers below are this test's own.
    await dispatchDue(
      q.org.id,
      { transports: memoryTransports().transports, appOrigin: ORIGIN, ignoreQuietHours: true },
      500,
    );
    // Staff only: an owner can't set their own quota.
    expect(
      await refusal(
        executeCommand(
          setQuotaLimitCommand,
          { channel: 'email', monthlyLimit: 99, reason: 'mine' },
          q.ctx(),
          ports,
        ),
      ),
    ).toMatch(/^forbidden/);
    const before = await executeQuery(messagingUsageQuery, {}, q.ctx(), ports);
    const used = before.channels.find((c) => c.channel === 'email')?.used ?? 0;
    await executeCommand(
      setQuotaLimitCommand,
      { channel: 'email', monthlyLimit: used + 2, reason: 'trial org' },
      systemCtx(q.org.id),
      ports,
    );
    for (let i = 1; i <= 3; i += 1)
      await enqueue(q.org.id, {
        kind: 'attendees.message',
        to: { email: `quota${i}-${t}@example.test` },
        params: { subject: `Q${i}`, body: 'x', name: 'Rae', eventName: 'Gala' },
        dedupeKey: `quota${i}:${t}`,
      });
    await enqueue(q.org.id, {
      kind: 'ticketing.holder-link',
      to: { email: `quota-tx-${t}@example.test` },
      params: { url: `${ORIGIN}/my-tickets/x`, eventName: 'Gala' },
      dedupeKey: `quota-tx:${t}`,
    });
    const now = new Date();
    const { transports, emails } = memoryTransports();
    await dispatchDue(q.org.id, { transports, appOrigin: ORIGIN, now: () => now, ignoreQuietHours: true });
    expect(
      emails
        .filter((e) => e.subject.startsWith('Q'))
        .map((e) => e.subject)
        .sort(),
    ).toEqual(['Q1', 'Q2']);
    expect(emails.some((e) => e.to === `quota-tx-${t}@example.test`)).toBe(true);
    const [held] = await rows(q.org.id, sql`dedupe_key = ${`quota3:${t}`}`);
    expect(held).toMatchObject({ status: 'queued', reason: 'quota_reached' });
    const usage = await executeQuery(messagingUsageQuery, {}, q.ctx({ now }), ports);
    expect(usage.channels.find((c) => c.channel === 'email')).toMatchObject({
      used: used + 3,
      limit: used + 2,
      isDefault: false,
      reached: true,
      waiting: 1,
    });
    expect((await audits(q.org.id, 'messaging.quota.set')).at(-1)).toMatchObject({
      actor: 'system:fixture',
      target_id: 'email',
      data: { channel: 'email', monthlyLimit: used + 2, isDefault: false, reason: 'trial org' },
    });
    // Staff raise it; the next pass (the hold is an hour) sends the held message.
    await executeCommand(
      setQuotaLimitCommand,
      { channel: 'email', monthlyLimit: null, reason: 'back to default' },
      systemCtx(q.org.id),
      ports,
    );
    await dispatchDue(q.org.id, {
      transports,
      appOrigin: ORIGIN,
      now: () => new Date(now.getTime() + 61 * 60_000),
      ignoreQuietHours: true,
    });
    expect(emails.map((e) => e.subject)).toContain('Q3');
  });

  it('SMS usage counts segments (UCS-2 Arabic splits into more)', async () => {
    const { a: q } = await twoOrgs();
    const t = tag();
    const c = await contact(q, `seg-${t}@example.test`);
    await optIn(q, c.id, { phone: '+12125550170', sms: { informational: true, marketing: false } });
    await enqueue(q.org.id, {
      kind: 'attendees.message',
      to: { phone: '+12125550170', contactId: c.id, locale: 'ar' },
      channels: ['sms'],
      params: {
        subject: 'تحديث',
        body: 'الأبواب تفتح في السابعة. '.repeat(6),
        name: 'رائد',
        eventName: 'حفل',
      },
      dedupeKey: `seg:${t}`,
    });
    const { transports, sms } = memoryTransports();
    const now = new Date(WEEKDAY);
    await dispatchDue(q.org.id, { transports, appOrigin: ORIGIN, now: () => now });
    const body = sms[0]?.body ?? '';
    const count = smsSegments(body);
    expect(count.encoding).toBe('UCS-2');
    expect(count.segments).toBeGreaterThan(1);
    const usage = await executeQuery(messagingUsageQuery, {}, q.ctx({ now }), ports);
    expect(usage.channels.find((x) => x.channel === 'sms')).toMatchObject({
      used: count.segments,
      messages: 1,
    });
    expect(usage.period).toBe('2030-07');
  });
});

describe('policy gate v2: complaint-rate auto-pause', () => {
  it('above 0.3 % the org pauses optional messaging, tells its owners and staff, and staff lift it (audited)', async () => {
    const { a: p } = await twoOrgs();
    const t = tag();
    // 400 emails sent (event updates to 400 people).
    await withTenant(systemCtx(p.org.id), async (tx) => {
      for (let i = 0; i < 400; i += 1)
        await notifier.enqueue(tx, {
          kind: 'attendees.message',
          to: { email: `crowd${i}-${t}@example.test` },
          params: { subject: 'Hello', body: 'x', name: 'Rae', eventName: 'Gala' },
          dedupeKey: `crowd${i}:${t}`,
        });
    });
    const { transports } = memoryTransports();
    await dispatchDue(p.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true }, 500);
    const sent = await withTenant(systemCtx(p.org.id), (tx) =>
      tx.execute<{ id: string; provider_message_id: string }>(
        sql`select id, provider_message_id from notifications.messages where dedupe_key like ${`crowd%:${t}`} and status = 'sent' order by created_at`,
      ),
    );
    expect(sent).toHaveLength(400);
    const complain = (m: { id: string; provider_message_id: string }, n: number) =>
      executeCommand(
        recordDeliveryEventsCommand,
        {
          provider: 'fake',
          events: [
            {
              id: `complaint-${n}-${t}`,
              type: 'complained',
              bounceType: null,
              messageId: m.id,
              providerMessageId: m.provider_message_id,
              recipient: null,
              detail: 'abuse',
              occurredAt: new Date(),
            },
          ],
        },
        systemCtx(p.org.id),
        ports,
      );
    // One complaint in 400 (+ the fixture's sends) is 0.25 %: nothing happens.
    expect((await complain(sent[0] as never, 1)).autoPaused).toBe(false);
    expect(await executeQuery(autoPauseQuery, {}, p.ctx(), ports)).toMatchObject({ active: false });
    // A spam click on a ticket email does not count (tickets never pause; the rate is optional mail).
    await enqueue(p.org.id, {
      kind: 'ticketing.holder-link',
      to: { email: `ticket-${t}@example.test` },
      params: { url: `${ORIGIN}/my-tickets/x`, eventName: 'Gala' },
      dedupeKey: `ticket:${t}`,
    });
    await dispatchDue(p.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    const [ticket] = await withTenant(systemCtx(p.org.id), (tx) =>
      tx.execute<{ id: string; provider_message_id: string }>(
        sql`select id, provider_message_id from notifications.messages where dedupe_key = ${`ticket:${t}`}`,
      ),
    );
    expect((await complain(ticket as never, 9)).autoPaused).toBe(false);
    // The second complaint about optional mail makes it 0.5 %: paused.
    expect((await complain(sent[1] as never, 2)).autoPaused).toBe(true);
    const status = await executeQuery(autoPauseQuery, {}, p.ctx(), ports);
    expect(status).toMatchObject({ active: true, complaints: 2, liftedAt: null });
    expect(status?.rateBps).toBeGreaterThan(30);
    expect(
      await withTenant(systemCtx(p.org.id), async (tx) =>
        (await activeSuspensionsTx(tx)).has('pause_messaging'),
      ),
    ).toBe(true);
    // The owner hears about it (in-app and email); the outbox carries the event for staff alerting.
    const told = await withTenant(systemCtx(p.org.id), (tx) =>
      tx.execute<{ user_id: string }>(
        sql`select user_id from notifications.inbox_items where kind = 'messaging.auto_paused'`,
      ),
    );
    expect(told.map((r) => r.user_id)).toContain(p.ownerId);
    const events = await withTenant(systemCtx(p.org.id), (tx) =>
      tx.execute<{ type: string }>(
        sql`select type from platform.domain_events where type = 'messaging.auto_paused'`,
      ),
    );
    expect(events).toHaveLength(1);

    // Optional messages wait; tickets and the owner's notice still go.
    await enqueue(p.org.id, {
      kind: 'attendees.message',
      to: { email: `after-${t}@example.test` },
      params: { subject: 'Later', body: 'x', name: 'Rae', eventName: 'Gala' },
      dedupeKey: `after:${t}`,
    });
    await enqueue(p.org.id, {
      kind: 'ticketing.holder-link',
      to: { email: `after-tx-${t}@example.test` },
      params: { url: `${ORIGIN}/my-tickets/x`, eventName: 'Gala' },
      dedupeKey: `after-tx:${t}`,
    });
    const second = memoryTransports();
    await dispatchDue(p.org.id, {
      transports: second.transports,
      appOrigin: ORIGIN,
      userEmails: async (ids) => new Map(ids.map((id) => [id, `${id}@owners.test`])),
      ignoreQuietHours: true,
    });
    expect(await rows(p.org.id, sql`dedupe_key = ${`after:${t}`}`)).toMatchObject([
      { status: 'queued', reason: 'messaging_paused' },
    ]);
    expect(second.emails.map((e) => e.subject)).toEqual(
      expect.arrayContaining(['Your link to your tickets for Gala', 'Messaging paused for Alpha Events']),
    );

    // Only staff lift it, with a note; it is audited; a second lift is refused.
    expect(
      await refusal(executeCommand(liftAutoPauseCommand, { note: 'I fixed it' }, p.ctx(), ports)),
    ).toMatch(/^forbidden/);
    const staff = createCtx({ orgId: p.org.id, actor: { type: 'system', name: 'staff:reviewer' } });
    expect(await refusal(executeCommand(liftAutoPauseCommand, { note: 'x' }, staff, ports))).toMatch(
      /^validation_failed/,
    );
    await executeCommand(liftAutoPauseCommand, { note: 'List cleaned with the organizer' }, staff, ports);
    expect(await executeQuery(autoPauseQuery, {}, p.ctx(), ports)).toMatchObject({ active: false });
    expect(await audits(p.org.id, 'messaging.auto_pause.lift')).toMatchObject([
      { actor: 'system:staff:reviewer', data: { note: 'List cleaned with the organizer' } },
    ]);
    expect(await refusal(executeCommand(liftAutoPauseCommand, { note: 'again' }, staff, ports))).toBe(
      'invalid_state:not_paused',
    );
    // A late complaint about mail sent before the pause does not pause it again.
    expect((await complain(sent[2] as never, 3)).autoPaused).toBe(false);
    expect(
      await withTenant(systemCtx(p.org.id), async (tx) =>
        (await activeSuspensionsTx(tx)).has('pause_messaging'),
      ),
    ).toBe(false);
  }, 120_000);
});

describe('address suppressions: the organizer lifts a bounce (audited), never a complaint', () => {
  it('lists masked, lifts bounces, refuses complaints and viewers, and stays inside the org', async () => {
    // The fixture bounced `fan+{slug}` (hard bounce).
    const list = await executeQuery(addressSuppressionsQuery, {}, a.ctx(), ports);
    const bounce = list.find((s) => s.reason === 'hard_bounce');
    expect(bounce).toMatchObject({ channel: 'email', liftable: true });
    expect(bounce?.address).toMatch(/^f•+@example\.test$/);
    // Bravo can't see or lift Alpha's row.
    expect((await executeQuery(addressSuppressionsQuery, {}, b.ctx(), ports)).map((s) => s.id)).not.toContain(
      bounce?.id,
    );
    expect(
      await refusal(
        executeCommand(
          liftAddressSuppressionCommand,
          { id: bounce?.id ?? '', note: 'typo fixed' },
          b.ctx(),
          ports,
        ),
      ),
    ).toMatch(/^not_found/);
    expect(
      await refusal(
        executeCommand(
          liftAddressSuppressionCommand,
          { id: bounce?.id ?? '', note: 'typo fixed' },
          userCtx(a.viewerId, a.org.id),
          ports,
        ),
      ),
    ).toMatch(/^forbidden/);
    await executeCommand(
      liftAddressSuppressionCommand,
      { id: bounce?.id ?? '', note: 'Mailbox fixed' },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(addressSuppressionsQuery, {}, a.ctx(), ports)).map((s) => s.id)).not.toContain(
      bounce?.id,
    );
    const [audit] = await audits(a.org.id, 'notifications.suppression.lift');
    expect(audit?.data).toEqual({ channel: 'email', reason: 'hard_bounce', note: 'Mailbox fixed' });
    expect(JSON.stringify(audit)).not.toContain('@example.test');

    // A complaint: listed, not liftable, refused with a reason.
    const t = tag();
    await enqueue(a.org.id, {
      kind: 'ticketing.holder-link',
      to: { email: `complaint-${t}@example.test` },
      params: { url: `${ORIGIN}/x`, eventName: 'Gala' },
      dedupeKey: `cmp:${t}`,
    });
    await dispatchDue(a.org.id, {
      transports: memoryTransports().transports,
      appOrigin: ORIGIN,
      ignoreQuietHours: true,
    });
    const [m] = await rows(a.org.id, sql`dedupe_key = ${`cmp:${t}`}`);
    await executeCommand(
      recordDeliveryEventsCommand,
      {
        provider: 'fake',
        events: [
          {
            id: `cmp-${t}`,
            type: 'complained',
            bounceType: null,
            messageId: m?.id ?? '',
            providerMessageId: null,
            recipient: null,
            detail: null,
            occurredAt: new Date(),
          },
        ],
      },
      systemCtx(a.org.id),
      ports,
    );
    const complaint = (await executeQuery(addressSuppressionsQuery, {}, a.ctx(), ports)).find(
      (s) => s.reason === 'complaint',
    );
    expect(complaint).toMatchObject({ liftable: false });
    expect(
      await refusal(
        executeCommand(
          liftAddressSuppressionCommand,
          { id: complaint?.id ?? '', note: 'please' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:complaint_not_liftable');
  });
});

describe('preference center', () => {
  it('shows the org, masked addresses and choices; validates the number; links are per org', async () => {
    const t = tag();
    const email = `pc-${t}@example.test`;
    const c = await contact(a, email);
    const token = preferencesPath(a.org.id, c.id).split('/').pop() ?? '';
    const info = await preferenceCenterInfo(a.org.id, token);
    expect(info).toEqual({
      orgName: 'Alpha Events',
      email: expect.stringMatching(/^p•+@example\.test$/),
      phone: null,
      emailCategories: { reminders: true, event_updates: true, marketing: false },
      sms: { informational: false, marketing: false },
      whatsapp: { informational: false, marketing: false },
    });
    // The same token for another org, or a forged one: nothing.
    expect(await preferenceCenterInfo(b.org.id, token)).toBeNull();
    expect(await preferenceCenterInfo(a.org.id, `${c.id}~forged`)).toBeNull();
    expect(
      await refusal(optIn(a, c.id, { phone: '555-0100', sms: { informational: true, marketing: false } })),
    ).toBe('validation_failed:invalid_phone');
    expect(await refusal(optIn(a, c.id, { sms: { informational: true, marketing: false } }))).toBe(
      'validation_failed:phone_required',
    );
    await optIn(a, c.id, {
      phone: '+1 (212) 555-0199',
      sms: { informational: true, marketing: false },
      marketingEmail: true,
    });
    expect(await preferenceCenterInfo(a.org.id, token)).toMatchObject({
      phone: '+1••••••0199',
      emailCategories: { marketing: true },
      sms: { informational: true, marketing: false },
    });
    // Switching event updates off by email is an unsubscribe; the audit names the changes only.
    await executeCommand(
      savePreferenceCenterCommand,
      {
        token,
        emailCategories: { reminders: true, event_updates: false, marketing: true },
        phone: null,
        sms: { informational: true, marketing: false },
        whatsapp: { informational: false, marketing: false },
      },
      createCtx({ orgId: a.org.id }),
      ports,
    );
    expect((await preferenceCenterInfo(a.org.id, token))?.emailCategories.event_updates).toBe(false);
    const trail = await audits(a.org.id, 'notifications.preference_center');
    expect(trail.at(-1)).toMatchObject({ target_id: c.id, data: { changes: ['email:event_updates:off'] } });
    expect(JSON.stringify(trail)).not.toContain('0199');
    // The unsubscribe page links to the preference center.
    await enqueue(a.org.id, {
      kind: 'attendees.message',
      to: { email },
      params: { subject: 'x', body: 'x', name: 'x', eventName: 'x' },
      dedupeKey: `pcu:${t}`,
    });
    const [m] = await rows(a.org.id, sql`dedupe_key = ${`pcu:${t}`}`);
    const unsubToken =
      unsubscribeUrls(ORIGIN, m?.id ?? '')
        .page.split('/')
        .pop() ?? '';
    expect((await unsubscribeInfo(unsubToken))?.preferencesPath).toBe(preferencesPath(a.org.id, c.id));
  });
});
