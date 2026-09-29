import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, impersonationRefusal, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { StartedTransferDto, startTransferTx, ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { type MergeValues, orderRef, renderMacro, unknownMergeFields } from '../domain/macros.ts';
import { MACRO_ACTIONS, orderNotes, orders, supportMacroRuns, supportMacros } from '../schema.ts';

type MacroRow = typeof supportMacros.$inferSelect;
type Action = (typeof MACRO_ACTIONS)[number];

export const SupportMacroDto = z.object({
  id: z.uuid(),
  name: z.string(),
  subject: z.string(),
  body: z.string(),
  actions: z.array(z.enum(MACRO_ACTIONS)),
  updatedAt: z.date(),
});
export type SupportMacroDto = z.infer<typeof SupportMacroDto>;

const present = (r: MacroRow): SupportMacroDto => ({
  id: r.id,
  name: r.name,
  subject: r.subject,
  body: r.body,
  actions: r.actions as Action[],
  updatedAt: r.updatedAt,
});

const MacroFields = z.object({
  name: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  actions: z
    .array(z.enum(MACRO_ACTIONS))
    .min(1)
    .max(MACRO_ACTIONS.length)
    .transform((a) => MACRO_ACTIONS.filter((x) => a.includes(x))),
});

function checkTemplates(input: { subject: string; body: string }) {
  for (const field of ['subject', 'body'] as const) {
    const unknown = unknownMergeFields(input[field]);
    if (unknown.length)
      throw new DomainError('validation_failed', 'Unknown merge field', {
        reason: 'unknown_merge_field',
        field,
        fields: unknown.join(', '),
      });
  }
}

async function nameTakenTx(tx: TenantTx, name: string, exceptId?: string) {
  const rows = await tx
    .select({ id: supportMacros.id, name: supportMacros.name })
    .from(supportMacros)
    .where(isNull(supportMacros.archivedAt));
  return rows.some((r) => r.id !== exceptId && r.name.toLowerCase() === name.toLowerCase());
}

/** Create or change a support macro (M3.10c). Merge fields are checked; names are unique per org. */
export const saveSupportMacroCommand = tenantCommand({
  name: 'orders.saveSupportMacro',
  input: MacroFields.extend({ macroId: z.uuid().optional() }),
  output: SupportMacroDto,
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, ctx, tx }) => {
    checkTemplates(input);
    if (await nameTakenTx(tx, input.name, input.macroId))
      throw new DomainError('validation_failed', 'A macro with this name exists', {
        reason: 'name_taken',
        field: 'name',
      });
    const values = {
      name: input.name,
      subject: input.subject,
      body: input.body,
      actions: input.actions,
      updatedBy: actorId(ctx.actor),
      updatedAt: ctx.now,
    };
    const [row] = input.macroId
      ? await tx
          .update(supportMacros)
          .set(values)
          .where(and(eq(supportMacros.id, input.macroId), isNull(supportMacros.archivedAt)))
          .returning()
      : await tx
          .insert(supportMacros)
          .values({ ...values, orgId: requireOrg(ctx) })
          .returning();
    if (!row) throw new DomainError('not_found', 'Macro not found');
    return present(row);
  },
  audit: (input, r) => ({
    action: input.macroId ? 'support_macro.update' : 'support_macro.create',
    targetType: 'support_macro',
    targetId: r.id,
    data: { actions: r.actions },
  }),
});

/** Retire a macro (it stays in the run history). */
export const archiveSupportMacroCommand = tenantCommand({
  name: 'orders.archiveSupportMacro',
  input: z.object({ macroId: z.uuid() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(supportMacros)
      .set({ archivedAt: ctx.now, updatedAt: ctx.now, updatedBy: actorId(ctx.actor) })
      .where(and(eq(supportMacros.id, input.macroId), isNull(supportMacros.archivedAt)))
      .returning({ id: supportMacros.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Macro not found');
    return { ok: true };
  },
  audit: (input) => ({
    action: 'support_macro.archive',
    targetType: 'support_macro',
    targetId: input.macroId,
  }),
});

/** The org's live macros, by name. */
export const supportMacrosQuery = tenantQuery({
  name: 'orders.supportMacros',
  input: z.object({}),
  output: z.array(SupportMacroDto),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ tx }) =>
    (
      await tx
        .select()
        .from(supportMacros)
        .where(isNull(supportMacros.archivedAt))
        .orderBy(asc(supportMacros.name))
        .limit(200)
    ).map(present),
});

async function mergeValuesTx(
  tx: TenantTx,
  orderId: string,
  recipientName: string,
): Promise<{ values: MergeValues; order: typeof orders.$inferSelect; liveTicketIds: string[] }> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new DomainError('not_found', 'Order not found');
  const ev = await findEventTx(tx, order.eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  const live = (await ticketsForOrderTx(tx, order.id)).filter((t) => t.status === 'active');
  const date = new Intl.DateTimeFormat(order.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ev.timezone,
  }).format(ev.startsAt);
  return {
    order,
    liveTicketIds: live.map((t) => t.id),
    values: {
      buyer_name: order.buyerName,
      buyer_email: order.buyerEmail,
      event_name: ev.name,
      event_date: date,
      order_ref: orderRef(order.id),
      ticket_count: String(live.length),
      recipient_name: recipientName,
    },
  };
}

async function liveMacroTx(tx: TenantTx, id: string) {
  const [m] = await tx
    .select()
    .from(supportMacros)
    .where(and(eq(supportMacros.id, id), isNull(supportMacros.archivedAt)));
  if (!m) throw new DomainError('not_found', 'Macro not found');
  return m;
}

export const MacroPreviewDto = z.object({ subject: z.string(), body: z.string() });

/** What a macro would send for an order (merge fields filled), before running it. */
export const previewSupportMacroQuery = tenantQuery({
  name: 'orders.previewSupportMacro',
  input: z.object({ orderId: z.uuid(), macroId: z.uuid(), recipientName: z.string().max(120).default('') }),
  output: MacroPreviewDto,
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, tx }) => {
    const m = await liveMacroTx(tx, input.macroId);
    const { values } = await mergeValuesTx(tx, input.orderId, input.recipientName);
    return { subject: renderMacro(m.subject, values), body: renderMacro(m.body, values) };
  },
});

export const MacroRunDto = z.object({
  runId: z.uuid(),
  actions: z.array(z.enum(MACRO_ACTIONS)),
  subject: z.string(),
  body: z.string(),
  /** Resend: how many live tickets were sent again. */
  ticketsResent: z.int(),
  transfer: StartedTransferDto.nullable(),
});

/**
 * Run a macro on an order (M3.10c): fill its merge fields, then do its actions in one transaction:
 * email the buyer the reply, add it as a team note, resend the live tickets, and/or transfer a
 * ticket (the recipient named in the run). Idempotent (a retried run does nothing twice); audited;
 * the run is kept for the order timeline.
 */
export const runSupportMacroCommand = tenantCommand({
  name: 'orders.runSupportMacro',
  idempotent: true,
  input: z.object({
    orderId: z.uuid(),
    macroId: z.uuid(),
    transfer: z
      .object({
        ticketId: z.uuid(),
        toName: z.string().trim().min(1).max(120),
        toEmail: z.email().max(254),
      })
      .optional(),
  }),
  output: MacroRunDto,
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, ctx, tx, emit }) => {
    const m = await liveMacroTx(tx, input.macroId);
    const actions = m.actions as Action[];
    // A transfer moves a ticket's value: like `ticketing.startTransfer`, never while staff act as a member.
    const refusal = actions.includes('transfer_ticket') ? impersonationRefusal(ctx, 'money') : null;
    if (refusal) throw refusal;
    if (actions.includes('transfer_ticket') && !input.transfer)
      throw new DomainError('validation_failed', 'Choose a ticket and who it goes to', {
        reason: 'transfer_required',
        field: 'transfer',
      });
    const { values, order, liveTicketIds } = await mergeValuesTx(
      tx,
      input.orderId,
      input.transfer?.toName ?? '',
    );
    if (actions.includes('resend_tickets') && liveTicketIds.length === 0)
      throw new DomainError('invalid_state', 'This order has no valid tickets to resend', {
        reason: 'no_live_tickets',
      });
    const subject = renderMacro(m.subject, values);
    const body = renderMacro(m.body, values);
    const orgId = requireOrg(ctx);
    const [run] = await tx
      .insert(supportMacroRuns)
      .values({
        orgId,
        macroId: m.id,
        orderId: order.id,
        macroName: m.name,
        actions,
        replySubject: subject,
        replyBody: body,
        ranBy: actorId(ctx.actor),
      })
      .returning({ id: supportMacroRuns.id });
    if (!run) throw new DomainError('internal');
    let transfer: z.infer<typeof StartedTransferDto> | null = null;
    if (actions.includes('transfer_ticket') && input.transfer)
      transfer = await startTransferTx(tx, ctx, emit, {
        ticketId: input.transfer.ticketId,
        orderId: order.id,
        toName: input.transfer.toName,
        toEmail: input.transfer.toEmail,
        by: 'organizer',
      });
    if (actions.includes('add_note'))
      await tx.insert(orderNotes).values({
        orgId,
        orderId: order.id,
        body: `${m.name}: ${body}`.slice(0, 2000),
        authorId: actorId(ctx.actor),
      });
    if (actions.includes('resend_tickets'))
      emit({
        type: 'ticket.resend_requested',
        version: 1,
        aggregateType: 'bulk_operation',
        aggregateId: run.id,
        payload: { orgId, operationId: run.id, eventId: order.eventId, ticketIds: liveTicketIds },
      });
    if (actions.includes('email_buyer'))
      emit({
        type: 'order.support_reply',
        version: 1,
        aggregateType: 'order',
        aggregateId: order.id,
        payload: { orgId, orderId: order.id, runId: run.id },
      });
    return {
      runId: run.id,
      actions,
      subject,
      body,
      ticketsResent: actions.includes('resend_tickets') ? liveTicketIds.length : 0,
      transfer,
    };
  },
  audit: (input, r) => ({
    action: 'support_macro.run',
    targetType: 'order',
    targetId: input.orderId,
    data: { macroId: input.macroId, runId: r.runId, actions: r.actions },
  }),
});

/** An order's macro runs (the timeline), oldest first. */
export async function macroRunsForOrderTx(tx: TenantTx, orderId: string) {
  return tx
    .select({
      id: supportMacroRuns.id,
      macroName: supportMacroRuns.macroName,
      actions: supportMacroRuns.actions,
      ranBy: supportMacroRuns.ranBy,
      createdAt: supportMacroRuns.createdAt,
    })
    .from(supportMacroRuns)
    .where(eq(supportMacroRuns.orderId, orderId))
    .orderBy(desc(supportMacroRuns.createdAt))
    .limit(200);
}

/** The reply of one run, for the mailer. */
export async function macroRunTx(tx: TenantTx, _ctx: Ctx, runId: string) {
  const [r] = await tx.select().from(supportMacroRuns).where(eq(supportMacroRuns.id, runId));
  return r ?? null;
}
