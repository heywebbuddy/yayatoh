import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ballotKeys, MAX_WORDS, type PollOption } from './domain/polls.ts';
import {
  MAX_QUESTIONS_PER_SESSION,
  NAME_MAX_LENGTH,
  QUESTION_MAX_LENGTH,
  QUESTION_RATE,
} from './domain/questions.ts';
import { PARTICIPANT_KEY, verifyDisplayToken } from './domain/tokens.ts';
import type { ParticipantStateDto, PublicLiveStateDto, SettingsDto } from './dto.ts';
import {
  type PollKind,
  pollBallots,
  polls,
  pollTallies,
  questions,
  questionUpvotes,
  sessionSettings,
} from './schema.ts';
import {
  eventIsLive,
  eventOf,
  modStateTx,
  publicLiveStateTx,
  publishPollTx,
  publishQuestionTx,
  type SettingsRow,
  sessionOf,
  settingsTx,
  toSettings,
} from './state.ts';

/**
 * What the audience does (M5.7a): vote, ask, upvote. Open to anyone (`public:engagement`) on a
 * published, non-private event whose session has live engagement on. The web app passes the
 * participant's key (an HMAC of their account or device, see `participantKey`); the database's
 * unique keys make "one vote per person per poll" and "one upvote per question" hold under
 * concurrency. Nothing here returns another participant's data.
 */
const Key = z.string().regex(PARTICIPANT_KEY);

/** The session's settings when the public may take part, else `not_found`. */
async function liveSessionTx(tx: TenantTx, eventId: string, sessionId: string): Promise<SettingsRow> {
  const ev = await eventOf(tx, eventId);
  const s = await settingsTx(tx, sessionId);
  if (!eventIsLive(ev) || !s || s.eventId !== eventId) throw new DomainError('not_found');
  return s;
}

const where = (ctx: Ctx, r: { eventId: string; sessionId: string }) => ({
  orgId: requireOrg(ctx),
  eventId: r.eventId,
  sessionId: r.sessionId,
});

export const VoteInput = z.object({
  eventId: z.uuid(),
  pollId: z.uuid(),
  participantKey: Key,
  optionIds: z.array(z.string().max(4)).max(10).optional(),
  rating: z.int().optional(),
  word: z.string().max(200).optional(),
});

/**
 * One ballot per participant per poll. The poll row is locked, so a vote never lands after the
 * poll closed; a second ballot from the same key is `conflict` (`already_voted`), however many
 * arrive at once. Ballots keep no choice: only the tallies move.
 */
export const voteCommand = tenantCommand({
  name: 'engagement.vote',
  input: VoteInput,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'sessions',
  permission: 'public:engagement',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [p] = await tx
      .select()
      .from(polls)
      .where(and(eq(polls.id, input.pollId), eq(polls.eventId, input.eventId)))
      .for('update');
    if (!p || p.state === 'draft') throw new DomainError('not_found');
    await liveSessionTx(tx, p.eventId, p.sessionId);
    if (p.state !== 'open') throw new DomainError('invalid_state', 'Voting has closed', { reason: 'closed' });
    const k = ballotKeys(
      {
        kind: p.kind as PollKind,
        options: (p.options ?? []) as PollOption[],
        maxChoices: p.maxChoices,
        ratingScale: p.ratingScale,
      },
      input,
    );
    if ('problem' in k)
      throw new DomainError('validation_failed', 'Invalid vote', { field: 'choice', reason: k.problem });
    const cast = await tx
      .insert(pollBallots)
      .values({ orgId, pollId: p.id, participantKey: input.participantKey })
      .onConflictDoNothing()
      .returning({ id: pollBallots.id });
    if (cast.length === 0)
      throw new DomainError('conflict', 'You have already voted', { reason: 'already_voted' });
    let keys = k.keys;
    if (p.kind === 'word_cloud') {
      // A new word beyond the cap still counts as a ballot, not as a word.
      const [n] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(pollTallies)
        .where(eq(pollTallies.pollId, p.id));
      if ((n?.n ?? 0) >= MAX_WORDS) {
        const known = await tx
          .select({ key: pollTallies.key })
          .from(pollTallies)
          .where(and(eq(pollTallies.pollId, p.id), inArray(pollTallies.key, keys)));
        keys = known.map((x) => x.key);
      }
    }
    for (const key of keys)
      await tx
        .insert(pollTallies)
        .values({ orgId, pollId: p.id, key, count: 1 })
        .onConflictDoUpdate({
          target: [pollTallies.orgId, pollTallies.pollId, pollTallies.key],
          set: { count: sql`${pollTallies.count} + 1`, updatedAt: ctx.now },
        });
    const [row] = await tx
      .update(polls)
      .set({ ballots: sql`${polls.ballots} + 1`, updatedAt: ctx.now })
      .where(eq(polls.id, p.id))
      .returning();
    if (!row) throw new DomainError('internal');
    await publishPollTx(tx, where(ctx, row), row);
    emit({
      type: 'engagement.vote_cast',
      version: 1,
      aggregateType: 'engagement_poll',
      aggregateId: p.id,
      payload: { eventId: p.eventId, sessionId: p.sessionId, pollId: p.id },
    });
    return { ok: true, pollId: p.id };
  },
  present: () => ({ ok: true }),
  audit: (input) => ({ action: 'engagement.vote', targetType: 'poll', targetId: input.pollId }),
});

export const AskInput = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
  participantKey: Key,
  body: z.string().trim().min(1).max(QUESTION_MAX_LENGTH),
  name: z.string().trim().max(NAME_MAX_LENGTH).optional(),
  anonymous: z.boolean().default(false),
});

/**
 * Ask a question: it waits for a moderator (pending) and nobody else sees it until approved. A
 * named question needs a name; an anonymous one keeps the name only when the session's policy
 * lets moderators see it. At most `QUESTION_RATE.limit` questions per participant per window.
 */
export const askQuestionCommand = tenantCommand({
  name: 'engagement.askQuestion',
  input: AskInput,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'sessions',
  permission: 'public:engagement',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const s = await liveSessionTx(tx, input.eventId, input.sessionId);
    if (!s.qaOpen) throw new DomainError('invalid_state', 'Questions are closed', { reason: 'qa_closed' });
    if (input.anonymous && !s.allowAnonymous)
      throw new DomainError('validation_failed', 'Anonymous questions are off', {
        field: 'anonymous',
        reason: 'not_allowed',
      });
    const name = input.name?.trim() || null;
    if (!input.anonymous && !name)
      throw new DomainError('validation_failed', 'Enter your name', { field: 'name', reason: 'required' });
    const since = new Date(ctx.now.getTime() - QUESTION_RATE.windowMs);
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(
        and(
          eq(questions.sessionId, s.sessionId),
          eq(questions.participantKey, input.participantKey),
          gte(questions.createdAt, since),
        ),
      );
    if ((recent?.n ?? 0) >= QUESTION_RATE.limit)
      throw new DomainError('rate_limited', 'Too many questions', { reason: 'rate_limited' });
    const [total] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(eq(questions.sessionId, s.sessionId));
    if ((total?.n ?? 0) >= MAX_QUESTIONS_PER_SESSION)
      throw new DomainError('invalid_state', 'Questions are full', { reason: 'too_many' });
    const keepName = !input.anonymous || s.anonymousIdentity === 'moderators';
    const [row] = await tx
      .insert(questions)
      .values({
        orgId,
        eventId: s.eventId,
        sessionId: s.sessionId,
        body: input.body,
        authorName: keepName ? name : null,
        anonymous: input.anonymous,
        participantKey: input.participantKey,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    await publishQuestionTx(tx, where(ctx, row), row, false);
    emit({
      type: 'engagement.question_asked',
      version: 1,
      aggregateType: 'engagement_question',
      aggregateId: row.id,
      payload: { eventId: row.eventId, sessionId: row.sessionId, questionId: row.id },
    });
    return { ok: true, questionId: row.id };
  },
  present: () => ({ ok: true }),
  audit: (input, r) => ({
    action: 'engagement.question.ask',
    targetType: 'session',
    targetId: input.sessionId,
    data: { questionId: r.questionId },
  }),
});

/** One upvote per participant per approved question (`conflict` / `already_upvoted` after). */
export const upvoteQuestionCommand = tenantCommand({
  name: 'engagement.upvoteQuestion',
  input: z.object({ eventId: z.uuid(), questionId: z.uuid(), participantKey: Key }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'sessions',
  permission: 'public:engagement',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [q] = await tx
      .select()
      .from(questions)
      .where(and(eq(questions.id, input.questionId), eq(questions.eventId, input.eventId)))
      .for('update');
    // A question the public can't see doesn't exist for them.
    if (q?.state !== 'approved') throw new DomainError('not_found');
    await liveSessionTx(tx, q.eventId, q.sessionId);
    const added = await tx
      .insert(questionUpvotes)
      .values({ orgId, questionId: q.id, participantKey: input.participantKey })
      .onConflictDoNothing()
      .returning({ id: questionUpvotes.id });
    if (added.length === 0)
      throw new DomainError('conflict', 'Already upvoted', { reason: 'already_upvoted' });
    const [row] = await tx
      .update(questions)
      .set({ upvotes: sql`${questions.upvotes} + 1`, updatedAt: ctx.now })
      .where(eq(questions.id, q.id))
      .returning();
    if (!row) throw new DomainError('internal');
    await publishQuestionTx(tx, where(ctx, row), row, true);
    return { ok: true };
  },
  audit: (input) => ({
    action: 'engagement.question.upvote',
    targetType: 'question',
    targetId: input.questionId,
  }),
});

/* -------------------------------------------------------------------------- public reads ---- */

const EMPTY_STAGE = {
  livePollId: null,
  pinnedQuestionId: null,
  qaOpen: false,
  allowAnonymous: false,
  namesToModerators: false,
};

const readCtx = (orgId: string) => createCtx({ orgId, actor: { type: 'system', name: 'engagement.public' } });

export interface LiveSessionView {
  readonly eventName: string;
  readonly eventSlug: string;
  readonly sessionTitle: string;
  readonly settings: SettingsDto;
  readonly state: PublicLiveStateDto;
}

/**
 * A session's live state as the public may see it, or null (no such session, engagement off, or
 * the event isn't published and public). The org comes from the caller's route (slug, tenant
 * host or signed display token), never from input it didn't verify.
 */
export async function publicLiveSession(
  orgId: string,
  eventId: string,
  sessionId: string,
  opts: { requirePublicEvent?: boolean } = {},
): Promise<LiveSessionView | null> {
  return withTenant(readCtx(orgId), async (tx) => {
    const s = await settingsTx(tx, sessionId);
    if (!s || s.eventId !== eventId) return null;
    const ev = await eventOf(tx, eventId).catch(() => null);
    if (!ev || (opts.requirePublicEvent !== false && !eventIsLive(ev))) return null;
    const session = await sessionOf(tx, eventId, sessionId).catch(() => null);
    if (!session) return null;
    return {
      eventName: ev.name,
      eventSlug: ev.slug,
      sessionTitle: session.title,
      settings: toSettings(s),
      state: await publicLiveStateTx(tx, s),
    };
  });
}

/** The public snapshot inside an existing transaction (the realtime stream's), or an empty state. */
export async function publicSnapshotTx(tx: TenantTx, sessionId: string): Promise<PublicLiveStateDto> {
  const s = await settingsTx(tx, sessionId);
  if (!s) return { stage: EMPTY_STAGE, polls: [], questions: [] };
  return publicLiveStateTx(tx, s);
}

/** What this participant already did (their votes and upvotes, their questions waiting). */
export async function participantState(
  orgId: string,
  sessionId: string,
  key: string,
): Promise<ParticipantStateDto> {
  if (!PARTICIPANT_KEY.test(key)) return { votedPollIds: [], upvotedQuestionIds: [], pendingQuestions: 0 };
  return withTenant(readCtx(orgId), async (tx) => {
    const voted = await tx
      .select({ id: pollBallots.pollId })
      .from(pollBallots)
      .innerJoin(polls, and(eq(polls.orgId, pollBallots.orgId), eq(polls.id, pollBallots.pollId)))
      .where(and(eq(polls.sessionId, sessionId), eq(pollBallots.participantKey, key)));
    const upvoted = await tx
      .select({ id: questionUpvotes.questionId })
      .from(questionUpvotes)
      .innerJoin(
        questions,
        and(eq(questions.orgId, questionUpvotes.orgId), eq(questions.id, questionUpvotes.questionId)),
      )
      .where(and(eq(questions.sessionId, sessionId), eq(questionUpvotes.participantKey, key)));
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(questions)
      .where(
        and(
          eq(questions.sessionId, sessionId),
          eq(questions.participantKey, key),
          eq(questions.state, 'pending'),
        ),
      );
    return {
      votedPollIds: voted.map((v) => v.id),
      upvotedQuestionIds: upvoted.map((u) => u.id),
      pendingQuestions: pending?.n ?? 0,
    };
  });
}

/** Sessions of an event with live engagement on (the public agenda links to them). */
export async function liveSessionIds(orgId: string, eventId: string): Promise<string[]> {
  return withTenant(readCtx(orgId), async (tx) => {
    const rows = await tx
      .select({ sessionId: sessionSettings.sessionId })
      .from(sessionSettings)
      .where(eq(sessionSettings.eventId, eventId));
    return rows.map((r) => r.sessionId);
  });
}

/**
 * The session a big-screen link shows, or null: a forged or revoked token (the session's display
 * version moved on), engagement off, or an org that is not live. The org comes from the signed
 * token; `engagement.display_target` (SECURITY DEFINER) answers ids and the version only.
 */
export async function displaySession(
  token: string,
  secret: string,
): Promise<{ orgId: string; eventId: string; sessionId: string } | null> {
  const claim = verifyDisplayToken(token, secret);
  if (!claim) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ event_id: string; display_version: number }>(
      sql`select event_id, display_version from engagement.display_target(${claim.orgId}::uuid, ${claim.sessionId}::uuid)`,
    ),
  );
  const r = rows[0];
  if (!r || Number(r.display_version) !== claim.version) return null;
  return { orgId: claim.orgId, eventId: r.event_id, sessionId: claim.sessionId };
}

/** Whether a session channel names a real session of that event with engagement on. */
export async function sessionChannelOpen(
  orgId: string,
  eventId: string,
  sessionId: string,
): Promise<boolean> {
  return withTenant(readCtx(orgId), async (tx) => {
    const s = await settingsTx(tx, sessionId);
    return s !== null && s.eventId === eventId;
  });
}

/** The moderators' snapshot inside the realtime stream's transaction. */
export async function moderationSnapshotTx(tx: TenantTx, sessionId: string) {
  const s = await settingsTx(tx, sessionId);
  if (!s) return { stage: EMPTY_STAGE, polls: [], questions: [] };
  return modStateTx(tx, s);
}
