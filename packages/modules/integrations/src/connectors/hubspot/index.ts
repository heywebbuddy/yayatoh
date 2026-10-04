import {
  type ParticipationSyncRow,
  participationByIdTx,
  participationsAfterTx,
  setSyncedContactCompanyTx,
  writeSyncedContactTx,
} from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { type EventSyncRow, eventForSyncTx, eventsForSyncAfterTx } from '@yayatoh/events';
import { requireOrg } from '@yayatoh/kernel';
import { and, eq, inArray } from 'drizzle-orm';
import { hubspotContactAction } from '../../audience/consent.ts';
import { applyInboundChangeTx } from '../../audience/inbound.ts';
import {
  audienceIdsAfterTx,
  audienceWhereTx,
  contactStatesTx,
  linkedAmongTx,
  linkedLocalIdsAfterTx,
  linkPulledTx,
  liveConnectionIdTx,
  mergeIds,
} from '../../audience/state.ts';
import { connections, recordLinks } from '../../schema.ts';
import {
  defineConnector,
  type LocalRecord,
  type Page,
  type RemoteRecord,
  type SyncIO,
} from '../../sdk/connector.ts';
import { hubspotFakeProvider } from './fake.ts';

/**
 * HubSpot (M6.4d) through the `IntegrationAuth` port (Nango's `hubspot` integration):
 * - `contacts`, both ways with field mapping. The pull brings HubSpot contacts in (never with
 *   consent) and turns an opt-out (`hs_email_optout`) into a withdrawn consent and a suppression;
 *   the push creates or updates contacts with email marketing consent, updates contacts HubSpot
 *   already has, and sends an opt-out through the communication preferences API when the person
 *   said no here. Anyone else is never sent.
 * - `marketing_events`: every event that is not a draft, as a HubSpot marketing event keyed by our
 *   event id (`externalEventId`); a cancellation is sent once the event is there.
 * - `event_attendance`: registration (`register`), check-in (`attend`) and cancellation
 *   (`cancel`) per contact and pushed event, for contacts with email marketing consent only.
 */

export const HUBSPOT_ACCOUNT = 'yayatoh';
const PAGE = 100;
const CONTACT_PROPERTIES = [
  'email',
  'firstname',
  'lastname',
  'company',
  'phone',
  'hs_email_optout',
  'lastmodifieddate',
  'yayatoh_origin',
];

/** A HubSpot CRM contact as the API returns it (see `tests/fixtures/hubspot.json`). */
export function parseHubspotContact(raw: unknown): RemoteRecord | null {
  const c = raw as { id?: unknown; properties?: Record<string, unknown>; updatedAt?: unknown } | null;
  const p = c?.properties;
  if (!c || typeof c.id !== 'string' || !p) return null;
  const modified = typeof p.lastmodifieddate === 'string' ? p.lastmodifieddate : null;
  const at = modified ? new Date(modified) : null;
  return {
    id: c.id,
    version: modified ?? (typeof c.updatedAt === 'string' ? c.updatedAt : 'unknown'),
    updatedAt: at && !Number.isNaN(at.getTime()) ? at : null,
    origin: typeof p.yayatoh_origin === 'string' && p.yayatoh_origin ? p.yayatoh_origin : null,
    fields: {
      email: p.email ?? null,
      firstname: p.firstname ?? null,
      lastname: p.lastname ?? null,
      company: p.company ?? null,
      phone: p.phone ?? null,
      hs_email_optout: p.hs_email_optout ?? 'false',
    },
  };
}

const notFound = (err: unknown) => (err as { status?: number }).status === 404;

async function getContact(io: SyncIO, id: string): Promise<RemoteRecord | null> {
  try {
    return parseHubspotContact(
      (
        await io.client.request({
          method: 'GET',
          path: `/crm/v3/objects/contacts/${id}`,
          query: { properties: CONTACT_PROPERTIES.join(',') },
        })
      ).body,
    );
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Contact records for a HubSpot push (null: not sent; see `hubspotContactAction`). */
async function contactRecordsTx(tx: TenantTx, connectionId: string, ids: readonly string[]) {
  const [states, linked] = await Promise.all([
    contactStatesTx(tx, ids),
    linkedAmongTx(tx, connectionId, 'contacts', ids),
  ]);
  const out: LocalRecord[] = [];
  for (const id of ids) {
    const c = states.get(id);
    if (!c) continue;
    const action = hubspotContactAction({ status: c.status, linked: linked.has(id) });
    if (!action) continue;
    const words = (c.name ?? '').trim().split(/\s+/).filter(Boolean);
    out.push({
      id,
      updatedAt: c.updatedAt,
      fields: {
        email: c.email,
        name: c.name,
        first_name: words[0] ?? null,
        last_name: words.length > 1 ? words.slice(1).join(' ') : null,
        company: c.company,
        phone: c.phone,
        email_opt_out: c.status === 'unsubscribed',
        action,
      },
    });
  }
  return out;
}

/** Walk candidates in id order and keep the ones that are sent; '' at the end (start over). */
async function walk(
  next: (after: string | null) => Promise<string[]>,
  records: (ids: readonly string[]) => Promise<LocalRecord[]>,
  cursor: string | null,
  limit: number,
): Promise<Page<LocalRecord>> {
  let after = cursor || null;
  let wrapped = after === null;
  for (let scanned = 0; scanned < 20_000; ) {
    const ids = await next(after);
    const more = ids.length >= limit;
    if (ids.length) {
      scanned += ids.length;
      const out = await records(ids);
      const last = ids[ids.length - 1] as string;
      if (out.length) return { records: out, cursor: more ? last : '', hasMore: more };
      if (more) {
        after = last;
        continue;
      }
    }
    if (wrapped) break;
    after = null;
    wrapped = true;
  }
  return { records: [], cursor: '', hasMore: false };
}

/** HubSpot's marketing event properties (camelCase) from mapped values (snake_case keys). */
const camel = (k: string) => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

function eventRecord(e: EventSyncRow): LocalRecord {
  return {
    id: e.id,
    updatedAt: e.updatedAt,
    fields: {
      name: e.name,
      starts_at: e.startsAt.toISOString(),
      ends_at: e.endsAt.toISOString(),
      timezone: e.timezone,
      venue: [e.venueName, e.city].filter(Boolean).join(', ') || null,
      cancelled: e.status === 'cancelled',
    },
  };
}

async function eventRecordsTx(tx: TenantTx, connectionId: string, rows: readonly EventSyncRow[]) {
  const linked = await linkedAmongTx(
    tx,
    connectionId,
    'marketing_events',
    rows.map((r) => r.id),
  );
  // A cancelled event is sent only once it is in HubSpot (to mark it cancelled there).
  return rows.filter((r) => r.status !== 'cancelled' || linked.has(r.id)).map(eventRecord);
}

/** The attendance key HubSpot holds for one contact at one event. */
const attendanceKey = (eventId: string, contactId: string) => `${eventId}:${contactId}`;

async function attendanceRecordsTx(
  tx: TenantTx,
  connectionId: string,
  ids: readonly string[],
  known: ReadonlyMap<string, ParticipationSyncRow>,
): Promise<LocalRecord[]> {
  const rows = new Map(known);
  for (const id of ids)
    if (!rows.has(id)) {
      const r = await participationByIdTx(tx, id);
      if (r) rows.set(id, r);
    }
  const links = ids.length
    ? await tx
        .select({ localId: recordLinks.localId, externalId: recordLinks.externalId })
        .from(recordLinks)
        .where(
          and(
            eq(recordLinks.connectionId, connectionId),
            eq(recordLinks.objectType, 'event_attendance'),
            inArray(recordLinks.localId, [...ids]),
          ),
        )
    : [];
  const linkOf = new Map(links.map((l) => [l.localId, l.externalId]));
  type Pair = { id: string; eventId: string; contactId: string; row: ParticipationSyncRow | null };
  const pairs = ids.flatMap((id): Pair[] => {
    const r = rows.get(id);
    if (r) return [{ id, eventId: r.eventId, contactId: r.contactId, row: r }];
    // The participation is gone (the person no longer takes part): HubSpot gets a cancel.
    const [eventId, contactId] = (linkOf.get(id) ?? '').split(':');
    return eventId && contactId ? [{ id, eventId, contactId, row: null }] : [];
  });
  const states = await contactStatesTx(
    tx,
    pairs.map((p) => p.contactId),
  );
  const out: LocalRecord[] = [];
  for (const p of pairs) {
    const c = states.get(p.contactId);
    // Consent first: attendance is sent only for contacts with email marketing consent.
    if (c?.status !== 'subscribed') continue;
    const state = p.row?.checkedIn ? 'attend' : p.row?.registered ? 'register' : 'cancel';
    if (state === 'cancel' && !linkOf.has(p.id)) continue;
    out.push({
      id: p.id,
      updatedAt: p.row?.updatedAt ?? c.updatedAt,
      fields: { email: c.email, contact_id: p.contactId, event_id: p.eventId, state },
    });
  }
  return out;
}

async function pushedEventIdsTx(tx: TenantTx, connectionId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: recordLinks.localId })
    .from(recordLinks)
    .where(and(eq(recordLinks.connectionId, connectionId), eq(recordLinks.objectType, 'marketing_events')));
  return rows.map((r) => r.id);
}

export const hubspotConnector = defineConnector({
  key: 'hubspot',
  name: 'HubSpot',
  providerConfigKey: 'hubspot',
  scopes: [
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
    'crm.objects.marketing_events.read',
    'crm.objects.marketing_events.write',
    'communication_preferences.write',
  ],
  entitlement: 'integrations',
  availability: 'general',
  fake: hubspotFakeProvider,
  loadScope: async (tx, connectionId) => {
    const [row] = await tx
      .select({ orgId: connections.orgId })
      .from(connections)
      .where(eq(connections.id, connectionId));
    return { orgId: row?.orgId ?? null };
  },
  objects: [
    {
      key: 'contacts',
      remoteFields: [
        { key: 'email', label: 'email', type: 'email', required: true },
        { key: 'firstname', label: 'firstname', type: 'string' },
        { key: 'lastname', label: 'lastname', type: 'string' },
        { key: 'company', label: 'company', type: 'string' },
        { key: 'phone', label: 'phone', type: 'string' },
        { key: 'hs_email_optout', label: 'hs_email_optout', type: 'boolean' },
      ],
      localFields: [
        { key: 'email', label: 'email', type: 'email', required: true },
        { key: 'name', label: 'name', type: 'string' },
        { key: 'first_name', label: 'first_name', type: 'string' },
        { key: 'last_name', label: 'last_name', type: 'string' },
        { key: 'company', label: 'company', type: 'string' },
        { key: 'phone', label: 'phone', type: 'string' },
        { key: 'email_opt_out', label: 'email_opt_out', type: 'boolean' },
      ],
      pull: {
        defaultMapping: [
          { source: 'email', target: 'email', transform: 'lowercase', default: null },
          { source: 'firstname', target: 'first_name', transform: 'trim', default: null },
          { source: 'lastname', target: 'last_name', transform: 'trim', default: null },
          { source: 'company', target: 'company', transform: 'trim', default: null },
          { source: 'hs_email_optout', target: 'email_opt_out', transform: 'to_boolean', default: 'false' },
        ],
        async list(io, cursor) {
          const res = await io.client.request({
            method: 'POST',
            path: '/crm/v3/objects/contacts/search',
            body: {
              filterGroups: [
                {
                  filters: [
                    {
                      propertyName: 'lastmodifieddate',
                      operator: 'GT',
                      value: String(cursor ? Date.parse(cursor) : 0),
                    },
                  ],
                },
              ],
              sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
              properties: CONTACT_PROPERTIES,
              limit: PAGE,
            },
          });
          const body = res.body as { results?: unknown[]; total?: unknown };
          const records = (body.results ?? [])
            .map(parseHubspotContact)
            .filter((r): r is RemoteRecord => r !== null);
          const last = records[records.length - 1];
          return {
            records,
            cursor: last?.updatedAt ? last.updatedAt.toISOString() : null,
            hasMore: typeof body.total === 'number' && body.total > records.length,
          };
        },
        get: getContact,
        async write(tx, ctx, values, localId, meta) {
          const email = String(values.email);
          const name =
            str(values.name) ??
            ([str(values.first_name), str(values.last_name)].filter(Boolean).join(' ') || null);
          const contactId = await writeSyncedContactTx(tx, ctx, { contactId: localId, email, name });
          await setSyncedContactCompanyTx(tx, ctx, contactId, str(values.company));
          // An opt-out in HubSpot withdraws consent here; an opt-in never grants it.
          if (values.email_opt_out === true)
            await applyInboundChangeTx(tx, ctx, {
              connector: 'hubspot',
              connectionId: meta.connectionId,
              contactId,
              email,
              change: 'unsubscribed',
              externalId: meta.record.id,
              remoteVersion: meta.record.version,
            });
          await linkPulledTx(tx, requireOrg(ctx), {
            connectionId: meta.connectionId,
            objectType: 'contacts',
            externalId: meta.record.id,
            localId: contactId,
            remoteVersion: meta.record.version,
            now: ctx.now,
          });
          return { localId: contactId };
        },
      },
      push: {
        defaultMapping: [
          { source: 'email', target: 'email', transform: 'lowercase', default: null },
          { source: 'first_name', target: 'firstname', transform: 'none', default: null },
          { source: 'last_name', target: 'lastname', transform: 'none', default: null },
          { source: 'company', target: 'company', transform: 'none', default: null },
        ],
        async changes(tx, cursor, limit, meta) {
          const orgId = typeof meta.scope.orgId === 'string' ? meta.scope.orgId : null;
          const where = orgId ? await audienceWhereTx(tx, orgId, null) : null;
          return walk(
            async (after) =>
              mergeIds(
                // Consented contacts (where none is known yet: none) ∪ contacts HubSpot already has.
                await audienceIdsAfterTx(tx, where, after, limit),
                await linkedLocalIdsAfterTx(tx, meta.connectionId, 'contacts', after, limit),
                limit,
              ),
            (ids) => contactRecordsTx(tx, meta.connectionId, ids),
            cursor,
            limit,
          );
        },
        async read(tx, localId) {
          const connectionId = await liveConnectionIdTx(tx, 'hubspot');
          if (!connectionId) return null;
          return (await contactRecordsTx(tx, connectionId, [localId]))[0] ?? null;
        },
        async send(io, input) {
          const action = input.local.fields.action;
          if (action === 'opt_out') {
            if (!input.externalId) throw new Error('Only a HubSpot contact can opt out there');
            await io.client.request({
              method: 'POST',
              path: '/communication-preferences/v3/unsubscribe',
              body: {
                emailAddress: String(input.local.fields.email),
                subscriptionId: 'marketing',
                legalBasis: 'LEGITIMATE_INTEREST_CLIENT',
                legalBasisExplanation: 'Unsubscribed in Yayatoh',
                origin: io.origin,
              },
              idempotencyKey: input.idempotencyKey,
            });
            const after = await getContact(io, input.externalId);
            return { externalId: input.externalId, version: after?.version ?? input.idempotencyKey };
          }
          // Opt-outs are read only in HubSpot: never sent as a property.
          const { hs_email_optout: _optout, ...props } = input.values;
          const properties: Record<string, unknown> = { ...props, yayatoh_origin: io.origin };
          if (input.externalId) {
            const res = await io.client.request({
              method: 'PATCH',
              path: `/crm/v3/objects/contacts/${input.externalId}`,
              body: { properties },
              idempotencyKey: input.idempotencyKey,
            });
            const out = parseHubspotContact(res.body);
            if (!out) throw new Error('HubSpot answered without a contact');
            return { externalId: out.id, version: out.version };
          }
          // Defence in depth: only a contact with consent is ever created in HubSpot.
          if (action !== 'upsert') throw new Error('Not eligible for HubSpot');
          const res = await io.client.request({
            method: 'POST',
            path: '/crm/v3/objects/contacts/batch/upsert',
            body: { inputs: [{ idProperty: 'email', id: String(properties.email), properties }] },
            idempotencyKey: input.idempotencyKey,
          });
          const out = parseHubspotContact((res.body as { results?: unknown[] }).results?.[0]);
          if (!out) throw new Error('HubSpot answered without a contact');
          return { externalId: out.id, version: out.version };
        },
      },
    },
    {
      key: 'marketing_events',
      remoteFields: [
        { key: 'event_name', label: 'eventName', type: 'string', required: true },
        { key: 'start_date_time', label: 'startDateTime', type: 'date' },
        { key: 'end_date_time', label: 'endDateTime', type: 'date' },
        { key: 'event_type', label: 'eventType', type: 'string' },
        { key: 'event_organizer', label: 'eventOrganizer', type: 'string' },
        { key: 'event_description', label: 'eventDescription', type: 'string' },
        { key: 'event_cancelled', label: 'eventCancelled', type: 'boolean' },
      ],
      localFields: [
        { key: 'name', label: 'name', type: 'string' },
        { key: 'starts_at', label: 'starts_at', type: 'date' },
        { key: 'ends_at', label: 'ends_at', type: 'date' },
        { key: 'timezone', label: 'timezone', type: 'string' },
        { key: 'venue', label: 'venue', type: 'string' },
        { key: 'cancelled', label: 'cancelled', type: 'boolean' },
      ],
      push: {
        defaultMapping: [
          { source: 'name', target: 'event_name', transform: 'none', default: null },
          { source: 'starts_at', target: 'start_date_time', transform: 'to_date', default: null },
          { source: 'ends_at', target: 'end_date_time', transform: 'to_date', default: null },
          { source: 'venue', target: 'event_description', transform: 'none', default: null },
          { source: 'cancelled', target: 'event_cancelled', transform: 'none', default: null },
        ],
        async changes(tx, cursor, limit, meta) {
          const byId = new Map<string, EventSyncRow>();
          return walk(
            async (after) => {
              const rows = await eventsForSyncAfterTx(tx, after, limit);
              for (const r of rows) byId.set(r.id, r);
              return rows.map((r) => r.id);
            },
            (ids) =>
              eventRecordsTx(
                tx,
                meta.connectionId,
                ids.flatMap((id) => byId.get(id) ?? []),
              ),
            cursor,
            limit,
          );
        },
        async read(tx, localId) {
          const connectionId = await liveConnectionIdTx(tx, 'hubspot');
          const e = await eventForSyncTx(tx, localId);
          if (!connectionId || !e) return null;
          return (await eventRecordsTx(tx, connectionId, [e]))[0] ?? null;
        },
        async send(io, input) {
          const body: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(input.values))
            if (v !== null && v !== undefined) body[camel(k)] = v;
          const query = { externalAccountId: HUBSPOT_ACCOUNT };
          const res = input.externalId
            ? await io.client.request({
                method: 'PATCH',
                path: `/marketing/v3/marketing-events/events/${input.externalId}`,
                query,
                body,
                idempotencyKey: input.idempotencyKey,
              })
            : await io.client.request({
                method: 'POST',
                path: '/marketing/v3/marketing-events/events',
                query,
                body: { ...body, externalEventId: input.local.id, externalAccountId: HUBSPOT_ACCOUNT },
                idempotencyKey: input.idempotencyKey,
              });
          const out = res.body as { updated?: unknown; objectId?: unknown };
          return {
            externalId: input.local.id,
            version: String(out.updated ?? out.objectId ?? input.idempotencyKey),
          };
        },
      },
    },
    {
      key: 'event_attendance',
      remoteFields: [{ key: 'email', label: 'email', type: 'email', required: true }],
      localFields: [{ key: 'email', label: 'email', type: 'email', required: true }],
      push: {
        defaultMapping: [{ source: 'email', target: 'email', transform: 'lowercase', default: null }],
        async changes(tx, cursor, limit, meta) {
          const eventIds = await pushedEventIdsTx(tx, meta.connectionId);
          const known = new Map<string, ParticipationSyncRow>();
          return walk(
            async (after) => {
              const rows = await participationsAfterTx(tx, eventIds, after, limit);
              for (const r of rows) known.set(r.id, r);
              return mergeIds(
                rows.map((r) => r.id),
                await linkedLocalIdsAfterTx(tx, meta.connectionId, 'event_attendance', after, limit),
                limit,
              );
            },
            (ids) => attendanceRecordsTx(tx, meta.connectionId, ids, known),
            cursor,
            limit,
          );
        },
        async read(tx, localId) {
          const connectionId = await liveConnectionIdTx(tx, 'hubspot');
          if (!connectionId) return null;
          return (await attendanceRecordsTx(tx, connectionId, [localId], new Map()))[0] ?? null;
        },
        async send(io, input) {
          const {
            event_id: eventId,
            contact_id: contactId,
            state,
          } = input.local.fields as Record<string, string>;
          if (!eventId || !contactId || !['register', 'attend', 'cancel'].includes(String(state)))
            throw new Error('Not an attendance record');
          const res = await io.client.request({
            method: 'POST',
            path: `/marketing/v3/marketing-events/attendance/${eventId}/${state}/email-create`,
            query: { externalAccountId: HUBSPOT_ACCOUNT },
            body: {
              inputs: [{ email: String(input.values.email), interactionDateTime: io.now.toISOString() }],
            },
            idempotencyKey: input.idempotencyKey,
          });
          const at = (res.body as { results?: { at?: unknown }[] }).results?.[0]?.at;
          return {
            externalId: attendanceKey(eventId, contactId),
            version: `${state}:${String(at ?? io.now.toISOString())}`,
          };
        },
      },
    },
  ],
});
