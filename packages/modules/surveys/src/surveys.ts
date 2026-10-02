import { attendeesForExportTx, eventAttendeesTx } from '@yayatoh/attendees';
import { admittedTicketIdsTx } from '@yayatoh/checkin';
import { isUniqueViolation, type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type EventDto, findEventTx } from '@yayatoh/events';
import {
  currentFormTx,
  FormDefinition,
  PublicFormDto,
  publishFormTx,
  subjectResponsesTx,
  submitResponseTx,
} from '@yayatoh/forms';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { cancelQueuedTx } from '@yayatoh/notifications';
import {
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { sessionsOf } from '@yayatoh/program';
import { assertNotPausedTx, organizationNameTx } from '@yayatoh/tenancy';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type QuestionReport, responseRate, summarizeQuestion } from './domain/report.ts';
import {
  SEND_AUDIENCES,
  SEND_SOURCES,
  type SendAudience,
  SURVEY_KINDS,
  surveyInvitations,
  surveyResponses,
  surveySends,
  surveys,
} from './schema.ts';

export const SURVEY_PURPOSE = 'surveys.invitation';
/** Links stay valid this many days unless the organizer picks otherwise (1–90). */
export const DEFAULT_LINK_DAYS = 30;
/** One send reaches at most this many people (larger events: send again for the rest). */
export const MAX_RECIPIENTS = 10_000;
const DAY_MS = 86_400_000;

export const surveyToken = (invitationId: string) => signLinkToken(SURVEY_PURPOSE, invitationId);
export const inviteDedupeKey = (invitationId: string) => `survey-invite:${invitationId}`;
export const reminderDedupeKey = (invitationId: string) => `survey-reminder:${invitationId}`;
const formSubject = (surveyId: string) =>
  ({ kind: 'survey', subjectType: 'survey', subjectId: surveyId }) as const;

const Title = z.string().trim().min(1).max(120);
const Intro = z.string().trim().max(500).default('');
const Ref = z.object({ eventId: z.uuid(), surveyId: z.uuid() });

type SurveyRow = typeof surveys.$inferSelect;

async function surveyTx(tx: TenantTx, eventId: string, surveyId: string): Promise<SurveyRow> {
  const [row] = await tx
    .select()
    .from(surveys)
    .where(and(eq(surveys.id, surveyId), eq(surveys.eventId, eventId)));
  if (!row) throw new DomainError('not_found', 'Survey not found');
  return row;
}

async function sessionOf(tx: TenantTx, eventId: string, sessionId: string | null) {
  if (!sessionId) return null;
  return (await sessionsOf(tx, eventId)).find((s) => s.id === sessionId) ?? null;
}

/** When the survey's subject is over: the session's end, else the event's. */
async function subjectEndsAt(tx: TenantTx, s: SurveyRow, ev: EventDto): Promise<Date> {
  const session = await sessionOf(tx, s.eventId, s.sessionId);
  return session?.endsAt ?? ev.endsAt;
}

// ---------------------------------------------------------------------------------------------
// Organizer commands

export const CreateSurveyInput = z
  .object({
    eventId: z.uuid(),
    kind: z.enum(SURVEY_KINDS),
    sessionId: z.uuid().nullable().default(null),
    title: Title,
    intro: Intro,
    /** The starting questions (the console passes a translated default set). */
    definition: FormDefinition.default({ fields: [] }),
  })
  .refine((v) => (v.kind === 'session_feedback') === (v.sessionId !== null), {
    message: 'Session feedback needs a session',
    path: ['sessionId'],
  });

/**
 * Create the event's post-event survey, or feedback for one of its sessions (one of each per
 * subject: a second is a conflict). The starting questions are published as version 1.
 */
export const createSurveyCommand = tenantCommand({
  name: 'surveys.createSurvey',
  input: CreateSurveyInput,
  output: z.object({ id: z.uuid() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    if (!(await findEventTx(tx, input.eventId))) throw new DomainError('not_found', 'Event not found');
    if (input.sessionId && !(await sessionOf(tx, input.eventId, input.sessionId)))
      throw new DomainError('not_found', 'Session not found', { reason: 'session', field: 'sessionId' });
    let row: { id: string } | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .insert(surveys)
          .values({
            orgId,
            eventId: input.eventId,
            kind: input.kind,
            sessionId: input.sessionId,
            title: input.title,
            intro: input.intro,
            createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
          })
          .returning({ id: surveys.id }),
      );
    } catch (err) {
      if (
        isUniqueViolation(err, 'surveys_org_event_post_event_key') ||
        isUniqueViolation(err, 'surveys_org_session_key')
      )
        throw new DomainError('conflict', 'This survey already exists', { reason: 'survey_exists' });
      throw err;
    }
    if (!row) throw new DomainError('internal');
    if (input.definition.fields.length > 0)
      await publishFormTx(tx, ctx, formSubject(row.id), input.definition);
    return { id: row.id };
  },
  audit: (input, r) => ({
    action: 'survey.create',
    targetType: 'survey',
    targetId: r?.id ?? null,
    data: { eventId: input.eventId, kind: input.kind, sessionId: input.sessionId },
  }),
});

export const updateSurveyCommand = tenantCommand({
  name: 'surveys.updateSurvey',
  input: Ref.extend({ title: Title, intro: Intro }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const s = await surveyTx(tx, input.eventId, input.surveyId);
    await tx
      .update(surveys)
      .set({ title: input.title, intro: input.intro, updatedAt: ctx.now })
      .where(eq(surveys.id, s.id));
    return { ok: true };
  },
  audit: (input) => ({ action: 'survey.update', targetType: 'survey', targetId: input.surveyId }),
});

/**
 * Publish the survey's questions as a new form version. People who already answered keep their
 * version; links sent earlier show the current one. A closed survey can't be edited.
 */
export const saveSurveyQuestionsCommand = tenantCommand({
  name: 'surveys.saveQuestions',
  input: Ref.extend({ definition: FormDefinition }),
  output: z.object({ version: z.int() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const s = await surveyTx(tx, input.eventId, input.surveyId);
    if (s.closedAt) throw new DomainError('invalid_state', 'The survey is closed', { reason: 'closed' });
    return publishFormTx(tx, ctx, formSubject(s.id), input.definition);
  },
  audit: (input, r) => ({
    action: 'survey.questions',
    targetType: 'survey',
    targetId: input.surveyId,
    data: { version: r?.version, questions: input.definition.fields.length },
  }),
});

/**
 * Close (or reopen) a survey. Closed surveys refuse answers, and their queued reminders are
 * canceled (reason `survey_closed`); reopening does not queue them again.
 */
export const setSurveyClosedCommand = tenantCommand({
  name: 'surveys.setClosed',
  input: Ref.extend({ closed: z.boolean() }),
  output: z.object({ closed: z.boolean(), remindersCanceled: z.int() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx }) => {
    const s = await surveyTx(tx, input.eventId, input.surveyId);
    await tx
      .update(surveys)
      .set({ closedAt: input.closed ? (s.closedAt ?? ctx.now) : null, updatedAt: ctx.now })
      .where(eq(surveys.id, s.id));
    let remindersCanceled = 0;
    if (input.closed) {
      const open = await tx
        .select({ id: surveyInvitations.id })
        .from(surveyInvitations)
        .where(and(eq(surveyInvitations.surveyId, s.id), isNull(surveyInvitations.respondedAt)));
      remindersCanceled = await cancelQueuedTx(
        tx,
        open.map((i) => reminderDedupeKey(i.id)),
        'survey_closed',
        ctx.now,
      );
    }
    return { closed: input.closed, remindersCanceled };
  },
  audit: (input, r) => ({
    action: input.closed ? 'survey.close' : 'survey.reopen',
    targetType: 'survey',
    targetId: input.surveyId,
    data: { remindersCanceled: r?.remindersCanceled ?? 0 },
  }),
});

// ---------------------------------------------------------------------------------------------
// Sending

export const SendInput = Ref.extend({
  audience: z.enum(SEND_AUDIENCES).default('all'),
  /** Remind people who have not answered after this many days; null: no reminder. */
  reminderDays: z.int().min(1).max(30).nullable().default(null),
  linkDays: z.int().min(1).max(90).default(DEFAULT_LINK_DAYS),
});

interface Invitee {
  readonly attendeeId: string;
  readonly contactId: string;
}

/**
 * Record one send and its invitations (one per person not yet invited to this survey), then
 * emit `survey.sent@1`; the mailer queues the emails (and reminders) through the dispatcher.
 */
async function inviteTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  s: SurveyRow,
  people: readonly Invitee[],
  opts: {
    source: (typeof SEND_SOURCES)[number];
    audience: SendAudience;
    reminderDays: number | null;
    linkDays: number;
  },
): Promise<{ sendId: string; invitationIds: string[] }> {
  const orgId = requireOrg(ctx);
  const [send] = await tx
    .insert(surveySends)
    .values({
      orgId,
      surveyId: s.id,
      source: opts.source,
      audience: opts.audience,
      reminderDays: opts.reminderDays,
      linkDays: opts.linkDays,
      recipients: 0,
      sentBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .returning({ id: surveySends.id });
  if (!send) throw new DomainError('internal');
  const rows = people.length
    ? await tx
        .insert(surveyInvitations)
        .values(
          people.map((p) => ({
            orgId,
            surveyId: s.id,
            sendId: send.id,
            attendeeId: p.attendeeId,
            contactId: p.contactId,
            expiresAt: new Date(ctx.now.getTime() + opts.linkDays * DAY_MS),
            remindAt: opts.reminderDays ? new Date(ctx.now.getTime() + opts.reminderDays * DAY_MS) : null,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: surveyInvitations.id })
    : [];
  await tx.update(surveySends).set({ recipients: rows.length }).where(eq(surveySends.id, send.id));
  if (rows.length)
    emit({
      type: 'survey.sent',
      version: 1,
      aggregateType: 'survey',
      aggregateId: s.id,
      payload: { orgId, surveyId: s.id, sendId: send.id },
    });
  return { sendId: send.id, invitationIds: rows.map((r) => r.id) };
}

/** Who a send reaches: one attendee per person (contact), optionally only people who came in. */
async function audienceTx(tx: TenantTx, eventId: string, audience: SendAudience): Promise<Invitee[]> {
  const all = (await eventAttendeesTx(tx, eventId)).filter((a) => a.email.trim() !== '');
  let people = all;
  if (audience === 'checked_in') {
    const admitted = await admittedTicketIdsTx(
      tx,
      eventId,
      all.flatMap((a) => (a.ticketId ? [a.ticketId] : [])),
    );
    const cameIn = new Set(all.filter((a) => a.ticketId && admitted.has(a.ticketId)).map((a) => a.contactId));
    // A person counts as checked in when any of their tickets was admitted; ask them on that one.
    people = all.filter((a) => cameIn.has(a.contactId) && a.ticketId && admitted.has(a.ticketId));
  }
  const byContact = new Map<string, Invitee>();
  for (const a of people)
    if (!byContact.has(a.contactId)) byContact.set(a.contactId, { attendeeId: a.id, contactId: a.contactId });
  return [...byContact.values()];
}

/**
 * Send the survey to the event's attendees (or only those who checked in), once its event or
 * session is over. People already invited are skipped, so sending again reaches only newcomers;
 * the Idempotency-Key makes a double submit send once.
 */
export const sendSurveyCommand = tenantCommand({
  name: 'surveys.sendSurvey',
  input: SendInput,
  output: z.object({ sent: z.int() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  idempotent: true,
  handler: async ({ input, ctx, tx, emit }) => {
    await assertNotPausedTx(tx, 'pause_messaging');
    const s = await surveyTx(tx, input.eventId, input.surveyId);
    if (s.closedAt) throw new DomainError('invalid_state', 'The survey is closed', { reason: 'closed' });
    const ev = await findEventTx(tx, s.eventId);
    if (!ev) throw new DomainError('not_found', 'Event not found');
    if ((await subjectEndsAt(tx, s, ev)) > ctx.now)
      throw new DomainError('invalid_state', 'Surveys go out once it is over', { reason: 'not_ended' });
    const form = await currentFormTx(tx, formSubject(s.id));
    if (!form || form.definition.fields.length === 0)
      throw new DomainError('invalid_state', 'Add a question first', { reason: 'no_questions' });
    const everyone = await audienceTx(tx, s.eventId, input.audience);
    if (everyone.length === 0)
      throw new DomainError('invalid_state', 'Nobody to send to', {
        reason: input.audience === 'checked_in' ? 'nobody_checked_in' : 'no_attendees',
      });
    const invited = new Set(
      (
        await tx
          .select({ contactId: surveyInvitations.contactId })
          .from(surveyInvitations)
          .where(eq(surveyInvitations.surveyId, s.id))
      ).map((r) => r.contactId),
    );
    const fresh = everyone.filter((p) => !invited.has(p.contactId));
    if (fresh.length === 0)
      throw new DomainError('invalid_state', 'Everyone was already asked', { reason: 'all_invited' });
    if (fresh.length > MAX_RECIPIENTS)
      throw new DomainError('validation_failed', `At most ${MAX_RECIPIENTS} people per send`, {
        reason: 'too_many',
      });
    const r = await inviteTx(tx, ctx, emit, s, fresh, {
      source: 'console',
      audience: input.audience,
      reminderDays: input.reminderDays,
      linkDays: input.linkDays,
    });
    return { sent: r.invitationIds.length, sendId: r.sendId };
  },
  present: (r) => ({ sent: r.sent }),
  audit: (input, r) => ({
    action: 'survey.send',
    targetType: 'survey',
    targetId: input.surveyId,
    data: {
      audience: input.audience,
      reminderDays: input.reminderDays,
      linkDays: input.linkDays,
      sent: r?.sent ?? 0,
      sendId: r?.sendId ?? null,
    },
  }),
});

export type SurveyStepResult =
  | { readonly status: 'invited'; readonly invitationId: string }
  | {
      readonly status: 'skipped';
      readonly reason: 'no_survey' | 'closed' | 'no_questions' | 'not_attending' | 'already_invited';
    };

/**
 * The journey step "After event → Survey" (M3.7a): invite one attendee to the event's
 * post-event survey inside the journey's own transaction. Skips (never throws) when there is no
 * open survey with questions, the person is not attending, or they were already asked; the
 * invitation's email goes out through `survey.sent@1` like a console send.
 */
export async function sendSurveyStepTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  eventId: string,
  recipient: { readonly attendeeId: string },
  opts: { readonly reminderDays?: number | null; readonly linkDays?: number } = {},
): Promise<SurveyStepResult> {
  const [s] = await tx
    .select()
    .from(surveys)
    .where(and(eq(surveys.eventId, eventId), eq(surveys.kind, 'post_event')));
  if (!s) return { status: 'skipped', reason: 'no_survey' };
  if (s.closedAt) return { status: 'skipped', reason: 'closed' };
  const form = await currentFormTx(tx, formSubject(s.id));
  if (!form || form.definition.fields.length === 0) return { status: 'skipped', reason: 'no_questions' };
  const person = (await eventAttendeesTx(tx, eventId)).find((a) => a.id === recipient.attendeeId);
  if (!person || person.email.trim() === '') return { status: 'skipped', reason: 'not_attending' };
  const r = await inviteTx(tx, ctx, emit, s, [{ attendeeId: person.id, contactId: person.contactId }], {
    source: 'journey',
    audience: 'all',
    reminderDays: opts.reminderDays ?? null,
    linkDays: opts.linkDays ?? DEFAULT_LINK_DAYS,
  });
  const [invitationId] = r.invitationIds;
  return invitationId
    ? { status: 'invited', invitationId }
    : { status: 'skipped', reason: 'already_invited' };
}

/**
 * Whether a person (contact) answered the event's post-event survey: the journey condition
 * "answered the survey" (M3.7a). False when the event has no post-event survey.
 */
export async function answeredEventSurveyTx(
  tx: TenantTx,
  eventId: string,
  contactId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: surveyResponses.id })
    .from(surveyResponses)
    .innerJoin(surveys, eq(surveys.id, surveyResponses.surveyId))
    .where(
      and(
        eq(surveys.eventId, eventId),
        eq(surveys.kind, 'post_event'),
        eq(surveyResponses.contactId, contactId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** `sendSurveyStepTx` as a command, for callers outside a transaction (a journey runner job). */
export const sendSurveyStepCommand = tenantCommand({
  name: 'surveys.sendSurveyStep',
  input: z.object({
    eventId: z.uuid(),
    attendeeId: z.uuid(),
    reminderDays: z.int().min(1).max(30).nullable().default(null),
    linkDays: z.int().min(1).max(90).default(DEFAULT_LINK_DAYS),
  }),
  output: z.object({ status: z.enum(['invited', 'skipped']), reason: z.string().nullable() }),
  entitlement: 'messaging',
  permission: 'messages:send',
  handler: async ({ input, ctx, tx, emit }) =>
    sendSurveyStepTx(tx, ctx, emit, input.eventId, { attendeeId: input.attendeeId }, input),
  present: (r) => ({ status: r.status, reason: r.status === 'skipped' ? r.reason : null }),
  audit: (input, r) => ({
    action: 'survey.step',
    targetType: 'attendee',
    targetId: input.attendeeId,
    data: { eventId: input.eventId, status: r?.status, reason: r?.status === 'skipped' ? r.reason : null },
  }),
});

const SentPayload = z.object({ orgId: z.uuid(), surveyId: z.uuid(), sendId: z.uuid() });

/**
 * Queues the invitation emails of one send, and each reminder at its time (dispatcher: policy
 * gate, quiet hours, unsubscribe). Reminders of people who answered in the meantime are
 * skipped here and canceled when they answer.
 */
export function surveyMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'surveys.mailer',
    events: ['survey.sent@1'],
    handle: async (tx, event) => {
      const p = SentPayload.parse(event.payload);
      const [s] = await tx.select().from(surveys).where(eq(surveys.id, p.surveyId));
      if (!s || s.closedAt) return;
      const ev = await findEventTx(tx, s.eventId);
      if (!ev) return;
      const invites = await tx
        .select()
        .from(surveyInvitations)
        .where(and(eq(surveyInvitations.sendId, p.sendId), isNull(surveyInvitations.respondedAt)));
      const people = new Map(
        (await attendeesForExportTx(tx, [...new Set(invites.map((i) => i.attendeeId))])).map((a) => [
          a.id,
          a,
        ]),
      );
      for (const inv of invites) {
        const a = people.get(inv.attendeeId);
        if (!a?.email) continue;
        const intent = {
          to: { email: a.email, name: a.name, timeZone: ev.timezone },
          params: {
            url: `${deps.appOrigin}/survey/${surveyToken(inv.id)}`,
            name: a.name,
            eventName: ev.name,
            title: s.title,
          },
          eventId: s.eventId,
        };
        await deps.notifier.enqueue(tx, {
          ...intent,
          kind: 'surveys.invite',
          dedupeKey: inviteDedupeKey(inv.id),
        });
        if (inv.remindAt && inv.remindAt < inv.expiresAt)
          await deps.notifier.enqueue(tx, {
            ...intent,
            kind: 'surveys.reminder',
            dedupeKey: reminderDedupeKey(inv.id),
            sendAfter: inv.remindAt,
          });
      }
    },
  });
}

// ---------------------------------------------------------------------------------------------
// The respondent's side

/** Survey link token → (org, invitation), through a SECURITY DEFINER function (ids only). */
export async function surveyRef(token: string): Promise<{ orgId: string; invitationId: string } | null> {
  if (token.length > 200) return null;
  const invitationId = verifyLinkToken(SURVEY_PURPOSE, token);
  if (!invitationId) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from surveys.invitation_org(${invitationId}::uuid)`),
  );
  return rows[0] ? { orgId: rows[0].org_id, invitationId } : null;
}

export const SURVEY_STATES = ['open', 'answered', 'expired', 'closed'] as const;
export type SurveyState = (typeof SURVEY_STATES)[number];

function stateOf(s: SurveyRow, inv: typeof surveyInvitations.$inferSelect, now: Date): SurveyState {
  if (inv.respondedAt) return 'answered';
  if (s.closedAt) return 'closed';
  if (inv.expiresAt <= now) return 'expired';
  return 'open';
}

export const PublicSurveyDto = z.object({
  state: z.enum(SURVEY_STATES),
  orgName: z.string(),
  eventName: z.string(),
  sessionTitle: z.string().nullable(),
  title: z.string(),
  intro: z.string(),
  /** The questions, only while the link can still be answered. */
  form: PublicFormDto.nullable(),
});
export type PublicSurveyDto = z.infer<typeof PublicSurveyDto>;

/** The survey as its recipient sees it (allowlisted: no ids, no org internals). */
export async function publicSurvey(token: string, now = new Date()): Promise<PublicSurveyDto | null> {
  const ref = await surveyRef(token);
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'surveys.public' } });
  return withTenant(ctx, async (tx) => {
    const [inv] = await tx.select().from(surveyInvitations).where(eq(surveyInvitations.id, ref.invitationId));
    if (!inv) return null;
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, inv.surveyId));
    const ev = s ? await findEventTx(tx, s.eventId) : null;
    if (!s || !ev) return null;
    const state = stateOf(s, inv, now);
    const f = state === 'open' ? await currentFormTx(tx, formSubject(s.id)) : null;
    const session = await sessionOf(tx, s.eventId, s.sessionId);
    return PublicSurveyDto.parse({
      state,
      orgName: (await organizationNameTx(tx, ref.orgId)) ?? '',
      eventName: ev.name,
      sessionTitle: session?.title ?? null,
      title: s.title,
      intro: s.intro,
      form: f?.definition.fields.length ? { version: f.version, fields: f.definition.fields } : null,
    });
  });
}

/**
 * The recipient answers from their link. Single use: the invitation row is locked, and the
 * unique (survey, person) response row decides under concurrency; a second attempt is
 * `conflict` / `already_answered`. Answers are validated by the forms engine against the current
 * version; the person's queued reminder is canceled.
 */
export const submitSurveyResponseCommand = tenantCommand({
  name: 'surveys.submitResponse',
  input: z.object({
    token: z.string().min(10).max(200),
    answers: z.record(z.string().max(40), z.unknown()),
  }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'messaging',
  permission: 'public:survey',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const invitationId = verifyLinkToken(SURVEY_PURPOSE, input.token);
    if (!invitationId) throw new DomainError('not_found', 'Unknown link');
    const [inv] = await tx
      .select()
      .from(surveyInvitations)
      .where(eq(surveyInvitations.id, invitationId))
      .for('update');
    if (!inv) throw new DomainError('not_found', 'Unknown link');
    const [s] = await tx.select().from(surveys).where(eq(surveys.id, inv.surveyId));
    if (!s) throw new DomainError('not_found', 'Unknown link');
    const state = stateOf(s, inv, ctx.now);
    if (state === 'answered')
      throw new DomainError('conflict', 'You have already answered', { reason: 'already_answered' });
    if (state !== 'open') throw new DomainError('invalid_state', 'This survey is closed', { reason: state });
    const answered = await submitResponseTx(tx, ctx, {
      ...formSubject(s.id),
      respondentType: 'survey_invitation',
      respondentId: inv.id,
      answers: input.answers,
    });
    if (!answered)
      throw new DomainError('invalid_state', 'This survey has no questions', { reason: 'closed' });
    try {
      await tx.transaction((sp) =>
        sp.insert(surveyResponses).values({
          orgId,
          surveyId: s.id,
          invitationId: inv.id,
          contactId: inv.contactId,
          formVersion: answered.version,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'You have already answered', { reason: 'already_answered' });
      throw err;
    }
    await tx
      .update(surveyInvitations)
      .set({ respondedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(surveyInvitations.id, inv.id));
    await cancelQueuedTx(tx, [reminderDedupeKey(inv.id)], 'answered', ctx.now);
    emit({
      type: 'survey.responded',
      version: 1,
      aggregateType: 'survey',
      aggregateId: s.id,
      payload: { orgId, surveyId: s.id, eventId: s.eventId, invitationId: inv.id },
    });
    return { ok: true, surveyId: s.id };
  },
  present: () => ({ ok: true }),
  audit: (_input, r) => ({ action: 'survey.respond', targetType: 'survey', targetId: r?.surveyId ?? null }),
});

// ---------------------------------------------------------------------------------------------
// Reports

const NpsDto = z.object({
  answered: z.int(),
  promoters: z.int(),
  passives: z.int(),
  detractors: z.int(),
  score: z.int().nullable(),
  distribution: z.array(z.int()),
});

const QuestionReportDto = z.discriminatedUnion('kind', [
  NpsDto.extend({ kind: z.literal('nps') }),
  z.object({
    kind: z.literal('rating'),
    answered: z.int(),
    average: z.number().nullable(),
    distribution: z.array(z.int()),
  }),
  z.object({
    kind: z.literal('choice'),
    answered: z.int(),
    options: z.array(z.object({ value: z.string(), label: z.string(), count: z.int() })),
  }),
  z.object({ kind: z.literal('checkbox'), answered: z.int(), yes: z.int() }),
  z.object({
    kind: z.literal('number'),
    answered: z.int(),
    average: z.number().nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
  }),
  z.object({ kind: z.literal('text'), answered: z.int(), latest: z.array(z.string()) }),
]);

export const SurveySummaryDto = z.object({
  id: z.uuid(),
  kind: z.enum(SURVEY_KINDS),
  sessionId: z.uuid().nullable(),
  sessionTitle: z.string().nullable(),
  title: z.string(),
  closed: z.boolean(),
  questions: z.int(),
  invited: z.int(),
  responded: z.int(),
  rate: z.int().nullable(),
  createdAt: z.date(),
});
export type SurveySummaryDto = z.infer<typeof SurveySummaryDto>;

async function countsTx(tx: TenantTx, surveyIds: readonly string[]) {
  if (surveyIds.length === 0) return new Map<string, { invited: number; responded: number }>();
  const rows = await tx
    .select({
      surveyId: surveyInvitations.surveyId,
      invited: count(),
      responded: count(surveyInvitations.respondedAt),
    })
    .from(surveyInvitations)
    .where(inArray(surveyInvitations.surveyId, [...surveyIds]))
    .groupBy(surveyInvitations.surveyId);
  return new Map(rows.map((r) => [r.surveyId, { invited: r.invited, responded: r.responded }]));
}

/** The event's surveys with their response rates (Marketing → Surveys). */
export const listSurveysQuery = tenantQuery({
  name: 'surveys.listSurveys',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SurveySummaryDto),
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(surveys)
      .where(eq(surveys.eventId, input.eventId))
      .orderBy(asc(surveys.createdAt), asc(surveys.id));
    const counts = await countsTx(
      tx,
      rows.map((r) => r.id),
    );
    const sessions = new Map((await sessionsOf(tx, input.eventId)).map((x) => [x.id, x.title]));
    const out = [];
    for (const r of rows) {
      const c = counts.get(r.id) ?? { invited: 0, responded: 0 };
      const form = await currentFormTx(tx, formSubject(r.id));
      out.push({
        id: r.id,
        kind: r.kind,
        sessionId: r.sessionId,
        sessionTitle: r.sessionId ? (sessions.get(r.sessionId) ?? null) : null,
        title: r.title,
        closed: r.closedAt !== null,
        questions: form?.definition.fields.length ?? 0,
        invited: c.invited,
        responded: c.responded,
        rate: responseRate(c.responded, c.invited),
        createdAt: r.createdAt,
      });
    }
    return out;
  },
});

/** What surveys the event can still get: its post-event survey, and feedback per program session. */
export const surveyTargetsQuery = tenantQuery({
  name: 'surveys.targets',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({
    postEvent: z.uuid().nullable(),
    sessions: z.array(
      z.object({ id: z.uuid(), title: z.string(), endsAt: z.date(), surveyId: z.uuid().nullable() }),
    ),
  }),
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select({ id: surveys.id, kind: surveys.kind, sessionId: surveys.sessionId })
      .from(surveys)
      .where(eq(surveys.eventId, input.eventId));
    const bySession = new Map(rows.flatMap((r) => (r.sessionId ? [[r.sessionId, r.id] as const] : [])));
    return {
      postEvent: rows.find((r) => r.kind === 'post_event')?.id ?? null,
      sessions: (await sessionsOf(tx, input.eventId)).map((x) => ({
        id: x.id,
        title: x.title,
        endsAt: x.endsAt,
        surveyId: bySession.get(x.id) ?? null,
      })),
    };
  },
});

export const SurveyDetailDto = z.object({
  survey: SurveySummaryDto.extend({
    intro: z.string(),
    /** When the event (or session) ends: sending opens then. */
    endsAt: z.date(),
    version: z.int(),
  }),
  definition: FormDefinition,
  sends: z.array(
    z.object({
      id: z.uuid(),
      at: z.date(),
      source: z.enum(SEND_SOURCES),
      audience: z.enum(SEND_AUDIENCES),
      recipients: z.int(),
      reminderDays: z.int().nullable(),
      linkDays: z.int(),
    }),
  ),
  report: z.object({
    /** The first NPS question's summary (the headline), or null. */
    nps: NpsDto.nullable(),
    questions: z.array(
      z.object({ key: z.string(), label: z.string(), type: z.string(), report: QuestionReportDto }),
    ),
  }),
});
export type SurveyDetailDto = z.infer<typeof SurveyDetailDto>;

/** One survey: its questions, sends and report (NPS, per-question summaries). */
export const surveyQuery = tenantQuery({
  name: 'surveys.getSurvey',
  input: Ref,
  output: SurveyDetailDto,
  entitlement: 'messaging',
  permission: 'messages:read',
  handler: async ({ input, tx }) => {
    const s = await surveyTx(tx, input.eventId, input.surveyId);
    const ev = await findEventTx(tx, s.eventId);
    if (!ev) throw new DomainError('not_found', 'Event not found');
    const session = await sessionOf(tx, s.eventId, s.sessionId);
    const form = await currentFormTx(tx, formSubject(s.id));
    const c = (await countsTx(tx, [s.id])).get(s.id) ?? { invited: 0, responded: 0 };
    const sends = await tx
      .select()
      .from(surveySends)
      .where(eq(surveySends.surveyId, s.id))
      .orderBy(desc(surveySends.createdAt), desc(surveySends.id));
    const { questions, responses } = await subjectResponsesTx(tx, formSubject(s.id));
    const answers = responses.map((r) => r.answers);
    const reports: { key: string; label: string; type: string; report: QuestionReport }[] = questions.map(
      (q) => ({ key: q.key, label: q.label, type: q.type, report: summarizeQuestion(q, answers) }),
    );
    const firstNps = reports.find((r) => r.report.kind === 'nps')?.report;
    return {
      survey: {
        id: s.id,
        kind: s.kind as (typeof SURVEY_KINDS)[number],
        sessionId: s.sessionId,
        sessionTitle: session?.title ?? null,
        title: s.title,
        intro: s.intro,
        closed: s.closedAt !== null,
        questions: form?.definition.fields.length ?? 0,
        invited: c.invited,
        responded: c.responded,
        rate: responseRate(c.responded, c.invited),
        createdAt: s.createdAt,
        endsAt: session?.endsAt ?? ev.endsAt,
        version: form?.version ?? 0,
      },
      definition: form?.definition ?? { fields: [] },
      sends: sends.map((x) => ({
        id: x.id,
        at: x.createdAt,
        source: x.source as (typeof SEND_SOURCES)[number],
        audience: x.audience as SendAudience,
        recipients: x.recipients,
        reminderDays: x.reminderDays,
        linkDays: x.linkDays,
      })),
      report: {
        nps:
          firstNps && firstNps.kind === 'nps'
            ? { ...firstNps, distribution: [...firstNps.distribution] }
            : null,
        questions: reports,
      },
    };
  },
});

/** Invitation ids with a response (the export's selection), for one survey of the event. */
export async function respondedInvitationIdsTx(tx: TenantTx, eventId: string, surveyId: string) {
  const s = await surveyTx(tx, eventId, surveyId);
  const rows = await tx
    .select({ id: surveyInvitations.id })
    .from(surveyInvitations)
    .where(and(eq(surveyInvitations.surveyId, s.id), isNotNull(surveyInvitations.respondedAt)))
    .orderBy(asc(surveyInvitations.respondedAt), asc(surveyInvitations.id));
  return rows.map((r) => r.id);
}

export { formSubject, surveyTx };
