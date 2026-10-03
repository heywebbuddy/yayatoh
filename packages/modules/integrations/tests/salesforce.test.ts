import { describe, expect, it } from 'vitest';
import type { FakeAccount } from '../src/auth/fake.ts';
import type { ProviderClient, ProviderRequest } from '../src/auth/port.ts';
import { ProviderError } from '../src/auth/port.ts';
import {
  SALESFORCE_BAD_RECORD,
  SALESFORCE_SEED,
  SF_HUMAN_USER,
  SF_INTEGRATION_USER,
  salesforceFakeProvider,
  salesforceRemoteEdit,
  salesforceRemoteRecords,
} from '../src/connectors/salesforce/fake.ts';
import { salesforceConnector } from '../src/connectors/salesforce/index.ts';
import {
  CONTACT_FIELDS,
  campaignStatus,
  dateIn,
  fromApi,
  joinName,
  NO_LAST_NAME,
  OPPORTUNITY_FIELDS,
  opportunityStage,
  SF_API,
  splitName,
  toApi,
} from '../src/connectors/salesforce/objects.ts';
import { validateMapping } from '../src/domain/mapping.ts';
import { decidePull, originStamp } from '../src/domain/sync.ts';
import { CONNECTORS, connectorByKey, offeredConnectors } from '../src/index.ts';
import type { SyncIO } from '../src/sdk/connector.ts';

/** M6.5b: the Salesforce connector's pure parts, its fake org and its provider calls. */

const account = (): FakeAccount => ({
  authConnectionId: 'fake_sf',
  orgId: '01999999-0000-7000-8000-000000000001',
  connectionId: '01999999-0000-7000-8000-000000000002',
  providerConfigKey: 'salesforce',
  revoked: false,
  accessToken: 'x',
  refreshToken: 'y',
  tokenExpiresAt: Date.now() + 60_000,
  refreshes: 0,
  data: salesforceFakeProvider.seed(),
  failNext: [],
  log: [],
});

/** A client straight onto the fake org (the port's job: non-2xx becomes a ProviderError). */
const clientFor = (a: FakeAccount): ProviderClient & { calls: ProviderRequest[] } => {
  const calls: ProviderRequest[] = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      const res = salesforceFakeProvider.handle(a, req, a.accessToken);
      if (res.status < 200 || res.status > 299) throw new ProviderError(res.status);
      return res;
    },
  };
};

const call = (a: FakeAccount, req: ProviderRequest) => salesforceFakeProvider.handle(a, req, a.accessToken);
const upsert = (a: FakeAccount, type: string, value: string, body: Record<string, unknown>) =>
  call(a, { method: 'PATCH', path: `${SF_API}/sobjects/${type}/Yayatoh_Id__c/${value}`, body });
const errorCode = (res: { body: unknown }) => (res.body as { errorCode: string }[])[0]?.errorCode;

describe('names, dates and vocabularies', () => {
  it('splits and joins names the way Salesforce needs them', () => {
    expect(splitName('Ada Lovelace')).toEqual({ first: 'Ada', last: 'Lovelace' });
    expect(splitName('  Ada  King  Lovelace ')).toEqual({ first: 'Ada', last: 'King Lovelace' });
    expect(splitName('Cher')).toEqual({ first: null, last: 'Cher' });
    expect(splitName(null)).toEqual({ first: null, last: null });
    expect(joinName('Ada', 'Lovelace')).toBe('Ada Lovelace');
    expect(joinName(null, 'Cher')).toBe('Cher');
    // The placeholder a push writes never comes back as part of a name.
    expect(joinName('Ada', NO_LAST_NAME)).toBe('Ada');
    expect(joinName('', '  ')).toBeNull();
  });

  it("renders dates in the event's time zone", () => {
    const at = new Date('2026-10-04T02:30:00Z');
    expect(dateIn(at, 'UTC')).toBe('2026-10-04');
    expect(dateIn(at, 'America/Los_Angeles')).toBe('2026-10-03');
    expect(dateIn(at, 'Asia/Tokyo')).toBe('2026-10-04');
  });

  it('maps event and deal states to Salesforce picklists', () => {
    const now = new Date('2026-10-03T00:00:00Z');
    const later = new Date('2026-12-01T00:00:00Z');
    expect(campaignStatus('published', later, now)).toBe('In Progress');
    expect(campaignStatus('postponed', later, now)).toBe('Planned');
    expect(campaignStatus('cancelled', later, now)).toBe('Aborted');
    expect(campaignStatus('completed', later, now)).toBe('Completed');
    expect(campaignStatus('published', new Date('2026-09-01T00:00:00Z'), now)).toBe('Completed');
    expect(opportunityStage('active')).toBe('Closed Won');
    expect(opportunityStage('cancelled')).toBe('Closed Lost');
    expect(opportunityStage('pending')).toBe('Negotiation/Review');
    expect(opportunityStage(null)).toBe('Prospecting');
  });

  it('translates our keys to API names and back (dates as YYYY-MM-DD)', () => {
    expect(toApi(CONTACT_FIELDS, { email: 'a@b.test', last_name: 'L', unknown: 1 })).toEqual({
      Email: 'a@b.test',
      LastName: 'L',
    });
    expect(toApi(OPPORTUNITY_FIELDS, { close_date: '2026-10-03T00:00:00.000Z', amount: 12.5 })).toEqual({
      CloseDate: '2026-10-03',
      Amount: 12.5,
    });
    expect(
      fromApi(CONTACT_FIELDS, { Id: '003', Email: 'a@b.test', FirstName: null, HasOptedOutOfEmail: true }),
    ).toEqual({ email: 'a@b.test', first_name: null, has_opted_out_of_email: true });
  });
});

describe('the connector definition', () => {
  it('is listed, offered everywhere the port works, and needs the integrations key', () => {
    expect(CONNECTORS).toContain(salesforceConnector);
    expect(connectorByKey('salesforce')).toBe(salesforceConnector);
    expect(offeredConnectors('nango').map((c) => c.key)).toContain('salesforce');
    expect(offeredConnectors('fake').map((c) => c.key)).toContain('salesforce');
    expect(offeredConnectors(null)).toEqual([]);
    expect(salesforceConnector.entitlement).toBe('integrations');
  });

  it('syncs people both ways, then campaigns, members and opportunities out, in that order', () => {
    expect(salesforceConnector.objects.map((o) => [o.key, !!o.pull, !!o.push])).toEqual([
      ['contacts', true, true],
      ['leads', true, true],
      ['campaigns', false, true],
      ['campaign_members', false, true],
      ['sponsor_opportunities', false, true],
    ]);
  });

  it('offers valid default mappings, with Salesforce field names as labels', () => {
    for (const o of salesforceConnector.objects) {
      if (o.pull) expect(validateMapping(o.pull.defaultMapping, o.remoteFields, o.localFields)).toEqual([]);
      if (o.push) expect(validateMapping(o.push.defaultMapping, o.localFields, o.remoteFields)).toEqual([]);
    }
    const leads = salesforceConnector.objects.find((o) => o.key === 'leads');
    expect(leads?.remoteFields.find((f) => f.key === 'company')).toEqual({
      key: 'company',
      label: 'Company',
      type: 'string',
      required: true,
    });
    // A push without a last name or company still satisfies Salesforce (its own placeholder).
    expect(leads?.push?.defaultMapping.find((r) => r.target === 'company')?.default).toBe(NO_LAST_NAME);
  });
});

describe('the fake Salesforce org', () => {
  it('seeds contacts and leads, one contact without an email', () => {
    const a = account();
    expect(salesforceRemoteRecords(a, 'Contact')).toHaveLength(
      SALESFORCE_SEED.filter((s) => s.type === 'Contact').length,
    );
    expect(salesforceRemoteRecords(a, 'Lead')).toHaveLength(2);
    const bad = salesforceRemoteRecords(a, 'Contact').find((r) => r.Id === SALESFORCE_BAD_RECORD);
    expect(bad?.Email).toBeUndefined();
    expect(bad?.LastModifiedById).toBe(SF_HUMAN_USER);
  });

  it('upserts by the external id: created once, then updated in place', () => {
    const a = account();
    const first = upsert(a, 'Lead', 'yy-1', { LastName: 'Hopper', Company: 'Navy', Email: 'g@navy.test' });
    expect(first.status).toBe(201);
    const again = upsert(a, 'Lead', 'yy-1', { Title: 'Admiral' });
    expect(again.status).toBe(200);
    expect((again.body as { id: string }).id).toBe((first.body as { id: string }).id);
    const leads = salesforceRemoteRecords(a, 'Lead').filter((r) => r.Yayatoh_Id__c === 'yy-1');
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      Title: 'Admiral',
      LastName: 'Hopper',
      LastModifiedById: SF_INTEGRATION_USER,
    });
  });

  it('refuses what Salesforce refuses, with its error codes', () => {
    const a = account();
    expect(errorCode(upsert(a, 'Lead', 'yy-2', { LastName: 'X' }))).toBe('REQUIRED_FIELD_MISSING');
    expect(errorCode(upsert(a, 'Contact', 'yy-3', { LastName: 'X', Email: 'nope' }))).toBe(
      'INVALID_EMAIL_ADDRESS',
    );
    expect(errorCode(upsert(a, 'Contact', 'yy-4', { LastName: 'X', Secret__c: 1 }))).toBe('INVALID_FIELD');
    expect(call(a, { method: 'GET', path: `${SF_API}/sobjects/Contact/003FAKE99999999999` }).status).toBe(
      404,
    );
    expect(
      errorCode(call(a, { method: 'GET', path: `${SF_API}/query`, query: { q: 'SELECT Id FROM User' } })),
    ).toBe('MALFORMED_QUERY');
  });

  it('keeps a person once per campaign, only with the campaign’s statuses, and pins its references', () => {
    const a = account();
    const campaign = (upsert(a, 'Campaign', 'ev-1', { Name: 'Gala' }).body as { id: string }).id;
    const contact = salesforceRemoteRecords(a, 'Contact')[0]?.Id as string;
    expect(
      errorCode(
        upsert(a, 'CampaignMember', 'm-1', { CampaignId: campaign, ContactId: contact, Status: 'Attended' }),
      ),
    ).toBe('INVALID_STATUS');
    call(a, {
      method: 'POST',
      path: `${SF_API}/sobjects/CampaignMemberStatus`,
      body: { CampaignId: campaign, Label: 'Attended', HasResponded: true },
    });
    expect(
      upsert(a, 'CampaignMember', 'm-1', { CampaignId: campaign, ContactId: contact, Status: 'Attended' })
        .status,
    ).toBe(201);
    expect(errorCode(upsert(a, 'CampaignMember', 'm-2', { CampaignId: campaign, ContactId: contact }))).toBe(
      'DUPLICATE_VALUE',
    );
    const other = salesforceRemoteRecords(a, 'Contact')[1]?.Id as string;
    expect(errorCode(upsert(a, 'CampaignMember', 'm-1', { ContactId: other }))).toBe(
      'INVALID_FIELD_FOR_INSERT_UPDATE',
    );
    expect(
      errorCode(upsert(a, 'CampaignMember', 'm-3', { CampaignId: '701FAKE00000000999', ContactId: other })),
    ).toBe('INVALID_CROSS_REFERENCE_KEY');
  });

  it('pages a keyset query by SystemModstamp and Id', () => {
    const a = account();
    for (let i = 0; i < 5; i++)
      salesforceRemoteEdit(a, 'Contact', null, { LastName: `P${i}`, Email: `p${i}@x.test` });
    const q = (where: string) =>
      call(a, {
        method: 'GET',
        path: `${SF_API}/query`,
        query: {
          q: `SELECT Id, Email, SystemModstamp FROM Contact${where} ORDER BY SystemModstamp, Id LIMIT 3`,
        },
      }).body as { records: { Id: string; SystemModstamp: string }[] };
    const first = q('').records;
    expect(first).toHaveLength(3);
    const last = first[2] as { Id: string; SystemModstamp: string };
    const next = q(
      ` WHERE SystemModstamp > ${last.SystemModstamp} OR (SystemModstamp = ${last.SystemModstamp} AND Id > '${last.Id}')`,
    ).records;
    expect(next.map((r) => r.Id)).not.toContain(last.Id);
    expect(first.length + next.length).toBeLessThanOrEqual(8);
    expect(new Set([...first, ...next].map((r) => r.Id)).size).toBe(first.length + next.length);
  });
});

describe('the connector against the fake org', () => {
  const contacts = salesforceConnector.objects.find((o) => o.key === 'contacts');
  const io = (a: FakeAccount) => {
    const client = clientFor(a);
    const sio: SyncIO = { client, origin: originStamp(a.connectionId), now: new Date(), scope: {} };
    return { client, sio };
  };

  it('lists contacts in pages with a keyset cursor; its own writes carry our origin stamp', async () => {
    const a = account();
    const { client, sio } = io(a);
    const page = await contacts?.pull?.list(sio, null);
    expect(page?.records.map((r) => r.fields.email)).toEqual([
      'ada.lovelace@sf-remote.test',
      'Grace.Hopper@sf-remote.test',
      null,
    ]);
    expect(page?.records.every((r) => r.origin === null)).toBe(true);
    expect(page?.cursor).toMatch(/\|003FAKE/);
    expect(page?.hasMore).toBe(false);
    // Our integration user writes one; the next page shows only it, stamped as ours.
    upsert(a, 'Contact', 'yy-own', { LastName: 'Ours', Email: 'ours@x.test' });
    const next = await contacts?.pull?.list(sio, page?.cursor ?? null);
    expect(next?.records).toHaveLength(1);
    expect(next?.records[0]?.origin).toBe(sio.origin);
    expect(decidePull(next?.records[0] as never, null, sio.origin, null)).toEqual({
      action: 'skip',
      reason: 'own_write',
    });
    // A person editing it afterwards makes it theirs again.
    salesforceRemoteEdit(a, 'Contact', next?.records[0]?.id as string, { Title: 'Edited' });
    const edited = await contacts?.pull?.list(sio, next?.cursor ?? null);
    expect(edited?.records[0]?.origin).toBeNull();
    // The integration user is asked once per run.
    expect(client.calls.filter((c) => c.path === '/services/oauth2/userinfo')).toHaveLength(1);
  });

  it('gets one contact by id; a missing one is null; a malformed cursor starts over', async () => {
    const a = account();
    const { sio } = io(a);
    const got = await contacts?.pull?.get(sio, SALESFORCE_BAD_RECORD);
    expect(got?.fields).toMatchObject({ first_name: 'Nameless', last_name: 'Record' });
    expect(await contacts?.pull?.get(sio, '003FAKE99999999999')).toBeNull();
    expect(await contacts?.pull?.get(sio, "x' OR Id != '")).toBeNull();
    const page = await contacts?.pull?.list(sio, "2026-01-01T00:00:00Z|x' OR Name != '");
    expect(page?.records).toHaveLength(3);
  });

  it('sends an update by Salesforce id and a new record by our external id', async () => {
    const a = account();
    const { client, sio } = io(a);
    const local = { id: '01999999-0000-7000-8000-0000000000aa', updatedAt: new Date(), fields: {} };
    const created = await contacts?.push?.send(sio, {
      externalId: null,
      values: { email: 'new@x.test', last_name: 'New' },
      idempotencyKey: 'yy-key-1',
      local,
    });
    expect(created?.externalId).toMatch(/^003FAKE/);
    expect(client.calls.at(-1)?.path).toBe(`${SF_API}/sobjects/Contact/Yayatoh_Id__c/${local.id}`);
    const updated = await contacts?.push?.send(sio, {
      externalId: created?.externalId ?? null,
      values: { email: 'new@x.test', last_name: 'Newer' },
      idempotencyKey: 'yy-key-2',
      local,
    });
    expect(updated?.externalId).toBe(created?.externalId);
    expect(client.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: `${SF_API}/sobjects/Contact/${created?.externalId}`,
    });
    expect(salesforceRemoteRecords(a, 'Contact').filter((r) => r.Email === 'new@x.test')).toHaveLength(1);
    // A refusal surfaces as a provider error with a status, never Salesforce's body.
    const err = await contacts?.push
      ?.send(sio, {
        externalId: null,
        values: { email: 'bad' },
        idempotencyKey: 'k3',
        local: { ...local, id: 'zz' },
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).status).toBe(400);
    expect((err as ProviderError).message).not.toContain('INVALID_EMAIL_ADDRESS');
  });
});
