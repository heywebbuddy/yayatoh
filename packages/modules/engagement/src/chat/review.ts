import type { TenantTx } from '@yayatoh/db';
import { actorId, DomainError } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { chatRetentionCutoff, clipExcerpt, EXCERPT_MESSAGES } from '../domain/chat.ts';
import { chatConversations, chatReports } from '../schema.ts';
import { eventOf } from '../state.ts';
import { ChatReportForReviewDto } from './dto.ts';

/**
 * Networking chat reports in Yayatoh's platform review (M1.10d, beside messaging's reports).
 * Read in the staff console's platform_reader transaction (apps/admin; every use lands in the
 * access log), newest first. Allowlisted: the org, the kind, which side reported, the reason and
 * details, the organizer's handling and an excerpt labelled by side; no names or other ids.
 */
export async function chatReportsForReviewTx(
  tx: TenantTx,
  filter: { readonly status: 'open' | 'closed'; readonly limit?: number },
): Promise<ChatReportForReviewDto[]> {
  const rows = await tx.execute<{
    id: string;
    org_id: string;
    org_name: string;
    org_slug: string;
    kind: string;
    reporter: string;
    reason: string;
    details: string | null;
    moderation: string;
    status: string;
    review_note: string | null;
    reviewed_at: string | null;
    created_at: string;
    excerpt: Array<{ sender: string; body: string; removed: boolean; at: string }> | null;
  }>(sql`
    select r.id, r.org_id, o.name as org_name, o.slug as org_slug, c.kind, r.reporter, r.reason,
      r.details, r.moderation, r.status, r.review_note, r.reviewed_at, r.created_at,
      (select json_agg(x order by x.at) from (
         select m.sender, m.body, m.removed_at is not null as removed, m.created_at as at
         from engagement.chat_messages m
         where m.org_id = r.org_id and m.conversation_id = r.conversation_id and m.created_at <= r.created_at
         order by m.created_at desc, m.id desc
         limit ${EXCERPT_MESSAGES}
       ) x) as excerpt
    from engagement.chat_reports r
    join engagement.chat_conversations c on c.org_id = r.org_id and c.id = r.conversation_id
    join tenancy.organizations o on o.id = r.org_id
    where ${filter.status === 'open' ? sql`r.status = 'open'` : sql`r.status <> 'open'`}
    order by ${filter.status === 'open' ? sql`r.created_at` : sql`r.reviewed_at desc, r.created_at`} desc
    limit ${filter.limit ?? 100}`);
  return rows.map((r) =>
    ChatReportForReviewDto.parse({
      id: r.id,
      orgId: r.org_id,
      orgName: r.org_name,
      orgSlug: r.org_slug,
      kind: r.kind,
      // Side b of a booth chat is the exhibitor; every other side is an attendee.
      reporter: r.kind === 'booth' && r.reporter === 'b' ? 'exhibitor' : 'attendee',
      reason: r.reason,
      details: r.details,
      moderation: r.moderation,
      status: r.status,
      reviewNote: r.review_note,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null,
      createdAt: new Date(r.created_at),
      excerpt: (r.excerpt ?? []).map((m) => ({
        from: m.sender === r.reporter ? 'reporter' : 'reported',
        // Staff see a removed message's text too (flagged): they review what was reported.
        text: clipExcerpt(m.body),
        removed: m.removed,
        at: new Date(m.at),
      })),
    }),
  );
}

/**
 * Staff close a chat report (apps/admin): resolved or dismissed, with a note. A platform actor
 * only; audited in the report's org. Closing twice is refused.
 */
export const reviewChatReportCommand = tenantCommand({
  name: 'engagement.reviewChatReport',
  input: z.object({
    reportId: z.uuid(),
    decision: z.enum(['resolved', 'dismissed']),
    note: z.string().trim().min(1).max(1000),
  }),
  output: z.object({ status: z.enum(['resolved', 'dismissed']) }),
  entitlement: null,
  permission: 'platform:engagement.review_chat_report',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(chatReports)
      .set({
        status: input.decision,
        reviewNote: input.note,
        reviewedBy: actorId(ctx.actor),
        reviewedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(and(eq(chatReports.id, input.reportId), eq(chatReports.status, 'open')))
      .returning({ id: chatReports.id });
    if (!row) {
      const [exists] = await tx
        .select({ id: chatReports.id })
        .from(chatReports)
        .where(eq(chatReports.id, input.reportId));
      if (!exists) throw new DomainError('not_found');
      throw new DomainError('invalid_state', 'This report was already reviewed', {
        reason: 'already_reviewed',
      });
    }
    return { status: input.decision };
  },
  audit: (input) => ({
    action: `engagement.chat_report.${input.decision === 'resolved' ? 'resolve' : 'dismiss'}`,
    targetType: 'chat_report',
    targetId: input.reportId,
    data: { decision: input.decision },
  }),
});

/**
 * D11 retention for chat (the worker's daily pass, per org as a system actor): conversations of
 * events that ended more than 24 months ago are deleted with their messages and reports. Returns
 * how many conversations went. Idempotent; audited with the count only.
 */
export const chatRetentionCommand = tenantCommand({
  name: 'engagement.chatRetention',
  category: 'delete',
  input: z.object({}),
  output: z.object({ conversations: z.int().min(0) }),
  entitlement: null,
  permission: 'platform:engagement.chat_retention',
  handler: async ({ ctx, tx }) => {
    const cutoff = chatRetentionCutoff(ctx.now);
    const events = await tx.selectDistinct({ id: chatConversations.eventId }).from(chatConversations);
    const ended: string[] = [];
    for (const { id } of events) {
      const ev = await eventOf(tx, id).catch(() => null);
      if (ev && ev.endsAt < cutoff) ended.push(id);
    }
    if (ended.length === 0) return { conversations: 0 };
    const gone = await tx
      .delete(chatConversations)
      .where(inArray(chatConversations.eventId, ended))
      .returning({ id: chatConversations.id });
    return { conversations: gone.length };
  },
  audit: (_input, r) => ({
    action: 'engagement.chat_retention',
    targetType: 'chat_conversation',
    targetId: null,
    data: { conversations: r?.conversations ?? 0 },
  }),
});
