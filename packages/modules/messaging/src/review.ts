import type { TenantTx } from '@yayatoh/db';
import { actorId, DomainError } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { REPORT_REASONS, REPORT_STATUSES, reports } from './schema.ts';

/** How much of a conversation staff see: the latest messages, each cut to this many characters. */
export const EXCERPT_MESSAGES = 6;
export const EXCERPT_CHARS = 280;

const clip = (s: string | null, n = EXCERPT_CHARS) =>
  s === null ? null : s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * A report as platform staff review it (M1.10d). Allowlisted: the org's name and slug, the
 * reporter's side, reason and note, and an excerpt of the conversation with each side labelled.
 * Never the contact's address, staff names, user ids or other internal ids beyond the report's.
 */
export const ReportForReviewDto = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  orgName: z.string(),
  orgSlug: z.string(),
  reporter: z.enum(['organizer', 'contact']),
  reason: z.enum(REPORT_REASONS),
  note: z.string().nullable(),
  status: z.enum(REPORT_STATUSES),
  reviewNote: z.string().nullable(),
  reviewedAt: z.date().nullable(),
  createdAt: z.date(),
  excerpt: z.array(
    z.object({
      from: z.enum(['contact', 'organizer']),
      /** The message, or an announcement's subject. */
      text: z.string(),
      announcement: z.boolean(),
      at: z.date(),
    }),
  ),
});
export type ReportForReviewDto = z.infer<typeof ReportForReviewDto>;

/**
 * Reports across every org for the staff console. Runs in the caller's platform_reader
 * transaction (apps/admin; every use lands in the access log), newest first.
 */
export async function reportsForReviewTx(
  tx: TenantTx,
  filter: { readonly status: 'open' | 'closed'; readonly limit?: number },
): Promise<ReportForReviewDto[]> {
  const rows = await tx.execute<{
    id: string;
    org_id: string;
    org_name: string;
    org_slug: string;
    reporter: string;
    reason: string;
    note: string | null;
    status: string;
    review_note: string | null;
    reviewed_at: string | null;
    created_at: string;
    excerpt: Array<{ direction: string; body: string | null; subject: string | null; at: string }> | null;
  }>(sql`
    select r.id, r.org_id, o.name as org_name, o.slug as org_slug, r.reporter, r.reason, r.note,
      r.status, r.review_note, r.reviewed_at, r.created_at,
      (select json_agg(x order by x.at) from (
         select m.direction, m.body, a.subject, m.created_at as at
         from messaging.thread_messages m
         left join messaging.announcements a on a.org_id = m.org_id and a.id = m.announcement_id
         where m.org_id = r.org_id and m.thread_id = r.thread_id and m.created_at <= r.created_at
         order by m.created_at desc
         limit ${EXCERPT_MESSAGES}
       ) x) as excerpt
    from messaging.reports r
    join tenancy.organizations o on o.id = r.org_id
    where ${filter.status === 'open' ? sql`r.status = 'open'` : sql`r.status <> 'open'`}
    order by ${filter.status === 'open' ? sql`r.created_at` : sql`r.reviewed_at desc, r.created_at`} desc
    limit ${filter.limit ?? 100}`);
  return rows.map((r) =>
    ReportForReviewDto.parse({
      id: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      reporter: r.reporter,
      reason: r.reason,
      note: clip(r.note, 1000),
      status: r.status,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
      createdAt: new Date(r.created_at),
      excerpt: (r.excerpt ?? []).map((m) => ({
        from: m.direction === 'in' ? 'contact' : 'organizer',
        text: clip(m.body ?? m.subject ?? '') ?? '',
        announcement: m.body === null,
        at: new Date(m.at),
      })),
    }),
  );
}

/**
 * Staff close a report (apps/admin): resolved (acted on) or dismissed (no action), with a note
 * for the record. A platform actor only; audited in the report's org. Closing twice is refused.
 */
export const reviewReportCommand = tenantCommand({
  name: 'messaging.reviewReport',
  input: z.object({
    reportId: z.uuid(),
    decision: z.enum(['resolved', 'dismissed']),
    note: z.string().trim().min(1).max(1000),
  }),
  output: z.object({ status: z.enum(['resolved', 'dismissed']) }),
  entitlement: null,
  permission: 'platform:messaging.review_report',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(reports)
      .set({
        status: input.decision,
        reviewNote: input.note,
        reviewedBy: actorId(ctx.actor),
        reviewedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(and(eq(reports.id, input.reportId), eq(reports.status, 'open')))
      .returning({ id: reports.id });
    if (!row) {
      const [exists] = await tx
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.id, input.reportId));
      if (!exists) throw new DomainError('not_found');
      throw new DomainError('invalid_state', 'This report was already reviewed', {
        reason: 'already_reviewed',
      });
    }
    return { status: input.decision };
  },
  audit: (input) => ({
    action: `messaging.report.${input.decision === 'resolved' ? 'resolve' : 'dismiss'}`,
    targetType: 'report',
    targetId: input.reportId,
    data: { decision: input.decision },
  }),
});
