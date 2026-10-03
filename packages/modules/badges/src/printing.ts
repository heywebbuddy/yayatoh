import { type TenantTx, withTenant } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  createCtx,
  DomainError,
  type DomainEvent,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import type { PdfRenderer } from '@yayatoh/pdf';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { badgeTicketsTx } from '@yayatoh/ticketing';
import { and, count, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badgePrintableTx, oneBadgeHtmlTx } from './batches.ts';
import {
  comesOnline,
  goesQuiet,
  MAX_PRINT_NOTE,
  MAX_PRINTERS_PER_EVENT,
  offlineAt,
  PRINT_JOB_STATUSES,
  PRINT_KINDS,
  PRINT_PDF_TTL_MS,
  PRINT_REASONS,
  PRINT_SOURCES,
  PRINTER_ADAPTERS,
  PRINTER_OFFLINE_AFTER_MS,
  PRINTER_STATUSES,
  printKindFor,
  reasonProblem,
} from './domain/printing.ts';
import type { BadgePrinter } from './printer-port.ts';
import { printers, printJobs, printSettings } from './schema.ts';
import { eventOfTx } from './templates.ts';

/* ------------------------------------------------------------------------------- events ---- */

/** Outbox: a printer silent for 90 s (once per silence). The alert rule arrives with M5.9a. */
export const PRINTER_OFFLINE_EVENT = 'badges.printer_offline';
/** Outbox: a printer heard from again after being offline (or for the first time). */
export const PRINTER_ONLINE_EVENT = 'badges.printer_online';
export const PrinterStatePayload = z.object({
  orgId: z.uuid(),
  eventId: z.uuid(),
  printerId: z.uuid(),
  adapter: z.enum(PRINTER_ADAPTERS),
  /** The last heartbeat before the silence (offline), or the heartbeat itself (online). */
  lastSeenAt: z.iso.datetime(),
  /** Offline: the moment the window ran out (last heartbeat + 90 s). */
  offlineAt: z.iso.datetime().nullable(),
});
export type PrinterStatePayload = z.infer<typeof PrinterStatePayload>;

type PrinterRow = typeof printers.$inferSelect;

const stateEvent = (type: string, p: PrinterRow, lastSeenAt: Date, off: Date | null): DomainEvent => ({
  type,
  version: 1,
  aggregateType: 'printer',
  aggregateId: p.id,
  payload: PrinterStatePayload.parse({
    orgId: p.orgId,
    eventId: p.eventId,
    printerId: p.id,
    adapter: p.adapter,
    lastSeenAt: lastSeenAt.toISOString(),
    offlineAt: off?.toISOString() ?? null,
  }),
});

/* ----------------------------------------------------------------------------- printers ---- */

export const PrinterDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  adapter: z.enum(PRINTER_ADAPTERS),
  printnodePrinterId: z.int().nullable(),
  status: z.enum(PRINTER_STATUSES),
  lastSeenAt: z.date().nullable(),
  offlineAt: z.date().nullable(),
  archived: z.boolean(),
  createdAt: z.date(),
});
export type PrinterDto = z.infer<typeof PrinterDto>;

const printerDto = (p: PrinterRow): PrinterDto => PrinterDto.parse({ ...p, archived: p.archivedAt !== null });

async function printNodeEnabledTx(tx: TenantTx): Promise<boolean> {
  const [s] = await tx.select({ on: printSettings.printnodeEnabled }).from(printSettings).limit(1);
  return s?.on ?? false;
}

async function printerOfTx(tx: TenantTx, eventId: string, printerId: string, lock = false) {
  const q = tx
    .select()
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.eventId, eventId)));
  const [p] = lock ? await q.for('update') : await q;
  if (!p) throw new DomainError('not_found', 'Printer not found');
  return p;
}

const PrinterName = z.string().trim().min(1).max(60);

export const createPrinterCommand = tenantCommand({
  name: 'badges.createPrinter',
  input: z.object({
    eventId: z.uuid(),
    name: PrinterName,
    adapter: z.enum(PRINTER_ADAPTERS),
    printnodePrinterId: z.int().min(1).max(2_147_483_647).nullable().default(null),
  }),
  output: PrinterDto,
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOfTx(tx, input.eventId);
    if (input.adapter === 'printnode') {
      if (!(await printNodeEnabledTx(tx)))
        throw new DomainError('invalid_state', 'PrintNode is not switched on for this organization', {
          reason: 'printnode_off',
          field: 'adapter',
        });
      if (!input.printnodePrinterId)
        throw new DomainError('validation_failed', 'PrintNode printer id required', {
          reason: 'printnode_id_required',
          field: 'printnodePrinterId',
        });
    }
    const [n] = await tx
      .select({ n: count() })
      .from(printers)
      .where(and(eq(printers.eventId, input.eventId), isNull(printers.archivedAt)));
    if ((n?.n ?? 0) >= MAX_PRINTERS_PER_EVENT)
      throw new DomainError('invalid_state', 'Too many printers', { reason: 'too_many_printers' });
    const [taken] = await tx
      .select({ id: printers.id })
      .from(printers)
      .where(
        and(
          eq(printers.eventId, input.eventId),
          isNull(printers.archivedAt),
          sql`lower(${printers.name}) = lower(${input.name})`,
        ),
      );
    if (taken) throw new DomainError('conflict', 'Name taken', { field: 'name', reason: 'name_taken' });
    const [row] = await tx
      .insert(printers)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        name: input.name,
        adapter: input.adapter,
        printnodePrinterId: input.adapter === 'printnode' ? input.printnodePrinterId : null,
        createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return printerDto(row);
  },
  audit: (input, r) => ({
    action: 'badges.printer.create',
    targetType: 'printer',
    targetId: r.id,
    data: { eventId: input.eventId, adapter: input.adapter },
  }),
});

/** Archive a printer: it leaves the lists and the watchdog; its print log stays. */
export const archivePrinterCommand = tenantCommand({
  name: 'badges.archivePrinter',
  input: z.object({ eventId: z.uuid(), printerId: z.uuid() }),
  output: PrinterDto,
  entitlement: 'badges',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const p = await printerOfTx(tx, input.eventId, input.printerId, true);
    if (p.archivedAt) return printerDto(p);
    const [row] = await tx
      .update(printers)
      .set({ archivedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(printers.id, p.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return printerDto(row);
  },
  audit: (input) => ({
    action: 'badges.printer.archive',
    targetType: 'printer',
    targetId: input.printerId,
    data: { eventId: input.eventId },
  }),
});

export const PrintingSetupDto = z.object({
  printers: z.array(PrinterDto),
  /** PrintNode printers can be added (the org's account is open and the platform has PrintNode). */
  printnodeEnabled: z.boolean(),
});
export type PrintingSetupDto = z.infer<typeof PrintingSetupDto>;

/** The event's printers (archived ones only on request) and whether PrintNode is on. */
export const printingSetupQuery = tenantQuery({
  name: 'badges.printingSetup',
  input: z.object({ eventId: z.uuid(), includeArchived: z.boolean().default(false) }),
  output: PrintingSetupDto,
  entitlement: 'badges',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    const rows = await tx
      .select()
      .from(printers)
      .where(
        and(
          eq(printers.eventId, input.eventId),
          input.includeArchived ? undefined : isNull(printers.archivedAt),
        ),
      )
      .orderBy(printers.createdAt);
    return { printers: rows.map(printerDto), printnodeEnabled: await printNodeEnabledTx(tx) };
  },
});

/** Platform staff switch PrintNode on (or off) for an org once its PrintNode account is open. */
export const setPrintNodeCommand = tenantCommand({
  name: 'badges.setPrintNode',
  input: z.object({ enabled: z.boolean() }),
  output: z.object({ printnodeEnabled: z.boolean() }),
  entitlement: null,
  permission: 'platform:badges.printnode',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .insert(printSettings)
      .values({ orgId: requireOrg(ctx), printnodeEnabled: input.enabled })
      .onConflictDoUpdate({
        target: [printSettings.orgId],
        set: { printnodeEnabled: input.enabled, updatedAt: ctx.now },
      });
    return { printnodeEnabled: input.enabled };
  },
  audit: (input) => ({
    action: 'badges.printnode.set',
    targetType: 'organization',
    targetId: null,
    data: { enabled: input.enabled },
  }),
});

/* ---------------------------------------------------------------------------- heartbeat ---- */

/** Bring a printer (back) online at `now`; emits `badges.printer_online@1` on a change. */
async function heardFromTx(tx: TenantTx, emit: (e: DomainEvent) => void, p: PrinterRow, now: Date) {
  const changed = comesOnline({
    status: p.status as never,
    lastSeenAt: p.lastSeenAt,
    archived: !!p.archivedAt,
  });
  await tx
    .update(printers)
    .set({ status: 'online', lastSeenAt: now, offlineAt: null, updatedAt: now })
    .where(eq(printers.id, p.id));
  if (changed) emit(stateEvent(PRINTER_ONLINE_EVENT, p, now, null));
  return changed;
}

/**
 * A print station's heartbeat (Stage 1): the desk page with a browser printer open sends one every
 * 30 s. It is the printer's sign of life; silence for 90 s turns it offline.
 */
export const printerHeartbeatCommand = tenantCommand({
  name: 'badges.printerHeartbeat',
  input: z.object({ eventId: z.uuid(), printerId: z.uuid() }),
  output: z.object({ status: z.enum(PRINTER_STATUSES), cameOnline: z.boolean() }),
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const p = await printerOfTx(tx, input.eventId, input.printerId, true);
    if (p.archivedAt) throw new DomainError('invalid_state', 'Printer archived', { reason: 'archived' });
    if (p.adapter !== 'browser')
      throw new DomainError('invalid_state', 'PrintNode reports this printer', { reason: 'not_a_station' });
    return { status: 'online' as const, cameOnline: await heardFromTx(tx, emit, p, ctx.now) };
  },
  // A heartbeat every 30 s is not a change anyone acts on: only coming online is audited data.
  audit: (input, r) => ({
    action: 'badges.printer.heartbeat',
    targetType: 'printer',
    targetId: input.printerId,
    data: { cameOnline: r.cameOnline },
  }),
});

const SYSTEM_PERMISSION = 'platform:badges.printers';

/** What PrintNode reported for the org's printers (the worker's poll): online ones are heard from. */
export const recordPrinterStatesCommand = tenantCommand({
  name: 'badges.recordPrinterStates',
  input: z.object({
    states: z.array(z.object({ printerId: z.uuid(), state: z.enum(['online', 'offline']) })).max(500),
  }),
  output: z.object({ heard: z.int(), cameOnline: z.int() }),
  entitlement: 'badges',
  permission: SYSTEM_PERMISSION,
  handler: async ({ input, ctx, tx, emit }) => {
    const online = input.states.filter((s) => s.state === 'online').map((s) => s.printerId);
    if (online.length === 0) return { heard: 0, cameOnline: 0 };
    const rows = await tx
      .select()
      .from(printers)
      .where(and(inArray(printers.id, online), isNull(printers.archivedAt)))
      .orderBy(printers.id)
      .for('update', { skipLocked: true });
    let came = 0;
    for (const p of rows) if (await heardFromTx(tx, emit, p, ctx.now)) came += 1;
    return { heard: rows.length, cameOnline: came };
  },
  audit: (_input, r) => ({
    action: 'badges.printer.states',
    targetType: 'printer',
    targetId: null,
    data: { heard: r.heard, cameOnline: r.cameOnline },
  }),
});

/**
 * The watchdog step for one org: every online printer silent for 90 s turns offline, once, and
 * emits `badges.printer_offline@1`. Rows are claimed with SKIP LOCKED and only while online, so two
 * runners (or a rerun) never emit twice for one silence.
 */
export const markQuietPrintersCommand = tenantCommand({
  name: 'badges.markQuietPrinters',
  input: z.object({}),
  output: z.object({ offline: z.array(z.uuid()) }),
  entitlement: 'badges',
  permission: SYSTEM_PERMISSION,
  handler: async ({ ctx, tx, emit }) => {
    const before = new Date(ctx.now.getTime() - PRINTER_OFFLINE_AFTER_MS);
    const rows = await tx
      .select()
      .from(printers)
      .where(
        and(
          eq(printers.status, 'online'),
          isNull(printers.archivedAt),
          sql`${printers.lastSeenAt} <= ${before.toISOString()}::timestamptz`,
        ),
      )
      .orderBy(printers.id)
      .for('update', { skipLocked: true });
    const offline: string[] = [];
    for (const p of rows) {
      if (
        !p.lastSeenAt ||
        !goesQuiet({ status: 'online', lastSeenAt: p.lastSeenAt, archived: false }, ctx.now)
      )
        continue;
      const at = offlineAt(p.lastSeenAt);
      await tx
        .update(printers)
        .set({ status: 'offline', offlineAt: at, updatedAt: ctx.now })
        .where(and(eq(printers.id, p.id), eq(printers.status, 'online')));
      emit(stateEvent(PRINTER_OFFLINE_EVENT, p, p.lastSeenAt, at));
      offline.push(p.id);
    }
    return { offline };
  },
  audit: (_input, r) => ({
    action: 'badges.printer.offline',
    targetType: 'printer',
    targetId: r.offline.length === 1 ? (r.offline[0] ?? null) : null,
    data: { printers: r.offline },
  }),
});

const systemCtx = (orgId: string, now?: Date): Ctx => {
  const c = createCtx({ orgId, actor: { type: 'system', name: 'badges.printers' } });
  return now ? { ...c, now } : c;
};

/** The watchdog for one org (the worker's tick, and the dev drain with a clock ahead). */
export async function watchQuietPrinters(
  orgId: string,
  ports: CommandPorts<TenantTx>,
  opts: { now?: Date } = {},
): Promise<string[]> {
  return (await executeCommand(markQuietPrintersCommand, {}, systemCtx(orgId, opts.now), ports)).offline;
}

/**
 * Ask PrintNode about the org's PrintNode printers and record the online ones as heard from (the
 * worker polls every 30 s; the watchdog does the rest). A PrintNode outage counts as silence.
 */
export async function pollPrintNodePrinters(
  orgId: string,
  ports: CommandPorts<TenantTx>,
  printNode: BadgePrinter,
  opts: { now?: Date } = {},
): Promise<{ heard: number; cameOnline: number }> {
  const ctx = systemCtx(orgId, opts.now);
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ id: printers.id, ref: printers.printnodePrinterId })
      .from(printers)
      .where(and(eq(printers.adapter, 'printnode'), isNull(printers.archivedAt))),
  );
  const refs = rows.flatMap((r) => (r.ref ? [{ id: r.id, ref: r.ref }] : []));
  if (refs.length === 0) return { heard: 0, cameOnline: 0 };
  const reported = await printNode.states(
    orgId,
    refs.map((r) => r.ref),
  );
  const states = refs.flatMap((r) => {
    const s = reported.get(r.ref);
    return s ? [{ printerId: r.id, state: s }] : [];
  });
  return executeCommand(recordPrinterStatesCommand, { states }, ctx, ports);
}

/* --------------------------------------------------------------------------- print jobs ---- */

export const PrintJobDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  ticketId: z.uuid(),
  printerId: z.uuid().nullable(),
  adapter: z.enum(PRINTER_ADAPTERS),
  kind: z.enum(PRINT_KINDS),
  reason: z.enum(PRINT_REASONS),
  note: z.string().nullable(),
  status: z.enum(PRINT_JOB_STATUSES),
  source: z.enum(PRINT_SOURCES),
  errorCode: z.string().nullable(),
  createdAt: z.date(),
  sentAt: z.date().nullable(),
});
export type PrintJobDto = z.infer<typeof PrintJobDto>;

type JobRow = typeof printJobs.$inferSelect;
const jobDto = (j: JobRow): PrintJobDto => PrintJobDto.parse(j);

/** Prints of a ticket that count (every job that did not fail). */
async function priorPrintsTx(tx: TenantTx, ticketId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(printJobs)
    .where(and(eq(printJobs.ticketId, ticketId), ne(printJobs.status, 'failed')));
  return r?.n ?? 0;
}

/**
 * Print (or reprint) one badge: the job is logged first, with its kind and reason, then handed
 * over. A browser job is `sent` at once (its PDF opens in the desk's print dialog); a PrintNode
 * job is `queued` until `sendPrintJob` hands it to PrintNode. Idempotent per `requestKey`.
 */
export const startPrintJobCommand = tenantCommand({
  name: 'badges.startPrintJob',
  input: z.object({
    eventId: z.uuid(),
    ticketId: z.uuid(),
    /** Null: the browser's print dialog on this device. */
    printerId: z.uuid().nullable().default(null),
    reason: z.enum(PRINT_REASONS).nullable().default(null),
    note: z
      .string()
      .trim()
      .max(MAX_PRINT_NOTE)
      .nullable()
      .default(null)
      .transform((v) => v || null),
    source: z.enum(PRINT_SOURCES).default('desk'),
    locale: z
      .string()
      .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
      .default('en'),
    requestKey: z.string().trim().min(8).max(80),
  }),
  output: PrintJobDto,
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const [prior] = await tx.select().from(printJobs).where(eq(printJobs.requestKey, input.requestKey));
    if (prior) {
      if (prior.ticketId !== input.ticketId) throw new DomainError('conflict', 'Request key already used');
      return jobDto(prior);
    }
    await eventOfTx(tx, input.eventId);
    const printable = await badgePrintableTx(tx, input.eventId, input.ticketId);
    if (!printable) throw new DomainError('not_found', 'Ticket not found');
    if (!printable.hasTemplate)
      throw new DomainError('invalid_state', 'Create a badge template first', { reason: 'no_template' });
    const printer = input.printerId ? await printerOfTx(tx, input.eventId, input.printerId) : null;
    if (printer?.archivedAt)
      throw new DomainError('invalid_state', 'Printer archived', { reason: 'archived', field: 'printerId' });
    if (printer?.adapter === 'printnode' && !(await printNodeEnabledTx(tx)))
      throw new DomainError('invalid_state', 'PrintNode is off', {
        reason: 'printnode_off',
        field: 'printerId',
      });
    // Two desks printing the same badge at once: one waits for the other, so one is the reprint.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`badges.print:${input.ticketId}`}, 0))`,
    );
    const kind = printKindFor(await priorPrintsTx(tx, input.ticketId));
    const problem = reasonProblem(kind, input.reason, input.note);
    if (problem)
      throw new DomainError('validation_failed', 'Reprint reason', {
        reason: problem,
        field: problem === 'note_required' ? 'note' : 'reason',
      });
    const adapter = printer?.adapter ?? 'browser';
    const [row] = await tx
      .insert(printJobs)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        ticketId: input.ticketId,
        printerId: printer?.id ?? null,
        adapter,
        kind,
        reason: kind === 'print' ? 'first_print' : (input.reason ?? 'other'),
        note: input.note,
        status: adapter === 'browser' ? 'sent' : 'queued',
        sentAt: adapter === 'browser' ? ctx.now : null,
        source: input.source,
        locale: input.locale,
        requestKey: input.requestKey,
        requestedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return jobDto(row);
  },
  audit: (input, r) => ({
    action: r.kind === 'reprint' ? 'badges.reprint' : 'badges.print',
    targetType: 'ticket',
    targetId: input.ticketId,
    data: { jobId: r.id, eventId: input.eventId, printerId: r.printerId, reason: r.reason, source: r.source },
  }),
});

/** The outcome of handing a PrintNode job over (or of rendering it). */
export const recordPrintResultCommand = tenantCommand({
  name: 'badges.recordPrintResult',
  input: z.object({
    jobId: z.uuid(),
    ok: z.boolean(),
    providerJobId: z.string().max(40).nullable().default(null),
    errorCode: z
      .string()
      .regex(/^[a-z0-9_]{1,40}$/)
      .nullable()
      .default(null),
  }),
  output: PrintJobDto,
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => {
    const [j] = await tx.select().from(printJobs).where(eq(printJobs.id, input.jobId)).for('update');
    if (!j) throw new DomainError('not_found', 'Print job not found');
    if (j.status !== 'queued') return jobDto(j);
    const [row] = await tx
      .update(printJobs)
      .set(
        input.ok
          ? { status: 'sent', providerJobId: input.providerJobId, sentAt: ctx.now, updatedAt: ctx.now }
          : { status: 'failed', errorCode: input.errorCode ?? 'failed', updatedAt: ctx.now },
      )
      .where(eq(printJobs.id, j.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return jobDto(row);
  },
  audit: (input, r) => ({
    action: 'badges.print.result',
    targetType: 'print_job',
    targetId: input.jobId,
    data: { status: r.status, errorCode: r.errorCode },
  }),
});

const JobBadgeDto = z.object({
  html: z.string(),
  title: z.string(),
  printnodePrinterId: z.int().nullable(),
  eventId: z.uuid(),
});

/** A print job's badge HTML (the template it prints with now) and its queue title. */
async function jobBadgeTx(tx: TenantTx, ctx: Ctx, jobId: string, forBrowser: boolean) {
  const [j] = await tx.select().from(printJobs).where(eq(printJobs.id, jobId));
  if (!j) throw new DomainError('not_found', 'Print job not found');
  if (forBrowser) {
    // A browser job's PDF opens for a short while after the job, and never for PrintNode jobs.
    if (j.adapter !== 'browser' || j.createdAt.getTime() + PRINT_PDF_TTL_MS <= ctx.now.getTime())
      throw new DomainError('not_found', 'Print job not found', { reason: 'expired' });
  } else if (j.status !== 'queued') throw new DomainError('invalid_state', 'Already handed over');
  const [p] = j.printerId
    ? await tx.select({ ref: printers.printnodePrinterId }).from(printers).where(eq(printers.id, j.printerId))
    : [];
  const one = await oneBadgeHtmlTx(tx, requireOrg(ctx), j.eventId, j.ticketId, j.locale);
  return {
    html: one.html,
    title: `${one.eventName} · ${one.holderName}`,
    printnodePrinterId: p?.ref ?? null,
    eventId: j.eventId,
  };
}

/** A queued PrintNode job's badge (the sender renders it outside any transaction). */
const queuedJobBadgeQuery = tenantQuery({
  name: 'badges.queuedJobBadge',
  input: z.object({ jobId: z.uuid() }),
  output: JobBadgeDto,
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => jobBadgeTx(tx, ctx, input.jobId, false),
});

/** A browser print job's badge (the job PDF route renders it for the desk's print dialog). */
export const browserJobBadgeQuery = tenantQuery({
  name: 'badges.browserJobBadge',
  input: z.object({ jobId: z.uuid() }),
  output: JobBadgeDto,
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, ctx, tx }) => jobBadgeTx(tx, ctx, input.jobId, true),
});

export interface SendPrintDeps {
  readonly ports: CommandPorts<TenantTx>;
  readonly renderer: PdfRenderer | null;
  readonly printNode: BadgePrinter | null;
}

/**
 * Hand a queued PrintNode job to PrintNode: render the badge (outside any transaction), submit it
 * with the job id as the idempotency key, and record the outcome. Without a renderer or PrintNode,
 * or when either fails, the job is `failed` with a code (the log shows it; printing again is still
 * a first print).
 */
export async function sendPrintJob(deps: SendPrintDeps, ctx: Ctx, jobId: string): Promise<PrintJobDto> {
  const fail = (code: string) =>
    executeCommand(recordPrintResultCommand, { jobId, ok: false, errorCode: code }, ctx, deps.ports);
  const badge = await executeQuery(queuedJobBadgeQuery, { jobId }, ctx, deps.ports);
  if (!deps.printNode) return fail('printnode_unavailable');
  if (!deps.renderer) return fail('renderer_unavailable');
  let pdf: Uint8Array;
  try {
    pdf = await deps.renderer.render({ html: badge.html });
  } catch {
    return fail('render_failed');
  }
  const r = await deps.printNode.submit({
    orgId: requireOrg(ctx),
    printnodePrinterId: badge.printnodePrinterId,
    title: badge.title,
    pdf,
    idempotencyKey: jobId,
  });
  return r.ok
    ? executeCommand(
        recordPrintResultCommand,
        { jobId, ok: true, providerJobId: r.providerJobId },
        ctx,
        deps.ports,
      )
    : fail(r.code.replace(/[^a-z0-9_]/g, '_').slice(0, 40) || 'failed');
}

/* ---------------------------------------------------------------------------- print log ---- */

export const PrintLogEntryDto = PrintJobDto.extend({
  holderName: z.string(),
  printerName: z.string().nullable(),
});
export type PrintLogEntryDto = z.infer<typeof PrintLogEntryDto>;

/**
 * The event's print log, newest first (optionally one ticket's or one printer's). The holder's
 * name comes from the badge row (active tickets); a voided ticket's entries show no name.
 */
export const printLogQuery = tenantQuery({
  name: 'badges.printLog',
  input: z.object({
    eventId: z.uuid(),
    ticketId: z.uuid().optional(),
    printerId: z.uuid().optional(),
    kind: z.enum(PRINT_KINDS).optional(),
    limit: z.int().min(1).max(200).default(50),
  }),
  output: z.object({ entries: z.array(PrintLogEntryDto), prints: z.int(), reprints: z.int() }),
  entitlement: 'badges',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    await eventOfTx(tx, input.eventId);
    const where = and(
      eq(printJobs.eventId, input.eventId),
      input.ticketId ? eq(printJobs.ticketId, input.ticketId) : undefined,
      input.printerId ? eq(printJobs.printerId, input.printerId) : undefined,
      input.kind ? eq(printJobs.kind, input.kind) : undefined,
    );
    const rows = await tx
      .select({ job: printJobs, printerName: printers.name })
      .from(printJobs)
      .leftJoin(printers, eq(printers.id, printJobs.printerId))
      .where(where)
      .orderBy(desc(printJobs.createdAt), desc(printJobs.id))
      .limit(input.limit);
    const totals = await tx
      .select({ kind: printJobs.kind, n: count() })
      .from(printJobs)
      .where(and(where, ne(printJobs.status, 'failed')))
      .groupBy(printJobs.kind);
    const names = await holderNamesTx(tx, input.eventId, [...new Set(rows.map((r) => r.job.ticketId))]);
    return {
      entries: rows.map((r) =>
        PrintLogEntryDto.parse({
          ...r.job,
          holderName: names.get(r.job.ticketId) ?? '',
          printerName: r.printerName,
        }),
      ),
      prints: totals.find((t) => t.kind === 'print')?.n ?? 0,
      reprints: totals.find((t) => t.kind === 'reprint')?.n ?? 0,
    };
  },
});

async function holderNamesTx(tx: TenantTx, eventId: string, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return new Map<string, string>();
  const tickets = await badgeTicketsTx(tx, { eventId, ticketIds: [...ticketIds] });
  return new Map(tickets.map((t) => [t.id, t.holderName]));
}

export const BadgePrintStateDto = z.object({
  ticketId: z.uuid(),
  holderName: z.string(),
  typeName: z.string(),
  serial: z.int(),
  hasTemplate: z.boolean(),
  /** Prints that count (jobs that did not fail): the next one is a reprint when > 0. */
  prints: z.int(),
  nextKind: z.enum(PRINT_KINDS),
  lastPrintedAt: z.date().nullable(),
});
export type BadgePrintStateDto = z.infer<typeof BadgePrintStateDto>;

/** One ticket's badge: who, whether it can print, and how often it has been printed. */
export const badgePrintStateQuery = tenantQuery({
  name: 'badges.printState',
  input: z.object({ eventId: z.uuid(), ticketId: z.uuid() }),
  output: BadgePrintStateDto,
  entitlement: 'badges',
  permission: 'attendees:write',
  handler: async ({ input, tx }) => {
    const p = await badgePrintableTx(tx, input.eventId, input.ticketId);
    if (!p) throw new DomainError('not_found', 'Ticket not found');
    const prints = await priorPrintsTx(tx, input.ticketId);
    const [last] = await tx
      .select({ at: printJobs.createdAt })
      .from(printJobs)
      .where(and(eq(printJobs.ticketId, input.ticketId), ne(printJobs.status, 'failed')))
      .orderBy(desc(printJobs.createdAt))
      .limit(1);
    return {
      ticketId: p.ticket.id,
      holderName: p.ticket.holderName,
      typeName: p.ticket.typeName,
      serial: p.ticket.serial,
      hasTemplate: p.hasTemplate,
      prints,
      nextKind: printKindFor(prints),
      lastPrintedAt: last?.at ?? null,
    };
  },
});
