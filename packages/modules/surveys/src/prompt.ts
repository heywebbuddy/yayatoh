import { participationAttendeesTx } from '@yayatoh/attendees';
import { contactForAccountTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { currentFormTx } from '@yayatoh/forms';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { surveyInvitations, surveySends, surveys } from './schema.ts';
import { DEFAULT_LINK_DAYS, formSubject, subjectEndsAt, surveyToken } from './surveys.ts';

/**
 * The session feedback prompt (M5.7b): once a program session is over, the live session page asks
 * the signed-in attendee for feedback with the session's feedback survey (M3.9a). Asking gives
 * them their invitation (the one an email send already gave them, or a new one recorded as a
 * `prompt` send, without an email), so it is still one invitation and one response per person.
 */

/** A signed-in account as the web app read it from its own session (never from a form). */
const Account = z.object({ userId: z.uuid(), email: z.email().max(320) });

export const FEEDBACK_PROMPT_STATES = ['none', 'sign_in', 'open', 'answered'] as const;
export type FeedbackPromptState = (typeof FEEDBACK_PROMPT_STATES)[number];

const PromptInput = z.object({ eventId: z.uuid(), sessionId: z.uuid(), account: Account.optional() });

type SurveyRow = typeof surveys.$inferSelect;

/** The session's feedback survey when it can be answered now (open, with questions, session over). */
async function promptableTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  sessionId: string,
): Promise<SurveyRow | null> {
  const [s] = await tx
    .select()
    .from(surveys)
    .where(
      and(
        eq(surveys.eventId, eventId),
        eq(surveys.sessionId, sessionId),
        eq(surveys.kind, 'session_feedback'),
      ),
    );
  if (!s || s.closedAt) return null;
  const ev = await findEventTx(tx, eventId);
  if (ev?.status !== 'published' || ev.visibility === 'private') return null;
  if ((await subjectEndsAt(tx, s, ev)) > ctx.now) return null;
  const form = await currentFormTx(tx, formSubject(s.id));
  return form?.definition.fields.length ? s : null;
}

/** The account's contact and their active attendee record at the event, if they are attending. */
async function attendeeOfTx(tx: TenantTx, ctx: Ctx, eventId: string, account: z.infer<typeof Account>) {
  if (ctx.actor.type !== 'user' || ctx.actor.userId !== account.userId) return null;
  const contactId = await contactForAccountTx(tx, account);
  if (!contactId) return null;
  const [record] = (await participationAttendeesTx(tx, eventId, [contactId])).filter(
    (r) => r.status === 'active',
  );
  return record ? { contactId, attendeeId: record.id } : null;
}

const invitationOfTx = async (tx: TenantTx, surveyId: string, contactId: string) =>
  (
    await tx
      .select()
      .from(surveyInvitations)
      .where(and(eq(surveyInvitations.surveyId, surveyId), eq(surveyInvitations.contactId, contactId)))
  )[0] ?? null;

/**
 * What the live session page shows: nothing (`none`: no open feedback survey, the session isn't
 * over, or the person isn't attending), a sign-in hint, the prompt, or "thanks, answered".
 */
export const feedbackPromptQuery = tenantQuery({
  name: 'surveys.feedbackPrompt',
  input: PromptInput,
  output: z.object({ state: z.enum(FEEDBACK_PROMPT_STATES), title: z.string().nullable() }),
  entitlement: 'messaging',
  permission: 'public:survey',
  handler: async ({ input, ctx, tx }) => {
    const s = await promptableTx(tx, ctx, input.eventId, input.sessionId);
    if (!s) return { state: 'none' as const, title: null };
    if (!input.account) return { state: 'sign_in' as const, title: s.title };
    const who = await attendeeOfTx(tx, ctx, input.eventId, input.account);
    if (!who) return { state: 'none' as const, title: null };
    const inv = await invitationOfTx(tx, s.id, who.contactId);
    return { state: inv?.respondedAt ? ('answered' as const) : ('open' as const), title: s.title };
  },
});

/**
 * "Give feedback": the signed-in attendee's survey link for this session. Refused when there is
 * nothing to answer (`not_found`), when they already answered (`conflict` / `already_answered`)
 * or when an emailed link has run out (`invalid_state` / `expired`).
 */
export const openFeedbackCommand = tenantCommand({
  name: 'surveys.openFeedback',
  input: PromptInput.extend({ account: Account }),
  output: z.object({ token: z.string() }),
  entitlement: 'messaging',
  permission: 'public:survey',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const s = await promptableTx(tx, ctx, input.eventId, input.sessionId);
    if (!s) throw new DomainError('not_found');
    const who = await attendeeOfTx(tx, ctx, input.eventId, input.account);
    if (!who) throw new DomainError('not_found');
    let inv = await invitationOfTx(tx, s.id, who.contactId);
    if (!inv) {
      const [send] = await tx
        .insert(surveySends)
        .values({
          orgId,
          surveyId: s.id,
          source: 'prompt',
          audience: 'all',
          reminderDays: null,
          linkDays: DEFAULT_LINK_DAYS,
          recipients: 1,
          sentBy: null,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        .returning({ id: surveySends.id });
      if (!send) throw new DomainError('internal');
      // One invitation per person per survey: a concurrent prompt or send wins the same row.
      await tx
        .insert(surveyInvitations)
        .values({
          orgId,
          surveyId: s.id,
          sendId: send.id,
          attendeeId: who.attendeeId,
          contactId: who.contactId,
          expiresAt: new Date(ctx.now.getTime() + DEFAULT_LINK_DAYS * 86_400_000),
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        .onConflictDoNothing();
      inv = await invitationOfTx(tx, s.id, who.contactId);
      if (!inv) throw new DomainError('internal');
      if (inv.sendId !== send.id) await tx.delete(surveySends).where(eq(surveySends.id, send.id));
    }
    if (inv.respondedAt)
      throw new DomainError('conflict', 'You have already answered', { reason: 'already_answered' });
    if (inv.expiresAt <= ctx.now)
      throw new DomainError('invalid_state', 'This link has expired', { reason: 'expired' });
    return { token: surveyToken(inv.id), surveyId: s.id };
  },
  present: (r) => ({ token: r.token }),
  audit: (input, r) => ({
    action: 'survey.prompt',
    targetType: 'survey',
    targetId: r?.surveyId ?? null,
    data: { sessionId: input.sessionId },
  }),
});
