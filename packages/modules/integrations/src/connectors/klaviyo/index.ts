import { defineListConnector, type ListApi } from '../../audience/list-connector.ts';
import type { RemoteRecord } from '../../sdk/connector.ts';
import { klaviyoFakeProvider } from './fake.ts';

/**
 * Klaviyo (M6.4d) through the `IntegrationAuth` port (Nango's `klaviyo-oauth` integration). An
 * audience is pushed to a Klaviyo list (profile import, then a subscribe job with the list);
 * unsubscribes and suppressions (hard bounce, spam complaint, user suppressed) come back as
 * consent changes. Email consent is per profile in Klaviyo, so an unsubscribe there is an
 * unsubscribe from every list.
 */

const PAGE = 100;
const SUBSCRIPTIONS = { 'additional-fields[profile]': 'subscriptions' };

/** The consent change a profile's email marketing subscription says, Klaviyo-free. */
export function klaviyoStatus(marketing: { consent?: unknown; suppression?: unknown } | undefined): string {
  const reasons = Array.isArray(marketing?.suppression)
    ? (marketing.suppression as { reason?: unknown }[]).map((s) => s.reason)
    : [];
  if (reasons.includes('SPAM_COMPLAINT')) return 'complained';
  if (reasons.includes('HARD_BOUNCE')) return 'cleaned';
  if (reasons.includes('USER_SUPPRESSED') || marketing?.consent === 'UNSUBSCRIBED') return 'unsubscribed';
  return marketing?.consent === 'SUBSCRIBED' ? 'subscribed' : 'never_subscribed';
}

/** A Klaviyo profile resource as the API returns it (see `tests/fixtures/klaviyo.json`). */
export function parseKlaviyoProfile(raw: unknown): RemoteRecord | null {
  const p = raw as { id?: unknown; attributes?: Record<string, unknown> } | null;
  const a = p?.attributes;
  if (!p || typeof p.id !== 'string' || !a || typeof a.email !== 'string') return null;
  const updated = typeof a.updated === 'string' ? a.updated : null;
  const at = updated ? new Date(updated) : null;
  const subs = a.subscriptions as { email?: { marketing?: { consent?: unknown; suppression?: unknown } } } | undefined;
  return {
    id: p.id,
    version: updated ?? 'unknown',
    updatedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    origin: null,
    fields: {
      email: a.email,
      first_name: a.first_name ?? null,
      last_name: a.last_name ?? null,
      phone_number: a.phone_number ?? null,
      organization: a.organization ?? null,
      consent_status: klaviyoStatus(subs?.email?.marketing),
    },
  };
}

const notFound = (err: unknown) => (err as { status?: number }).status === 404;

export const klaviyoApi: ListApi = {
  async lists(io) {
    const res = await io.client.request({ method: 'GET', path: '/api/lists' });
    const lists = ((res.body as { data?: unknown[] }).data ?? []) as { id?: unknown; attributes?: { name?: unknown } }[];
    return lists.flatMap((l) =>
      typeof l.id === 'string' && typeof l.attributes?.name === 'string' ? [{ id: l.id, name: l.attributes.name }] : [],
    );
  },
  async changes(io, listId, cursor) {
    const res = await io.client.request({
      method: 'GET',
      path: `/api/lists/${listId}/profiles`,
      query: {
        ...SUBSCRIPTIONS,
        sort: 'updated',
        'page[size]': String(PAGE),
        ...(cursor ? { filter: `greater-than(updated,${cursor})` } : {}),
      },
    });
    const body = res.body as { data?: unknown[]; links?: { next?: unknown } };
    const records = (body.data ?? []).map(parseKlaviyoProfile).filter((r): r is RemoteRecord => r !== null);
    const last = records[records.length - 1];
    return { records, cursor: last ? last.version : null, hasMore: typeof body.links?.next === 'string' };
  },
  async member(io, _listId, externalId) {
    try {
      return parseKlaviyoProfile(
        ((await io.client.request({ method: 'GET', path: `/api/profiles/${externalId}`, query: SUBSCRIPTIONS }))
          .body as { data?: unknown }).data,
      );
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  },
  async upsert(io, listId, input) {
    const job = (kind: 'create' | 'delete') =>
      io.client.request({
        method: 'POST',
        path: `/api/profile-subscription-bulk-${kind}-jobs`,
        body: {
          data: {
            type: `profile-subscription-bulk-${kind}-job`,
            attributes: {
              profiles: {
                data: [
                  {
                    type: 'profile',
                    attributes: {
                      email: input.email,
                      ...(kind === 'create'
                        ? { subscriptions: { email: { marketing: { consent: 'SUBSCRIBED' } } } }
                        : {}),
                    },
                  },
                ],
              },
            },
            relationships: { list: { data: { type: 'list', id: listId } } },
          },
        },
        idempotencyKey: `${input.idempotencyKey}-${kind}`,
      });
    if (input.status === 'archived') {
      if (!input.externalId) throw new Error('Only a member can leave the list');
      await io.client.request({
        method: 'DELETE',
        path: `/api/lists/${listId}/relationships/profiles`,
        body: { data: [{ type: 'profile', id: input.externalId }] },
        idempotencyKey: input.idempotencyKey,
      });
      return { externalId: input.externalId, version: `archived:${input.idempotencyKey}` };
    }
    const attributes: Record<string, unknown> = { email: input.email };
    for (const [k, v] of Object.entries(input.mergeFields))
      if (v !== null && v !== undefined && v !== '') attributes[k] = v;
    const imported = parseKlaviyoProfile(
      (
        (
          await io.client.request({
            method: 'POST',
            path: '/api/profile-import',
            body: { data: { type: 'profile', attributes } },
            idempotencyKey: input.idempotencyKey,
          })
        ).body as { data?: unknown }
      ).data,
    );
    if (!imported) throw new Error('Klaviyo answered without a profile');
    await job(input.status === 'subscribed' ? 'create' : 'delete');
    const after = await klaviyoApi.member(io, listId, imported.id);
    return { externalId: imported.id, version: after?.version ?? imported.version };
  },
};

export const klaviyoConnector = defineListConnector({
  key: 'klaviyo',
  name: 'Klaviyo',
  providerConfigKey: 'klaviyo',
  scopes: ['lists:write', 'profiles:write', 'subscriptions:write'],
  api: klaviyoApi,
  fake: klaviyoFakeProvider,
  emailField: 'email',
  statusField: 'consent_status',
  remoteFields: [
    { key: 'email', label: 'email', type: 'email', required: true },
    { key: 'first_name', label: 'first_name', type: 'string' },
    { key: 'last_name', label: 'last_name', type: 'string' },
    { key: 'phone_number', label: 'phone_number', type: 'string' },
    { key: 'organization', label: 'organization', type: 'string' },
    { key: 'consent_status', label: 'consent_status', type: 'string' },
  ],
  pushMapping: [
    { source: 'email', target: 'email', transform: 'lowercase', default: null },
    { source: 'first_name', target: 'first_name', transform: 'none', default: null },
    { source: 'last_name', target: 'last_name', transform: 'none', default: null },
    { source: 'company', target: 'organization', transform: 'none', default: null },
  ],
});
