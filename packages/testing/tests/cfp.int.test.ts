import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  createEventCommand,
  createPortalSession,
  type PortalPrincipal,
  portalCtx,
  portalInviteToken,
  portalPrincipalBySession,
  requestPortalChallenge,
  transitionEventCommand,
  verifyPortalChallenge,
} from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import { catchUpSubscriber, memoryNotifier, postgresRateLimitStore } from '@yayatoh/platform';
import { createRateLimiter } from '@yayatoh/platform/security';
import {
  addCfpQuestionCommand,
  addCfpReviewerCommand,
  assignCfpReviewerCommand,
  cfpMailer,
  cfpOverviewQuery,
  cfpReviewerHomeQuery,
  cfpReviewerSubmissionQuery,
  cfpSubmissionQuery,
  createSpeakerCommand,
  createTrackCommand,
  decideCfpSubmissionCommand,
  placeDraftSessionCommand,
  programQuery,
  publicCfp,
  publicProgram,
  removeCfpQuestionCommand,
  revokeCfpReviewerCommand,
  type SubmitCfpInput,
  saveCfpCommand,
  speakerPortalQuery,
  submitCfpCommand,
  submitCfpReviewCommand,
  unassignCfpReviewerCommand,
} from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M5.3b call for papers: the public form (forms engine), co-speakers, reviewers as portal
 * accounts who see only assigned submissions (blind option), reviews, decisions with emails, and
 * acceptance creating the speakers and exactly one draft session.
 */
let a: OrgFixture;
let b: OrgFixture;
const run = uuidv7().slice(-10);
const HOST = 'cfp.test';
const limiter = createRateLimiter(postgresRateLimitStore);
const limits = () => ({ limiter, subject: { device: `dev${uuidv7().replace(/-/g, '')}`, ip: null } });
const browser = () => `b${uuidv7().replace(/-/g, '')}`.padEnd(43, 'x').slice(0, 43);
const mail = (tag: string) => `cfp.${tag}.${run}@example.test`;
let clock = Date.now();
const later = () => {
  clock += 31_000;
  return new Date(clock);
};

const events = new Map<string, string>();
const evOf = (org: OrgFixture) => events.get(org.org.id) ?? '';
/** The public form's context: the org from the event's page, nobody signed in. */
const publicCtx = (org: OrgFixture, locale = 'en') => createCtx({ orgId: org.org.id, locale });

async function newEvent(org: OrgFixture, name: string, main = true) {
  const e = await executeCommand(
    createEventCommand,
    {
      name,
      profile: 'conference',
      timezone: 'America/Chicago',
      startsAt: '2029-06-01T14:00:00Z',
      endsAt: '2029-06-02T23:00:00Z',
    },
    org.ctx(),
    ports,
  );
  await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, org.ctx(), ports);
  if (main) events.set(org.org.id, e.id);
  return e.id;
}

async function inviteTokenOf(org: OrgFixture, accountId: string) {
  const [row] = await withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ v: number }>(
      sql`select invite_version as v from events.portal_accounts where id = ${accountId}`,
    ),
  );
  return portalInviteToken(org.org.id, accountId, Number(row?.v ?? 1));
}

/** Invite a reviewer, sign them in by code and return the principal. */
async function reviewer(org: OrgFixture, name: string, address: string) {
  const r = await executeCommand(
    addCfpReviewerCommand,
    { eventId: evOf(org), name, email: address },
    org.ctx(),
    ports,
  );
  const token = await inviteTokenOf(org, r.accountId);
  const c = await requestPortalChallenge({ inviteToken: token, browserState: browser() }, limits(), later());
  if (c.status !== 'sent') throw new Error(`no code: ${c.status}`);
  const v = await verifyPortalChallenge(
    { inviteToken: token, challengeId: c.challengeId, code: c.code },
    limits(),
    later(),
  );
  if (v.status !== 'ok') throw new Error(`not verified: ${v.status}`);
  const s = await createPortalSession({ orgId: v.orgId, accountId: v.accountId, host: HOST });
  const p = await portalPrincipalBySession(s.token, HOST);
  if (!p) throw new Error('no principal');
  return { reviewerId: r.reviewerId, accountId: r.accountId, principal: p };
}

const proposal = (org: OrgFixture, over: Partial<SubmitCfpInput> = {}): SubmitCfpInput => ({
  eventId: evOf(org),
  title: `Talk ${uuidv7().slice(-8)}`,
  abstract: 'What we learned running events at scale.',
  durationMinutes: 30,
  speakerName: 'Lea Lead',
  speakerEmail: mail(`lead-${uuidv7().slice(-6)}`),
  speakerTitle: 'Researcher',
  speakerCompany: 'Acme Lab',
  speakerBio: 'Lea studies crowds.',
  coSpeakers: [],
  answers: {},
  ...over,
});

async function submit(org: OrgFixture, over: Partial<SubmitCfpInput> = {}) {
  const input = proposal(org, over);
  await executeCommand(submitCfpCommand, input, publicCtx(org), ports);
  const [row] = await withTenant(systemCtx(org.org.id), (tx) =>
    tx.execute<{ id: string }>(
      sql`select id from program.cfp_submissions where speaker_email = ${input.speakerEmail} and title = ${input.title}`,
    ),
  );
  if (!row) throw new Error('not stored');
  return { id: row.id, input };
}

const rctx = (p: PortalPrincipal): Ctx => portalCtx(p, 'en');
let trackId: string;
let rev1: Awaited<ReturnType<typeof reviewer>>;
let rev2: Awaited<ReturnType<typeof reviewer>>;
let revB: Awaited<ReturnType<typeof reviewer>>;

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  await newEvent(a, `CFP Summit ${run}`);
  await newEvent(b, `CFP Other ${run}`);
  trackId = (
    await executeCommand(createTrackCommand, { eventId: evOf(a), name: `Research ${run}` }, a.ctx(), ports)
  ).id;
  for (const org of [a, b])
    await executeCommand(
      saveCfpCommand,
      { eventId: evOf(org), status: 'open', durations: [30, 45], maxCoSpeakers: 2, intro: 'Send us talks.' },
      org.ctx(),
      ports,
    );
  rev1 = await reviewer(a, 'Rita Reviewer', mail('rev1'));
  rev2 = await reviewer(a, 'Raj Reviewer', mail('rev2'));
  revB = await reviewer(b, 'Bo Reviewer', mail('revb'));
}, 240_000);

afterAll(async () => {
  await closePools();
});

describe('call setup and the public form', () => {
  it('the public call shows only once opened, with tracks, lengths and questions', async () => {
    const target = { orgId: a.org.id, eventId: evOf(a) };
    const q = await executeCommand(
      addCfpQuestionCommand,
      { eventId: evOf(a), type: 'select', label: 'Level', required: true, options: ['Intro', 'Advanced'] },
      a.ctx(),
      ports,
    );
    const pub = await publicCfp(target);
    expect(pub?.state).toBe('open');
    expect(pub?.durations).toEqual([30, 45]);
    expect(pub?.tracks.map((t) => t.id)).toContain(trackId);
    expect(pub?.form?.fields.map((f) => f.label)).toEqual(['Level']);
    // The required question is enforced by the forms engine.
    await expect(executeCommand(submitCfpCommand, proposal(a), publicCtx(a), ports)).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'form_invalid' },
    });
    await executeCommand(removeCfpQuestionCommand, { eventId: evOf(a), key: q.key }, a.ctx(), ports);
    expect((await publicCfp(target))?.form).toBeNull();
  });

  it('a draft call is not public; closed and past-deadline calls refuse proposals', async () => {
    const c = await newEvent(a, `CFP Draft ${run}`, false);
    const target = { orgId: a.org.id, eventId: c };
    expect(await publicCfp(target)).toBeNull();
    await expect(
      executeCommand(submitCfpCommand, { ...proposal(a), eventId: c }, publicCtx(a), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(saveCfpCommand, { eventId: c, status: 'closed', durations: [30] }, a.ctx(), ports);
    expect((await publicCfp(target))?.state).toBe('closed');
    await expect(
      executeCommand(submitCfpCommand, { ...proposal(a), eventId: c }, publicCtx(a), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'closed' } });
    // Opening with a deadline already past is refused; a deadline that passes closes the call.
    await expect(
      executeCommand(
        saveCfpCommand,
        { eventId: c, status: 'open', durations: [30], closesAt: new Date(Date.now() - 60_000) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'closesAt', reason: 'past' } });
    await executeCommand(
      saveCfpCommand,
      { eventId: c, status: 'open', durations: [30], closesAt: new Date(Date.now() + 60_000) },
      a.ctx(),
      ports,
    );
    expect((await publicCfp(target, new Date(Date.now() + 120_000)))?.state).toBe('past_deadline');
  });

  it('validates the proposal: lengths, tracks, co-speakers, duplicates', async () => {
    await expect(
      executeCommand(submitCfpCommand, proposal(a, { durationMinutes: 60 }), publicCtx(a), ports),
    ).rejects.toMatchObject({ details: { field: 'durationMinutes', reason: 'not_offered' } });
    await expect(
      executeCommand(submitCfpCommand, proposal(a, { trackId: uuidv7() }), publicCtx(a), ports),
    ).rejects.toMatchObject({ details: { field: 'trackId', reason: 'unknown' } });
    const lead = mail('dup-lead');
    await expect(
      executeCommand(
        submitCfpCommand,
        proposal(a, { speakerEmail: lead, coSpeakers: [{ name: 'Me again', email: lead.toUpperCase() }] }),
        publicCtx(a),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'coSpeakers.0', reason: 'duplicate' } });
    await expect(
      executeCommand(
        submitCfpCommand,
        proposal(a, {
          coSpeakers: [1, 2, 3].map((i) => ({ name: `Co ${i}`, email: mail(`co${i}-many`) })),
        }),
        publicCtx(a),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'coSpeakers.2', reason: 'too_many' } });
    const p = proposal(a);
    await executeCommand(submitCfpCommand, p, publicCtx(a), ports);
    await expect(
      executeCommand(submitCfpCommand, { ...p, title: p.title.toUpperCase() }, publicCtx(a), ports),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'duplicate' } });
  });

  it('an event of another org is unknown to the public command (the org comes from the page)', async () => {
    await expect(
      executeCommand(submitCfpCommand, { ...proposal(a), eventId: evOf(b) }, publicCtx(a), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('organizer commands need events:write; viewers and other orgs are refused', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    await expect(
      executeCommand(saveCfpCommand, { eventId: evOf(a), status: 'open', durations: [30] }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeCommand(addCfpReviewerCommand, { eventId: evOf(a), name: 'X', email: mail('x') }, viewer, ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Viewers read the overview.
    expect((await executeQuery(cfpOverviewQuery, { eventId: evOf(a) }, viewer, ports)).call.status).toBe(
      'open',
    );
    await expect(executeQuery(cfpOverviewQuery, { eventId: evOf(a) }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // A portal reviewer runs no organizer command or query.
    await expect(
      executeQuery(cfpOverviewQuery, { eventId: evOf(a) }, rctx(rev1.principal), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('reviewers see only assigned submissions', () => {
  let one: string;
  let two: string;

  beforeAll(async () => {
    one = (await submit(a, { trackId, coSpeakers: [{ name: 'Cora Co', email: mail('cora') }] })).id;
    two = (await submit(a)).id;
    await executeCommand(
      assignCfpReviewerCommand,
      { eventId: evOf(a), submissionId: one, reviewerId: rev1.reviewerId },
      a.ctx(),
      ports,
    );
  });

  it('a reviewer lists and opens only what is assigned to them', async () => {
    const home = await executeQuery(cfpReviewerHomeQuery, {}, rctx(rev1.principal), ports);
    expect(home.submissions.map((s) => s.id)).toEqual([one]);
    const r2 = await executeQuery(cfpReviewerHomeQuery, {}, rctx(rev2.principal), ports);
    expect(r2.submissions).toEqual([]);
    const view = await executeQuery(
      cfpReviewerSubmissionQuery,
      { submissionId: one },
      rctx(rev1.principal),
      ports,
    );
    expect(view.speakerName).toBe('Lea Lead');
    expect(view.coSpeakers.map((c) => c.name)).toEqual(['Cora Co']);
    // An unassigned submission, a guess and another org's submission all look missing.
    for (const id of [two, uuidv7()])
      await expect(
        executeQuery(cfpReviewerSubmissionQuery, { submissionId: id }, rctx(rev1.principal), ports),
      ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(submitCfpReviewCommand, { submissionId: two, score: 5 }, rctx(rev1.principal), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeQuery(cfpReviewerSubmissionQuery, { submissionId: one }, rctx(revB.principal), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('members cannot run reviewer commands, and an assignment stays inside the event', async () => {
    await expect(executeQuery(cfpReviewerHomeQuery, {}, a.ctx(), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      executeCommand(
        assignCfpReviewerCommand,
        { eventId: evOf(a), submissionId: one, reviewerId: revB.reviewerId },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'reviewerId', reason: 'unknown' } });
    await expect(
      executeCommand(
        assignCfpReviewerCommand,
        { eventId: evOf(a), submissionId: one, reviewerId: rev1.reviewerId },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'already_assigned' } });
  });

  it('blind review hides the people (names, co-speakers, custom answers)', async () => {
    await executeCommand(
      saveCfpCommand,
      { eventId: evOf(a), status: 'open', durations: [30, 45], maxCoSpeakers: 2, blind: true },
      a.ctx(),
      ports,
    );
    const view = await executeQuery(
      cfpReviewerSubmissionQuery,
      { submissionId: one },
      rctx(rev1.principal),
      ports,
    );
    expect(view).toMatchObject({
      blind: true,
      speakerName: null,
      speakerTitle: null,
      speakerCompany: null,
      speakerBio: null,
      coSpeakers: [],
      answers: [],
    });
    expect(JSON.stringify(view)).not.toContain('Lea');
    expect(view.title).toBeTruthy();
    // The organizer still sees everything.
    const full = await executeQuery(
      cfpSubmissionQuery,
      { eventId: evOf(a), submissionId: one },
      a.ctx(),
      ports,
    );
    expect(full.speakerName).toBe('Lea Lead');
    await executeCommand(
      saveCfpCommand,
      { eventId: evOf(a), status: 'open', durations: [30, 45], maxCoSpeakers: 2, blind: false },
      a.ctx(),
      ports,
    );
  });

  it('scores and comments: one review per assignment, editable until decided, shown to the organizer', async () => {
    await expect(
      executeCommand(submitCfpReviewCommand, { submissionId: one, score: 6 }, rctx(rev1.principal), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await executeCommand(
      submitCfpReviewCommand,
      { submissionId: one, score: 3, comment: 'Solid' },
      rctx(rev1.principal),
      ports,
    );
    await executeCommand(
      submitCfpReviewCommand,
      { submissionId: one, score: 4, comment: 'Solid, timely' },
      rctx(rev1.principal),
      ports,
    );
    await executeCommand(
      assignCfpReviewerCommand,
      { eventId: evOf(a), submissionId: one, reviewerId: rev2.reviewerId },
      a.ctx(),
      ports,
    );
    await executeCommand(
      submitCfpReviewCommand,
      { submissionId: one, score: 5 },
      rctx(rev2.principal),
      ports,
    );
    const d = await executeQuery(cfpSubmissionQuery, { eventId: evOf(a), submissionId: one }, a.ctx(), ports);
    expect(d.averageScore).toBe(4.5);
    expect(d.reviews.map((r) => [r.reviewerName, r.score, r.comment])).toEqual([
      ['Raj Reviewer', 5, ''],
      ['Rita Reviewer', 4, 'Solid, timely'],
    ]);
    const over = await executeQuery(cfpOverviewQuery, { eventId: evOf(a) }, a.ctx(), ports);
    expect(over.submissions.find((s) => s.id === one)).toMatchObject({ reviewCount: 2, averageScore: 4.5 });
    expect(over.reviewers.find((r) => r.id === rev1.reviewerId)).toMatchObject({
      access: 'active',
      assigned: 1,
      reviewed: 1,
    });
    // Unassigning removes the reviewer's access to it.
    await executeCommand(
      unassignCfpReviewerCommand,
      { eventId: evOf(a), submissionId: one, reviewerId: rev2.reviewerId },
      a.ctx(),
      ports,
    );
    await expect(
      executeQuery(cfpReviewerSubmissionQuery, { submissionId: one }, rctx(rev2.principal), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a revoked reviewer opens nothing', async () => {
    const r = await reviewer(a, 'Gone Reviewer', mail('gone'));
    await executeCommand(
      assignCfpReviewerCommand,
      { eventId: evOf(a), submissionId: two, reviewerId: r.reviewerId },
      a.ctx(),
      ports,
    );
    await executeCommand(
      revokeCfpReviewerCommand,
      { eventId: evOf(a), accountId: r.accountId },
      a.ctx(),
      ports,
    );
    await expect(executeQuery(cfpReviewerHomeQuery, {}, rctx(r.principal), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('a reviewer is not a speaker: the speaker portal refuses them', async () => {
    await expect(executeQuery(speakerPortalQuery, {}, rctx(rev1.principal), ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('decisions', () => {
  it('accepting creates the speakers and exactly one draft session, hidden from the public', async () => {
    const existing = await executeCommand(
      createSpeakerCommand,
      { eventId: evOf(a), name: `Known ${run}` },
      a.ctx(),
      ports,
    );
    // A co-speaker already in the program (by email) is reused, not duplicated.
    await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute(
        sql`insert into program.speaker_contacts (org_id, event_id, speaker_id, email) values (${a.org.id}, ${evOf(a)}, ${existing.id}, ${mail('known')})`,
      ),
    );
    const s = await submit(a, {
      trackId,
      durationMinutes: 45,
      coSpeakers: [
        { name: 'Known', email: mail('known') },
        { name: 'New Co', email: mail('newco') },
      ],
    });
    const before = await executeQuery(programQuery, { eventId: evOf(a) }, a.ctx(), ports);
    const ctx = a.ctx();
    const [first, second] = await Promise.allSettled([
      executeCommand(
        decideCfpSubmissionCommand,
        { eventId: evOf(a), submissionId: s.id, decision: 'accept', note: 'Welcome!' },
        ctx,
        ports,
      ),
      executeCommand(
        decideCfpSubmissionCommand,
        { eventId: evOf(a), submissionId: s.id, decision: 'accept', note: null },
        a.ctx(),
        ports,
      ),
    ]);
    const ok = [first, second].filter((r) => r.status === 'fulfilled');
    const refused = [first, second].filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'invalid_state',
      details: { reason: 'decided' },
    });
    const after = await executeQuery(programQuery, { eventId: evOf(a) }, a.ctx(), ports);
    const created = after.sessions.filter((x) => !before.sessions.some((y) => y.id === x.id));
    expect(created).toHaveLength(1);
    const session = created[0];
    expect(session).toMatchObject({ title: s.input.title, draft: true, trackId });
    expect((session?.endsAt.getTime() ?? 0) - (session?.startsAt.getTime() ?? 0)).toBe(45 * 60_000);
    const newSpeakers = after.speakers.filter((x) => !before.speakers.some((y) => y.id === x.id));
    expect(newSpeakers.map((x) => x.name).sort()).toEqual(['Lea Lead', 'New Co']);
    expect(session?.speakerIds).toHaveLength(3);
    expect(session?.speakerIds).toContain(existing.id);
    // Accepting again (or rejecting) is refused: still one session.
    await expect(
      executeCommand(
        decideCfpSubmissionCommand,
        { eventId: evOf(a), submissionId: s.id, decision: 'reject', note: null },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'decided' } });
    const [n] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from program.sessions where event_id = ${evOf(a)} and title = ${s.input.title}`,
      ),
    );
    expect(n?.n).toBe(1);
    // The public program has neither the draft session nor the draft-only speakers.
    const target = { orgId: a.org.id, eventId: evOf(a) };
    let pub = await publicProgram(target);
    expect(pub.sessions.some((x) => x.title === s.input.title)).toBe(false);
    expect(pub.speakers.some((x) => x.name === 'Lea Lead')).toBe(false);
    // "Add to the agenda" puts it (and its speakers) on the public program.
    await expect(
      executeCommand(
        placeDraftSessionCommand,
        { eventId: evOf(a), sessionId: session?.id ?? '' },
        userCtx(a.viewerId, a.org.id),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await executeCommand(
      placeDraftSessionCommand,
      { eventId: evOf(a), sessionId: session?.id ?? '' },
      a.ctx(),
      ports,
    );
    pub = await publicProgram(target);
    expect(pub.sessions.some((x) => x.title === s.input.title)).toBe(true);
    expect(pub.speakers.some((x) => x.name === 'Lea Lead')).toBe(true);
    await expect(
      executeCommand(
        placeDraftSessionCommand,
        { eventId: evOf(a), sessionId: session?.id ?? '' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a decided submission takes no more reviews or assignments', async () => {
    const s = await submit(a);
    await executeCommand(
      assignCfpReviewerCommand,
      { eventId: evOf(a), submissionId: s.id, reviewerId: rev1.reviewerId },
      a.ctx(),
      ports,
    );
    await executeCommand(
      decideCfpSubmissionCommand,
      { eventId: evOf(a), submissionId: s.id, decision: 'reject', note: null },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(submitCfpReviewCommand, { submissionId: s.id, score: 2 }, rctx(rev1.principal), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'decided' } });
    await expect(
      executeCommand(
        assignCfpReviewerCommand,
        { eventId: evOf(a), submissionId: s.id, reviewerId: rev2.reviewerId },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'decided' } });
    const home = await executeQuery(cfpReviewerHomeQuery, {}, rctx(rev1.principal), ports);
    expect(home.submissions.find((x) => x.id === s.id)?.decided).toBe(true);
  });

  it('emails: received to the submitter; the decision to every speaker, in their language', async () => {
    const accepted = await submit(a, { coSpeakers: [{ name: 'Mo Co', email: mail('mo') }] });
    const rejectedInput = proposal(a);
    await executeCommand(submitCfpCommand, rejectedInput, publicCtx(a, 'fr'), ports);
    const [rej] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string; locale: string }>(
        sql`select id, locale from program.cfp_submissions where speaker_email = ${rejectedInput.speakerEmail}`,
      ),
    );
    expect(rej?.locale).toBe('fr');
    await executeCommand(
      decideCfpSubmissionCommand,
      { eventId: evOf(a), submissionId: accepted.id, decision: 'accept', note: 'See you there' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      decideCfpSubmissionCommand,
      { eventId: evOf(a), submissionId: rej?.id ?? '', decision: 'reject', note: null },
      a.ctx(),
      ports,
    );
    const { notifier, sent } = memoryNotifier();
    await catchUpSubscriber(cfpMailer({ notifier }), a.org.id);
    const to = (kind: string) =>
      sent
        .filter((m) => m.kind === kind)
        .map((m) => m.to.email)
        .filter(
          (e) => e === accepted.input.speakerEmail || e === mail('mo') || e === rejectedInput.speakerEmail,
        );
    expect(to('program.cfp-received')).toEqual(
      expect.arrayContaining([accepted.input.speakerEmail, rejectedInput.speakerEmail]),
    );
    expect(to('program.cfp-received')).not.toContain(mail('mo'));
    expect(to('program.cfp-accepted').sort()).toEqual([accepted.input.speakerEmail, mail('mo')].sort());
    expect(to('program.cfp-rejected')).toEqual([rejectedInput.speakerEmail]);
    const acc = sent.find((m) => m.kind === 'program.cfp-accepted' && m.to.email === mail('mo'));
    expect(acc?.params).toMatchObject({ title: accepted.input.title, note: 'See you there', hasNote: 'yes' });
    const fr = sent.find(
      (m) => m.kind === 'program.cfp-rejected' && m.to.email === rejectedInput.speakerEmail,
    );
    expect(fr?.to.locale).toBe('fr');
    expect(fr?.params).toMatchObject({ hasNote: 'no' });
  });

  it('the custom answers are stored through the forms engine and shown to the organizer', async () => {
    const q = await executeCommand(
      addCfpQuestionCommand,
      { eventId: evOf(b), type: 'short_text', label: 'Your city', required: false },
      b.ctx(),
      ports,
    );
    const s = await submit(b, { answers: { [q.key]: 'Lisbon' } });
    const d = await executeQuery(
      cfpSubmissionQuery,
      { eventId: evOf(b), submissionId: s.id },
      b.ctx(),
      ports,
    );
    expect(d.answers).toEqual([{ label: 'Your city', value: 'Lisbon' }]);
    await expect(
      executeCommand(submitCfpCommand, proposal(b, { answers: { nope: 'x' } }), publicCtx(b), ports),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { reason: 'form_invalid' } });
    // And to an assigned (non-blind) reviewer.
    await executeCommand(
      assignCfpReviewerCommand,
      { eventId: evOf(b), submissionId: s.id, reviewerId: revB.reviewerId },
      b.ctx(),
      ports,
    );
    const v = await executeQuery(
      cfpReviewerSubmissionQuery,
      { submissionId: s.id },
      rctx(revB.principal),
      ports,
    );
    expect(v.answers).toEqual([{ label: 'Your city', value: 'Lisbon' }]);
  });
});
