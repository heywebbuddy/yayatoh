import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import {
  askQuestionCommand,
  closePollCommand,
  createPollCommand,
  deletePollCommand,
  displaySession,
  enableLiveCommand,
  LIVE_CHANNEL,
  MODERATION_CHANNEL,
  moderateQuestionCommand,
  moderationQuery,
  moderationSnapshotTx,
  openPollCommand,
  participantKey,
  participantState,
  pinQuestionCommand,
  presentPollCommand,
  publicLiveSession,
  publicSnapshotTx,
  rotateDisplayLinkCommand,
  sessionChannelOpen,
  setPollResultsCommand,
  signDisplayToken,
  updateSettingsCommand,
  upvoteQuestionCommand,
  voteCommand,
} from '@yayatoh/engagement';
import { createEventCommand } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { realtimeCatchUpTx, realtimeChannelName } from '@yayatoh/platform';
import { createSessionCommand } from '@yayatoh/program';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

const SECRET = 'engagement-test-secret-0123456789abcdef';
let a: OrgFixture;
let b: OrgFixture;
let sessionId: string;
let eventId: string;
const visitor = (n: number | string) => participantKey(SECRET, sessionId, `device-${n}`);
const pub = (o: OrgFixture = a): Ctx => createCtx({ orgId: o.org.id });
const viewer = (o: OrgFixture = a) => userCtx(o.viewerId, o.org.id);

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

async function newSession(o: OrgFixture, evId: string, title: string, startsAt: Date) {
  const r = await executeCommand(
    createSessionCommand,
    { eventId: evId, title, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) },
    o.ctx(),
    ports,
  );
  return r.session.id;
}

const liveMessages = (channel: string) =>
  withTenant(systemCtx(a.org.id), (tx) =>
    tx.execute<{ event: string; data: unknown }>(
      sql`select event, data from platform.realtime_messages where channel = ${channel} order by seq`,
    ),
  );

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  eventId = a.event.id;
  sessionId = await newSession(a, eventId, `Live session ${uuidv7().slice(-6)}`, a.event.startsAt);
});
afterAll(closePools);

describe('engagement: polls (M5.7a)', () => {
  it('is off until enabled: organizers get not_enabled, the public a not_found', async () => {
    expect(
      await codeOf(
        executeCommand(
          createPollCommand,
          { eventId, sessionId, kind: 'rating', question: 'Q?' },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:not_enabled');
    expect(await publicLiveSession(a.org.id, eventId, sessionId)).toBeNull();
    const page = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    expect(page).toEqual({ enabled: false, settings: null, state: null });
    const s = await executeCommand(enableLiveCommand, { eventId, sessionId }, a.ctx(), ports);
    expect(s).toMatchObject({
      qaOpen: true,
      allowAnonymous: true,
      anonymousIdentity: 'hidden',
      displayVersion: 1,
    });
    // A second enable changes nothing.
    expect(await executeCommand(enableLiveCommand, { eventId, sessionId }, a.ctx(), ports)).toEqual(s);
  });

  it('validates new polls', async () => {
    const make = (extra: Record<string, unknown>) =>
      codeOf(
        executeCommand(createPollCommand, { eventId, sessionId, question: 'Pick', ...extra }, a.ctx(), ports),
      );
    expect(await make({ kind: 'single', options: ['Only one'] })).toBe('validation_failed:too_few');
    expect(await make({ kind: 'single', options: ['Same', 'same'] })).toBe('validation_failed:duplicate');
    expect(await make({ kind: 'multi', options: ['A', 'B'], maxChoices: 3 })).toBe(
      'validation_failed:too_many',
    );
    expect(await make({ kind: 'single', options: ['A', 'B'], question: '' })).toBe('validation_failed');
    expect(await make({ kind: 'rating', ratingScale: 11 })).toBe('validation_failed');
  });

  it('moves draft → open → closed only, and drafts never reach the public', async () => {
    const p = await executeCommand(
      createPollCommand,
      {
        eventId,
        sessionId,
        kind: 'multi',
        question: 'Which topics?',
        options: ['AI', 'Design', 'Data'],
        maxChoices: 2,
      },
      a.ctx(),
      ports,
    );
    expect(p).toMatchObject({
      state: 'draft',
      maxChoices: 2,
      options: [{ id: 'o1', label: 'AI' }, { id: 'o2' }, { id: 'o3' }],
    });
    expect((await publicLiveSession(a.org.id, eventId, sessionId))?.state.polls).toEqual([]);
    expect(
      await codeOf(
        executeCommand(
          voteCommand,
          { eventId, pollId: p.id, participantKey: visitor(1), optionIds: ['o1'] },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect(await codeOf(executeCommand(closePollCommand, { eventId, pollId: p.id }, a.ctx(), ports))).toBe(
      'invalid_state:draft',
    );
    await executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    expect(await codeOf(executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports))).toBe(
      'invalid_state:open',
    );
    const live = await publicLiveSession(a.org.id, eventId, sessionId);
    expect(live?.state.stage.livePollId).toBe(p.id);
    expect(live?.state.polls).toEqual([expect.objectContaining({ id: p.id, state: 'open', results: null })]);
    // Ballot rules are enforced by the server.
    const vote = (n: number, optionIds: string[]) =>
      codeOf(
        executeCommand(
          voteCommand,
          { eventId, pollId: p.id, participantKey: visitor(n), optionIds },
          pub(),
          ports,
        ),
      );
    expect(await vote(1, ['o1', 'o2', 'o3'])).toBe('validation_failed:too_many');
    expect(await vote(1, ['o9'])).toBe('validation_failed:unknown_option');
    expect(await vote(1, ['o1', 'o2'])).toBe('ok');
    expect(await vote(2, ['o2'])).toBe('ok');
    const mod = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    expect(mod.state?.polls.find((x) => x.id === p.id)?.results).toMatchObject({
      total: 2,
      counts: [
        { key: 'o1', count: 1 },
        { key: 'o2', count: 2 },
        { key: 'o3', count: 0 },
      ],
    });
    // Results reach the audience only when shown.
    await executeCommand(setPollResultsCommand, { eventId, pollId: p.id, show: true }, a.ctx(), ports);
    const shown = (await publicLiveSession(a.org.id, eventId, sessionId))?.state.polls.find(
      (x) => x.id === p.id,
    );
    expect(shown?.results?.counts.map((c) => c.count)).toEqual([1, 2, 0]);
    await executeCommand(closePollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    expect(await vote(3, ['o1'])).toBe('invalid_state:closed');
    expect(await codeOf(executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports))).toBe(
      'invalid_state:closed',
    );
    expect((await participantState(a.org.id, sessionId, visitor(1))).votedPollIds).toContain(p.id);
    expect((await participantState(a.org.id, sessionId, visitor(3))).votedPollIds).not.toContain(p.id);
  });

  it('one vote per person per poll, under concurrency', async () => {
    const p = await executeCommand(
      createPollCommand,
      { eventId, sessionId, kind: 'rating', question: 'How was it?', ratingScale: 5 },
      a.ctx(),
      ports,
    );
    await executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    const same = visitor('race');
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        codeOf(
          executeCommand(
            voteCommand,
            { eventId, pollId: p.id, participantKey: same, rating: (i % 5) + 1 },
            pub(),
            ports,
          ),
        ),
      ),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'conflict:already_voted')).toHaveLength(15);
    // Ten different people at once all count.
    const others = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        codeOf(
          executeCommand(
            voteCommand,
            { eventId, pollId: p.id, participantKey: visitor(`crowd-${i}`), rating: 4 },
            pub(),
            ports,
          ),
        ),
      ),
    );
    expect(others.every((r) => r === 'ok')).toBe(true);
    const mod = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    const r = mod.state?.polls.find((x) => x.id === p.id)?.results;
    expect(r?.total).toBe(11);
    expect(r?.counts.reduce((s, c) => s + c.count, 0)).toBe(11);
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from engagement.poll_ballots where poll_id = ${p.id}`,
      ),
    );
    expect(row?.n).toBe(11);
  });

  it('word clouds store counts of normalized words', async () => {
    const p = await executeCommand(
      createPollCommand,
      { eventId, sessionId, kind: 'word_cloud', question: 'One word?' },
      a.ctx(),
      ports,
    );
    await executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    for (const [n, word] of [
      [1, 'Inspiring'],
      [2, 'inspiring!'],
      [3, 'Long'],
    ] as const)
      await executeCommand(
        voteCommand,
        { eventId, pollId: p.id, participantKey: visitor(n), word },
        pub(),
        ports,
      );
    expect(
      await codeOf(
        executeCommand(
          voteCommand,
          { eventId, pollId: p.id, participantKey: visitor(4), word: '!!' },
          pub(),
          ports,
        ),
      ),
    ).toBe('validation_failed:word');
    const mod = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    expect(mod.state?.polls.find((x) => x.id === p.id)?.results.counts).toEqual([
      { key: 'inspiring', label: 'inspiring', count: 2 },
      { key: 'long', label: 'long', count: 1 },
    ]);
    // Present another poll, then delete this one: it leaves the stage and every screen.
    await executeCommand(presentPollCommand, { eventId, sessionId, pollId: p.id }, a.ctx(), ports);
    await executeCommand(deletePollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    const live = await publicLiveSession(a.org.id, eventId, sessionId);
    expect(live?.state.stage.livePollId).toBeNull();
    expect(live?.state.polls.map((x) => x.id)).not.toContain(p.id);
  });
});

describe('engagement: moderated Q&A (M5.7a)', () => {
  const ask = (n: number | string, body: string, extra: Record<string, unknown> = {}) =>
    executeCommand(
      askQuestionCommand,
      { eventId, sessionId, participantKey: visitor(n), body, name: `Guest ${n}`, ...extra },
      pub(),
      ports,
    );
  const idOf = async (body: string) => {
    const [r] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from engagement.questions where body = ${body}`),
    );
    return r?.id ?? '';
  };

  it('unapproved questions never reach public payloads or the public channel', async () => {
    const body = `Pending secret ${uuidv7()}`;
    await ask('p1', body);
    const id = await idOf(body);
    const liveChannel = realtimeChannelName(LIVE_CHANNEL, a.org.id, eventId, sessionId);
    const modChannel = realtimeChannelName(MODERATION_CHANNEL, a.org.id, eventId, sessionId);
    const leaked = async () => {
      const state = JSON.stringify(await publicLiveSession(a.org.id, eventId, sessionId));
      const snap = JSON.stringify(
        await withTenant(systemCtx(a.org.id), (tx) => publicSnapshotTx(tx, sessionId)),
      );
      const msgs = JSON.stringify(await liveMessages(liveChannel));
      return [state, snap, msgs].some((t) => t.includes(body));
    };
    expect(await leaked()).toBe(false);
    // The moderators see it at once.
    expect(JSON.stringify(await liveMessages(modChannel))).toContain(body);
    const queue = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    expect(queue.state?.questions.find((q) => q.id === id)).toMatchObject({
      state: 'pending',
      authorName: 'Guest p1',
    });
    // Nobody can upvote what they can't see.
    expect(
      await codeOf(
        executeCommand(
          upvoteQuestionCommand,
          { eventId, questionId: id, participantKey: visitor(9) },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect((await participantState(a.org.id, sessionId, visitor('p1'))).pendingQuestions).toBe(1);
    // Approved: now public, with its name.
    await executeCommand(
      moderateQuestionCommand,
      { eventId, questionId: id, action: 'approve' },
      a.ctx(),
      ports,
    );
    const live = await publicLiveSession(a.org.id, eventId, sessionId);
    expect(live?.state.questions.find((q) => q.id === id)).toMatchObject({
      body,
      authorName: 'Guest p1',
      upvotes: 0,
    });
    // Dismissed after approval: removed from every screen.
    await executeCommand(
      moderateQuestionCommand,
      { eventId, questionId: id, action: 'dismiss' },
      a.ctx(),
      ports,
    );
    expect(
      (await publicLiveSession(a.org.id, eventId, sessionId))?.state.questions.map((q) => q.id),
    ).not.toContain(id);
    const msgs = await liveMessages(liveChannel);
    expect(msgs.at(-1)).toEqual({ event: 'question-removed', data: { id } });
  });

  it('upvotes once per person; pin, answer and unpin', async () => {
    const body = `Upvote me ${uuidv7()}`;
    await ask('u1', body);
    const id = await idOf(body);
    await executeCommand(
      moderateQuestionCommand,
      { eventId, questionId: id, action: 'approve' },
      a.ctx(),
      ports,
    );
    const up = (n: string) =>
      codeOf(
        executeCommand(
          upvoteQuestionCommand,
          { eventId, questionId: id, participantKey: visitor(n) },
          pub(),
          ports,
        ),
      );
    const many = await Promise.all([up('x'), up('x'), up('x'), up('y')]);
    expect(many.filter((r) => r === 'ok')).toHaveLength(2);
    expect(many.filter((r) => r === 'conflict:already_upvoted')).toHaveLength(2);
    expect((await participantState(a.org.id, sessionId, visitor('x'))).upvotedQuestionIds).toContain(id);
    await executeCommand(pinQuestionCommand, { eventId, sessionId, questionId: id }, a.ctx(), ports);
    let live = await publicLiveSession(a.org.id, eventId, sessionId);
    expect(live?.state.stage.pinnedQuestionId).toBe(id);
    expect(live?.state.questions[0]).toMatchObject({ id, upvotes: 2 });
    await executeCommand(
      moderateQuestionCommand,
      { eventId, questionId: id, action: 'answer' },
      a.ctx(),
      ports,
    );
    live = await publicLiveSession(a.org.id, eventId, sessionId);
    expect(live?.state.stage.pinnedQuestionId).toBeNull();
    expect(live?.state.questions.find((q) => q.id === id)?.answered).toBe(true);
    // Only approved questions can be pinned.
    const other = `Not yet ${uuidv7()}`;
    await ask('u2', other);
    expect(
      await codeOf(
        executeCommand(
          pinQuestionCommand,
          { eventId, sessionId, questionId: await idOf(other) },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('invalid_state:not_approved');
  });

  it('anonymous questions: no name for the audience; kept for moderators only by policy', async () => {
    const hidden = `Anon hidden ${uuidv7()}`;
    await ask('a1', hidden, { anonymous: true });
    const [row] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ author_name: string | null }>(
        sql`select author_name from engagement.questions where body = ${hidden}`,
      ),
    );
    expect(row?.author_name).toBeNull();
    await executeCommand(
      updateSettingsCommand,
      { eventId, sessionId, qaOpen: true, allowAnonymous: true, anonymousIdentity: 'moderators' },
      a.ctx(),
      ports,
    );
    const kept = `Anon kept ${uuidv7()}`;
    await ask('a2', kept, { anonymous: true });
    const id = await idOf(kept);
    await executeCommand(
      moderateQuestionCommand,
      { eventId, questionId: id, action: 'approve' },
      a.ctx(),
      ports,
    );
    const mod = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    expect(mod.state?.questions.find((q) => q.id === id)).toMatchObject({
      anonymous: true,
      authorName: 'Guest a2',
    });
    const live = await publicLiveSession(a.org.id, eventId, sessionId);
    expect(live?.state.questions.find((q) => q.id === id)?.authorName).toBeNull();
    expect(JSON.stringify(live)).not.toContain('Guest a2');
    const liveChannel = realtimeChannelName(LIVE_CHANNEL, a.org.id, eventId, sessionId);
    expect(JSON.stringify(await liveMessages(liveChannel))).not.toContain('Guest a2');
    // Back to "hidden": names already kept are erased.
    await executeCommand(
      updateSettingsCommand,
      { eventId, sessionId, qaOpen: true, allowAnonymous: false, anonymousIdentity: 'hidden' },
      a.ctx(),
      ports,
    );
    const after = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    expect(after.state?.questions.find((q) => q.id === id)?.authorName).toBeNull();
    // Anonymous now off; a named question needs a name.
    expect(await codeOf(ask('a3', 'Hi', { anonymous: true }))).toBe('validation_failed:not_allowed');
    expect(await codeOf(ask('a3', 'Hi', { name: '' }))).toBe('validation_failed:required');
    await executeCommand(
      updateSettingsCommand,
      { eventId, sessionId, qaOpen: false, allowAnonymous: true, anonymousIdentity: 'hidden' },
      a.ctx(),
      ports,
    );
    expect(await codeOf(ask('a3', 'Hi'))).toBe('invalid_state:qa_closed');
    await executeCommand(
      updateSettingsCommand,
      { eventId, sessionId, qaOpen: true, allowAnonymous: true, anonymousIdentity: 'hidden' },
      a.ctx(),
      ports,
    );
  });

  it('rate limits questions per participant', async () => {
    const results: string[] = [];
    for (let i = 0; i < 6; i++) results.push(await codeOf(ask('chatty', `Question ${i} ${uuidv7()}`)));
    expect(results.slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(results[5]).toBe('rate_limited:rate_limited');
    // Someone else is not affected.
    expect(await codeOf(ask('quiet', `Fine ${uuidv7()}`))).toBe('ok');
  });
});

describe('engagement: access, isolation and the big screen (M5.7a)', () => {
  it('viewers read but never moderate; the public never moderates', async () => {
    expect((await executeQuery(moderationQuery, { eventId, sessionId }, viewer(), ports)).enabled).toBe(true);
    const p = await executeCommand(
      createPollCommand,
      { eventId, sessionId, kind: 'single', question: 'Viewer?', options: ['A', 'B'] },
      a.ctx(),
      ports,
    );
    for (const ctx of [viewer(), pub()]) {
      expect(await codeOf(executeCommand(openPollCommand, { eventId, pollId: p.id }, ctx, ports))).toBe(
        'forbidden',
      );
      expect(
        await codeOf(
          executeCommand(
            createPollCommand,
            { eventId, sessionId, kind: 'rating', question: 'x' },
            ctx,
            ports,
          ),
        ),
      ).toBe('forbidden');
      expect(await codeOf(executeCommand(rotateDisplayLinkCommand, { eventId, sessionId }, ctx, ports))).toBe(
        'forbidden',
      );
    }
    expect(await codeOf(executeQuery(moderationQuery, { eventId, sessionId }, pub(), ports))).toBe(
      'forbidden',
    );
  });

  it('another org sees and changes nothing', async () => {
    const p = await executeCommand(
      createPollCommand,
      { eventId, sessionId, kind: 'single', question: 'Mine', options: ['A', 'B'] },
      a.ctx(),
      ports,
    );
    expect(await codeOf(executeCommand(openPollCommand, { eventId, pollId: p.id }, b.ctx(), ports))).toBe(
      'not_found',
    );
    expect(await codeOf(executeQuery(moderationQuery, { eventId, sessionId }, b.ctx(), ports))).toBe(
      'not_found',
    );
    expect(await codeOf(executeCommand(enableLiveCommand, { eventId, sessionId }, b.ctx(), ports))).toBe(
      'not_found',
    );
    await executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    // A vote sent "as" org B for org A's poll finds nothing.
    expect(
      await codeOf(
        executeCommand(
          voteCommand,
          { eventId, pollId: p.id, participantKey: visitor(1), optionIds: ['o1'] },
          pub(b),
          ports,
        ),
      ),
    ).toBe('not_found');
    expect(await publicLiveSession(b.org.id, eventId, sessionId)).toBeNull();
    // A channel naming org B with org A's event and session is not open.
    expect(await sessionChannelOpen(a.org.id, eventId, sessionId)).toBe(true);
    expect(await sessionChannelOpen(b.org.id, eventId, sessionId)).toBe(false);
  });

  it('a revoked sessions module refuses organizers and the audience alike', async () => {
    const p = await executeCommand(
      createPollCommand,
      { eventId, sessionId, kind: 'single', question: 'Module', options: ['A', 'B'] },
      a.ctx(),
      ports,
    );
    await executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    const override = (effect: 'revoke' | 'grant') =>
      executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'sessions', effect, reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    await override('revoke');
    try {
      expect(
        await codeOf(
          executeCommand(
            createPollCommand,
            { eventId, sessionId, kind: 'rating', question: 'x' },
            a.ctx(),
            ports,
          ),
        ),
      ).toBe('module_not_enabled');
      expect(
        await codeOf(
          executeCommand(
            voteCommand,
            { eventId, pollId: p.id, participantKey: visitor('m'), optionIds: ['o1'] },
            pub(),
            ports,
          ),
        ),
      ).toBe('module_not_enabled');
      expect(await codeOf(executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports))).toBe(
        'module_not_enabled',
      );
    } finally {
      await override('grant');
    }
  });

  it('the public takes part only in published, public events', async () => {
    const draft = await executeCommand(
      createEventCommand,
      {
        name: `Draft live ${uuidv7().slice(-6)}`,
        timezone: 'UTC',
        startsAt: '2031-03-01T10:00:00Z',
        endsAt: '2031-03-01T18:00:00Z',
      },
      a.ctx(),
      ports,
    );
    const s = await newSession(a, draft.id, 'Draft talk', new Date('2031-03-01T11:00:00Z'));
    await executeCommand(enableLiveCommand, { eventId: draft.id, sessionId: s }, a.ctx(), ports);
    expect(await publicLiveSession(a.org.id, draft.id, s)).toBeNull();
    expect(
      await codeOf(
        executeCommand(
          askQuestionCommand,
          { eventId: draft.id, sessionId: s, participantKey: visitor(1), body: 'Hello?', name: 'X' },
          pub(),
          ports,
        ),
      ),
    ).toBe('not_found');
    // The organizer can still prepare it.
    expect(
      (await executeQuery(moderationQuery, { eventId: draft.id, sessionId: s }, a.ctx(), ports)).enabled,
    ).toBe(true);
  });

  it('signed display links: valid until rotated; forged or foreign ones are refused', async () => {
    const page = await executeQuery(moderationQuery, { eventId, sessionId }, a.ctx(), ports);
    const v = page.settings?.displayVersion ?? 0;
    const token = signDisplayToken({ orgId: a.org.id, sessionId, version: v }, SECRET);
    expect(await displaySession(token, SECRET)).toEqual({ orgId: a.org.id, eventId, sessionId });
    expect(await displaySession(token, `${SECRET}x`)).toBeNull();
    // The same session under another org's id: no such session there.
    expect(
      await displaySession(signDisplayToken({ orgId: b.org.id, sessionId, version: v }, SECRET), SECRET),
    ).toBeNull();
    const rotated = await executeCommand(rotateDisplayLinkCommand, { eventId, sessionId }, a.ctx(), ports);
    expect(rotated.displayVersion).toBe(v + 1);
    expect(await displaySession(token, SECRET)).toBeNull();
    const fresh = signDisplayToken({ orgId: a.org.id, sessionId, version: v + 1 }, SECRET);
    expect(await displaySession(fresh, SECRET)).toEqual({ orgId: a.org.id, eventId, sessionId });
  });

  it('a big screen that drops its stream is replayed what it missed, in order (or gets a snapshot)', async () => {
    const channel = realtimeChannelName(LIVE_CHANNEL, a.org.id, eventId, sessionId);
    const [last] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ seq: number }>(
        sql`select max(seq)::bigint as seq from platform.realtime_messages where channel = ${channel}`,
      ),
    );
    const lastId = String(last?.seq);
    // While "offline": a question is asked, approved and upvoted; a poll opens and gets a vote.
    const body = `While offline ${uuidv7()}`;
    await executeCommand(
      askQuestionCommand,
      { eventId, sessionId, participantKey: visitor('off'), body, name: 'Off' },
      pub(),
      ports,
    );
    const [q] = await withTenant(systemCtx(a.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from engagement.questions where body = ${body}`),
    );
    const qid = q?.id ?? '';
    await executeCommand(
      moderateQuestionCommand,
      { eventId, questionId: qid, action: 'approve' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      upvoteQuestionCommand,
      { eventId, questionId: qid, participantKey: visitor('fan') },
      pub(),
      ports,
    );
    const p = await executeCommand(
      createPollCommand,
      { eventId, sessionId, kind: 'single', question: 'Offline poll', options: ['Yes', 'No'] },
      a.ctx(),
      ports,
    );
    await executeCommand(openPollCommand, { eventId, pollId: p.id }, a.ctx(), ports);
    await executeCommand(
      voteCommand,
      { eventId, pollId: p.id, participantKey: visitor('v'), optionIds: ['o1'] },
      pub(),
      ports,
    );
    const missed = await withTenant(systemCtx(a.org.id), (tx) => realtimeCatchUpTx(tx, channel, lastId));
    expect(missed?.map((m) => m.event)).toEqual(['question', 'question', 'poll', 'stage', 'poll']);
    expect(missed?.[1]?.data).toMatchObject({ id: qid, upvotes: 1 });
    expect(missed?.at(-1)?.data).toMatchObject({ id: p.id, ballots: 1, results: null });
    // Replaying them onto the old state equals the snapshot a fresh screen would get.
    const snap = await withTenant(systemCtx(a.org.id), (tx) => publicSnapshotTx(tx, sessionId));
    expect(snap.stage.livePollId).toBe(p.id);
    expect(snap.questions.find((x) => x.id === qid)).toMatchObject({ upvotes: 1 });
    // An unknown or pruned id gets no replay (the stream sends the snapshot instead).
    expect(await withTenant(systemCtx(a.org.id), (tx) => realtimeCatchUpTx(tx, channel, '1'))).toBeNull();
    const mod = await withTenant(systemCtx(a.org.id), (tx) => moderationSnapshotTx(tx, sessionId));
    expect(mod.polls.find((x) => x.id === p.id)?.results.total).toBe(1);
  });
});
