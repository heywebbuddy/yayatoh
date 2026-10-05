import { contactSyncRowTx, contactsChangedSinceTx, writeSyncedContactTx } from '@yayatoh/crm';
import type { FakeAccount, FakeProvider } from '../auth/fake.ts';
import type { ProviderRequest, ProviderResponse } from '../auth/port.ts';
import { defineConnector, type LocalRecord, type RemoteRecord, type SyncIO } from '../sdk/connector.ts';

/**
 * The demo connector (M6.4a): a contacts list at a fake provider, synced both ways with CRM
 * contacts. It exists to prove the framework end to end against the fake (connect, map, pull,
 * push, loop guard, errors inbox, revoke) and as the template M6.4b–d copy. Offered only where
 * the auth port is the fake.
 *
 * The fake API: `GET /v1/contacts?since=&limit=` (records changed after a sequence number),
 * `GET /v1/contacts/{id}`, `POST /v1/contacts` and `PATCH /v1/contacts/{id}` (with an
 * `Idempotency-Key`; the body's `origin` is kept on the record, the loop-guard stamp).
 */

interface DemoRecord {
  id: string;
  seq: number;
  updatedAt: string;
  origin: string | null;
  fields: Record<string, unknown>;
}

interface DemoData {
  seq: number;
  records: DemoRecord[];
  /** Idempotency-Key → the write's result. */
  keys: Record<string, { id: string; version: string }>;
}

/** The fake account's seed: three good contacts and one the default mapping rejects. */
export const DEMO_SEED: readonly { readonly id: string; readonly fields: Record<string, unknown> }[] = [
  {
    id: 'dc_1',
    fields: {
      email_address: 'Ada.Lovelace@demo-remote.test',
      full_name: 'Ada Lovelace',
      company: 'Analytical',
    },
  },
  {
    id: 'dc_2',
    fields: { email_address: 'grace.hopper@demo-remote.test', full_name: '  Grace Hopper ', company: 'Navy' },
  },
  {
    id: 'dc_3',
    fields: {
      email_address: 'katherine.johnson@demo-remote.test',
      full_name: 'Katherine Johnson',
      company: 'NASA',
    },
  },
  // An address the mapping cannot accept: lands in the errors inbox until it is fixed at the source.
  { id: 'dc_4', fields: { email_address: 'broken-record', full_name: 'Broken Record', company: 'Nowhere' } },
];
export const DEMO_BAD_RECORD = 'dc_4';

const view = (r: DemoRecord): Record<string, unknown> & { id: string; version: string } => ({
  id: r.id,
  version: String(r.seq),
  updated_at: r.updatedAt,
  origin: r.origin,
  ...r.fields,
});

function demoData(a: FakeAccount): DemoData {
  return a.data as DemoData;
}

/** Change a record at the fake provider (dev route and tests: "the organizer fixed it there"). */
export function demoRemoteUpdate(
  a: FakeAccount,
  id: string,
  fields: Record<string, unknown>,
  now = new Date(),
) {
  const d = demoData(a);
  let r = d.records.find((x) => x.id === id);
  d.seq += 1;
  if (!r) {
    r = { id, seq: d.seq, updatedAt: now.toISOString(), origin: null, fields: {} };
    d.records.push(r);
  }
  r.fields = { ...r.fields, ...fields };
  r.seq = d.seq;
  r.updatedAt = now.toISOString();
  r.origin = null;
  return view(r);
}

/** The fake provider's records (dev route and tests). */
export const demoRemoteRecords = (a: FakeAccount) => demoData(a).records.map(view);

const WRITABLE = new Set(['email_address', 'full_name', 'company']);

export const demoFakeProvider: FakeProvider = {
  accountLabel: 'Demo CRM (sandbox)',
  seed: (): DemoData => ({
    seq: DEMO_SEED.length,
    records: DEMO_SEED.map((r, i) => ({
      id: r.id,
      seq: i + 1,
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      origin: null,
      fields: { ...r.fields },
    })),
    keys: {},
  }),
  handle(account, req: ProviderRequest): ProviderResponse {
    const d = demoData(account);
    const m = /^\/v1\/contacts(?:\/([A-Za-z0-9_-]+))?$/.exec(req.path);
    if (!m) return { status: 404, body: { error: 'not_found' } };
    const id = m[1];
    if (req.method === 'GET' && !id) {
      const since = Number(req.query?.since ?? 0);
      const limit = Math.min(100, Math.max(1, Number(req.query?.limit ?? 50)));
      const changed = d.records.filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      const page = changed.slice(0, limit);
      return {
        status: 200,
        body: {
          data: page.map(view),
          next: page.length ? String(page[page.length - 1]?.seq) : null,
          has_more: changed.length > page.length,
        },
      };
    }
    if (req.method === 'GET' && id) {
      const r = d.records.find((x) => x.id === id);
      return r ? { status: 200, body: view(r) } : { status: 404, body: { error: 'not_found' } };
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      const key = req.idempotencyKey;
      if (key && d.keys[key]) return { status: 200, body: d.keys[key] };
      const body = (req.body ?? {}) as { fields?: Record<string, unknown>; origin?: unknown };
      const fields = Object.fromEntries(Object.entries(body.fields ?? {}).filter(([k]) => WRITABLE.has(k)));
      let r = id ? d.records.find((x) => x.id === id) : undefined;
      if (id && !r) return { status: 404, body: { error: 'not_found' } };
      d.seq += 1;
      if (!r) {
        r = {
          id: `dc_${d.seq}_${crypto.randomUUID().slice(0, 8)}`,
          seq: d.seq,
          updatedAt: '',
          origin: null,
          fields: {},
        };
        d.records.push(r);
      }
      r.fields = { ...r.fields, ...fields };
      r.seq = d.seq;
      r.updatedAt = new Date().toISOString();
      r.origin = typeof body.origin === 'string' ? body.origin.slice(0, 100) : null;
      const out = { id: r.id, version: String(r.seq) };
      if (key) d.keys[key] = out;
      return { status: id ? 200 : 201, body: out };
    }
    return { status: 405, body: { error: 'method_not_allowed' } };
  },
};

const asRecord = (raw: unknown): RemoteRecord | null => {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.id !== 'string' || typeof r.version !== 'string') return null;
  const { id, version, updated_at, origin, ...fields } = r;
  const at = typeof updated_at === 'string' ? new Date(updated_at) : null;
  return {
    id,
    version,
    updatedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    origin: typeof origin === 'string' ? origin : null,
    fields,
  };
};

const toLocal = (c: { id: string; email: string; name: string | null; updatedAt: Date }): LocalRecord => ({
  id: c.id,
  updatedAt: c.updatedAt,
  fields: { email: c.email, name: c.name },
});

export const demoConnector = defineConnector({
  key: 'demo',
  name: 'Demo CRM',
  providerConfigKey: 'demo',
  scopes: ['contacts.read', 'contacts.write'],
  entitlement: 'integrations',
  availability: 'fake_only',
  fake: demoFakeProvider,
  objects: [
    {
      key: 'contacts',
      remoteFields: [
        { key: 'email_address', label: 'email_address', type: 'string' },
        { key: 'full_name', label: 'full_name', type: 'string' },
        { key: 'company', label: 'company', type: 'string' },
      ],
      localFields: [
        { key: 'email', label: 'email', type: 'email', required: true },
        { key: 'name', label: 'name', type: 'string' },
      ],
      pull: {
        defaultMapping: [
          { source: 'email_address', target: 'email', transform: 'lowercase', default: null },
          { source: 'full_name', target: 'name', transform: 'trim', default: null },
        ],
        async list(io: SyncIO, cursor) {
          const res = await io.client.request({
            method: 'GET',
            path: '/v1/contacts',
            query: { since: cursor ?? '0', limit: '50' },
          });
          const body = res.body as { data?: unknown[]; next?: unknown; has_more?: unknown };
          return {
            records: (body.data ?? []).map(asRecord).filter((r): r is RemoteRecord => r !== null),
            cursor: typeof body.next === 'string' ? body.next : null,
            hasMore: body.has_more === true,
          };
        },
        async get(io, externalId) {
          try {
            return asRecord(
              (await io.client.request({ method: 'GET', path: `/v1/contacts/${externalId}` })).body,
            );
          } catch (err) {
            if ((err as { status?: number }).status === 404) return null;
            throw err;
          }
        },
        async write(tx, ctx, values, localId) {
          return {
            localId: await writeSyncedContactTx(tx, ctx, {
              contactId: localId,
              email: String(values.email),
              name: typeof values.name === 'string' && values.name ? values.name : null,
            }),
          };
        },
      },
      push: {
        defaultMapping: [
          { source: 'email', target: 'email_address', transform: 'none', default: null },
          { source: 'name', target: 'full_name', transform: 'none', default: null },
        ],
        async changes(tx, cursor, limit) {
          const rows = await contactsChangedSinceTx(tx, cursor, limit);
          return {
            records: rows.map(toLocal),
            cursor: rows[rows.length - 1]?.cursor ?? null,
            hasMore: rows.length === limit,
          };
        },
        async read(tx, localId) {
          const c = await contactSyncRowTx(tx, localId);
          return c ? toLocal(c) : null;
        },
        async send(io, input) {
          const res = await io.client.request({
            method: input.externalId ? 'PATCH' : 'POST',
            path: input.externalId ? `/v1/contacts/${input.externalId}` : '/v1/contacts',
            body: { fields: input.values, origin: io.origin },
            idempotencyKey: input.idempotencyKey,
          });
          const out = res.body as { id?: unknown; version?: unknown };
          if (typeof out.id !== 'string' || typeof out.version !== 'string')
            throw new Error('The provider answered without an id');
          return { externalId: out.id, version: out.version };
        },
      },
    },
  ],
});
