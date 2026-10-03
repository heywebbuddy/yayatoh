import { previewAudienceQuery } from '@yayatoh/audiences';
import { createCheckpointCommand, scanTicketCommand, undoAdmissionCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { adminClient, closePools } from '@yayatoh/db/testing';
import {
  askQuestionCommand,
  catchUpEngagement,
  createPollCommand,
  DEFAULT_WEIGHTS,
  enableLiveCommand,
  engagementActivity,
  eventScoresQuery,
  openPollCommand,
  participantKey,
  resetScoreWeightsCommand,
  scoreWeightsQuery,
  setScoreWeightsCommand,
  voteCommand,
} from '@yayatoh/engagement';
import { createEventCommand, type EventDto, transitionEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { consumeEvent, recentEventsTx } from '@yayatoh/platform';
import { createSessionCommand, setSessionAgendaCommand } from '@yayatoh/program';
import {
  dropSessionCommand,
  enrollSessionCommand,
  registrantsOfLinkTx,
  registrationSetupQuery,
  seedRegistrationDefaultsCommand,
  setCellCommand,
  startRegistrationCommand,
} from '@yayatoh/registration';
import {
  createSurveyCommand,
  feedbackPromptQuery,
  openFeedbackCommand,
  setSurveyClosedCommand,
  submitSurveyResponseCommand,
} from '@yayatoh/surveys';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_ENGAGEMENT_WEIGHTS,
  fixtureBuyerAccount,
  type OrgFixture,
  ports,
  systemCtx,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M5.7b — engagement events and scores: the fixture attendee's score reproduces exactly (and
 * follows the org's weights), every source (door scans, live polls and Q&A, answered surveys,
 * session enrollments) counts once, session feedback is one response per person through the
 * session-end prompt, scores feed audiences, and permissions and tenant isolation hold.
 */

let a: OrgFixture;
let b: OrgFixture;
let n = 0;
const admin = adminClient();
const H = 3_600_000;
const START = new Date('2030-09-03T14:00:00Z');
const at = (h: number) => new Date(START.getTime() + h * H);
const anon = (now?: Date, org = a): Ctx => createCtx({ orgId: org.org.id, ...(now ? { now } : {}) });
const sys = (org = a) => systemCtx(org.org.id);
const SECRET = 'engagement-score-secret-0123456789abcd';

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = err.details?.reason;
    return typeof reason === 'string' ? `${err.code}:${reason}` : err.code;
  }
}

const contactOf = async (org: OrgFixture, email: string) =>
  (
    await admin<{ id: string }[]>`
      select id from crm.contacts where org_id = ${org.org.id} and email_norm = ${email.toLowerCase()}`
  )[0]?.id ?? '';

const crmScore = async (org: OrgFixture, eventId: string, contactId: string) =>
  (
    await admin<{ score: number }[]>`
      select score from crm.event_engagement
      where org_id = ${org.org.id} and event_id = ${eventId} and contact_id = ${contactId}`
  )[0]?.score ?? null;

const scoreOf = async (org: OrgFixture, eventId: string, contactId: string) =>
  (await executeQuery(eventScoresQuery, { eventId, contactId }, org.ctx(), ports)).attendees[0] ?? null;

interface Conf {
  ev: EventDto;
  memberId: string;
  fullPass: string;
}

/** A published conference with a free Member full pass. */
async function conference(org = a): Promise<Conf> {
  n += 1;
  const ev = await executeCommand(
    createEventCommand,
    {
      name: `Engagement ${n} ${org.org.slug}`,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: at(0),
      endsAt: at(48),
    },
    org.ctx(),
    ports,
  );
  await executeCommand(seedRegistrationDefaultsCommand, { eventId: ev.id, names: {} }, org.ctx(), ports);
  const setup = await executeQuery(registrationSetupQuery, { eventId: ev.id }, org.ctx(), ports);
  const member = setup.types.find((t) => t.key === 'member')?.id as string;
  const fullPass = setup.items.find((i) => i.key === 'full_pass')?.id as string;
  await executeCommand(
    setCellCommand,
    { eventId: ev.id, registrationTypeId: member, admissionItemId: fullPass, priceMinor: 0 },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: ev.id, transition: 'publish' }, org.ctx(), ports);
  return { ev, memberId: member, fullPass };
}

/** An optional session `h` hours after the start, one hour long. */
async function session(c: Conf, title: string, h: number, org = a) {
  const res = await executeCommand(
    createSessionCommand,
    { eventId: c.ev.id, title, startsAt: at(h), endsAt: at(h + 1), capacity: 20 },
    org.ctx(),
    ports,
  );
  await executeCommand(
    setSessionAgendaCommand,
    { eventId: c.ev.id, sessionId: res.session.id, admission: 'optional', groupId: null },
    org.ctx(),
    ports,
  );
  return res.session;
}

interface Person {
  token: string;
  id: string;
  email: string;
  contactId: string;
  account: { userId: string; email: string };
  ctx: (now?: Date) => Ctx;
}

/** A free registration (an attendee with a contact) and their signed-in account. */
async function attendee(c: Conf, org = a): Promise<Person> {
  n += 1;
  const email = `engaged${n}-${org.org.slug}@example.test`;
  const r = await executeCommand(
    startRegistrationCommand,
    {
      eventId: c.ev.id,
      registrationTypeId: c.memberId,
      itemIds: [c.fullPass],
      buyer: { email, name: `Person ${n}` },
    },
    anon(undefined, org),
    ports,
  );
  const [reg] = await withTenant(sys(org), (tx) => registrantsOfLinkTx(tx, r.manageToken));
  if (!reg) throw new Error('no registrant');
  const userId = uuidv7();
  return {
    token: r.manageToken,
    id: reg.id,
    email,
    contactId: await contactOf(org, email),
    account: { userId, email },
    ctx: (now?: Date) =>
      createCtx({ orgId: org.org.id, actor: { type: 'user', userId }, ...(now ? { now } : {}) }),
  };
}

/** Run the activity subscriber over the org's recent outbox (as the worker would). */
const drain = (org = a) => catchUpEngagement(org.org.id);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await admin.end();
  await closePools();
});

describe('the fixture attendee', () => {
  it("reproduces the fixture attendee's score exactly, in both orgs", async () => {
    for (const org of [a, b]) {
      const buyer = await contactOf(org, fixtureBuyerAccount(org.org.slug).email);
      const w = FIXTURE_ENGAGEMENT_WEIGHTS;
      // 1 check-in, 1 poll vote, 1 question, 1 answered survey, no enrollment.
      const expected = w.check_in + w.poll_vote + w.question + w.feedback;
      expect(expected).toBe(21);
      expect(await crmScore(org, org.event.id, buyer)).toBe(expected);
      expect(await scoreOf(org, org.event.id, buyer)).toMatchObject({
        score: expected,
        counts: { check_in: 1, poll_vote: 1, question: 1, feedback: 1, enrollment: 0 },
        email: fixtureBuyerAccount(org.org.slug).email,
      });
    }
  });

  it('handling the same outbox events again changes nothing', async () => {
    const buyer = await contactOf(a, fixtureBuyerAccount(a.org.slug).email);
    const events = await withTenant(sys(), (tx) =>
      recentEventsTx(tx, a.org.id, ['ticket.admitted', 'survey.responded'], 365 * 24 * H),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) await consumeEvent(engagementActivity(), e);
    await withTenant(sys(), async (tx) => {
      // Even applied directly a second time (bypassing processed_events), a fact counts once.
      const { applyEngagementEventTx } = await import('@yayatoh/engagement');
      for (const e of events) await applyEngagementEventTx(tx, sys(), e);
    });
    expect(await crmScore(a, a.event.id, buyer)).toBe(21);
  });

  it('follows the weights: a change rescored every attendee at once, a reset gives the defaults', async () => {
    const buyer = await contactOf(b, fixtureBuyerAccount(b.org.slug).email);
    const weights = { check_in: 1, poll_vote: 10, question: 0, feedback: 7, enrollment: 4 };
    const r = await executeCommand(setScoreWeightsCommand, weights, b.ctx(), ports);
    expect(r.rescored).toBeGreaterThanOrEqual(1);
    expect(await crmScore(b, b.event.id, buyer)).toBe(1 + 10 + 0 + 7);
    expect(await executeQuery(scoreWeightsQuery, {}, b.ctx(), ports)).toEqual({ weights, custom: true });
    await executeCommand(resetScoreWeightsCommand, {}, b.ctx(), ports);
    const d = DEFAULT_WEIGHTS;
    expect(await crmScore(b, b.event.id, buyer)).toBe(d.check_in + d.poll_vote + d.question + d.feedback);
    expect(await executeQuery(scoreWeightsQuery, {}, b.ctx(), ports)).toEqual({
      weights: DEFAULT_WEIGHTS,
      custom: false,
    });
    // The other org's scores did not move.
    expect(await crmScore(a, a.event.id, await contactOf(a, fixtureBuyerAccount(a.org.slug).email))).toBe(21);
  });

  it('weights are whole points from 0 to 100, set by owners and admins only', async () => {
    const ok = { check_in: 0, poll_vote: 100, question: 1, feedback: 1, enrollment: 1 };
    expect(
      await codeOf(executeCommand(setScoreWeightsCommand, { ...ok, poll_vote: 101 }, b.ctx(), ports)),
    ).toBe('validation_failed');
    expect(
      await codeOf(executeCommand(setScoreWeightsCommand, { ...ok, check_in: -1 }, b.ctx(), ports)),
    ).toBe('validation_failed');
    expect(
      await codeOf(executeCommand(setScoreWeightsCommand, { ...ok, question: 1.5 }, b.ctx(), ports)),
    ).toBe('validation_failed');
    expect(
      await codeOf(executeCommand(setScoreWeightsCommand, ok, userCtx(b.viewerId, b.org.id), ports)),
    ).toBe('forbidden');
    expect(
      await codeOf(executeCommand(resetScoreWeightsCommand, {}, userCtx(b.viewerId, b.org.id), ports)),
    ).toBe('forbidden');
    await executeCommand(resetScoreWeightsCommand, {}, b.ctx(), ports);
  });

  it('an undone admission takes the check-in back', async () => {
    const buyer = await contactOf(b, fixtureBuyerAccount(b.org.slug).email);
    const before = (await scoreOf(b, b.event.id, buyer))?.score ?? 0;
    const [adm] = await admin<{ id: string }[]>`
      select id from checkin.admissions where org_id = ${b.org.id} and event_id = ${b.event.id} and undone_at is null limit 1`;
    await executeCommand(
      undoAdmissionCommand,
      { eventId: b.event.id, admissionId: adm?.id ?? '' },
      b.ctx({ now: new Date('2027-10-14T15:10:00Z') }),
      ports,
    );
    await drain(b);
    expect((await scoreOf(b, b.event.id, buyer))?.score).toBe(before - DEFAULT_WEIGHTS.check_in);
    expect((await scoreOf(b, b.event.id, buyer))?.counts.check_in).toBe(0);
  });
});

describe('sources', () => {
  let c: Conf;
  let talk: { id: string };
  let workshop: { id: string };
  beforeAll(async () => {
    await executeCommand(resetScoreWeightsCommand, {}, a.ctx(), ports);
    c = await conference();
    talk = await session(c, 'Talk', 1);
    workshop = await session(c, 'Workshop', 3);
    await executeCommand(enableLiveCommand, { eventId: c.ev.id, sessionId: talk.id }, a.ctx(), ports);
  });
  afterAll(async () => {
    await executeCommand(setScoreWeightsCommand, FIXTURE_ENGAGEMENT_WEIGHTS, a.ctx(), ports);
  });

  const key = (p: Person | string) =>
    participantKey(SECRET, talk.id, typeof p === 'string' ? `device:${p}` : `user:${p.account.userId}`);

  async function openPoll(question: string) {
    const p = await executeCommand(
      createPollCommand,
      { eventId: c.ev.id, sessionId: talk.id, kind: 'single', question, options: ['Yes', 'No'] },
      a.ctx(),
      ports,
    );
    await executeCommand(openPollCommand, { eventId: c.ev.id, pollId: p.id }, a.ctx(), ports);
    return p.id;
  }

  it('a signed-in attendee scores for votes and named questions, once each', async () => {
    const p = await attendee(c);
    const poll1 = await openPoll('First?');
    const poll2 = await openPoll('Second?');
    const vote = (pollId: string) =>
      executeCommand(
        voteCommand,
        { eventId: c.ev.id, pollId, participantKey: key(p), optionIds: ['o1'], account: p.account },
        p.ctx(),
        ports,
      );
    await vote(poll1);
    await vote(poll2);
    expect(await codeOf(vote(poll1))).toBe('conflict:already_voted');
    await executeCommand(
      askQuestionCommand,
      {
        eventId: c.ev.id,
        sessionId: talk.id,
        participantKey: key(p),
        body: 'Named?',
        name: 'P',
        account: p.account,
      },
      p.ctx(),
      ports,
    );
    // An anonymous question is never scored (nothing may tie the person to it).
    await executeCommand(
      askQuestionCommand,
      {
        eventId: c.ev.id,
        sessionId: talk.id,
        participantKey: key(p),
        body: 'Secret?',
        anonymous: true,
        account: p.account,
      },
      p.ctx(),
      ports,
    );
    const d = DEFAULT_WEIGHTS;
    expect(await scoreOf(a, c.ev.id, p.contactId)).toMatchObject({
      score: 2 * d.poll_vote + d.question,
      counts: { poll_vote: 2, question: 1 },
    });
    expect(await crmScore(a, c.ev.id, p.contactId)).toBe(2 * d.poll_vote + d.question);
    const logged = await admin<{ kind: string; source_ref: string; session_id: string }[]>`
      select kind, source_ref, session_id from engagement.engagement_events
      where org_id = ${a.org.id} and contact_id = ${p.contactId} order by kind, source_ref`;
    expect(logged.map((l) => l.kind)).toEqual(['poll_vote', 'poll_vote', 'question']);
    expect(logged.every((l) => l.session_id === talk.id)).toBe(true);
    expect(logged.some((l) => l.source_ref.includes('Secret'))).toBe(false);
  });

  it('devices, visitors who are not attendees and mismatched accounts take part unscored', async () => {
    const poll = await openPoll('Unscored?');
    const p = await attendee(c);
    // A device (no account).
    await executeCommand(
      voteCommand,
      { eventId: c.ev.id, pollId: poll, participantKey: key('phone-1'), optionIds: ['o1'] },
      anon(),
      ports,
    );
    // The account given while the actor is someone else (or nobody): not theirs to claim.
    await executeCommand(
      voteCommand,
      {
        eventId: c.ev.id,
        pollId: poll,
        participantKey: key('phone-2'),
        optionIds: ['o1'],
        account: p.account,
      },
      anon(),
      ports,
    );
    // A signed-in visitor whose email is no attendee's.
    const stranger = { userId: uuidv7(), email: `stranger-${uuidv7()}@example.test` };
    await executeCommand(
      voteCommand,
      {
        eventId: c.ev.id,
        pollId: poll,
        participantKey: key('phone-3'),
        optionIds: ['o2'],
        account: stranger,
      },
      createCtx({ orgId: a.org.id, actor: { type: 'user', userId: stranger.userId } }),
      ports,
    );
    expect(await scoreOf(a, c.ev.id, p.contactId)).toBeNull();
    const [row] = await admin<{ ballots: number }[]>`select ballots from engagement.polls where id = ${poll}`;
    expect(row?.ballots).toBe(3);
  });

  it('enrollments count while they last; a door scan counts once however often', async () => {
    const p = await attendee(c);
    const enrol = (sessionId: string) =>
      executeCommand(
        enrollSessionCommand,
        { token: p.token, registrantId: p.id, sessionId, choice: 'refuse' },
        anon(at(-72)),
        ports,
      );
    await enrol(talk.id);
    await enrol(workshop.id);
    await drain();
    expect((await scoreOf(a, c.ev.id, p.contactId))?.counts.enrollment).toBe(2);
    await executeCommand(
      dropSessionCommand,
      { token: p.token, registrantId: p.id, sessionId: workshop.id },
      anon(at(-72)),
      ports,
    );
    await drain();
    expect((await scoreOf(a, c.ev.id, p.contactId))?.counts.enrollment).toBe(1);

    const gate = await executeCommand(
      createCheckpointCommand,
      { eventId: c.ev.id, name: 'Door', kind: 'entrance' },
      a.ctx(),
      ports,
    );
    const [ticket] = await admin<{ short_code: string }[]>`
      select short_code from ticketing.tickets where org_id = ${a.org.id} and id = ${p.id}`;
    await executeCommand(
      scanTicketCommand,
      { eventId: c.ev.id, code: ticket?.short_code ?? '', checkpointId: gate.id },
      a.ctx({ now: at(0) }),
      ports,
    );
    await executeCommand(
      scanTicketCommand,
      { eventId: c.ev.id, code: ticket?.short_code ?? '', checkpointId: gate.id },
      a.ctx({ now: at(1) }),
      ports,
    );
    await drain();
    const d = DEFAULT_WEIGHTS;
    expect(await scoreOf(a, c.ev.id, p.contactId)).toMatchObject({
      score: d.enrollment + d.check_in,
      counts: { check_in: 1, enrollment: 1 },
    });
  });

  it('session scores add up what happened in each session', async () => {
    const r = await executeQuery(eventScoresQuery, { eventId: c.ev.id }, a.ctx(), ports);
    const t = r.sessions.find((s) => s.sessionId === talk.id);
    const w = r.sessions.find((s) => s.sessionId === workshop.id);
    const d = DEFAULT_WEIGHTS;
    // Talk: two votes and a question from the first attendee, one enrollment from the third.
    expect(t).toMatchObject({ participants: 2, counts: { poll_vote: 2, question: 1, enrollment: 1 } });
    expect(t?.score).toBe(2 * d.poll_vote + d.question + d.enrollment);
    expect(w).toMatchObject({ participants: 0, score: 0 });
    expect(r.engaged).toBe(2);
    expect(r.attendees.map((x) => x.score)).toEqual(
      [...r.attendees.map((x) => x.score)].sort((x, y) => y - x),
    );
  });
});

describe('session feedback: the prompt at session end, one response per person', () => {
  let c: Conf;
  let talk: { id: string };
  let surveyId: string;
  const after = () => at(3);
  beforeAll(async () => {
    c = await conference();
    talk = await session(c, 'Closing talk', 1);
    surveyId = (
      await executeCommand(
        createSurveyCommand,
        {
          eventId: c.ev.id,
          kind: 'session_feedback',
          sessionId: talk.id,
          title: 'How was the closing talk?',
          definition: { fields: [{ key: 'stars', type: 'rating', label: 'Talk', required: true }] },
        },
        a.ctx(),
        ports,
      )
    ).id;
  });

  const prompt = (p: Person | null, now: Date) =>
    executeQuery(
      feedbackPromptQuery,
      { eventId: c.ev.id, sessionId: talk.id, ...(p ? { account: p.account } : {}) },
      p ? p.ctx(now) : anon(now),
      ports,
    );
  const open = (p: Person, now: Date, ctx = p.ctx(now)) =>
    executeCommand(
      openFeedbackCommand,
      { eventId: c.ev.id, sessionId: talk.id, account: p.account },
      ctx,
      ports,
    );

  it('shows nothing before the session ends, then asks the attendee (and asks visitors to sign in)', async () => {
    const p = await attendee(c);
    expect(await prompt(p, at(1.5))).toEqual({ state: 'none', title: null });
    expect(await codeOf(open(p, at(1.5)))).toBe('not_found');
    expect(await prompt(null, after())).toEqual({ state: 'sign_in', title: 'How was the closing talk?' });
    expect(await prompt(p, after())).toEqual({ state: 'open', title: 'How was the closing talk?' });
    // Someone signed in who is not attending sees nothing and gets nothing.
    const stranger: Person = {
      ...p,
      account: { userId: p.account.userId, email: `x-${uuidv7()}@example.test` },
    };
    expect(await prompt(stranger, after())).toEqual({ state: 'none', title: null });
    expect(await codeOf(open(stranger, after()))).toBe('not_found');
    // The account must be the actor's.
    expect(await codeOf(open(p, after(), anon(after())))).toBe('not_found');
  });

  it('one invitation and one response per person, even under concurrency; the answer is scored once', async () => {
    const p = await attendee(c);
    const first = await open(p, after());
    const again = await open(p, after());
    expect(again.token).toBe(first.token);
    const [inv] = await admin<{ n: number; source: string }[]>`
      select count(*)::int as n, min(s.source) as source from surveys.invitations i
      join surveys.sends s on s.id = i.send_id
      where i.survey_id = ${surveyId} and i.contact_id = ${p.contactId}`;
    expect(inv).toEqual({ n: 1, source: 'prompt' });
    const submit = () =>
      executeCommand(
        submitSurveyResponseCommand,
        { token: first.token, answers: { stars: 4 } },
        anon(after()),
        ports,
      );
    const results = await Promise.all(Array.from({ length: 6 }, () => codeOf(submit())));
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'conflict:already_answered')).toHaveLength(5);
    expect(await codeOf(open(p, after()))).toBe('conflict:already_answered');
    expect(await prompt(p, after())).toMatchObject({ state: 'answered' });
    const [resp] = await admin<{ n: number }[]>`
      select count(*)::int as n from surveys.responses where survey_id = ${surveyId} and contact_id = ${p.contactId}`;
    expect(resp?.n).toBe(1);
    await drain();
    await drain();
    // Org a's weights are the fixture's again (the sources block put them back).
    expect(await scoreOf(a, c.ev.id, p.contactId)).toMatchObject({
      score: FIXTURE_ENGAGEMENT_WEIGHTS.feedback,
      counts: { feedback: 1 },
    });
    const r = await executeQuery(eventScoresQuery, { eventId: c.ev.id }, a.ctx(), ports);
    expect(r.sessions.find((s) => s.sessionId === talk.id)?.counts.feedback).toBe(1);
  });

  it('a prompt sends no email', async () => {
    const p = await attendee(c);
    await open(p, after());
    const sent = await withTenant(sys(), (tx) => recentEventsTx(tx, a.org.id, ['survey.sent'], 365 * 24 * H));
    expect(sent.filter((e) => (e.payload as { surveyId?: string }).surveyId === surveyId)).toHaveLength(0);
  });

  it('a closed survey prompts nobody', async () => {
    const p = await attendee(c);
    await executeCommand(
      setSurveyClosedCommand,
      { eventId: c.ev.id, surveyId, closed: true },
      a.ctx(),
      ports,
    );
    expect(await prompt(p, after())).toEqual({ state: 'none', title: null });
    expect(await codeOf(open(p, after()))).toBe('not_found');
    await executeCommand(
      setSurveyClosedCommand,
      { eventId: c.ev.id, surveyId, closed: false },
      a.ctx(),
      ports,
    );
    expect(await prompt(p, after())).toMatchObject({ state: 'open' });
  });
});

describe('audiences, permissions and isolation', () => {
  const engaged = (eventId: string, value: number) => ({
    version: 1 as const,
    root: {
      type: 'group' as const,
      op: 'and' as const,
      conditions: [
        {
          type: 'engagement' as const,
          scope: { kind: 'event' as const, eventId },
          op: 'gte' as const,
          value,
        },
      ],
    },
  });

  it('the engagement condition finds the fixture attendee by score', async () => {
    const buyer = await contactOf(a, fixtureBuyerAccount(a.org.slug).email);
    const hit = await executeQuery(
      previewAudienceQuery,
      { definition: engaged(a.event.id, 21) },
      a.ctx(),
      ports,
    );
    expect(hit.rows.map((r) => r.contactId)).toContain(buyer);
    const miss = await executeQuery(
      previewAudienceQuery,
      { definition: engaged(a.event.id, 22) },
      a.ctx(),
      ports,
    );
    expect(miss.rows.map((r) => r.contactId)).not.toContain(buyer);
    // Another org's event id resolves to nothing here.
    const cross = await executeQuery(
      previewAudienceQuery,
      { definition: engaged(b.event.id, 0) },
      a.ctx(),
      ports,
    );
    expect(cross.rows.map((r) => r.contactId)).not.toContain(
      await contactOf(b, fixtureBuyerAccount(b.org.slug).email),
    );
  });

  it('scores need attendees:read; another org never sees them', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const r = await executeQuery(eventScoresQuery, { eventId: a.event.id }, viewer, ports);
    expect(r.attendees.length).toBeGreaterThan(0);
    expect(await codeOf(executeQuery(eventScoresQuery, { eventId: b.event.id }, a.ctx(), ports))).toBe(
      'not_found',
    );
    expect(await codeOf(executeQuery(eventScoresQuery, { eventId: a.event.id }, anon(), ports))).toBe(
      'forbidden',
    );
    const rows = await withTenant(sys(), (tx) =>
      tx.execute<{ org_id: string }>(sql`select distinct org_id from engagement.engagement_events`),
    );
    expect(rows.map((x) => x.org_id)).toEqual([a.org.id]);
    const crm = await withTenant(sys(b), (tx) =>
      tx.execute<{ org_id: string }>(sql`select distinct org_id from crm.event_engagement`),
    );
    expect(crm.map((x) => x.org_id)).toEqual([b.org.id]);
  });
});
