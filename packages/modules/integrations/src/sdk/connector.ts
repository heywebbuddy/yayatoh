import type { TenantTx } from '@yayatoh/db';
import type { Ctx } from '@yayatoh/kernel';
import type { ModuleKey } from '@yayatoh/platform';
import type { ProviderAccount } from '../accounting/domain.ts';
import type { FakeProvider } from '../auth/fake.ts';
import type { ProviderClient } from '../auth/port.ts';
import { FIELD_KEY, type FieldSpec, type MappingRule, validateMapping } from '../domain/mapping.ts';

/**
 * The connector SDK (M6.4a). A connector describes a provider: how to reach it through the
 * `IntegrationAuth` port, which objects it syncs, in which directions, with which fields, and the
 * code that reads and writes one page or one record. The engine (`engine.ts`) does everything else
 * (cursors, mapping, retries, loop guards, idempotency, the errors inbox, concurrency of one).
 * M6.4b–d add Eventbrite, Sheets, Zapier, Slack, Mailchimp, HubSpot and Klaviyo this way: define it
 * in `src/connectors/`, list it in `CONNECTORS`, ship a `fake` for dev and CI.
 */

/** One record as the provider holds it. */
export interface RemoteRecord {
  /** The provider's id for it (stable). */
  readonly id: string;
  /** Changes whenever the record changes (an etag, a revision, an update time). */
  readonly version: string;
  readonly updatedAt: Date | null;
  /** The origin stamp the provider keeps for the record's last write, if it keeps one. */
  readonly origin: string | null;
  readonly fields: Readonly<Record<string, unknown>>;
}

/** One Yayatoh record as a push reads it. */
export interface LocalRecord {
  readonly id: string;
  readonly updatedAt: Date;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface Page<R> {
  readonly records: readonly R[];
  /** Where the next page starts (stored per object and direction); null keeps the current one. */
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/** What connector code gets for provider calls. There is no token in it. */
export interface SyncIO {
  readonly client: ProviderClient;
  /** This connection's origin stamp: write it on provider records where the API allows (loop guard). */
  readonly origin: string;
  readonly now: Date;
}

export interface PullSide {
  /** Mapping offered when the connection is made (remote field → Yayatoh field). */
  readonly defaultMapping: readonly MappingRule[];
  /** Records changed after `cursor` (null: from the beginning), one page. */
  list(io: SyncIO, cursor: string | null): Promise<Page<RemoteRecord>>;
  /** One record by its provider id (retries from the errors inbox); null when it is gone. */
  get(io: SyncIO, externalId: string): Promise<RemoteRecord | null>;
  /**
   * Write one mapped record in Yayatoh, inside the engine's tenant transaction (with the record
   * link, so it commits once). `localId` is the record it wrote last time, if any.
   */
  write(
    tx: TenantTx,
    ctx: Ctx,
    values: Readonly<Record<string, unknown>>,
    localId: string | null,
  ): Promise<{ readonly localId: string }>;
}

export interface PushSide {
  /** Mapping offered when the connection is made (Yayatoh field → remote field). */
  readonly defaultMapping: readonly MappingRule[];
  /** Yayatoh records changed after `cursor` (null: from the beginning), one page. */
  changes(tx: TenantTx, cursor: string | null, limit: number): Promise<Page<LocalRecord>>;
  /** One Yayatoh record (also used by the pull's loop guard); null when it is gone. */
  read(tx: TenantTx, localId: string): Promise<LocalRecord | null>;
  /**
   * Create (`externalId` null) or update one provider record. `idempotencyKey` is the same for the
   * same record and content, so a retried send is applied once.
   */
  send(
    io: SyncIO,
    input: {
      readonly externalId: string | null;
      readonly values: Readonly<Record<string, unknown>>;
      readonly idempotencyKey: string;
    },
  ): Promise<{ readonly externalId: string; readonly version: string }>;
}

export interface ObjectDefinition {
  /** `contacts`, `orders`, … (stored with cursors, links and errors). */
  readonly key: string;
  /** The provider's fields (pull sources, push targets). */
  readonly remoteFields: readonly FieldSpec[];
  /** Yayatoh's fields (pull targets, push sources). */
  readonly localFields: readonly FieldSpec[];
  readonly pull?: PullSide;
  readonly push?: PushSide;
}

/** One balanced journal as an accounting connector sends it (M6.5d). */
export interface JournalToPost {
  /** `YYYY-MM-DD` (the org's day). */
  readonly day: string;
  readonly currency: string;
  /** The currency's minor-unit exponent (amounts go to the provider as exact decimals). */
  readonly exponent: number;
  /** A short reference (QuickBooks DocNumber, at most 21 characters). */
  readonly reference: string;
  readonly memo: string;
  /** Debit positive, credit negative, integer minor units; they sum to zero. */
  readonly lines: readonly {
    readonly accountId: string;
    readonly accountCode: string | null;
    readonly amountMinor: number;
    readonly description: string;
  }[];
  /** The same for the same org, day, currency and revision: a retried post lands once. */
  readonly idempotencyKey: string;
}

/**
 * An accounting connector's side (M6.5d, P6-6): the org's chart of accounts and posting one
 * daily summary journal. The engine builds the journals (`accounting/run.ts`); the connector only
 * talks to its provider.
 */
export interface AccountingSide {
  /** The org's active accounts at the provider. */
  listAccounts(io: SyncIO): Promise<ProviderAccount[]>;
  /** Post one journal; returns the provider's id for it. */
  postJournal(io: SyncIO, journal: JournalToPost): Promise<{ readonly externalId: string }>;
}

export interface ConnectorDefinition {
  /** Stable key (`demo`, `eventbrite`, …): stored on connections. */
  readonly key: string;
  /** The provider's name (a brand: not translated). */
  readonly name: string;
  /** The provider integration at Nango (its "provider config key"). */
  readonly providerConfigKey: string;
  readonly scopes: readonly string[];
  /**
   * The module key an org needs for this connector (P6-13). Every connector needs `integrations`
   * too; a connector may add its own key so it can be priced on its own later.
   */
  readonly entitlement: ModuleKey;
  /** `fake_only`: offered only where the auth port is the fake (dev, CI, previews). */
  readonly availability: 'general' | 'fake_only';
  readonly objects: readonly ObjectDefinition[];
  /** The connector's fake provider API for dev and CI. */
  readonly fake?: FakeProvider;
  /** Accounting connectors (M6.5d): daily summary journals instead of (or besides) objects. */
  readonly accounting?: AccountingSide;
}

const CONNECTOR_KEY = /^[a-z][a-z0-9_]{1,39}$/;

/** Define a connector. Checks keys and that each side's default mapping is valid. */
export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  if (!CONNECTOR_KEY.test(def.key)) throw new Error(`Connector key must be snake_case: ${def.key}`);
  if (def.objects.length === 0 && !def.accounting) throw new Error(`Connector ${def.key} has no objects`);
  const seen = new Set<string>();
  for (const o of def.objects) {
    if (!FIELD_KEY.test(o.key)) throw new Error(`Connector ${def.key}: bad object key ${o.key}`);
    if (seen.has(o.key)) throw new Error(`Connector ${def.key}: duplicate object ${o.key}`);
    seen.add(o.key);
    if (!o.pull && !o.push) throw new Error(`Connector ${def.key}.${o.key} neither pulls nor pushes`);
    if (o.pull && validateMapping(o.pull.defaultMapping, o.remoteFields, o.localFields).length)
      throw new Error(`Connector ${def.key}.${o.key}: invalid default pull mapping`);
    if (o.push && validateMapping(o.push.defaultMapping, o.localFields, o.remoteFields).length)
      throw new Error(`Connector ${def.key}.${o.key}: invalid default push mapping`);
  }
  return Object.freeze({ ...def });
}

/** The fields a mapping of `direction` reads from and writes to. */
export function mappingFields(o: ObjectDefinition, direction: 'pull' | 'push') {
  return direction === 'pull'
    ? { sources: o.remoteFields, targets: o.localFields }
    : { sources: o.localFields, targets: o.remoteFields };
}
