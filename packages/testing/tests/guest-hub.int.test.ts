import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import {
  FAKE_PASS_CONTENT_TYPE,
  fakeGuestPassProvider,
  guestPassContent,
  type PartyHubView,
  partyRsvpQuery,
  resetRsvpLinkCommand,
  submitRsvpCommand,
  updatePartyGuestCommand,
} from '@yayatoh/guests';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import { partyTicketsTx } from '@yayatoh/ticketing';
import { withTenant } from '@yayatoh/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type GuestHubScenario,
  guestHubScenario,
  guestSiteScenario,
  type OrgFixture,
  partyHub,
  ports,
  twoOrgs,
} from '../src/index.ts';

/**
 * M4.7a: the party's guest hub. Acceptance (data side): one payload per party with its RSVP,
 * program, seats and tickets, nothing outside the party and nothing private (P4-3); the party's
 * link is the only key (a reset or foreign link fails, an expired one shows the event's name only);
 * seats appear once the host opens the seat finder; the wallet pass carries the allowlist only.
 */

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
let w: GuestHubScenario;

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
  w = await guestHubScenario(a.org.id, { ctx: a.ctx() });
});
afterAll(async () => {
  await admin.end();
  await closePools();
});

const guest = (orgId: string, extra: Partial<Ctx> = {}) => createCtx({ orgId, ...extra });
const hub = (token: string, ctx = guest(a.org.id)) => executeQuery(partyHub, { token }, ctx, ports);
const ok = async (token: string, ctx?: Ctx): Promise<PartyHubView> => {
  const h = await hub(token, ctx);
  if (h.state !== 'ok') throw new Error(`hub is ${h.state}`);
  return h;
};
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return err.code;
  }
}

describe('the party hub (M4.7a)', () => {
  it('shows the party its own RSVP, program, seat and ticket, and nothing else', async () => {
    const h = await ok(w.garcia.token);
    expect(h.eventName).toBe(w.eventName);
    expect(h.partyName).toBe('The Garcia family');
    expect(h.timezone).toBe('America/Chicago');
    expect(h.guests.map((g) => [g.firstName, g.kind, g.hostFirstName])).toEqual([
      ['Luis', 'guest', null],
      [null, 'plus_one', 'Luis'],
      ['Ana', 'guest', null],
    ]);
    expect(h.program.map((p) => [p.name, p.place, p.answers.length])).toEqual([
      ['Ceremony', 'The garden', 3],
      ['Reception', null, 2],
    ]);
    expect(h.rsvp).toMatchObject({ open: true, deadline: null, respondedAt: null });
    expect([h.rsvp.attending, h.rsvp.declined, h.rsvp.awaiting]).toEqual([0, 0, 5]);
    expect(h.seating).toEqual({
      seats: [{ itemKind: 'table', itemLabel: w.tableLabel, seatLabel: w.seatLabel, sponsor: null }],
      unseated: 0,
    });
    expect(h.tickets).toHaveLength(1);
    expect(h.tickets[0]).toMatchObject({ shortCode: w.ticketShortCode, typeName: 'Guest pass' });
    expect(h.tickets[0]?.code).toMatch(/^YY1[A-Z0-9]+$/);
    expect(h.siteCode).toBeNull();
    // The allowlist: exactly these keys, no attendee/contact ids, nobody from another party.
    expect(Object.keys(h).sort()).toEqual(
      [
        'endsAt',
        'eventName',
        'guests',
        'partyName',
        'passSerial',
        'program',
        'rsvp',
        'seating',
        'startsAt',
        'state',
        'tickets',
        'timezone',
        'siteCode',
      ].sort(),
    );
    const json = JSON.stringify(h);
    expect(json).not.toContain('Mei');
    expect(json).not.toContain(w.luisAttendeeId);
    expect(json).not.toContain('@hub.test');
  });

  it('never carries private answers (P4-3)', async () => {
    const d = await executeQuery(partyRsvpQuery, { eventId: w.eventId, partyId: w.chen.id }, a.ctx(), ports);
    expect(d.state).toBeTruthy();
    const chen = await ok(w.chen.token);
    const mei = chen.guests[0];
    if (!mei) throw new Error('no Mei');
    await executeCommand(
      updatePartyGuestCommand,
      {
        eventId: w.eventId,
        guestId: mei.id,
        firstName: 'Mei',
        lastName: 'Chen',
        dietary: 'Peanut allergy',
        accessibility: 'Step-free seat',
        address: '1 Lake St',
        meal: 'Fish',
      },
      a.ctx(),
      ports,
    );
    const json = JSON.stringify(await hub(w.chen.token));
    for (const secret of ['Peanut', 'Step-free', 'Lake St', 'Fish']) expect(json).not.toContain(secret);
  });

  it('a party with no ticket or seat sees none; only the parts it is invited to', async () => {
    const h = await ok(w.chen.token);
    expect(h.partyName).toBe('The Chen family');
    expect(h.program.map((p) => p.name)).toEqual(['Ceremony']);
    expect(h.tickets).toEqual([]);
    expect(h.seating).toEqual({ seats: [], unseated: 0 });
    expect(JSON.stringify(h)).not.toContain('Luis');
  });

  it('follows the answers: the tally and the answered date', async () => {
    const before = await ok(w.garcia.token);
    const [ceremony, reception] = before.program;
    const [luis, plus, ana] = before.guests;
    if (!ceremony || !reception || !luis || !plus || !ana) throw new Error('shape');
    await executeCommand(
      submitRsvpCommand,
      {
        token: w.garcia.token,
        answers: [
          { guestId: luis.id, subEventId: ceremony.id, status: 'attending' },
          { guestId: plus.id, subEventId: ceremony.id, status: 'attending' },
          { guestId: ana.id, subEventId: ceremony.id, status: 'declined' },
          { guestId: luis.id, subEventId: reception.id, status: 'attending' },
          { guestId: plus.id, subEventId: reception.id, status: 'attending' },
        ],
        plusOnes: [{ guestId: plus.id, firstName: 'Sam', lastName: 'Lee' }],
      },
      guest(a.org.id),
      ports,
    );
    const h = await ok(w.garcia.token);
    expect([h.rsvp.attending, h.rsvp.declined, h.rsvp.awaiting]).toEqual([4, 1, 0]);
    expect(h.rsvp.respondedAt).toBeInstanceOf(Date);
    expect(h.guests[1]).toMatchObject({ firstName: 'Sam', lastName: 'Lee' });
    expect(h.program[0]?.answers.find((x) => x.guestId === ana.id)?.status).toBe('declined');
  });

  it('shows no seats until the host opens the seat finder', async () => {
    const closed = await guestHubScenario(a.org.id, { ctx: a.ctx(), seating: false });
    const h = await ok(closed.garcia.token);
    expect(h.seating).toBeNull();
    // Tickets don't wait for the seating.
    expect(h.tickets.map((t) => t.shortCode)).toEqual([closed.ticketShortCode]);
  });

  it('links to the published guest website', async () => {
    const s = await guestSiteScenario(a.org.id, { ctx: a.ctx() });
    expect((await ok(s.garcia.token)).siteCode).toBe(s.code);
  });

  it('the link is the key: a reset link, a forged one and another org fail; an expired one shows the name only', async () => {
    const s = await guestHubScenario(a.org.id, { ctx: a.ctx() });
    expect(await codeOf(hub(`${s.garcia.token}x`))).toBe('not_found');
    expect(await codeOf(hub('not-a-real-token-at-all'))).toBe('not_found');
    // Org B's context can't open org A's party (the token resolves only inside its own org).
    expect(await codeOf(hub(s.garcia.token, guest(b.org.id)))).toBe('not_found');
    await executeCommand(resetRsvpLinkCommand, { eventId: s.eventId, partyId: s.garcia.id }, a.ctx(), ports);
    expect(await codeOf(hub(s.garcia.token))).toBe('not_found');

    await admin`update guests.party_rsvp set link_expires_at = now() - interval '1 minute' where party_id = ${s.chen.id}`;
    expect(await hub(s.chen.token)).toEqual({ state: 'expired', eventName: s.eventName });
  });

  it("ticketing's reader returns only active tickets of that event", async () => {
    const h = await ok(w.garcia.token);
    const id = h.tickets[0]?.id ?? '';
    const other = await guestHubScenario(a.org.id, { ctx: a.ctx() });
    await withTenant(a.ctx(), async (tx) => {
      expect(await partyTicketsTx(tx, w.eventId, [id])).toHaveLength(1);
      expect(await partyTicketsTx(tx, other.eventId, [id])).toEqual([]);
      expect(await partyTicketsTx(tx, w.eventId, [])).toEqual([]);
    });
    // RLS: org B never sees org A's ticket, whatever id it passes.
    await withTenant(b.ctx(), async (tx) => {
      expect(await partyTicketsTx(tx, w.eventId, [id])).toEqual([]);
    });
  });
});

describe('the guest wallet pass (M4.7a, fake provider)', () => {
  it('carries the event, the party, when, where and the seats: nothing else', async () => {
    const h = await ok(w.garcia.token);
    const content = guestPassContent({
      serial: h.passSerial,
      eventName: h.eventName,
      partyName: h.partyName,
      timezone: h.timezone,
      startsAt: h.startsAt,
      endsAt: h.endsAt,
      program: h.program,
      seats: h.seating?.seats ?? [],
    });
    expect(content.seats).toEqual([{ table: w.tableLabel, seat: w.seatLabel }]);
    expect(content.place).toBe('The garden');
    expect(content.relevantAt).toEqual(h.program[0]?.startsAt);
    const provider = fakeGuestPassProvider();
    const barcode = `https://app.test/hub/${encodeURIComponent(w.garcia.token)}`;
    const r = await provider.issuePass({
      platform: 'apple',
      content,
      barcode,
      locale: 'en',
      labels: { party: 'Party', when: 'When', place: 'Where', seats: 'Seats' },
      when: 'Saturday',
    });
    expect(r.kind).toBe('file');
    if (r.kind !== 'file') return;
    expect(r.contentType).toBe(FAKE_PASS_CONTENT_TYPE);
    const pass = JSON.parse(r.body);
    expect(pass).toMatchObject({ fake: true, platform: 'apple', serialNumber: h.passSerial });
    expect(pass.barcode).toEqual({ format: 'qr', message: barcode });
    expect(pass.fields.map((f: { key: string }) => f.key)).toEqual(['party', 'when', 'place', 'seats']);
    expect(provider.issued).toEqual([{ platform: 'apple', serial: h.passSerial, barcode }]);
    // The same party always gets the same serial (the provider updates the pass in place).
    expect((await ok(w.garcia.token)).passSerial).toBe(h.passSerial);
    expect((await ok(w.chen.token)).passSerial).not.toBe(h.passSerial);
  });
});
