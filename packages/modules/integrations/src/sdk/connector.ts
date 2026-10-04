import type { TenantTx } from '@yayatoh/db';
import type { Ctx, DomainEvent } from '@yayatoh/kernel';
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
  /**
   * M6.4b: what the connector's `loadScope` read for this run (e.g. the linked sheets); empty for
   * connectors without one. Ids and labels only: never a token.
   */
  readonly scope: Readonly<Record<string, unknown>>;
}

/** M6.4b: what a pull `write` learns about the record beyond its mapped values. */
export interface WriteMeta {
  readonly connectionId: string;
  /** The provider record as listed (nested data the mapping does not cover, e.g. an order's attendees). */
  readonly record: RemoteRecord;
  /** Queue a domain event on the page command's outbox (the owning module's commands emit through it). */
  readonly emit: (event: DomainEvent) => void;
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
    meta: WriteMeta,
  ): Promise<{ readonly localId: string }>;
  /**
   * M6.4b: `list` returns the provider's whole set on every run (a spreadsheet has no change feed).
   * When a run read it to the end, a linked record missing from it is flagged in the errors inbox
   * (`remote_deleted`, never retried automatically): the Yayatoh record is never deleted.
   */
  readonly snapshot?: boolean;
  /**
   * M6.4b: `inbox` records last-writer conflicts (both sides changed since the last crossing) in the
   * errors inbox, with the losing side's values per field (`sync_conflicts`).
   */
  readonly conflicts?: 'inbox';
}

/**
 * Whose records a push reads (M6.5c). An org connection pushes the org's records; a registrant's
 * personal connection (`audience: 'registrant'`) pushes only that registrant's (their schedule).
 */
export interface PushScope {
  readonly connectionId: string;
  /** The registrant of a personal connection; null for the org's connections. */
  readonly registrantId: string | null;
  /** The event of a personal connection; null for the org's connections. */
  readonly eventId: string | null;
  readonly now: Date;
  /** M6.4b: what the connector's `loadScope` read for this run (`{}` without one, and in pull pages). */
  readonly scope: Readonly<Record<string, unknown>>;
}

export interface PushSide {
  /** Mapping offered when the connection is made (Yayatoh field → remote field). */
  readonly defaultMapping: readonly MappingRule[];
  /**
   * Yayatoh records changed after `cursor` (null: from the beginning), one page. A `reconcile`
   * side lists every record it wants on the provider instead (the engine skips unchanged ones).
   * `scope` says which connection is pushing, whose records (M6.5c) and the run's loaded scope
   * (M6.4b, e.g. the events with a linked sheet).
   */
  changes(tx: TenantTx, cursor: string | null, limit: number, scope: PushScope): Promise<Page<LocalRecord>>;
  /**
   * One Yayatoh record (also used by the pull's loop guard); null when it is gone. For a
   * `reconcile` side, null also means "no longer wanted here": the engine removes it remotely.
   */
  read(tx: TenantTx, localId: string, scope: PushScope): Promise<LocalRecord | null>;
  /**
   * M6.5c, full reconciliation (calendars): each pass lists every wanted record from the start
   * (the cursor goes back to the start after the last page), and linked records that `read` no
   * longer returns are deleted at the provider with `remove`. Unchanged records are skipped by the
   * link's hash, so a pass that finds nothing new makes no provider call.
   */
  readonly reconcile?: boolean;
  /** Delete one provider record (reconcile sides). Idempotent: a record already gone is fine. */
  remove?(io: SyncIO, input: { readonly externalId: string; readonly idempotencyKey: string }): Promise<void>;
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
      /**
       * M6.4b: the Yayatoh record being sent (fields the mapping does not cover, e.g. its event);
       * M6.5c calendars create entries under an id derived from `local.id`.
       */
      readonly local: LocalRecord;
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
  /**
   * `sync` (the default) moves records with the engine; `notifications` (M6.4c: Slack) only sends
   * messages, so it has no objects: its runs are the connection's health check (a revoked
   * connection is marked so in its next run) and its sender lives with the connector.
   */
  readonly purpose?: 'sync' | 'notifications';
  /**
   * M6.4b: `sync` (default) runs on a schedule from the moment it connects; `import` runs only when
   * someone starts it (a one-way importer: preview first, then import; never scheduled).
   */
  readonly mode?: 'sync' | 'import';
  /** M6.4b: read once per run, inside a tenant transaction, and handed to the connector as `io.scope`. */
  readonly loadScope?: (tx: TenantTx, connectionId: string) => Promise<Readonly<Record<string, unknown>>>;
  readonly objects: readonly ObjectDefinition[];
  /**
   * A cheap call that proves the connection still works at the provider (M6.4c), made by every
   * run after the port's own check: a refusal (401/403) marks the connection revoked in that run.
   */
  readonly health?: (io: SyncIO) => Promise<void>;
  /** The connector's fake provider API for dev and CI. */
  readonly fake?: FakeProvider;
  /**
   * M6.5c: `org` (default) connections are the org's, made in the console by its admins;
   * `registrant` connections are a registrant's own (personal calendar push from their schedule
   * page), never listed in the console and made without an account.
   */
  readonly audience?: 'org' | 'registrant';
  /** How often a new connection syncs (minutes, one of `SYNC_INTERVALS`); default 60. */
  readonly defaultSyncIntervalMinutes?: number;
  /** Accounting connectors (M6.5d): daily summary journals instead of (or besides) objects. */
  readonly accounting?: AccountingSide;
}

const CONNECTOR_KEY = /^[a-z][a-z0-9_]{1,39}$/;

/** Define a connector. Checks keys and that each side's default mapping is valid. */
export function defineConnector(def: ConnectorDefinition): ConnectorDefinition {
  if (!CONNECTOR_KEY.test(def.key)) throw new Error(`Connector key must be snake_case: ${def.key}`);
  if (def.objects.length === 0 && def.purpose !== 'notifications' && !def.accounting)
    throw new Error(`Connector ${def.key} has no objects`);
  const seen = new Set<string>();
  for (const o of def.objects) {
    if (!FIELD_KEY.test(o.key)) throw new Error(`Connector ${def.key}: bad object key ${o.key}`);
    if (seen.has(o.key)) throw new Error(`Connector ${def.key}: duplicate object ${o.key}`);
    seen.add(o.key);
    if (!o.pull && !o.push) throw new Error(`Connector ${def.key}.${o.key} neither pulls nor pushes`);
    if (o.push?.reconcile && !o.push.remove)
      throw new Error(`Connector ${def.key}.${o.key}: a reconciling push needs remove`);
    if (o.pull && validateMapping(o.pull.defaultMapping, o.remoteFields, o.localFields).length)
      throw new Error(`Connector ${def.key}.${o.key}: invalid default pull mapping`);
    if (o.push && validateMapping(o.push.defaultMapping, o.localFields, o.remoteFields).length)
      throw new Error(`Connector ${def.key}.${o.key}: invalid default push mapping`);
  }
  return Object.freeze({ ...def });
}

/** Whether a connector only imports when asked (M6.4b). */
export const isImporter = (c: Pick<ConnectorDefinition, 'mode'> | null | undefined) => c?.mode === 'import';

/** The fields a mapping of `direction` reads from and writes to. */
export function mappingFields(o: ObjectDefinition, direction: 'pull' | 'push') {
  return direction === 'pull'
    ? { sources: o.remoteFields, targets: o.localFields }
    : { sources: o.localFields, targets: o.remoteFields };
}
