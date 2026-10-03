import { setEntitlementOverrideCommand } from '@yayatoh/billing';
import { withTenant } from '@yayatoh/db';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, type EventDto } from '@yayatoh/events';
import { quickLayout } from '@yayatoh/floorplan';
import {
  addPartyGuestCommand,
  createPartyCommand,
  createSubEventCommand,
  recordSubEventResponseCommand,
  setInvitationsCommand,
} from '@yayatoh/guests';
import { executeCommand, executeQuery } from '@yayatoh/kernel';
import {
  acceptSeatingProposalCommand,
  addSolverRuleCommand,
  guestSeatingQuery,
  removeSolverRuleCommand,
  seatGuestsCommand,
  setEventLayoutCommand,
  solverRulesQuery,
  solverSetupQuery,
  updateSolverRuleCommand,
} from '@yayatoh/seating';
import { solve } from '@yayatoh/seating/client';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * M6.12a seating rules and solver: the rule builder's commands, the solver's input for a chart,
 * and accepting a proposal per table or all through an audited, idempotent command that never
 * overwrites a manual placement and refuses what would break a hard rule. Isolation and the
 * `ai_seating` module gate.
 */

let a: OrgFixture;
let b: OrgFixture;

const gala = (f: OrgFixture, name: string) =>
  executeCommand(
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

/** `tables` round tables of `seats` and a stage. */
async function plan(f: OrgFixture, ev: EventDto, tables = 3, seats = 4) {
  const doc = quickLayout({ rows: 0, seatsPerRow: 1, tables, seatsPerTable: seats, stage: true });
  await executeCommand(setEventLayoutCommand, { eventId: ev.id, doc }, f.ctx(), ports);
  return doc.items.filter((i) => i.kind === 'table').map((i) => i.id);
}

async function party(
  f: OrgFixture,
  ev: EventDto,
  name: string,
  people: string[],
  extra: { vip?: boolean; side?: string; tags?: string[] } = {},
) {
  const p = await executeCommand(createPartyCommand, { eventId: ev.id, name, ...extra }, f.ctx(), ports);
  const guests = [];
  for (const firstName of people)
    guests.push(
      await executeCommand(
        addPartyGuestCommand,
        { eventId: ev.id, partyId: p.id, firstName, lastName: name },
        f.ctx(),
        ports,
      ),
    );
  return { party: p, ids: guests.map((g) => g.id) };
}

const key = () => `accept-${crypto.randomUUID()}`;
const accept = (
  f: OrgFixture,
  eventId: string,
  tables: { itemId: string; guestIds: string[] }[],
  idempotencyKey = key(),
  ctx = f.ctx(),
) =>
  executeCommand(
    acceptSeatingProposalCommand,
    { eventId, subEventId: null, tables },
    { ...ctx, idempotencyKey },
    ports,
  );

const setup = (f: OrgFixture, eventId: string, ctx = f.ctx()) =>
  executeQuery(solverSetupQuery, { eventId, subEventId: null }, ctx, ports);

const placeOf = async (f: OrgFixture, eventId: string) => {
  const v = await executeQuery(guestSeatingQuery, { eventId, subEventId: null }, f.ctx(), ports);
  return new Map(v.parties.flatMap((p) => p.guests.map((g) => [g.id, g.itemId] as const)));
};

/** The proposal grouped per table, as the editor sends it. */
function byTable(seats: Readonly<Record<string, string | null>>) {
  const m = new Map<string, string[]>();
  for (const [g, t] of Object.entries(seats)) if (t) m.set(t, [...(m.get(t) ?? []), g]);
  return [...m].map(([itemId, guestIds]) => ({ itemId, guestIds }));
}

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
});

afterAll(async () => {
  await closePools();
});

describe('seating solver rules (M6.12a)', () => {
  it('adds, changes and removes rules; refuses duplicates and parties of another list', async () => {
    const ev = await gala(a, 'Rules');
    const smith = await party(a, ev, 'Smith', ['Ann']);
    const jones = await party(a, ev, 'Jones', ['Bo']);
    const together = await executeCommand(
      addSolverRuleCommand,
      { eventId: ev.id, spec: { kind: 'keep_together', params: { group: { by: 'party' } } } },
      a.ctx(),
      ports,
    );
    expect(together).toMatchObject({ kind: 'keep_together', strength: 'soft', weight: 5 });
    await expect(
      executeCommand(
        addSolverRuleCommand,
        {
          eventId: ev.id,
          spec: { kind: 'keep_together', params: { group: { by: 'party' } } },
          strength: 'hard',
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'duplicate_rule' } });
    const apart = await executeCommand(
      addSolverRuleCommand,
      {
        eventId: ev.id,
        spec: {
          kind: 'keep_apart',
          params: { a: { by: 'party', value: smith.party.id }, b: { by: 'party', value: jones.party.id } },
        },
        strength: 'hard',
        weight: 9,
      },
      a.ctx(),
      ports,
    );
    expect(apart).toMatchObject({ strength: 'hard', weight: 9 });
    // A party of another event (or org) is refused.
    const other = await gala(a, 'Other');
    const stranger = await party(a, other, 'Stranger', ['Cy']);
    await expect(
      executeCommand(
        addSolverRuleCommand,
        {
          eventId: ev.id,
          spec: {
            kind: 'keep_apart',
            params: {
              a: { by: 'party', value: smith.party.id },
              b: { by: 'party', value: stranger.party.id },
            },
          },
        },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'unknown_party' } });
    // Weight out of range is a validation error.
    await expect(
      executeCommand(
        addSolverRuleCommand,
        { eventId: ev.id, spec: { kind: 'table_max', params: { max: 8 } }, weight: 11 },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });

    const changed = await executeCommand(
      updateSolverRuleCommand,
      { eventId: ev.id, ruleId: together.id, strength: 'hard', weight: 2 },
      a.ctx(),
      ports,
    );
    expect(changed).toMatchObject({ id: together.id, strength: 'hard', weight: 2 });
    await executeCommand(removeSolverRuleCommand, { eventId: ev.id, ruleId: apart.id }, a.ctx(), ports);
    const rules = await executeQuery(solverRulesQuery, { eventId: ev.id }, a.ctx(), ports);
    expect(rules.map((r) => [r.kind, r.strength, r.weight])).toEqual([['keep_together', 'hard', 2]]);
    await expect(
      executeCommand(removeSolverRuleCommand, { eventId: ev.id, ruleId: apart.id }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a viewer reads rules but cannot change them; another org sees nothing', async () => {
    const ev = await gala(a, 'Rules viewer');
    await executeCommand(
      addSolverRuleCommand,
      { eventId: ev.id, spec: { kind: 'vip_near_stage', params: {} } },
      a.ctx(),
      ports,
    );
    const viewer = userCtx(a.viewerId, a.org.id);
    expect(await executeQuery(solverRulesQuery, { eventId: ev.id }, viewer, ports)).toHaveLength(1);
    await expect(
      executeCommand(
        addSolverRuleCommand,
        { eventId: ev.id, spec: { kind: 'table_max', params: { max: 6 } } },
        viewer,
        ports,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(await executeQuery(solverRulesQuery, { eventId: ev.id }, b.ctx(), ports)).toEqual([]);
    await expect(
      executeCommand(
        addSolverRuleCommand,
        { eventId: ev.id, spec: { kind: 'table_max', params: { max: 6 } } },
        b.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('seating solver: setup and accepting (M6.12a)', () => {
  it('gives the solver the chart: room per table, the stage, who is fixed, declined left out', async () => {
    const ev = await gala(a, 'Setup');
    const [t1] = await plan(a, ev, 2, 4);
    const lee = await party(a, ev, 'Lee', ['Al', 'Bea'], { vip: true, side: 'Bride', tags: ['Acme'] });
    const kim = await party(a, ev, 'Kim', ['Cal']);
    await executeCommand(
      seatGuestsCommand,
      { eventId: ev.id, subEventId: null, itemId: t1 ?? '', guestIds: [lee.ids[0] ?? ''] },
      a.ctx(),
      ports,
    );
    // Kim declines the only sub-event: out of the solver's list.
    const dinner = await executeCommand(
      createSubEventCommand,
      {
        eventId: ev.id,
        name: 'Dinner',
        kind: 'reception',
        startsAt: '2030-06-01T22:00:00Z',
        endsAt: '2030-06-02T02:00:00Z',
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      setInvitationsCommand,
      {
        eventId: ev.id,
        subEventIds: [dinner.id],
        target: { kind: 'guests', guestIds: [...lee.ids, ...kim.ids] },
        invited: true,
      },
      a.ctx(),
      ports,
    );
    await executeCommand(
      recordSubEventResponseCommand,
      {
        eventId: ev.id,
        subEventId: dinner.id,
        guestId: kim.ids[0] ?? '',
        status: 'declined',
        source: 'paper',
      },
      a.ctx(),
      ports,
    );
    const s = await setup(a, ev.id);
    expect(s.places.map((p) => p.capacity)).toEqual([4, 4]);
    expect(s.stages).toHaveLength(1);
    expect(s.guests.map((g) => g.id).sort()).toEqual([...lee.ids].sort());
    expect(s.guests[0]).toMatchObject({ partyId: lee.party.id, vip: true, side: 'Bride', tags: ['Acme'] });
    expect(s.fixed).toEqual({ [lee.ids[0] ?? '']: t1 });
    // Another org sees an empty chart (nothing of this org's); a viewer reads it.
    expect(await setup(b, ev.id)).toEqual({
      places: [],
      guests: [],
      fixed: {},
      rules: [],
      stages: [],
      exits: [],
    });
    expect((await setup(a, ev.id, userCtx(a.viewerId, a.org.id))).guests).toHaveLength(2);
  });

  it('accepts one table, then all; idempotent; audited; manual placements stay', async () => {
    const ev = await gala(a, 'Accept');
    await plan(a, ev, 3, 4);
    const p1 = await party(a, ev, 'Park', ['A', 'B', 'C']);
    const p2 = await party(a, ev, 'Ruiz', ['D', 'E']);
    const p3 = await party(a, ev, 'Wu', ['F', 'G', 'H']);
    await executeCommand(
      addSolverRuleCommand,
      {
        eventId: ev.id,
        spec: { kind: 'keep_together', params: { group: { by: 'party' } } },
        strength: 'hard',
      },
      a.ctx(),
      ports,
    );
    const proposal = solve(await setup(a, ev.id), { seed: 1 });
    expect(proposal.evaluation.hard).toEqual([]);
    const tables = byTable(proposal.seats);
    const [first, ...rest] = tables;
    if (!first) throw new Error('no table proposed');
    const k = key();
    const one = await accept(a, ev.id, [first], k);
    expect(one).toEqual({ seated: first.guestIds.length, tables: 1 });
    // The same request again (a retry): the same answer, nothing more.
    expect(await accept(a, ev.id, [first], k)).toEqual(one);
    let at = await placeOf(a, ev.id);
    for (const g of first.guestIds) expect(at.get(g)).toBe(first.itemId);
    // The accepted table is now a manual placement: the next setup has it fixed.
    expect(Object.keys((await setup(a, ev.id)).fixed).sort()).toEqual([...first.guestIds].sort());

    // Accept all (the first table again: its guests are already there, kept).
    const all = await accept(a, ev.id, tables);
    expect(all).toEqual({
      seated: [...rest].reduce((n, t) => n + t.guestIds.length, 0),
      tables: tables.length,
    });
    at = await placeOf(a, ev.id);
    for (const id of [...p1.ids, ...p2.ids, ...p3.ids]) expect(at.get(id)).toBeTruthy();
    const audit = await withTenant(a.ctx(), (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from platform.audit_events where action = 'seating.proposal.accept' and target_id = ${ev.id}`,
      ),
    );
    expect(audit[0]?.n).toBe(2);
  });

  it('never overwrites a manual placement made after the proposal', async () => {
    const ev = await gala(a, 'Manual wins');
    const [t1, t2] = await plan(a, ev, 2, 4);
    const p = await party(a, ev, 'Diaz', ['A', 'B']);
    const [g1, g2] = p.ids;
    // The proposal says table 2; the host seats A at table 1 by hand meanwhile.
    await executeCommand(
      seatGuestsCommand,
      { eventId: ev.id, subEventId: null, itemId: t1 ?? '', guestIds: [g1 ?? ''] },
      a.ctx(),
      ports,
    );
    await expect(
      accept(a, ev.id, [{ itemId: t2 ?? '', guestIds: [g1 ?? '', g2 ?? ''] }]),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'already_seated' } });
    const at = await placeOf(a, ev.id);
    expect(at.get(g1 ?? '')).toBe(t1);
    expect(at.get(g2 ?? '')).toBeNull();
  });

  it("refuses what doesn't fit and what breaks a hard rule; nothing changes", async () => {
    const ev = await gala(a, 'Refuse');
    const [t1, t2] = await plan(a, ev, 2, 2);
    const x = await party(a, ev, 'Xu', ['A', 'B', 'C']);
    await expect(accept(a, ev.id, [{ itemId: t1 ?? '', guestIds: x.ids }])).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'cant_fit', asked: 3, fits: 2 },
    });
    const y = await party(a, ev, 'Yu', ['D']);
    await executeCommand(
      addSolverRuleCommand,
      {
        eventId: ev.id,
        spec: {
          kind: 'keep_apart',
          params: { a: { by: 'party', value: x.party.id }, b: { by: 'party', value: y.party.id } },
        },
        strength: 'hard',
      },
      a.ctx(),
      ports,
    );
    await expect(
      accept(a, ev.id, [{ itemId: t2 ?? '', guestIds: [x.ids[0] ?? '', y.ids[0] ?? ''] }]),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'hard_rule' } });
    const at = await placeOf(a, ev.id);
    expect([...at.values()].every((v) => v === null)).toBe(true);
    // Not a table of the plan; a guest of another event.
    await expect(
      accept(a, ev.id, [{ itemId: crypto.randomUUID(), guestIds: [y.ids[0] ?? ''] }]),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      accept(a, ev.id, [{ itemId: t1 ?? '', guestIds: [crypto.randomUUID()] }]),
    ).rejects.toMatchObject({ code: 'not_found' });
    // No Idempotency-Key: refused.
    await expect(
      executeCommand(
        acceptSeatingProposalCommand,
        { eventId: ev.id, subEventId: null, tables: [{ itemId: t1 ?? '', guestIds: [y.ids[0] ?? ''] }] },
        a.ctx(),
        ports,
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('a viewer cannot accept; another org reaches nothing; needs the ai_seating module', async () => {
    const ev = await gala(a, 'Gate');
    const [t1] = await plan(a, ev, 1, 4);
    const p = await party(a, ev, 'Gate', ['A']);
    const tables = [{ itemId: t1 ?? '', guestIds: p.ids }];
    await expect(accept(a, ev.id, tables, key(), userCtx(a.viewerId, a.org.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(accept(b, ev.id, tables)).rejects.toMatchObject({ code: 'not_found' });
    await executeCommand(
      setEntitlementOverrideCommand,
      { moduleKey: 'ai_seating', effect: 'revoke', reason: 'test' },
      systemCtx(a.org.id),
      ports,
    );
    try {
      await expect(accept(a, ev.id, tables)).rejects.toMatchObject({ code: 'module_not_enabled' });
      await expect(setup(a, ev.id)).rejects.toMatchObject({ code: 'module_not_enabled' });
    } finally {
      await executeCommand(
        setEntitlementOverrideCommand,
        { moduleKey: 'ai_seating', effect: 'grant', reason: 'test' },
        systemCtx(a.org.id),
        ports,
      );
    }
    expect(await accept(a, ev.id, tables)).toEqual({ seated: 1, tables: 1 });
  });
});
