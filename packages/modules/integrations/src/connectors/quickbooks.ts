import { currencyExponent } from '@yayatoh/kernel';
import { decimalToMinor, minorToDecimal, type ProviderAccount } from '../accounting/domain.ts';
import type { FakeAccount, FakeProvider } from '../auth/fake.ts';
import { ProviderError, type ProviderRequest, type ProviderResponse } from '../auth/port.ts';
import { defineConnector } from '../sdk/connector.ts';

/**
 * QuickBooks Online (M6.5d, decision P6-6): daily summary journals as `JournalEntry` objects and
 * the chart of accounts from the `Account` query, through Nango's proxy (fake in dev and CI).
 *
 * API (Intuit Accounting API v3, paths relative to the company; UNVERIFIED until the owner's
 * Intuit developer app and Nango integration exist, owner inbox): Nango's `quickbooks` proxy base
 * carries the company (`/v3/company/{realmId}`) from the connection's config.
 * - `GET /query?query=select * from Account where Active = true maxresults 1000`
 * - `POST /journalentry?requestid=…` (Intuit's idempotency: the same `requestid` answers the first
 *   result), lines `{ Amount, DetailType: 'JournalEntryLineDetail', JournalEntryLineDetail:
 *   { PostingType: 'Debit' | 'Credit', AccountRef: { value } } }`, `TxnDate`, `DocNumber` (≤ 21),
 *   `PrivateNote`, `CurrencyRef` (multicurrency companies). Amounts are decimals, never floats here.
 */

interface QboAccount {
  Id: string;
  Name: string;
  AcctNum: string | null;
  AccountType: string;
  Active: boolean;
}

/** A journal entry the fake company holds (tests compare it with the ledger to the cent). */
export interface FakeBooksJournal {
  readonly externalId: string;
  readonly day: string;
  readonly currency: string;
  readonly reference: string;
  readonly memo: string;
  /** Debit positive, credit negative, minor units (parsed back from the provider's decimals). */
  readonly lines: readonly { readonly accountId: string; readonly amountMinor: number }[];
}

interface QboData {
  seq: number;
  homeCurrency: string;
  accounts: QboAccount[];
  journals: FakeBooksJournal[];
  /** requestid → the entry's id. */
  requests: Record<string, string>;
}

/** The fake company's chart of accounts (ids are the provider's). */
export const QUICKBOOKS_FAKE_ACCOUNTS: readonly QboAccount[] = [
  { Id: '35', Name: 'Business Checking', AcctNum: '1000', AccountType: 'Bank', Active: true },
  { Id: '36', Name: 'Yayatoh Clearing', AcctNum: '1250', AccountType: 'Other Current Asset', Active: true },
  { Id: '79', Name: 'Ticket Sales', AcctNum: '4000', AccountType: 'Income', Active: true },
  { Id: '80', Name: 'Donations Received', AcctNum: '4100', AccountType: 'Income', Active: true },
  { Id: '81', Name: 'Refunds to Customers', AcctNum: '4900', AccountType: 'Income', Active: true },
  { Id: '92', Name: 'Platform Fees', AcctNum: '6100', AccountType: 'Expense', Active: true },
  { Id: '93', Name: 'Old Suspense', AcctNum: '9999', AccountType: 'Expense', Active: false },
];

const qbo = (a: FakeAccount) => a.data as QboData;
const fault = (status: number, code: string): ProviderResponse => ({
  status,
  body: { Fault: { type: 'ValidationFault', Error: [{ code, Message: code }] } },
});

/** The fake company's journal entries (tests and the dev route). */
export const quickbooksJournals = (a: FakeAccount): readonly FakeBooksJournal[] => qbo(a).journals;

function postEntry(d: QboData, req: ProviderRequest): ProviderResponse {
  const requestId = req.query?.requestid;
  if (!requestId) return fault(400, 'requestid_missing');
  const seen = d.requests[requestId];
  if (seen) return { status: 200, body: { JournalEntry: { Id: seen, SyncToken: '0' } } };
  const body = (req.body ?? {}) as {
    TxnDate?: unknown;
    DocNumber?: unknown;
    PrivateNote?: unknown;
    CurrencyRef?: { value?: unknown };
    Line?: unknown;
  };
  const currency = typeof body.CurrencyRef?.value === 'string' ? body.CurrencyRef.value : d.homeCurrency;
  const exponent = currencyExponent(currency);
  if (typeof body.TxnDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.TxnDate))
    return fault(400, 'txn_date');
  if (typeof body.DocNumber !== 'string' || body.DocNumber.length > 21) return fault(400, 'doc_number');
  if (!Array.isArray(body.Line) || body.Line.length < 2) return fault(400, 'lines');
  const lines: { accountId: string; amountMinor: number }[] = [];
  for (const raw of body.Line as Record<string, unknown>[]) {
    const detail = raw.JournalEntryLineDetail as
      | { PostingType?: unknown; AccountRef?: { value?: unknown } }
      | undefined;
    const accountId = detail?.AccountRef?.value;
    const account = d.accounts.find((x) => x.Id === accountId);
    if (raw.DetailType !== 'JournalEntryLineDetail' || !account) return fault(400, 'account');
    if (!account.Active) return fault(400, 'account_inactive');
    const amount =
      typeof raw.Amount === 'number' || typeof raw.Amount === 'string'
        ? decimalToMinor(raw.Amount, exponent)
        : null;
    if (amount === null || amount <= 0) return fault(400, 'amount');
    if (detail?.PostingType !== 'Debit' && detail?.PostingType !== 'Credit')
      return fault(400, 'posting_type');
    lines.push({ accountId: account.Id, amountMinor: detail.PostingType === 'Debit' ? amount : -amount });
  }
  // QuickBooks refuses an entry whose debits and credits differ.
  if (lines.reduce((t, l) => t + l.amountMinor, 0) !== 0) return fault(400, 'unbalanced');
  d.seq += 1;
  const id = String(1000 + d.seq);
  d.journals.push({
    externalId: id,
    day: body.TxnDate,
    currency,
    reference: body.DocNumber,
    memo: typeof body.PrivateNote === 'string' ? body.PrivateNote : '',
    lines,
  });
  d.requests[requestId] = id;
  return { status: 200, body: { JournalEntry: { Id: id, SyncToken: '0' } } };
}

export const quickbooksFakeProvider: FakeProvider = {
  accountLabel: 'Sandbox Company (QuickBooks)',
  seed: (): QboData => ({
    seq: 0,
    homeCurrency: 'USD',
    accounts: QUICKBOOKS_FAKE_ACCOUNTS.map((a) => ({ ...a })),
    journals: [],
    requests: {},
  }),
  handle(account, req): ProviderResponse {
    const d = qbo(account);
    if (req.method === 'GET' && req.path === '/query') {
      const q = req.query?.query ?? '';
      if (!/^select \* from Account\b/i.test(q)) return fault(400, 'query');
      const activeOnly = /Active\s*=\s*true/i.test(q);
      return {
        status: 200,
        body: { QueryResponse: { Account: d.accounts.filter((a) => !activeOnly || a.Active) } },
      };
    }
    if (req.method === 'POST' && req.path === '/journalentry') return postEntry(d, req);
    return { status: 404, body: { Fault: { type: 'NotFound' } } };
  },
};

export const quickbooksConnector = defineConnector({
  key: 'quickbooks',
  name: 'QuickBooks Online',
  providerConfigKey: 'quickbooks',
  scopes: ['com.intuit.quickbooks.accounting'],
  entitlement: 'integrations',
  availability: 'general',
  fake: quickbooksFakeProvider,
  objects: [],
  accounting: {
    async listAccounts(io) {
      const res = await io.client.request({
        method: 'GET',
        path: '/query',
        query: { query: 'select * from Account where Active = true maxresults 1000', minorversion: '75' },
      });
      const list = ((res.body as { QueryResponse?: { Account?: unknown[] } } | null)?.QueryResponse
        ?.Account ?? []) as Partial<QboAccount>[];
      return list.flatMap((a): ProviderAccount[] =>
        typeof a.Id === 'string' && typeof a.Name === 'string' && a.Active !== false
          ? [
              {
                id: a.Id.slice(0, 100),
                code: typeof a.AcctNum === 'string' && a.AcctNum ? a.AcctNum.slice(0, 40) : null,
                name: a.Name.slice(0, 200),
                type: typeof a.AccountType === 'string' ? a.AccountType.slice(0, 60) : '',
              },
            ]
          : [],
      );
    },
    async postJournal(io, j) {
      const res = await io.client.request({
        method: 'POST',
        path: '/journalentry',
        query: { requestid: j.idempotencyKey, minorversion: '75' },
        idempotencyKey: j.idempotencyKey,
        body: {
          TxnDate: j.day,
          DocNumber: j.reference,
          PrivateNote: j.memo,
          CurrencyRef: { value: j.currency },
          Line: j.lines.map((l) => ({
            Description: l.description,
            Amount: Number(minorToDecimal(Math.abs(l.amountMinor), j.exponent)),
            DetailType: 'JournalEntryLineDetail',
            JournalEntryLineDetail: {
              PostingType: l.amountMinor > 0 ? 'Debit' : 'Credit',
              AccountRef: { value: l.accountId },
            },
          })),
        },
      });
      const id = (res.body as { JournalEntry?: { Id?: unknown } } | null)?.JournalEntry?.Id;
      if (typeof id !== 'string' || !id) throw new ProviderError(502, 'no_id');
      return { externalId: id.slice(0, 255) };
    },
  },
});
