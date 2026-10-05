import type { FakeAccount, FakeProvider } from '../../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../../auth/port.ts';
import { SF_API, SF_EXTERNAL_ID, SF_PREFIX, type SObject } from './objects.ts';

/**
 * A fake Salesforce org for dev and CI (M6.5b). It answers the slice of the REST API the
 * connector uses, the way Salesforce does:
 * - `GET /services/oauth2/userinfo` (the connection's integration user);
 * - `GET {api}/query?q=` for the connector's SOQL shapes (keyset on `SystemModstamp, Id`, and a
 *   campaign's member statuses);
 * - `GET {api}/sobjects/{Type}/{Id}`;
 * - `PATCH {api}/sobjects/{Type}/{Id}` (update, 204), `PATCH {api}/sobjects/{Type}/Yayatoh_Id__c/{v}`
 *   (upsert by our external id: 201 created / 200 updated) and `POST {api}/sobjects/{Type}`;
 * - validation errors as 400 with Salesforce's error codes (required fields, bad emails, a
 *   person twice in one campaign, a member status the campaign doesn't have).
 * Every write stamps `SystemModstamp` and `LastModifiedById` (the integration user), which is how
 * the connector recognises its own writes; `salesforceRemoteEdit` edits as a person would.
 */

export const SF_INTEGRATION_USER = '005FAKE0000000INTG';
export const SF_HUMAN_USER = '005FAKE0000000HUMN';

export interface SfRecord {
  Id: string;
  type: SObject;
  fields: Record<string, unknown>;
  SystemModstamp: string;
  LastModifiedById: string;
}

interface SfData {
  seq: number;
  clock: number;
  records: SfRecord[];
}

const WRITABLE: Readonly<Record<SObject, readonly string[]>> = {
  Contact: ['FirstName', 'LastName', 'Email', 'Title', 'Phone', 'HasOptedOutOfEmail', SF_EXTERNAL_ID],
  Lead: [
    'FirstName',
    'LastName',
    'Company',
    'Email',
    'Title',
    'Phone',
    'LeadSource',
    'Status',
    'HasOptedOutOfEmail',
    SF_EXTERNAL_ID,
  ],
  Campaign: ['Name', 'StartDate', 'EndDate', 'Status', 'Type', 'Description', 'IsActive', SF_EXTERNAL_ID],
  CampaignMember: ['CampaignId', 'ContactId', 'LeadId', 'Status', SF_EXTERNAL_ID],
  CampaignMemberStatus: ['CampaignId', 'Label', 'HasResponded', 'SortOrder'],
  Opportunity: [
    'Name',
    'StageName',
    'CloseDate',
    'Amount',
    'Type',
    'Description',
    'CampaignId',
    'CurrencyIsoCode',
    SF_EXTERNAL_ID,
  ],
};
const REQUIRED: Readonly<Record<SObject, readonly string[]>> = {
  Contact: ['LastName'],
  Lead: ['LastName', 'Company'],
  Campaign: ['Name'],
  CampaignMember: ['CampaignId'],
  CampaignMemberStatus: ['CampaignId', 'Label'],
  Opportunity: ['Name', 'StageName', 'CloseDate'],
};
const isSObject = (t: string): t is SObject => t in WRITABLE;

/** The fake org's seed: contacts and leads, one contact without an email (the errors inbox). */
export const SALESFORCE_SEED: readonly {
  readonly type: 'Contact' | 'Lead';
  readonly fields: Record<string, unknown>;
}[] = [
  {
    type: 'Contact',
    fields: {
      FirstName: 'Ada',
      LastName: 'Lovelace',
      Email: 'ada.lovelace@sf-remote.test',
      Title: 'Countess',
    },
  },
  {
    type: 'Contact',
    fields: {
      FirstName: 'Grace',
      LastName: 'Hopper',
      Email: 'Grace.Hopper@sf-remote.test',
      Title: 'Rear Admiral',
    },
  },
  // No email: Yayatoh needs one, so the pull sends it to the errors inbox until it is fixed there.
  { type: 'Contact', fields: { FirstName: 'Nameless', LastName: 'Record', Title: 'Unknown' } },
  {
    type: 'Lead',
    fields: {
      FirstName: 'Katherine',
      LastName: 'Johnson',
      Email: 'katherine.johnson@sf-remote.test',
      Company: 'NASA',
    },
  },
  {
    type: 'Lead',
    fields: {
      FirstName: 'Dorothy',
      LastName: 'Vaughan',
      Email: 'dorothy.vaughan@sf-remote.test',
      Company: 'NASA',
      HasOptedOutOfEmail: true,
    },
  },
];
/** The seeded contact without an email. */
export const SALESFORCE_BAD_RECORD = `${SF_PREFIX.Contact}FAKE00000000003`;

const sfData = (a: FakeAccount) => a.data as SfData;

const newId = (d: SfData, type: SObject) => {
  d.seq += 1;
  return `${SF_PREFIX[type]}FAKE${String(d.seq).padStart(11, '0')}`;
};

/** A strictly increasing modstamp (two writes in one millisecond still differ). */
const stamp = (d: SfData) => {
  d.clock = Math.max(Date.now(), d.clock + 1);
  return new Date(d.clock).toISOString();
};

const view = (r: SfRecord): Record<string, unknown> => ({
  attributes: { type: r.type, url: `${SF_API}/sobjects/${r.type}/${r.Id}` },
  Id: r.Id,
  ...r.fields,
  SystemModstamp: r.SystemModstamp,
  LastModifiedById: r.LastModifiedById,
});

const err = (status: number, errorCode: string, fields: string[] = []): ProviderResponse => ({
  status,
  body: [{ errorCode, message: errorCode, fields }],
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Salesforce's checks on a record about to be saved (null: fine). */
function validate(d: SfData, type: SObject, fields: Record<string, unknown>, self: string | null) {
  for (const k of REQUIRED[type]) {
    const v = fields[k];
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === ''))
      return err(400, 'REQUIRED_FIELD_MISSING', [k]);
  }
  if (typeof fields.Email === 'string' && fields.Email && !EMAIL.test(fields.Email))
    return err(400, 'INVALID_EMAIL_ADDRESS', ['Email']);
  if (type === 'CampaignMember') {
    const person = fields.ContactId ?? fields.LeadId;
    if (!person) return err(400, 'REQUIRED_FIELD_MISSING', ['ContactId']);
    const campaign = d.records.find((r) => r.type === 'Campaign' && r.Id === fields.CampaignId);
    if (!campaign) return err(400, 'INVALID_CROSS_REFERENCE_KEY', ['CampaignId']);
    if (
      d.records.some(
        (r) =>
          r.type === 'CampaignMember' &&
          r.Id !== self &&
          r.fields.CampaignId === fields.CampaignId &&
          (r.fields.ContactId ?? r.fields.LeadId) === person,
      )
    )
      return err(400, 'DUPLICATE_VALUE', ['ContactId']);
    const labels = [
      'Sent',
      'Responded',
      ...d.records
        .filter((r) => r.type === 'CampaignMemberStatus' && r.fields.CampaignId === fields.CampaignId)
        .map((r) => r.fields.Label),
    ];
    if (fields.Status && !labels.includes(fields.Status)) return err(400, 'INVALID_STATUS', ['Status']);
  }
  if (type === 'Opportunity' && fields.CampaignId) {
    if (!d.records.some((r) => r.type === 'Campaign' && r.Id === fields.CampaignId))
      return err(400, 'INVALID_CROSS_REFERENCE_KEY', ['CampaignId']);
  }
  return null;
}

function write(
  d: SfData,
  type: SObject,
  existing: SfRecord | null,
  body: Record<string, unknown>,
  user: string,
): { record: SfRecord } | { error: ProviderResponse } {
  const allowed = new Set(WRITABLE[type]);
  const unknown = Object.keys(body).find((k) => !allowed.has(k));
  if (unknown) return { error: err(400, 'INVALID_FIELD', [unknown]) };
  // A member's campaign and person are set when it is created and can't change afterwards.
  if (existing && type === 'CampaignMember') {
    const fixed = ['CampaignId', 'ContactId', 'LeadId'].find(
      (k) => k in body && body[k] !== (existing.fields[k] ?? undefined),
    );
    if (fixed) return { error: err(400, 'INVALID_FIELD_FOR_INSERT_UPDATE', [fixed]) };
  }
  const fields = { ...(existing?.fields ?? {}), ...body };
  const problem = validate(d, type, fields, existing?.Id ?? null);
  if (problem) return { error: problem };
  const record = existing ?? {
    Id: newId(d, type),
    type,
    fields: {},
    SystemModstamp: '',
    LastModifiedById: '',
  };
  record.fields = fields;
  record.SystemModstamp = stamp(d);
  record.LastModifiedById = user;
  if (!existing) d.records.push(record);
  return { record };
}

/** The keyset SOQL the connector sends; anything else is refused (MALFORMED_QUERY). */
const KEYSET =
  /^SELECT (.+) FROM (\w+)(?: WHERE SystemModstamp > ([0-9T:.\-Z]+) OR \(SystemModstamp = ([0-9T:.\-Z]+) AND Id > '([A-Za-z0-9]+)'\))? ORDER BY SystemModstamp, Id LIMIT (\d+)$/;
const STATUSES = /^SELECT Id, Label FROM CampaignMemberStatus WHERE CampaignId = '([A-Za-z0-9]+)'$/;

function query(d: SfData, q: string): ProviderResponse {
  const statuses = STATUSES.exec(q);
  if (statuses) {
    const records = d.records
      .filter((r) => r.type === 'CampaignMemberStatus' && r.fields.CampaignId === statuses[1])
      .map((r) => ({ attributes: { type: r.type }, Id: r.Id, Label: r.fields.Label }));
    return { status: 200, body: { totalSize: records.length, done: true, records } };
  }
  const m = KEYSET.exec(q);
  const type = m?.[2] ?? '';
  if (!m || !isSObject(type)) return err(400, 'MALFORMED_QUERY');
  const select = (m[1] ?? '').split(',').map((s) => s.trim());
  const [after, eq, afterId] = [m[3], m[4], m[5]];
  const limit = Math.min(2000, Number(m[6]));
  const rows = d.records
    .filter((r) => r.type === type)
    .filter(
      (r) =>
        !after ||
        r.SystemModstamp > after ||
        (r.SystemModstamp === eq && afterId !== undefined && r.Id > afterId),
    )
    .sort((a, b) =>
      a.SystemModstamp === b.SystemModstamp
        ? a.Id < b.Id
          ? -1
          : 1
        : a.SystemModstamp < b.SystemModstamp
          ? -1
          : 1,
    )
    .slice(0, limit)
    .map((r) => {
      const v = view(r);
      return Object.fromEntries([
        ['attributes', v.attributes],
        ...select.map((k) => [k, k in v ? v[k] : null]),
      ]);
    });
  return { status: 200, body: { totalSize: rows.length, done: true, records: rows } };
}

const SOBJECT = /^\/services\/data\/v62\.0\/sobjects\/(\w+)(?:\/([A-Za-z0-9_]+))?(?:\/([^/]+))?$/;

export const salesforceFakeProvider: FakeProvider = {
  accountLabel: 'Salesforce (sandbox org)',
  seed(): SfData {
    const d: SfData = { seq: 0, clock: Date.UTC(2026, 0, 1), records: [] };
    for (const s of SALESFORCE_SEED) write(d, s.type, null, { ...s.fields }, SF_HUMAN_USER);
    return d;
  },
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = sfData(account);
    if (req.method === 'GET' && req.path === '/services/oauth2/userinfo')
      return {
        status: 200,
        body: {
          user_id: SF_INTEGRATION_USER,
          organization_id: '00DFAKE0000000ORG',
          name: 'Integration User',
        },
      };
    if (req.method === 'GET' && req.path === `${SF_API}/query`) return query(d, req.query?.q ?? '');
    const m = SOBJECT.exec(req.path);
    const type = m?.[1] ?? '';
    if (!m || !isSObject(type)) return err(404, 'NOT_FOUND');
    const body = (req.body ?? {}) as Record<string, unknown>;
    // By our external id: `/sobjects/{Type}/Yayatoh_Id__c/{value}` (upsert).
    if (m[2] === SF_EXTERNAL_ID && m[3]) {
      if (req.method !== 'PATCH') return err(405, 'METHOD_NOT_ALLOWED');
      const value = decodeURIComponent(m[3]);
      const existing = d.records.find((r) => r.type === type && r.fields[SF_EXTERNAL_ID] === value) ?? null;
      const out = write(d, type, existing, { ...body, [SF_EXTERNAL_ID]: value }, SF_INTEGRATION_USER);
      if ('error' in out) return out.error;
      return {
        status: existing ? 200 : 201,
        body: { id: out.record.Id, success: true, errors: [], created: !existing },
      };
    }
    if (m[3]) return err(404, 'NOT_FOUND');
    const id = m[2];
    if (!id) {
      if (req.method !== 'POST') return err(405, 'METHOD_NOT_ALLOWED');
      const out = write(d, type, null, body, SF_INTEGRATION_USER);
      if ('error' in out) return out.error;
      return { status: 201, body: { id: out.record.Id, success: true, errors: [] } };
    }
    const existing = d.records.find((r) => r.type === type && r.Id === id);
    if (!existing) return err(404, 'NOT_FOUND');
    if (req.method === 'GET') return { status: 200, body: view(existing) };
    if (req.method === 'PATCH') {
      const out = write(d, type, existing, body, SF_INTEGRATION_USER);
      return 'error' in out ? out.error : { status: 204, body: null };
    }
    return err(405, 'METHOD_NOT_ALLOWED');
  },
};

/** The fake org's records of one type, as the API shows them (dev route and tests). */
export const salesforceRemoteRecords = (a: FakeAccount, type: SObject) =>
  sfData(a)
    .records.filter((r) => r.type === type)
    .map(view);

/** Edit (or create, without `id`) a record as a person in Salesforce would (dev route and tests). */
export function salesforceRemoteEdit(
  a: FakeAccount,
  type: SObject,
  id: string | null,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const d = sfData(a);
  const existing = id ? (d.records.find((r) => r.type === type && r.Id === id) ?? null) : null;
  if (id && !existing) throw new Error(`fake Salesforce: no ${type} ${id}`);
  const out = write(d, type, existing, fields, SF_HUMAN_USER);
  if ('error' in out) throw new Error(`fake Salesforce refused the edit: ${JSON.stringify(out.error.body)}`);
  return view(out.record);
}
