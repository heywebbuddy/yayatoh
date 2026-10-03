import { describe, expect, it } from 'vitest';
import {
  compile,
  createSearch,
  evaluate,
  type SolverGuest,
  type SolverPlace,
  type SolverProblem,
  type SolverRule,
  SolverRuleSpec,
  sameRule,
  seededRandom,
  solve,
} from '../src/client.ts';

/**
 * M6.12a seating solver: deterministic tabu search, hard rules never broken, manual placements
 * never moved (a property over random locks), the incremental cost matches a full evaluation,
 * and 400 guests in well under the 5 s budget.
 */

const id = (prefix: string, n: number) =>
  `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A ballroom: `tables` round tables of `seats` in rows of 8, the stage on top, exits below. */
function ballroom(tables: number, seats: number, taken: (i: number) => number = () => 0): SolverPlace[] {
  return Array.from({ length: tables }, (_, i) => ({
    itemId: id('a', i),
    capacity: seats - taken(i),
    taken: taken(i),
    x: 300 + (i % 8) * 300,
    y: 500 + Math.floor(i / 8) * 300,
  }));
}

const TAGS = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli'];

/** `n` guests in parties of 1–6 (seeded), some VIP, sides and tags spread around. */
function guestList(n: number, seed = 1): SolverGuest[] {
  const rand = seededRandom(seed);
  const out: SolverGuest[] = [];
  let party = 0;
  while (out.length < n) {
    const size = Math.min(n - out.length, 1 + Math.floor(rand() * 6));
    const vip = rand() < 0.08;
    const side = rand() < 0.5 ? 'Bride' : 'Groom';
    const tags = rand() < 0.4 ? [TAGS[Math.floor(rand() * TAGS.length)] ?? 'Acme'] : [];
    if (rand() < 0.05) tags.push('Accessibility');
    for (let k = 0; k < size; k++)
      out.push({ id: id('b', out.length), partyId: id('c', party), vip, side, tags });
    party++;
  }
  return out;
}

let ruleN = 0;
function rule(spec: unknown, strength: 'hard' | 'soft' = 'hard', weight = 5): SolverRule {
  return { ...SolverRuleSpec.parse(spec), id: id('d', ruleN++), strength, weight };
}

function problem(over: Partial<SolverProblem> = {}): SolverProblem {
  return {
    places: ballroom(4, 8),
    guests: [],
    fixed: {},
    rules: [],
    stages: [{ x: 1200, y: 0 }],
    exits: [{ x: 0, y: 2000 }],
    ...over,
  };
}

const tableOf = (p: { seats: Readonly<Record<string, string | null>> }, g: SolverGuest) => p.seats[g.id];

describe('solver rules (M6.12a)', () => {
  it('parses the rule kinds and refuses keep-apart of a group from itself', () => {
    expect(
      SolverRuleSpec.safeParse({ kind: 'keep_together', params: { group: { by: 'party' } } }).success,
    ).toBe(true);
    expect(
      SolverRuleSpec.safeParse({
        kind: 'keep_apart',
        params: { a: { by: 'tag', value: 'Acme' }, b: { by: 'tag', value: 'acme' } },
      }).success,
    ).toBe(false);
    expect(SolverRuleSpec.safeParse({ kind: 'table_max', params: { max: 0 } }).success).toBe(false);
    expect(SolverRuleSpec.safeParse({ kind: 'access_near_exit', params: { tag: '' } }).success).toBe(false);
  });

  it('knows when two rules say the same thing', () => {
    const apart = (a: string, b: string) =>
      SolverRuleSpec.parse({
        kind: 'keep_apart',
        params: { a: { by: 'side', value: a }, b: { by: 'side', value: b } },
      });
    expect(sameRule(apart('Bride', 'Groom'), apart('groom', 'bride'))).toBe(true);
    expect(sameRule(apart('Bride', 'Groom'), apart('Bride', 'Work'))).toBe(false);
    const max = (n: number) => SolverRuleSpec.parse({ kind: 'table_max', params: { max: n } });
    expect(sameRule(max(8), max(6))).toBe(true);
  });
});

describe('solver (M6.12a)', () => {
  it('seats a small list: parties together, VIPs at the front, nothing over capacity', () => {
    const guests: SolverGuest[] = [
      ...[0, 1, 2].map((n) => ({ id: id('b', n), partyId: id('c', 0), vip: true, side: null, tags: [] })),
      ...[3, 4].map((n) => ({ id: id('b', n), partyId: id('c', 1), vip: false, side: null, tags: [] })),
    ];
    const rules = [
      rule({ kind: 'keep_together', params: { group: { by: 'party' } } }),
      rule({ kind: 'vip_near_stage', params: {} }),
    ];
    const p = problem({ guests, rules, places: ballroom(4, 4) });
    const out = solve(p, { seed: 7 });
    expect(out.evaluation.hard).toEqual([]);
    expect(out.evaluation.unseated).toBe(0);
    const vipTable = tableOf(out, guests[0] as SolverGuest);
    expect(guests.slice(0, 3).every((g) => tableOf(out, g) === vipTable)).toBe(true);
    // The stage is above x = 1200: the nearest table of the first row (x 1200 or 1500).
    expect([id('a', 3), id('a', 4)]).toContain(vipTable);
  });

  it('keeps hard keep-apart groups at different tables and scores soft breaches', () => {
    const guests: SolverGuest[] = Array.from({ length: 8 }, (_, n) => ({
      id: id('b', n),
      partyId: id('c', n),
      vip: false,
      side: n < 4 ? 'Bride' : 'Groom',
      tags: [],
    }));
    const apart = rule({
      kind: 'keep_apart',
      params: { a: { by: 'side', value: 'Bride' }, b: { by: 'side', value: 'Groom' } },
    });
    const out = solve(problem({ guests, rules: [apart], places: ballroom(2, 6) }), { seed: 1 });
    expect(out.evaluation.hard).toEqual([]);
    const brides = new Set(guests.slice(0, 4).map((g) => tableOf(out, g)));
    const grooms = new Set(guests.slice(4).map((g) => tableOf(out, g)));
    expect([...brides].some((t) => grooms.has(t))).toBe(false);

    // Soft and impossible (one table): each shared table is a breach costing the weight.
    const soft = { ...apart, strength: 'soft' as const, weight: 3 };
    const one = solve(problem({ guests, rules: [soft], places: ballroom(1, 8) }), { seed: 1 });
    expect(one.evaluation.hard).toEqual([]);
    expect(one.evaluation.perRule[0]).toMatchObject({ breaches: 1, penalty: 3 });
  });

  it('table maximum: hard leaves the room, soft counts people over', () => {
    const guests = guestList(12, 3).map((g, n) => ({ ...g, partyId: id('c', n) }));
    const hard = solve(
      problem({ guests, rules: [rule({ kind: 'table_max', params: { max: 5 } })], places: ballroom(3, 8) }),
      { seed: 2 },
    );
    const counts = Object.values(hard.seats).reduce<Record<string, number>>((a, t) => {
      if (t) a[t] = (a[t] ?? 0) + 1;
      return a;
    }, {});
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(5);
    expect(hard.evaluation.unseated).toBe(0);
    // Two tables of 8 and a soft max of 5: two people over somewhere, never anyone in the queue.
    const soft = solve(
      problem({
        guests,
        rules: [rule({ kind: 'table_max', params: { max: 5 } }, 'soft', 2)],
        places: ballroom(2, 8),
      }),
      { seed: 2 },
    );
    expect(soft.evaluation.unseated).toBe(0);
    expect(soft.evaluation.perRule[0]).toMatchObject({ breaches: 2, penalty: 4 });
  });

  it('counts tickets towards the table maximum and leaves them their seats', () => {
    const guests = guestList(6, 4).map((g, n) => ({ ...g, partyId: id('c', n) }));
    const places = ballroom(2, 4, (i) => (i === 0 ? 3 : 0));
    const out = solve(problem({ guests, places, rules: [] }), { seed: 1 });
    const atFirst = Object.values(out.seats).filter((t) => t === id('a', 0)).length;
    expect(atFirst).toBeLessThanOrEqual(1);
    expect(out.evaluation.unseated).toBe(1);
  });

  it('reports what it cannot do: no stage, a group too big, too few seats', () => {
    const guests = guestList(30, 5).map((g) => ({ ...g, tags: ['Acme'] }));
    const c = compile(
      problem({
        guests,
        stages: [],
        rules: [
          rule({ kind: 'vip_near_stage', params: {} }),
          rule({ kind: 'keep_together', params: { group: { by: 'tag', value: 'Acme' } } }),
        ],
        places: ballroom(3, 8),
      }),
    );
    expect(c.issues.map((i) => i.code).sort()).toEqual(['group_too_big', 'no_stage', 'too_few_seats']);
    expect(c.issues.find((i) => i.code === 'too_few_seats')).toMatchObject({ size: 30, room: 24 });
    // A hard group bigger than any table is kept on as few tables as it can, never a violation.
    const out = createSearch(c, { seed: 3 });
    while (!out.run(500)) {}
    expect(out.result().evaluation.hard).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const p = problem({
      guests: guestList(80, 9),
      places: ballroom(12, 8),
      rules: [
        rule({ kind: 'keep_together', params: { group: { by: 'party' } } }, 'soft', 4),
        rule({
          kind: 'keep_apart',
          params: { a: { by: 'tag', value: 'Acme' }, b: { by: 'tag', value: 'Globex' } },
        }),
      ],
    });
    const a = solve(p, { seed: 42 });
    const b = solve(p, { seed: 42 });
    expect(b.seats).toEqual(a.seats);
    expect(b.evaluation).toEqual(a.evaluation);
  });

  it('steps, reports progress and can stop early with the best so far', () => {
    const c = compile(
      problem({
        guests: guestList(120, 11),
        places: ballroom(15, 8),
        rules: [
          rule({ kind: 'keep_together', params: { group: { by: 'side', value: 'Bride' } } }, 'soft', 2),
        ],
      }),
    );
    const s = createSearch(c, { seed: 5, iterations: 5_000 });
    expect(s.run(100)).toBe(false);
    expect(s.progress).toBeGreaterThan(0);
    expect(s.progress).toBeLessThan(1);
    const partial = s.result();
    expect(partial.iterations).toBe(100);
    expect(partial.evaluation.cost).toBe(s.bestCost);
  });

  it('keeps the incremental cost equal to a full evaluation', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rand = seededRandom(seed * 31);
      const places = ballroom(6 + Math.floor(rand() * 6), 4 + Math.floor(rand() * 6), (i) =>
        i % 4 === 0 ? 1 : 0,
      );
      const guests = guestList(20 + Math.floor(rand() * 50), seed);
      const fixed: Record<string, string> = {};
      for (const g of guests)
        if (rand() < 0.15) fixed[g.id] = places[Math.floor(rand() * places.length)]?.itemId ?? '';
      const rules = [
        rule(
          { kind: 'keep_together', params: { group: { by: 'party' } } },
          rand() < 0.5 ? 'hard' : 'soft',
          3,
        ),
        rule(
          {
            kind: 'keep_apart',
            params: { a: { by: 'tag', value: 'Acme' }, b: { by: 'side', value: 'Groom' } },
          },
          'soft',
          2,
        ),
        rule({ kind: 'vip_near_stage', params: {} }, rand() < 0.5 ? 'hard' : 'soft', 6),
        rule({ kind: 'access_near_exit', params: { tag: 'Accessibility' } }, 'soft', 4),
        rule({ kind: 'table_max', params: { max: 5 } }, 'soft', 1),
        rule({ kind: 'keep_together', params: { group: { by: 'tag', value: 'Hooli' } } }, 'soft', 7),
      ];
      const c = compile(problem({ places, guests, fixed, rules }));
      const s = createSearch(c, { seed, iterations: 400 });
      while (!s.run(37)) {}
      const out = s.result();
      expect(out.evaluation.cost).toBe(s.bestCost);
    }
  });

  it('never moves a manual placement (property over random locks)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rand = seededRandom(seed);
      const places = ballroom(4 + Math.floor(rand() * 10), 2 + Math.floor(rand() * 9));
      const guests = guestList(10 + Math.floor(rand() * 90), seed + 100);
      const fixed: Record<string, string> = {};
      for (const g of guests)
        if (rand() < rand()) fixed[g.id] = places[Math.floor(rand() * places.length)]?.itemId ?? '';
      const rules = [
        rule({ kind: 'keep_together', params: { group: { by: 'party' } } }, rand() < 0.5 ? 'hard' : 'soft'),
        rule({ kind: 'vip_near_stage', params: {} }, rand() < 0.5 ? 'hard' : 'soft'),
        rule(
          { kind: 'table_max', params: { max: 1 + Math.floor(rand() * 10) } },
          rand() < 0.5 ? 'hard' : 'soft',
        ),
      ];
      const p = problem({ places, guests, fixed, rules });
      const out = solve(p, { seed, iterations: 600 });
      for (const gid of Object.keys(fixed)) expect(out.seats).not.toHaveProperty(gid);
      // Every movable guest has an answer (a table or the queue); nobody else does.
      const movable = guests.filter((g) => !(g.id in fixed)).map((g) => g.id);
      expect(Object.keys(out.seats).sort()).toEqual(movable.sort());
      // The proposal never puts more people at a table than its seats, manual placements included.
      const c = compile(p);
      const ev = evaluate(c, { ...out.seats, ...fixed });
      const overBefore = evaluate(c, fixed).hard.filter((v) => v.kind === 'capacity').length;
      expect(ev.hard.filter((v) => v.kind === 'capacity').length).toBe(overBefore);
    }
  });

  it('seats 400 guests in well under 5 seconds with no hard-rule violations', () => {
    const guests = guestList(400, 2026);
    const places = ballroom(44, 10);
    const rules = [
      rule({ kind: 'keep_together', params: { group: { by: 'party' } } }),
      rule({ kind: 'vip_near_stage', params: {} }),
      rule({
        kind: 'keep_apart',
        params: { a: { by: 'tag', value: 'Acme' }, b: { by: 'tag', value: 'Globex' } },
      }),
      rule({ kind: 'access_near_exit', params: { tag: 'Accessibility' } }, 'soft', 6),
      rule({ kind: 'keep_together', params: { group: { by: 'tag', value: 'Initech' } } }, 'soft', 3),
      rule({ kind: 'table_max', params: { max: 10 } }),
    ];
    const started = performance.now();
    const out = solve(problem({ guests, places, rules }), { seed: 1 });
    const ms = performance.now() - started;
    expect(out.evaluation.hard).toEqual([]);
    expect(out.evaluation.unseated).toBe(0);
    expect(ms).toBeLessThan(5_000);
  });
});
