import { addGuestCommand as addAttendeeCommand } from '@yayatoh/attendees';
import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import {
  addPartyGuestCommand,
  addPlusOneCommand,
  createPartyCommand,
  guestListQuery,
  moveGuestCommand,
  partyHistoryQuery,
  removePartyCommand,
  removePartyGuestCommand,
  updatePartyCommand,
  updatePartyGuestCommand,
} from '@yayatoh/guests';
import { createCtx, executeCommand, executeQuery } from '@yayatoh/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

let admin: AdminSql;
let a: OrgFixture;
let b: OrgFixture;
let ev: EventDto;
let other: EventDto;

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

const history = (partyId: string, eventId = ev.id) =>
  executeQuery(partyHistoryQuery, { eventId, partyId }, a.ctx(), ports);

beforeAll(async () => {
  admin = adminClient();
  ({ a, b } = await twoOrgs());
  ev = await wedding(a, `Harper and Theo ${a.org.slug}`);
  other = await wedding(a, `Another wedding ${a.org.slug}`);
});

afterAll(async () => {
  await closePools();
  await admin.end();
});

describe('guests: parties, guests and plus-ones (M4.1a)', () => {
  it('builds a party with a guest, a child and an unnamed plus-one; counts and names them', async () => {
    const party = await executeCommand(
      createPartyCommand,
      {
        eventId: ev.id,
        name: 'The Garcias',
        envelopeName: 'Mr. and Mrs. Luis Garcia',
        side: 'Bride',
        vip: true,
        tags: ['Family', ' family ', 'Out of town'],
      },
      a.ctx(),
      ports,
    );
    expect(party.tags).toEqual(['Family', 'Out of town']);
    const luis = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: party.id, firstName: 'Luis', lastName: 'Garcia', meal: 'Beef' },
      a.ctx(),
      ports,
    );
    expect(luis.isPrimary).toBe(true);
    const kid = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: party.id, firstName: 'Sofi', lastName: 'Garcia', ageClass: 'child' },
      a.ctx(),
      ports,
    );
    expect(kid.isPrimary).toBe(false);
    const plus = await executeCommand(
      addPlusOneCommand,
      { eventId: ev.id, hostGuestId: luis.id },
      a.ctx(),
      ports,
    );
    expect(plus).toMatchObject({ kind: 'plus_one', hostGuestId: luis.id, firstName: null, isPrimary: false });

    const list = await executeQuery(guestListQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(list.counts).toMatchObject({
      parties: 1,
      vipParties: 1,
      guests: 3,
      adults: 2,
      children: 1,
      infants: 0,
      plusOnesPending: 1,
    });
    // Plus-ones follow their host.
    expect(list.parties[0]?.guests.map((g) => g.id)).toEqual([luis.id, plus.id, kid.id]);
    expect(list.sides).toEqual(['Bride']);
    expect(list.tags).toEqual(['Family', 'Out of town']);

    // Naming the plus-one is its own history action; the count of pending plus-ones drops.
    await executeCommand(
      updatePartyGuestCommand,
      { eventId: ev.id, guestId: plus.id, firstName: 'Ana', lastName: 'Ruiz', source: 'paper' },
      a.ctx(),
      ports,
    );
    const after = await executeQuery(guestListQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(after.counts.plusOnesPending).toBe(0);
    const h = await history(party.id);
    expect(h.map((e) => e.action).reverse()).toEqual([
      'party_created',
      'guest_added',
      'guest_added',
      'plus_one_added',
      'plus_one_named',
    ]);
    expect(h[0]).toMatchObject({ source: 'paper', fields: ['firstName', 'lastName'] });
    expect(h.every((e) => e.actor === `user:${a.ownerId}`)).toBe(true);
    expect(h.at(-1)?.fields).toEqual(['name', 'envelopeName', 'side', 'vip', 'tags']);
  });

  it('writes every change to rsvp_history with its source and actor', async () => {
    const p1 = await executeCommand(
      createPartyCommand,
      { eventId: ev.id, name: 'Kims', source: 'paper' },
      a.ctx(),
      ports,
    );
    const p2 = await executeCommand(createPartyCommand, { eventId: ev.id, name: 'Lees' }, a.ctx(), ports);
    const min = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: p1.id, firstName: 'Min', lastName: 'Kim', source: 'paper' },
      a.ctx(),
      ports,
    );
    const joon = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: p1.id, firstName: 'Joon', lastName: 'Kim' },
      a.ctx(),
      ports,
    );
    const plus = await executeCommand(
      addPlusOneCommand,
      { eventId: ev.id, hostGuestId: min.id, firstName: 'Dan' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      updatePartyCommand,
      { eventId: ev.id, partyId: p1.id, name: 'The Kims', vip: false, tags: [], source: 'paper' },
      a.ctx(),
      ports,
    );
    // No change: no history row.
    await executeCommand(
      updatePartyCommand,
      { eventId: ev.id, partyId: p1.id, name: 'The Kims' },
      a.ctx(),
      ports,
    );
    await executeCommand(
      updatePartyGuestCommand,
      {
        eventId: ev.id,
        guestId: joon.id,
        firstName: 'Joon',
        lastName: 'Kim',
        meal: 'Fish',
        dietary: 'Gluten free',
      },
      a.ctx(),
      ports,
    );
    // Moving Min takes the plus-one along; Joon becomes the Kims' primary contact.
    const moved = await executeCommand(
      moveGuestCommand,
      { eventId: ev.id, guestId: min.id, toPartyId: p2.id },
      a.ctx(),
      ports,
    );
    expect(moved.moved).toBe(2);
    const list = await executeQuery(guestListQuery, { eventId: ev.id, search: 'Kim' }, a.ctx(), ports);
    const kims = list.parties.find((p) => p.id === p1.id);
    const lees = list.parties.find((p) => p.id === p2.id);
    expect(kims?.guests.map((g) => [g.firstName, g.isPrimary])).toEqual([['Joon', true]]);
    expect(lees?.guests.map((g) => [g.firstName, g.isPrimary])).toEqual([
      ['Min', true],
      ['Dan', false],
    ]);
    const removed = await executeCommand(
      removePartyGuestCommand,
      { eventId: ev.id, guestId: min.id, source: 'paper' },
      a.ctx(),
      ports,
    );
    expect(removed.removed).toBe(2);
    await executeCommand(removePartyCommand, { eventId: ev.id, partyId: p1.id }, a.ctx(), ports);

    const [row] = await admin<
      { n: number }[]
    >`select count(*)::int as n from guests.parties where id = ${p1.id}`;
    expect(row?.n).toBe(0);
    const h1 = (await history(p1.id)).reverse();
    expect(h1.map((e) => [e.action, e.source])).toEqual([
      ['party_created', 'paper'],
      ['guest_added', 'paper'],
      ['guest_added', 'manual'],
      ['plus_one_added', 'manual'],
      ['party_updated', 'paper'],
      ['guest_updated', 'manual'],
      // Moves out of the party show in its history too (detail.fromPartyId).
      ['guest_moved', 'manual'],
      ['guest_moved', 'manual'],
      ['guest_updated', 'manual'],
      ['guest_removed', 'manual'],
      ['party_removed', 'manual'],
    ]);
    expect(h1[4]?.fields).toEqual(['name']);
    expect(h1[5]?.fields).toEqual(['meal', 'dietary']);
    expect(h1[6]?.detail).toEqual({ fromPartyId: p1.id });
    expect(h1[8]).toMatchObject({ guestId: joon.id, fields: ['isPrimary'] });
    expect(h1.at(-1)?.detail).toEqual({ guests: 1 });
    const h2 = (await history(p2.id)).reverse();
    expect(h2.map((e) => e.action)).toEqual([
      'party_created',
      'guest_moved',
      'guest_moved',
      // Min becomes the Lees' primary contact.
      'guest_updated',
      'guest_removed',
      'guest_removed',
    ]);
    expect(h2.slice(-2).map((e) => e.source)).toEqual(['paper', 'paper']);
    expect(
      h2
        .slice(-2)
        .map((e) => e.guestId)
        .sort(),
    ).toEqual([min.id, plus.id].sort());
    // Every row names its actor (the signed-in user).
    const actors = await admin<{ actor: string }[]>`
      select distinct actor from guests.rsvp_history where party_id in (${p1.id}, ${p2.id})`;
    expect(actors.map((r) => r.actor)).toEqual([`user:${a.ownerId}`]);
  });

  it('seals dietary, accessibility and address: no plaintext in the database, history or audit', async () => {
    const party = await executeCommand(
      createPartyCommand,
      { eventId: ev.id, name: 'Sealed' },
      a.ctx(),
      ports,
    );
    const secret = `Shellfish allergy ${Date.now()}`;
    const g = await executeCommand(
      addPartyGuestCommand,
      {
        eventId: ev.id,
        partyId: party.id,
        firstName: 'Priv',
        dietary: secret,
        accessibility: 'Wheelchair user',
        address: '42 Hidden Road, Springfield',
      },
      a.ctx(),
      ports,
    );
    expect(g).toMatchObject({
      dietary: secret,
      accessibility: 'Wheelchair user',
      address: '42 Hidden Road, Springfield',
    });
    const [row] = await admin<{ c: string; t: string }[]>`
      select private_ciphertext as c, row_to_json(g)::text as t from guests.guests g where id = ${g.id}`;
    expect(row?.c).toMatch(/^local\.v1\./);
    for (const plain of [secret, 'Wheelchair', 'Hidden Road']) expect(row?.t).not.toContain(plain);
    const leaks = await admin<{ n: number }[]>`
      select (select count(*) from guests.rsvp_history where detail::text like ${`%${secret}%`} or array_to_string(fields, ',') like '%Shellfish%')
           + (select count(*) from platform.audit_events where org_id = ${a.org.id} and data::text like ${`%${secret}%`}) as n`;
    expect(Number(leaks[0]?.n)).toBe(0);
    // A ciphertext is bound to its org: another org's key scope can't open it.
    const other = await withTenant(systemCtx(b.org.id), (tx) =>
      tx.execute<{ id: string }>(sql`select id from guests.guests where id = ${g.id}`),
    );
    expect(other).toHaveLength(0);
    // Clearing all three removes the ciphertext.
    await executeCommand(
      updatePartyGuestCommand,
      { eventId: ev.id, guestId: g.id, firstName: 'Priv' },
      a.ctx(),
      ports,
    );
    const [cleared] = await admin<
      { c: string | null }[]
    >`select private_ciphertext as c from guests.guests where id = ${g.id}`;
    expect(cleared?.c).toBeNull();
  });

  it('enforces the plus-one, primary and move rules', async () => {
    const party = await executeCommand(createPartyCommand, { eventId: ev.id, name: 'Rules' }, a.ctx(), ports);
    const dest = await executeCommand(
      createPartyCommand,
      { eventId: ev.id, name: 'Rules 2' },
      a.ctx(),
      ports,
    );
    const host = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: party.id, firstName: 'Host' },
      a.ctx(),
      ports,
    );
    const plus = await executeCommand(
      addPlusOneCommand,
      { eventId: ev.id, hostGuestId: host.id },
      a.ctx(),
      ports,
    );
    // One plus-one per host; a plus-one brings no plus-one; moving a plus-one alone is refused.
    await expect(
      executeCommand(addPlusOneCommand, { eventId: ev.id, hostGuestId: host.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'host_has_plus_one' } });
    await expect(
      executeCommand(addPlusOneCommand, { eventId: ev.id, hostGuestId: plus.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'invalid_state', details: { reason: 'host_is_plus_one' } });
    await expect(
      executeCommand(
        moveGuestCommand,
        { eventId: ev.id, guestId: plus.id, toPartyId: dest.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { reason: 'plus_one_moves_with_host' } });
    await expect(
      executeCommand(
        moveGuestCommand,
        { eventId: ev.id, guestId: host.id, toPartyId: party.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'toPartyId' } });
    // A plus-one can't be primary; a named guest keeps a first name.
    await expect(
      executeCommand(
        updatePartyGuestCommand,
        { eventId: ev.id, guestId: plus.id, firstName: 'P', isPrimary: true },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ details: { field: 'isPrimary' } });
    await expect(
      executeCommand(
        updatePartyGuestCommand,
        { eventId: ev.id, guestId: host.id, firstName: '  ' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'firstName' } });
    await expect(
      executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: party.id, lastName: 'Only' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'firstName' } });
    await expect(
      executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: party.id, firstName: 'x'.repeat(81) },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      executeCommand(createPartyCommand, { eventId: ev.id, name: '' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Choosing a new primary moves the flag.
    const second = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: party.id, firstName: 'Second', isPrimary: true },
      a.ctx(),
      ports,
    );
    const list = await executeQuery(guestListQuery, { eventId: ev.id, search: 'Rules' }, a.ctx(), ports);
    const rules = list.parties.find((p) => p.id === party.id);
    expect(rules?.guests.filter((g) => g.isPrimary).map((g) => g.id)).toEqual([second.id]);
    // The demoted primary's change is in the history too.
    const demoted = (await history(party.id)).find(
      (e) => e.guestId === host.id && e.action === 'guest_updated',
    );
    expect(demoted).toMatchObject({ fields: ['isPrimary'], source: 'manual' });
    // A party of another event, or a guest of another event under this event id: not found.
    const foreignParty = await executeCommand(
      createPartyCommand,
      { eventId: other.id, name: 'Else' },
      a.ctx(),
      ports,
    );
    await expect(
      executeCommand(
        moveGuestCommand,
        { eventId: ev.id, guestId: host.id, toPartyId: foreignParty.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'toPartyId' } });
    await expect(
      executeCommand(
        addPartyGuestCommand,
        { eventId: other.id, partyId: party.id, firstName: 'Wrong event' },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('links a guest to a guest-list entry of the same event only, once', async () => {
    const entry = await executeCommand(
      addAttendeeCommand,
      { eventId: ev.id, name: 'Linked Person', email: `linked.${Date.now()}@example.test` },
      a.ctx(),
      ports,
    );
    const elsewhere = await executeCommand(
      addAttendeeCommand,
      { eventId: other.id, name: 'Elsewhere', email: `else.${Date.now()}@example.test` },
      a.ctx(),
      ports,
    );
    const party = await executeCommand(
      createPartyCommand,
      { eventId: ev.id, name: 'Linked' },
      a.ctx(),
      ports,
    );
    const g = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: party.id, firstName: 'Linked', attendeeId: entry.id },
      a.ctx(),
      ports,
    );
    expect(g.attendeeId).toBe(entry.id);
    const [row] = await admin<
      { contact: string | null }[]
    >`select contact_id::text as contact from guests.guests where id = ${g.id}`;
    expect(row?.contact).toBeTruthy();
    await expect(
      executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: party.id, firstName: 'Twice', attendeeId: entry.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { field: 'attendeeId' } });
    await expect(
      executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: party.id, firstName: 'Else', attendeeId: elsewhere.id },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed', details: { field: 'attendeeId' } });
  });

  it('never feeds marketing: no contacts, consents or domain events come from guest commands', async () => {
    const counts = async () => {
      const [r] = await admin<{ contacts: number; consents: number; events: number }[]>`
        select (select count(*)::int from crm.contacts where org_id = ${a.org.id}) as contacts,
               (select count(*)::int from crm.consents where org_id = ${a.org.id}) as consents,
               (select count(*)::int from platform.domain_events where org_id = ${a.org.id}) as events`;
      return r;
    };
    const before = await counts();
    const party = await executeCommand(createPartyCommand, { eventId: ev.id, name: 'Quiet' }, a.ctx(), ports);
    const g = await executeCommand(
      addPartyGuestCommand,
      { eventId: ev.id, partyId: party.id, firstName: 'Quiet', address: '9 Main St' },
      a.ctx(),
      ports,
    );
    await executeCommand(addPlusOneCommand, { eventId: ev.id, hostGuestId: g.id }, a.ctx(), ports);
    await executeCommand(removePartyCommand, { eventId: ev.id, partyId: party.id }, a.ctx(), ports);
    expect(await counts()).toEqual(before);
  });

  it('searches and filters by name, side, tag and VIP', async () => {
    const ev2 = await wedding(a, `Filters ${a.org.slug}`);
    const mk = (name: string, extra: object) =>
      executeCommand(createPartyCommand, { eventId: ev2.id, name, ...extra }, a.ctx(), ports);
    const p1 = await mk('Adams', { side: 'Bride', tags: ['Family'], vip: true });
    const p2 = await mk('Baker', { side: 'Groom', tags: ['Work'] });
    await mk('Clark', { side: 'Groom' });
    await executeCommand(
      addPartyGuestCommand,
      { eventId: ev2.id, partyId: p2.id, firstName: 'Zoë', lastName: 'Quinn' },
      a.ctx(),
      ports,
    );
    const names = async (f: object) =>
      (await executeQuery(guestListQuery, { eventId: ev2.id, ...f }, a.ctx(), ports)).parties.map(
        (p) => p.name,
      );
    expect(await names({})).toEqual(['Adams', 'Baker', 'Clark']);
    expect(await names({ side: 'groom' })).toEqual(['Baker', 'Clark']);
    expect(await names({ tag: 'FAMILY' })).toEqual(['Adams']);
    expect(await names({ vip: true })).toEqual(['Adams']);
    expect(await names({ search: 'zoë quinn' })).toEqual(['Baker']);
    expect(await names({ search: '100%' })).toEqual([]);
    expect(await names({ limit: 1, offset: 1 })).toEqual(['Baker']);
    const list = await executeQuery(guestListQuery, { eventId: ev2.id, side: 'Groom' }, a.ctx(), ports);
    expect(list.total).toBe(2);
    expect(list.counts.parties).toBe(3);
    expect(list.sides).toEqual(['Bride', 'Groom']);
    expect(p1.vip).toBe(true);
  });

  it('permissions: a viewer reads but cannot change; anonymous and other orgs see nothing', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const party = await executeCommand(createPartyCommand, { eventId: ev.id, name: 'Perms' }, a.ctx(), ports);
    const list = await executeQuery(guestListQuery, { eventId: ev.id, search: 'Perms' }, viewer, ports);
    expect(list.parties.map((p) => p.name)).toEqual(['Perms']);
    for (const [cmd, input] of [
      [createPartyCommand, { eventId: ev.id, name: 'Nope' }],
      [updatePartyCommand, { eventId: ev.id, partyId: party.id, name: 'Nope' }],
      [removePartyCommand, { eventId: ev.id, partyId: party.id }],
      [addPartyGuestCommand, { eventId: ev.id, partyId: party.id, firstName: 'Nope' }],
    ] as const)
      await expect(
        executeCommand(cmd as typeof createPartyCommand, input, viewer, ports),
      ).rejects.toMatchObject({
        code: 'forbidden',
      });
    await expect(
      executeQuery(guestListQuery, { eventId: ev.id }, createCtx({ orgId: a.org.id }), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Org B: A's rows don't exist.
    const bList = await executeQuery(guestListQuery, { eventId: ev.id }, b.ctx(), ports);
    expect(bList).toMatchObject({ total: 0, parties: [], counts: { parties: 0, guests: 0 } });
    await expect(
      executeCommand(
        updatePartyCommand,
        { eventId: ev.id, partyId: party.id, name: 'Hijack' },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      executeCommand(createPartyCommand, { eventId: ev.id, name: 'Into A' }, b.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await executeQuery(partyHistoryQuery, { eventId: ev.id, partyId: party.id }, b.ctx(), ports),
    ).toEqual([]);
  });

  it('needs the guests module', async () => {
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'guests', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(
        executeCommand(createPartyCommand, { eventId: ev.id, name: 'Off' }, a.ctx(), ports),
      ).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(executeQuery(guestListQuery, { eventId: ev.id }, a.ctx(), ports)).rejects.toMatchObject({
        code: 'module_not_enabled',
      });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'guests', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
  });

  it('history is append-only for the runtime role', async () => {
    for (const q of [
      sql`update guests.rsvp_history set source = 'paper'`,
      sql`delete from guests.rsvp_history`,
    ])
      await expect(withTenant(createCtx({ orgId: a.org.id }), (tx) => tx.execute(q))).rejects.toThrow();
  });
});
