import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { memberUserIdsTx, ORG_ROLES, type OrgRole, roleCan } from '@yayatoh/tenancy';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { actorCanTx, memberUserId } from '../access.ts';
import { dayIn } from '../compute.ts';
import { addDays } from '../dashboard.ts';
import { reportFiles, reportRuns, reportSchedules } from '../schema.ts';
import { orgTimeZoneTx } from '../sync.ts';
import {
  MAX_RECIPIENTS,
  MAX_SCHEDULES_PER_ORG,
  REPORT_FREQUENCIES,
  REPORT_RUN_STATUSES,
  type ReportFrequency,
} from './catalog.ts';
import { periodContaining, periodDueAt } from './period.ts';

/**
 * Scheduled PDF reports (M6.2b): owners and admins (`org:update`) choose a frequency, a send hour
 * (org time) and members to receive it; every member with `orders:read` can open the reports.
 * A recipient must be a member who can read orders; revenue is in their PDF only if their role
 * may see finance (decided when each period is sent).
 */
const ScheduleFields = z.object({
  name: z.string().trim().min(1).max(80),
  frequency: z.enum(REPORT_FREQUENCIES),
  sendHour: z.int().min(0).max(23).default(8),
  eventId: z.uuid().nullable().default(null),
  recipients: z.array(z.uuid()).min(1).max(MAX_RECIPIENTS),
});

export const ReportScheduleDto = z.object({
  id: z.uuid(),
  name: z.string(),
  frequency: z.enum(REPORT_FREQUENCIES),
  sendHour: z.int(),
  eventId: z.uuid().nullable(),
  recipients: z.array(z.uuid()),
  enabled: z.boolean(),
  timeZone: z.string(),
  /** When the next period goes out (org time zone), null when switched off. */
  nextSendAt: z.date().nullable(),
  createdAt: z.date(),
});
export type ReportScheduleDto = z.infer<typeof ReportScheduleDto>;

type ScheduleRow = typeof reportSchedules.$inferSelect;

/** When the schedule's next period goes out: the first period due after now (and after it was switched on). */
export function nextSendAt(
  s: Pick<ScheduleRow, 'frequency' | 'sendHour' | 'activeSince'>,
  tz: string,
  now: Date,
): Date {
  const frequency = s.frequency as ReportFrequency;
  // The last complete period may still be due later today; start there and walk forward.
  let p = periodContaining(frequency, addDays(periodContaining(frequency, dayIn(now, tz)).from, -1));
  for (;;) {
    const due = periodDueAt(p, tz, s.sendHour);
    if (due.getTime() > now.getTime() && due.getTime() >= s.activeSince.getTime()) return due;
    p = periodContaining(frequency, addDays(p.to, 1));
  }
}

const toDto = (r: ScheduleRow, tz: string, now: Date): ReportScheduleDto =>
  ReportScheduleDto.parse({
    id: r.id,
    name: r.name,
    frequency: r.frequency,
    sendHour: r.sendHour,
    eventId: r.eventId,
    recipients: r.recipients,
    enabled: r.enabled,
    timeZone: tz,
    nextSendAt: r.enabled ? nextSendAt(r, tz, now) : null,
    createdAt: r.createdAt,
  });

/** Recipients must be members who can read orders (the report is the org dashboard). */
async function checkRecipientsTx(tx: TenantTx, ids: readonly string[]) {
  const members = new Map((await memberUserIdsTx(tx, ORG_ROLES)).map((m) => [m.userId, m.role] as const));
  const bad = [...new Set(ids)].filter((id) => {
    const role = members.get(id);
    return !role || !roleCan(role as OrgRole, 'orders:read');
  });
  if (bad.length)
    throw new DomainError('validation_failed', 'Every recipient must be a member who can see orders', {
      reason: 'bad_recipient',
    });
}

async function checkEventTx(tx: TenantTx, eventId: string | null) {
  if (eventId && !(await findEventTx(tx, eventId))) throw new DomainError('not_found', 'Event not found');
}

async function nameTakenTx(tx: TenantTx, name: string, except?: string) {
  const rows = await tx.select({ id: reportSchedules.id, name: reportSchedules.name }).from(reportSchedules);
  return rows.some((r) => r.id !== except && r.name.toLowerCase() === name.toLowerCase());
}

const tzOf = (tx: TenantTx, ctx: Ctx) => orgTimeZoneTx(tx, requireOrg(ctx));

export const listReportSchedulesQuery = tenantQuery({
  name: 'analytics.listReportSchedules',
  input: z.object({}),
  output: z.array(ReportScheduleDto),
  entitlement: 'analytics_pro',
  permission: 'org:update',
  handler: async ({ ctx, tx }) => {
    const tz = await tzOf(tx, ctx);
    const rows = await tx.select().from(reportSchedules).orderBy(asc(reportSchedules.name));
    return rows.map((r) => toDto(r, tz, ctx.now));
  },
});

export const getReportScheduleQuery = tenantQuery({
  name: 'analytics.getReportSchedule',
  input: z.object({ scheduleId: z.uuid() }),
  output: ReportScheduleDto,
  entitlement: 'analytics_pro',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx.select().from(reportSchedules).where(eq(reportSchedules.id, input.scheduleId));
    if (!row) throw new DomainError('not_found', 'Schedule not found');
    return toDto(row, await tzOf(tx, ctx), ctx.now);
  },
});

export const createReportScheduleCommand = tenantCommand({
  name: 'analytics.createReportSchedule',
  input: ScheduleFields,
  output: ReportScheduleDto,
  entitlement: 'analytics_pro',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    await checkRecipientsTx(tx, input.recipients);
    await checkEventTx(tx, input.eventId);
    if (await nameTakenTx(tx, input.name))
      throw new DomainError('conflict', 'A schedule with this name exists', { reason: 'name_taken' });
    if ((await tx.select({ id: reportSchedules.id }).from(reportSchedules)).length >= MAX_SCHEDULES_PER_ORG)
      throw new DomainError('validation_failed', 'Too many schedules', { reason: 'too_many_schedules' });
    const [row] = await tx
      .insert(reportSchedules)
      .values({
        orgId: requireOrg(ctx),
        ...input,
        recipients: [...new Set(input.recipients)],
        createdBy: memberUserId(ctx),
        // The schedule starts now: only periods due from now on are sent.
        activeSince: ctx.now,
      })
      .returning();
    if (!row) throw new Error('createReportSchedule: insert returned nothing');
    return toDto(row, await tzOf(tx, ctx), ctx.now);
  },
  audit: (_i, out) => ({
    action: 'analytics.report_schedule_created',
    targetType: 'analytics_report_schedule',
    targetId: out.id,
    data: { kind: out.frequency, count: out.recipients.length },
  }),
});

export const updateReportScheduleCommand = tenantCommand({
  name: 'analytics.updateReportSchedule',
  input: ScheduleFields.extend({ scheduleId: z.uuid() }),
  output: ReportScheduleDto,
  entitlement: 'analytics_pro',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const { scheduleId, ...f } = input;
    await checkRecipientsTx(tx, f.recipients);
    await checkEventTx(tx, f.eventId);
    if (await nameTakenTx(tx, f.name, scheduleId))
      throw new DomainError('conflict', 'A schedule with this name exists', { reason: 'name_taken' });
    const [row] = await tx
      .update(reportSchedules)
      .set({ ...f, recipients: [...new Set(f.recipients)], updatedAt: ctx.now })
      .where(eq(reportSchedules.id, scheduleId))
      .returning();
    if (!row) throw new DomainError('not_found', 'Schedule not found');
    return toDto(row, await tzOf(tx, ctx), ctx.now);
  },
  audit: (input) => ({
    action: 'analytics.report_schedule_updated',
    targetType: 'analytics_report_schedule',
    targetId: input.scheduleId,
    data: { kind: input.frequency, count: input.recipients.length },
  }),
});

export const setReportScheduleEnabledCommand = tenantCommand({
  name: 'analytics.setReportScheduleEnabled',
  input: z.object({ scheduleId: z.uuid(), enabled: z.boolean() }),
  output: ReportScheduleDto,
  entitlement: 'analytics_pro',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(reportSchedules)
      // Switching back on starts again from now: the periods missed while off are not sent.
      .set({
        enabled: input.enabled,
        updatedAt: ctx.now,
        ...(input.enabled ? { activeSince: ctx.now } : {}),
      })
      .where(eq(reportSchedules.id, input.scheduleId))
      .returning();
    if (!row) throw new DomainError('not_found', 'Schedule not found');
    return toDto(row, await tzOf(tx, ctx), ctx.now);
  },
  audit: (input) => ({
    action: input.enabled ? 'analytics.report_schedule_enabled' : 'analytics.report_schedule_disabled',
    targetType: 'analytics_report_schedule',
    targetId: input.scheduleId,
  }),
});

export const deleteReportScheduleCommand = tenantCommand({
  name: 'analytics.deleteReportSchedule',
  input: z.object({ scheduleId: z.uuid() }),
  output: z.object({ deleted: z.literal(true) }),
  entitlement: 'analytics_pro',
  permission: 'org:update',
  category: 'delete',
  handler: async ({ input, tx }) => {
    const gone = await tx
      .delete(reportSchedules)
      .where(eq(reportSchedules.id, input.scheduleId))
      .returning({ id: reportSchedules.id });
    if (!gone.length) throw new DomainError('not_found', 'Schedule not found');
    return { deleted: true as const };
  },
  audit: (input) => ({
    action: 'analytics.report_schedule_deleted',
    targetType: 'analytics_report_schedule',
    targetId: input.scheduleId,
  }),
});

export const ReportRunDto = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  scheduleName: z.string(),
  periodKey: z.string(),
  periodFrom: z.iso.date(),
  periodTo: z.iso.date(),
  status: z.enum(REPORT_RUN_STATUSES),
  recipientsSent: z.int(),
  sentAt: z.date().nullable(),
  /** The caller's PDF (their language, with or without revenue), when it was made. */
  fileId: z.uuid().nullable(),
});
export type ReportRunDto = z.infer<typeof ReportRunDto>;

/** Recent periods of the org's schedules, with the caller's own PDF where there is one. */
export const listReportRunsQuery = tenantQuery({
  name: 'analytics.listReportRuns',
  input: z.object({ limit: z.int().min(1).max(100).default(20), locale: z.string().max(10).default('en') }),
  output: z.array(ReportRunDto),
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const finance = await actorCanTx(tx, ctx, 'finance:read');
    const rows = await tx
      .select({ run: reportRuns, name: reportSchedules.name })
      .from(reportRuns)
      .innerJoin(
        reportSchedules,
        and(eq(reportSchedules.orgId, reportRuns.orgId), eq(reportSchedules.id, reportRuns.scheduleId)),
      )
      .orderBy(desc(reportRuns.periodTo), desc(reportRuns.createdAt))
      .limit(input.limit);
    const ids = rows.map((r) => r.run.id);
    const files = ids.length
      ? await tx
          .select({
            id: reportFiles.id,
            runId: reportFiles.runId,
            locale: reportFiles.locale,
            finance: reportFiles.finance,
          })
          .from(reportFiles)
          .where(and(inArray(reportFiles.runId, ids), eq(reportFiles.finance, finance)))
      : [];
    return rows.map(({ run, name }) => {
      const mine = files.filter((f) => f.runId === run.id);
      const file =
        mine.find((f) => f.locale === input.locale) ?? mine.find((f) => f.locale === 'en') ?? mine[0];
      return ReportRunDto.parse({
        id: run.id,
        scheduleId: run.scheduleId,
        scheduleName: name,
        periodKey: run.periodKey,
        periodFrom: run.periodFrom,
        periodTo: run.periodTo,
        status: run.status,
        recipientsSent: run.recipientsSent,
        sentAt: run.sentAt,
        fileId: file?.id ?? null,
      });
    });
  },
});

/**
 * One report PDF for the console's download route: any member who can read orders; a PDF with
 * revenue only for members who can see finance (others get not found).
 */
export const reportFileQuery = tenantQuery({
  name: 'analytics.reportFile',
  input: z.object({ fileId: z.uuid() }),
  output: z.object({
    filename: z.string(),
    pdf: z.custom<Uint8Array>((v) => v instanceof Uint8Array),
  }),
  entitlement: 'analytics_pro',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const [f] = await tx
      .select({ pdf: reportFiles.pdf, finance: reportFiles.finance, key: reportRuns.periodKey })
      .from(reportFiles)
      .innerJoin(
        reportRuns,
        and(eq(reportRuns.orgId, reportFiles.orgId), eq(reportRuns.id, reportFiles.runId)),
      )
      .where(eq(reportFiles.id, input.fileId));
    if (!f || (f.finance && !(await actorCanTx(tx, ctx, 'finance:read'))))
      throw new DomainError('not_found', 'Report not found');
    return { filename: `report-${f.key}.pdf`, pdf: f.pdf };
  },
});
