import type { FieldSpec, FieldType } from '../../domain/mapping.ts';

/**
 * Salesforce's side of the M6.5b connector, pure: the REST API version, the sObjects it touches
 * and their fields. A field's key is our snake_case name (the mapping model's key rule); its `api`
 * name is Salesforce's, shown as the label in the mapping editor.
 */

export const SALESFORCE = 'salesforce';
export const SF_API = '/services/data/v62.0';
/** The external id field Yayatoh's records carry in Salesforce (upserts by it are idempotent). */
export const SF_EXTERNAL_ID = 'Yayatoh_Id__c';

export type SObject =
  | 'Contact'
  | 'Lead'
  | 'Campaign'
  | 'CampaignMember'
  | 'CampaignMemberStatus'
  | 'Opportunity';

/** Id key prefixes (the first three characters of a Salesforce id say its object). */
export const SF_PREFIX: Readonly<Record<SObject, string>> = {
  Contact: '003',
  Lead: '00Q',
  Campaign: '701',
  CampaignMember: '00v',
  CampaignMemberStatus: '01Y',
  Opportunity: '006',
};

export interface SfField {
  readonly key: string;
  readonly api: string;
  readonly type: FieldType;
  /** Salesforce refuses a create without it. */
  readonly required?: boolean;
}

const f = (key: string, api: string, type: FieldType = 'string', required = false): SfField => ({
  key,
  api,
  type,
  ...(required ? { required } : {}),
});

/** Contact and Lead fields a sync reads and writes. */
export const CONTACT_FIELDS: readonly SfField[] = [
  f('email', 'Email', 'email'),
  f('first_name', 'FirstName'),
  f('last_name', 'LastName', 'string', true),
  f('title', 'Title'),
  f('phone', 'Phone'),
];
export const LEAD_FIELDS: readonly SfField[] = [
  f('email', 'Email', 'email'),
  f('first_name', 'FirstName'),
  f('last_name', 'LastName', 'string', true),
  f('company', 'Company', 'string', true),
  f('title', 'Title'),
  f('phone', 'Phone'),
  f('lead_source', 'LeadSource'),
];
export const CAMPAIGN_FIELDS: readonly SfField[] = [
  f('name', 'Name', 'string', true),
  f('start_date', 'StartDate', 'date'),
  f('end_date', 'EndDate', 'date'),
  f('status', 'Status'),
  f('description', 'Description'),
];
export const MEMBER_FIELDS: readonly SfField[] = [f('status', 'Status', 'string', true)];
export const OPPORTUNITY_FIELDS: readonly SfField[] = [
  f('name', 'Name', 'string', true),
  f('stage_name', 'StageName', 'string', true),
  f('close_date', 'CloseDate', 'date', true),
  f('amount', 'Amount', 'number'),
  f('description', 'Description'),
  f('currency_iso_code', 'CurrencyIsoCode'),
];

/** Fields the pull reads beyond the mapped ones (the opt-out withdraws consent here). */
export const OPT_OUT = { key: 'has_opted_out_of_email', api: 'HasOptedOutOfEmail' } as const;

/** The mapping editor's view of Salesforce fields (the API name is the label: a brand term). */
export const fieldSpecs = (fields: readonly SfField[]): FieldSpec[] =>
  fields.map((x) => ({ key: x.key, label: x.api, type: x.type, ...(x.required ? { required: true } : {}) }));

/** Mapped values (our keys) → a Salesforce body (API names); dates as `YYYY-MM-DD`. */
export function toApi(fields: readonly SfField[], values: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const x of fields) {
    if (!(x.key in values)) continue;
    const v = values[x.key];
    out[x.api] = x.type === 'date' && typeof v === 'string' ? v.slice(0, 10) : (v ?? null);
  }
  return out;
}

/** A Salesforce record (API names) → our keys, for the fields listed (and the opt-out flag). */
export function fromApi(fields: readonly SfField[], record: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = {};
  for (const x of fields) if (x.api in record) out[x.key] = record[x.api] ?? null;
  if (OPT_OUT.api in record) out[OPT_OUT.key] = record[OPT_OUT.api] === true;
  return out;
}

/** The Campaign's member statuses Yayatoh uses (created with the campaign when missing). */
export const MEMBER_STATUSES = [
  { label: 'Registered', responded: false },
  { label: 'Attended', responded: true },
] as const;

/** An event's status as a Salesforce Campaign status (its standard picklist). */
export function campaignStatus(status: string, endsAt: Date, now: Date): string {
  if (status === 'cancelled') return 'Aborted';
  if (status === 'completed' || status === 'archived' || endsAt <= now) return 'Completed';
  if (status === 'published') return 'In Progress';
  return 'Planned';
}

/** A sponsor deal's stage (Salesforce's standard Opportunity stages). */
export function opportunityStage(grant: string | null): string {
  if (grant === 'active') return 'Closed Won';
  if (grant === 'cancelled') return 'Closed Lost';
  if (grant === 'pending') return 'Negotiation/Review';
  return 'Prospecting';
}

/** A date (`YYYY-MM-DD`) of an instant in an IANA time zone. */
export function dateIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** First name and last name from one name (Salesforce needs a last name). */
export function splitName(name: string | null): { first: string | null; last: string | null } {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { first: null, last: null };
  if (words.length === 1) return { first: null, last: words[0] ?? null };
  return { first: words[0] ?? null, last: words.slice(1).join(' ') };
}

/** One name from Salesforce's first and last names (the placeholder last name counts as none). */
export function joinName(first: unknown, last: unknown): string | null {
  const parts = [first, last]
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((x) => x && x !== NO_LAST_NAME);
  return parts.length ? parts.join(' ') : null;
}

/** What a push writes when a required name or company is unknown (Salesforce's own convention). */
export const NO_LAST_NAME = '[not provided]';
