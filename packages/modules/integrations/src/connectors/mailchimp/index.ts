import { defineListConnector, type ListApi } from '../../audience/list-connector.ts';
import type { RemoteRecord } from '../../sdk/connector.ts';
import { mailchimpFakeProvider, subscriberHash } from './fake.ts';

/**
 * Mailchimp (M6.4d) through the `IntegrationAuth` port (Nango's `mailchimp` integration proxies
 * the account's data-centre API). An audience is pushed to a Mailchimp audience ("list") with
 * merge fields; unsubscribes, cleaned addresses and complaints come back as consent changes.
 * Member ids are Mailchimp's subscriber hashes (md5 of the lower-case address).
 */

const PAGE = 100;

/** A Mailchimp list member as the API returns it (see `fixtures/mailchimp.json`). */
export function parseMailchimpMember(raw: unknown): RemoteRecord | null {
  const m = raw as Record<string, unknown> | null;
  if (!m || typeof m.id !== 'string' || typeof m.email_address !== 'string') return null;
  const changed = typeof m.last_changed === 'string' ? m.last_changed : null;
  const at = changed ? new Date(changed) : null;
  const merge = (m.merge_fields ?? {}) as Record<string, unknown>;
  return {
    id: m.id,
    version: changed ?? 'unknown',
    updatedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    origin: null,
    fields: {
      email_address: m.email_address,
      // Mailchimp's own word for a complaint-unsubscribe is still `unsubscribed`; `cleaned` is a bounce.
      status: typeof m.status === 'string' ? m.status : null,
      fname: merge.FNAME ?? null,
      lname: merge.LNAME ?? null,
      phone: merge.PHONE ?? null,
      company: merge.COMPANY ?? null,
    },
  };
}

const notFound = (err: unknown) => (err as { status?: number }).status === 404;

export const mailchimpApi: ListApi = {
  async lists(io) {
    const res = await io.client.request({ method: 'GET', path: '/3.0/lists', query: { count: '100' } });
    const lists = ((res.body as { lists?: unknown[] }).lists ?? []) as { id?: unknown; name?: unknown }[];
    return lists.flatMap((l) =>
      typeof l.id === 'string' && typeof l.name === 'string' ? [{ id: l.id, name: l.name }] : [],
    );
  },
  async changes(io, listId, cursor) {
    const res = await io.client.request({
      method: 'GET',
      path: `/3.0/lists/${listId}/members`,
      query: {
        count: String(PAGE),
        sort_field: 'last_changed',
        sort_dir: 'ASC',
        ...(cursor ? { since_last_changed: cursor } : {}),
      },
    });
    const body = res.body as { members?: unknown[]; total_items?: unknown };
    const records = (body.members ?? []).map(parseMailchimpMember).filter((r): r is RemoteRecord => r !== null);
    const last = records[records.length - 1];
    return {
      records,
      cursor: last ? last.version : null,
      hasMore: typeof body.total_items === 'number' && body.total_items > records.length,
    };
  },
  async member(io, listId, externalId) {
    try {
      return parseMailchimpMember(
        (await io.client.request({ method: 'GET', path: `/3.0/lists/${listId}/members/${externalId}` })).body,
      );
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  },
  async upsert(io, listId, input) {
    const hash = input.externalId ?? subscriberHash(input.email);
    if (input.status === 'archived') {
      await io.client.request({
        method: 'DELETE',
        path: `/3.0/lists/${listId}/members/${hash}`,
        idempotencyKey: input.idempotencyKey,
      });
      return { externalId: hash, version: `archived:${input.idempotencyKey}` };
    }
    const merge: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input.mergeFields))
      if (v !== null && v !== undefined && v !== '') merge[k.toUpperCase()] = v;
    const res = await io.client.request({
      method: 'PUT',
      path: `/3.0/lists/${listId}/members/${hash}`,
      body: {
        email_address: input.email,
        status_if_new: input.status,
        status: input.status,
        merge_fields: merge,
      },
      idempotencyKey: input.idempotencyKey,
    });
    const out = parseMailchimpMember(res.body);
    if (!out) throw new Error('Mailchimp answered without a member');
    return { externalId: out.id, version: out.version };
  },
};

export const mailchimpConnector = defineListConnector({
  key: 'mailchimp',
  name: 'Mailchimp',
  providerConfigKey: 'mailchimp',
  scopes: [],
  api: mailchimpApi,
  fake: mailchimpFakeProvider,
  emailField: 'email_address',
  statusField: 'status',
  remoteFields: [
    { key: 'email_address', label: 'email_address', type: 'email', required: true },
    { key: 'fname', label: 'FNAME', type: 'string' },
    { key: 'lname', label: 'LNAME', type: 'string' },
    { key: 'phone', label: 'PHONE', type: 'string' },
    { key: 'company', label: 'COMPANY', type: 'string' },
    { key: 'status', label: 'status', type: 'string' },
  ],
  pushMapping: [
    { source: 'email', target: 'email_address', transform: 'lowercase', default: null },
    { source: 'first_name', target: 'fname', transform: 'none', default: null },
    { source: 'last_name', target: 'lname', transform: 'none', default: null },
  ],
});
