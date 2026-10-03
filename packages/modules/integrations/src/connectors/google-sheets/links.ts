import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import { z } from 'zod';
import type { IntegrationAuth } from '../../auth/port.ts';
import { currentMappingsTx } from '../../connections.ts';
import { ACTIVE_RUN_STATUSES, SHEET_LINK_STATUSES } from '../../domain/sync.ts';
import { connections, recordLinks, sheetLinks, syncCursors, syncErrors, syncRuns } from '../../schema.ts';
import { GOOGLE_SHEETS, googleSheetsConnector, SHEET_COLUMNS } from './index.ts';

/**
 * Linking an event's attendee list to a spreadsheet (M6.4b). Link: the transport creates the
 * spreadsheet at Google through the port (the header row is the push mapping's columns), then
 * `linkSheetCommand` records it and queues a sync (which fills the sheet). Unlink: nothing syncs
 * any more; the sheet stays at Google with what it holds; the rows' links go, so a later link
 * starts a fresh sheet. Reads `integrations:read`, writes `integrations:manage`.
 */

export const SheetLinkDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventName: z.string(),
  spreadsheetId: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.enum(SHEET_LINK_STATUSES),
  createdAt: z.date(),
  unlinkedAt: z.date().nullable(),
});
export type SheetLinkDto = z.infer<typeof SheetLinkDto>;
export const sheetLinksSerializer = defineSerializer('integrations.sheetLinks', z.array(SheetLinkDto));

export const sheetUrl = (spreadsheetId: string) =>
  `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

async function sheetsConnectionTx(tx: TenantTx, connectionId: string, active = true) {
  const [c] = await tx.select().from(connections).where(eq(connections.id, connectionId)).for('update');
  if (!c || c.connector !== GOOGLE_SHEETS) throw new DomainError('not_found', 'Connection not found');
  if (active && (c.status !== 'active' || !c.authConnectionId))
    throw new DomainError('invalid_state', 'Connect Google Sheets first', { reason: 'not_connected' });
  return c;
}

/** The connection's sheets, active first, then the latest unlinked ones. */
export const sheetLinksQuery = tenantQuery({
  name: 'integrations.sheetLinks',
  input: z.object({ connectionId: z.uuid() }),
  output: z.array(SheetLinkDto),
  entitlement: 'integrations',
  permission: 'integrations:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(sheetLinks)
      .where(eq(sheetLinks.connectionId, input.connectionId))
      .orderBy(sheetLinks.status, desc(sheetLinks.createdAt))
      .limit(200);
    const names = new Map<string, string>();
    for (const id of new Set(rows.map((r) => r.eventId)))
      names.set(id, (await findEventTx(tx, id))?.name ?? '');
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId,
      eventName: names.get(r.eventId) ?? '',
      spreadsheetId: r.spreadsheetId,
      title: r.title,
      url: sheetUrl(r.spreadsheetId),
      status: r.status as SheetLinkDto['status'],
      createdAt: r.createdAt,
      unlinkedAt: r.unlinkedAt,
    }));
  },
});

/** What creating a sheet for an event needs (checked before anything is created at Google). */
export const sheetLinkTargetQuery = tenantQuery({
  name: 'integrations.sheetLinkTarget',
  input: z.object({ connectionId: z.uuid(), eventId: z.uuid() }),
  output: z.object({
    authConnectionId: z.string(),
    title: z.string(),
    headers: z.array(z.object({ key: z.string(), label: z.string() })),
  }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, tx }) => {
    const [c] = await tx.select().from(connections).where(eq(connections.id, input.connectionId));
    if (!c || c.connector !== GOOGLE_SHEETS) throw new DomainError('not_found', 'Connection not found');
    if (c.status !== 'active' || !c.authConnectionId)
      throw new DomainError('invalid_state', 'Connect Google Sheets first', { reason: 'not_connected' });
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
    const [linked] = await tx
      .select({ id: sheetLinks.id })
      .from(sheetLinks)
      .where(
        and(
          eq(sheetLinks.connectionId, c.id),
          eq(sheetLinks.eventId, event.id),
          eq(sheetLinks.status, 'active'),
        ),
      );
    if (linked)
      throw new DomainError('conflict', 'This event already has a sheet', { reason: 'already_linked' });
    // Columns from the field mapping in force (push: Yayatoh field → column).
    const push = (await currentMappingsTx(tx, c.id)).find(
      (m) => m.objectType === 'attendees' && m.direction === 'push',
    );
    const keys = (push?.rules ?? googleSheetsConnector.objects[0]?.push?.defaultMapping ?? []).map(
      (r) => r.target,
    );
    const headers = SHEET_COLUMNS.filter((col) => keys.includes(col.key)).map((col) => ({
      key: col.key,
      label: col.label,
    }));
    return {
      authConnectionId: c.authConnectionId,
      title: `${event.name} · attendees`.slice(0, 200),
      headers,
    };
  },
});

/** Record a sheet the transport created for an event, and queue the sync that fills it. */
export const linkSheetCommand = tenantCommand({
  name: 'integrations.linkSheet',
  input: z.object({
    connectionId: z.uuid(),
    eventId: z.uuid(),
    spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    title: z.string().trim().min(1).max(200),
  }),
  output: z.object({ linkId: z.uuid(), runId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  // Attendee data leaves for a third party: never while staff act as a member.
  category: 'export',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const c = await sheetsConnectionTx(tx, input.connectionId);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
    const [linked] = await tx
      .select({ id: sheetLinks.id })
      .from(sheetLinks)
      .where(
        and(
          eq(sheetLinks.connectionId, c.id),
          eq(sheetLinks.eventId, event.id),
          eq(sheetLinks.status, 'active'),
        ),
      );
    if (linked)
      throw new DomainError('conflict', 'This event already has a sheet', { reason: 'already_linked' });
    const [link] = await tx
      .insert(sheetLinks)
      .values({
        orgId,
        connectionId: c.id,
        eventId: event.id,
        spreadsheetId: input.spreadsheetId,
        title: input.title,
        linkedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning({ id: sheetLinks.id });
    if (!link) throw new DomainError('internal');
    // The push re-reads every attendee once, so this event's people (changed long ago) reach the
    // new sheet; the links keep everyone else's rows from being written again.
    await tx
      .delete(syncCursors)
      .where(
        and(
          eq(syncCursors.connectionId, c.id),
          eq(syncCursors.objectType, 'attendees'),
          eq(syncCursors.direction, 'push'),
        ),
      );
    const [busy] = await tx
      .select({ id: syncRuns.id })
      .from(syncRuns)
      .where(and(eq(syncRuns.connectionId, c.id), inArray(syncRuns.status, [...ACTIVE_RUN_STATUSES])));
    const runId =
      busy?.id ??
      (
        await tx
          .insert(syncRuns)
          .values({
            orgId,
            connectionId: c.id,
            trigger: 'manual',
            status: 'queued',
            requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
          })
          .returning({ id: syncRuns.id })
      )[0]?.id;
    if (!runId) throw new DomainError('internal');
    emit({
      type: 'integrations.sheet_linked',
      version: 1,
      aggregateType: 'integration_connection',
      aggregateId: c.id,
      payload: { orgId, connectionId: c.id, eventId: event.id, linkId: link.id },
    });
    return { linkId: link.id, runId, eventId: event.id };
  },
  present: (r) => ({ linkId: r.linkId, runId: r.runId }),
  audit: (_input, r) => ({
    action: 'integrations.sheet.link',
    targetType: 'event',
    targetId: r.eventId,
    data: { linkId: r.linkId },
  }),
});

/** Stop syncing an event's sheet. The sheet stays at Google; attendees stay in Yayatoh. */
export const unlinkSheetCommand = tenantCommand({
  name: 'integrations.unlinkSheet',
  input: z.object({ connectionId: z.uuid(), linkId: z.uuid() }),
  output: z.object({ linkId: z.uuid() }),
  entitlement: 'integrations',
  permission: 'integrations:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const c = await sheetsConnectionTx(tx, input.connectionId, false);
    const [link] = await tx
      .select()
      .from(sheetLinks)
      .where(and(eq(sheetLinks.id, input.linkId), eq(sheetLinks.connectionId, c.id)))
      .for('update');
    if (!link) throw new DomainError('not_found', 'Sheet not found');
    if (link.status !== 'active') throw new DomainError('invalid_state', 'Already unlinked');
    await tx
      .update(sheetLinks)
      .set({ status: 'unlinked', unlinkedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(sheetLinks.id, link.id));
    const prefix = `${link.spreadsheetId}:%`;
    // Its rows are no one's any more: no flags for them, and their open errors are over.
    await tx
      .delete(recordLinks)
      .where(
        and(
          eq(recordLinks.connectionId, c.id),
          eq(recordLinks.objectType, 'attendees'),
          like(recordLinks.externalId, prefix),
        ),
      );
    await tx
      .update(syncErrors)
      .set({ status: 'resolved', nextRetryAt: null, resolvedAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(syncErrors.connectionId, c.id),
          eq(syncErrors.status, 'open'),
          like(syncErrors.externalId, prefix),
        ),
      );
    emit({
      type: 'integrations.sheet_unlinked',
      version: 1,
      aggregateType: 'integration_connection',
      aggregateId: c.id,
      payload: { orgId, connectionId: c.id, eventId: link.eventId, linkId: link.id },
    });
    return { linkId: link.id, eventId: link.eventId };
  },
  present: (r) => ({ linkId: r.linkId }),
  audit: (_input, r) => ({
    action: 'integrations.sheet.unlink',
    targetType: 'event',
    targetId: r.eventId,
    data: { linkId: r.linkId },
  }),
});

/**
 * Link an event: check it, create its spreadsheet at Google through the port (outside any
 * transaction), record the link. Returns the new link and the queued run.
 */
export async function linkEventSheet(
  ctx: Ctx,
  deps: { readonly auth: IntegrationAuth },
  ports: CommandPorts<TenantTx>,
  input: { readonly connectionId: string; readonly eventId: string },
): Promise<{ linkId: string; runId: string }> {
  const target = await executeQuery(sheetLinkTargetQuery, input, ctx, ports);
  const client = deps.auth.client({
    orgId: requireOrg(ctx),
    connectionId: input.connectionId,
    providerConfigKey: googleSheetsConnector.providerConfigKey,
    authConnectionId: target.authConnectionId,
  });
  const res = await client.request({
    method: 'POST',
    path: '/v4/spreadsheets',
    body: { properties: { title: target.title }, headers: target.headers },
    idempotencyKey: `sheet-link:${input.connectionId}:${input.eventId}:${crypto.randomUUID()}`,
  });
  const created = z.object({ spreadsheetId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).parse(res.body);
  return executeCommand(
    linkSheetCommand,
    { ...input, spreadsheetId: created.spreadsheetId, title: target.title },
    ctx,
    ports,
  );
}
