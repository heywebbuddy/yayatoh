import type { TenantTx } from '@yayatoh/db';
import { requireOrg } from '@yayatoh/kernel';
import { eq } from 'drizzle-orm';
import type { FakeProvider } from '../auth/fake.ts';
import type { FieldSpec, MappingRule } from '../domain/mapping.ts';
import { audienceSyncs } from '../schema.ts';
import {
  type ConnectorDefinition,
  defineConnector,
  type LocalRecord,
  type Page,
  type RemoteRecord,
  type SyncIO,
} from '../sdk/connector.ts';
import { INBOUND_CHANGES, type InboundChange, type MemberStatus, memberStatus } from './consent.ts';
import { applyInboundChangeTx } from './inbound.ts';
import {
  audienceIdsAfterTx,
  audienceWhereTx,
  type ContactState,
  contactStatesTx,
  inAudienceTx,
  linkedAmongTx,
  linkedLocalIdsAfterTx,
  linkPulledTx,
  liveConnectionIdTx,
  mergeIds,
} from './state.ts';

/**
 * Mailchimp and Klaviyo (M6.4d): push an audience (a saved segment, or everyone with consent) as
 * a provider list with merge fields; pull unsubscribes, cleaned addresses and complaints back as
 * consent changes. One object, `members`, both ways, on top of the M6.4a engine (links, cursors,
 * loop guards, the errors inbox).
 *
 * **Consent first.** The push walks the audience's consented members plus everyone already on the
 * list (id order, starting over when it reaches the end; unchanged records are skipped by their
 * hash) and sends each one's `MemberStatus` (`memberStatus`): a contact that is not `subscribed`
 * and not already on the list is never sent. The status is decided here from the sources of truth,
 * never by the field mapping (the mapping only fills merge fields), and `send` refuses to create
 * a member that is not `subscribed`. The pull never grants consent.
 */

export const MEMBERS = 'members';

/** One list at the provider (the console's picker). */
export interface ProviderList {
  readonly id: string;
  readonly name: string;
}

/** A provider's list API, as the connector needs it. */
export interface ListApi {
  lists(io: SyncIO): Promise<ProviderList[]>;
  /** Members of the list whose consent changed after `cursor`, one page (all statuses: the connector filters). */
  changes(io: SyncIO, listId: string, cursor: string | null): Promise<Page<RemoteRecord>>;
  member(io: SyncIO, listId: string, externalId: string): Promise<RemoteRecord | null>;
  /** Create or update a member with `status` (`archived`: off the list, not unsubscribed). */
  upsert(
    io: SyncIO,
    listId: string,
    input: {
      readonly externalId: string | null;
      readonly email: string;
      readonly mergeFields: Readonly<Record<string, unknown>>;
      readonly status: MemberStatus;
      readonly idempotencyKey: string;
    },
  ): Promise<{ readonly externalId: string; readonly version: string }>;
}

/** The run's scope: the list and audience, or nothing until the organizer has chosen them. */
interface ListScope {
  readonly orgId: string | null;
  readonly listId: string | null;
  readonly segmentId: string | null;
}
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const scopeOf = (s: Readonly<Record<string, unknown>>): ListScope => ({
  orgId: str(s.orgId),
  listId: str(s.listId),
  segmentId: str(s.segmentId),
});

/** The record fields the push hashes and sends (the mapping reads these, the status is ours). */
function memberFields(c: ContactState, status: MemberStatus, listId: string | null): Record<string, unknown> {
  const words = (c.name ?? '').trim().split(/\s+/).filter(Boolean);
  return {
    email: c.email,
    name: c.name,
    first_name: words[0] ?? null,
    last_name: words.length > 1 ? words.slice(1).join(' ') : null,
    company: c.company,
    phone: c.phone,
    subscription: status,
    // The list is part of what was sent: another list is another send (and idempotency key).
    list_id: listId,
  };
}

export const LIST_LOCAL_FIELDS: readonly FieldSpec[] = [
  { key: 'email', label: 'email', type: 'email', required: true },
  { key: 'first_name', label: 'first_name', type: 'string' },
  { key: 'last_name', label: 'last_name', type: 'string' },
  { key: 'name', label: 'name', type: 'string' },
  { key: 'company', label: 'company', type: 'string' },
  { key: 'phone', label: 'phone', type: 'string' },
  // Pull only: what the provider says changed (unsubscribed, cleaned, complained).
  { key: 'subscription', label: 'subscription', type: 'string', required: true },
];

/** Status per contact for this connection (null: not sent). */
async function membersOfTx(
  tx: TenantTx,
  connectionId: string,
  scope: ListScope,
  contactIds: readonly string[],
): Promise<LocalRecord[]> {
  const where =
    scope.listId && scope.orgId ? await audienceWhereTx(tx, scope.orgId, scope.segmentId) : null;
  const [states, linked, audience] = await Promise.all([
    contactStatesTx(tx, contactIds),
    linkedAmongTx(tx, connectionId, MEMBERS, contactIds),
    inAudienceTx(tx, where, contactIds),
  ]);
  const out: LocalRecord[] = [];
  for (const id of contactIds) {
    const c = states.get(id);
    if (!c) continue;
    const status = memberStatus({ status: c.status, inAudience: audience.has(id), linked: linked.has(id) });
    if (status) out.push({ id, updatedAt: c.updatedAt, fields: memberFields(c, status, scope.listId) });
  }
  return out;
}

/** The connection's list and audience (nothing until the organizer has chosen them). */
export async function listScopeTx(tx: TenantTx, connectionId: string): Promise<ListScope> {
  const [row] = await tx
    .select({ orgId: audienceSyncs.orgId, listId: audienceSyncs.listId, segmentId: audienceSyncs.segmentId })
    .from(audienceSyncs)
    .where(eq(audienceSyncs.connectionId, connectionId));
  return { orgId: row?.orgId ?? null, listId: row?.listId ?? null, segmentId: row?.segmentId ?? null };
}

/** Contacts looked at by one `changes` call before it gives up on a page (sparse audiences). */
const MAX_SCAN = 20_000;
const EMPTY = { records: [], cursor: '', hasMore: false } as const;

export function defineListConnector(def: {
  readonly key: 'mailchimp' | 'klaviyo';
  readonly name: string;
  readonly providerConfigKey: string;
  readonly scopes: readonly string[];
  readonly api: ListApi;
  readonly fake: FakeProvider;
  readonly remoteFields: readonly FieldSpec[];
  readonly emailField: string;
  readonly statusField: string;
  readonly pushMapping: readonly MappingRule[];
}): ConnectorDefinition {
  const { api } = def;
  return defineConnector({
    key: def.key,
    name: def.name,
    providerConfigKey: def.providerConfigKey,
    scopes: def.scopes,
    entitlement: 'integrations',
    availability: 'general',
    fake: def.fake,
    loadScope: async (tx, connectionId) => ({ ...(await listScopeTx(tx, connectionId)) }),
    objects: [
      {
        key: MEMBERS,
        remoteFields: def.remoteFields,
        localFields: LIST_LOCAL_FIELDS,
        pull: {
          defaultMapping: [
            { source: def.emailField, target: 'email', transform: 'lowercase', default: null },
            { source: def.statusField, target: 'subscription', transform: 'lowercase', default: null },
          ],
          async list(io, cursor) {
            const { listId } = scopeOf(io.scope);
            if (!listId) return { records: [], cursor: null, hasMore: false };
            const page = await api.changes(io, listId, cursor);
            return {
              ...page,
              records: page.records.filter((r) =>
                INBOUND_CHANGES.includes(String(r.fields[def.statusField]) as InboundChange),
              ),
            };
          },
          async get(io, externalId) {
            const { listId } = scopeOf(io.scope);
            return listId ? api.member(io, listId, externalId) : null;
          },
          async write(tx, ctx, values, localId, meta) {
            const change = String(values.subscription);
            // Only consent changes come back; anything else is not ours to apply (never a grant).
            if (!INBOUND_CHANGES.includes(change as InboundChange))
              throw new Error('Not a consent change');
            const contactId = await applyInboundChangeTx(tx, ctx, {
              connector: def.key,
              connectionId: meta.connectionId,
              contactId: localId,
              email: String(values.email),
              change: change as InboundChange,
              externalId: meta.record.id,
              remoteVersion: meta.record.version,
            });
            await linkPulledTx(tx, requireOrg(ctx), {
              connectionId: meta.connectionId,
              objectType: MEMBERS,
              externalId: meta.record.id,
              localId: contactId,
              remoteVersion: meta.record.version,
              now: ctx.now,
            });
            return { localId: contactId };
          },
        },
        push: {
          defaultMapping: def.pushMapping,
          async changes(tx, cursor, limit, meta) {
            const scope = scopeOf(meta.scope);
            if (!scope.listId || !scope.orgId) return { records: [], cursor: null, hasMore: false };
            const where = await audienceWhereTx(tx, scope.orgId, scope.segmentId);
            // Walk the audience ∪ the list in id order; at the end start over (cursor '').
            let after = cursor || null;
            let wrapped = after === null;
            for (let scanned = 0; scanned < MAX_SCAN; ) {
              const ids = mergeIds(
                await audienceIdsAfterTx(tx, where, after, limit),
                await linkedLocalIdsAfterTx(tx, meta.connectionId, MEMBERS, after, limit),
                limit,
              );
              const more = ids.length === limit;
              if (ids.length) {
                scanned += ids.length;
                const records = await membersOfTx(tx, meta.connectionId, scope, ids);
                const last = ids[ids.length - 1] as string;
                if (records.length) return { records, cursor: more ? last : '', hasMore: more };
                if (more) {
                  after = last;
                  continue;
                }
              }
              if (wrapped) return EMPTY;
              after = null;
              wrapped = true;
            }
            return EMPTY;
          },
          async read(tx, localId) {
            const connectionId = await liveConnectionIdTx(tx, def.key);
            if (!connectionId) return null;
            const [r] = await membersOfTx(tx, connectionId, await listScopeTx(tx, connectionId), [localId]);
            return r ?? null;
          },
          async send(io, input) {
            const { listId } = scopeOf(io.scope);
            const status = input.local.fields.subscription as MemberStatus;
            // Defence in depth: only a subscriber is ever created at the provider.
            if (!listId || (input.externalId === null && status !== 'subscribed'))
              throw new Error('Not eligible for the list');
            const { [def.emailField]: email, [def.statusField]: _status, ...mergeFields } = input.values;
            return api.upsert(io, listId, {
              externalId: input.externalId,
              email: String(email ?? input.local.fields.email),
              mergeFields,
              status,
              idempotencyKey: input.idempotencyKey,
            });
          },
        },
      },
    ],
  });
}
