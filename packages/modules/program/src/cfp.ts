import { isUniqueViolation, type TenantTx, withTenant } from '@yayatoh/db';
import {
  createPortalAccountTx,
  type EventTarget,
  portalAccountsTx,
  portalPrincipalTx,
  revokePortalAccountTx,
  sanitizeMarkdown,
} from '@yayatoh/events';
import {
  currentFormTx,
  FIELD_TYPES,
  FieldDefinition,
  type FormDefinition,
  PublicFormDto,
  publishFormTx,
  subjectResponsesTx,
  submitResponseTx,
} from '@yayatoh/forms';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, type Notifier, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  averageScore,
  type CfpOpenness,
  cfpOpenness,
  checkCoSpeakers,
  draftSessionTimes,
  forReviewer,
} from './domain/cfp.ts';
import { MAX_SPEAKERS_PER_EVENT } from './people.ts';
import { sessionSpeakers, sessions, speakerContacts, speakers, tracks } from './schema.ts';
import {
  CFP_STATUSES,
  cfpAssignments,
  cfpCalls,
  cfpCoSpeakers,
  cfpReviewers,
  cfpReviews,
  cfpSubmissions,
  SUBMISSION_STATUSES,
} from './schema-cfp.ts';
import { MAX_SESSIONS_PER_EVENT } from './sessions.ts';
import { eventOf, invalid } from './shared.ts';

/**
 * M5.3b call for papers. Organizer commands need `events:write` (reads `events:read`); the public
 * form is `public:cfp` (the event comes from its public page, never a header); reviewer commands
 * need `portal:cfp_reviewer` and re-check the portal account, its reviewer row and the assignment
 * in the transaction, so a reviewer only ever reaches submissions assigned to them. Everything
 * needs the `speakers` module (P5-1).
 */

export const MAX_CFP_QUESTIONS = 20;
export const MAX_CFP_REVIEWERS = 100;
export const MAX_SUBMISSIONS_PER_CALL = 2000;

const formSubject = (eventId: string) => ({ kind: 'cfp', subjectType: 'event', subjectId: eventId }) as const;
const Text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null));
const Email = z.email().trim().toLowerCase().max(254);

/* ------------------------------------------------------------------------------- outbox ---- */

/** `program.cfp_submission.received@1` / `.decided@1`: ids only; the mailer reads the rest. */
function submissionEvent(kind: 'received' | 'decided', s: { id: string; eventId: string }): DomainEvent {
  return {
    type: `program.cfp_submission.${kind}`,
    version: 1,
    aggregateType: 'cfp_submission',
    aggregateId: s.id,
    payload: { submissionId: s.id, eventId: s.eventId },
  };
}

/* --------------------------------------------------------------------------------- DTOs ---- */

export const CfpCallDto = z.object({
  status: z.enum(CFP_STATUSES),
  intro: z.string(),
  closesAt: z.date().nullable(),
  blind: z.boolean(),
  durations: z.array(z.int()),
  maxCoSpeakers: z.int(),
});
export type CfpCallDto = z.infer<typeof CfpCallDto>;

const DEFAULT_CALL: CfpCallDto = {
  status: 'draft',
  intro: '',
  closesAt: null,
  blind: false,
  durations: [30, 45],
  maxCoSpeakers: 3,
};

const AnswerDto = z.object({ label: z.string(), value: z.string() });
const CoSpeakerDto = z.object({ name: z.string(), email: z.string() });

export const CfpSubmissionRowDto = z.object({
  id: z.uuid(),
  title: z.string(),
  speakerName: z.string(),
  durationMinutes: z.int(),
  track: z.string().nullable(),
  status: z.enum(SUBMISSION_STATUSES),
  submittedAt: z.date(),
  reviewCount: z.int(),
  reviewerCount: z.int(),
  averageScore: z.number().nullable(),
});
export type CfpSubmissionRowDto = z.infer<typeof CfpSubmissionRowDto>;

export const CfpReviewerDto = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  access: z.enum(['invited', 'active', 'revoked', 'expired', 'none']),
  accountId: z.uuid().nullable(),
  assigned: z.int(),
  reviewed: z.int(),
});
export type CfpReviewerDto = z.infer<typeof CfpReviewerDto>;

export const CfpQuestionDto = z.object({
  key: z.string(),
  type: z.string(),
  label: z.string(),
  required: z.boolean(),
  options: z.array(z.string()),
});

export const CfpOverviewDto = z.object({
  call: CfpCallDto,
  questions: z.array(CfpQuestionDto),
  submissions: z.array(CfpSubmissionRowDto),
  reviewers: z.array(CfpReviewerDto),
});
export type CfpOverviewDto = z.infer<typeof CfpOverviewDto>;

export const CfpSubmissionDetailDto = z.object({
  id: z.uuid(),
  title: z.string(),
  abstract: z.string(),
  durationMinutes: z.int(),
  track: z.string().nullable(),
  status: z.enum(SUBMISSION_STATUSES),
  submittedAt: z.date(),
  speakerName: z.string(),
  speakerEmail: z.string(),
  speakerTitle: z.string().nullable(),
  speakerCompany: z.string().nullable(),
  speakerBio: z.string(),
  coSpeakers: z.array(CoSpeakerDto),
  answers: z.array(AnswerDto),
  decidedAt: z.date().nullable(),
  decisionNote: z.string().nullable(),
  sessionId: z.uuid().nullable(),
  averageScore: z.number().nullable(),
  reviews: z.array(
    z.object({
      reviewerId: z.uuid(),
      reviewerName: z.string(),
      score: z.int().nullable(),
      comment: z.string(),
      reviewedAt: z.date().nullable(),
    }),
  ),
  /** Reviewers not yet assigned to this submission (the organizer's picker). */
  unassigned: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type CfpSubmissionDetailDto = z.infer<typeof CfpSubmissionDetailDto>;

/* ------------------------------------------------------------------------------ helpers ---- */

async function callOf(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(cfpCalls).where(eq(cfpCalls.eventId, eventId));
  return row ?? null;
}

const callDto = (row: Awaited<ReturnType<typeof callOf>>): CfpCallDto =>
  row ? CfpCallDto.parse(row) : DEFAULT_CALL;

function questionsOf(def: FormDefinition | null) {
  return (def?.fields ?? []).map((f) => ({
    key: f.key,
    type: f.type,
    label: f.label,
    required: f.required,
    options: f.options.map((o) => o.label),
  }));
}

/** Answers as label → readable value, in the questions' order (choice values shown by label). */
async function answersOf(tx: TenantTx, eventId: string, submissionId: string) {
  const { questions, responses } = await subjectResponsesTx(tx, formSubject(eventId), [submissionId]);
  const answers = responses[0]?.answers ?? {};
  const out: { label: string; value: string }[] = [];
  for (const q of questions) {
    const v = answers[q.key];
    if (v === undefined || v === null || v === '') continue;
    const show = (x: unknown) => q.options[String(x)] ?? String(x);
    const value = Array.isArray(v)
      ? v.map(show).join(', ')
      : typeof v === 'boolean'
        ? v
          ? '✓'
          : ''
        : show(v);
    if (value) out.push({ label: q.label, value });
  }
  return out;
}

async function trackName(tx: TenantTx, trackId: string | null) {
  if (!trackId) return null;
  const [t] = await tx.select({ name: tracks.name }).from(tracks).where(eq(tracks.id, trackId));
  return t?.name ?? null;
}

/* -------------------------------------------------------------------- organizer: setup ---- */

export const SaveCfpInput = z.object({
  eventId: z.uuid(),
  status: z.enum(CFP_STATUSES),
  intro: z.string().trim().max(4000).default(''),
  closesAt: z.coerce.date().nullable().default(null),
  blind: z.boolean().default(false),
  durations: z.array(z.int().min(5).max(480)).min(1).max(8),
  maxCoSpeakers: z.int().min(0).max(5).default(3),
});

export const saveCfpCommand = tenantCommand({
  name: 'program.saveCfp',
  input: SaveCfpInput,
  output: CfpCallDto,
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    if (input.closesAt && Number.isNaN(input.closesAt.getTime())) throw invalid('closesAt', 'invalid');
    // Opening with a deadline already past would take nothing: say so.
    if (input.status === 'open' && input.closesAt && input.closesAt.getTime() <= ctx.now.getTime())
      throw invalid('closesAt', 'past');
    const values = {
      status: input.status,
      intro: input.intro,
      closesAt: input.closesAt,
      blind: input.blind,
      durations: [...new Set(input.durations)].sort((a, b) => a - b),
      maxCoSpeakers: input.maxCoSpeakers,
    };
    const [row] = await tx
      .insert(cfpCalls)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, ...values })
      .onConflictDoUpdate({
        target: [cfpCalls.orgId, cfpCalls.eventId],
        set: { ...values, updatedAt: ctx.now },
      })
      .returning();
    return callDto(row ?? null);
  },
  audit: (input) => ({
    action: 'program.cfp.save',
    targetType: 'event',
    targetId: input.eventId,
    data: { status: input.status, blind: input.blind },
  }),
});

const QuestionInput = z.object({
  type: z.enum(FIELD_TYPES),
  label: z.string().trim().min(1).max(200),
  required: z.boolean().default(false),
  /** Choice questions: one option per entry. */
  options: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
});

const CHOICE_TYPES = new Set(['select', 'multi_select']);

export const addCfpQuestionCommand = tenantCommand({
  name: 'program.addCfpQuestion',
  input: QuestionInput.extend({ eventId: z.uuid() }),
  output: z.object({ version: z.int(), key: z.string() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const current = await currentFormTx(tx, formSubject(input.eventId));
    const fields = current?.definition.fields ?? [];
    if (fields.length >= MAX_CFP_QUESTIONS)
      throw new DomainError('invalid_state', 'Too many questions', { reason: 'too_many' });
    const choice = CHOICE_TYPES.has(input.type);
    const options = [...new Set(input.options)];
    if (choice && options.length < 2) throw invalid('options', 'too_few');
    const taken = new Set(fields.map((f) => f.key));
    let n = fields.length + 1;
    while (taken.has(`q${n}`)) n++;
    const key = `q${n}`;
    const field = FieldDefinition.parse({
      key,
      type: input.type,
      label: input.label,
      required: input.required,
      sensitive: false,
      options: choice ? options.map((label, i) => ({ value: `o${i + 1}`, label })) : [],
    });
    const { version } = await publishFormTx(tx, ctx, formSubject(input.eventId), {
      fields: [...fields, field],
    });
    return { version, key };
  },
  audit: (input, r) => ({
    action: 'program.cfp.question_add',
    targetType: 'event',
    targetId: input.eventId,
    data: { key: r?.key, type: input.type },
  }),
});

export const removeCfpQuestionCommand = tenantCommand({
  name: 'program.removeCfpQuestion',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), key: z.string().max(40) }),
  output: z.object({ version: z.int() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const current = await currentFormTx(tx, formSubject(input.eventId));
    const fields = current?.definition.fields ?? [];
    if (!fields.some((f) => f.key === input.key)) throw new DomainError('not_found');
    // Answers already given keep their version (the forms engine never reinterprets them).
    return publishFormTx(tx, ctx, formSubject(input.eventId), {
      fields: fields.filter((f) => f.key !== input.key),
    });
  },
  audit: (input) => ({
    action: 'program.cfp.question_remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { key: input.key },
  }),
});

/* ------------------------------------------------------------------ organizer: reviewers ---- */

export const addCfpReviewerCommand = tenantCommand({
  name: 'program.addCfpReviewer',
  input: z.object({ eventId: z.uuid(), name: z.string().trim().min(1).max(120), email: Email }),
  output: z.object({ reviewerId: z.uuid(), accountId: z.uuid() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    await eventOf(tx, input.eventId);
    const orgId = requireOrg(ctx);
    let [reviewer] = await tx
      .select({ id: cfpReviewers.id })
      .from(cfpReviewers)
      .where(and(eq(cfpReviewers.eventId, input.eventId), eq(cfpReviewers.email, input.email)));
    if (reviewer) {
      await tx
        .update(cfpReviewers)
        .set({ name: input.name, updatedAt: ctx.now })
        .where(eq(cfpReviewers.id, reviewer.id));
    } else {
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(cfpReviewers)
        .where(eq(cfpReviewers.eventId, input.eventId));
      if ((n?.n ?? 0) >= MAX_CFP_REVIEWERS)
        throw new DomainError('invalid_state', 'Too many reviewers', { reason: 'too_many' });
      [reviewer] = await tx
        .insert(cfpReviewers)
        .values({ orgId, eventId: input.eventId, name: input.name, email: input.email })
        .returning({ id: cfpReviewers.id });
    }
    if (!reviewer) throw new DomainError('internal');
    // A reviewer is a portal account (P5-7): the invite mailer emails the signed link.
    const r = await createPortalAccountTx(tx, ctx, {
      eventId: input.eventId,
      role: 'cfp_reviewer',
      subjectId: reviewer.id,
      email: input.email,
    });
    emit(r.event);
    return { reviewerId: reviewer.id, accountId: r.account.id };
  },
  audit: (input, r) => ({
    action: 'program.cfp.reviewer_invite',
    targetType: 'event',
    targetId: input.eventId,
    data: { reviewerId: r?.reviewerId, accountId: r?.accountId },
  }),
});

export const revokeCfpReviewerCommand = tenantCommand({
  name: 'program.revokeCfpReviewer',
  input: z.object({ eventId: z.uuid(), accountId: z.uuid() }),
  output: z.object({ status: z.string() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const a = await revokePortalAccountTx(tx, ctx, { ...input, subjectKind: 'cfp_reviewer' });
    return { status: a.status };
  },
  audit: (input) => ({
    action: 'program.cfp.reviewer_revoke',
    targetType: 'event',
    targetId: input.eventId,
    data: { accountId: input.accountId },
  }),
});

async function submissionOf(tx: TenantTx, eventId: string, submissionId: string, lock = false) {
  const q = tx
    .select()
    .from(cfpSubmissions)
    .where(and(eq(cfpSubmissions.id, submissionId), eq(cfpSubmissions.eventId, eventId)));
  const [row] = lock ? await q.for('update') : await q;
  if (!row) throw new DomainError('not_found');
  return row;
}

export const assignCfpReviewerCommand = tenantCommand({
  name: 'program.assignCfpReviewer',
  input: z.object({ eventId: z.uuid(), submissionId: z.uuid(), reviewerId: z.uuid() }),
  output: z.object({ assignmentId: z.uuid() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await submissionOf(tx, input.eventId, input.submissionId);
    if (s.status !== 'submitted')
      throw new DomainError('invalid_state', 'Already decided', { reason: 'decided' });
    const [reviewer] = await tx
      .select({ id: cfpReviewers.id })
      .from(cfpReviewers)
      .where(and(eq(cfpReviewers.id, input.reviewerId), eq(cfpReviewers.eventId, input.eventId)));
    if (!reviewer) throw invalid('reviewerId', 'unknown');
    try {
      const [row] = await tx.transaction((sp) =>
        sp
          .insert(cfpAssignments)
          .values({
            orgId: requireOrg(ctx),
            eventId: input.eventId,
            submissionId: s.id,
            reviewerId: reviewer.id,
          })
          .returning({ id: cfpAssignments.id }),
      );
      if (!row) throw new DomainError('internal');
      return { assignmentId: row.id };
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'Already assigned', { reason: 'already_assigned' });
      throw err;
    }
  },
  audit: (input) => ({
    action: 'program.cfp.assign',
    targetType: 'event',
    targetId: input.eventId,
    data: { submissionId: input.submissionId, reviewerId: input.reviewerId },
  }),
});

export const unassignCfpReviewerCommand = tenantCommand({
  name: 'program.unassignCfpReviewer',
  input: z.object({ eventId: z.uuid(), submissionId: z.uuid(), reviewerId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const s = await submissionOf(tx, input.eventId, input.submissionId);
    if (s.status !== 'submitted')
      throw new DomainError('invalid_state', 'Already decided', { reason: 'decided' });
    const rows = await tx
      .delete(cfpAssignments)
      .where(and(eq(cfpAssignments.submissionId, s.id), eq(cfpAssignments.reviewerId, input.reviewerId)))
      .returning({ id: cfpAssignments.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { removed: true };
  },
  audit: (input) => ({
    action: 'program.cfp.unassign',
    targetType: 'event',
    targetId: input.eventId,
    data: { submissionId: input.submissionId, reviewerId: input.reviewerId },
  }),
});

/* ------------------------------------------------------------------- organizer: reads ---- */

export const cfpOverviewQuery = tenantQuery({
  name: 'program.cfpOverview',
  input: z.object({ eventId: z.uuid() }),
  output: CfpOverviewDto,
  entitlement: 'speakers',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    const call = callDto(await callOf(tx, input.eventId));
    const form = await currentFormTx(tx, formSubject(input.eventId));
    const subs = await tx
      .select({
        id: cfpSubmissions.id,
        title: cfpSubmissions.title,
        speakerName: cfpSubmissions.speakerName,
        durationMinutes: cfpSubmissions.durationMinutes,
        track: tracks.name,
        status: cfpSubmissions.status,
        submittedAt: cfpSubmissions.createdAt,
      })
      .from(cfpSubmissions)
      .leftJoin(tracks, eq(tracks.id, cfpSubmissions.trackId))
      .where(eq(cfpSubmissions.eventId, input.eventId))
      .orderBy(asc(cfpSubmissions.createdAt), asc(cfpSubmissions.id));
    const assigned = await tx
      .select({
        submissionId: cfpAssignments.submissionId,
        reviewerId: cfpAssignments.reviewerId,
        score: cfpReviews.score,
      })
      .from(cfpAssignments)
      .leftJoin(cfpReviews, eq(cfpReviews.assignmentId, cfpAssignments.id))
      .where(eq(cfpAssignments.eventId, input.eventId));
    const reviewerRows = await tx
      .select()
      .from(cfpReviewers)
      .where(eq(cfpReviewers.eventId, input.eventId))
      .orderBy(asc(cfpReviewers.name), asc(cfpReviewers.createdAt));
    const accounts = await portalAccountsTx(tx, input.eventId, 'cfp_reviewer', ctx.now);
    return {
      call,
      questions: questionsOf(form?.definition ?? null),
      submissions: subs.map((s) => {
        const mine = assigned.filter((a) => a.submissionId === s.id);
        const scores = mine.flatMap((a) => (a.score === null ? [] : [a.score]));
        return {
          ...s,
          status: s.status as CfpSubmissionRowDto['status'],
          reviewerCount: mine.length,
          reviewCount: scores.length,
          averageScore: averageScore(scores),
        };
      }),
      reviewers: reviewerRows.map((r) => {
        // The newest account for the reviewer's address (a re-invite reuses it).
        const account = accounts.filter((a) => a.subjectId === r.id).at(-1) ?? null;
        const mine = assigned.filter((a) => a.reviewerId === r.id);
        return {
          id: r.id,
          name: r.name,
          email: r.email,
          access: account?.status ?? 'none',
          accountId: account?.id ?? null,
          assigned: mine.length,
          reviewed: mine.filter((a) => a.score !== null).length,
        };
      }),
    };
  },
});

export const cfpSubmissionQuery = tenantQuery({
  name: 'program.cfpSubmission',
  input: z.object({ eventId: z.uuid(), submissionId: z.uuid() }),
  output: CfpSubmissionDetailDto,
  entitlement: 'speakers',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const s = await submissionOf(tx, input.eventId, input.submissionId);
    const co = await tx
      .select({ name: cfpCoSpeakers.name, email: cfpCoSpeakers.email })
      .from(cfpCoSpeakers)
      .where(eq(cfpCoSpeakers.submissionId, s.id))
      .orderBy(asc(cfpCoSpeakers.position));
    const reviews = await tx
      .select({
        reviewerId: cfpReviewers.id,
        reviewerName: cfpReviewers.name,
        score: cfpReviews.score,
        comment: cfpReviews.comment,
        reviewedAt: cfpReviews.updatedAt,
      })
      .from(cfpAssignments)
      .innerJoin(cfpReviewers, eq(cfpReviewers.id, cfpAssignments.reviewerId))
      .leftJoin(cfpReviews, eq(cfpReviews.assignmentId, cfpAssignments.id))
      .where(eq(cfpAssignments.submissionId, s.id))
      .orderBy(asc(cfpReviewers.name));
    const all = await tx
      .select({ id: cfpReviewers.id, name: cfpReviewers.name })
      .from(cfpReviewers)
      .where(eq(cfpReviewers.eventId, input.eventId))
      .orderBy(asc(cfpReviewers.name));
    const taken = new Set(reviews.map((r) => r.reviewerId));
    return {
      id: s.id,
      title: s.title,
      abstract: s.abstract,
      durationMinutes: s.durationMinutes,
      track: await trackName(tx, s.trackId),
      status: s.status as CfpSubmissionDetailDto['status'],
      submittedAt: s.createdAt,
      speakerName: s.speakerName,
      speakerEmail: s.speakerEmail,
      speakerTitle: s.speakerTitle,
      speakerCompany: s.speakerCompany,
      speakerBio: s.speakerBio,
      coSpeakers: co,
      answers: await answersOf(tx, input.eventId, s.id),
      decidedAt: s.decidedAt,
      decisionNote: s.decisionNote,
      sessionId: s.sessionId,
      averageScore: averageScore(reviews.flatMap((r) => (r.score === null ? [] : [r.score]))),
      reviews: reviews.map((r) => ({
        ...r,
        comment: r.comment ?? '',
        reviewedAt: r.score === null ? null : r.reviewedAt,
      })),
      unassigned: all.filter((r) => !taken.has(r.id)),
    };
  },
});

/* ------------------------------------------------------------------ organizer: decide ---- */

/** The event's speaker with this address (speaker_contacts), or a new one with the contact. */
async function speakerForTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  p: { name: string; email: string; title?: string | null; company?: string | null; bio?: string },
): Promise<string> {
  const [known] = await tx
    .select({ speakerId: speakerContacts.speakerId })
    .from(speakerContacts)
    .where(and(eq(speakerContacts.eventId, eventId), eq(speakerContacts.email, p.email)));
  if (known) return known.speakerId;
  const [n] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(speakers)
    .where(eq(speakers.eventId, eventId));
  if ((n?.n ?? 0) >= MAX_SPEAKERS_PER_EVENT)
    throw new DomainError('invalid_state', 'Too many speakers', { reason: 'too_many_speakers' });
  const [row] = await tx
    .insert(speakers)
    .values({
      orgId,
      eventId,
      name: p.name.slice(0, 120),
      title: p.title ?? null,
      company: p.company ?? null,
      bio: sanitizeMarkdown(p.bio ?? '', 5000),
    })
    .returning({ id: speakers.id });
  if (!row) throw new DomainError('internal');
  await tx.insert(speakerContacts).values({ orgId, eventId, speakerId: row.id, email: p.email });
  return row.id;
}

export const DecideCfpInput = z.object({
  eventId: z.uuid(),
  submissionId: z.uuid(),
  decision: z.enum(['accept', 'reject']),
  note: Text(1000),
});

export const decideCfpSubmissionCommand = tenantCommand({
  name: 'program.decideCfpSubmission',
  input: DecideCfpInput,
  output: z.object({
    status: z.enum(SUBMISSION_STATUSES),
    sessionId: z.uuid().nullable(),
    speakerIds: z.array(z.uuid()),
  }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const ev = await eventOf(tx, input.eventId);
    // The row lock makes a double click (or two organizers) decide once: the second sees it decided.
    const s = await submissionOf(tx, input.eventId, input.submissionId, true);
    if (s.status !== 'submitted')
      throw new DomainError('invalid_state', 'Already decided', { reason: 'decided' });
    let sessionId: string | null = null;
    const speakerIds: string[] = [];
    if (input.decision === 'accept') {
      const [count] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sessions)
        .where(eq(sessions.eventId, input.eventId));
      if ((count?.n ?? 0) >= MAX_SESSIONS_PER_EVENT)
        throw new DomainError('invalid_state', 'Too many sessions', { reason: 'too_many' });
      speakerIds.push(
        await speakerForTx(tx, orgId, input.eventId, {
          name: s.speakerName,
          email: s.speakerEmail,
          title: s.speakerTitle,
          company: s.speakerCompany,
          bio: s.speakerBio,
        }),
      );
      const co = await tx
        .select()
        .from(cfpCoSpeakers)
        .where(eq(cfpCoSpeakers.submissionId, s.id))
        .orderBy(asc(cfpCoSpeakers.position));
      for (const c of co) {
        const id = await speakerForTx(tx, orgId, input.eventId, { name: c.name, email: c.email });
        if (!speakerIds.includes(id)) speakerIds.push(id);
      }
      const times = draftSessionTimes(ev, s.durationMinutes);
      const [row] = await tx
        .insert(sessions)
        .values({
          orgId,
          eventId: input.eventId,
          title: s.title,
          description: sanitizeMarkdown(s.abstract, 5000),
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          trackId: s.trackId,
          draft: true,
        })
        .returning({ id: sessions.id });
      if (!row) throw new DomainError('internal');
      sessionId = row.id;
      await tx
        .insert(sessionSpeakers)
        .values(speakerIds.map((speakerId, position) => ({ orgId, sessionId: row.id, speakerId, position })));
    }
    await tx
      .update(cfpSubmissions)
      .set({
        status: input.decision === 'accept' ? 'accepted' : 'rejected',
        decidedAt: ctx.now,
        decidedBy: ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.type,
        decisionNote: input.note,
        speakerId: speakerIds[0] ?? null,
        sessionId,
        updatedAt: ctx.now,
      })
      .where(eq(cfpSubmissions.id, s.id));
    emit(submissionEvent('decided', s));
    return {
      status: input.decision === 'accept' ? ('accepted' as const) : ('rejected' as const),
      sessionId,
      speakerIds,
    };
  },
  audit: (input, r) => ({
    action: `program.cfp.${input.decision}`,
    targetType: 'event',
    targetId: input.eventId,
    data: { submissionId: input.submissionId, sessionId: r?.sessionId ?? null },
  }),
});

/** "Add to the agenda": a draft session (an accepted proposal) becomes part of the public program. */
export const placeDraftSessionCommand = tenantCommand({
  name: 'program.placeDraftSession',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid() }),
  output: z.object({ placed: z.boolean() }),
  entitlement: 'speakers',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(sessions)
      .set({ draft: false, updatedAt: ctx.now })
      .where(
        and(eq(sessions.id, input.sessionId), eq(sessions.eventId, input.eventId), eq(sessions.draft, true)),
      )
      .returning({ id: sessions.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { placed: true };
  },
  audit: (input) => ({
    action: 'program.session.place',
    targetType: 'event',
    targetId: input.eventId,
    data: { sessionId: input.sessionId },
  }),
});

/* ---------------------------------------------------------------------------- public ---- */

export const PublicCfpDto = z.object({
  state: z.enum(['open', 'not_open', 'closed', 'past_deadline']),
  intro: z.string(),
  closesAt: z.date().nullable(),
  durations: z.array(z.int()),
  maxCoSpeakers: z.int(),
  tracks: z.array(z.object({ id: z.uuid(), name: z.string() })),
  form: PublicFormDto.nullable(),
});
export type PublicCfpDto = z.infer<typeof PublicCfpDto>;

/**
 * The public call of an event with a public page (the caller resolved the target from the slug).
 * Null when the event has no call (or it is still a draft): the page is a 404.
 */
export async function publicCfp(target: EventTarget, now = new Date()): Promise<PublicCfpDto | null> {
  const ctx = createCtx({ orgId: target.orgId, actor: { type: 'system', name: 'program.cfp' } });
  return withTenant(ctx, async (tx) => {
    const call = await callOf(tx, target.eventId);
    const state: CfpOpenness = cfpOpenness(call, now);
    if (!call || state === 'not_open') return null;
    const trackRows = await tx
      .select({ id: tracks.id, name: tracks.name })
      .from(tracks)
      .where(eq(tracks.eventId, target.eventId))
      .orderBy(asc(tracks.name));
    const f = await currentFormTx(tx, formSubject(target.eventId));
    return PublicCfpDto.parse({
      state,
      intro: call.intro,
      closesAt: call.closesAt,
      durations: call.durations,
      maxCoSpeakers: call.maxCoSpeakers,
      tracks: trackRows,
      form: f?.definition.fields.length ? { version: f.version, fields: f.definition.fields } : null,
    });
  });
}

export const SubmitCfpInput = z.object({
  eventId: z.uuid(),
  title: z.string().trim().min(1).max(160),
  abstract: z.string().trim().min(1).max(5000),
  durationMinutes: z.int().min(5).max(480),
  trackId: z.uuid().nullable().default(null),
  speakerName: z.string().trim().min(1).max(120),
  speakerEmail: Email,
  speakerTitle: Text(120),
  speakerCompany: Text(120),
  speakerBio: z.string().trim().max(4000).default(''),
  coSpeakers: z
    .array(z.object({ name: z.string().trim().min(1).max(120), email: Email }))
    .max(5)
    .default([]),
  answers: z.record(z.string().max(40), z.unknown()).default({}),
});
export type SubmitCfpInput = z.input<typeof SubmitCfpInput>;

export const submitCfpCommand = tenantCommand({
  name: 'program.submitCfp',
  input: SubmitCfpInput,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'speakers',
  permission: 'public:cfp',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [call] = await tx.select().from(cfpCalls).where(eq(cfpCalls.eventId, input.eventId)).for('share');
    const state = cfpOpenness(call ?? null, ctx.now);
    if (!call || state === 'not_open') throw new DomainError('not_found');
    if (state !== 'open') throw new DomainError('invalid_state', 'The call is closed', { reason: state });
    if (!call.durations.includes(input.durationMinutes)) throw invalid('durationMinutes', 'not_offered');
    if (input.trackId) {
      const [t] = await tx
        .select({ id: tracks.id })
        .from(tracks)
        .where(and(eq(tracks.id, input.trackId), eq(tracks.eventId, input.eventId)));
      if (!t) throw invalid('trackId', 'unknown');
    }
    const co = checkCoSpeakers(input.coSpeakers, input.speakerEmail, call.maxCoSpeakers);
    if (!co.ok) throw invalid(`coSpeakers.${co.index}`, co.reason);
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(cfpSubmissions)
      .where(eq(cfpSubmissions.callId, call.id));
    if ((n?.n ?? 0) >= MAX_SUBMISSIONS_PER_CALL)
      throw new DomainError('invalid_state', 'The call is full', { reason: 'closed' });
    let row: { id: string; eventId: string } | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .insert(cfpSubmissions)
          .values({
            orgId,
            eventId: input.eventId,
            callId: call.id,
            title: input.title,
            abstract: input.abstract,
            durationMinutes: input.durationMinutes,
            trackId: input.trackId,
            speakerName: input.speakerName,
            speakerEmail: input.speakerEmail,
            speakerTitle: input.speakerTitle,
            speakerCompany: input.speakerCompany,
            speakerBio: input.speakerBio,
            locale: ctx.locale,
          })
          .returning({ id: cfpSubmissions.id, eventId: cfpSubmissions.eventId }),
      );
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'Already submitted', { reason: 'duplicate' });
      throw err;
    }
    if (!row) throw new DomainError('internal');
    if (co.coSpeakers.length)
      await tx
        .insert(cfpCoSpeakers)
        .values(co.coSpeakers.map((c, position) => ({ orgId, submissionId: row.id, ...c, position })));
    // The custom questions through the forms engine (validated against the current version).
    await submitResponseTx(tx, ctx, {
      ...formSubject(input.eventId),
      respondentType: 'cfp_submission',
      respondentId: row.id,
      answers: input.answers,
    });
    emit(submissionEvent('received', row));
    return { ok: true, submissionId: row.id };
  },
  present: () => ({ ok: true }),
  audit: (input, r) => ({
    action: 'program.cfp.submit',
    targetType: 'event',
    targetId: input.eventId,
    data: { submissionId: (r as { submissionId?: string } | undefined)?.submissionId ?? null },
  }),
});

/* --------------------------------------------------------------------------- reviewer ---- */

/** The signed-in reviewer (portal account + reviewer row of its event), or `forbidden`. */
export async function reviewerPrincipalTx(tx: TenantTx, ctx: Ctx) {
  const p = await portalPrincipalTx(tx, ctx);
  if (p.role !== 'cfp_reviewer' || p.subjectKind !== 'cfp_reviewer') throw new DomainError('forbidden');
  const [reviewer] = await tx
    .select()
    .from(cfpReviewers)
    .where(and(eq(cfpReviewers.id, p.subjectId), eq(cfpReviewers.eventId, p.eventId)));
  if (!reviewer) throw new DomainError('forbidden');
  return { principal: p, reviewer };
}

export const ReviewerHomeDto = z.object({
  reviewer: z.object({ name: z.string(), email: z.string() }),
  event: z.object({
    name: z.string(),
    timezone: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
  }),
  blind: z.boolean(),
  submissions: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      durationMinutes: z.int(),
      track: z.string().nullable(),
      decided: z.boolean(),
      myScore: z.int().nullable(),
    }),
  ),
});
export type ReviewerHomeDto = z.infer<typeof ReviewerHomeDto>;

export const cfpReviewerHomeQuery = tenantQuery({
  name: 'program.cfpReviewerHome',
  input: z.object({}),
  output: ReviewerHomeDto,
  entitlement: 'speakers',
  permission: 'portal:cfp_reviewer',
  handler: async ({ ctx, tx }) => {
    const { principal, reviewer } = await reviewerPrincipalTx(tx, ctx);
    const ev = await eventOf(tx, principal.eventId);
    const call = await callOf(tx, principal.eventId);
    const rows = await tx
      .select({
        id: cfpSubmissions.id,
        title: cfpSubmissions.title,
        durationMinutes: cfpSubmissions.durationMinutes,
        track: tracks.name,
        status: cfpSubmissions.status,
        myScore: cfpReviews.score,
      })
      .from(cfpAssignments)
      .innerJoin(cfpSubmissions, eq(cfpSubmissions.id, cfpAssignments.submissionId))
      .leftJoin(tracks, eq(tracks.id, cfpSubmissions.trackId))
      .leftJoin(cfpReviews, eq(cfpReviews.assignmentId, cfpAssignments.id))
      .where(and(eq(cfpAssignments.reviewerId, reviewer.id), eq(cfpAssignments.eventId, principal.eventId)))
      .orderBy(asc(cfpSubmissions.createdAt), asc(cfpSubmissions.id));
    return {
      reviewer: { name: reviewer.name, email: reviewer.email },
      event: { name: ev.name, timezone: ev.timezone, startsAt: ev.startsAt, endsAt: ev.endsAt },
      blind: call?.blind ?? false,
      submissions: rows.map((r) => ({
        id: r.id,
        title: r.title,
        durationMinutes: r.durationMinutes,
        track: r.track,
        decided: r.status !== 'submitted',
        myScore: r.myScore,
      })),
    };
  },
});

export const ReviewerSubmissionDto = z.object({
  id: z.uuid(),
  title: z.string(),
  abstract: z.string(),
  durationMinutes: z.int(),
  track: z.string().nullable(),
  decided: z.boolean(),
  blind: z.boolean(),
  /** Null under blind review. */
  speakerName: z.string().nullable(),
  speakerTitle: z.string().nullable(),
  speakerCompany: z.string().nullable(),
  speakerBio: z.string().nullable(),
  coSpeakers: z.array(z.object({ name: z.string() })),
  answers: z.array(AnswerDto),
  myReview: z.object({ score: z.int(), comment: z.string() }).nullable(),
});
export type ReviewerSubmissionDto = z.infer<typeof ReviewerSubmissionDto>;

/** The reviewer's assignment for a submission of their event, or `not_found` (guessed ids too). */
async function assignmentTx(tx: TenantTx, reviewerId: string, eventId: string, submissionId: string) {
  const [row] = await tx
    .select({ assignment: cfpAssignments, submission: cfpSubmissions })
    .from(cfpAssignments)
    .innerJoin(cfpSubmissions, eq(cfpSubmissions.id, cfpAssignments.submissionId))
    .where(
      and(
        eq(cfpAssignments.reviewerId, reviewerId),
        eq(cfpAssignments.eventId, eventId),
        eq(cfpAssignments.submissionId, submissionId),
      ),
    );
  if (!row) throw new DomainError('not_found');
  return row;
}

export const cfpReviewerSubmissionQuery = tenantQuery({
  name: 'program.cfpReviewerSubmission',
  input: z.object({ submissionId: z.uuid() }),
  output: ReviewerSubmissionDto,
  entitlement: 'speakers',
  permission: 'portal:cfp_reviewer',
  handler: async ({ input, ctx, tx }) => {
    const { principal, reviewer } = await reviewerPrincipalTx(tx, ctx);
    const { assignment, submission: s } = await assignmentTx(
      tx,
      reviewer.id,
      principal.eventId,
      input.submissionId,
    );
    const call = await callOf(tx, principal.eventId);
    const blind = call?.blind ?? false;
    const [review] = await tx
      .select({ score: cfpReviews.score, comment: cfpReviews.comment })
      .from(cfpReviews)
      .where(eq(cfpReviews.assignmentId, assignment.id));
    // Under blind review nothing that names the people is even read.
    const co = blind
      ? []
      : await tx
          .select({ name: cfpCoSpeakers.name })
          .from(cfpCoSpeakers)
          .where(eq(cfpCoSpeakers.submissionId, s.id))
          .orderBy(asc(cfpCoSpeakers.position));
    const view = forReviewer(
      {
        speakerName: s.speakerName,
        speakerTitle: s.speakerTitle,
        speakerCompany: s.speakerCompany,
        speakerBio: s.speakerBio,
        coSpeakers: co,
        answers: blind ? [] : await answersOf(tx, principal.eventId, s.id),
      },
      blind,
    );
    return {
      id: s.id,
      title: s.title,
      abstract: s.abstract,
      durationMinutes: s.durationMinutes,
      track: await trackName(tx, s.trackId),
      decided: s.status !== 'submitted',
      blind,
      ...view,
      myReview: review ?? null,
    };
  },
});

export const submitCfpReviewCommand = tenantCommand({
  name: 'program.submitCfpReview',
  input: z.object({
    submissionId: z.uuid(),
    score: z.int().min(1).max(5),
    comment: z.string().trim().max(2000).default(''),
  }),
  output: z.object({ saved: z.boolean() }),
  entitlement: 'speakers',
  permission: 'portal:cfp_reviewer',
  handler: async ({ input, ctx, tx }) => {
    const { principal, reviewer } = await reviewerPrincipalTx(tx, ctx);
    const { assignment, submission } = await assignmentTx(
      tx,
      reviewer.id,
      principal.eventId,
      input.submissionId,
    );
    if (submission.status !== 'submitted')
      throw new DomainError('invalid_state', 'Already decided', { reason: 'decided' });
    await tx
      .insert(cfpReviews)
      .values({
        orgId: requireOrg(ctx),
        assignmentId: assignment.id,
        submissionId: submission.id,
        score: input.score,
        comment: input.comment,
      })
      .onConflictDoUpdate({
        target: [cfpReviews.orgId, cfpReviews.assignmentId],
        set: { score: input.score, comment: input.comment, updatedAt: ctx.now },
      });
    return { saved: true };
  },
  audit: (input) => ({
    action: 'program.cfp.review',
    targetType: 'cfp_submission',
    targetId: input.submissionId,
    data: { score: input.score },
  }),
});

/* ----------------------------------------------------------------------------- mailer ---- */

const SubmissionPayload = z.object({ submissionId: z.uuid(), eventId: z.uuid() });

/**
 * Emails submitters (transactional): `program.cfp-received` to the submitter when a proposal
 * arrives; `program.cfp-accepted` / `program.cfp-rejected` to the submitter and every co-speaker
 * once it is decided (in the submitter's language, with the organizer's note when there is one).
 */
export function cfpMailer(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'program.cfp-mailer',
    events: ['program.cfp_submission.received@1', 'program.cfp_submission.decided@1'],
    handle: async (tx, event) => {
      const p = SubmissionPayload.parse(event.payload);
      const [s] = await tx.select().from(cfpSubmissions).where(eq(cfpSubmissions.id, p.submissionId));
      if (!s) return;
      const ev = await eventOf(tx, s.eventId).catch(() => null);
      if (!ev) return;
      const base = { eventName: ev.name, title: s.title };
      if (event.type === 'program.cfp_submission.received') {
        await deps.notifier.enqueue(tx, {
          kind: 'program.cfp-received',
          to: { email: s.speakerEmail, name: s.speakerName, locale: s.locale, timeZone: ev.timezone },
          params: base,
          dedupeKey: `cfp-received:${s.id}`,
          eventId: s.eventId,
        });
        return;
      }
      if (s.status === 'submitted') return;
      const kind = s.status === 'accepted' ? 'program.cfp-accepted' : 'program.cfp-rejected';
      const co = await tx
        .select({ name: cfpCoSpeakers.name, email: cfpCoSpeakers.email })
        .from(cfpCoSpeakers)
        .where(eq(cfpCoSpeakers.submissionId, s.id));
      const people = [{ name: s.speakerName, email: s.speakerEmail }, ...co];
      for (const person of people)
        await deps.notifier.enqueue(tx, {
          kind,
          to: { email: person.email, name: person.name, locale: s.locale, timeZone: ev.timezone },
          params: { ...base, note: s.decisionNote ?? '', hasNote: s.decisionNote ? 'yes' : 'no' },
          dedupeKey: `cfp-decided:${s.id}:${person.email}`,
          eventId: s.eventId,
        });
    },
  });
}
