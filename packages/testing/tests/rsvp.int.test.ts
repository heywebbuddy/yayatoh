import { addGuestCommand } from '@yayatoh/attendees';
import { catchUpParticipation } from '@yayatoh/audiences';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  createRsvpLinksCommand,
  createSubEventCommand,
  findRsvpByNameCommand,
  guestListQuery,
  markRsvpSentCommand,
  markRsvpViewedCommand,
  partyHistoryQuery,
  partyRsvpQuery,
  publicRsvpQuery,
  recordSubEventResponseCommand,
  reopenRsvpCommand,
  resetRsvpLinkCommand,
  resetRsvpPinCommand,
  rsvpLinkRef,
  rsvpLinksQuery,
  rsvpLookupTarget,
  rsvpOverviewQuery,
  rsvpSettingsQuery,
  setInvitationsCommand,
  setRsvpSettingsCommand,
  submitRsvpCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError, uuidv7 } from '@yayatoh/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M4.1d: the RSVP flow. Acceptance: name lookup never reveals the guest list; an RSVP to a
 * sub-event the party is not invited to is refused in the command; writes after the deadline are
 * refused; a link works for its party only and a reset link fails; isolation, impersonation and
 * freeze coverage of the new commands; the RSVP feeds `event_participation`, never marketing.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
});
afterAll(async () => {
  await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:rsvp')`;
  await admin.end();
  await closePools();
});

/** The public page's context: the org comes from the link (never a header), nobody signed in. */
const guestCtx = (orgId: string, extra: Partial<Ctx> = {}) => createCtx({ orgId, ...extra });

const at = (h: number) => new Date(Date.UTC(2030, 5, 1, 20 + h)).toISOString();

/**
 * A wedding with a ceremony (everyone) and a reception (Luis, so his plus-one too), and two
 * parties: Garcia (Luis López with a placeholder plus-one, Ana) and Chen (Mei).
 */
async function wedding(f: OrgFixture, name: string) {
  const ev: EventDto = await executeCommand(
    createEventCommand,
    {
      name: `${name} ${f.org.slug}`,
      profile: 'wedding',
      timezone: 'America/Chicago',
      startsAt: '2030-06-01T20:00:00Z',
      endsAt: '2030-06-02T04:00:00Z',
    },
    f.ctx(),
    ports,
  );
  const party = (n: string) =>
    executeCommand(
      createPartyCommand,
      { eventId: ev.id, name: n, envelopeName: `The ${n}s` },
      f.ctx(),
      ports,
    );
  const garcia = await party('Garcia');
  const chen = await party('Chen');
  const add = (partyId: string, firstName: string, lastName: string, extra: object = {}) =>
    executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId, firstName, lastName, ...extra },
      f.ctx(),
      ports,
    );
  const luis = await add(garcia.id, 'Luis', 'López', { dietary: 'No nuts' });
  const ana = await add(garcia.id, 'Ana', 'García');
  const mei = await add(chen.id, 'Mei', 'Chen');
  const plus = await executeCommand(
    addPlusOneCommand,
    { eventId: ev.id, hostGuestId: luis.id },
    f.ctx(),
    ports,
  );
  const ceremony = await executeCommand(
    createSubEventCommand,
    { eventId: ev.id, name: 'Ceremony', kind: 'ceremony', startsAt: at(0), endsAt: at(1), inviteAll: true },
    f.ctx(),
    ports,
  );
  const reception = await executeCommand(
    createSubEventCommand,
    { eventId: ev.id, name: 'Reception', kind: 'reception', startsAt: at(1), endsAt: at(5) },
    f.ctx(),
    ports,
  );
  await executeCommand(
    setInvitationsCommand,
    {
      eventId: ev.id,
      subEventIds: [reception.id],
      target: { kind: 'guests', guestIds: [luis.id] },
      invited: true,
    },
    f.ctx(),
    ports,
  );
  await executeCommand(createRsvpLinksCommand, { eventId: ev.id }, f.ctx(), ports);
  const detail = (partyId: string) =>
    executeQuery(partyRsvpQuery, { eventId: ev.id, partyId }, f.ctx(), ports);
  return { ev, garcia, chen, luis, ana, mei, plus, ceremony, reception, detail };
}

type Wedding = Awaited<ReturnType<typeof wedding>>;

/** Garcia's complete answer: everyone at the ceremony, Luis and his named plus-one at the reception. */
const garciaAnswer = (w: Wedding, status: 'attending' | 'declined' = 'attending') => ({
  answers: [
    { guestId: w.luis.id, subEventId: w.ceremony.id, status },
    { guestId: w.ana.id, subEventId: w.ceremony.id, status },
    { guestId: w.plus.id, subEventId: w.ceremony.id, status },
    { guestId: w.luis.id, subEventId: w.reception.id, status },
    { guestId: w.plus.id, subEventId: w.reception.id, status },
  ],
  plusOnes: status === 'attending' ? [{ guestId: w.plus.id, firstName: 'Sam', lastName: 'Lee' }] : [],
});

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return `${err.code}${(err.details as { reason?: string } | undefined)?.reason ? `:${(err.details as { reason: string }).reason}` : ''}`;
  }
}

describe('RSVP by party link (M4.1d)', () => {
  it('a household answers for its party: plus-one named, history with source rsvp, state responded', async () => {
    const w = await wedding(a, 'Link');
    const d = await w.detail(w.garcia.id);
    expect(d.state).toBe('invited');
    expect(d.token).toBeTruthy();
    expect(d.pin).toMatch(/^\d{6}$/);
    expect(d.lookupCode).toMatch(/^[0-9A-Z]{8}$/);
    const token = d.token as string;
    // The org comes from the link.
    expect(await rsvpLinkRef(token)).toEqual({ orgId: a.org.id, linkId: expect.any(String) });

    await executeCommand(markRsvpSentCommand, { eventId: w.ev.id, partyId: w.garcia.id }, a.ctx(), ports);
    expect((await w.detail(w.garcia.id)).state).toBe('sent');

    const view = await executeQuery(publicRsvpQuery, { token }, guestCtx(a.org.id), ports);
    expect(view.state).toBe('open');
    expect(view.viewed).toBe(false);
    expect(view.partyName).toBe('The Garcias');
    // Only the party's own guests, plus-one after the host; only invited sub-events.
    expect(view.guests.map((g) => g.firstName)).toEqual(['Luis', null, 'Ana']);
    expect(view.guests[1]).toMatchObject({ kind: 'plus_one', hostFirstName: 'Luis' });
    expect(view.subEvents.map((s) => [s.name, s.guestIds.length])).toEqual([
      ['Ceremony', 3],
      ['Reception', 2],
    ]);
    // Nothing private or foreign in the payload.
    const json = JSON.stringify(view);
    expect(json).not.toContain('No nuts');
    expect(json).not.toContain('Mei');
    expect(json).not.toContain(d.pin as string);

    expect((await executeCommand(markRsvpViewedCommand, { token }, guestCtx(a.org.id), ports)).first).toBe(
      true,
    );
    expect((await executeCommand(markRsvpViewedCommand, { token }, guestCtx(a.org.id), ports)).first).toBe(
      false,
    );
    expect((await w.detail(w.garcia.id)).state).toBe('viewed');

    const r = await executeCommand(
      submitRsvpCommand,
      { token, ...garciaAnswer(w) },
      guestCtx(a.org.id),
      ports,
    );
    expect(r).toEqual({ attending: 5, declined: 0 });
    const after = await w.detail(w.garcia.id);
    expect(after.state).toBe('responded');
    expect(after.subEvents).toEqual([
      { subEventId: w.ceremony.id, invited: 3, attending: 3, declined: 0, awaiting: 0 },
      { subEventId: w.reception.id, invited: 2, attending: 2, declined: 0, awaiting: 0 },
    ]);
    const again = await executeQuery(publicRsvpQuery, { token }, guestCtx(a.org.id), ports);
    expect(again.guests[1]).toMatchObject({ firstName: 'Sam', lastName: 'Lee' });
    expect(again.responses).toHaveLength(5);
    expect(again.respondedAt).toBeInstanceOf(Date);
    expect(again.viewed).toBe(true);

    const history = await executeQuery(
      partyHistoryQuery,
      { eventId: w.ev.id, partyId: w.garcia.id },
      a.ctx(),
      ports,
    );
    const actions = history.map((h) => `${h.action}/${h.source}`);
    for (const x of [
      'rsvp_link_created/manual',
      'rsvp_sent/manual',
      'rsvp_viewed/rsvp',
      'plus_one_named/rsvp',
      'response_recorded/rsvp',
      'rsvp_submitted/rsvp',
    ])
      expect(actions).toContain(x);
    // Field names only, never values.
    expect(JSON.stringify(history)).not.toContain('Sam');

    // A second answer changes what changed; Ana declines the ceremony now.
    await executeCommand(
      submitRsvpCommand,
      {
        token,
        ...garciaAnswer(w),
        answers: garciaAnswer(w).answers.map((x) =>
          x.guestId === w.ana.id ? { ...x, status: 'declined' } : x,
        ),
      },
      guestCtx(a.org.id),
      ports,
    );
    expect((await w.detail(w.garcia.id)).subEvents[0]).toMatchObject({ attending: 2, declined: 1 });

    // The overview and the guest list's RSVP filter.
    const ov = await executeQuery(rsvpOverviewQuery, { eventId: w.ev.id }, a.ctx(), ports);
    expect(ov.states).toEqual({ invited: 1, sent: 0, viewed: 0, responded: 1 });
    const responded = await executeQuery(
      guestListQuery,
      { eventId: w.ev.id, rsvp: 'responded' },
      a.ctx(),
      ports,
    );
    expect(responded.parties.map((p) => p.name)).toEqual(['Garcia']);
    const waiting = await executeQuery(guestListQuery, { eventId: w.ev.id, rsvp: 'invited' }, a.ctx(), ports);
    expect(waiting.parties.map((p) => p.name)).toEqual(['Chen']);
  });

  it('declining everything needs no plus-one name; missing answers are refused', async () => {
    const w = await wedding(a, 'Decline');
    const token = (await w.detail(w.garcia.id)).token as string;
    expect(
      await codeOf(
        executeCommand(
          submitRsvpCommand,
          { token, answers: garciaAnswer(w).answers.slice(1), plusOnes: [] },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('validation_failed:missing_answer');
    expect(
      await codeOf(
        executeCommand(
          submitRsvpCommand,
          { token, ...garciaAnswer(w), plusOnes: [] },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('validation_failed:plus_one_name_required');
    const r = await executeCommand(
      submitRsvpCommand,
      { token, ...garciaAnswer(w, 'declined') },
      guestCtx(a.org.id),
      ports,
    );
    expect(r).toEqual({ attending: 0, declined: 5 });
  });

  it('an RSVP to a sub-event the party is not invited to is refused in the command', async () => {
    const w = await wedding(a, 'Uninvited');
    const token = (await w.detail(w.garcia.id)).token as string;
    // Ana is not invited to the reception; the call is crafted by hand, not through the page.
    expect(
      await codeOf(
        executeCommand(
          submitRsvpCommand,
          {
            token,
            ...garciaAnswer(w),
            answers: [
              ...garciaAnswer(w).answers,
              { guestId: w.ana.id, subEventId: w.reception.id, status: 'attending' },
            ],
          },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('invalid_state:not_invited');
    // Nothing was written.
    expect((await w.detail(w.garcia.id)).subEvents.every((s) => s.attending === 0)).toBe(true);
    // A sub-event of another event: also refused.
    const other = await wedding(a, 'Other');
    expect(
      await codeOf(
        executeCommand(
          submitRsvpCommand,
          {
            token,
            ...garciaAnswer(w),
            answers: [
              ...garciaAnswer(w).answers,
              { guestId: w.luis.id, subEventId: other.reception.id, status: 'attending' },
            ],
          },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('invalid_state:not_invited');
  });

  it('a link works for its party only; a reset link fails at once; an expired link shows nothing', async () => {
    const w = await wedding(a, 'Links');
    const garcia = (await w.detail(w.garcia.id)).token as string;
    const chen = (await w.detail(w.chen.id)).token as string;
    expect(garcia).not.toBe(chen);
    // Garcia's link can't answer for Mei.
    expect(
      await codeOf(
        executeCommand(
          submitRsvpCommand,
          { token: garcia, answers: [{ guestId: w.mei.id, subEventId: w.ceremony.id, status: 'attending' }] },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('not_found:not_in_party');
    // A forged or tampered token is unknown.
    expect(await rsvpLinkRef(`${uuidv7()}~nope`)).toBeNull();
    expect(await rsvpLinkRef(`${garcia}x`)).toBeNull();

    await executeCommand(resetRsvpLinkCommand, { eventId: w.ev.id, partyId: w.garcia.id }, a.ctx(), ports);
    expect(await rsvpLinkRef(garcia)).toBeNull();
    expect(await codeOf(executeQuery(publicRsvpQuery, { token: garcia }, guestCtx(a.org.id), ports))).toBe(
      'not_found:unknown_link',
    );
    expect(
      await codeOf(
        executeCommand(submitRsvpCommand, { token: garcia, ...garciaAnswer(w) }, guestCtx(a.org.id), ports),
      ),
    ).toBe('not_found:unknown_link');
    const fresh = (await w.detail(w.garcia.id)).token as string;
    expect(fresh).not.toBe(garcia);
    expect((await executeQuery(publicRsvpQuery, { token: fresh }, guestCtx(a.org.id), ports)).state).toBe(
      'open',
    );

    // Expired: the page shows only the event's name; answers are refused.
    await admin`update guests.party_rsvp set link_expires_at = now() - interval '1 minute' where party_id = ${w.chen.id}`;
    const expired = await executeQuery(publicRsvpQuery, { token: chen }, guestCtx(a.org.id), ports);
    expect(expired).toMatchObject({ state: 'expired', partyName: '', guests: [], subEvents: [] });
    expect(
      await codeOf(
        executeCommand(
          submitRsvpCommand,
          { token: chen, answers: [{ guestId: w.mei.id, subEventId: w.ceremony.id, status: 'attending' }] },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('invalid_state:link_expired');
  });

  it('after the deadline the page is read-only and writes are refused until the host reopens the party', async () => {
    const w = await wedding(a, 'Deadline');
    const token = (await w.detail(w.garcia.id)).token as string;
    await executeCommand(
      setRsvpSettingsCommand,
      { eventId: w.ev.id, deadline: new Date(Date.now() - 60_000), nameLookup: true },
      a.ctx(),
      ports,
    );
    expect((await executeQuery(publicRsvpQuery, { token }, guestCtx(a.org.id), ports)).state).toBe('locked');
    expect(
      await codeOf(
        executeCommand(submitRsvpCommand, { token, ...garciaAnswer(w) }, guestCtx(a.org.id), ports),
      ),
    ).toBe('invalid_state:deadline_passed');
    // Just before the deadline it was open.
    const before = guestCtx(a.org.id, { now: new Date(Date.now() - 120_000) });
    expect((await executeQuery(publicRsvpQuery, { token }, before, ports)).state).toBe('open');

    await executeCommand(reopenRsvpCommand, { eventId: w.ev.id, partyId: w.garcia.id }, a.ctx(), ports);
    expect((await w.detail(w.garcia.id)).reopened).toBe(true);
    expect((await executeQuery(publicRsvpQuery, { token }, guestCtx(a.org.id), ports)).state).toBe('open');
    await executeCommand(submitRsvpCommand, { token, ...garciaAnswer(w) }, guestCtx(a.org.id), ports);
    // Answered: locked again.
    expect((await w.detail(w.garcia.id)).reopened).toBe(false);
    expect(
      await codeOf(
        executeCommand(submitRsvpCommand, { token, ...garciaAnswer(w) }, guestCtx(a.org.id), ports),
      ),
    ).toBe('invalid_state:deadline_passed');
    const history = await executeQuery(
      partyHistoryQuery,
      { eventId: w.ev.id, partyId: w.garcia.id },
      a.ctx(),
      ports,
    );
    expect(history.map((h) => h.action)).toContain('rsvp_reopened');
    // Chen was not reopened.
    const chen = (await w.detail(w.chen.id)).token as string;
    expect((await executeQuery(publicRsvpQuery, { token: chen }, guestCtx(a.org.id), ports)).state).toBe(
      'locked',
    );
  });

  it('host answers on paper count: a party answered in full is responded', async () => {
    const w = await wedding(a, 'Paper');
    const rec = (guestId: string, subEventId: string) =>
      executeCommand(
        recordSubEventResponseCommand,
        { eventId: w.ev.id, guestId, subEventId, status: 'attending', source: 'paper' },
        a.ctx(),
        ports,
      );
    await rec(w.mei.id, w.ceremony.id);
    expect((await w.detail(w.chen.id)).state).toBe('responded');
    await rec(w.luis.id, w.ceremony.id);
    expect((await w.detail(w.garcia.id)).state).toBe('invited');
  });
});

describe('RSVP by name and PIN (paper fallback, P4-2)', () => {
  it('the exact full name and the PIN find the party; anything else gives the same answer', async () => {
    const w = await wedding(a, 'Lookup');
    const d = await w.detail(w.garcia.id);
    const target = await rsvpLookupTarget((d.lookupCode as string).toLowerCase());
    expect(target).toEqual({ orgId: a.org.id, eventId: w.ev.id });
    const find = (name: string, pin: string) =>
      executeCommand(findRsvpByNameCommand, { eventId: w.ev.id, name, pin }, guestCtx(a.org.id), ports);

    expect(await find('  luis   LÓPEZ ', d.pin as string)).toEqual({ status: 'found', token: d.token });
    // Any guest of the party, with the party's PIN.
    expect((await find('Ana García', d.pin as string)).status).toBe('found');
    const miss = { status: 'no_match', token: null };
    const wrongPin = String((Number(d.pin) + 1) % 1_000_000).padStart(6, '0');
    for (const [name, pin] of <[string, string][]>[
      ['Luis López', wrongPin], // right name, wrong PIN
      ['Luis', d.pin as string], // partial name
      ['López', d.pin as string],
      ['Luis Lopez', d.pin as string], // accent missing
      ['Nobody Here', d.pin as string], // unknown name
      ['Mei Chen', d.pin as string], // another party's guest with this PIN
      ['Luis López', 'abc'], // malformed PIN
    ])
      expect(await find(name, pin), `${name}/${pin}`).toEqual(miss);

    // Same timing class: a missing name does the same work as a wrong PIN.
    const time = async (name: string, pin: string) => {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await find(name, pin);
        runs.push(performance.now() - t0);
      }
      return runs.sort((x, y) => x - y)[2] as number;
    };
    const unknown = await time('Nobody Here', wrongPin);
    const wrong = await time('Luis López', wrongPin);
    expect(Math.max(unknown, wrong) / Math.min(unknown, wrong)).toBeLessThan(4);

    // A new PIN: the printed one stops working.
    await executeCommand(resetRsvpPinCommand, { eventId: w.ev.id, partyId: w.garcia.id }, a.ctx(), ports);
    const fresh = (await w.detail(w.garcia.id)).pin as string;
    expect(fresh).not.toBe(d.pin);
    expect(await find('Luis López', d.pin as string)).toEqual(miss);
    expect((await find('Luis López', fresh)).status).toBe('found');

    // Lookups write nothing but the audit: no history, no state change.
    expect((await w.detail(w.garcia.id)).state).toBe('invited');
  });

  it('hosts can turn name lookup off: the address no longer resolves and the command refuses', async () => {
    const w = await wedding(a, 'Off');
    const d = await w.detail(w.garcia.id);
    await executeCommand(
      setRsvpSettingsCommand,
      { eventId: w.ev.id, deadline: null, nameLookup: false },
      a.ctx(),
      ports,
    );
    expect(await rsvpLookupTarget(d.lookupCode as string)).toBeNull();
    expect(
      await codeOf(
        executeCommand(
          findRsvpByNameCommand,
          { eventId: w.ev.id, name: 'Luis López', pin: d.pin as string },
          guestCtx(a.org.id),
          ports,
        ),
      ),
    ).toBe('not_found:lookup_off');
    expect(await rsvpLookupTarget('ZZZZZZZZ')).toBeNull();
    expect(await rsvpLookupTarget('bad')).toBeNull();
    const s = await executeQuery(rsvpSettingsQuery, { eventId: w.ev.id }, a.ctx(), ports);
    expect(s).toMatchObject({ deadline: null, nameLookup: false, lookupCode: d.lookupCode });
  });
});

describe('RSVP: isolation, permissions, impersonation, freeze', () => {
  it('another org’s link, party or event is unknown here', async () => {
    const wa = await wedding(a, 'IsoA');
    const wb = await wedding(b, 'IsoB');
    const tokenB = (await wb.detail(wb.garcia.id)).token as string;
    expect((await rsvpLinkRef(tokenB))?.orgId).toBe(b.org.id);
    // B's token under A's org (a header can't pick the org; even if it could, RLS hides B's row).
    expect(await codeOf(executeQuery(publicRsvpQuery, { token: tokenB }, guestCtx(a.org.id), ports))).toBe(
      'not_found:unknown_link',
    );
    expect(
      await codeOf(
        executeCommand(submitRsvpCommand, { token: tokenB, ...garciaAnswer(wb) }, guestCtx(a.org.id), ports),
      ),
    ).toBe('not_found:unknown_link');
    for (const run of [
      () => executeQuery(partyRsvpQuery, { eventId: wb.ev.id, partyId: wb.garcia.id }, a.ctx(), ports),
      () => executeCommand(resetRsvpPinCommand, { eventId: wb.ev.id, partyId: wb.garcia.id }, a.ctx(), ports),
      () => executeCommand(reopenRsvpCommand, { eventId: wa.ev.id, partyId: wb.garcia.id }, a.ctx(), ports),
      () =>
        executeCommand(
          findRsvpByNameCommand,
          { eventId: wb.ev.id, name: 'Luis López', pin: '000000' },
          guestCtx(a.org.id),
          ports,
        ),
    ])
      expect((await codeOf(run())).startsWith('not_found')).toBe(true);
    const ov = await executeQuery(rsvpOverviewQuery, { eventId: wb.ev.id }, a.ctx(), ports);
    expect(ov.parties).toEqual([]);
    const rows = await admin<{ n: number }[]>`
      select count(*)::int as n from guests.party_rsvp where org_id = ${b.org.id} and event_id = ${wb.ev.id}`;
    expect(rows[0]?.n).toBe(2);
  });

  it('viewers see states but no links or PINs and cannot reset PINs; anonymous members are refused', async () => {
    const w = await wedding(a, 'Viewer');
    const viewer = userCtx(a.viewerId, a.org.id);
    const ov = await executeQuery(rsvpOverviewQuery, { eventId: w.ev.id }, viewer, ports);
    expect(ov.parties).toHaveLength(2);
    expect(JSON.stringify(ov)).not.toMatch(/token|pin/i);
    const ref = { eventId: w.ev.id, partyId: w.garcia.id };
    for (const run of [
      () => executeQuery(partyRsvpQuery, ref, viewer, ports),
      () => executeQuery(rsvpLinksQuery, { eventId: w.ev.id, partyIds: [w.garcia.id] }, viewer, ports),
      () => executeCommand(resetRsvpPinCommand, ref, viewer, ports),
      () => executeCommand(resetRsvpLinkCommand, ref, viewer, ports),
      () => executeCommand(reopenRsvpCommand, ref, viewer, ports),
      () => executeCommand(markRsvpSentCommand, ref, viewer, ports),
      () => executeCommand(createRsvpLinksCommand, { eventId: w.ev.id }, viewer, ports),
      () =>
        executeCommand(
          setRsvpSettingsCommand,
          { eventId: w.ev.id, deadline: null, nameLookup: false },
          viewer,
          ports,
        ),
      () => executeCommand(resetRsvpPinCommand, ref, guestCtx(a.org.id), ports),
      () => executeQuery(rsvpOverviewQuery, { eventId: w.ev.id }, guestCtx(a.org.id), ports),
    ])
      expect(await codeOf(run())).toBe('forbidden');
  });

  it('staff acting as a member can run the host tools (none moves money, exports or deletes)', async () => {
    const w = await wedding(a, 'Staff');
    const acting = a.ctx({ impersonatedBy: { staffUserId: uuidv7(), impersonationId: uuidv7() } });
    const ref = { eventId: w.ev.id, partyId: w.garcia.id };
    for (const c of [resetRsvpPinCommand, resetRsvpLinkCommand, reopenRsvpCommand, markRsvpSentCommand])
      expect(c.category).toBeUndefined();
    await executeCommand(resetRsvpPinCommand, ref, acting, ports);
    await executeCommand(reopenRsvpCommand, ref, acting, ports);
    const d = await executeQuery(partyRsvpQuery, ref, acting, ports);
    expect(d.reopened).toBe(true);
  });

  it('a read-only freeze refuses every RSVP write; the page still reads', async () => {
    const w = await wedding(a, 'Freeze');
    const d = await w.detail(w.garcia.id);
    const token = d.token as string;
    await admin`select platform.set_ops_flag('read_only_freeze', ${JSON.stringify({ scope: 'orgs', orgIds: [a.org.id] })}::text::jsonb, 'test', 'test:rsvp')`;
    try {
      const ref = { eventId: w.ev.id, partyId: w.garcia.id };
      for (const run of [
        () => executeCommand(submitRsvpCommand, { token, ...garciaAnswer(w) }, guestCtx(a.org.id), ports),
        () => executeCommand(markRsvpViewedCommand, { token }, guestCtx(a.org.id), ports),
        () =>
          executeCommand(
            findRsvpByNameCommand,
            { eventId: w.ev.id, name: 'Luis López', pin: d.pin as string },
            guestCtx(a.org.id),
            ports,
          ),
        () => executeCommand(resetRsvpPinCommand, ref, a.ctx(), ports),
        () => executeCommand(reopenRsvpCommand, ref, a.ctx(), ports),
        () =>
          executeCommand(
            setRsvpSettingsCommand,
            { eventId: w.ev.id, deadline: null, nameLookup: true },
            a.ctx(),
            ports,
          ),
      ])
        expect((await codeOf(run())).startsWith('read_only_freeze')).toBe(true);
      expect((await executeQuery(publicRsvpQuery, { token }, guestCtx(a.org.id), ports)).state).toBe('open');
    } finally {
      await admin`select platform.set_ops_flag('read_only_freeze', null::jsonb, 'test', 'test:rsvp')`;
    }
  });
});

describe('RSVP feeds event_participation, never marketing (M3.6a, P4-3)', () => {
  it('a guest linked to the guest list carries the RSVP on their participation row; others add nothing', async () => {
    const w = await wedding(a, 'Participation');
    const email = `rsvp-${uuidv7().slice(-8)}@example.test`;
    const attendee = await executeCommand(
      addGuestCommand,
      { eventId: w.ev.id, name: 'Linked Guest', email },
      a.ctx(),
      ports,
    );
    const [{ contact_id: contactId } = { contact_id: '' }] = await admin<{ contact_id: string }[]>`
      select contact_id from attendees.attendees where id = ${attendee.id}`;
    const linked = await executeCommand(
      addPartyGuestCommand,
      {
        eventId: w.ev.id,
        partyId: w.chen.id,
        firstName: 'Linked',
        lastName: 'Guest',
        attendeeId: attendee.id,
      },
      a.ctx(),
      ports,
    );
    await catchUpParticipation(a.org.id);
    const counts = async () => {
      const [r] = await admin<{ contacts: number; consents: number; rows: number; members: number }[]>`
        select (select count(*)::int from crm.contacts where org_id = ${a.org.id}) as contacts,
               (select count(*)::int from crm.consents where org_id = ${a.org.id}) as consents,
               (select count(*)::int from crm.event_participation where org_id = ${a.org.id} and event_id = ${w.ev.id}) as rows,
               (select count(*)::int from crm.contact_profile where org_id = ${a.org.id}) as members`;
      return r;
    };
    const before = await counts();
    const events = async () =>
      admin<{ type: string; payload: { contactIds: string[]; partyId: string } }[]>`
        select type, payload from platform.domain_events
        where org_id = ${a.org.id} and type = 'guests.rsvp_responded' and payload->>'eventId' = ${w.ev.id}`;

    // Garcia has no linked guest: answering emits nothing and adds nobody.
    const garcia = (await w.detail(w.garcia.id)).token as string;
    await executeCommand(submitRsvpCommand, { token: garcia, ...garciaAnswer(w) }, guestCtx(a.org.id), ports);
    expect(await events()).toEqual([]);

    // Chen has a guest linked to an attendee: the event carries ids and counts only.
    const chen = (await w.detail(w.chen.id)).token as string;
    await executeCommand(
      submitRsvpCommand,
      {
        token: chen,
        answers: [
          { guestId: w.mei.id, subEventId: w.ceremony.id, status: 'declined' },
          { guestId: linked.id, subEventId: w.ceremony.id, status: 'attending' },
        ],
      },
      guestCtx(a.org.id),
      ports,
    );
    const emitted = await events();
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.payload).toMatchObject({ partyId: w.chen.id, contactIds: [contactId] });
    expect(JSON.stringify(emitted)).not.toContain('Mei');

    await catchUpParticipation(a.org.id);
    const [row] = await admin<{ rsvp: string | null }[]>`
      select rsvp from crm.event_participation
      where org_id = ${a.org.id} and event_id = ${w.ev.id} and contact_id = ${contactId}`;
    expect(row?.rsvp).toBe('attending');
    // No contact, consent, participation row or profile was added by the RSVPs.
    expect(await counts()).toEqual(before);

    // Declining updates it.
    await executeCommand(
      submitRsvpCommand,
      {
        token: chen,
        answers: [
          { guestId: w.mei.id, subEventId: w.ceremony.id, status: 'declined' },
          { guestId: linked.id, subEventId: w.ceremony.id, status: 'declined' },
        ],
      },
      guestCtx(a.org.id),
      ports,
    );
    await catchUpParticipation(a.org.id);
    const [declined] = await admin<{ rsvp: string | null }[]>`
      select rsvp from crm.event_participation
      where org_id = ${a.org.id} and event_id = ${w.ev.id} and contact_id = ${contactId}`;
    expect(declined?.rsvp).toBe('declined');
  });
});
