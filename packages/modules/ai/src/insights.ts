import { createHash } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  cleanInsights,
  INSIGHTS_MAX_ANSWERS,
  InsightAnswer,
  InsightResultDto,
  insightCredits,
} from './domain/insights.ts';
import type { AiDrafter } from './drafter.ts';
import { aiInsights } from './schema.ts';
import { chargedCall, eventCredits, messagingCredits, withTimeout } from './spend.ts';

const SUBJECTS = ['reviews', 'survey'] as const;
type Subject = (typeof SUBJECTS)[number];

export const SavedInsightDto = z.object({
  result: InsightResultDto,
  inputHash: z.string(),
  basedOn: z.int(),
  total: z.int(),
  model: z.string(),
  updatedAt: z.date(),
});
export type SavedInsightDto = z.infer<typeof SavedInsightDto>;

const Ref = z.object({ subjectId: z.uuid() });

function insightOps(subject: Subject, read: string, write: string, key: string) {
  const query = tenantQuery({
    name: `ai.${key}Insight`,
    input: Ref,
    output: SavedInsightDto.nullable(),
    entitlement: 'ai',
    permission: read,
    handler: async ({ input, tx }) => {
      const [row] = await tx
        .select()
        .from(aiInsights)
        .where(and(eq(aiInsights.subject, subject), eq(aiInsights.subjectId, input.subjectId)));
      if (!row) return null;
      return {
        result: InsightResultDto.parse(row.result),
        inputHash: row.inputHash,
        basedOn: row.basedOn,
        total: row.total,
        model: row.model,
        updatedAt: row.updatedAt,
      };
    },
  });
  const save = tenantCommand({
    name: `ai.save${key[0]?.toUpperCase()}${key.slice(1)}Insight`,
    input: Ref.extend({
      eventId: z.uuid(),
      inputHash: z.string().max(64),
      result: InsightResultDto,
      basedOn: z.int(),
      total: z.int(),
      model: z.string().max(80),
    }),
    output: z.object({ id: z.uuid() }),
    entitlement: 'ai',
    permission: write,
    handler: async ({ input, ctx, tx }) => {
      const values = {
        eventId: input.eventId,
        inputHash: input.inputHash,
        result: input.result,
        basedOn: input.basedOn,
        total: input.total,
        model: input.model,
        updatedAt: ctx.now,
      };
      const [row] = await tx
        .insert(aiInsights)
        .values({ orgId: requireOrg(ctx), subject, subjectId: input.subjectId, ...values })
        .onConflictDoUpdate({
          target: [aiInsights.orgId, aiInsights.subject, aiInsights.subjectId],
          set: values,
        })
        .returning({ id: aiInsights.id });
      if (!row) throw new DomainError('internal');
      return { id: row.id };
    },
    audit: (input) => ({
      action: 'ai.insight.save',
      targetType: subject === 'reviews' ? 'event' : 'survey',
      targetId: input.subjectId,
    }),
  });
  return { query, save };
}

/** Reading a summary follows reading the answers; making one, the power over them. */
const OPS = {
  reviews: insightOps('reviews', 'events:read', 'events:write', 'reviews'),
  survey: insightOps('survey', 'messages:read', 'messages:send', 'survey'),
} as const;
export const reviewsInsightQuery = OPS.reviews.query;
export const surveyInsightQuery = OPS.survey.query;
export const saveReviewsInsightCommand = OPS.reviews.save;
export const saveSurveyInsightCommand = OPS.survey.save;

const PAIRS = { reviews: eventCredits, survey: messagingCredits } as const;

export const SummarizeInput = z.object({
  subject: z.enum(SUBJECTS),
  /** The event for reviews, the survey for a survey. */
  subjectId: z.uuid(),
  eventId: z.uuid(),
  /** Newest first, ids numbered by the caller. */
  answers: z.array(InsightAnswer).min(1).max(INSIGHTS_MAX_ANSWERS),
  /** How many answers exist: the page says "based on the newest X of Y" when they differ. */
  total: z.int().min(1),
  locale: z.string().max(20).default('en'),
});
export type SummarizeInput = z.input<typeof SummarizeInput>;

/** The digest of what a summary read: unchanged answers need no new one. */
export function insightInputHash(
  locale: string,
  answers: readonly { readonly text: string; readonly rating?: number | null }[],
): string {
  const h = createHash('sha256').update(locale);
  for (const a of answers) h.update(`\0${a.rating ?? ''}\0${a.text}`);
  return h.digest('hex');
}

export const SummarizeResultDto = SavedInsightDto.extend({
  /** True: the saved summary still fits, so nothing was spent. */
  cached: z.boolean(),
  balance: z.int().nullable(),
});
export type SummarizeResultDto = z.infer<typeof SummarizeResultDto>;

/**
 * AI1: a summary of an event's reviews or a survey's answers. The caller reads the answers with
 * its own permission and passes only their text and rating, never who wrote them. Unchanged input
 * returns the saved summary at no cost.
 */
export async function summarizeAnswers(
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  drafter: AiDrafter | null,
  raw: SummarizeInput,
): Promise<SummarizeResultDto> {
  const p = SummarizeInput.safeParse(raw);
  if (!p.success) throw new DomainError('validation_failed', 'Invalid answers');
  const input = p.data;
  const ops = OPS[input.subject];
  const inputHash = insightInputHash(input.locale, input.answers);
  const saved = await executeQuery(ops.query, { subjectId: input.subjectId }, ctx, ports);
  if (saved && saved.inputHash === inputHash) return { ...saved, cached: true, balance: null };
  if (!drafter) throw new DomainError('invalid_state', 'AI is off', { reason: 'ai_unavailable' });
  const { value, balance } = await chargedCall(
    ctx,
    ports,
    PAIRS[input.subject],
    { purpose: 'insights', eventId: input.eventId, credits: insightCredits(input.answers.length) },
    async () =>
      cleanInsights(
        await withTimeout(
          drafter.compose({
            task: 'insights',
            locale: input.locale,
            tone: 'formal',
            brand: null,
            orgName: '',
            brief: '',
            subject: input.subject,
            answers: input.answers,
          }),
        ),
        input.answers,
      ),
  );
  const row = {
    result: value,
    inputHash,
    basedOn: input.answers.length,
    total: input.total,
    model: drafter.name,
  };
  await executeCommand(ops.save, { subjectId: input.subjectId, eventId: input.eventId, ...row }, ctx, ports);
  return { ...row, updatedAt: ctx.now, cached: false, balance };
}
