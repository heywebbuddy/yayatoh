import { contactIdByEmailTx, currentConsentTx, recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  beginConnectCommand,
  connectionDetailQuery,
  FAKE_ACCESS_TOKEN,
  FAKE_REFRESH_TOKEN,
  type FakeAccount,
  fakeIntegrations,
  type IntegrationAuth,
  linkedCountsQuery,
  listErrorGroupsQuery,
  retryErrorsCommand,
  runSync,
  SALESFORCE_BAD_RECORD,
  type SObject,
  SYNC_COMPLETED_EVENT,
  salesforceRemoteEdit,
  salesforceRemoteRecords,
  saveMappingCommand,
} from '@yayatoh/integrations';
import {
  type Ctx,
  currencyExponent,
  DomainError,
  executeCommand,
  executeQuery,
  uuidv7,
} from '@yayatoh/kernel';
import { suppressEmailTx } from '@yayatoh/notifications';
import { crmSponsorRowsTx } from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { findCanaries } from '../src/canary/index.ts';
import {
  bareOrg,
  connectSalesforce,
  fakeAuth,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M6.5b Salesforce on real Postgres against the fake Salesforce org: a round trip of the fixture
 * org without duplicates (people both ways, a campaign per event with its members, sponsor
 * opportunities), field mappings respected both ways, consent (non-consenting, withdrawn and
 * unsubscribed people are never pushed; a Salesforce opt-out withdraws consent here), a revoked
 * connection stopping within one run, the errors inbox, isolation, permissions and token canaries.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
const deps = { auth: fakeAuth };
const tag = uuidv7().slice(-8);
let n = 0;
const fresh = () => bareOrg(`sf-${tag}-${++n}`, `Salesforce ${n}`);

const logged: string[] = [];
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  // biome-ignore lint/suspicious/noConsole: the test captures every log line to check for token canaries
  const orig = console[level].bind(console);
  vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
    logged.push(
      args.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : JSON.stringify(x))).join(' '),
    );
    orig(...(args as []));
  });
}
const outputs: unknown[] = [];
const keep = <T>(v: T) => {
  outputs.push(v);
  return v;
};

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
}, 240_000);
afterAll(async () => {
  await closePools();
  await admin.end();
});

const account = (authConnectionId: string): FakeAccount => {
  const acc = fakeIntegrations.account(authConnectionId);
  if (!acc) throw new Error('no fake account');
  return acc;
};
const remote = (acc: FakeAccount, type: SObject) => salesforceRemoteRecords(acc, type);
const sync = async (orgId: string, connectionId: string, auth: IntegrationAuth = fakeAuth) =>
  keep(await runSync(orgId, connectionId, { auth }, ports, { force: true }));
const lastRun = async (ctx: Ctx, connectionId: string) => {
  const d = keep(await executeQuery(connectionDetailQuery, { connectionId }, ctx, ports));
  const run = d.runs[0];
  if (!run) throw new Error('no run');
  return run;
};
const expectError = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

/** A contact with an email marketing consent history (`granted`, `withdrawn`, … in order). */
async function person(
  ctx: Ctx,
  email: string,
  name: string | null,
  consents: readonly ('granted' | 'withdrawn')[],
) {
  return withTenant(ctx, async (tx) => {
    const { id } = await upsertContactTx(tx, ctx, { email, name, source: 'manual' });
    for (const status of consents) {
      await recordConsentTx(
        tx,
        { ...ctx, now: new Date(Date.now() + 1) },
        {
          contactId: id,
          channel: 'email',
          purpose: 'marketing',
          status,
          evidence: 'test',
        },
      );
      await new Promise((r) => setTimeout(r, 5));
    }
    return id;
  });
}

const participate = (ctx: Ctx, contactId: string, eventId: string, checkedIn: boolean) =>
  withTenant(ctx, (tx) =>
    tx.execute(sql`
      insert into crm.event_participation (org_id, contact_id, event_id, tickets, checked_in, registered, registered_at, currency, source)
      values (${ctx.orgId}, ${contactId}, ${eventId}, 1, ${checkedIn}, true, now(), 'USD', 'live')
      on conflict (org_id, contact_id, event_id) do update set checked_in = excluded.checked_in, registered = true, updated_at = now()`),
  );

const contactCount = async (ctx: Ctx) => {
  const [r] = await withTenant(ctx, (tx) =>
    tx.execute<{ n: number }>(sql`select count(*)::int as n from crm.contacts where merged_into is null`),
  );
  return r?.n ?? 0;
};
const pushableIds = async (ctx: Ctx) =>
  withTenant(ctx, async (tx) =>
    (
      await tx.execute<{ id: string }>(sql`
        select c.id from crm.contacts c
        join lateral (select k.status from crm.consents k where k.org_id = c.org_id and k.contact_id = c.id
          and k.channel = 'email' and k.purpose = 'marketing' order by k.captured_at desc, k.id desc limit 1) lc on lc.status = 'granted'
        where c.merged_into is null
          and not exists (select 1 from notifications.suppressions s where s.org_id = c.org_id and s.email_norm = c.email_norm and s.category = 'marketing')`)
    ).map((r) => r.id),
  );
const linkOf = async (ctx: Ctx, connectionId: string, objectType: string, localId: string) => {
  const [r] = await withTenant(ctx, (tx) =>
    tx.execute<{ external_id: string }>(
      sql`select external_id from integrations.record_links where connection_id = ${connectionId} and object_type = ${objectType} and local_id = ${localId}`,
    ),
  );
  return r?.external_id ?? null;
};

describe('round trip of the fixture org', () => {
  it('people both ways, campaigns and members per event, sponsor opportunities, then nothing twice', async () => {
    const ctx = a.ctx();
    const slug = a.org.slug;
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    const acc = account(authConnectionId);
    // A person both sides already know (Salesforce has them as a Contact, with other casing).
    const both = await person(ctx, `both@${slug}.example`, 'Both Sides', ['granted']);
    salesforceRemoteEdit(acc, 'Contact', null, {
      FirstName: 'Both',
      LastName: 'Sides',
      Email: `Both@${slug}.example`,
    });
    // Yayatoh-only people: one consents; the others may not be pushed.
    const yes = await person(ctx, `yes@${slug}.example`, 'Yes Person', ['granted']);
    const none = await person(ctx, `none@${slug}.example`, 'No Consent', []);
    const withdrew = await person(ctx, `withdrew@${slug}.example`, 'With Drew', ['granted', 'withdrawn']);
    const unsub = await person(ctx, `unsub@${slug}.example`, 'Un Sub', ['granted']);
    await withTenant(ctx, (tx) =>
      suppressEmailTx(tx, a.org.id, `unsub@${slug}.example`, 'marketing', 'page'),
    );
    await participate(ctx, yes, a.event.id, false);
    await participate(ctx, both, a.event.id, true);
    await participate(ctx, none, a.event.id, true);
    const before = await contactCount(ctx);

    const first = await sync(a.org.id, connectionId);
    expect(first).toMatchObject({ status: 'claimed', runStatus: 'partial', connectionStatus: 'active' });

    // Salesforce's people came in once each (by email); the one without an email waits in the inbox.
    const seeded = [
      'ada.lovelace@sf-remote.test',
      'grace.hopper@sf-remote.test',
      'katherine.johnson@sf-remote.test',
      'dorothy.vaughan@sf-remote.test',
    ];
    expect(await contactCount(ctx)).toBe(before + seeded.length);
    for (const email of seeded)
      expect(await withTenant(ctx, (tx) => contactIdByEmailTx(tx, email))).not.toBeNull();
    // The shared person is one contact here and stays one Contact there (linked, not sent as a Lead).
    expect(await linkOf(ctx, connectionId, 'contacts', both)).toMatch(/^003/);
    expect(await linkOf(ctx, connectionId, 'leads', both)).toBeNull();
    expect(
      remote(acc, 'Contact').filter((r) => String(r.Email).toLowerCase() === `both@${slug}.example`),
    ).toHaveLength(1);

    // Every pushable person is in Salesforce exactly once; nobody else is.
    const pushable = await pushableIds(ctx);
    expect(pushable).toContain(yes);
    for (const id of [none, withdrew, unsub]) expect(pushable).not.toContain(id);
    const people = [...remote(acc, 'Contact'), ...remote(acc, 'Lead')];
    for (const id of pushable) {
      const out = people.filter((r) => r.Yayatoh_Id__c === id);
      const linked =
        (await linkOf(ctx, connectionId, 'contacts', id)) ?? (await linkOf(ctx, connectionId, 'leads', id));
      expect(linked, id).not.toBeNull();
      expect(out.length).toBeLessThanOrEqual(1);
    }
    const yesLead = remote(acc, 'Lead').find((r) => r.Yayatoh_Id__c === yes);
    expect(yesLead).toMatchObject({
      FirstName: 'Yes',
      LastName: 'Person',
      Email: `yes@${slug}.example`,
      Company: '[not provided]',
    });
    for (const email of ['none', 'withdrew', 'unsub'].map((x) => `${x}@${slug}.example`))
      expect(people.filter((r) => String(r.Email).toLowerCase() === email)).toEqual([]);
    for (const id of [none, withdrew, unsub]) {
      expect(acc.log.some((l) => l.path.includes(id))).toBe(false);
    }

    // One campaign per event (drafts aside), with Yayatoh's member statuses.
    const campaigns = remote(acc, 'Campaign');
    const campaign = campaigns.find((c) => c.Yayatoh_Id__c === a.event.id);
    expect(campaign).toMatchObject({ Name: a.event.name.slice(0, 80), Type: 'Event' });
    expect(new Set(campaigns.map((c) => c.Yayatoh_Id__c)).size).toBe(campaigns.length);
    const statuses = remote(acc, 'CampaignMemberStatus').filter((s) => s.CampaignId === campaign?.Id);
    expect(statuses.map((s) => s.Label).sort()).toEqual(['Attended', 'Registered']);
    // Members: registered and checked-in people who may be pushed; never the one without consent.
    const members = remote(acc, 'CampaignMember').filter((m) => m.CampaignId === campaign?.Id);
    expect(members.find((m) => m.LeadId === yesLead?.Id)?.Status).toBe('Registered');
    const bothContact = await linkOf(ctx, connectionId, 'contacts', both);
    expect(members.find((m) => m.ContactId === bothContact)?.Status).toBe('Attended');
    const memberPeople = members.map((m) => m.ContactId ?? m.LeadId);
    expect(new Set(memberPeople).size).toBe(members.length);
    // Sponsor opportunities: the fixture sponsor's deal, in major units, on the event's campaign.
    const sponsors = await withTenant(ctx, (tx) => crmSponsorRowsTx(tx, { limit: 100 }));
    const sponsor = sponsors.find((s) => s.eventId === a.event.id);
    if (!sponsor) throw new Error('fixture sponsor');
    const opp = remote(acc, 'Opportunity').find((o) => o.Yayatoh_Id__c === sponsor.id);
    expect(opp).toMatchObject({
      Name: `${a.event.name}: ${sponsor.name} (${sponsor.tierName})`.slice(0, 120),
      StageName: sponsor.grant?.status === 'active' ? 'Closed Won' : expect.any(String),
      Description: sponsor.tierName,
      CampaignId: campaign?.Id,
    });
    if (sponsor.grant)
      expect(opp?.Amount).toBe(sponsor.grant.priceMinor / 10 ** currencyExponent(sponsor.grant.currency));

    // The second run finds nothing to do: no record written on either side, nothing duplicated.
    const counts = (
      ['Contact', 'Lead', 'Campaign', 'CampaignMember', 'CampaignMemberStatus', 'Opportunity'] as const
    ).map((t) => remote(acc, t).length);
    const contactsAfter = await contactCount(ctx);
    const writes = acc.log.filter((l) => l.method !== 'GET').length;
    await sync(a.org.id, connectionId);
    const second = await lastRun(ctx, connectionId);
    expect(second).toMatchObject({ pulled: 0, pushed: 0 });
    expect(acc.log.filter((l) => l.method !== 'GET').length).toBe(writes);
    expect(
      (['Contact', 'Lead', 'Campaign', 'CampaignMember', 'CampaignMemberStatus', 'Opportunity'] as const).map(
        (t) => remote(acc, t).length,
      ),
    ).toEqual(counts);
    expect(await contactCount(ctx)).toBe(contactsAfter);
    const linked = keep(await executeQuery(linkedCountsQuery, { connectionId }, ctx, ports));
    expect(Object.fromEntries(linked.objects.map((o) => [o.objectType, o.count]))).toMatchObject({
      campaigns: campaigns.length,
      campaign_members: remote(acc, 'CampaignMember').length,
      sponsor_opportunities: remote(acc, 'Opportunity').length,
    });

    // An edit in Salesforce comes in once and is not sent back; an edit here goes out once.
    salesforceRemoteEdit(acc, 'Contact', bothContact, { LastName: 'Sides-Again' });
    await withTenant(ctx, (tx) =>
      tx.execute(sql`update crm.contacts set name = 'Yes Again', updated_at = now() where id = ${yes}`),
    );
    await sync(a.org.id, connectionId);
    expect(await lastRun(ctx, connectionId)).toMatchObject({ pulled: 1, pushed: 1 });
    const [bothRow] = await withTenant(ctx, (tx) =>
      tx.execute<{ name: string }>(sql`select name from crm.contacts where id = ${both}`),
    );
    expect(bothRow?.name).toBe('Both Sides-Again');
    expect(remote(acc, 'Lead').filter((r) => r.Yayatoh_Id__c === yes)).toMatchObject([
      { FirstName: 'Yes', LastName: 'Again' },
    ]);
    await sync(a.org.id, connectionId);
    expect(await lastRun(ctx, connectionId)).toMatchObject({ pulled: 0, pushed: 0 });

    // Checking in later moves the member to Attended (an update, not a second member).
    await participate(ctx, yes, a.event.id, true);
    await sync(a.org.id, connectionId);
    const yesMembers = remote(acc, 'CampaignMember').filter((m) => m.LeadId === yesLead?.Id);
    expect(yesMembers).toMatchObject([{ Status: 'Attended' }]);
  });
});

describe('consent', () => {
  it('a person who withdraws or unsubscribes is never pushed again; consenting later sends them', async () => {
    const o = await fresh();
    const ctx = o.ctx();
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    const acc = account(authConnectionId);
    const p = await person(ctx, 'later@sf.test', 'Later Person', []);
    const q = await person(ctx, 'quits@sf.test', 'Quits Person', ['granted']);
    await sync(o.orgId, connectionId);
    expect(remote(acc, 'Lead').find((r) => r.Yayatoh_Id__c === p)).toBeUndefined();
    const lead = remote(acc, 'Lead').find((r) => r.Yayatoh_Id__c === q);
    expect(lead).toMatchObject({ LastName: 'Person' });
    // Quits: withdraws, then changes their name. Salesforce keeps the old record untouched.
    // (A fresh context: the withdrawal is newer than the consent it replaces.)
    await withTenant(o.ctx(), async (tx) => {
      await recordConsentTx(tx, o.ctx(), {
        contactId: q,
        channel: 'email',
        purpose: 'marketing',
        status: 'withdrawn',
        evidence: 'test',
      });
      await tx.execute(
        sql`update crm.contacts set name = 'Changed Name', updated_at = now() where id = ${q}`,
      );
    });
    const writes = acc.log.length;
    await sync(o.orgId, connectionId);
    expect(acc.log.slice(writes).filter((l) => l.method !== 'GET')).toEqual([]);
    expect(remote(acc, 'Lead').find((r) => r.Yayatoh_Id__c === q)).toMatchObject({ LastName: 'Person' });
    // Later grants consent: the next run sends them.
    await withTenant(o.ctx(), (tx) =>
      recordConsentTx(tx, o.ctx(), {
        contactId: p,
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
        evidence: 'test',
      }),
    );
    await sync(o.orgId, connectionId);
    expect(remote(acc, 'Lead').filter((r) => r.Yayatoh_Id__c === p)).toHaveLength(1);
    // An unsubscribe blocks them again, even with consent on record.
    await withTenant(ctx, async (tx) => {
      await suppressEmailTx(tx, o.orgId, 'later@sf.test', 'marketing', 'one_click');
      await tx.execute(
        sql`update crm.contacts set name = 'Later Changed', updated_at = now() where id = ${p}`,
      );
    });
    const before = acc.log.length;
    await sync(o.orgId, connectionId);
    expect(acc.log.slice(before).filter((l) => l.method !== 'GET')).toEqual([]);
  });

  it("a Salesforce email opt-out withdraws the person's consent here (never grants it)", async () => {
    const o = await fresh();
    const ctx = o.ctx();
    const dorothy = await person(ctx, 'dorothy.vaughan@sf-remote.test', 'Dorothy', ['granted']);
    const katherine = await person(ctx, 'katherine.johnson@sf-remote.test', 'Katherine', []);
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    const acc = account(authConnectionId);
    await sync(o.orgId, connectionId);
    await withTenant(ctx, async (tx) => {
      expect(await currentConsentTx(tx, dorothy, 'email', 'marketing')).toBe('withdrawn');
      expect(await currentConsentTx(tx, katherine, 'email', 'marketing')).toBeNull();
      const [ev] = await tx.execute<{ evidence: string }>(
        sql`select evidence from crm.consents where contact_id = ${dorothy} order by captured_at desc limit 1`,
      );
      expect(ev?.evidence).toBe('salesforce:email_opt_out');
    });
    // Linked to her Lead, never written to.
    const lead = await linkOf(ctx, connectionId, 'leads', dorothy);
    expect(lead).toMatch(/^00Q/);
    expect(acc.log.some((l) => l.method !== 'GET' && l.path.includes(String(lead)))).toBe(false);
    expect(acc.log.some((l) => l.path.includes(dorothy))).toBe(false);
  });
});

describe('field mapping, both ways', () => {
  it('a saved pull mapping and push mapping are what the next run applies', async () => {
    const o = await fresh();
    const ctx = o.ctx();
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    const acc = account(authConnectionId);
    // Into Yayatoh: a contact's name is their Salesforce title, in capitals.
    await executeCommand(
      saveMappingCommand,
      {
        connectionId,
        objectType: 'contacts',
        direction: 'pull',
        rules: [
          { source: 'email', target: 'email', transform: 'lowercase', default: null },
          { source: 'title', target: 'name', transform: 'uppercase', default: null },
        ],
      },
      ctx,
      ports,
    );
    // Out to Salesforce: the last name in capitals; every lead's company is the org's own label.
    await executeCommand(
      saveMappingCommand,
      {
        connectionId,
        objectType: 'leads',
        direction: 'push',
        rules: [
          { source: 'email', target: 'email', transform: 'none', default: null },
          { source: 'last_name', target: 'last_name', transform: 'uppercase', default: '[not provided]' },
          { source: 'company', target: 'company', transform: 'none', default: 'Yayatoh Guests' },
        ],
      },
      ctx,
      ports,
    );
    const guest = await person(ctx, 'mapped.guest@sf.test', 'Mapped Guest', ['granted']);
    await sync(o.orgId, connectionId);
    const [ada] = await withTenant(ctx, (tx) =>
      tx.execute<{ name: string }>(
        sql`select name from crm.contacts where email_norm = 'ada.lovelace@sf-remote.test'`,
      ),
    );
    expect(ada?.name).toBe('COUNTESS');
    // Unmapped fields stay out: no first name was sent.
    const lead = remote(acc, 'Lead').find((r) => r.Yayatoh_Id__c === guest);
    expect(lead).toMatchObject({
      LastName: 'GUEST',
      Company: 'Yayatoh Guests',
      Email: 'mapped.guest@sf.test',
    });
    expect(lead?.FirstName).toBeUndefined();
    // The default mapping of an untouched object still applies (leads come in with their names).
    const [kj] = await withTenant(ctx, (tx) =>
      tx.execute<{ name: string; company: string }>(
        sql`select name, company from crm.contacts where email_norm = 'katherine.johnson@sf-remote.test'`,
      ),
    );
    expect(kj).toEqual({ name: 'Katherine Johnson', company: 'NASA' });
  });
});

describe('revocation stops within one run', () => {
  it('revoked at Salesforce before a run: no request is made and the connection shows it', async () => {
    const o = await fresh();
    const { connectionId, authConnectionId } = await connectSalesforce(o.ctx());
    fakeIntegrations.revokeAtProvider(authConnectionId);
    const r = await sync(o.orgId, connectionId);
    expect(r).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    expect(account(authConnectionId).log).toEqual([]);
    expect((await runSync(o.orgId, connectionId, deps, ports, { force: true })).status).toBe('inactive');
  });

  it('revoked in the middle of a run: the refused request is the last one', async () => {
    const o = await fresh();
    const ctx = o.ctx();
    for (let i = 0; i < 5; i++) await person(ctx, `mid${i}@sf.test`, `Mid ${i}`, ['granted']);
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    const acc = account(authConnectionId);
    // The organizer revokes access in Salesforce right after our fourth request.
    let calls = 0;
    const revoking: IntegrationAuth = {
      ...fakeAuth,
      client(ref) {
        const inner = fakeAuth.client(ref);
        return {
          async request(req) {
            calls += 1;
            if (calls === 5) fakeIntegrations.revokeAtProvider(authConnectionId);
            return inner.request(req);
          },
        };
      },
    };
    const r = await sync(o.orgId, connectionId, revoking);
    expect(r).toMatchObject({ runStatus: 'failed', connectionStatus: 'revoked' });
    expect(acc.log).toHaveLength(5);
    const detail = await executeQuery(connectionDetailQuery, { connectionId }, ctx, ports);
    expect(detail.connection).toMatchObject({ status: 'revoked', revokeReason: 'provider' });
    const groups = await executeQuery(listErrorGroupsQuery, { status: 'open' }, ctx, ports);
    expect(groups.find((g) => g.connectionId === connectionId && g.step === 'auth')?.code).toBe(
      'auth_revoked',
    );
    await sync(o.orgId, connectionId);
    expect(acc.log).toHaveLength(5);
  });
});

describe('the errors inbox', () => {
  it('a record Salesforce holds without an email waits there; fixed at the source and retried, it resolves', async () => {
    const o = await fresh();
    const ctx = o.ctx();
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    const acc = account(authConnectionId);
    await sync(o.orgId, connectionId);
    const open = await executeQuery(listErrorGroupsQuery, { status: 'open' }, ctx, ports);
    const group = open.find((g) => g.connectionId === connectionId);
    expect(group).toMatchObject({
      connector: 'salesforce',
      step: 'map',
      code: 'missing_required',
      field: 'email',
    });
    expect(group?.errors.map((e) => [e.objectType, e.externalId])).toEqual([
      ['contacts', SALESFORCE_BAD_RECORD],
    ]);
    salesforceRemoteEdit(acc, 'Contact', SALESFORCE_BAD_RECORD, { Email: 'found.again@sf-remote.test' });
    await executeCommand(retryErrorsCommand, { errorIds: group?.errors.map((e) => e.id) ?? [] }, ctx, ports);
    await runSync(o.orgId, connectionId, deps, ports);
    expect(
      (await executeQuery(listErrorGroupsQuery, { status: 'open' }, ctx, ports)).filter(
        (g) => g.connectionId === connectionId,
      ),
    ).toEqual([]);
    expect(
      await withTenant(ctx, (tx) => contactIdByEmailTx(tx, 'found.again@sf-remote.test')),
    ).not.toBeNull();
  });

  it('a Salesforce outage fails the run into the inbox; the next good run clears it', async () => {
    const o = await fresh();
    const ctx = o.ctx();
    const { connectionId, authConnectionId } = await connectSalesforce(ctx);
    fakeIntegrations.failNext(authConnectionId, 503);
    expect(await sync(o.orgId, connectionId)).toMatchObject({
      runStatus: 'failed',
      connectionStatus: 'active',
    });
    const open = await executeQuery(listErrorGroupsQuery, { status: 'open' }, ctx, ports);
    expect(open.find((g) => g.connectionId === connectionId)).toMatchObject({
      step: 'pull',
      code: 'http_503',
    });
    await sync(o.orgId, connectionId);
    const after = await executeQuery(listErrorGroupsQuery, { status: 'open' }, ctx, ports);
    expect(after.filter((g) => g.connectionId === connectionId).map((g) => g.code)).toEqual([
      'missing_required',
    ]);
  });
});

describe('permissions and isolation', () => {
  it('viewers cannot connect or map; another org sees nothing of the connection', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expectError(
      executeCommand(beginConnectCommand, { connector: 'salesforce' }, viewer, ports),
      'forbidden',
    );
    const conn = (
      await withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute<{ id: string }>(
          sql`select id from integrations.connections where connector = 'salesforce' and status = 'active'`,
        ),
      )
    )[0];
    if (!conn) throw new Error('the round trip connection');
    await expectError(
      executeCommand(
        saveMappingCommand,
        { connectionId: conn.id, objectType: 'leads', direction: 'push', rules: [] },
        viewer,
        ports,
      ),
      'forbidden',
    );
    await expectError(
      executeQuery(connectionDetailQuery, { connectionId: conn.id }, b.ctx(), ports),
      'not_found',
    );
    expect(
      (await executeQuery(linkedCountsQuery, { connectionId: conn.id }, b.ctx(), ports)).objects,
    ).toEqual([]);
    await expectError(runSync(b.org.id, conn.id, deps, ports, { force: true }), 'not_found');
    await expectError(executeQuery(linkedCountsQuery, { connectionId: conn.id }, viewer, ports), 'forbidden');
  });
});

describe('tokens never leave the port (canary)', () => {
  it('no token in the database, audit rows, outbox events, outputs, errors or logs', async () => {
    const o = await fresh();
    await person(o.ctx(), 'canary@sf.test', 'Canary Bird', ['granted']);
    const { connectionId, authConnectionId } = await connectSalesforce(o.ctx());
    await sync(o.orgId, connectionId);
    fakeIntegrations.failNext(authConnectionId, 500);
    await sync(o.orgId, connectionId);
    fakeIntegrations.expireToken(authConnectionId);
    await sync(o.orgId, connectionId);
    fakeIntegrations.revokeAtProvider(authConnectionId);
    await sync(o.orgId, connectionId);
    keep(await executeQuery(listErrorGroupsQuery, { status: 'open' }, o.ctx(), ports));
    const dump = await admin.unsafe(
      `select 'integrations' as src, to_jsonb(t)::text as row from integrations.connections t where org_id = $1
       union all select 'runs', to_jsonb(t)::text from integrations.sync_runs t where org_id = $1
       union all select 'links', to_jsonb(t)::text from integrations.record_links t where org_id = $1
       union all select 'errors', to_jsonb(t)::text from integrations.sync_errors t where org_id = $1
       union all select 'audit', to_jsonb(t)::text from platform.audit_events t where org_id = $1
       union all select 'events', to_jsonb(t)::text from platform.domain_events t where org_id = $1`,
      [o.orgId],
    );
    expect(
      dump.filter((d) => d.src === 'events').some((d) => String(d.row).includes(SYNC_COMPLETED_EVENT)),
    ).toBe(true);
    const everything = [
      ...dump.map((d) => String(d.row)),
      ...outputs.map((x) => JSON.stringify(x)),
      ...logged,
    ].join('\n');
    for (const token of [FAKE_ACCESS_TOKEN, FAKE_REFRESH_TOKEN]) expect(everything).not.toContain(token);
    expect(findCanaries(everything).filter((h) => h.column.startsWith('integrations.oauth'))).toEqual([]);
    expect(account(authConnectionId).accessToken).toBe(FAKE_ACCESS_TOKEN);
  });
});
