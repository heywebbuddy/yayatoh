import { addGuestCommand } from '@yayatoh/attendees';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand } from '@yayatoh/events';
import { publishFormCommand } from '@yayatoh/forms';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { createNotifier, dispatchDue, memoryTransports } from '@yayatoh/notifications';
import { consumeEvent, eventKey, recentEventsTx } from '@yayatoh/platform';
import {
  createSurveyCommand,
  listSurveysQuery,
  publicSurvey,
  saveSurveyQuestionsCommand,
  sendSurveyCommand,
  sendSurveyStepCommand,
  setSurveyClosedCommand,
  submitSurveyResponseCommand,
  surveyExportBulk,
  surveyMailer,
  surveyQuery,
  surveyToken,
  updateSurveyCommand,
} from '@yayatoh/surveys';
import { setSuspensionCommand } from '@yayatoh/tenancy';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, runBulk, staleCtx, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const ORIGIN = 'https://app.yayatoh.test';
const DAY = 86_400_000;
const notifier = createNotifier();
let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let eventId: string;
let futureId: string;

const QUESTIONS = {
  fields: [
    { key: 'nps', type: 'nps', label: 'How likely are you to recommend us?', required: true },
    { key: 'stars', type: 'rating', label: 'Overall' },
    {
      key: 'best',
      type: 'select',
      label: 'Best part',
      options: [
        { value: 'music', label: 'Music' },
        { value: 'food', label: 'Food' },
      ],
    },
    { key: 'note', type: 'long_text', label: 'Anything else?' },
  ],
};
const PEOPLE = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'] as const;
const email = (who: string) => `${who.toLowerCase()}.survey@example.test`;
const key = () => ({ idempotencyKey: uuidv7() });

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  const mk = async (name: string, startsAt: string, endsAt: string) =>
    (
      await executeCommand(
        createEventCommand,
        { name, timezone: 'America/Chicago', startsAt, endsAt },
        a.ctx(),
        ports,
      )
    ).id;
  eventId = await mk('Harbor Supper', '2026-01-10T00:00:00Z', '2026-01-10T04:00:00Z');
  futureId = await mk('Next Year', '2031-01-10T00:00:00Z', '2031-01-10T04:00:00Z');
  for (const who of PEOPLE)
    await executeCommand(addGuestCommand, { eventId, name: who, email: email(who) }, a.ctx(), ports);
  await executeCommand(
    addGuestCommand,
    { eventId: futureId, name: 'Early', email: 'early@example.test' },
    a.ctx(),
    ports,
  );
});
afterAll(async () => {
  await admin?.end();
  await closePools();
});

async function relay(orgId = a.org.id) {
  const events = await withTenant(systemCtx(orgId), (tx) =>
    recentEventsTx(tx, orgId, ['survey.sent'], 3_600_000),
  );
  const mailer = surveyMailer({ notifier, appOrigin: ORIGIN });
  for (const e of events) if (mailer.events.includes(eventKey(e))) await consumeEvent(mailer, e);
}

async function invitationOf(surveyId: string, who: string): Promise<string> {
  const [row] = await admin<{ id: string }[]>`
    select i.id from surveys.invitations i join attendees.attendees t on t.id = i.attendee_id
    where i.survey_id = ${surveyId} and t.email = ${email(who)}`;
  if (!row) throw new Error(`no invitation for ${who}`);
  return row.id;
}

const anon = (now?: Date) => createCtx({ orgId: a.org.id, ...(now ? { now } : {}) });
const answer = (surveyId: string, who: string, answers: Record<string, unknown>, now?: Date) =>
  invitationOf(surveyId, who).then((id) =>
    executeCommand(submitSurveyResponseCommand, { token: surveyToken(id), answers }, anon(now), ports),
  );

let surveyId: string;

describe('surveys: building (M3.9a)', () => {
  it('creates one post-event survey per event, with its questions; viewers and bad input are refused', async () => {
    const input = { eventId, kind: 'post_event', title: 'How was Harbor Supper?', definition: QUESTIONS };
    await expect(
      executeCommand(createSurveyCommand, input, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(createSurveyCommand, { ...input, title: ' ' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Session feedback needs a session of this event.
    await expect(
      executeCommand(createSurveyCommand, { ...input, kind: 'session_feedback' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        createSurveyCommand,
        { ...input, kind: 'session_feedback', sessionId: uuidv7() },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });

    surveyId = (await executeCommand(createSurveyCommand, input, a.ctx(), ports)).id;
    await expect(executeCommand(createSurveyCommand, input, a.ctx(), ports)).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'survey_exists' },
    });
    const detail = await executeQuery(surveyQuery, { eventId, surveyId }, a.ctx(), ports);
    expect(detail.survey).toMatchObject({ kind: 'post_event', title: 'How was Harbor Supper?', version: 1 });
    expect(detail.definition.fields.map((f) => f.type)).toEqual(['nps', 'rating', 'select', 'long_text']);

    await executeCommand(
      updateSurveyCommand,
      { eventId, surveyId, title: 'How was Harbor Supper?', intro: 'Two minutes, promise.' },
      a.ctx(),
      ports,
    );
    // Survey answers are never sensitive; checkout questions have no scales.
    await expect(
      executeCommand(
        saveSurveyQuestionsCommand,
        {
          eventId,
          surveyId,
          definition: { fields: [{ key: 'x', type: 'short_text', label: 'X', sensitive: true }] },
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'form_invalid', field: 'x' } });
    await expect(
      executeCommand(
        publishFormCommand,
        {
          kind: 'checkout_questions',
          subjectType: 'event',
          subjectId: eventId,
          definition: { fields: [{ key: 'n', type: 'nps', label: 'N' }] },
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'form_invalid' } });
    // Another org can't see or touch it.
    await expect(executeQuery(surveyQuery, { eventId, surveyId }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      executeCommand(updateSurveyCommand, { eventId, surveyId, title: 'Hijack', intro: '' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await executeQuery(listSurveysQuery, { eventId }, b.ctx(), ports)).toEqual([]);
  });
});

describe('surveys: sending', () => {
  it('waits for the event to end, needs questions and people, and refuses viewers and a paused org', async () => {
    const early = await executeCommand(
      createSurveyCommand,
      { eventId: futureId, kind: 'post_event', title: 'Too soon', definition: QUESTIONS },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(sendSurveyCommand, { eventId: futureId, surveyId: early.id }, a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'not_ended' } });
    // Once it's over (time travel), with no questions left, it asks for one.
    const later = { now: new Date('2031-02-01T00:00:00Z') };
    await executeCommand(
      saveSurveyQuestionsCommand,
      { eventId: futureId, surveyId: early.id, definition: { fields: [] } },
      a.ctx(later),
      ports,
    );
    await expect(
      executeCommand(
        sendSurveyCommand,
        { eventId: futureId, surveyId: early.id },
        a.ctx({ ...later, ...key() }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'no_questions' } });
    await expect(
      executeCommand(sendSurveyCommand, { eventId, surveyId, audience: 'checked_in' }, a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'nobody_checked_in' } });
    await expect(
      executeCommand(sendSurveyCommand, { eventId, surveyId }, userCtx(a.viewerId, a.org.id, key()), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(sendSurveyCommand, { eventId, surveyId, reminderDays: 31 }, a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(sendSurveyCommand, { eventId, surveyId }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      setSuspensionCommand,
      { kind: 'pause_messaging', paused: true, reason: 'review' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(
        executeCommand(sendSurveyCommand, { eventId, surveyId }, a.ctx(key()), ports),
      ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'messaging_paused' } });
    } finally {
      await executeCommand(
        setSuspensionCommand,
        { kind: 'pause_messaging', paused: false, reason: 'done' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });

  it('invites each person once, idempotently, and emails a signed link through the dispatcher', async () => {
    const k = key();
    const first = await executeCommand(
      sendSurveyCommand,
      { eventId, surveyId, reminderDays: 3, linkDays: 14 },
      a.ctx(k),
      ports,
    );
    expect(first).toEqual({ sent: PEOPLE.length });
    // Same key: the stored result, nothing new.
    expect(
      await executeCommand(
        sendSurveyCommand,
        { eventId, surveyId, reminderDays: 3, linkDays: 14 },
        a.ctx(k),
        ports,
      ),
    ).toEqual(first);
    // A new send reaches nobody new.
    await expect(
      executeCommand(sendSurveyCommand, { eventId, surveyId }, a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'all_invited' } });

    await relay();
    await relay(); // a replayed relay queues nothing twice
    const queued = await admin<{ kind: string; n: number }[]>`
      select kind, count(*)::int as n from notifications.messages
      where org_id = ${a.org.id} and event_id = ${eventId} group by kind order by kind`;
    expect(queued).toEqual([
      { kind: 'surveys.invite', n: PEOPLE.length },
      { kind: 'surveys.reminder', n: PEOPLE.length },
    ]);
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, { transports, appOrigin: ORIGIN, ignoreQuietHours: true });
    const invites = emails.filter((e) => e.subject === 'How was Harbor Supper?');
    expect(invites.map((e) => e.to).sort()).toEqual(PEOPLE.map(email).sort());
    const ana = invites.find((e) => e.to === email('Ana'));
    expect(ana?.html).toContain(`${ORIGIN}/survey/${surveyToken(await invitationOf(surveyId, 'Ana'))}`);
    // event_updates: unsubscribable.
    expect(ana?.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // Reminders wait for their day.
    expect(emails.some((e) => e.subject.startsWith('Reminder:'))).toBe(false);
  });
});

describe('surveys: answering', () => {
  it('shows the open survey, validates answers, and takes one response per person', async () => {
    const token = surveyToken(await invitationOf(surveyId, 'Ana'));
    const view = await publicSurvey(token);
    expect(view).toMatchObject({
      state: 'open',
      orgName: 'Alpha Events',
      eventName: 'Harbor Supper',
      title: 'How was Harbor Supper?',
      intro: 'Two minutes, promise.',
    });
    expect(view?.form?.fields.map((f) => f.key)).toEqual(['nps', 'stars', 'best', 'note']);
    // Allowlist: no ids leave.
    expect(JSON.stringify(view)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(await publicSurvey(`${token.slice(0, -2)}xx`)).toBeNull();

    await expect(
      executeCommand(submitSurveyResponseCommand, { token, answers: { nps: 11 } }, anon(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'nps' } });
    await expect(
      executeCommand(submitSurveyResponseCommand, { token, answers: { stars: 4 } }, anon(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'nps' } });
    // A failed attempt does not use the link up.
    expect((await publicSurvey(token))?.state).toBe('open');

    await answer(surveyId, 'Ana', { nps: 10, stars: 5, best: 'music', note: 'Loved it' });
    expect(await publicSurvey(token)).toMatchObject({ state: 'answered', form: null });
    await expect(
      executeCommand(submitSurveyResponseCommand, { token, answers: { nps: 1 } }, anon(), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'already_answered' } });
    // The token only works in its own org.
    await expect(
      executeCommand(
        submitSurveyResponseCommand,
        { token: surveyToken(await invitationOf(surveyId, 'Ben')), answers: { nps: 1 } },
        createCtx({ orgId: b.org.id }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('under concurrency, exactly one of two simultaneous answers wins; the database refuses a second row', async () => {
    const token = surveyToken(await invitationOf(surveyId, 'Ben'));
    const results = await Promise.allSettled(
      [7, 6].map((nps) =>
        executeCommand(submitSurveyResponseCommand, { token, answers: { nps, stars: 3 } }, anon(), ports),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: 'conflict', details: { reason: 'already_answered' } });
    const [{ n } = { n: 0 }] = await admin<{ n: number }[]>`
      select count(*)::int as n from forms.form_responses where respondent_id = ${await invitationOf(surveyId, 'Ben')}`;
    expect(n).toBe(1);
    // Even a direct insert of a second response for the same person is refused by the database.
    const [r] = await admin<{ contact_id: string }[]>`
      select contact_id from surveys.responses where invitation_id = ${await invitationOf(surveyId, 'Ben')}`;
    const cy = await invitationOf(surveyId, 'Cy');
    await expect(
      withTenant(systemCtx(a.org.id), (tx) =>
        tx.execute(sql`insert into surveys.responses (org_id, survey_id, invitation_id, contact_id, form_version)
          values (${a.org.id}, ${surveyId}, ${cy}, ${r?.contact_id}, 1)`),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
  });

  it('reminders skip people who answered', async () => {
    await answer(surveyId, 'Cy', { nps: 3, stars: 2, best: 'food' });
    const canceled = await admin<{ status: string; reason: string | null; n: number }[]>`
      select status, reason, count(*)::int as n from notifications.messages
      where org_id = ${a.org.id} and kind = 'surveys.reminder' and event_id = ${eventId}
      group by status, reason order by status`;
    expect(canceled).toEqual([
      { status: 'canceled', reason: 'answered', n: 3 },
      { status: 'queued', reason: null, n: 2 },
    ]);
    // Three days later: only Dee and Eli are reminded.
    const { transports, emails } = memoryTransports();
    await dispatchDue(a.org.id, {
      transports,
      appOrigin: ORIGIN,
      ignoreQuietHours: true,
      now: () => new Date(Date.now() + 3 * DAY + 60_000),
    });
    const reminders = emails.filter((e) => e.subject === 'Reminder: How was Harbor Supper?');
    expect(reminders.map((e) => e.to).sort()).toEqual([email('Dee'), email('Eli')]);
  });

  it('expired links and closed surveys refuse answers', async () => {
    const token = surveyToken(await invitationOf(surveyId, 'Dee'));
    const past = new Date(Date.now() + 15 * DAY);
    expect((await publicSurvey(token, past))?.state).toBe('expired');
    await expect(
      executeCommand(submitSurveyResponseCommand, { token, answers: { nps: 8 } }, anon(past), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'expired' } });

    const closed = await executeCommand(
      setSurveyClosedCommand,
      { eventId, surveyId, closed: true },
      a.ctx(),
      ports,
    );
    // Dee and Eli's reminders were already sent above; nothing left to cancel.
    expect(closed.closed).toBe(true);
    expect((await publicSurvey(token))?.state).toBe('closed');
    await expect(
      executeCommand(submitSurveyResponseCommand, { token, answers: { nps: 8 } }, anon(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'closed' } });
    await expect(
      executeCommand(sendSurveyCommand, { eventId, surveyId }, a.ctx(key()), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'closed' } });
    await executeCommand(setSurveyClosedCommand, { eventId, surveyId, closed: false }, a.ctx(), ports);
    expect((await publicSurvey(token))?.state).toBe('open');
  });
});

describe('surveys: reports and export', () => {
  it('reports the response rate, NPS and each question; viewers are refused', async () => {
    const d = await executeQuery(surveyQuery, { eventId, surveyId }, a.ctx(), ports);
    expect(d.survey).toMatchObject({ invited: 5, responded: 3, rate: 60 });
    // Ana 10 (promoter), Ben 7 or 6, Cy 3 (detractor).
    const ben = d.report.nps?.passives === 1 ? 'passive' : 'detractor';
    expect(d.report.nps).toMatchObject(
      ben === 'passive'
        ? { answered: 3, promoters: 1, passives: 1, detractors: 1, score: 0 }
        : { answered: 3, promoters: 1, passives: 0, detractors: 2, score: -33 },
    );
    const byKey = Object.fromEntries(d.report.questions.map((q) => [q.key, q.report]));
    expect(byKey.stars).toMatchObject({
      kind: 'rating',
      answered: 3,
      average: 3.3,
      distribution: [0, 1, 1, 0, 1],
    });
    expect(byKey.best).toMatchObject({
      kind: 'choice',
      answered: 2,
      options: [
        { value: 'music', label: 'Music', count: 1 },
        { value: 'food', label: 'Food', count: 1 },
      ],
    });
    expect(byKey.note).toEqual({ kind: 'text', answered: 1, latest: ['Loved it'] });
    expect(d.sends).toHaveLength(1);
    expect(d.sends[0]).toMatchObject({ audience: 'all', recipients: 5, reminderDays: 3, linkDays: 14 });

    const list = await executeQuery(listSurveysQuery, { eventId }, a.ctx(), ports);
    expect(list).toEqual([
      expect.objectContaining({
        id: surveyId,
        invited: 5,
        responded: 3,
        rate: 60,
        questions: 4,
        closed: false,
      }),
    ]);
    await expect(
      executeQuery(surveyQuery, { eventId, surveyId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(listSurveysQuery, { eventId }, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reports questions removed after people answered them, but not ones nobody ever saw answered', async () => {
    const fields = QUESTIONS.fields;
    const save = (list: readonly (typeof fields)[number][]) =>
      executeCommand(
        saveSurveyQuestionsCommand,
        { eventId, surveyId, definition: { fields: list } },
        a.ctx(),
        ports,
      );
    await save([...fields, { key: 'temp', type: 'short_text', label: 'Temporary', required: false }]);
    await save(fields.filter((f) => f.key !== 'note'));
    const d = await executeQuery(surveyQuery, { eventId, surveyId }, a.ctx(), ports);
    expect(d.report.questions.map((q) => q.key)).toEqual(['nps', 'stars', 'best', 'note']);
    await save(fields);
  });

  it('exports the responses as CSV after a recent step-up, audited; viewers and other orgs are refused', async () => {
    const params = {
      headers: { name: 'Name', email: 'Email', submittedAt: 'Answered' },
      yes: 'Yes',
      no: 'No',
    };
    const start = { eventId, selection: { filter: { surveyId } }, params };
    await expect(
      executeCommand(surveyExportBulk.start, start, staleCtx(a.ctx()), ports),
    ).rejects.toMatchObject({
      code: 'step_up_required',
    });
    await expect(
      executeCommand(surveyExportBulk.start, start, userCtx(a.viewerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeCommand(surveyExportBulk.start, start, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    const { operationId, total } = await executeCommand(surveyExportBulk.start, start, a.ctx(), ports);
    expect(total).toBe(3);
    expect(await runBulk(a.org.id, operationId)).toBe('done');
    const file = await executeQuery(surveyExportBulk.file, { operationId }, a.ctx(), ports);
    expect(file.name).toMatch(/^survey-responses-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Name,Email,Answered,How likely are you to recommend us?,Overall,Best part,Anything else?',
    );
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(
      /^Ana,ana\.survey@example\.test,\d{4}-\d{2}-\d{2} \d{2}:\d{2},10,5,Music,Loved it$/,
    );
    const [audit] = await admin<{ n: number }[]>`
      select count(*)::int as n from platform.audit_events
      where org_id = ${a.org.id} and action = 'bulk.start' and data->>'action' = 'surveys.responsesCsv'`;
    expect(audit?.n).toBe(1);
  });
});

describe('surveys: session feedback, checked-in audience and the journey step', () => {
  it('sends a session survey only to people who checked in', async () => {
    // The fixture event has a keynote and one admitted ticket (the fixture buyer's).
    const [session] = await admin<{ id: string }[]>`
      select id from program.sessions where org_id = ${a.org.id} and event_id = ${a.event.id} limit 1`;
    const after = { now: new Date(a.event.endsAt.getTime() + DAY) };
    const s = await executeCommand(
      createSurveyCommand,
      {
        eventId: a.event.id,
        kind: 'session_feedback',
        sessionId: session?.id ?? null,
        title: 'Keynote feedback',
        definition: { fields: [{ key: 'stars', type: 'rating', label: 'Keynote', required: true }] },
      },
      a.ctx(after),
      ports,
    );
    // Before the session ended, not yet.
    await expect(
      executeCommand(
        sendSurveyCommand,
        { eventId: a.event.id, surveyId: s.id, audience: 'checked_in' },
        a.ctx({ now: new Date(a.event.startsAt.getTime() + 60_000), ...key() }),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'not_ended' } });
    const r = await executeCommand(
      sendSurveyCommand,
      { eventId: a.event.id, surveyId: s.id, audience: 'checked_in' },
      a.ctx({ ...after, ...key() }),
      ports,
    );
    expect(r.sent).toBe(1);
    const who = await admin<{ email: string }[]>`
      select t.email from surveys.invitations i join attendees.attendees t on t.id = i.attendee_id
      where i.survey_id = ${s.id}`;
    expect(who.map((w) => w.email)).toEqual([`buyer@${a.org.slug}.test`]);
    const list = await executeQuery(listSurveysQuery, { eventId: a.event.id }, a.ctx(), ports);
    expect(list.find((x) => x.id === s.id)).toMatchObject({
      kind: 'session_feedback',
      sessionTitle: 'Opening keynote',
    });
  });

  it('the journey step invites one attendee once, and skips without a survey', async () => {
    const other = await executeCommand(
      createEventCommand,
      { name: 'Journey', timezone: 'UTC', startsAt: '2026-02-01T10:00:00Z', endsAt: '2026-02-01T12:00:00Z' },
      a.ctx(),
      ports,
    );
    const guest = await executeCommand(
      addGuestCommand,
      { eventId: other.id, name: 'Jo', email: 'jo.journey@example.test' },
      a.ctx(),
      ports,
    );
    const attendeeId = guest.id;
    const step = (ctx = systemCtx(a.org.id)) =>
      executeCommand(sendSurveyStepCommand, { eventId: other.id, attendeeId }, ctx, ports);
    expect(await step()).toEqual({ status: 'skipped', reason: 'no_survey' });
    await executeCommand(
      createSurveyCommand,
      { eventId: other.id, kind: 'post_event', title: 'Journey survey', definition: QUESTIONS },
      a.ctx(),
      ports,
    );
    expect(await step()).toEqual({ status: 'invited', reason: null });
    expect(await step()).toEqual({ status: 'skipped', reason: 'already_invited' });
    await expect(step(userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({ code: 'forbidden' });
  });
});
