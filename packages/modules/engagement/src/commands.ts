import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_OPTIONS, MIN_OPTIONS, optionsFrom } from './domain/polls.ts';
import { MODERATION_ACTIONS, moderate } from './domain/questions.ts';
import { ModPageDto, ModPollDto, ModQuestionDto, SettingsDto } from './dto.ts';
import { ANONYMOUS_IDENTITY, POLL_KINDS, polls, questions, sessionSettings } from './schema.ts';
import {
  eventOf,
  modStateTx,
  type PollRow,
  publishPollRemovedTx,
  publishPollTx,
  publishQuestionTx,
  publishStageTx,
  type SettingsRow,
  sessionOf,
  settingsTx,
  toModPoll,
  toModQuestion,
  toSettings,
} from './state.ts';

/** Polls a session keeps (any state). */
export const MAX_POLLS_PER_SESSION = 50;

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

/** The session's settings, or `invalid_state` (`not_enabled`) when live engagement is off. */
async function enabledTx(tx: TenantTx, eventId: string, sessionId: string): Promise<SettingsRow> {
  const s = await settingsTx(tx, sessionId);
  if (!s || s.eventId !== eventId) {
    await sessionOf(tx, eventId, sessionId);
    throw new DomainError('invalid_state', 'Live engagement is off for this session', {
      reason: 'not_enabled',
    });
  }
  return s;
}

const where = (ctx: Ctx, s: { eventId: string; sessionId: string }) => ({
  orgId: requireOrg(ctx),
  eventId: s.eventId,
  sessionId: s.sessionId,
});

/** A poll of this event, locked for the change. */
async function pollFor(tx: TenantTx, eventId: string, pollId: string): Promise<PollRow> {
  const [p] = await tx
    .select()
    .from(polls)
    .where(and(eq(polls.id, pollId), eq(polls.eventId, eventId)))
    .for('update');
  if (!p) throw new DomainError('not_found');
  return p;
}

async function setStageTx(
  tx: TenantTx,
  ctx: Ctx,
  s: SettingsRow,
  patch: Partial<Pick<SettingsRow, 'livePollId' | 'pinnedQuestionId'>>,
): Promise<SettingsRow> {
  const [row] = await tx
    .update(sessionSettings)
    .set({ ...patch, updatedAt: ctx.now })
    .where(eq(sessionSettings.id, s.id))
    .returning();
  if (!row) throw new DomainError('internal');
  await publishStageTx(tx, where(ctx, row), row);
  return row;
}

const Ids = { eventId: z.uuid(), sessionId: z.uuid() };

/* ------------------------------------------------------------------------------ settings ---- */

/** Turn on polls and Q&A for a session (creates its settings; a second call changes nothing). */
export const enableLiveCommand = tenantCommand({
  name: 'engagement.enableLive',
  input: z.object(Ids),
  output: SettingsDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventOf(tx, input.eventId);
    await sessionOf(tx, input.eventId, input.sessionId);
    await tx
      .insert(sessionSettings)
      .values({ orgId: requireOrg(ctx), eventId: input.eventId, sessionId: input.sessionId })
      .onConflictDoNothing();
    const s = await settingsTx(tx, input.sessionId);
    if (!s) throw new DomainError('internal');
    return toSettings(s);
  },
  audit: (input) => ({
    action: 'engagement.enable',
    targetType: 'session',
    targetId: input.sessionId,
    data: { eventId: input.eventId },
  }),
});

export const UpdateSettingsInput = z.object({
  ...Ids,
  qaOpen: z.boolean(),
  allowAnonymous: z.boolean(),
  anonymousIdentity: z.enum(ANONYMOUS_IDENTITY),
});

/**
 * Q&A open or closed, anonymous questions allowed or not, and who may see the name behind an
 * anonymous question. Moving to "hidden" erases the names already kept behind anonymous questions.
 */
export const updateSettingsCommand = tenantCommand({
  name: 'engagement.updateSettings',
  input: UpdateSettingsInput,
  output: SettingsDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await enabledTx(tx, input.eventId, input.sessionId);
    const [row] = await tx
      .update(sessionSettings)
      .set({
        qaOpen: input.qaOpen,
        allowAnonymous: input.allowAnonymous,
        anonymousIdentity: input.anonymousIdentity,
        updatedAt: ctx.now,
      })
      .where(eq(sessionSettings.id, s.id))
      .returning();
    if (!row) throw new DomainError('internal');
    if (input.anonymousIdentity === 'hidden' && s.anonymousIdentity !== 'hidden') {
      const erased = await tx
        .update(questions)
        .set({ authorName: null, updatedAt: ctx.now })
        .where(and(eq(questions.sessionId, s.sessionId), eq(questions.anonymous, true)))
        .returning();
      for (const q of erased) await publishQuestionTx(tx, where(ctx, row), q, q.state === 'approved');
    }
    await publishStageTx(tx, where(ctx, row), row);
    return toSettings(row);
  },
  audit: (input) => ({
    action: 'engagement.settings.update',
    targetType: 'session',
    targetId: input.sessionId,
    data: {
      qaOpen: input.qaOpen,
      allowAnonymous: input.allowAnonymous,
      anonymousIdentity: input.anonymousIdentity,
    },
  }),
});

/** A new display version: every big-screen link signed for an earlier one stops working. */
export const rotateDisplayLinkCommand = tenantCommand({
  name: 'engagement.rotateDisplayLink',
  input: z.object(Ids),
  output: SettingsDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await enabledTx(tx, input.eventId, input.sessionId);
    const [row] = await tx
      .update(sessionSettings)
      .set({ displayVersion: sql`${sessionSettings.displayVersion} + 1`, updatedAt: ctx.now })
      .where(eq(sessionSettings.id, s.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return toSettings(row);
  },
  audit: (input, r) => ({
    action: 'engagement.display.rotate',
    targetType: 'session',
    targetId: input.sessionId,
    data: { displayVersion: r.displayVersion },
  }),
});

/* --------------------------------------------------------------------------------- polls ---- */

const Label = z.string().trim().min(1).max(80);

export const CreatePollInput = z.object({
  ...Ids,
  kind: z.enum(POLL_KINDS),
  question: z.string().trim().min(1).max(200),
  /** Choice polls: 2–10 options. */
  options: z.array(Label).max(MAX_OPTIONS).default([]),
  /** Multiple choice: how many options one person may pick. */
  maxChoices: z.int().min(1).max(MAX_OPTIONS).optional(),
  /** Rating polls: the top of the scale (default 5). */
  ratingScale: z.int().min(3).max(10).optional(),
});

export const createPollCommand = tenantCommand({
  name: 'engagement.createPoll',
  input: CreatePollInput,
  output: ModPollDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await enabledTx(tx, input.eventId, input.sessionId);
    const choice = input.kind === 'single' || input.kind === 'multi';
    const labels = input.options.map((o) => o.trim());
    if (choice && labels.length < MIN_OPTIONS) throw invalid('options', 'too_few');
    if (choice && new Set(labels.map((l) => l.toLocaleLowerCase())).size !== labels.length)
      throw invalid('options', 'duplicate');
    const maxChoices = input.kind === 'multi' ? (input.maxChoices ?? labels.length) : 1;
    if (input.kind === 'multi' && maxChoices > labels.length) throw invalid('maxChoices', 'too_many');
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(polls)
      .where(eq(polls.sessionId, s.sessionId));
    if ((n?.n ?? 0) >= MAX_POLLS_PER_SESSION)
      throw new DomainError('invalid_state', 'Too many polls', { reason: 'too_many' });
    const [row] = await tx
      .insert(polls)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        sessionId: input.sessionId,
        kind: input.kind,
        question: input.question,
        options: choice ? optionsFrom(labels) : [],
        maxChoices,
        ratingScale: input.kind === 'rating' ? (input.ratingScale ?? 5) : null,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    await publishPollTx(tx, where(ctx, row), row);
    return toModPoll(row, []);
  },
  audit: (input, r) => ({
    action: 'engagement.poll.create',
    targetType: 'session',
    targetId: input.sessionId,
    data: { pollId: r.id, kind: input.kind },
  }),
});

const PollRef = z.object({ eventId: z.uuid(), pollId: z.uuid() });

/** Open a draft poll for votes and put it on stage. */
export const openPollCommand = tenantCommand({
  name: 'engagement.openPoll',
  input: PollRef,
  output: ModPollDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const p = await pollFor(tx, input.eventId, input.pollId);
    if (p.state !== 'draft') throw new DomainError('invalid_state', 'Not a draft', { reason: p.state });
    const s = await enabledTx(tx, p.eventId, p.sessionId);
    const [row] = await tx
      .update(polls)
      .set({ state: 'open', openedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(polls.id, p.id))
      .returning();
    if (!row) throw new DomainError('internal');
    await publishPollTx(tx, where(ctx, row), row);
    await setStageTx(tx, ctx, s, { livePollId: row.id });
    return toModPoll(row, []);
  },
  audit: (input) => ({ action: 'engagement.poll.open', targetType: 'poll', targetId: input.pollId }),
});

/** Stop taking votes (the poll stays on stage with its results). */
export const closePollCommand = tenantCommand({
  name: 'engagement.closePoll',
  input: PollRef,
  output: z.object({ id: z.uuid(), state: z.literal('closed') }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const p = await pollFor(tx, input.eventId, input.pollId);
    if (p.state !== 'open') throw new DomainError('invalid_state', 'Not open', { reason: p.state });
    const [row] = await tx
      .update(polls)
      .set({ state: 'closed', closedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(polls.id, p.id))
      .returning();
    if (!row) throw new DomainError('internal');
    await publishPollTx(tx, where(ctx, row), row);
    return { id: row.id, state: 'closed' as const };
  },
  audit: (input) => ({ action: 'engagement.poll.close', targetType: 'poll', targetId: input.pollId }),
});

/** Show or hide a poll's results to the audience and on the big screen. */
export const setPollResultsCommand = tenantCommand({
  name: 'engagement.setPollResults',
  input: PollRef.extend({ show: z.boolean() }),
  output: z.object({ id: z.uuid(), showResults: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const p = await pollFor(tx, input.eventId, input.pollId);
    const [row] = await tx
      .update(polls)
      .set({ showResults: input.show, updatedAt: ctx.now })
      .where(eq(polls.id, p.id))
      .returning();
    if (!row) throw new DomainError('internal');
    await publishPollTx(tx, where(ctx, row), row);
    return { id: row.id, showResults: row.showResults };
  },
  audit: (input) => ({
    action: 'engagement.poll.results',
    targetType: 'poll',
    targetId: input.pollId,
    data: { show: input.show },
  }),
});

/** Put an open or closed poll on stage (presenter and big screen), or take the poll off. */
export const presentPollCommand = tenantCommand({
  name: 'engagement.presentPoll',
  input: z.object({ ...Ids, pollId: z.uuid().nullable() }),
  output: z.object({ livePollId: z.uuid().nullable() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await enabledTx(tx, input.eventId, input.sessionId);
    if (input.pollId) {
      const p = await pollFor(tx, input.eventId, input.pollId);
      if (p.sessionId !== s.sessionId) throw new DomainError('not_found');
      if (p.state === 'draft') throw new DomainError('invalid_state', 'Open it first', { reason: 'draft' });
    }
    const row = await setStageTx(tx, ctx, s, { livePollId: input.pollId });
    return { livePollId: row.livePollId };
  },
  audit: (input) => ({
    action: 'engagement.poll.present',
    targetType: 'session',
    targetId: input.sessionId,
    data: { pollId: input.pollId },
  }),
});

export const deletePollCommand = tenantCommand({
  name: 'engagement.deletePoll',
  category: 'delete',
  input: PollRef,
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const p = await pollFor(tx, input.eventId, input.pollId);
    const s = await settingsTx(tx, p.sessionId);
    if (s?.livePollId === p.id) await setStageTx(tx, ctx, s, { livePollId: null });
    await tx.delete(polls).where(eq(polls.id, p.id));
    await publishPollRemovedTx(tx, where(ctx, p), p.id, p.state !== 'draft');
    return { deleted: true };
  },
  audit: (input) => ({ action: 'engagement.poll.delete', targetType: 'poll', targetId: input.pollId }),
});

/* ----------------------------------------------------------------------------- questions ---- */

/** Approve, dismiss, or mark answered (and back). Dismissing or answering also unpins it. */
export const moderateQuestionCommand = tenantCommand({
  name: 'engagement.moderateQuestion',
  input: z.object({ eventId: z.uuid(), questionId: z.uuid(), action: z.enum(MODERATION_ACTIONS) }),
  output: ModQuestionDto,
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [q] = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, input.questionId), eq(questions.eventId, input.eventId)))
      .for('update');
    if (!q) throw new DomainError('not_found');
    const next = moderate(
      { state: q.state as 'pending' | 'approved' | 'dismissed', answered: q.answeredAt !== null },
      input.action,
    );
    if (!next) throw new DomainError('invalid_state', 'Not possible now', { reason: q.state });
    const [row] = await tx
      .update(questions)
      .set({
        state: next.state,
        answeredAt: next.answered ? (q.answeredAt ?? ctx.now) : null,
        moderatedAt: ctx.now,
        moderatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(eq(questions.id, q.id))
      .returning();
    if (!row) throw new DomainError('internal');
    await publishQuestionTx(tx, where(ctx, row), row, q.state === 'approved');
    const s = await settingsTx(tx, row.sessionId);
    if (s?.pinnedQuestionId === row.id && (input.action === 'dismiss' || input.action === 'answer'))
      await setStageTx(tx, ctx, s, { pinnedQuestionId: null });
    return toModQuestion(row);
  },
  audit: (input) => ({
    action: `engagement.question.${input.action}`,
    targetType: 'question',
    targetId: input.questionId,
  }),
});

/** Pin an approved question (the presenter's and big screen's current question), or unpin. */
export const pinQuestionCommand = tenantCommand({
  name: 'engagement.pinQuestion',
  input: z.object({ ...Ids, questionId: z.uuid().nullable() }),
  output: z.object({ pinnedQuestionId: z.uuid().nullable() }),
  entitlement: 'sessions',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const s = await enabledTx(tx, input.eventId, input.sessionId);
    if (input.questionId) {
      const [q] = await tx
        .select({ state: questions.state, sessionId: questions.sessionId })
        .from(questions)
        .where(eq(questions.id, input.questionId));
      if (!q || q.sessionId !== s.sessionId) throw new DomainError('not_found');
      if (q.state !== 'approved')
        throw new DomainError('invalid_state', 'Approve it first', { reason: 'not_approved' });
    }
    const row = await setStageTx(tx, ctx, s, { pinnedQuestionId: input.questionId });
    return { pinnedQuestionId: row.pinnedQuestionId };
  },
  audit: (input) => ({
    action: 'engagement.question.pin',
    targetType: 'session',
    targetId: input.sessionId,
    data: { questionId: input.questionId },
  }),
});

/* ------------------------------------------------------------------------------- queries ---- */

/** A session's polls and Q&A as the console shows them (off until enabled). Members who read events. */
export const moderationQuery = tenantQuery({
  name: 'engagement.moderation',
  input: z.object(Ids),
  output: ModPageDto,
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    await eventOf(tx, input.eventId);
    await sessionOf(tx, input.eventId, input.sessionId);
    const s = await settingsTx(tx, input.sessionId);
    if (!s || s.eventId !== input.eventId) return { enabled: false, settings: null, state: null };
    return { enabled: true, settings: toSettings(s), state: await modStateTx(tx, s) };
  },
});

/** Which sessions of an event have live engagement on (the console's agenda shows a badge). */
export const liveSessionsQuery = tenantQuery({
  name: 'engagement.liveSessions',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(z.uuid()),
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({ sessionId: sessionSettings.sessionId })
      .from(sessionSettings)
      .where(eq(sessionSettings.eventId, input.eventId));
    return rows.map((r) => r.sessionId);
  },
});
