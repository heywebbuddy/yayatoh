import {
  consentedContactsChangedTx,
  crmParticipationRowsTx,
  withdrawEmailMarketingTx,
  writeCrmPersonTx,
} from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { crmEventRowsTx } from '@yayatoh/events';
import { currencyExponent } from '@yayatoh/kernel';
import { marketingSuppressionsTx } from '@yayatoh/notifications';
import { crmSponsorRowsTx } from '@yayatoh/program';
import { isProviderError } from '../../auth/port.ts';
import type { FieldSpec } from '../../domain/mapping.ts';
import {
  defineConnector,
  type LocalRecord,
  type ObjectDefinition,
  type Page,
  type PullSide,
  type PushSide,
  type RemoteRecord,
  type SyncIO,
} from '../../sdk/connector.ts';
import { salesforceFakeProvider } from './fake.ts';
import { linksTx, liveConnectionIdTx, passPage, pushableContactsTx } from './local.ts';
import {
  CAMPAIGN_FIELDS,
  CONTACT_FIELDS,
  campaignStatus,
  dateIn,
  fieldSpecs,
  fromApi,
  joinName,
  LEAD_FIELDS,
  MEMBER_FIELDS,
  MEMBER_STATUSES,
  NO_LAST_NAME,
  OPPORTUNITY_FIELDS,
  OPT_OUT,
  opportunityStage,
  SALESFORCE,
  SF_API,
  SF_EXTERNAL_ID,
  type SfField,
  type SObject,
  splitName,
  toApi,
} from './objects.ts';

/**
 * The Salesforce connector (M6.5b) on the M6.4a framework, through the `IntegrationAuth` port
 * (Nango's `salesforce` integration in production, the fake org in dev and CI):
 * - **contacts** ↔ Contact and **leads** ↔ Lead: Salesforce's people come into CRM contacts (by
 *   email); Yayatoh's people go out once they consent. A person Salesforce knows as a Contact is
 *   updated there; everyone else goes out as a Lead, so nobody is created twice.
 * - **campaigns** → Campaign, one per event (not drafts), with the member statuses Registered and
 *   Attended; **campaign_members** → CampaignMember for each person on an event's list (Registered)
 *   or checked in (Attended).
 * - **sponsor_opportunities** → Opportunity per program sponsor (its deal's stage and amount), on
 *   the event's campaign.
 * **Idempotency:** Yayatoh's records are upserted by the external id `Yayatoh_Id__c`, so a retried or
 * repeated send never makes a second record. **Loop guard:** Salesforce stamps every write with
 * `LastModifiedById`; a record last written by the connection's own integration user carries
 * our origin stamp, so the pull skips it (a person's later edit changes the stamp).
 * **Consent:** see `local.ts`. A Salesforce email opt-out withdraws consent here (never grants).
 */

const ID = /^[A-Za-z0-9]{15,18}$/;
const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)\|([A-Za-z0-9]{15,18})$/;
const PAGE = 200;

/** The connection's Salesforce user (its writes are ours), once per run. */
const users = new WeakMap<object, Promise<string | null>>();
function integrationUser(io: SyncIO): Promise<string | null> {
  let p = users.get(io.client);
  if (!p) {
    p = io.client.request({ method: 'GET', path: '/services/oauth2/userinfo' }).then((r) => {
      const id = (r.body as { user_id?: unknown } | null)?.user_id;
      return typeof id === 'string' && ID.test(id) ? id : null;
    });
    users.set(io.client, p);
    // A failed lookup is not cached: the run stops on it, the next run asks again.
    p.catch(() => users.delete(io.client));
  }
  return p;
}

function asRecord(
  raw: unknown,
  fields: readonly SfField[],
  ownUser: string | null,
  origin: string,
): RemoteRecord | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.Id !== 'string' || typeof r.SystemModstamp !== 'string') return null;
  const at = new Date(r.SystemModstamp);
  return {
    id: r.Id,
    version: r.SystemModstamp,
    updatedAt: Number.isNaN(at.getTime()) ? null : at,
    origin: ownUser !== null && r.LastModifiedById === ownUser ? origin : null,
    fields: fromApi(fields, r),
  };
}

/** People (Contact or Lead) as CRM contacts: email, name, its parts and company. */
const PERSON_LOCAL: FieldSpec[] = [
  { key: 'email', label: 'email', type: 'email', required: true },
  { key: 'name', label: 'name', type: 'string' },
  { key: 'first_name', label: 'first_name', type: 'string' },
  { key: 'last_name', label: 'last_name', type: 'string' },
  { key: 'company', label: 'company', type: 'string' },
];

const personRecord = (r: {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  updatedAt: Date;
}): LocalRecord => {
  const { first, last } = splitName(r.name);
  return {
    id: r.id,
    updatedAt: r.updatedAt,
    fields: { email: r.email, name: r.name, first_name: first, last_name: last, company: r.company },
  };
};

function personPull(type: 'Contact' | 'Lead', fields: readonly SfField[]): PullSide {
  const select = ['Id', ...fields.map((x) => x.api), OPT_OUT.api, 'SystemModstamp', 'LastModifiedById'];
  return {
    defaultMapping: [
      { source: 'email', target: 'email', transform: 'lowercase', default: null },
      { source: 'first_name', target: 'first_name', transform: 'trim', default: null },
      { source: 'last_name', target: 'last_name', transform: 'trim', default: null },
      ...(type === 'Lead'
        ? [{ source: 'company', target: 'company', transform: 'trim' as const, default: null }]
        : []),
    ],
    async list(io, cursor) {
      const m = cursor ? STAMP.exec(cursor) : null;
      const where = m
        ? ` WHERE SystemModstamp > ${m[1]} OR (SystemModstamp = ${m[1]} AND Id > '${m[2]}')`
        : '';
      const own = await integrationUser(io);
      const res = await io.client.request({
        method: 'GET',
        path: `${SF_API}/query`,
        query: {
          q: `SELECT ${select.join(', ')} FROM ${type}${where} ORDER BY SystemModstamp, Id LIMIT ${PAGE}`,
        },
      });
      const rows = ((res.body as { records?: unknown[] } | null)?.records ?? []) as Record<string, unknown>[];
      const last = rows[rows.length - 1];
      return {
        records: rows
          .map((r) => asRecord(r, fields, own, io.origin))
          .filter((r): r is RemoteRecord => r !== null),
        cursor: last ? `${String(last.SystemModstamp)}|${String(last.Id)}` : null,
        hasMore: rows.length === PAGE,
      };
    },
    async get(io, externalId) {
      if (!ID.test(externalId)) return null;
      try {
        const own = await integrationUser(io);
        const res = await io.client.request({
          method: 'GET',
          path: `${SF_API}/sobjects/${type}/${externalId}`,
        });
        return asRecord(res.body, fields, own, io.origin);
      } catch (err) {
        if (isProviderError(err) && err.status === 404) return null;
        throw err;
      }
    },
    async write(tx, ctx, values, localId, meta) {
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
      const id = await writeCrmPersonTx(tx, ctx, {
        contactId: localId,
        email: String(values.email),
        name: str(values.name) ?? joinName(values.first_name, values.last_name),
        company: str(values.company),
      });
      if (meta.record.fields[OPT_OUT.key] === true)
        await withdrawEmailMarketingTx(tx, ctx, id, 'salesforce:email_opt_out');
      return { localId: id };
    },
  };
}

/** Write one record: update by its Salesforce id, else upsert by our external id. */
async function sendRecord(
  io: SyncIO,
  type: SObject,
  input: {
    externalId: string | null;
    localId: string;
    body: Record<string, unknown>;
    idempotencyKey: string;
  },
): Promise<{ externalId: string; version: string; created: boolean }> {
  const version = `pushed:${input.idempotencyKey}`;
  if (input.externalId && ID.test(input.externalId)) {
    await io.client.request({
      method: 'PATCH',
      path: `${SF_API}/sobjects/${type}/${input.externalId}`,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
    });
    return { externalId: input.externalId, version, created: false };
  }
  const res = await io.client.request({
    method: 'PATCH',
    path: `${SF_API}/sobjects/${type}/${SF_EXTERNAL_ID}/${input.localId}`,
    body: input.body,
    idempotencyKey: input.idempotencyKey,
  });
  const out = res.body as { id?: unknown; created?: unknown } | null;
  if (typeof out?.id !== 'string' || !ID.test(out.id)) throw new Error('Salesforce answered without an id');
  return { externalId: out.id, version, created: out.created === true };
}

/**
 * People going out. `contacts` updates the people Salesforce already knows as Contacts; `leads`
 * sends everyone else as Leads. Both only send people who may be pushed (consent).
 */
function personPush(
  objectType: 'contacts' | 'leads',
  type: 'Contact' | 'Lead',
  fields: readonly SfField[],
): PushSide {
  return {
    defaultMapping: [
      { source: 'email', target: 'email', transform: 'none', default: null },
      { source: 'first_name', target: 'first_name', transform: 'none', default: null },
      { source: 'last_name', target: 'last_name', transform: 'none', default: NO_LAST_NAME },
      ...(type === 'Lead'
        ? [{ source: 'company', target: 'company', transform: 'none' as const, default: NO_LAST_NAME }]
        : []),
    ],
    async changes(tx, cursor, limit, meta): Promise<Page<LocalRecord>> {
      const records: LocalRecord[] = [];
      let at = cursor;
      for (;;) {
        const rows = await consentedContactsChangedTx(tx, at, 500);
        if (rows.length === 0) return { records, cursor: at, hasMore: false };
        const blocked = await marketingSuppressionsTx(
          tx,
          'email',
          rows.map((r) => r.email),
        );
        const asContact = await linksTx(
          tx,
          meta.connectionId,
          'contacts',
          rows.map((r) => r.id),
        );
        for (const r of rows) {
          at = r.cursor;
          if (blocked.has(r.email.trim().toLowerCase())) continue;
          if (asContact.has(r.id) !== (objectType === 'contacts')) continue;
          records.push(personRecord({ ...r, updatedAt: r.changedAt }));
          if (records.length >= limit) return { records, cursor: at, hasMore: true };
        }
        if (rows.length < 500) return { records, cursor: at, hasMore: false };
      }
    },
    async read(tx, localId) {
      const r = (await pushableContactsTx(tx, [localId])).get(localId);
      return r ? personRecord(r) : null;
    },
    async send(io, input) {
      const local = input.local;
      const sent = await sendRecord(io, type, {
        externalId: input.externalId,
        localId: local.id,
        body: toApi(fields, input.values),
        idempotencyKey: input.idempotencyKey,
      });
      return { externalId: sent.externalId, version: sent.version };
    },
  };
}

const CAMPAIGN_LOCAL: FieldSpec[] = [
  { key: 'name', label: 'name', type: 'string', required: true },
  { key: 'start_date', label: 'start_date', type: 'date' },
  { key: 'end_date', label: 'end_date', type: 'date' },
  { key: 'stage', label: 'stage', type: 'string' },
];

const campaignsObject: ObjectDefinition = {
  key: 'campaigns',
  remoteFields: fieldSpecs(CAMPAIGN_FIELDS),
  localFields: CAMPAIGN_LOCAL,
  push: {
    defaultMapping: [
      { source: 'name', target: 'name', transform: 'none', default: null },
      { source: 'start_date', target: 'start_date', transform: 'none', default: null },
      { source: 'end_date', target: 'end_date', transform: 'none', default: null },
      { source: 'stage', target: 'status', transform: 'none', default: null },
    ],
    async changes(tx, cursor, limit, meta) {
      const now = new Date();
      return passPage(tx, cursor, limit, {
        connectionId: meta.connectionId,
        objectType: 'campaigns',
        fetch: (afterId, n) => crmEventRowsTx(tx, { afterId, limit: n }),
        build: async (rows) => rows.map((e) => campaignRecord(e, now)),
      });
    },
    async read(tx, localId) {
      const [e] = await crmEventRowsTx(tx, { ids: [localId], limit: 1 });
      return e ? campaignRecord(e, new Date()) : null;
    },
    async send(io, input) {
      const sent = await sendRecord(io, 'Campaign', {
        externalId: input.externalId,
        localId: input.local.id,
        body: { ...toApi(CAMPAIGN_FIELDS, input.values), Type: 'Event', IsActive: true },
        idempotencyKey: input.idempotencyKey,
      });
      await ensureMemberStatuses(io, sent.externalId);
      return { externalId: sent.externalId, version: sent.version };
    },
  },
};

function campaignRecord(
  e: { id: string; name: string; status: string; timezone: string; startsAt: Date; endsAt: Date },
  now: Date,
): LocalRecord {
  return {
    id: e.id,
    updatedAt: now,
    fields: {
      name: e.name.slice(0, 80),
      start_date: dateIn(e.startsAt, e.timezone),
      end_date: dateIn(e.endsAt, e.timezone),
      stage: campaignStatus(e.status, e.endsAt, now),
    },
  };
}

/** The campaign's Registered and Attended member statuses, created when missing (idempotent). */
async function ensureMemberStatuses(io: SyncIO, campaignId: string) {
  const res = await io.client.request({
    method: 'GET',
    path: `${SF_API}/query`,
    query: { q: `SELECT Id, Label FROM CampaignMemberStatus WHERE CampaignId = '${campaignId}'` },
  });
  const have = new Set(
    (((res.body as { records?: { Label?: unknown }[] } | null)?.records ?? []) as { Label?: unknown }[]).map(
      (r) => r.Label,
    ),
  );
  for (const [i, s] of MEMBER_STATUSES.entries())
    if (!have.has(s.label))
      await io.client.request({
        method: 'POST',
        path: `${SF_API}/sobjects/CampaignMemberStatus`,
        body: { CampaignId: campaignId, Label: s.label, HasResponded: s.responded, SortOrder: 10 + i },
      });
}

/** Salesforce ids a member or an opportunity points at (from this connection's links). */
async function refsFor(
  tx: TenantTx,
  connectionId: string,
  people: readonly string[],
  events: readonly string[],
) {
  const [contacts, leads, campaigns] = await Promise.all([
    linksTx(tx, connectionId, 'contacts', people),
    linksTx(tx, connectionId, 'leads', people),
    linksTx(tx, connectionId, 'campaigns', events),
  ]);
  return {
    person: (id: string) => {
      const c = contacts.get(id);
      if (c) return { contact_ref: c.externalId };
      const l = leads.get(id);
      return l ? { lead_ref: l.externalId } : null;
    },
    campaign: (id: string) => campaigns.get(id)?.externalId ?? null,
  };
}

type Participation = Awaited<ReturnType<typeof crmParticipationRowsTx>>[number];

async function memberRecords(tx: TenantTx, connectionId: string, rows: readonly Participation[]) {
  const pushable = await pushableContactsTx(
    tx,
    rows.map((r) => r.contactId),
  );
  const refs = await refsFor(
    tx,
    connectionId,
    rows.map((r) => r.contactId),
    rows.map((r) => r.eventId),
  );
  return rows.map((r): LocalRecord | null => {
    const person = pushable.has(r.contactId) ? refs.person(r.contactId) : null;
    const campaign = refs.campaign(r.eventId);
    if (!person || !campaign) return null;
    return {
      id: r.id,
      updatedAt: new Date(),
      fields: { status: r.checkedIn ? 'Attended' : 'Registered', campaign_ref: campaign, ...person },
    };
  });
}

const membersObject: ObjectDefinition = {
  key: 'campaign_members',
  remoteFields: fieldSpecs(MEMBER_FIELDS),
  localFields: [{ key: 'status', label: 'status', type: 'string', required: true }],
  push: {
    defaultMapping: [{ source: 'status', target: 'status', transform: 'none', default: null }],
    async changes(tx, cursor, limit, meta) {
      return passPage(tx, cursor, limit, {
        connectionId: meta.connectionId,
        objectType: 'campaign_members',
        fetch: (afterId, n) => crmParticipationRowsTx(tx, { afterId, limit: n }),
        build: (rows) => memberRecords(tx, meta.connectionId, rows),
      });
    },
    async read(tx, localId) {
      const connectionId = await liveConnectionIdTx(tx);
      if (!connectionId) return null;
      const rows = await crmParticipationRowsTx(tx, { ids: [localId], limit: 1 });
      return (await memberRecords(tx, connectionId, rows))[0] ?? null;
    },
    async send(io, input) {
      const f = input.local.fields;
      const status = toApi(MEMBER_FIELDS, input.values);
      // A member's campaign and person can't change in Salesforce: an update sends its status only.
      const body = input.externalId
        ? status
        : {
            ...status,
            CampaignId: f.campaign_ref,
            ...(typeof f.contact_ref === 'string' ? { ContactId: f.contact_ref } : { LeadId: f.lead_ref }),
          };
      const sent = await sendRecord(io, 'CampaignMember', {
        externalId: input.externalId,
        localId: input.local.id,
        body,
        idempotencyKey: input.idempotencyKey,
      });
      return { externalId: sent.externalId, version: sent.version };
    },
  },
};

const OPPORTUNITY_LOCAL: FieldSpec[] = [
  { key: 'name', label: 'name', type: 'string', required: true },
  { key: 'stage', label: 'stage', type: 'string', required: true },
  { key: 'close_date', label: 'close_date', type: 'date', required: true },
  { key: 'amount', label: 'amount', type: 'number' },
  { key: 'tier', label: 'tier', type: 'string' },
  { key: 'currency', label: 'currency', type: 'string' },
];

type Sponsor = Awaited<ReturnType<typeof crmSponsorRowsTx>>[number];

async function opportunityRecords(tx: TenantTx, connectionId: string, rows: readonly Sponsor[]) {
  const eventIds = [...new Set(rows.map((r) => r.eventId))];
  const events = new Map((await crmEventRowsTx(tx, { ids: eventIds, limit: 1000 })).map((e) => [e.id, e]));
  const refs = await refsFor(tx, connectionId, [], eventIds);
  return rows.map((s): LocalRecord | null => {
    const e = events.get(s.eventId);
    // A sponsor of a draft event isn't sent yet (its campaign isn't either).
    if (!e) return null;
    const g = s.grant;
    const campaign = refs.campaign(s.eventId);
    return {
      id: s.id,
      updatedAt: new Date(),
      fields: {
        name: `${e.name}: ${s.name} (${s.tierName})`.slice(0, 120),
        stage: opportunityStage(g?.status ?? null),
        close_date: dateIn(g?.activatedAt ?? g?.cancelledAt ?? e.startsAt, e.timezone),
        // Salesforce amounts are decimals in major units: converted here, at the boundary.
        amount: g ? g.priceMinor / 10 ** currencyExponent(g.currency) : null,
        tier: s.tierName,
        currency: g?.currency ?? null,
        ...(campaign ? { campaign_ref: campaign } : {}),
      },
    };
  });
}

const opportunitiesObject: ObjectDefinition = {
  key: 'sponsor_opportunities',
  remoteFields: fieldSpecs(OPPORTUNITY_FIELDS),
  localFields: OPPORTUNITY_LOCAL,
  push: {
    defaultMapping: [
      { source: 'name', target: 'name', transform: 'none', default: null },
      { source: 'stage', target: 'stage_name', transform: 'none', default: null },
      { source: 'close_date', target: 'close_date', transform: 'none', default: null },
      { source: 'amount', target: 'amount', transform: 'none', default: null },
      { source: 'tier', target: 'description', transform: 'none', default: null },
    ],
    async changes(tx, cursor, limit, meta) {
      return passPage(tx, cursor, limit, {
        connectionId: meta.connectionId,
        objectType: 'sponsor_opportunities',
        fetch: (afterId, n) => crmSponsorRowsTx(tx, { afterId, limit: n }),
        build: (rows) => opportunityRecords(tx, meta.connectionId, rows),
      });
    },
    async read(tx, localId) {
      const connectionId = await liveConnectionIdTx(tx);
      if (!connectionId) return null;
      const rows = await crmSponsorRowsTx(tx, { ids: [localId], limit: 1 });
      return (await opportunityRecords(tx, connectionId, rows))[0] ?? null;
    },
    async send(io, input) {
      const campaign = input.local.fields.campaign_ref;
      const sent = await sendRecord(io, 'Opportunity', {
        externalId: input.externalId,
        localId: input.local.id,
        body: {
          ...toApi(OPPORTUNITY_FIELDS, input.values),
          ...(typeof campaign === 'string' ? { CampaignId: campaign } : {}),
        },
        idempotencyKey: input.idempotencyKey,
      });
      return { externalId: sent.externalId, version: sent.version };
    },
  },
};

export const salesforceConnector = defineConnector({
  key: SALESFORCE,
  name: 'Salesforce',
  providerConfigKey: SALESFORCE,
  scopes: ['api', 'refresh_token'],
  entitlement: 'integrations',
  availability: 'general',
  fake: salesforceFakeProvider,
  // In this order: people first, then campaigns, then the members and deals that point at them.
  objects: [
    {
      key: 'contacts',
      remoteFields: fieldSpecs(CONTACT_FIELDS),
      localFields: PERSON_LOCAL,
      pull: personPull('Contact', CONTACT_FIELDS),
      push: personPush('contacts', 'Contact', CONTACT_FIELDS),
    },
    {
      key: 'leads',
      remoteFields: fieldSpecs(LEAD_FIELDS),
      localFields: PERSON_LOCAL,
      pull: personPull('Lead', LEAD_FIELDS),
      push: personPush('leads', 'Lead', LEAD_FIELDS),
    },
    campaignsObject,
    membersObject,
    opportunitiesObject,
  ],
});
