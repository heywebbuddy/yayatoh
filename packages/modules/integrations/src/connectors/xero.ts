import { currencyExponent } from '@yayatoh/kernel';
import { decimalToMinor, minorToDecimal, type ProviderAccount } from '../accounting/domain.ts';
import type { FakeAccount, FakeProvider } from '../auth/fake.ts';
import { ProviderError, type ProviderRequest, type ProviderResponse } from '../auth/port.ts';
import { defineConnector, type SyncIO } from '../sdk/connector.ts';
import type { FakeBooksJournal } from './quickbooks.ts';

/**
 * Xero (M6.5d, decision P6-6): daily summary journals as posted `ManualJournals` and the chart of
 * accounts, through Nango's proxy (fake in dev and CI).
 *
 * API (Xero Accounting API 2.0; UNVERIFIED until the owner's Xero app and Nango integration
 * exist, owner inbox): `GET /connections` names the organisation (`tenantId`), sent on every
 * accounting call as `Xero-tenant-id`; `GET /api.xro/2.0/Organisation` (its base currency);
 * `GET /api.xro/2.0/Accounts`; `PUT /api.xro/2.0/ManualJournals` with an `Idempotency-Key`, lines
 * `{ LineAmount (debit positive), AccountCode, Description }`. Manual journals are in the base
 * currency only: a summary in another currency is refused here (`currency_unsupported`) and waits
 * in the errors inbox.
 */

interface XeroAccount {
  AccountID: string;
  Code: string | null;
  Name: string;
  Type: string;
  Status: 'ACTIVE' | 'ARCHIVED';
}

interface XeroData {
  tenantId: string;
  baseCurrency: string;
  seq: number;
  accounts: XeroAccount[];
  journals: FakeBooksJournal[];
  keys: Record<string, string>;
}

export const XERO_FAKE_ACCOUNTS: readonly XeroAccount[] = [
  { AccountID: 'a1b2-090', Code: '090', Name: 'Business Bank Account', Type: 'BANK', Status: 'ACTIVE' },
  { AccountID: 'a1b2-610', Code: '610', Name: 'Yayatoh Clearing', Type: 'CURRENT', Status: 'ACTIVE' },
  { AccountID: 'a1b2-200', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE' },
  { AccountID: 'a1b2-260', Code: '260', Name: 'Donations', Type: 'OTHERINCOME', Status: 'ACTIVE' },
  { AccountID: 'a1b2-210', Code: '210', Name: 'Refunds', Type: 'REVENUE', Status: 'ACTIVE' },
  { AccountID: 'a1b2-404', Code: '404', Name: 'Bank Fees', Type: 'EXPENSE', Status: 'ACTIVE' },
  { AccountID: 'a1b2-nocode', Code: null, Name: 'Uncoded', Type: 'EXPENSE', Status: 'ACTIVE' },
  { AccountID: 'a1b2-999', Code: '999', Name: 'Archived', Type: 'EXPENSE', Status: 'ARCHIVED' },
];

const FAKE_TENANT = 'f1e2d3c4-0000-4000-8000-00000000xero';
const xero = (a: FakeAccount) => a.data as XeroData;
const fail = (status: number, type: string): ProviderResponse => ({ status, body: { Type: type } });

export const xeroJournals = (a: FakeAccount): readonly FakeBooksJournal[] => xero(a).journals;

function putJournal(d: XeroData, req: ProviderRequest): ProviderResponse {
  const key = req.idempotencyKey;
  if (key && d.keys[key])
    return { status: 200, body: { ManualJournals: [{ ManualJournalID: d.keys[key] }] } };
  const mj = ((req.body ?? {}) as { ManualJournals?: Record<string, unknown>[] }).ManualJournals?.[0];
  if (!mj || typeof mj.Narration !== 'string' || !mj.Narration) return fail(400, 'ValidationException');
  if (typeof mj.Date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(mj.Date))
    return fail(400, 'ValidationException');
  const exponent = currencyExponent(d.baseCurrency);
  const lines: { accountId: string; amountMinor: number }[] = [];
  for (const l of (Array.isArray(mj.JournalLines) ? mj.JournalLines : []) as Record<string, unknown>[]) {
    const account = d.accounts.find((a) => a.Code !== null && a.Code === l.AccountCode);
    if (account?.Status !== 'ACTIVE') return fail(400, 'ValidationException');
    const amount =
      typeof l.LineAmount === 'number' || typeof l.LineAmount === 'string'
        ? decimalToMinor(l.LineAmount, exponent)
        : null;
    if (!amount) return fail(400, 'ValidationException');
    lines.push({ accountId: account.AccountID, amountMinor: amount });
  }
  if (lines.length < 2 || lines.reduce((t, l) => t + l.amountMinor, 0) !== 0)
    return fail(400, 'ValidationException');
  d.seq += 1;
  const id = `mj-${String(d.seq).padStart(4, '0')}`;
  d.journals.push({
    externalId: id,
    day: mj.Date,
    currency: d.baseCurrency,
    reference: typeof mj.Reference === 'string' ? mj.Reference : '',
    memo: mj.Narration,
    lines,
  });
  if (key) d.keys[key] = id;
  return { status: 200, body: { ManualJournals: [{ ManualJournalID: id, Status: 'POSTED' }] } };
}

export const xeroFakeProvider: FakeProvider = {
  accountLabel: 'Demo Company (Xero)',
  seed: (): XeroData => ({
    tenantId: FAKE_TENANT,
    baseCurrency: 'USD',
    seq: 0,
    accounts: XERO_FAKE_ACCOUNTS.map((a) => ({ ...a })),
    journals: [],
    keys: {},
  }),
  handle(account, req): ProviderResponse {
    const d = xero(account);
    if (req.method === 'GET' && req.path === '/connections')
      return {
        status: 200,
        body: [
          { id: 'conn-1', tenantId: d.tenantId, tenantType: 'ORGANISATION', tenantName: 'Demo Company' },
        ],
      };
    if (!req.path.startsWith('/api.xro/2.0/')) return fail(404, 'NotFound');
    // Every accounting call names the organisation.
    if (req.headers?.['Xero-tenant-id'] !== d.tenantId) return fail(403, 'AuthorizationUnsuccessful');
    if (req.method === 'GET' && req.path === '/api.xro/2.0/Organisation')
      return {
        status: 200,
        body: { Organisations: [{ BaseCurrency: d.baseCurrency, Name: 'Demo Company' }] },
      };
    if (req.method === 'GET' && req.path === '/api.xro/2.0/Accounts')
      return { status: 200, body: { Accounts: d.accounts } };
    if (req.method === 'PUT' && req.path === '/api.xro/2.0/ManualJournals') return putJournal(d, req);
    return fail(404, 'NotFound');
  },
};

/** The organisation this connection is for (Xero's tenant id) and its base currency, once per run. */
const orgOf = new WeakMap<SyncIO, Promise<{ tenantId: string; baseCurrency: string }>>();
function organisation(io: SyncIO) {
  let p = orgOf.get(io);
  if (!p) {
    p = (async () => {
      const conns = (await io.client.request({ method: 'GET', path: '/connections' })).body as
        | { tenantId?: unknown; tenantType?: unknown }[]
        | null;
      const tenant = (conns ?? []).find(
        (c) => typeof c.tenantId === 'string' && (c.tenantType ?? 'ORGANISATION') === 'ORGANISATION',
      );
      if (!tenant || typeof tenant.tenantId !== 'string') throw new ProviderError(404, 'no_organisation');
      const tenantId = tenant.tenantId;
      const org = (
        await io.client.request({
          method: 'GET',
          path: '/api.xro/2.0/Organisation',
          headers: { 'Xero-tenant-id': tenantId },
        })
      ).body as { Organisations?: { BaseCurrency?: unknown }[] } | null;
      const base = org?.Organisations?.[0]?.BaseCurrency;
      return { tenantId, baseCurrency: typeof base === 'string' ? base : '' };
    })();
    orgOf.set(io, p);
    // A failed lookup is asked again next time.
    p.catch(() => orgOf.delete(io));
  }
  return p;
}

export const xeroConnector = defineConnector({
  key: 'xero',
  name: 'Xero',
  providerConfigKey: 'xero',
  scopes: ['accounting.transactions', 'accounting.settings.read', 'offline_access'],
  entitlement: 'integrations',
  availability: 'general',
  fake: xeroFakeProvider,
  objects: [],
  accounting: {
    async listAccounts(io) {
      const { tenantId } = await organisation(io);
      const res = await io.client.request({
        method: 'GET',
        path: '/api.xro/2.0/Accounts',
        headers: { 'Xero-tenant-id': tenantId },
      });
      const list = ((res.body as { Accounts?: unknown[] } | null)?.Accounts ?? []) as Partial<XeroAccount>[];
      // Manual journal lines name accounts by code: an account without one cannot be used.
      return list.flatMap((a): ProviderAccount[] =>
        typeof a.AccountID === 'string' &&
        typeof a.Name === 'string' &&
        typeof a.Code === 'string' &&
        a.Code &&
        a.Status === 'ACTIVE'
          ? [
              {
                id: a.AccountID.slice(0, 100),
                code: a.Code.slice(0, 40),
                name: a.Name.slice(0, 200),
                type: typeof a.Type === 'string' ? a.Type.slice(0, 60) : '',
              },
            ]
          : [],
      );
    },
    async postJournal(io, j) {
      const { tenantId, baseCurrency } = await organisation(io);
      if (j.currency !== baseCurrency) throw new ProviderError(422, 'currency_unsupported');
      const res = await io.client.request({
        method: 'PUT',
        path: '/api.xro/2.0/ManualJournals',
        headers: { 'Xero-tenant-id': tenantId },
        idempotencyKey: j.idempotencyKey,
        body: {
          ManualJournals: [
            {
              Narration: `${j.memo} [${j.reference}]`,
              Reference: j.reference,
              Date: j.day,
              Status: 'POSTED',
              LineAmountTypes: 'NoTax',
              JournalLines: j.lines.map((l) => {
                if (!l.accountCode) throw new ProviderError(422, 'account_code_missing');
                return {
                  LineAmount: Number(minorToDecimal(l.amountMinor, j.exponent)),
                  AccountCode: l.accountCode,
                  Description: l.description,
                };
              }),
            },
          ],
        },
      });
      const id = (res.body as { ManualJournals?: { ManualJournalID?: unknown }[] } | null)
        ?.ManualJournals?.[0]?.ManualJournalID;
      if (typeof id !== 'string' || !id) throw new ProviderError(502, 'no_id');
      return { externalId: id.slice(0, 255) };
    },
  },
});
