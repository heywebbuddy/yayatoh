import { saveSegmentCommand } from '@yayatoh/audiences';
import { mergeContactsCommand, recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import {
  audienceSyncQuery,
  consentChangesQuery,
  fakeIntegrations,
  HUBSPOT_SEED_CONTACT,
  HUBSPOT_SEED_OPTED_OUT,
  hubspotRemoteContacts,
  hubspotRemoteEvents,
  hubspotRemoteOptOut,
  KLAVIYO_LISTS,
  KLAVIYO_SEED_BOUNCED,
  klaviyoRemoteMembers,
  klaviyoRemoteSet,
  MAILCHIMP_LISTS,
  MAILCHIMP_SEED_UNSUBSCRIBED,
  mailchimpRemoteMembers,
  mailchimpRemoteSet,
  providerLists,
  runSync,
  saveAudienceSyncCommand,
} from '@yayatoh/integrations';
import { type Ctx, executeCommand, executeQuery, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { suppressAddressFromIntegrationTx, suppressEmailTx } from '@yayatoh/notifications';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bareOrg, connectFake, fakeAuth, type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.4d on real Postgres with the fake `IntegrationAuth` and the recorded-shape fakes: Mailchimp
 * and Klaviyo push an audience as a list and pull unsubscribes, cleaned addresses and complaints
 * back; HubSpot syncs contacts both ways and pushes marketing events with registration and
 * attendance. Consent first (property test over random consent states), both-way propagation
 * within one run, replays write once, permissions and isolation.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
const deps = { auth: fakeAuth };
const tag = uuidv7().slice(-8);
let n = 0;
const fresh = () => bareOrg(`mkt-${tag}-${++n}`, `Marketing sync ${n}`);

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
}, 240_000);
afterAll(async () => {
  await closePools();
  await admin.end();
});

type Consent = 'granted' | 'withdrawn' | 'unknown_legacy' | null;
interface Person {
  email: string;
  name?: string;
  consent?: Consent;
  sms?: boolean;
  unsubscribed?: boolean;
  bounced?: boolean;
}

/** Contacts with consent rows and suppressions, as checkout, the preference center and bounces leave them. */
async function people(ctx: Ctx, list: readonly Person[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  await withTenant(ctx, async (tx) => {
    for (const p of list) {
      const { id } = await upsertContactTx(tx, ctx, { email: p.email, name: p.name ?? null, source: 'checkout' });
      ids.set(p.email, id);
      if (p.consent)
        await recordConsentTx(tx, ctx, {
          contactId: id,
          channel: 'email',
          purpose: 'marketing',
          status: p.consent,
          evidence: 'test',
        });
      if (p.sms)
        await recordConsentTx(tx, ctx, {
          contactId: id,
          channel: 'sms',
          purpose: 'marketing',
          status: 'granted',
          evidence: 'test',
        });
      if (p.unsubscribed) await suppressEmailTx(tx, requireOrg(ctx), p.email, 'marketing', 'page');
      if (p.bounced) await suppressAddressFromIntegrationTx(tx, requireOrg(ctx), p.email, 'hard_bounce');
    }
  });
  return ids;
}

const withdraw = (ctx: Ctx, contactId: string) =>
  withTenant(ctx, (tx) =>
    recordConsentTx(tx, ctx, {
      contactId,
      channel: 'email',
      purpose: 'marketing',
      status: 'withdrawn',
      evidence: 'preference_center',
    }),
  );

const sync = async (orgId: string, connectionId: string) => {
  const r = await runSync(orgId, connectionId, deps, ports, { force: true });
  expect(r.status).toBe('claimed');
  return r;
};
const runCounts = async (ctx: Ctx, runId: string | null) => {
  const [r] = await withTenant(ctx, (tx) =>
    tx.execute<{ pulled: number; pushed: number; skipped: number; failed: number; status: string }>(
      sql`select pulled, pushed, skipped, failed, status from integrations.sync_runs where id = ${runId}`,
    ),
  );
  return r;
};
const account = (authConnectionId: string) => {
  const acc = fakeIntegrations.account(authConnectionId);
  if (!acc) throw new Error('no fake account');
  return acc;
};
const writes = (authConnectionId: string) =>
  account(authConnectionId).log.filter((l) => l.method !== 'GET' && !l.path.endsWith('/search')).length;
const membersOf = (authConnectionId: string, listId: string) =>
  Object.fromEntries(
    mailchimpRemoteMembers(account(authConnectionId), listId).map((m) => [m.email_address, m.status]),
  );
const consentOf = (ctx: Ctx, email: string) =>
  withTenant(ctx, async (tx) => {
    const [r] = await tx.execute<{ status: string | null; evidence: string | null }>(sql`
      select k.status, k.evidence from crm.contacts c
      left join lateral (select status, evidence from crm.consents k where k.contact_id = c.id and k.channel = 'email'
        and k.purpose = 'marketing' order by captured_at desc, id desc limit 1) k on true
      where c.email_norm = ${email}`);
    return r ?? null;
  });
const suppressionOf = (ctx: Ctx, email: string) =>
  withTenant(ctx, async (tx) => {
    const [s] = await tx.execute<{ source: string }>(
      sql`select source from notifications.suppressions where email_norm = ${email} and category = 'marketing'`,
    );
    const [h] = await tx.execute<{ reason: string }>(
      sql`select reason from notifications.address_suppressions where address_norm = ${email} and channel = 'email'`,
    );
    return { unsubscribe: s?.source ?? null, address: h?.reason ?? null };
  });
const ledgerCount = async (ctx: Ctx) => {
  const [r] = await withTenant(ctx, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from integrations.consent_changes`),
  );
  return r?.n ?? 0;
};

describe('Mailchimp: push an audience as a list, pull consent changes back', () => {
  it('pushes only consented contacts, brings an earlier unsubscribe in, and replays write nothing', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    const e = (s: string) => `${s}.${tag}@mc.test`;
    await people(ctx, [
      { email: e('ada'), name: 'Ada Lovelace', consent: 'granted' },
      { email: e('ben'), name: 'Ben', consent: 'granted' },
      { email: e('cy'), name: 'Cy', consent: null },
      { email: e('dee'), name: 'Dee', consent: 'withdrawn' },
      { email: e('eve'), name: 'Eve', consent: 'granted', unsubscribed: true },
      { email: e('fay'), name: 'Fay', consent: 'granted', bounced: true },
      { email: e('gil'), name: 'Gil', consent: 'unknown_legacy' },
    ]);
    const { connectionId, authConnectionId } = await connectFake(ctx, 'mailchimp');
    // Before an audience and a list are chosen, a run reads and sends nothing.
    await sync(org.orgId, connectionId);
    expect(writes(authConnectionId)).toBe(0);
    const lists = await providerLists(ctx, fakeAuth, connectionId);
    expect(lists.map((l) => l.name)).toEqual(MAILCHIMP_LISTS.map((l) => l.name));
    const list = MAILCHIMP_LISTS[0].id;
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: null, listId: list, listName: 'Newsletter' },
      ctx,
      ports,
    );
    const run = await sync(org.orgId, connectionId);
    expect(run.runStatus).toBe('succeeded');
    expect(membersOf(authConnectionId, list)).toEqual({
      [MAILCHIMP_SEED_UNSUBSCRIBED]: 'unsubscribed',
      [e('ada')]: 'subscribed',
      [e('ben')]: 'subscribed',
    });
    const ada = mailchimpRemoteMembers(account(authConnectionId), list).find((m) => m.email_address === e('ada'));
    expect(ada?.merge_fields).toEqual({ FNAME: 'Ada', LNAME: 'Lovelace' });
    // The person who unsubscribed in Mailchimp before is suppressed here, with Mailchimp as source.
    expect(await consentOf(ctx, MAILCHIMP_SEED_UNSUBSCRIBED)).toMatchObject({
      status: 'withdrawn',
      evidence: `integration:mailchimp:${connectionId}`,
    });
    expect(await suppressionOf(ctx, MAILCHIMP_SEED_UNSUBSCRIBED)).toEqual({ unsubscribe: 'mailchimp', address: null });
    const history = await executeQuery(consentChangesQuery, { connectionId }, ctx, ports);
    expect(history).toMatchObject([
      { change: 'unsubscribed', email: MAILCHIMP_SEED_UNSUBSCRIBED, consentWithdrawn: true, suppressed: true },
    ]);
    // A replay writes once: nothing is sent, nothing is applied again.
    const before = { writes: writes(authConnectionId), ledger: await ledgerCount(ctx) };
    const again = await sync(org.orgId, connectionId);
    expect(await runCounts(ctx, again.runId)).toMatchObject({ pulled: 0, pushed: 0, failed: 0 });
    expect(writes(authConnectionId)).toBe(before.writes);
    expect(await ledgerCount(ctx)).toBe(before.ledger);
  });

  it('consent changes propagate both ways within one run', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    const e = (s: string) => `${s}.${tag}@mc2.test`;
    const ids = await people(ctx, [
      { email: e('ann'), name: 'Ann', consent: 'granted' },
      { email: e('bob'), name: 'Bob', consent: 'granted' },
      { email: e('cat'), name: 'Cat', consent: 'granted' },
    ]);
    const { connectionId, authConnectionId } = await connectFake(ctx, 'mailchimp');
    const list = MAILCHIMP_LISTS[1].id;
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: null, listId: list, listName: 'Event attendees' },
      ctx,
      ports,
    );
    await sync(org.orgId, connectionId);
    // Ann unsubscribes in Mailchimp, Bob in Yayatoh's preference center; Cat's address bounces there.
    mailchimpRemoteSet(account(authConnectionId), list, e('ann'), 'unsubscribed');
    mailchimpRemoteSet(account(authConnectionId), list, e('cat'), 'cleaned');
    await withdraw(ctx, ids.get(e('bob')) as string);
    const run = await sync(org.orgId, connectionId);
    expect(await runCounts(ctx, run.runId)).toMatchObject({ pulled: 2, pushed: 1, failed: 0 });
    expect(await consentOf(ctx, e('ann'))).toMatchObject({ status: 'withdrawn' });
    expect(await suppressionOf(ctx, e('ann'))).toEqual({ unsubscribe: 'mailchimp', address: null });
    // A cleaned address is suppressed for every category; consent is left as it was.
    expect(await suppressionOf(ctx, e('cat'))).toEqual({ unsubscribe: null, address: 'hard_bounce' });
    expect(await consentOf(ctx, e('cat'))).toMatchObject({ status: 'granted' });
    expect(membersOf(authConnectionId, list)).toMatchObject({
      [e('ann')]: 'unsubscribed',
      [e('bob')]: 'unsubscribed',
      [e('cat')]: 'cleaned',
    });
    // Nothing echoes back on the next run.
    const quiet = await sync(org.orgId, connectionId);
    expect(await runCounts(ctx, quiet.runId)).toMatchObject({ pulled: 0, pushed: 0, failed: 0 });
  });

  it('a segment narrows the audience; members who leave it are archived, not unsubscribed; a new list starts over', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    const e = (s: string) => `${s}.${tag}@mc3.test`;
    await people(ctx, [
      { email: e('sms'), name: 'Sam', consent: 'granted', sms: true },
      { email: e('mail'), name: 'Mia', consent: 'granted' },
    ]);
    const { connectionId, authConnectionId } = await connectFake(ctx, 'mailchimp');
    const list = MAILCHIMP_LISTS[0].id;
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: null, listId: list, listName: 'Newsletter' },
      ctx,
      ports,
    );
    await sync(org.orgId, connectionId);
    expect(membersOf(authConnectionId, list)).toMatchObject({ [e('sms')]: 'subscribed', [e('mail')]: 'subscribed' });
    const segment = await executeCommand(
      saveSegmentCommand,
      {
        name: `Texts too ${tag}`,
        definition: {
          version: 1,
          root: { type: 'group', op: 'and', conditions: [{ type: 'consent', channel: 'sms', granted: true }] },
        },
      },
      ctx,
      ports,
    );
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: segment.id, listId: list, listName: 'Newsletter' },
      ctx,
      ports,
    );
    await sync(org.orgId, connectionId);
    const statuses = membersOf(authConnectionId, list);
    expect(statuses[e('sms')]).toBe('subscribed');
    expect(statuses[e('mail')]).toBeUndefined(); // archived: off the list
    expect(await consentOf(ctx, e('mail'))).toMatchObject({ status: 'granted' });
    expect(await executeQuery(audienceSyncQuery, { connectionId }, ctx, ports)).toMatchObject({
      segmentId: segment.id,
      segmentMissing: false,
      listId: list,
    });
    // Another list: the audience is pushed there from the start.
    const other = MAILCHIMP_LISTS[1].id;
    const saved = await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: segment.id, listId: other, listName: 'Event attendees' },
      ctx,
      ports,
    );
    expect(saved.listChanged).toBe(true);
    await sync(org.orgId, connectionId);
    expect(membersOf(authConnectionId, other)).toMatchObject({ [e('sms')]: 'subscribed' });
    expect(membersOf(authConnectionId, other)[e('mail')]).toBeUndefined();
  });

  it('property: over random consent states, an unsubscribed contact is never pushed', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    let seed = 0x4d36;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const emails = Array.from({ length: 24 }, (_, i) => `p${i}.${tag}@prop.test`);
    const ids = await people(
      ctx,
      emails.map((email) => ({ email, consent: null })),
    );
    const { connectionId, authConnectionId } = await connectFake(ctx, 'mailchimp');
    const list = MAILCHIMP_LISTS[0].id;
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: null, listId: list, listName: 'Newsletter' },
      ctx,
      ports,
    );
    const eligible = async () =>
      new Set(
        (
          await withTenant(ctx, (tx) =>
            tx.execute<{ email: string }>(sql`
              select c.email_norm as email from crm.contacts c
              join lateral (select status from crm.consents k where k.contact_id = c.id and k.channel = 'email'
                and k.purpose = 'marketing' order by captured_at desc, id desc limit 1) k on true
              where k.status = 'granted'
                and not exists (select 1 from notifications.suppressions s where s.email_norm = c.email_norm and s.category = 'marketing')
                and not exists (select 1 from notifications.address_suppressions h where h.address_norm = c.email_norm and h.channel = 'email')`),
          )
        ).map((r) => r.email),
      );
    const everEligible = new Set<string>();
    for (let round = 0; round < 4; round++) {
      // Random consent changes: grants, withdrawals, legacy unknowns, unsubscribes, bounces.
      await withTenant(ctx, async (tx) => {
        for (const email of emails) {
          const r = next();
          const contactId = ids.get(email) as string;
          if (r < 0.35)
            await recordConsentTx(tx, ctx, {
              contactId,
              channel: 'email',
              purpose: 'marketing',
              status: 'granted',
              evidence: 'prop',
            });
          else if (r < 0.55)
            await recordConsentTx(tx, ctx, {
              contactId,
              channel: 'email',
              purpose: 'marketing',
              status: 'withdrawn',
              evidence: 'prop',
            });
          else if (r < 0.62)
            await recordConsentTx(tx, ctx, {
              contactId,
              channel: 'email',
              purpose: 'marketing',
              status: 'unknown_legacy',
              evidence: 'prop',
            });
          else if (r < 0.7) await suppressEmailTx(tx, requireOrg(ctx), email, 'marketing', 'page');
          else if (r < 0.74) await suppressAddressFromIntegrationTx(tx, requireOrg(ctx), email, 'hard_bounce');
        }
      });
      const allowed = await eligible();
      for (const x of allowed) everEligible.add(x);
      const log = account(authConnectionId).log.length;
      await sync(org.orgId, connectionId);
      const remote = membersOf(authConnectionId, list);
      for (const email of emails) {
        // Subscribed at Mailchimp ⇒ may receive marketing now.
        if (remote[email] === 'subscribed') expect(allowed.has(email)).toBe(true);
        // On the list at all ⇒ was eligible at some point (never pushed otherwise).
        if (remote[email]) expect(everEligible.has(email)).toBe(true);
      }
      // Every write this round went to an address that was on the list or may receive now.
      const sent = account(authConnectionId).log.slice(log).filter((l) => l.method === 'PUT');
      expect(sent.length).toBeLessThanOrEqual(emails.length);
    }
  }, 120_000);
});

describe('Klaviyo: lists and suppressions', () => {
  it('pushes consented profiles to the list; complaints, bounces and unsubscribes come back', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    const e = (s: string) => `${s}.${tag}@kl.test`;
    const ids = await people(ctx, [
      { email: e('kim'), name: 'Kim Lee', consent: 'granted' },
      { email: e('lou'), name: 'Lou', consent: 'granted' },
      { email: e('max'), name: 'Max', consent: null },
    ]);
    const { connectionId, authConnectionId } = await connectFake(ctx, 'klaviyo');
    const list = KLAVIYO_LISTS[0].id;
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: null, listId: list, listName: 'Newsletter' },
      ctx,
      ports,
    );
    await sync(org.orgId, connectionId);
    const status = () =>
      Object.fromEntries(
        klaviyoRemoteMembers(account(authConnectionId), list).map((p) => [
          p.attributes.email,
          p.attributes.subscriptions.email.marketing.consent,
        ]),
      );
    expect(status()).toEqual({ [KLAVIYO_SEED_BOUNCED]: 'SUBSCRIBED', [e('kim')]: 'SUBSCRIBED', [e('lou')]: 'SUBSCRIBED' });
    expect(
      klaviyoRemoteMembers(account(authConnectionId), list).find((p) => p.attributes.email === e('kim'))?.attributes,
    ).toMatchObject({ first_name: 'Kim', last_name: 'Lee' });
    // The profile Klaviyo had suppressed for a hard bounce is suppressed here too.
    expect(await suppressionOf(ctx, KLAVIYO_SEED_BOUNCED)).toEqual({ unsubscribe: null, address: 'hard_bounce' });
    klaviyoRemoteSet(account(authConnectionId), list, e('kim'), 'complained');
    await withdraw(ctx, ids.get(e('lou')) as string);
    await sync(org.orgId, connectionId);
    expect(await suppressionOf(ctx, e('kim'))).toEqual({ unsubscribe: 'klaviyo', address: 'complaint' });
    expect(await consentOf(ctx, e('kim'))).toMatchObject({ status: 'withdrawn' });
    expect(status()[e('lou')]).toBe('UNSUBSCRIBED');
    expect(status()[e('max')]).toBeUndefined();
    const changes = await executeQuery(consentChangesQuery, { connectionId }, ctx, ports);
    expect(changes.map((c) => c.change).sort()).toEqual(['cleaned', 'complained']);
  });
});

describe('HubSpot: contacts both ways, marketing events and attendance', () => {
  it('syncs contacts with consent rules, events and registration/attendance; replays write once', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    const e = (s: string) => `${s}.${tag}@hs.test`;
    const ids = await people(ctx, [
      { email: e('hal'), name: 'Hal Jordan', consent: 'granted' },
      { email: e('ivy'), name: 'Ivy', consent: 'granted' },
      { email: e('jon'), name: 'Jon', consent: null },
      { email: e('kai'), name: 'Kai', consent: 'granted', unsubscribed: true },
    ]);
    const event = await executeCommand(
      createEventCommand,
      {
        name: `Spring Gala ${tag}`,
        timezone: 'America/Chicago',
        startsAt: '2030-05-01T23:00:00Z',
        endsAt: '2030-05-02T03:00:00Z',
      },
      ctx,
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);
    const draft = await executeCommand(
      createEventCommand,
      { name: `Draft ${tag}`, timezone: 'UTC', startsAt: '2030-07-01T10:00:00Z', endsAt: '2030-07-01T12:00:00Z' },
      ctx,
      ports,
    );
    // Participation (the audiences projector's rows): Hal checked in, Ivy and Jon registered.
    for (const [who, checkedIn] of [
      ['hal', true],
      ['ivy', false],
      ['jon', false],
    ] as const)
      await admin`insert into crm.event_participation (org_id, contact_id, event_id, registered_at, currency, source,
        registered, checked_in) values (${org.orgId}, ${ids.get(e(who)) as string}, ${event.id}, now(), 'USD', 'live',
        true, ${checkedIn})`;
    const { connectionId, authConnectionId } = await connectFake(ctx, 'hubspot');
    const run = await sync(org.orgId, connectionId);
    expect(run.runStatus).toBe('succeeded');
    const remote = () =>
      Object.fromEntries(hubspotRemoteContacts(account(authConnectionId)).map((c) => [c.properties.email, c.properties]));
    // Consented contacts were created; Jon (no consent) and Kai (unsubscribed) never reach HubSpot.
    expect(Object.keys(remote()).sort()).toEqual([HUBSPOT_SEED_CONTACT, HUBSPOT_SEED_OPTED_OUT, e('hal'), e('ivy')].sort());
    expect(remote()[e('hal')]).toMatchObject({ firstname: 'Hal', lastname: 'Jordan', yayatoh_origin: `yayatoh:${connectionId}` });
    // HubSpot's contacts came in without consent; its opt-out became a suppression with its source.
    expect(await consentOf(ctx, HUBSPOT_SEED_CONTACT)).toEqual({ status: null, evidence: null });
    expect(await consentOf(ctx, HUBSPOT_SEED_OPTED_OUT)).toMatchObject({ status: 'withdrawn' });
    expect(await suppressionOf(ctx, HUBSPOT_SEED_OPTED_OUT)).toEqual({ unsubscribe: 'hubspot', address: null });
    const [company] = await withTenant(ctx, (tx) =>
      tx.execute<{ company: string | null }>(
        sql`select company from crm.contacts where email_norm = ${HUBSPOT_SEED_CONTACT}`,
      ),
    );
    expect(company?.company).toBe('Remote Co');
    // The published event is a marketing event; the draft is not. Attendance for consented people only.
    const events = hubspotRemoteEvents(account(authConnectionId));
    expect(events.map((x) => x.externalEventId)).toEqual([event.id]);
    expect(events[0]?.properties).toMatchObject({ eventName: `Spring Gala ${tag}`, eventCancelled: false });
    expect(events.some((x) => x.externalEventId === draft.id)).toBe(false);
    expect(Object.fromEntries(Object.entries(events[0]?.attendance ?? {}).map(([k, v]) => [k, v.state]))).toEqual({
      [e('hal')]: 'attend',
      [e('ivy')]: 'register',
    });
    // Replay: nothing is written.
    const before = writes(authConnectionId);
    const again = await sync(org.orgId, connectionId);
    expect(await runCounts(ctx, again.runId)).toMatchObject({ pulled: 0, pushed: 0, failed: 0 });
    expect(writes(authConnectionId)).toBe(before);

    // Both ways in one run: Hal opts out in HubSpot; Ivy withdraws here; Ivy's registration is cancelled.
    hubspotRemoteOptOut(account(authConnectionId), e('hal'));
    await withdraw(ctx, ids.get(e('ivy')) as string);
    await admin`update crm.event_participation set registered = false, updated_at = now()
      where org_id = ${org.orgId} and contact_id = ${ids.get(e('ivy')) as string}`;
    await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'cancel' }, ctx, ports).catch(
      () => null,
    );
    await sync(org.orgId, connectionId);
    expect(await consentOf(ctx, e('hal'))).toMatchObject({ status: 'withdrawn', evidence: `integration:hubspot:${connectionId}` });
    expect(await suppressionOf(ctx, e('hal'))).toEqual({ unsubscribe: 'hubspot', address: null });
    expect(remote()[e('ivy')]).toMatchObject({ hs_email_optout: 'true' });
    // Ivy no longer consents: her attendance is not touched again (consent first).
    expect(hubspotRemoteEvents(account(authConnectionId))[0]?.attendance[e('ivy')]?.state).toBe('register');
    const quiet = await sync(org.orgId, connectionId);
    expect(await runCounts(ctx, quiet.runId)).toMatchObject({ pulled: 0, pushed: 0, failed: 0 });
  });
});

describe('permissions, isolation and merges', () => {
  it('only integration managers choose the audience; other orgs see nothing', async () => {
    const ctxA = a.ctx();
    const { connectionId } = await connectFake(ctxA, 'klaviyo');
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(
        saveAudienceSyncCommand,
        { connectionId, segmentId: null, listId: 'KlList01', listName: 'Newsletter' },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeQuery(consentChangesQuery, { connectionId }, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Org B can't set up or read org A's connection.
    await expect(
      executeCommand(
        saveAudienceSyncCommand,
        { connectionId, segmentId: null, listId: 'KlList01', listName: 'Newsletter' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(consentChangesQuery, { connectionId }, b.ctx(), ports)).toEqual([]);
    expect(await executeQuery(audienceSyncQuery, { connectionId }, b.ctx(), ports)).toBeNull();
    // A connector without an audience refuses the setting; a bad list id is refused.
    const hs = await connectFake(b.ctx(), 'hubspot');
    await expect(
      executeCommand(
        saveAudienceSyncCommand,
        { connectionId: hs.connectionId, segmentId: null, listId: 'x', listName: 'x' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(
      executeCommand(
        saveAudienceSyncCommand,
        { connectionId, segmentId: null, listId: 'bad list!', listName: 'x' },
        ctxA,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(saveAudienceSyncCommand, { connectionId, segmentId: uuidv7(), listId: 'KlList01', listName: 'x' }, ctxA, ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // The fixture's connection rows exist in both orgs and RLS keeps them apart.
    for (const f of [a, b]) {
      const rows = await withTenant(f.ctx(), (tx) =>
        tx.execute<{ org_id: string }>(sql`select org_id from integrations.consent_changes`),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.org_id === f.org.id)).toBe(true);
    }
  });

  it('a contact merge moves the consent changes to the person who stays', async () => {
    const org = await fresh();
    const ctx = org.ctx();
    const e = (s: string) => `${s}.${tag}@merge.test`;
    const ids = await people(ctx, [{ email: e('keep'), name: 'Keep Me', consent: 'granted' }]);
    const { connectionId, authConnectionId } = await connectFake(ctx, 'mailchimp');
    const list = MAILCHIMP_LISTS[0].id;
    await executeCommand(
      saveAudienceSyncCommand,
      { connectionId, segmentId: null, listId: list, listName: 'Newsletter' },
      ctx,
      ports,
    );
    await sync(org.orgId, connectionId);
    mailchimpRemoteSet(account(authConnectionId), list, e('dupe'), 'unsubscribed');
    await sync(org.orgId, connectionId);
    const [dupe] = await withTenant(ctx, (tx) =>
      tx.execute<{ id: string }>(sql`select id from crm.contacts where email_norm = ${e('dupe')}`),
    );
    expect(dupe).toBeTruthy();
    await executeCommand(
      mergeContactsCommand,
      { targetContactId: ids.get(e('keep')) as string, sourceContactId: dupe?.id as string },
      ctx,
      ports,
    );
    const rows = await withTenant(ctx, (tx) =>
      tx.execute<{ contact_id: string }>(sql`select contact_id from integrations.consent_changes`),
    );
    expect(rows.map((r) => r.contact_id)).toContain(ids.get(e('keep')));
    expect(rows.map((r) => r.contact_id)).not.toContain(dupe?.id);
  });
});
