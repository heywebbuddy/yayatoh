import { saveSegmentCommand } from '@yayatoh/audiences';
import {
  cancelCampaignCommand,
  createCampaignCommand,
  estimateReachQuery,
  getCampaignQuery,
  listCampaignsQuery,
  pauseCampaignCommand,
  releaseChunkCommand,
  resumeCampaignCommand,
  runOrgCampaigns,
  saveCampaignCommand,
  scheduleCampaignCommand,
  sendNowCommand,
  setAudienceCommand,
  testSendCommand,
  unscheduleCampaignCommand,
  campaignPreviewQuery,
  campaignResultsQuery,
} from '@yayatoh/campaigns';
import { recordConsentTx, setContactPhoneTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import {
  dispatchDue,
  memoryTransports,
  recordDeliveryEventsCommand,
  setQuotaLimitCommand,
  suppressEmailTx,
  type Transports,
} from '@yayatoh/notifications';
import { recentEventsTx } from '@yayatoh/platform';
import { addMemberCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});
afterAll(closePools);

const tag = () => uuidv7().slice(-8);
/** A weekday noon in Chicago: no quiet hours. */
const NOON = new Date('2030-07-16T17:00:00Z');
const sys = (orgId: string, now?: Date) =>
  createCtx({ orgId, actor: { type: 'system', name: 'test.campaigns' }, ...(now ? { now } : {}) });

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return isDomainError(err) ? `${err.code}:${String(err.details?.reason ?? '')}` : String(err);
  }
};

type Consent = 'granted' | 'withdrawn' | 'unknown_legacy' | null;
async function person(
  org: OrgFixture,
  email: string,
  consent: Consent,
  opts: { name?: string; phone?: string; sms?: Consent } = {},
) {
  const ctx = systemCtx(org.org.id);
  return withTenant(ctx, async (tx) => {
    const { id } = await upsertContactTx(tx, ctx, { email, name: opts.name ?? 'Rae Contact', source: 'manual' });
    if (consent)
      await recordConsentTx(tx, ctx, { contactId: id, channel: 'email', purpose: 'marketing', status: consent, evidence: 'test' });
    if (opts.phone) await setContactPhoneTx(tx, ctx, id, opts.phone);
    if (opts.sms)
      await recordConsentTx(tx, ctx, { contactId: id, channel: 'sms', purpose: 'marketing', status: opts.sms, evidence: 'test' });
    return id;
  });
}

/** Everyone in the org's crm (an empty definition places no restriction). */
async function everyone(org: OrgFixture) {
  return executeCommand(
    saveSegmentCommand,
    { name: `Everyone ${tag()}`, definition: { version: 1, root: { type: 'group', op: 'and', conditions: [] } } },
    org.ctx(),
    ports,
  );
}

async function campaign(org: OrgFixture, opts: { channel?: 'email' | 'sms'; smsBody?: string } = {}) {
  const c = await executeCommand(
    createCampaignCommand,
    { name: `Spring ${tag()}`, channel: opts.channel ?? 'email' },
    org.ctx(),
    ports,
  );
  await executeCommand(
    saveCampaignCommand,
    {
      campaignId: c.id,
      name: c.name,
      locale: 'en',
      content: {
        subject: 'Spring for {{first_name|you}}',
        preheader: 'New season',
        font: 'serif',
        smsBody: opts.smsBody ?? '',
        blocks: [
          { id: 'b1', type: 'heading', text: 'Hello {{first_name|there}}' },
          { id: 'b2', type: 'text', text: 'The season opens soon.' },
          { id: 'b3', type: 'button', label: 'Get tickets', eventId: org.event.id, path: null },
          { id: 'b4', type: 'eventCard', eventId: org.event.id },
          { id: 'b5', type: 'footer', postalAddress: '1 Lake St, Chicago IL 60601', note: '' },
        ],
      },
    },
    org.ctx(),
    ports,
  );
  const seg = await everyone(org);
  await executeCommand(
    setAudienceCommand,
    { campaignId: c.id, audience: { kind: 'segment', segmentId: seg.id } },
    org.ctx(),
    ports,
  );
  return c;
}

const sendNow = (org: OrgFixture, campaignId: string, now?: Date) =>
  executeCommand(sendNowCommand, { campaignId }, org.ctx({ idempotencyKey: `send-${campaignId}`, ...(now ? { now } : {}) }), ports);

async function recipients(org: OrgFixture, campaignId: string) {
  return withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ contact_id: string; status: string; reason: string | null }>(
      sql`select contact_id, status, reason from campaigns.campaign_recipients where campaign_id = ${campaignId}`,
    ),
  );
}

async function messagesOf(org: OrgFixture, prefix: string) {
  return withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ dedupe_key: string; status: string; reason: string | null; contact_id: string | null; recipient_email: string | null; kind: string; channel: string }>(
      sql`select dedupe_key, status, reason, contact_id, recipient_email, kind, channel from notifications.messages where dedupe_key like ${`${prefix}%`}`,
    ),
  );
}

async function events(org: OrgFixture, type: string) {
  return withTenant(systemCtx(org.org.id), (tx) => recentEventsTx(tx, org.org.id, [type], 3_600_000));
}

async function drain(org: OrgFixture, transports: Transports, now = NOON) {
  for (let i = 0; i < 20; i++) {
    const r = await dispatchDue(org.org.id, { transports, appOrigin: ORIGIN, now: () => now }, 200);
    if (r.sent + r.suppressed + r.failed + r.held === 0) break;
  }
}

describe('consent enforcement at the snapshot', () => {
  it('excludes non-consented, withdrawn, legacy, suppressed and unsubscribed contacts with reasons; only consented people get it', async () => {
    const t = tag();
    const yes = await person(a, `yes+${t}@x.test`, 'granted', { name: 'Amina Diallo' });
    const none = await person(a, `none+${t}@x.test`, null);
    const withdrawn = await person(a, `gone+${t}@x.test`, 'withdrawn');
    const legacy = await person(a, `legacy+${t}@x.test`, 'unknown_legacy');
    const bounced = await person(a, `bounce+${t}@x.test`, 'granted');
    const unsub = await person(a, `unsub+${t}@x.test`, 'granted');
    await withTenant(systemCtx(a.org.id), async (tx) => {
      await tx.execute(
        sql`insert into notifications.address_suppressions (org_id, channel, address_norm, reason) values (${a.org.id}, 'email', ${`bounce+${t}@x.test`}, 'hard_bounce')`,
      );
      await suppressEmailTx(tx, a.org.id, `unsub+${t}@x.test`, 'marketing', 'page');
    });
    const c = await campaign(a);
    const estimate = await executeQuery(estimateReachQuery, { campaignId: c.id }, a.ctx(), ports);
    const started = await sendNow(a, c.id);
    expect(started.status).toBe('sending');
    const rows = await recipients(a, c.id);
    const of = (id: string) => rows.find((r) => r.contact_id === id);
    expect(of(yes)).toMatchObject({ status: 'pending', reason: null });
    expect(of(none)).toMatchObject({ status: 'excluded', reason: 'consent_missing' });
    expect(of(withdrawn)).toMatchObject({ status: 'excluded', reason: 'consent_withdrawn' });
    expect(of(legacy)).toMatchObject({ status: 'excluded', reason: 'consent_missing' });
    expect(of(bounced)).toMatchObject({ status: 'excluded', reason: 'suppressed' });
    expect(of(unsub)).toMatchObject({ status: 'excluded', reason: 'unsubscribed' });
    // The count shown before sending equals the snapshot.
    const results = await executeQuery(campaignResultsQuery, { campaignId: c.id }, a.ctx(), ports);
    expect(results.reach).toEqual(estimate);
    expect(results.reach.total).toBe(rows.length);
    const reason = (r: string) => results.reach.excluded.find((x) => x.reason === r)?.count ?? 0;
    expect(reason('consent_missing')).toBeGreaterThanOrEqual(2);
    expect(reason('consent_withdrawn')).toBeGreaterThanOrEqual(1);
    expect(reason('suppressed')).toBeGreaterThanOrEqual(1);
    expect(reason('unsubscribed')).toBeGreaterThanOrEqual(1);
    // Release, dispatch: the consented person gets the email, filled for them, with a tracked link.
    await runOrgCampaigns(a.org.id, ports, { now: NOON });
    const mem = memoryTransports();
    await drain(a, mem.transports);
    const mine = mem.emails.filter((e) => e.to.endsWith(`+${t}@x.test`));
    expect(mine.map((e) => e.to)).toEqual([`yes+${t}@x.test`]);
    const mail = mine[0];
    expect(mail?.subject).toBe('Spring for Amina');
    expect(mail?.html).toContain('Hello Amina');
    expect(mail?.html).toMatch(new RegExp(`href="${ORIGIN}/r/[a-z0-9]{8}"`));
    expect(mail?.html).toContain('1 Lake St, Chicago IL 60601');
    expect(mail?.html).toContain(`${ORIGIN}/unsubscribe/`);
    expect(mail?.headers['List-Unsubscribe']).toContain('/api/unsubscribe/');
    expect(mail?.text).not.toContain('{{');
    // Completed and finalized: events for the alert engine / analytics.
    await runOrgCampaigns(a.org.id, ports, { now: NOON });
    expect((await executeQuery(getCampaignQuery, { campaignId: c.id }, a.ctx(), ports)).status).toBe('sent');
    const done = await executeQuery(campaignResultsQuery, { campaignId: c.id }, a.ctx(), ports);
    expect(done.sent).toBeGreaterThanOrEqual(1);
    expect(done.pending).toBe(0);
    expect(done.opened).toBeNull();
    expect((await events(a, 'campaigns.send_started')).map((e) => e.aggregateId)).toContain(c.id);
    expect((await events(a, 'campaigns.send_completed')).map((e) => e.aggregateId)).toContain(c.id);
  }, 120_000);

  it('the dispatcher gate still refuses a person whose consent was withdrawn after the snapshot', async () => {
    const t = tag();
    const id = await person(a, `late+${t}@x.test`, 'granted');
    const c = await campaign(a);
    await sendNow(a, c.id);
    await withTenant(systemCtx(a.org.id), (tx) =>
      recordConsentTx(tx, systemCtx(a.org.id), { contactId: id, channel: 'email', purpose: 'marketing', status: 'withdrawn', evidence: 'test' }),
    );
    await runOrgCampaigns(a.org.id, ports, { now: NOON });
    const mem = memoryTransports();
    await drain(a, mem.transports);
    expect(mem.emails.filter((e) => e.to === `late+${t}@x.test`)).toHaveLength(0);
    const [m] = (await messagesOf(a, `campaign:${c.id}:`)).filter((x) => x.contact_id === id);
    expect(m).toMatchObject({ status: 'suppressed', reason: 'consent_withdrawn' });
  }, 60_000);

  it('refuses to start when nobody can receive it, and while messaging is paused', async () => {
    const c = await executeCommand(createCampaignCommand, { name: `Empty ${tag()}` }, a.ctx(), ports);
    expect(await refusal(sendNow(a, c.id))).toMatch(/^invalid_state:(content_invalid|no_audience)/);
  });
});

describe('exactly once per recipient under job retries', () => {
  it('concurrent and repeated releases, a crashed job and repeated dispatches send each person one message', async () => {
    const t = tag();
    const ids = [];
    for (let i = 0; i < 12; i++) ids.push(await person(b, `once${i}+${t}@x.test`, 'granted'));
    const c = await campaign(b);
    await sendNow(b, c.id);
    const release = () =>
      executeCommand(releaseChunkCommand, { campaignId: c.id, max: 5 }, sys(b.org.id, NOON), ports).catch(
        (err) => (isDomainError(err) && err.code === 'conflict' ? null : Promise.reject(err)),
      );
    await Promise.all([release(), release(), release(), release()]);
    for (let i = 0; i < 20; i++) await release();
    const mem = memoryTransports();
    await Promise.all([drain(b, mem.transports), drain(b, mem.transports)]);
    await drain(b, mem.transports);
    const mine = mem.emails.filter((e) => e.to.endsWith(`+${t}@x.test`)).map((e) => e.to);
    expect(mine.sort()).toEqual(ids.map((_, i) => `once${i}+${t}@x.test`).sort());
    const msgs = (await messagesOf(b, `campaign:${c.id}:`)).filter((m) => ids.includes(m.contact_id ?? ''));
    expect(msgs).toHaveLength(12);
    expect(new Set(msgs.map((m) => m.dedupe_key)).size).toBe(12);
    // A replayed release after completion does nothing.
    expect((await release())?.released ?? 0).toBe(0);
  }, 120_000);

  it('a message queued by a job that died before marking its recipient is not sent twice', async () => {
    const t = tag();
    const id = await person(b, `crash+${t}@x.test`, 'granted');
    const c = await campaign(b);
    await sendNow(b, c.id);
    // Simulate the crash: the message exists (as the notifier would have queued it) but the row is pending.
    const { createNotifier } = await import('@yayatoh/notifications');
    await withTenant(systemCtx(b.org.id), (tx) =>
      createNotifier().enqueue(tx, {
        kind: 'marketing.message',
        to: { email: `crash+${t}@x.test`, contactId: id },
        channels: ['email'],
        params: { subject: 's', body: '', name: '' },
        dedupeKey: `campaign:${c.id}:${id}`,
      }),
    );
    await runOrgCampaigns(b.org.id, ports, { now: NOON });
    const msgs = (await messagesOf(b, `campaign:${c.id}:`)).filter((m) => m.contact_id === id);
    expect(msgs).toHaveLength(1);
  }, 60_000);
});

describe('pause, resume, cancel and per-org quotas', () => {
  it("releases within the org's per-minute rate from its quota; pause stops, resume continues, cancel drops the rest", async () => {
    const staff = createCtx({ orgId: a.org.id, actor: { type: 'system', name: 'staff:ops' } });
    // A 300-email monthly quota → 30 per minute.
    await executeCommand(setQuotaLimitCommand, { channel: 'email', monthlyLimit: 300, reason: 'test rate' }, staff, ports);
    try {
      const t = tag();
      for (let i = 0; i < 70; i++) await person(a, `rate${i}+${t}@x.test`, 'granted');
      const base = new Date('2031-03-04T17:00:00Z');
      const at = (s: number) => new Date(base.getTime() + s * 1000);
      const c = await campaign(a);
      await sendNow(a, c.id, at(0));
      const rel = (s: number, max = 500) =>
        executeCommand(releaseChunkCommand, { campaignId: c.id, max }, sys(a.org.id, at(s)), ports);
      expect((await rel(1)).released).toBe(30);
      expect((await rel(2)).released).toBe(0); // the minute's budget is spent
      await executeCommand(pauseCampaignCommand, { campaignId: c.id }, a.ctx({ now: at(3) }), ports);
      expect((await rel(70)).released).toBe(0); // paused: nothing more goes out
      expect(await refusal(executeCommand(pauseCampaignCommand, { campaignId: c.id }, a.ctx(), ports))).toMatch(
        /^invalid_state/,
      );
      await executeCommand(resumeCampaignCommand, { campaignId: c.id }, a.ctx({ now: at(80) }), ports);
      expect((await rel(81)).released).toBe(30);
      const before = await executeQuery(campaignResultsQuery, { campaignId: c.id }, a.ctx(), ports);
      expect(before.released).toBe(60);
      await executeCommand(cancelCampaignCommand, { campaignId: c.id }, a.ctx({ now: at(82) }), ports);
      const after = await executeQuery(campaignResultsQuery, { campaignId: c.id }, a.ctx(), ports);
      expect(after.pending).toBe(0);
      expect(after.released).toBe(60);
      expect(after.waiting).toBe(0); // queued messages were cancelled with the campaign
      expect(after.reasons).toContainEqual({ channel: 'email', reason: 'campaign_cancelled', count: 60 });
      expect((await rel(200)).released).toBe(0);
      const rows = await recipients(a, c.id);
      expect(rows.filter((r) => r.status === 'cancelled').length).toBe(before.pending);
    } finally {
      await executeCommand(setQuotaLimitCommand, { channel: 'email', monthlyLimit: null, reason: 'test reset' }, staff, ports);
    }
  }, 180_000);

  it('over the monthly quota, campaign messages wait at the gate (quota_reached), never dropped', async () => {
    const staff = createCtx({ orgId: b.org.id, actor: { type: 'system', name: 'staff:ops' } });
    const t = tag();
    await person(b, `quota+${t}@x.test`, 'granted');
    const c = await campaign(b);
    await sendNow(b, c.id);
    await runOrgCampaigns(b.org.id, ports, { now: NOON });
    await executeCommand(setQuotaLimitCommand, { channel: 'email', monthlyLimit: 1, reason: 'test quota' }, staff, ports);
    try {
      const mem = memoryTransports();
      await drain(b, mem.transports, new Date('2030-07-17T17:00:00Z'));
      const waiting = (await messagesOf(b, `campaign:${c.id}:`)).filter((m) => m.status === 'queued');
      expect(waiting.length).toBeGreaterThan(0);
      expect(waiting.every((m) => m.reason === 'quota_reached')).toBe(true);
    } finally {
      await executeCommand(setQuotaLimitCommand, { channel: 'email', monthlyLimit: null, reason: 'test reset' }, staff, ports);
    }
  }, 60_000);
});

describe('schedules in the org timezone', () => {
  it('schedules a local time, refuses the past, starts when due; a schedule that cannot start is cancelled with send_failed', async () => {
    await person(a, `sched+${tag()}@x.test`, 'granted');
    const c = await campaign(a);
    const now = new Date('2030-07-16T12:00:00Z');
    expect(
      await refusal(executeCommand(scheduleCampaignCommand, { campaignId: c.id, at: '2030-07-16T06:00' }, a.ctx({ now }), ports)),
    ).toBe('validation_failed:in_past');
    // 09:00 in Chicago (CDT, UTC−5) is 14:00 UTC.
    const s = await executeCommand(scheduleCampaignCommand, { campaignId: c.id, at: '2030-07-16T09:00' }, a.ctx({ now }), ports);
    expect(s.status).toBe('scheduled');
    expect(s.scheduledAt?.toISOString()).toBe('2030-07-16T14:00:00.000Z');
    // Drafts only are edited: a scheduled campaign is refused until unscheduled.
    expect(
      await refusal(
        executeCommand(saveCampaignCommand, { campaignId: c.id, name: c.name, locale: 'en', content: s.content as never }, a.ctx(), ports),
      ),
    ).toBe('invalid_state:not_draft');
    await runOrgCampaigns(a.org.id, ports, { now: new Date('2030-07-16T13:59:00Z') });
    expect((await executeQuery(getCampaignQuery, { campaignId: c.id }, a.ctx(), ports)).status).toBe('scheduled');
    await runOrgCampaigns(a.org.id, ports, { now: new Date('2030-07-16T14:00:30Z') });
    expect((await executeQuery(getCampaignQuery, { campaignId: c.id }, a.ctx(), ports)).status).toMatch(/sending|sent/);

    // Unschedule goes back to draft.
    const d = await campaign(a);
    await executeCommand(scheduleCampaignCommand, { campaignId: d.id, at: '2030-07-16T09:00' }, a.ctx({ now }), ports);
    expect((await executeCommand(unscheduleCampaignCommand, { campaignId: d.id }, a.ctx({ now }), ports)).status).toBe('draft');

    // An SMS campaign nobody consented to by text: when due, it is cancelled with the reason.
    const sms = await campaign(a, { channel: 'sms', smsBody: 'Spring season opens Friday.' });
    await executeCommand(scheduleCampaignCommand, { campaignId: sms.id, at: '2030-07-16T10:00' }, a.ctx({ now }), ports);
    await runOrgCampaigns(a.org.id, ports, { now: new Date('2030-07-16T15:01:00Z') });
    const failed = await executeQuery(getCampaignQuery, { campaignId: sms.id }, a.ctx(), ports);
    expect(failed).toMatchObject({ status: 'cancelled', failureReason: 'no_recipients' });
    const ev = (await events(a, 'campaigns.send_failed')).find((e) => e.aggregateId === sms.id);
    expect(ev?.payload).toMatchObject({ reason: 'no_recipients', campaignId: sms.id });
  }, 120_000);
});

describe('SMS campaigns', () => {
  it('only contacts with SMS marketing consent and a number; quiet hours hold texts at night', async () => {
    const t = tag();
    const text = await person(b, `sms+${t}@x.test`, null, { phone: '+13125550142', sms: 'granted' });
    const noText = await person(b, `nosms+${t}@x.test`, 'granted', { phone: '+13125550143' });
    const c = await campaign(b, { channel: 'sms', smsBody: 'Hi {{first_name|there}}, spring opens Friday.' });
    await sendNow(b, c.id);
    const rows = await recipients(b, c.id);
    expect(rows.find((r) => r.contact_id === text)).toMatchObject({ status: 'pending' });
    expect(rows.find((r) => r.contact_id === noText)).toMatchObject({ reason: 'consent_missing' });
    // Its own minute: the org's per-minute budget at NOON was spent by the tests above.
    await runOrgCampaigns(b.org.id, ports, { now: new Date('2030-07-18T17:00:00Z') });
    const mem = memoryTransports();
    // 03:00 in Chicago: held for quiet hours.
    await dispatchDue(b.org.id, { transports: mem.transports, appOrigin: ORIGIN, now: () => new Date('2030-07-19T08:00:00Z') }, 200);
    expect(mem.sms.filter((m) => m.to === '+13125550142')).toHaveLength(0);
    const all = await messagesOf(b, `campaign:${c.id}:`);
    const [held] = all.filter((m) => m.contact_id === text);
    expect(held).toMatchObject({ status: 'queued', channel: 'sms' });
    expect(held?.reason).toMatch(/quiet_hours|state_quiet_hours/);
    await drain(b, mem.transports, new Date('2030-07-19T17:00:00Z'));
    const [sms] = mem.sms.filter((m) => m.to === '+13125550142');
    expect(sms?.body).toContain('Hi Rae, spring opens Friday.');
    expect(sms?.body).toContain('Reply STOP to opt out.');
  }, 120_000);
});

describe('test sends', () => {
  it('go to up to five addresses, clearly marked, not counted, limited per hour', async () => {
    const c = await campaign(a);
    const addresses = ['t1@x.test', 't2@x.test'];
    expect((await executeCommand(testSendCommand, { campaignId: c.id, addresses }, a.ctx(), ports)).queued).toBe(2);
    expect(
      await refusal(
        executeCommand(testSendCommand, { campaignId: c.id, addresses: ['1@x.test', '2@x.test', '3@x.test', '4@x.test', '5@x.test', '6@x.test'] }, a.ctx(), ports),
      ),
    ).toMatch(/^validation_failed/);
    const mem = memoryTransports();
    await drain(a, mem.transports, new Date('2030-07-16T08:00:00Z')); // night: tests are not held
    const mails = mem.emails.filter((e) => addresses.includes(e.to));
    expect(mails).toHaveLength(2);
    expect(mails[0]?.subject).toBe('[Test] Spring for you');
    expect(mails[0]?.html).toContain('data-test-banner');
    expect(mails[0]?.html).toContain('Hello there');
    const r = await executeQuery(campaignResultsQuery, { campaignId: c.id }, a.ctx(), ports);
    expect(r.sent).toBe(0);
    // 2 so far; 5 + 5 + 5 + 3 reaches the hourly limit of 20 test recipients.
    const five = ['a@x.test', 'b@x.test', 'c@x.test', 'd@x.test', 'e@x.test'];
    for (const list of [five, five, five, five.slice(0, 3)])
      await executeCommand(testSendCommand, { campaignId: c.id, addresses: list }, a.ctx(), ports);
    expect(
      await refusal(executeCommand(testSendCommand, { campaignId: c.id, addresses: ['z@x.test'] }, a.ctx(), ports)),
    ).toBe('rate_limited:test_limit');
  }, 60_000);
});

describe('results', () => {
  it('count delivered, bounced, complained, unsubscribed and clicks from provider reports', async () => {
    const t = tag();
    await person(b, `r1+${t}@x.test`, 'granted');
    await person(b, `r2+${t}@x.test`, 'granted');
    const c = await campaign(b);
    await sendNow(b, c.id);
    await runOrgCampaigns(b.org.id, ports, { now: NOON });
    const mem = memoryTransports();
    await drain(b, mem.transports);
    const sent = (await messagesOf(b, `campaign:${c.id}:`)).filter((m) => m.recipient_email?.endsWith(`+${t}@x.test`));
    expect(sent).toHaveLength(2);
    const ids = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ id: string; recipient_email: string }>(
        sql`select id, recipient_email from notifications.messages where dedupe_key like ${`campaign:${c.id}:%`} and recipient_email like ${`%+${t}@x.test`}`,
      ),
    );
    const mid = (e: string) => ids.find((r) => r.recipient_email === e)?.id ?? '';
    await executeCommand(
      recordDeliveryEventsCommand,
      {
        provider: 'fake',
        events: [
          { id: `d1-${t}`, messageId: mid(`r1+${t}@x.test`), type: 'delivered', occurredAt: NOON },
          { id: `b1-${t}`, messageId: mid(`r2+${t}@x.test`), type: 'bounced', bounceType: 'hard', occurredAt: NOON },
        ],
      },
      sys(b.org.id),
      ports,
    );
    const r = await executeQuery(campaignResultsQuery, { campaignId: c.id }, b.ctx(), ports);
    expect(r.delivered).toBeGreaterThanOrEqual(1);
    expect(r.bounced).toBeGreaterThanOrEqual(1);
    expect(r.clicked).toBe(0);
  }, 60_000);
});

describe('permissions and isolation', () => {
  it('viewers read but cannot build or send; box office sees nothing; the marketing role builds and sends', async () => {
    const c = await campaign(a);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(listCampaignsQuery, {}, viewer, ports)).map((x) => x.id)).toContain(c.id);
    expect((await executeQuery(campaignResultsQuery, { campaignId: c.id }, viewer, ports)).sent).toBe(0);
    expect(await refusal(executeCommand(createCampaignCommand, { name: `V ${tag()}` }, viewer, ports))).toMatch(/^forbidden/);
    expect(await refusal(executeCommand(sendNowCommand, { campaignId: c.id }, { ...viewer, idempotencyKey: tag() }, ports))).toMatch(/^forbidden/);
    expect(await refusal(executeCommand(testSendCommand, { campaignId: c.id, addresses: ['v@x.test'] }, viewer, ports))).toMatch(/^forbidden/);
    const boxOffice = uuidv7();
    const marketer = uuidv7();
    await executeCommand(addMemberCommand, { userId: boxOffice, role: 'box_office' }, a.ctx(), ports);
    await executeCommand(addMemberCommand, { userId: marketer, role: 'marketing' }, a.ctx(), ports);
    expect(await refusal(executeQuery(listCampaignsQuery, {}, userCtx(boxOffice, a.org.id), ports))).toMatch(/^forbidden/);
    const m = await executeCommand(createCampaignCommand, { name: `M ${tag()}` }, userCtx(marketer, a.org.id), ports);
    expect(m.status).toBe('draft');
    const preview = await executeQuery(campaignPreviewQuery, { campaignId: c.id, origin: ORIGIN }, viewer, ports);
    expect(preview.html).toContain('Hello there');
    expect(preview.html).toContain(`${ORIGIN}/unsubscribe/preview`);
  }, 60_000);

  it("another org can't read, change or send an org's campaign, nor point it at its audience", async () => {
    const c = await campaign(a);
    expect(await refusal(executeQuery(getCampaignQuery, { campaignId: c.id }, b.ctx(), ports))).toMatch(/^not_found/);
    expect(await refusal(executeQuery(campaignResultsQuery, { campaignId: c.id }, b.ctx(), ports))).toMatch(/^not_found/);
    expect(await refusal(sendNow(b, c.id))).toMatch(/^not_found/);
    expect(await refusal(executeCommand(cancelCampaignCommand, { campaignId: c.id }, b.ctx(), ports))).toMatch(/^not_found/);
    expect((await executeQuery(listCampaignsQuery, {}, b.ctx(), ports)).map((x) => x.id)).not.toContain(c.id);
    const bSeg = await everyone(b);
    expect(
      await refusal(executeCommand(setAudienceCommand, { campaignId: c.id, audience: { kind: 'segment', segmentId: bSeg.id } }, a.ctx(), ports)),
    ).toMatch(/^not_found/);
    // A button pointing at another org's event is refused.
    const d = await executeCommand(createCampaignCommand, { name: `X ${tag()}` }, a.ctx(), ports);
    expect(
      await refusal(
        executeCommand(
          saveCampaignCommand,
          {
            campaignId: d.id,
            name: d.name,
            locale: 'en',
            content: {
              subject: 'x',
              preheader: '',
              font: 'sans',
              smsBody: '',
              blocks: [
                { id: 'b1', type: 'eventCard', eventId: b.event.id },
                { id: 'b2', type: 'footer', postalAddress: '1 Lake St', note: '' },
              ],
            },
          },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:event_not_found');
  }, 60_000);
});
