import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  addOccurrencesCommand,
  assignEventRoleCommand,
  createEventCommand,
  type EventDto,
  listOccurrencesQuery,
} from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createSubEventCommand,
  type InviteTarget,
  invitationMatrixQuery,
  moveSubEventCommand,
  recordSubEventResponseCommand,
  removePartyGuestCommand,
  removeSubEventCommand,
  setInvitationsCommand,
  subEventHistoryQuery,
  subEventsQuery,
  updateSubEventCommand,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  giveDateOwnChartCommand,
  giveSubEventOwnChartCommand,
  removeSubEventChartCommand,
  saveLayoutCommand,
  setEventLayoutCommand,
  subEventChartsQuery,
} from '@yayatoh/seating';
import { addMemberCommand } from '@yayatoh/tenancy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.1c: sub-events and invitations. The acceptance criterion: a guest not invited to a
 * sub-event cannot have a response to it; the command refuses even when called directly.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

const wedding = (f: OrgFixture, name: string) =>
  executeCommand(
    createEventCommand,
    {
      name,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-02T04:00:00Z',
    },
    f.ctx(),
    ports,
  );

const at = (h: number) => new Date(Date.UTC(2030, 5, 1, 20 + h)).toISOString();

async function sub(f: OrgFixture, ev: EventDto, name: string, extra: object = {}) {
  return executeCommand(
    createSubEventCommand,
    { eventId: ev.id, name, kind: 'custom', startsAt: at(0), endsAt: at(1), ...extra },
    f.ctx(),
    ports,
  );
}

/** A wedding with two parties: Garcia (Luis with a plus-one, and Ana) and Chen (Mei, Groom's side). */
async function list(f: OrgFixture, name: string) {
  const ev = await wedding(f, `${name} ${f.org.slug}`);
  const garcia = await executeCommand(
    createPartyCommand,
    { eventId: ev.id, name: 'Garcia', side: 'Bride', vip: true, tags: ['Family'] },
    f.ctx(),
    ports,
  );
  const chen = await executeCommand(
    createPartyCommand,
    { eventId: ev.id, name: 'Chen', side: 'Groom' },
    f.ctx(),
    ports,
  );
  const add = (partyId: string, firstName: string) =>
    executeCommand(addPartyGuestCommand, { eventId: ev.id, partyId, firstName }, f.ctx(), ports);
  const luis = await add(garcia.id, 'Luis');
  const ana = await add(garcia.id, 'Ana');
  const mei = await add(chen.id, 'Mei');
  const plus = await executeCommand(
    addPlusOneCommand,
    { eventId: ev.id, hostGuestId: luis.id },
    f.ctx(),
    ports,
  );
  return { ev, garcia, chen, luis, ana, mei, plus };
}

const invite = (
  f: OrgFixture,
  eventId: string,
  subEventIds: string[],
  target: InviteTarget,
  invited = true,
) => executeCommand(setInvitationsCommand, { eventId, subEventIds, target, invited }, f.ctx(), ports);

const respond = (
  f: OrgFixture,
  eventId: string,
  guestId: string,
  subEventId: string,
  status: 'attending' | 'declined' | null,
  ctx = f.ctx(),
) =>
  executeCommand(
    recordSubEventResponseCommand,
    { eventId, guestId, subEventId, status, source: 'paper' },
    ctx,
    ports,
  );

const historyRows = (eventId: string) =>
  admin<
    {
      action: string;
      sub_event_id: string | null;
      guest_id: string | null;
      source: string;
      fields: string[];
    }[]
  >`
    select action, sub_event_id, guest_id, source, fields from guests.rsvp_history
    where event_id = ${eventId} and sub_event_id is not null order by created_at, id`;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('sub-events and invitations (M4.1c)', () => {
  it('an uninvited guest cannot have a response: the command refuses when called directly', async () => {
    const { ev, luis, mei, plus } = await list(a, 'Refuse');
    const ceremony = await sub(a, ev, 'Ceremony', { kind: 'ceremony' });
    const reception = await sub(a, ev, 'Reception', { kind: 'reception' });
    await invite(a, ev.id, [reception.id], { kind: 'guests', guestIds: [luis.id] });

    // Not invited to the ceremony; Mei not invited to the reception.
    await expect(respond(a, ev.id, luis.id, ceremony.id, 'attending')).rejects.toMatchObject({
      code: 'invalid_state',
      details: { reason: 'not_invited' },
    });
    await expect(respond(a, ev.id, mei.id, reception.id, 'declined')).rejects.toMatchObject({
      details: { reason: 'not_invited' },
    });
    // Invited: recorded, with the source. The plus-one follows the host's invitation.
    expect(await respond(a, ev.id, luis.id, reception.id, 'attending')).toEqual({ status: 'attending' });
    expect(await respond(a, ev.id, plus.id, reception.id, 'declined')).toEqual({ status: 'declined' });
    const [row] = await admin<{ status: string; source: string }[]>`
      select status, source from guests.sub_event_responses where guest_id = ${luis.id}`;
    expect(row).toEqual({ status: 'attending', source: 'paper' });
    // Nothing was written for the refused attempts.
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.sub_event_responses where event_id = ${ev.id}`;
    expect(n?.n).toBe(2);
    const summary = await executeQuery(subEventsQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(summary.map((s) => [s.name, s.invited, s.attending, s.declined])).toEqual([
      ['Ceremony', 0, 0, 0],
      ['Reception', 2, 1, 1],
    ]);
  });

  it('uninviting clears the response (and the plus-one’s), with history', async () => {
    const { ev, luis, plus } = await list(a, 'Uninvite');
    const reception = await sub(a, ev, 'Reception');
    await invite(a, ev.id, [reception.id], { kind: 'guests', guestIds: [luis.id] });
    await respond(a, ev.id, luis.id, reception.id, 'attending');
    await respond(a, ev.id, plus.id, reception.id, 'attending');
    const r = await invite(a, ev.id, [reception.id], { kind: 'guests', guestIds: [luis.id] }, false);
    expect(r).toEqual({ added: 0, removed: 1, responsesCleared: 2 });
    const [n] = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.sub_event_responses where sub_event_id = ${reception.id}`;
    expect(n?.n).toBe(0);
    const h = await historyRows(ev.id);
    expect(h.map((x) => x.action)).toEqual([
      'sub_event_created',
      'invitation_added',
      'response_recorded',
      'response_recorded',
      'invitation_removed',
      'response_cleared',
      'response_cleared',
    ]);
    expect(h.find((x) => x.action === 'response_recorded')).toMatchObject({
      source: 'paper',
      fields: ['status'],
    });
    // Field names only: no values anywhere in the history.
    expect(JSON.stringify(h)).not.toMatch(/attending|declined/);
    const viaQuery = await executeQuery(
      subEventHistoryQuery,
      { eventId: ev.id, subEventId: reception.id },
      a.ctx(),
      ports,
    );
    expect(viaQuery).toHaveLength(7);
    // Invited again, recorded again.
    await invite(a, ev.id, [reception.id], { kind: 'guests', guestIds: [luis.id] });
    expect(await respond(a, ev.id, luis.id, reception.id, 'declined')).toEqual({ status: 'declined' });
    expect(await respond(a, ev.id, luis.id, reception.id, null)).toEqual({ status: null });
  });

  it('bulk: a whole party, a filter, everyone; plus-ones follow; "everyone invited" includes parties added later', async () => {
    const { ev, garcia, luis, ana, mei, plus } = await list(a, 'Bulk');
    const ceremony = await sub(a, ev, 'Ceremony');
    const dinner = await sub(a, ev, 'Rehearsal dinner', { kind: 'rehearsal_dinner' });
    const reception = await sub(a, ev, 'Reception');
    await invite(a, ev.id, [dinner.id], { kind: 'parties', partyIds: [garcia.id] });
    await invite(a, ev.id, [reception.id], { kind: 'filter', side: 'groom' });
    const m = await executeQuery(invitationMatrixQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(new Set(m.invited[dinner.id])).toEqual(new Set([luis.id, ana.id, plus.id]));
    expect(m.invited[reception.id]).toEqual([mei.id]);
    // A plus-one can't be picked on their own.
    await expect(
      invite(a, ev.id, [reception.id], { kind: 'guests', guestIds: [plus.id] }),
    ).rejects.toMatchObject({ details: { reason: 'plus_one_follows_host' } });
    // Everyone invited to the ceremony, including a party added afterwards.
    await executeCommand(
      updateSubEventCommand,
      {
        eventId: ev.id,
        subEventId: ceremony.id,
        name: 'Ceremony',
        startsAt: at(0),
        endsAt: at(1),
        inviteAll: true,
      },
      a.ctx(),
      ports,
    );
    const late = await executeCommand(createPartyCommand, { eventId: ev.id, name: 'Late' }, a.ctx(), ports);
    const zoe = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: late.id, firstName: 'Zoe' },
      a.ctx(),
      ports,
    );
    expect(await respond(a, ev.id, zoe.id, ceremony.id, 'attending')).toEqual({ status: 'attending' });
    // Toggling cells of an "everyone" sub-event is refused until it is turned off…
    await expect(
      invite(a, ev.id, [ceremony.id], { kind: 'guests', guestIds: [mei.id] }, false),
    ).rejects.toMatchObject({ details: { reason: 'everyone_invited' } });
    // …and turning it off keeps everyone invited (and Zoe's response).
    await executeCommand(
      updateSubEventCommand,
      {
        eventId: ev.id,
        subEventId: ceremony.id,
        name: 'Ceremony',
        startsAt: at(0),
        endsAt: at(1),
        inviteAll: false,
      },
      a.ctx(),
      ports,
    );
    const after = await executeQuery(invitationMatrixQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.invited[ceremony.id]).toHaveLength(5);
    expect(await respond(a, ev.id, zoe.id, ceremony.id, 'declined')).toEqual({ status: 'declined' });
    // Everyone, repeated: a no-op.
    expect(await invite(a, ev.id, [ceremony.id], { kind: 'all' })).toMatchObject({ added: 0, removed: 0 });
    // The filter view narrows the matrix; the counts stay for the whole event.
    const vip = await executeQuery(invitationMatrixQuery, { eventId: ev.id, vip: true }, a.ctx(), ports);
    expect(vip.parties.map((p) => p.name)).toEqual(['Garcia']);
    expect(vip.parties[0]?.guests.map((g) => g.id)).toEqual([luis.id, plus.id, ana.id]);
    expect(vip.subEvents.find((s) => s.id === ceremony.id)?.invited).toBe(5);
    expect(vip.totalParties).toBe(3);
    // Removing a guest takes their invitations and responses with them.
    await executeCommand(removePartyGuestCommand, { eventId: ev.id, guestId: zoe.id }, a.ctx(), ports);
    const [left] = await admin<{ n: number }[]>`
      select (select count(*) from guests.invitations where guest_id = ${zoe.id})
           + (select count(*) from guests.sub_event_responses where guest_id = ${zoe.id}) as n`;
    expect(Number(left?.n)).toBe(0);
  });

  it('sub-events: create, edit, reorder, remove (refused while responses exist unless confirmed)', async () => {
    const { ev, luis } = await list(a, 'Program');
    await expect(
      executeCommand(
        createSubEventCommand,
        { eventId: ev.id, name: 'Backwards', startsAt: at(2), endsAt: at(1) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(
        createSubEventCommand,
        { eventId: ev.id, name: '', startsAt: at(0), endsAt: at(1) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const one = await sub(a, ev, 'One');
    const two = await sub(a, ev, 'Two', { place: 'The barn' });
    // Saving unchanged values records nothing; a changed time records only that field.
    const same = {
      eventId: ev.id,
      subEventId: two.id,
      name: 'Two',
      startsAt: at(0),
      endsAt: at(1),
      place: 'The barn',
    };
    await executeCommand(updateSubEventCommand, same, a.ctx(), ports);
    await executeCommand(updateSubEventCommand, { ...same, endsAt: at(2) }, a.ctx(), ports);
    expect(
      (await historyRows(ev.id)).filter((x) => x.sub_event_id === two.id).map((x) => [x.action, x.fields]),
    ).toEqual([
      ['sub_event_created', ['name', 'startsAt', 'endsAt', 'place']],
      ['sub_event_updated', ['endsAt']],
    ]);
    const three = await sub(a, ev, 'Three');
    expect([one.position, two.position, three.position]).toEqual([0, 1, 2]);
    await executeCommand(
      moveSubEventCommand,
      { eventId: ev.id, subEventId: three.id, direction: 'up' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        moveSubEventCommand,
        { eventId: ev.id, subEventId: one.id, direction: 'up' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'cannot_move' } });
    let order = await executeQuery(subEventsQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(order.map((s) => s.name)).toEqual(['One', 'Three', 'Two']);
    await invite(a, ev.id, [two.id], { kind: 'all' });
    await respond(a, ev.id, luis.id, two.id, 'attending');
    await expect(
      executeCommand(removeSubEventCommand, { eventId: ev.id, subEventId: two.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'has_responses', responses: 1 } });
    expect(
      await executeCommand(
        removeSubEventCommand,
        { eventId: ev.id, subEventId: two.id, confirm: true },
        a.ctx(),
        ports,
      ),
    ).toEqual({ removed: true, responses: 1 });
    // Without responses, no confirmation needed; positions close up.
    await executeCommand(removeSubEventCommand, { eventId: ev.id, subEventId: one.id }, a.ctx(), ports);
    order = await executeQuery(subEventsQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(order.map((s) => [s.name, s.position])).toEqual([['Three', 0]]);
    // History stays after removal: the cleared response and the removal are recorded.
    const h = await historyRows(ev.id);
    expect(h.filter((x) => x.sub_event_id === two.id).map((x) => x.action)).toEqual(
      expect.arrayContaining([
        'sub_event_created',
        'response_recorded',
        'response_cleared',
        'sub_event_removed',
      ]),
    );
    expect(h.find((x) => x.action === 'sub_event_moved')?.fields).toEqual(['position']);
  });

  it('a sub-event linked to a date resolves that date’s chart; its own chart wins; then the event plan', async () => {
    const { ev } = await list(a, 'Charts');
    const doc = quickLayout({ rows: 0, seatsPerRow: 0, tables: 2, seatsPerTable: 8, stage: false });
    await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, a.ctx(), ports);
    await executeCommand(
      addOccurrencesCommand,
      {
        eventId: ev.id,
        dates: [
          { startsAt: '2030-06-01T20:00:00Z', endsAt: '2030-06-02T04:00:00Z' },
          { startsAt: '2030-06-02T20:00:00Z', endsAt: '2030-06-03T04:00:00Z' },
        ],
      },
      a.ctx(),
      ports,
    );
    const [d1, d2] = await executeQuery(listOccurrencesQuery, { eventId: ev.id }, a.ctx(), ports);
    if (!d1 || !d2) throw new Error('dates');
    await executeCommand(giveDateOwnChartCommand, { eventId: ev.id, occurrenceId: d2.id }, a.ctx(), ports);
    // An unknown date of another event is refused on the sub-event.
    const otherEv = await wedding(a, `Other ${a.org.slug}`);
    await expect(sub(a, otherEv, 'Wrong date', { occurrenceId: d1.id })).rejects.toMatchObject({
      code: 'validation_failed',
      details: { field: 'occurrenceId' },
    });
    const ceremony = await sub(a, ev, 'Ceremony', { occurrenceId: d1.id });
    const reception = await sub(a, ev, 'Reception', { occurrenceId: d2.id });
    const loose = await sub(a, ev, 'Brunch');
    const refs = [ceremony, reception, loose].map((s) => ({ id: s.id, occurrenceId: s.occurrenceId }));
    const resolve = () =>
      executeQuery(subEventChartsQuery, { eventId: ev.id, subEvents: refs }, a.ctx(), ports);
    expect((await resolve()).map((c) => [c.source, c.chartKey])).toEqual([
      ['event', null],
      ['date', d2.id],
      ['event', null],
    ]);
    // The ceremony gets its own chart (rows), copied from a drawing; it wins over the date's.
    const rows = quickLayout({ rows: 3, seatsPerRow: 4, tables: 0, seatsPerTable: 8, stage: false });
    const layout = await executeCommand(
      saveLayoutCommand,
      { name: 'Ceremony rows', doc: rows },
      a.ctx(),
      ports,
    );
    const own = await executeCommand(
      giveSubEventOwnChartCommand,
      { eventId: ev.id, subEventId: ceremony.id, occurrenceId: d1.id, layoutId: layout.id },
      a.ctx(),
      ports,
    );
    expect(own).toMatchObject({ source: 'sub_event', seatCount: 12, sourceLayoutId: layout.id });
    await expect(
      executeCommand(
        giveSubEventOwnChartCommand,
        { eventId: ev.id, subEventId: ceremony.id, occurrenceId: d1.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'sub_event_has_chart' } });
    // Without a layout: a copy of the chart it uses now (the reception: date 2's 16 seats).
    expect(
      await executeCommand(
        giveSubEventOwnChartCommand,
        { eventId: ev.id, subEventId: reception.id, occurrenceId: d2.id },
        a.ctx(),
        ports,
      ),
    ).toMatchObject({ source: 'sub_event', seatCount: 16, sourceLayoutId: null });
    expect((await resolve()).map((c) => c.source)).toEqual(['sub_event', 'sub_event', 'event']);
    await executeCommand(
      removeSubEventChartCommand,
      { eventId: ev.id, subEventId: reception.id },
      a.ctx(),
      ports,
    );
    expect((await resolve())[1]).toMatchObject({ source: 'date', chartKey: d2.id });
    // A sub-event of another event can't get a chart here (the foreign key refuses it).
    const stranger = await sub(a, otherEv, 'Stranger');
    await expect(
      executeCommand(
        giveSubEventOwnChartCommand,
        { eventId: ev.id, subEventId: stranger.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Removing the sub-event takes its chart with it.
    await executeCommand(removeSubEventCommand, { eventId: ev.id, subEventId: ceremony.id }, a.ctx(), ports);
    const [left] = await admin<{ n: number }[]>`
      select count(*)::int as n from seating.sub_event_charts where sub_event_id = ${ceremony.id}`;
    expect(left?.n).toBe(0);
    // No plan at all: none.
    const bare = await wedding(a, `Bare ${a.org.slug}`);
    const s = await sub(a, bare, 'Solo');
    expect(
      await executeQuery(
        subEventChartsQuery,
        { eventId: bare.id, subEvents: [{ id: s.id, occurrenceId: null }] },
        a.ctx(),
        ports,
      ),
    ).toEqual([{ subEventId: s.id, source: 'none', chartKey: null, seatCount: 0, sourceLayoutId: null }]);
  });

  it('guests and sub-events from another event or org are refused', async () => {
    const one = await list(a, 'One');
    const two = await list(a, 'Two');
    const s1 = await sub(a, one.ev, 'Ceremony', { inviteAll: true });
    const s2 = await sub(a, two.ev, 'Ceremony', { inviteAll: true });
    const picked = await sub(a, one.ev, 'Dinner');
    // Another event's guest or sub-event: not found, never "not invited".
    await expect(respond(a, one.ev.id, two.luis.id, s1.id, 'attending')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(respond(a, one.ev.id, one.luis.id, s2.id, 'attending')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      invite(a, one.ev.id, [picked.id], { kind: 'guests', guestIds: [two.mei.id] }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      invite(a, one.ev.id, [picked.id], { kind: 'parties', partyIds: [two.garcia.id] }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        updateSubEventCommand,
        { eventId: one.ev.id, subEventId: s2.id, name: 'Hijack', startsAt: at(0), endsAt: at(1) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Org B sees nothing of org A and can't write to it.
    expect(await executeQuery(subEventsQuery, { eventId: one.ev.id }, b.ctx(), ports)).toEqual([]);
    await expect(respond(b, one.ev.id, one.luis.id, s1.id, 'attending')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(sub(b, one.ev, 'Intruder')).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(
        removeSubEventCommand,
        { eventId: one.ev.id, subEventId: s1.id, confirm: true },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const [still] = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.sub_events where id = ${s1.id}`;
    expect(still?.n).toBe(1);
  });

  it('permissions: viewers read only; a planner on the event writes; anonymous is refused', async () => {
    const { ev, luis } = await list(a, 'Perms');
    const s = await sub(a, ev, 'Ceremony', { inviteAll: true });
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(
      (await executeQuery(subEventsQuery, { eventId: ev.id }, viewer, ports)).map((x) => x.name),
    ).toEqual(['Ceremony']);
    expect(
      (await executeQuery(invitationMatrixQuery, { eventId: ev.id }, viewer, ports)).parties,
    ).toHaveLength(2);
    for (const run of [
      () =>
        executeCommand(
          createSubEventCommand,
          { eventId: ev.id, name: 'Nope', startsAt: at(0), endsAt: at(1) },
          viewer,
          ports,
        ),
      () =>
        executeCommand(
          setInvitationsCommand,
          { eventId: ev.id, subEventIds: [s.id], target: { kind: 'all' }, invited: true },
          viewer,
          ports,
        ),
      () => respond(a, ev.id, luis.id, s.id, 'attending', viewer),
      () => executeCommand(removeSubEventCommand, { eventId: ev.id, subEventId: s.id }, viewer, ports),
      () =>
        executeCommand(
          moveSubEventCommand,
          { eventId: ev.id, subEventId: s.id, direction: 'down' },
          viewer,
          ports,
        ),
    ])
      await expect(run()).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      executeQuery(subEventsQuery, { eventId: ev.id }, createCtx({ orgId: a.org.id }), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // A planner (M4.2a event role) on this wedding records responses; on another event, refused.
    const planner = uuidv7();
    await executeCommand(addMemberCommand, { userId: planner, role: 'viewer' }, a.ctx(), ports);
    await executeCommand(
      assignEventRoleCommand,
      { eventId: ev.id, userId: planner, role: 'planner' },
      a.ctx(),
      ports,
    );
    const pctx = userCtx(planner, a.org.id);
    expect(await respond(a, ev.id, luis.id, s.id, 'attending', pctx)).toEqual({ status: 'attending' });
    const elsewhere = await list(a, 'Elsewhere');
    const s2 = await sub(a, elsewhere.ev, 'Ceremony', { inviteAll: true });
    await expect(
      respond(a, elsewhere.ev.id, elsewhere.luis.id, s2.id, 'attending', pctx),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('never feeds marketing: no contacts, consents or domain events come from sub-event commands', async () => {
    const counts = async () => {
      const [r] = await admin<{ contacts: number; consents: number; events: number }[]>`
        select (select count(*)::int from crm.contacts where org_id = ${a.org.id}) as contacts,
               (select count(*)::int from crm.consents where org_id = ${a.org.id}) as consents,
               (select count(*)::int from platform.domain_events where org_id = ${a.org.id}) as events`;
      return r;
    };
    const { ev, luis } = await list(a, 'Quiet');
    const before = await counts();
    const s = await sub(a, ev, 'Reception');
    await invite(a, ev.id, [s.id], { kind: 'all' });
    await respond(a, ev.id, luis.id, s.id, 'attending');
    await invite(a, ev.id, [s.id], { kind: 'all' }, false);
    await executeCommand(removeSubEventCommand, { eventId: ev.id, subEventId: s.id }, a.ctx(), ports);
    expect(await counts()).toEqual(before);
  });
});
