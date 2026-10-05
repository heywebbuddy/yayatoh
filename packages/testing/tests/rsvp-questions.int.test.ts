import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  guestListQuery,
  mealCountsQuery,
  menuQuery,
  partyHistoryQuery,
  publicRsvpQuestionsQuery,
  publishRsvpQuestionsCommand,
  removeMenuOptionCommand,
  removePartyGuestCommand,
  rsvpAnswersExportBulk,
  rsvpAnswersPrivateExportBulk,
  rsvpQuestionsQuery,
  saveMenuOptionCommand,
  submitRsvpCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { addMemberCommand } from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type OrgFixture,
  ports,
  type RsvpQuestionsScenario,
  rsvpQuestionsScenario,
  runBulk,
  staleCtx,
  standardRsvpQuestions,
  twoOrgs,
  userCtx,
} from '../src/index.ts';

/**
 * M4.1e: RSVP questions. Acceptance: conditional questions show and validate correctly in
 * fixtures; answers to hidden questions are rejected server-side; the meal choice lands on the
 * guest; dietary answers are sealed and never appear in logs, audit data or public payloads;
 * isolation, impersonation and freeze coverage.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:rsvp-questions')`;
  await admin.end();
  await closePools();
});

/** The party's page: the org comes from its link, nobody signed in. */
const guestCtx = (orgId: string, extra: Partial<Ctx> = {}) => createCtx({ orgId, ...extra });

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    const reason = (err.details as { reason?: string } | undefined)?.reason;
    return reason ? `${err.code}:${reason}` : err.code;
  }
}

async function detailsOf(p: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await p;
  } catch (err) {
    if (isDomainError(err)) return { code: err.code, ...(err.details as object) };
    throw err;
  }
  return { code: 'ok' };
}

const scenario = (f: OrgFixture, opts: { questions?: boolean } = {}) =>
  rsvpQuestionsScenario(f.org.id, { ctx: f.ctx(), ...opts });

/**
 * The Garcia household of three: Luis attends both, his plus-one is named Sam Lee and attends
 * both, Ana declines the ceremony (she is invited to nothing else).
 */
const household = (s: RsvpQuestionsScenario, questions: { guestId: string; answers: object }[]) => ({
  token: s.garcia.token,
  answers: [
    { guestId: s.luis, subEventId: s.ceremonyId, status: 'attending' as const },
    { guestId: s.plus, subEventId: s.ceremonyId, status: 'attending' as const },
    { guestId: s.ana, subEventId: s.ceremonyId, status: 'declined' as const },
    { guestId: s.luis, subEventId: s.receptionId, status: 'attending' as const },
    { guestId: s.plus, subEventId: s.receptionId, status: 'attending' as const },
  ],
  plusOnes: [{ guestId: s.plus, firstName: 'Sam', lastName: 'Lee' }],
  questions: questions as { guestId: string; answers: Record<string, unknown> }[],
});

const goodAnswers = (s: RsvpQuestionsScenario) => [
  { guestId: s.luis, answers: { meal: s.fish, dietary: 'No nuts, please', song: 'September' } },
  { guestId: s.plus, answers: { meal: s.veg } },
  { guestId: s.ana, answers: {} },
];

const guestsOf = async (f: OrgFixture, s: RsvpQuestionsScenario) => {
  const list = await executeQuery(guestListQuery, { eventId: s.eventId, limit: 50 }, f.ctx(), ports);
  return new Map(list.parties.flatMap((p) => p.guests).map((g) => [g.id, g]));
};

describe('menu (M4.1e)', () => {
  it('adds options with dietary notes, refuses a duplicate, renames onto guests, removes only unused ones', async () => {
    const s = await scenario(a, { questions: false });
    const menu = await executeQuery(menuQuery, { eventId: s.eventId }, a.ctx(), ports);
    expect(menu.map((m) => [m.label, m.notes])).toEqual([
      ['Fish', 'Contains shellfish'],
      ['Vegetarian', 'Vegan on request'],
    ]);
    expect(
      await codeOf(
        executeCommand(saveMenuOptionCommand, { eventId: s.eventId, label: ' fish ' }, a.ctx(), ports),
      ),
    ).toBe('conflict:menu_label_taken');
    // A guest chose Fish: the option can't go, and a rename follows onto the guest.
    await admin`update guests.guests set meal = 'Fish' where id = ${s.luis}`;
    expect(
      await codeOf(
        executeCommand(removeMenuOptionCommand, { eventId: s.eventId, optionId: s.fish }, a.ctx(), ports),
      ),
    ).toBe('invalid_state:menu_option_in_use');
    await executeCommand(
      saveMenuOptionCommand,
      { eventId: s.eventId, optionId: s.fish, label: 'Sea bass', notes: null },
      a.ctx(),
      ports,
    );
    expect((await guestsOf(a, s)).get(s.luis)?.meal).toBe('Sea bass');
    const history = await executeQuery(
      partyHistoryQuery,
      { eventId: s.eventId, partyId: s.garcia.id },
      a.ctx(),
      ports,
    );
    expect(history[0]).toMatchObject({ action: 'guest_updated', fields: ['meal'], guestId: s.luis });
    await executeCommand(removeMenuOptionCommand, { eventId: s.eventId, optionId: s.veg }, a.ctx(), ports);
    expect(
      (await executeQuery(menuQuery, { eventId: s.eventId }, a.ctx(), ports)).map((m) => m.label),
    ).toEqual(['Sea bass']);
  });
});

describe('publishing questions (M4.1e)', () => {
  it('versions the questions; refuses foreign sub-events, a meal with no menu and a stale editor', async () => {
    const s = await scenario(a, { questions: false });
    const def = standardRsvpQuestions(s);
    expect((await executeQuery(rsvpQuestionsQuery, { eventId: s.eventId }, a.ctx(), ports)).version).toBe(0);
    const r = await executeCommand(
      publishRsvpQuestionsCommand,
      { eventId: s.eventId, definition: def, expectedVersion: 0 },
      a.ctx(),
      ports,
    );
    expect(r.version).toBe(1);
    const q = await executeQuery(rsvpQuestionsQuery, { eventId: s.eventId }, a.ctx(), ports);
    expect(q.definition.questions.map((x) => [x.key, x.subEventId])).toEqual([
      ['meal', s.receptionId],
      ['dietary', null],
      ['song', s.ceremonyId],
    ]);
    expect(
      await codeOf(
        executeCommand(
          publishRsvpQuestionsCommand,
          { eventId: s.eventId, definition: def, expectedVersion: 0 },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('conflict:stale_version');
    const other = await scenario(a, { questions: false });
    expect(
      await codeOf(
        executeCommand(
          publishRsvpQuestionsCommand,
          { eventId: other.eventId, definition: def },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:unknown_sub_event');
    await executeCommand(
      removeMenuOptionCommand,
      { eventId: other.eventId, optionId: other.fish },
      a.ctx(),
      ports,
    );
    await executeCommand(
      removeMenuOptionCommand,
      { eventId: other.eventId, optionId: other.veg },
      a.ctx(),
      ports,
    );
    expect(
      await codeOf(
        executeCommand(
          publishRsvpQuestionsCommand,
          { eventId: other.eventId, definition: standardRsvpQuestions(other) },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed:menu_empty');
    // A condition on a later question, or an unknown operator, never reaches the engine.
    expect(
      await codeOf(
        executeCommand(
          publishRsvpQuestionsCommand,
          {
            eventId: s.eventId,
            definition: {
              questions: [
                { key: 'x', type: 'short_text', label: 'X', showIf: { '==': [{ var: 'y' }, 'a'] } },
                { key: 'y', type: 'short_text', label: 'Y' },
              ],
            },
          },
          a.ctx(),
          ports,
        ),
      ),
    ).toBe('validation_failed');
  });
});

describe('the household answers (M4.1e)', () => {
  it('conditional questions per guest: the page payload has no private answers and no foreign guests', async () => {
    const s = await scenario(a);
    const view = await executeQuery(
      publicRsvpQuestionsQuery,
      { token: s.garcia.token },
      guestCtx(a.org.id),
      ports,
    );
    expect(view.questions.map((q) => q.key)).toEqual(['meal', 'dietary', 'song']);
    expect(view.menu.map((m) => [m.label, m.notes])).toEqual([
      ['Fish', 'Contains shellfish'],
      ['Vegetarian', 'Vegan on request'],
    ]);
    expect(view.guests.map((g) => g.guestId).sort()).toEqual([s.luis, s.plus, s.ana].sort());
    expect(view.guests.find((g) => g.guestId === s.plus)).toMatchObject({ isPlusOne: true, named: false });
    expect(JSON.stringify(view)).not.toMatch(/binding|Mei/);
  });

  it('a household of three, one declining: meal on the guest, dietary sealed, answers stored, counts', async () => {
    const s = await scenario(a);
    await executeCommand(submitRsvpCommand, household(s, goodAnswers(s)), guestCtx(a.org.id), ports);
    const g = await guestsOf(a, s);
    expect(g.get(s.luis)).toMatchObject({ meal: 'Fish', dietary: 'No nuts, please' });
    expect(g.get(s.plus)).toMatchObject({ firstName: 'Sam', meal: 'Vegetarian', dietary: null });
    expect(g.get(s.ana)).toMatchObject({ meal: null, dietary: null });

    // Sealed: the dietary answer is nowhere in plaintext (guest row, responses, history, audit, outbox).
    const plain = await admin<{ n: number }[]>`
      select (
        (select count(*) from guests.guests where org_id = ${a.org.id} and (meal like '%nuts%' or private_ciphertext like '%nuts%'))
        + (select count(*) from forms.form_responses where org_id = ${a.org.id} and (answers::text like '%nuts%' or sensitive_ciphertext like '%nuts%'))
        + (select count(*) from guests.rsvp_history where org_id = ${a.org.id} and (detail::text like '%nuts%' or array_to_string(fields, ',') like '%nuts%'))
        + (select count(*) from platform.audit_events where org_id = ${a.org.id} and data::text like '%nuts%')
        + (select count(*) from platform.domain_events where payload::text like '%nuts%')
      )::int as n`;
    expect(plain[0]?.n).toBe(0);
    const stored = await admin<{ respondent_id: string; answers: Record<string, unknown> }[]>`
      select respondent_id, answers from forms.form_responses
      where org_id = ${a.org.id} and respondent_type = 'guest' and respondent_id in ${admin([s.luis, s.plus, s.ana])}`;
    expect(stored).toEqual([{ respondent_id: s.luis, answers: { song: 'September' } }]);

    // The page shows the meal back, never the dietary answer (only that it was given).
    const view = await executeQuery(
      publicRsvpQuestionsQuery,
      { token: s.garcia.token },
      guestCtx(a.org.id),
      ports,
    );
    const luis = view.guests.find((x) => x.guestId === s.luis);
    expect(luis?.values).toEqual({ song: 'September', meal: s.fish });
    expect(luis?.kept).toEqual(['dietary']);
    expect(JSON.stringify(view)).not.toContain('nuts');

    // History names fields only.
    const history = await executeQuery(
      partyHistoryQuery,
      { eventId: s.eventId, partyId: s.garcia.id },
      a.ctx(),
      ports,
    );
    expect(
      history.find((h) => h.guestId === s.luis && h.source === 'rsvp' && h.action === 'guest_updated'),
    ).toMatchObject({ fields: ['meal', 'dietary', 'rsvpAnswers'] });

    const counts = await executeQuery(mealCountsQuery, { eventId: s.eventId }, a.ctx(), ports);
    expect(counts.mealQuestion).toEqual({ key: 'meal', subEventId: s.receptionId });
    expect(counts.subEvents).toEqual([
      {
        subEventId: s.receptionId,
        name: 'Reception',
        attending: 2,
        counts: [
          { optionId: s.fish, count: 1 },
          { optionId: s.veg, count: 1 },
        ],
        other: 0,
        none: 0,
      },
    ]);

    // Answering again: Luis switches to vegetarian and leaves dietary blank (kept, never shown).
    await executeCommand(
      submitRsvpCommand,
      household(s, [
        { guestId: s.luis, answers: { meal: s.veg, dietary: '' } },
        { guestId: s.plus, answers: { meal: s.veg } },
      ]),
      guestCtx(a.org.id),
      ports,
    );
    const again = await guestsOf(a, s);
    expect(again.get(s.luis)).toMatchObject({ meal: 'Vegetarian', dietary: 'No nuts, please' });
    const after = await executeQuery(mealCountsQuery, { eventId: s.eventId }, a.ctx(), ports);
    expect(after.subEvents[0]?.counts).toEqual([
      { optionId: s.fish, count: 0 },
      { optionId: s.veg, count: 2 },
    ]);
  });

  it('answers to hidden questions are rejected, naming the guest and the question; nothing is written', async () => {
    const s = await scenario(a);
    const reject = (questions: { guestId: string; answers: object }[]) =>
      detailsOf(executeCommand(submitRsvpCommand, household(s, questions), guestCtx(a.org.id), ports));
    // Ana declined (and isn't invited to the reception): no meal, no song.
    expect(await reject([...goodAnswers(s), { guestId: s.ana, answers: { meal: s.fish } }])).toMatchObject({
      code: 'validation_failed',
      reason: 'hidden_answer',
      guestId: s.ana,
      question: 'meal',
    });
    expect(
      await reject([...goodAnswers(s).slice(0, 2), { guestId: s.ana, answers: { song: 'x' } }]),
    ).toMatchObject({
      reason: 'hidden_answer',
      guestId: s.ana,
      question: 'song',
    });
    // Luis declining the reception can't choose a meal.
    const declined = household(s, goodAnswers(s));
    const luisReception = declined.answers.find(
      (x) => x.guestId === s.luis && x.subEventId === s.receptionId,
    );
    if (luisReception) luisReception.status = 'declined';
    expect(
      await detailsOf(executeCommand(submitRsvpCommand, declined, guestCtx(a.org.id), ports)),
    ).toMatchObject({ reason: 'hidden_answer', guestId: s.luis, question: 'meal' });
    // Required, unknown, not a menu option, someone else's guest.
    expect(await reject([{ guestId: s.luis, answers: {} }])).toMatchObject({
      reason: 'question_required',
      guestId: s.luis,
      question: 'meal',
    });
    expect(await reject([{ guestId: s.luis, answers: { meal: s.fish, nope: 'x' } }])).toMatchObject({
      reason: 'unknown_question',
      question: 'nope',
    });
    expect(
      await reject([
        { guestId: s.luis, answers: { meal: uuidv7() } },
        { guestId: s.plus, answers: { meal: s.veg } },
      ]),
    ).toMatchObject({
      reason: 'choose',
      question: 'meal',
    });
    expect(await reject([...goodAnswers(s), { guestId: s.mei, answers: {} }])).toMatchObject({
      code: 'not_found',
      reason: 'not_in_party',
    });
    // Nothing was written by any refused submission.
    const g = await guestsOf(a, s);
    expect(g.get(s.luis)).toMatchObject({ meal: null, dietary: null });
    expect(g.get(s.plus)?.firstName).toBeNull();
  });

  it('an unnamed plus-one gets no questions; naming them on the page brings theirs', async () => {
    const s = await scenario(a);
    const q = household(s, goodAnswers(s));
    // Declining with no name: the plus-one sees nothing, so an answer for them is hidden.
    q.plusOnes = [];
    for (const x of q.answers) if (x.guestId === s.plus) x.status = 'declined';
    q.questions = [
      goodAnswers(s)[0] as { guestId: string; answers: Record<string, unknown> },
      { guestId: s.plus, answers: { dietary: 'x' } },
    ];
    expect(await detailsOf(executeCommand(submitRsvpCommand, q, guestCtx(a.org.id), ports))).toMatchObject({
      reason: 'hidden_answer',
      guestId: s.plus,
    });
    q.questions = [goodAnswers(s)[0] as { guestId: string; answers: Record<string, unknown> }];
    expect(await codeOf(executeCommand(submitRsvpCommand, q, guestCtx(a.org.id), ports))).toBe('ok');
  });
});

const params = {
  headers: {
    party: 'Party',
    guest: 'Guest',
    age: 'Age',
    meal: 'Meal',
    dietary: 'Dietary',
    accessibility: 'Accessibility',
  },
  statuses: { attending: 'Attending', declined: 'Declined', awaiting: 'Awaiting', notInvited: '—' },
  ages: { adult: 'Adult', child: 'Child', infant: 'Infant' },
  yes: 'Yes',
  no: 'No',
};

describe('answers export (M4.1e)', () => {
  it('step-up; private columns only for roles allowed to see them; audited with counts only', async () => {
    const s = await scenario(a);
    await executeCommand(submitRsvpCommand, household(s, goodAnswers(s)), guestCtx(a.org.id), ports);
    const start = { eventId: s.eventId, selection: { filter: {} }, params };
    expect(await codeOf(executeCommand(rsvpAnswersExportBulk.start, start, staleCtx(a.ctx()), ports))).toBe(
      'step_up_required',
    );
    expect(
      await codeOf(executeCommand(rsvpAnswersExportBulk.start, start, userCtx(a.viewerId, a.org.id), ports)),
    ).toBe('forbidden');
    expect(await codeOf(executeCommand(rsvpAnswersExportBulk.start, start, b.ctx(), ports))).toBe(
      'not_found',
    );
    const manager = uuidv7();
    await executeCommand(addMemberCommand, { userId: manager, role: 'manager' }, a.ctx(), ports);
    expect(
      await codeOf(
        executeCommand(rsvpAnswersPrivateExportBulk.start, start, userCtx(manager, a.org.id), ports),
      ),
    ).toBe('forbidden');

    const plain = await executeCommand(rsvpAnswersExportBulk.start, start, userCtx(manager, a.org.id), ports);
    expect(plain.total).toBe(4);
    expect(await runBulk(a.org.id, plain.operationId)).toBe('done');
    const file = await executeQuery(
      rsvpAnswersExportBulk.file,
      { operationId: plain.operationId },
      userCtx(manager, a.org.id),
      ports,
    );
    expect(file.name).toMatch(/^rsvp-answers-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = file.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(lines[0]).toBe('Party,Guest,Age,Ceremony,Reception,Meal,Ceremony: song request');
    expect(lines).toContain('Garcia,Luis López,Adult,Attending,Attending,Fish,September');
    expect(lines).toContain('Garcia,Sam Lee,Adult,Attending,Attending,Vegetarian,');
    expect(lines).toContain('Garcia,Ana García,Adult,Declined,—,,');
    expect(file.content).not.toContain('nuts');

    const priv = await executeCommand(rsvpAnswersPrivateExportBulk.start, start, a.ctx(), ports);
    expect(await runBulk(a.org.id, priv.operationId)).toBe('done');
    const pf = await executeQuery(
      rsvpAnswersPrivateExportBulk.file,
      { operationId: priv.operationId },
      a.ctx(),
      ports,
    );
    const plines = pf.content.replace(/^﻿/, '').trimEnd().split('\r\n');
    expect(plines[0]).toBe(
      'Party,Guest,Age,Ceremony,Reception,Meal,Ceremony: song request,Dietary,Accessibility',
    );
    expect(plines).toContain('Garcia,Luis López,Adult,Attending,Attending,Fish,September,"No nuts, please",');
    const audits = await admin<{ data: Record<string, unknown> }[]>`
      select data from platform.audit_events where org_id = ${a.org.id} and action = 'bulk.start'
        and target_id in ${admin([plain.operationId, priv.operationId])}`;
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain('nuts');
  });
});

describe('RSVP questions: isolation, permissions, impersonation, freeze', () => {
  it('another org’s event, menu and link are unknown here', async () => {
    const sb = await scenario(b);
    for (const run of [
      () => executeQuery(rsvpQuestionsQuery, { eventId: sb.eventId }, a.ctx(), ports),
      () => executeQuery(mealCountsQuery, { eventId: sb.eventId }, a.ctx(), ports),
      () => executeQuery(menuQuery, { eventId: sb.eventId }, a.ctx(), ports),
      () =>
        executeCommand(
          publishRsvpQuestionsCommand,
          { eventId: sb.eventId, definition: { questions: [] } },
          a.ctx(),
          ports,
        ),
      () => executeCommand(saveMenuOptionCommand, { eventId: sb.eventId, label: 'Steak' }, a.ctx(), ports),
      () =>
        executeCommand(removeMenuOptionCommand, { eventId: sb.eventId, optionId: sb.fish }, a.ctx(), ports),
      () => executeQuery(publicRsvpQuestionsQuery, { token: sb.garcia.token }, guestCtx(a.org.id), ports),
    ])
      expect((await codeOf(run())).startsWith('not_found')).toBe(true);
    const rows = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.menu_options where org_id = ${b.org.id} and event_id = ${sb.eventId}`;
    expect(rows[0]?.n).toBe(2);
  });

  it('viewers read questions and counts but cannot edit; the public can’t read the host side', async () => {
    const s = await scenario(a);
    const viewer = userCtx(a.viewerId, a.org.id);
    expect((await executeQuery(rsvpQuestionsQuery, { eventId: s.eventId }, viewer, ports)).version).toBe(1);
    await executeQuery(mealCountsQuery, { eventId: s.eventId }, viewer, ports);
    for (const run of [
      () =>
        executeCommand(
          publishRsvpQuestionsCommand,
          { eventId: s.eventId, definition: standardRsvpQuestions(s) },
          viewer,
          ports,
        ),
      () => executeCommand(saveMenuOptionCommand, { eventId: s.eventId, label: 'Steak' }, viewer, ports),
      () => executeCommand(removeMenuOptionCommand, { eventId: s.eventId, optionId: s.veg }, viewer, ports),
      () => executeQuery(rsvpQuestionsQuery, { eventId: s.eventId }, guestCtx(a.org.id), ports),
      () => executeQuery(mealCountsQuery, { eventId: s.eventId }, guestCtx(a.org.id), ports),
    ])
      expect(await codeOf(run())).toBe('forbidden');
  });

  it('staff acting as a member edit questions and the menu, but cannot remove options or export', async () => {
    const s = await scenario(a);
    const acting = a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } });
    expect(publishRsvpQuestionsCommand.category).toBeUndefined();
    expect(saveMenuOptionCommand.category).toBeUndefined();
    expect(removeMenuOptionCommand.category).toBe('delete');
    expect(rsvpAnswersExportBulk.start.category).toBe('export');
    await executeCommand(
      publishRsvpQuestionsCommand,
      { eventId: s.eventId, definition: standardRsvpQuestions(s) },
      acting,
      ports,
    );
    await executeCommand(saveMenuOptionCommand, { eventId: s.eventId, label: 'Steak' }, acting, ports);
    expect(
      await codeOf(
        executeCommand(removeMenuOptionCommand, { eventId: s.eventId, optionId: s.veg }, acting, ports),
      ),
    ).toMatch(/^impersonation_blocked/);
    expect(
      await codeOf(
        executeCommand(
          rsvpAnswersExportBulk.start,
          { eventId: s.eventId, selection: { filter: {} }, params },
          acting,
          ports,
        ),
      ),
    ).toMatch(/^impersonation_blocked/);
  });

  it('a read-only freeze refuses every write; the page and counts still read', async () => {
    const s = await scenario(a);
    await admin`select platform.set_ops_flag('read_only_freeze', ${JSON.stringify({ scope: 'orgs', orgIds: [a.org.id] })}::text::jsonb, 'test', 'test:rsvp-questions')`;
    try {
      for (const run of [
        () => executeCommand(submitRsvpCommand, household(s, goodAnswers(s)), guestCtx(a.org.id), ports),
        () =>
          executeCommand(
            publishRsvpQuestionsCommand,
            { eventId: s.eventId, definition: standardRsvpQuestions(s) },
            a.ctx(),
            ports,
          ),
        () => executeCommand(saveMenuOptionCommand, { eventId: s.eventId, label: 'Steak' }, a.ctx(), ports),
        () =>
          executeCommand(removeMenuOptionCommand, { eventId: s.eventId, optionId: s.veg }, a.ctx(), ports),
      ])
        expect((await codeOf(run())).startsWith('read_only_freeze')).toBe(true);
      expect(
        (await executeQuery(publicRsvpQuestionsQuery, { token: s.garcia.token }, guestCtx(a.org.id), ports))
          .questions,
      ).toHaveLength(3);
      await executeQuery(mealCountsQuery, { eventId: s.eventId }, a.ctx(), ports);
    } finally {
      await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:rsvp-questions')`;
    }
  });

  it('removing a guest removes their answers', async () => {
    const s = await scenario(a);
    await executeCommand(submitRsvpCommand, household(s, goodAnswers(s)), guestCtx(a.org.id), ports);
    await executeCommand(removePartyGuestCommand, { eventId: s.eventId, guestId: s.luis }, a.ctx(), ports);
    const rows = await admin<{ n: number }[]>`
      select count(*)::int as n from forms.form_responses where org_id = ${a.org.id} and respondent_id = ${s.luis}`;
    expect(rows[0]?.n).toBe(0);
  });
});
