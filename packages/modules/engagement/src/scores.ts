import { attendeeContactIdsTx, participationAttendeesTx } from '@yayatoh/attendees';
import { contactForAccountTx, contactsByIdsTx, replaceEventEngagementTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  catchUpSubscriber,
  defineSubscriber,
  type PublishedEvent,
  type Subscriber,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { sessionsOf } from '@yayatoh/program';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  type Counts,
  DEFAULT_WEIGHTS,
  engagementScore,
  MAX_WEIGHT,
  normalizeCounts,
  sessionScore,
  type Weights,
} from './domain/score.ts';
import { ENGAGEMENT_KINDS, type EngagementKind, engagementEvents, scoreWeights } from './schema.ts';

/**
 * Engagement scores (M5.7b). `engagement_events` is the log of what attendees did (door scans,
 * poll votes, questions, answered surveys, session enrollments); a score is the org's weights ×
 * those counts (`domain/score.ts`). Each attendee's score per event is pushed to
 * `crm.event_engagement` in the same transaction, where audiences segment on it.
 */

/** A signed-in account as the web app read it from its own session (never from a form). */
export const Account = z.object({ userId: z.uuid(), email: z.email().max(320) });
export type Account = z.infer<typeof Account>;

export const WeightsDto = z.object({
  check_in: z.int().min(0).max(MAX_WEIGHT),
  poll_vote: z.int().min(0).max(MAX_WEIGHT),
  question: z.int().min(0).max(MAX_WEIGHT),
  feedback: z.int().min(0).max(MAX_WEIGHT),
  enrollment: z.int().min(0).max(MAX_WEIGHT),
});
export type WeightsDto = z.infer<typeof WeightsDto>;

/** The org's weights, or the defaults while it has not set its own. */
export async function weightsTx(tx: TenantTx): Promise<{ weights: Weights; custom: boolean }> {
  const [row] = await tx.select().from(scoreWeights).limit(1);
  if (!row) return { weights: DEFAULT_WEIGHTS, custom: false };
  return {
    weights: {
      check_in: row.checkIn,
      poll_vote: row.pollVote,
      question: row.question,
      feedback: row.feedback,
      enrollment: row.enrollment,
    },
    custom: true,
  };
}

const countsOf = (rows: readonly { kind: string; n: number }[]): Counts => {
  const out: Partial<Record<EngagementKind, number>> = {};
  for (const r of rows) out[r.kind as EngagementKind] = (out[r.kind as EngagementKind] ?? 0) + Number(r.n);
  return out;
};

/** Every contact's counts per kind at one event (or only these contacts). */
async function contactCountsTx(tx: TenantTx, eventId: string, contactIds: readonly string[] | null) {
  if (contactIds !== null && contactIds.length === 0) return new Map<string, Counts>();
  const rows = await tx
    .select({
      contactId: engagementEvents.contactId,
      kind: engagementEvents.kind,
      n: sql<number>`count(*)::int`,
    })
    .from(engagementEvents)
    .where(
      and(
        eq(engagementEvents.eventId, eventId),
        contactIds === null ? undefined : inArray(engagementEvents.contactId, [...contactIds]),
      ),
    )
    .groupBy(engagementEvents.contactId, engagementEvents.kind);
  const by = new Map<string, { kind: string; n: number }[]>();
  for (const r of rows) by.set(r.contactId, [...(by.get(r.contactId) ?? []), r]);
  return new Map([...by].map(([id, list]) => [id, countsOf(list)]));
}

/**
 * Recompute the scores of these contacts at one event (or everyone there) from the log and push
 * them to crm. Idempotent: the same log always gives the same scores.
 */
export async function rescoreTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  contactIds: readonly string[] | null,
): Promise<void> {
  const { weights } = await weightsTx(tx);
  const counts = await contactCountsTx(tx, eventId, contactIds);
  await replaceEventEngagementTx(tx, ctx, {
    eventId,
    contactIds,
    rows: [...counts].map(([contactId, c]) => ({ contactId, score: engagementScore(c, weights) })),
  });
}

export interface EngagementFact {
  readonly eventId: string;
  readonly contactId: string;
  readonly sessionId: string | null;
  readonly kind: EngagementKind;
  readonly sourceRef: string;
  readonly occurredAt: Date;
}

/** Log one fact (once: the same contact, kind and source never count twice) and rescore them. */
export async function recordEngagementTx(tx: TenantTx, ctx: Ctx, f: EngagementFact): Promise<boolean> {
  const added = await tx
    .insert(engagementEvents)
    .values({
      orgId: requireOrg(ctx),
      eventId: f.eventId,
      contactId: f.contactId,
      sessionId: f.sessionId,
      kind: f.kind,
      sourceRef: f.sourceRef,
      occurredAt: f.occurredAt,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoNothing()
    .returning({ id: engagementEvents.id });
  if (added.length === 0) return false;
  await rescoreTx(tx, ctx, f.eventId, [f.contactId]);
  return true;
}

/** Take a fact back (an admission undone, a session dropped) and rescore. */
export async function forgetEngagementTx(
  tx: TenantTx,
  ctx: Ctx,
  f: Pick<EngagementFact, 'eventId' | 'kind' | 'sourceRef'> & { readonly contactIds: readonly string[] },
): Promise<void> {
  if (f.contactIds.length === 0) return;
  await tx
    .delete(engagementEvents)
    .where(
      and(
        eq(engagementEvents.eventId, f.eventId),
        eq(engagementEvents.kind, f.kind),
        eq(engagementEvents.sourceRef, f.sourceRef),
        inArray(engagementEvents.contactId, [...f.contactIds]),
      ),
    );
  await rescoreTx(tx, ctx, f.eventId, f.contactIds);
}

/** The contacts among these with an active attendee record at the event (the ones scored). */
async function attendingTx(tx: TenantTx, eventId: string, contactIds: readonly string[]): Promise<string[]> {
  const records = await participationAttendeesTx(tx, eventId, contactIds);
  return [...new Set(records.filter((r) => r.status === 'active').map((r) => r.contactId))];
}

/**
 * Live polls and Q&A (M5.7a) count for a signed-in attendee: the command's actor must be the
 * account, whose contact must be on the event's list. Anyone else (a device, a visitor who is not
 * an attendee) takes part exactly as before and is not scored.
 */
export async function recordLiveActivityTx(
  tx: TenantTx,
  ctx: Ctx,
  account: Account | undefined,
  f: Omit<EngagementFact, 'contactId' | 'occurredAt'>,
): Promise<void> {
  if (!account || ctx.actor.type !== 'user' || ctx.actor.userId !== account.userId) return;
  const contactId = await contactForAccountTx(tx, account);
  if (!contactId) return;
  if ((await attendingTx(tx, f.eventId, [contactId])).length === 0) return;
  await recordEngagementTx(tx, ctx, { ...f, contactId, occurredAt: ctx.now });
}

// ---------------------------------------------------------------------------------------------
// The activity subscriber

/** What the subscriber turns into engagement (all v1; `survey.responded` needs its contact). */
export const ENGAGEMENT_SOURCE_EVENTS = [
  'ticket.admitted@1',
  'ticket.admission_undone@1',
  'survey.responded@1',
  'registration.session.promoted@1',
  'registration.session.enrollment_changed@1',
] as const;

const Admission = z.object({ eventId: z.uuid(), ticketId: z.uuid() });
const Responded = z.object({
  eventId: z.uuid(),
  surveyId: z.uuid(),
  contactId: z.uuid().optional(),
  sessionId: z.uuid().nullable().optional(),
});
const Enrollment = z.object({
  eventId: z.uuid(),
  sessionId: z.uuid(),
  registrantId: z.uuid(),
  status: z.string(),
});

/** Apply one outbox event to the log (exactly once per event; idempotent besides). */
export async function applyEngagementEventTx(
  tx: TenantTx,
  ctx: Ctx,
  event: Pick<PublishedEvent, 'type' | 'version' | 'payload' | 'occurredAt'>,
): Promise<void> {
  const at = event.occurredAt ? new Date(event.occurredAt) : ctx.now;
  switch (`${event.type}@${event.version}`) {
    case 'ticket.admitted@1': {
      const v = Admission.parse(event.payload);
      const people = await attendingTx(
        tx,
        v.eventId,
        await attendeeContactIdsTx(tx, { ticketIds: [v.ticketId] }),
      );
      for (const contactId of people)
        await recordEngagementTx(tx, ctx, {
          eventId: v.eventId,
          contactId,
          sessionId: null,
          kind: 'check_in',
          sourceRef: `ticket:${v.ticketId}`,
          occurredAt: at,
        });
      return;
    }
    case 'ticket.admission_undone@1': {
      const v = Admission.parse(event.payload);
      await forgetEngagementTx(tx, ctx, {
        eventId: v.eventId,
        kind: 'check_in',
        sourceRef: `ticket:${v.ticketId}`,
        contactIds: await attendeeContactIdsTx(tx, { ticketIds: [v.ticketId] }),
      });
      return;
    }
    case 'survey.responded@1': {
      const v = Responded.parse(event.payload);
      // Responses recorded before M5.7b name no contact: they are not scored.
      if (!v.contactId) return;
      if ((await attendingTx(tx, v.eventId, [v.contactId])).length === 0) return;
      await recordEngagementTx(tx, ctx, {
        eventId: v.eventId,
        contactId: v.contactId,
        sessionId: v.sessionId ?? null,
        kind: 'feedback',
        sourceRef: `survey:${v.surveyId}`,
        occurredAt: at,
      });
      return;
    }
    case 'registration.session.promoted@1':
    case 'registration.session.enrollment_changed@1': {
      const v = Enrollment.parse(event.payload);
      // The registrant is their admission ticket (M5.2b).
      const people = await attendeeContactIdsTx(tx, { ticketIds: [v.registrantId] });
      const ref = `session:${v.sessionId}`;
      if (v.status === 'enrolled') {
        for (const contactId of await attendingTx(tx, v.eventId, people))
          await recordEngagementTx(tx, ctx, {
            eventId: v.eventId,
            contactId,
            sessionId: v.sessionId,
            kind: 'enrollment',
            sourceRef: ref,
            occurredAt: at,
          });
      } else if (v.status === 'dropped') {
        await forgetEngagementTx(tx, ctx, {
          eventId: v.eventId,
          kind: 'enrollment',
          sourceRef: ref,
          contactIds: people,
        });
      }
      return;
    }
    default:
      return;
  }
}

/**
 * The `engagement.activity` subscriber (M5.7b): door scans, answered surveys and session
 * enrollments become engagement facts (live polls and Q&A are logged by their own commands).
 */
export function engagementActivity(): Subscriber {
  return defineSubscriber({
    name: 'engagement.activity',
    events: ENGAGEMENT_SOURCE_EVENTS,
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'engagement.activity' } });
      await applyEngagementEventTx(tx, ctx, event);
    },
  });
}

/** Apply the org's outbox events the subscriber has not handled yet (seed, e2e, fixtures). */
export function catchUpEngagement(orgId: string) {
  return catchUpSubscriber(engagementActivity(), orgId);
}

// ---------------------------------------------------------------------------------------------
// Weights

const toDto = (w: Weights): WeightsDto => ({ ...w });

export const scoreWeightsQuery = tenantQuery({
  name: 'engagement.scoreWeights',
  input: z.object({}),
  output: z.object({ weights: WeightsDto, custom: z.boolean() }),
  entitlement: 'sessions',
  permission: 'events:read',
  handler: async ({ tx }) => {
    const w = await weightsTx(tx);
    return { weights: toDto(w.weights), custom: w.custom };
  },
});

/**
 * Set the org's weights (owners and admins: `org:update`). Every score of the org is recomputed
 * in the same transaction, so segments never mix old and new weights.
 */
export const setScoreWeightsCommand = tenantCommand({
  name: 'engagement.setScoreWeights',
  input: WeightsDto,
  output: z.object({ weights: WeightsDto, rescored: z.int() }),
  entitlement: 'sessions',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const values = {
      checkIn: input.check_in,
      pollVote: input.poll_vote,
      question: input.question,
      feedback: input.feedback,
      enrollment: input.enrollment,
      updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      updatedAt: ctx.now,
    };
    await tx
      .insert(scoreWeights)
      .values({ orgId, ...values, createdAt: ctx.now })
      .onConflictDoUpdate({ target: [scoreWeights.orgId], set: values });
    const events = await tx.selectDistinct({ eventId: engagementEvents.eventId }).from(engagementEvents);
    for (const e of events) await rescoreTx(tx, ctx, e.eventId, null);
    return { weights: input, rescored: events.length };
  },
  audit: (input, r) => ({
    action: 'engagement.weights.set',
    targetType: 'org',
    targetId: null,
    data: { ...input, rescored: r?.rescored ?? 0 },
  }),
});

/** Back to the defaults (removes the org's row) and rescore. */
export const resetScoreWeightsCommand = tenantCommand({
  name: 'engagement.resetScoreWeights',
  input: z.object({}),
  output: z.object({ weights: WeightsDto, rescored: z.int() }),
  entitlement: 'sessions',
  permission: 'org:update',
  handler: async ({ ctx, tx }) => {
    await tx.delete(scoreWeights);
    const events = await tx.selectDistinct({ eventId: engagementEvents.eventId }).from(engagementEvents);
    for (const e of events) await rescoreTx(tx, ctx, e.eventId, null);
    return { weights: toDto(DEFAULT_WEIGHTS), rescored: events.length };
  },
  audit: (_input, r) => ({
    action: 'engagement.weights.reset',
    targetType: 'org',
    targetId: null,
    data: { rescored: r?.rescored ?? 0 },
  }),
});

// ---------------------------------------------------------------------------------------------
// Scores of an event

export const SCORES_SHOWN = 50;

const CountsDto = z.object({
  check_in: z.int().min(0),
  poll_vote: z.int().min(0),
  question: z.int().min(0),
  feedback: z.int().min(0),
  enrollment: z.int().min(0),
});

export const AttendeeScoreDto = z.object({
  contactId: z.uuid(),
  name: z.string(),
  email: z.string(),
  score: z.int().min(0),
  counts: CountsDto,
});
export type AttendeeScoreDto = z.infer<typeof AttendeeScoreDto>;

export const SessionScoreDto = z.object({
  sessionId: z.uuid(),
  title: z.string(),
  startsAt: z.date(),
  participants: z.int().min(0),
  score: z.int().min(0),
  counts: CountsDto,
});
export type SessionScoreDto = z.infer<typeof SessionScoreDto>;

export const EventScoresDto = z.object({
  weights: WeightsDto,
  custom: z.boolean(),
  /** Attendees with any engagement, and their average score (rounded down). */
  engaged: z.int().min(0),
  averageScore: z.int().min(0),
  attendees: z.array(AttendeeScoreDto),
  sessions: z.array(SessionScoreDto),
});
export type EventScoresDto = z.infer<typeof EventScoresDto>;

/**
 * An event's engagement: the top attendees by score (names and emails need `attendees:read`)
 * and every session's score. Recomputed from the log on read with the current weights.
 */
export const eventScoresQuery = tenantQuery({
  name: 'engagement.eventScores',
  input: z.object({ eventId: z.uuid(), contactId: z.uuid().optional() }),
  output: EventScoresDto,
  entitlement: 'sessions',
  permission: 'attendees:read',
  handler: async ({ input, tx }) => {
    const ev = await findEventTx(tx, input.eventId);
    if (!ev) throw new DomainError('not_found');
    const w = await weightsTx(tx);
    const counts = await contactCountsTx(tx, ev.id, null);
    const scored = [...counts]
      .map(([contactId, c]) => ({
        contactId,
        counts: normalizeCounts(c),
        score: engagementScore(c, w.weights),
      }))
      .sort((a, b) => b.score - a.score || a.contactId.localeCompare(b.contactId));
    const shown = input.contactId
      ? scored.filter((s) => s.contactId === input.contactId)
      : scored.slice(0, SCORES_SHOWN);
    const people = await contactsByIdsTx(
      tx,
      shown.map((s) => s.contactId),
    );
    const bySession = await tx
      .select({
        sessionId: engagementEvents.sessionId,
        kind: engagementEvents.kind,
        n: sql<number>`count(*)::int`,
        people: sql<number>`count(distinct ${engagementEvents.contactId})::int`,
      })
      .from(engagementEvents)
      .where(and(eq(engagementEvents.eventId, ev.id), sql`${engagementEvents.sessionId} is not null`))
      .groupBy(engagementEvents.sessionId, engagementEvents.kind);
    const participants = await tx
      .select({
        sessionId: engagementEvents.sessionId,
        people: sql<number>`count(distinct ${engagementEvents.contactId})::int`,
      })
      .from(engagementEvents)
      .where(and(eq(engagementEvents.eventId, ev.id), sql`${engagementEvents.sessionId} is not null`))
      .groupBy(engagementEvents.sessionId);
    const sessionList = await sessionsOf(tx, ev.id);
    const sessions = sessionList.map((s) => {
      const c = countsOf(bySession.filter((r) => r.sessionId === s.id));
      const full = Object.fromEntries(ENGAGEMENT_KINDS.map((k) => [k, c[k] ?? 0])) as Record<
        EngagementKind,
        number
      >;
      return {
        sessionId: s.id,
        title: s.title,
        startsAt: s.startsAt,
        participants: Number(participants.find((p) => p.sessionId === s.id)?.people ?? 0),
        score: sessionScore(c, w.weights),
        counts: full,
      };
    });
    const total = scored.reduce((n, s) => n + s.score, 0);
    return {
      weights: toDto(w.weights),
      custom: w.custom,
      engaged: scored.length,
      averageScore: scored.length ? Math.floor(total / scored.length) : 0,
      attendees: shown.map((s) => ({
        contactId: s.contactId,
        name: people.get(s.contactId)?.name ?? '',
        email: people.get(s.contactId)?.email ?? '',
        score: s.score,
        counts: s.counts,
      })),
      sessions,
    };
  },
});
