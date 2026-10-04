import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError, executeQuery } from '@yayatoh/kernel';
import { importedOrdersSummaryTx } from '@yayatoh/orders';
import { tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { IntegrationAuth } from '../../auth/port.ts';
import { originStamp, RUN_STATUSES } from '../../domain/sync.ts';
import { connections, recordLinks, syncRuns } from '../../schema.ts';
import type { RemoteRecord, SyncIO } from '../../sdk/connector.ts';
import { linkedCountsTx } from '../links.ts';
import { EVENTBRITE, eventbriteConnector } from './index.ts';

/**
 * The Eventbrite import wizard's read side (M6.4b): the dry-run preview (what the account holds
 * and how much of it is new; nothing is written) and the result (the latest import run, and what
 * Yayatoh holds from Eventbrite now: events, ticket types, orders, attendees, revenue to the cent).
 */

const Count = z.object({ total: z.int(), new: z.int() });
const Revenue = z.array(z.object({ currency: z.string(), totalMinor: z.int() }));

export const ImportPreviewDto = z.object({
  events: Count,
  ticketTypes: Count,
  orders: Count,
  /** Orders Eventbrite refunded or deleted (imported as such, no revenue). */
  refundedOrders: z.int(),
  attendees: z.int(),
  /** Gross of the orders still placed, per currency, in minor units. */
  revenue: Revenue,
});
export type ImportPreviewDto = z.infer<typeof ImportPreviewDto>;
export const importPreviewSerializer = defineSerializer('integrations.importPreview', ImportPreviewDto);

/** Pages read at most per list in a preview (an account bigger than this previews in part). */
const MAX_PREVIEW_PAGES = 200;

/** What the preview needs from a connection: it must be an active Eventbrite one. */
export const importTargetQuery = tenantQuery({
  name: 'integrations.importTarget',
  input: z.object({ connectionId: z.uuid() }),
  output: z.object({ connectionId: z.uuid(), authConnectionId: z.string() }),
  entitlement: 'integrations',
  // Reading the provider's data is part of starting an import.
  permission: 'integrations:manage',
  handler: async ({ input, tx }) => {
    const [c] = await tx.select().from(connections).where(eq(connections.id, input.connectionId));
    if (!c || c.connector !== EVENTBRITE) throw new DomainError('not_found', 'Connection not found');
    if (c.status !== 'active' || !c.authConnectionId)
      throw new DomainError('invalid_state', 'Connect Eventbrite first', { reason: 'not_connected' });
    return { connectionId: c.id, authConnectionId: c.authConnectionId };
  },
});

/** How many of these provider ids an Eventbrite import already brought in. */
export const alreadyImportedQuery = tenantQuery({
  name: 'integrations.alreadyImported',
  input: z.object({
    events: z.array(z.string().max(255)).max(10_000),
    ticketClasses: z.array(z.string().max(255)).max(50_000),
    orders: z.array(z.string().max(255)).max(200_000),
  }),
  output: z.object({ events: z.int(), ticketClasses: z.int(), orders: z.int() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, tx }) => {
    const linked = await linkedCountsTx(tx, EVENTBRITE);
    const n = (object: string, ids: readonly string[]) => {
      const have = linked.get(object);
      return have ? ids.filter((id) => have.has(id)).length : 0;
    };
    return {
      events: n('events', input.events),
      ticketClasses: n('ticket_classes', input.ticketClasses),
      orders: n('orders', input.orders),
    };
  },
});

async function readAll(
  list: (
    io: SyncIO,
    cursor: string | null,
  ) => Promise<{ records: readonly RemoteRecord[]; cursor: string | null; hasMore: boolean }>,
  io: SyncIO,
): Promise<RemoteRecord[]> {
  const out: RemoteRecord[] = [];
  let cursor: string | null = null;
  for (let n = 0; n < MAX_PREVIEW_PAGES; n++) {
    const p = await list(io, cursor);
    out.push(...p.records);
    if (!p.hasMore || p.cursor === null) break;
    cursor = p.cursor;
  }
  return out;
}

/**
 * The dry run: reads the whole account through the port (no transaction is open meanwhile) and
 * counts. Nothing is written. Provider failures surface as `ProviderError` (status and code).
 */
export async function eventbritePreview(
  ctx: Ctx,
  deps: { readonly auth: IntegrationAuth },
  ports: CommandPorts<TenantTx>,
  connectionId: string,
): Promise<ImportPreviewDto> {
  const target = await executeQuery(importTargetQuery, { connectionId }, ctx, ports);
  const io: SyncIO = {
    client: deps.auth.client({
      orgId: ctx.orgId as string,
      connectionId,
      providerConfigKey: eventbriteConnector.providerConfigKey,
      authConnectionId: target.authConnectionId,
    }),
    origin: originStamp(connectionId),
    now: ctx.now,
    scope: {},
  };
  const [events, classes, orders] = eventbriteConnector.objects.map((o) => o.pull);
  if (!events || !classes || !orders) throw new DomainError('internal');
  const ev = await readAll(events.list, io);
  const tc = await readAll(classes.list, io);
  const or = await readAll(orders.list, io);
  const have = await executeQuery(
    alreadyImportedQuery,
    { events: ev.map((r) => r.id), ticketClasses: tc.map((r) => r.id), orders: or.map((r) => r.id) },
    ctx,
    ports,
  );
  const revenue = new Map<string, number>();
  let attendees = 0;
  let refunded = 0;
  for (const o of or) {
    const list = Array.isArray(o.fields.attendees) ? o.fields.attendees : [];
    attendees += list.length;
    if (o.fields.status !== 'placed') {
      refunded += 1;
      continue;
    }
    const currency = String(o.fields.currency ?? '');
    revenue.set(currency, (revenue.get(currency) ?? 0) + Number(o.fields.gross ?? 0));
  }
  return importPreviewSerializer.serialize({
    events: { total: ev.length, new: ev.length - have.events },
    ticketTypes: { total: tc.length, new: tc.length - have.ticketClasses },
    orders: { total: or.length, new: or.length - have.orders },
    refundedOrders: refunded,
    attendees,
    revenue: [...revenue]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([currency, totalMinor]) => ({ currency, totalMinor })),
  });
}

export const ImportResultDto = z.object({
  run: z
    .object({
      id: z.uuid(),
      status: z.enum(RUN_STATUSES),
      startedAt: z.date().nullable(),
      finishedAt: z.date().nullable(),
      pulled: z.int(),
      skipped: z.int(),
      failed: z.int(),
      errorCode: z.string().nullable(),
    })
    .nullable(),
  /** What Yayatoh holds from Eventbrite now (every Eventbrite connection of the org). */
  imported: z.object({
    events: z.int(),
    ticketTypes: z.int(),
    orders: z.int(),
    paidOrders: z.int(),
    attendees: z.int(),
    activeAttendees: z.int(),
    revenue: Revenue,
  }),
});
export type ImportResultDto = z.infer<typeof ImportResultDto>;

/** The latest import run of the connection and the totals imported from Eventbrite so far. */
export const importResultQuery = tenantQuery({
  name: 'integrations.importResult',
  input: z.object({ connectionId: z.uuid() }),
  output: ImportResultDto,
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const [c] = await tx.select().from(connections).where(eq(connections.id, input.connectionId));
    if (!c || c.connector !== EVENTBRITE) throw new DomainError('not_found', 'Connection not found');
    const [run] = await tx
      .select()
      .from(syncRuns)
      .where(eq(syncRuns.connectionId, c.id))
      .orderBy(desc(syncRuns.createdAt))
      .limit(1);
    const links = await tx
      .select({ objectType: recordLinks.objectType, localId: recordLinks.localId })
      .from(recordLinks)
      .innerJoin(
        connections,
        and(eq(connections.orgId, recordLinks.orgId), eq(connections.id, recordLinks.connectionId)),
      )
      .where(
        and(
          eq(connections.connector, EVENTBRITE),
          inArray(recordLinks.objectType, ['events', 'ticket_classes']),
        ),
      );
    const events = new Set(links.filter((l) => l.objectType === 'events').map((l) => l.localId));
    const types = new Set(links.filter((l) => l.objectType === 'ticket_classes').map((l) => l.localId));
    const orders = await importedOrdersSummaryTx(tx, 'eventbrite');
    return {
      run: run
        ? {
            id: run.id,
            status: run.status as (typeof RUN_STATUSES)[number],
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            pulled: run.pulled,
            skipped: run.skipped,
            failed: run.failed,
            errorCode: run.errorCode,
          }
        : null,
      imported: {
        events: events.size,
        ticketTypes: types.size,
        orders: orders.orders,
        paidOrders: orders.paidOrders,
        attendees: orders.tickets,
        activeAttendees: orders.activeTickets,
        revenue: orders.revenue,
      },
    };
  },
});
