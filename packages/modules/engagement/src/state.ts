import type { TenantTx } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { publishRealtimeTx } from '@yayatoh/platform';
import { type SessionDto, sessionsOf } from '@yayatoh/program';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { type PollOption, pollResults } from './domain/polls.ts';
import { publicOrder } from './domain/questions.ts';
import {
  type ModPollDto,
  type ModQuestionDto,
  type ModStateDto,
  type PublicLiveStateDto,
  PublicPollDto,
  PublicQuestionDto,
  type SettingsDto,
  type StageDto,
} from './dto.ts';
import { LIVE_CHANNEL, MODERATION_CHANNEL } from './realtime.ts';
import { type PollKind, polls, pollTallies, questions, sessionSettings } from './schema.ts';

/** Questions the audience gets at most (the most relevant first). */
export const PUBLIC_QUESTIONS_SHOWN = 200;
/** Questions the moderation queue loads at most (newest first per state). */
export const MOD_QUESTIONS_SHOWN = 500;

export type PollRow = typeof polls.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type SettingsRow = typeof sessionSettings.$inferSelect;

/** The event under the org's RLS, or `not_found` (foreign and unknown ids look the same). */
export async function eventOf(tx: TenantTx, eventId: string): Promise<EventDto> {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found');
  return ev;
}

/** The session of this event, or `not_found`. */
export async function sessionOf(tx: TenantTx, eventId: string, sessionId: string): Promise<SessionDto> {
  const s = (await sessionsOf(tx, eventId)).find((x) => x.id === sessionId);
  if (!s) throw new DomainError('not_found');
  return s;
}

/** The public may take part only in a published event that is not private. */
export const eventIsLive = (ev: Pick<EventDto, 'status' | 'visibility'>) =>
  ev.status === 'published' && ev.visibility !== 'private';

export async function settingsTx(tx: TenantTx, sessionId: string): Promise<SettingsRow | null> {
  const [row] = await tx.select().from(sessionSettings).where(eq(sessionSettings.sessionId, sessionId));
  return row ?? null;
}

export const toStage = (s: SettingsRow): StageDto => ({
  livePollId: s.livePollId,
  pinnedQuestionId: s.pinnedQuestionId,
  qaOpen: s.qaOpen,
  allowAnonymous: s.allowAnonymous,
  namesToModerators: s.anonymousIdentity === 'moderators',
});

export const toSettings = (s: SettingsRow): SettingsDto => ({
  ...toStage(s),
  anonymousIdentity: s.anonymousIdentity === 'moderators' ? 'moderators' : 'hidden',
  displayVersion: s.displayVersion,
});

type Tally = { pollId: string; key: string; count: number };

async function talliesTx(tx: TenantTx, pollIds: readonly string[]): Promise<Tally[]> {
  if (pollIds.length === 0) return [];
  return tx
    .select({ pollId: pollTallies.pollId, key: pollTallies.key, count: pollTallies.count })
    .from(pollTallies)
    .where(inArray(pollTallies.pollId, [...pollIds]));
}

const shapeOf = (p: PollRow) => ({
  kind: p.kind as PollKind,
  options: (p.options ?? []) as PollOption[],
  maxChoices: p.maxChoices,
  ratingScale: p.ratingScale,
});

function base(p: PollRow) {
  return {
    id: p.id,
    kind: p.kind as PollKind,
    question: p.question,
    options: (p.options ?? []) as PollOption[],
    maxChoices: p.maxChoices,
    ratingScale: p.ratingScale,
    showResults: p.showResults,
    ballots: p.ballots,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toModPoll(p: PollRow, tallies: readonly Tally[]): ModPollDto {
  const mine = tallies.filter((t) => t.pollId === p.id);
  return {
    ...base(p),
    state: p.state as ModPollDto['state'],
    results: pollResults(shapeOf(p), p.ballots, mine),
  };
}

/** The public shape, or null for a draft (drafts never leave the console). */
export function toPublicPoll(p: PollRow, tallies: readonly Tally[]) {
  if (p.state !== 'open' && p.state !== 'closed') return null;
  const mine = tallies.filter((t) => t.pollId === p.id);
  return PublicPollDto.parse({
    ...base(p),
    state: p.state,
    results: p.showResults ? pollResults(shapeOf(p), p.ballots, mine) : null,
  });
}

export function toModQuestion(q: QuestionRow): ModQuestionDto {
  return {
    id: q.id,
    body: q.body,
    authorName: q.authorName,
    anonymous: q.anonymous,
    state: q.state as ModQuestionDto['state'],
    upvotes: q.upvotes,
    answered: q.answeredAt !== null,
    createdAt: q.createdAt.toISOString(),
  };
}

/** The public shape, or null unless approved. An anonymous question never shows a name. */
export function toPublicQuestion(q: QuestionRow) {
  if (q.state !== 'approved') return null;
  return PublicQuestionDto.parse({
    id: q.id,
    body: q.body,
    authorName: q.anonymous ? null : q.authorName,
    upvotes: q.upvotes,
    answered: q.answeredAt !== null,
    createdAt: q.createdAt.toISOString(),
  });
}

/** The whole public state of a session (the audience's and the big screen's snapshot). */
export async function publicLiveStateTx(tx: TenantTx, settings: SettingsRow): Promise<PublicLiveStateDto> {
  const pollRows = await tx
    .select()
    .from(polls)
    .where(and(eq(polls.sessionId, settings.sessionId), ne(polls.state, 'draft')))
    .orderBy(asc(polls.createdAt), asc(polls.id));
  const tallies = await talliesTx(
    tx,
    pollRows.filter((p) => p.showResults).map((p) => p.id),
  );
  const approved = await tx
    .select()
    .from(questions)
    .where(and(eq(questions.sessionId, settings.sessionId), eq(questions.state, 'approved')))
    .orderBy(desc(questions.upvotes), asc(questions.createdAt))
    .limit(PUBLIC_QUESTIONS_SHOWN);
  const list = approved.flatMap((q) => {
    const p = toPublicQuestion(q);
    return p ? [p] : [];
  });
  return {
    stage: toStage(settings),
    polls: pollRows.flatMap((p) => {
      const d = toPublicPoll(p, tallies);
      return d ? [d] : [];
    }),
    questions: publicOrder(list, settings.pinnedQuestionId),
  };
}

/** The moderator console's state of a session. */
export async function modStateTx(tx: TenantTx, settings: SettingsRow): Promise<ModStateDto> {
  const pollRows = await tx
    .select()
    .from(polls)
    .where(eq(polls.sessionId, settings.sessionId))
    .orderBy(asc(polls.createdAt), asc(polls.id));
  const tallies = await talliesTx(
    tx,
    pollRows.map((p) => p.id),
  );
  const rows = await tx
    .select()
    .from(questions)
    .where(eq(questions.sessionId, settings.sessionId))
    .orderBy(desc(questions.createdAt), desc(questions.id))
    .limit(MOD_QUESTIONS_SHOWN);
  return {
    stage: toStage(settings),
    polls: pollRows.map((p) => toModPoll(p, tallies)),
    questions: rows.map(toModQuestion),
  };
}

// --- Realtime --------------------------------------------------------------------------------

interface Where {
  readonly orgId: string;
  readonly eventId: string;
  readonly sessionId: string;
}

/** A poll changed: the moderators get it with results; the audience unless it is a draft. */
export async function publishPollTx(tx: TenantTx, w: Where, p: PollRow): Promise<void> {
  const tallies = await talliesTx(tx, [p.id]);
  const at = { eventId: w.eventId, sessionId: w.sessionId };
  await publishRealtimeTx(tx, w.orgId, MODERATION_CHANNEL, {
    ...at,
    event: 'poll',
    data: toModPoll(p, tallies),
  });
  const pub = toPublicPoll(p, tallies);
  if (pub) await publishRealtimeTx(tx, w.orgId, LIVE_CHANNEL, { ...at, event: 'poll', data: pub });
}

export async function publishPollRemovedTx(tx: TenantTx, w: Where, pollId: string, wasPublic: boolean) {
  const at = { eventId: w.eventId, sessionId: w.sessionId, event: 'poll-removed', data: { id: pollId } };
  await publishRealtimeTx(tx, w.orgId, MODERATION_CHANNEL, at);
  if (wasPublic) await publishRealtimeTx(tx, w.orgId, LIVE_CHANNEL, at);
}

/**
 * A question changed: the moderators always get it; the audience gets it while approved, and a
 * removal when it stops being approved. A question that was never approved never reaches them.
 */
export async function publishQuestionTx(tx: TenantTx, w: Where, q: QuestionRow, wasApproved: boolean) {
  const at = { eventId: w.eventId, sessionId: w.sessionId };
  await publishRealtimeTx(tx, w.orgId, MODERATION_CHANNEL, {
    ...at,
    event: 'question',
    data: toModQuestion(q),
  });
  const pub = toPublicQuestion(q);
  if (pub) await publishRealtimeTx(tx, w.orgId, LIVE_CHANNEL, { ...at, event: 'question', data: pub });
  else if (wasApproved)
    await publishRealtimeTx(tx, w.orgId, LIVE_CHANNEL, {
      ...at,
      event: 'question-removed',
      data: { id: q.id },
    });
}

export async function publishStageTx(tx: TenantTx, w: Where, s: SettingsRow) {
  const at = { eventId: w.eventId, sessionId: w.sessionId, event: 'stage', data: toStage(s) };
  await publishRealtimeTx(tx, w.orgId, MODERATION_CHANNEL, at);
  await publishRealtimeTx(tx, w.orgId, LIVE_CHANNEL, at);
}
