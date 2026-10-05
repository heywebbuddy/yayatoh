import { type FloorplanDoc, placedSeats } from '@yayatoh/floorplan';
import type { SolverRule } from './solver-rules.ts';

/**
 * The seating solver (M6.12a, decision P6-10): a tabu search that proposes a table for every
 * guest in the queue. Pure and deterministic: the same problem and seed give the same proposal,
 * in the editor's Web Worker and in tests. It runs in steps (`createSearch(...).run(n)`), so the
 * worker can report progress and stop between steps.
 *
 * Manual placements (guests already seated) are fixed inputs: they count towards every rule,
 * and the proposal never moves them. A table's room is its seats less what tickets hold
 * (`capacity`); hard rules are never broken by a move; soft rules cost `weight` per breach.
 * Costs are integers: a hard breach costs `HARD_COST`, a guest left in the queue
 * `UNSEATED_COST`, a soft breach its weight.
 */

export const HARD_COST = 1_000_000;
export const UNSEATED_COST = 1_000;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SolverPlace {
  readonly itemId: string;
  /** Seats guests may take: the table's seats less those tickets or attendees hold. */
  readonly capacity: number;
  /** Seats tickets or attendees hold (they count towards `table_max`). */
  readonly taken: number;
  /** The table's centre, centimetres. */
  readonly x: number;
  readonly y: number;
}

export interface SolverGuest {
  readonly id: string;
  readonly partyId: string;
  readonly vip: boolean;
  readonly side: string | null;
  readonly tags: readonly string[];
}

export interface SolverProblem {
  readonly places: readonly SolverPlace[];
  /** Everyone to sit on the chart (declined guests left out), the fixed ones included. */
  readonly guests: readonly SolverGuest[];
  /** Manual placements: guest id → table. Never moved. */
  readonly fixed: Readonly<Record<string, string>>;
  readonly rules: readonly SolverRule[];
  readonly stages: readonly Point[];
  readonly exits: readonly Point[];
}

/* -------------------------------------------------------------- geometry ---- */

/** Each table or row's centre, and the stages and exits (entrances count) of a plan. */
export function planGeometry(doc: FloorplanDoc): {
  centres: Map<string, Point>;
  stages: Point[];
  exits: Point[];
} {
  const sums = new Map<string, { x: number; y: number; n: number }>();
  for (const s of placedSeats(doc)) {
    const a = sums.get(s.itemId) ?? { x: 0, y: 0, n: 0 };
    a.x += s.x;
    a.y += s.y;
    a.n += 1;
    sums.set(s.itemId, a);
  }
  const centres = new Map([...sums].map(([id, a]) => [id, { x: a.x / a.n, y: a.y / a.n }]));
  const stages: Point[] = [];
  const exits: Point[] = [];
  for (const i of doc.items) {
    if (i.kind !== 'object') continue;
    const r = (i.rotation * Math.PI) / 180;
    const hx = i.width / 2;
    const hy = i.height / 2;
    const c = { x: i.x + hx * Math.cos(r) - hy * Math.sin(r), y: i.y + hx * Math.sin(r) + hy * Math.cos(r) };
    if (i.objectType === 'stage') stages.push(c);
    else if (i.objectType === 'exit' || i.objectType === 'entrance') exits.push(c);
  }
  return { centres, stages, exits };
}

/* -------------------------------------------------------------- compiling ---- */

export const SOLVER_ISSUES = ['no_stage', 'no_exit', 'group_too_big', 'too_few_seats', 'no_room'] as const;
export type SolverIssueCode = (typeof SOLVER_ISSUES)[number];

/** Something the host should know before trusting a proposal (never an error). */
export interface SolverIssue {
  readonly code: SolverIssueCode;
  readonly ruleId: string | null;
  /** `group_too_big`: the group's size and the biggest table; `too_few_seats`: guests and seats. */
  readonly size?: number;
  readonly room?: number;
}

const lower = (s: string) => s.toLowerCase();

function hasTag(g: SolverGuest, tag: string) {
  const t = lower(tag);
  return g.tags.some((x) => lower(x) === t);
}

function matches(g: SolverGuest, target: { by: 'party' | 'tag' | 'side'; value: string }) {
  if (target.by === 'party') return g.partyId === target.value;
  if (target.by === 'tag') return hasTag(g, target.value);
  return g.side !== null && lower(g.side) === lower(target.value);
}

/** One group the rules talk about: a party, a tag or a side, with what each rule asks of it. */
interface Group {
  readonly ruleIndex: number;
  readonly members: readonly number[];
  /** Keep together: cost per extra table. 0 = not a together group. */
  togetherCost: number;
  /** Hard and small enough to fit one table: a breach is a hard violation. */
  hardTogether: boolean;
}

interface ApartPair {
  readonly ruleIndex: number;
  readonly a: number;
  readonly b: number;
  readonly cost: number;
  readonly hard: boolean;
}

interface Zone {
  readonly ruleIndex: number;
  /** Guests the zone is for. */
  readonly guests: ReadonlySet<number>;
  /** Places inside the zone. */
  readonly inside: Uint8Array;
  readonly hard: boolean;
  readonly cost: number;
}

/**
 * The problem, compiled once into arrays the search (and `evaluate`) share. Exposed for tests
 * and the accept command, which evaluates a state with the same definitions as the search.
 */
export interface Compiled {
  readonly problem: SolverProblem;
  readonly P: number;
  readonly placeIndex: ReadonlyMap<string, number>;
  readonly guestIndex: ReadonlyMap<string, number>;
  /** Seats guests may take per place (before `table_max`). */
  readonly cap: Int32Array;
  /** Room left for proposed guests: hard `table_max` applied, manual placements taken off. */
  readonly room: Int32Array;
  /** Manual placements per place. */
  readonly fixedAt: Int32Array;
  /** Per guest: its fixed place, or -1. */
  readonly fixedOf: Int32Array;
  readonly groups: readonly Group[];
  readonly apart: readonly ApartPair[];
  readonly zones: readonly Zone[];
  readonly tableMax: {
    readonly max: number;
    readonly hard: boolean;
    readonly cost: number;
    readonly ruleIndex: number;
  } | null;
  /** Movable guests, bundled: a hard together group that fits a table moves as one unit. */
  readonly units: readonly { readonly guests: readonly number[]; readonly allowed: Uint8Array }[];
  readonly issues: readonly SolverIssue[];
}

function nearestZone(
  places: readonly SolverPlace[],
  room: readonly number[],
  targets: readonly Point[],
  need: number,
): Uint8Array {
  const inside = new Uint8Array(places.length);
  const dist = places.map((p) => Math.min(...targets.map((t) => Math.hypot(p.x - t.x, p.y - t.y))));
  const order = places.map((_, i) => i).sort((a, b) => (dist[a] as number) - (dist[b] as number) || a - b);
  let got = 0;
  for (const i of order) {
    if (got >= need) break;
    if (((room[i] as number) ?? 0) <= 0) continue;
    inside[i] = 1;
    got += room[i] as number;
  }
  return inside;
}

type Unit = Compiled['units'][number];

export function compile(problem: SolverProblem): Compiled {
  const { places, guests, rules } = problem;
  const P = places.length;
  const placeIndex = new Map(places.map((p, i) => [p.itemId, i]));
  const guestIndex = new Map(guests.map((g, i) => [g.id, i]));
  const issues: SolverIssue[] = [];
  const cap = Int32Array.from(places, (p) => Math.max(0, p.capacity));
  const fixedOf = new Int32Array(guests.length).fill(-1);
  const fixedAt = new Int32Array(P);
  for (const [gid, itemId] of Object.entries(problem.fixed)) {
    const g = guestIndex.get(gid);
    const p = placeIndex.get(itemId);
    if (g === undefined || p === undefined) continue;
    fixedOf[g] = p;
    fixedAt[p] = ((fixedAt[p] as number) ?? 0) + 1;
  }

  let tableMax: Compiled['tableMax'] = null;
  rules.forEach((r, ruleIndex) => {
    if (r.kind === 'table_max' && !tableMax)
      tableMax = { max: r.params.max, hard: r.strength === 'hard', cost: r.weight, ruleIndex };
  });
  const tm = tableMax as Compiled['tableMax'];
  // What a place can hold at most (hard table maximum included), then what proposals may use.
  const limit = Array.from(places, (p, i) =>
    tm?.hard ? Math.max(0, Math.min(cap[i] as number, tm.max - p.taken)) : (cap[i] as number),
  );
  const room = Int32Array.from(limit, (l, i) => Math.max(0, l - (fixedAt[i] as number)));
  const biggest = Math.max(0, ...limit);

  const groups: Group[] = [];
  const apart: ApartPair[] = [];
  const zones: Zone[] = [];
  const all = guests.map((_, i) => i);
  const membersOf = (target: { by: 'party' | 'tag' | 'side'; value: string }) =>
    all.filter((i) => matches(guests[i] as SolverGuest, target));

  rules.forEach((r, ruleIndex) => {
    const hard = r.strength === 'hard';
    if (r.kind === 'keep_together') {
      const g = r.params.group;
      const sets =
        g.by === 'party'
          ? [...new Set(guests.map((x) => x.partyId))].map((partyId) =>
              all.filter((i) => (guests[i] as SolverGuest).partyId === partyId),
            )
          : [membersOf(g)];
      for (const members of sets) {
        if (members.length < 2) continue;
        const fits = members.length <= biggest;
        if (hard && !fits && g.by !== 'party')
          issues.push({ code: 'group_too_big', ruleId: r.id, size: members.length, room: biggest });
        groups.push({
          ruleIndex,
          members,
          togetherCost: hard ? (fits ? HARD_COST : MAX_SPLIT_COST) : r.weight,
          hardTogether: hard && fits,
        });
      }
      if (hard && g.by === 'party' && sets.some((m) => m.length > biggest))
        issues.push({
          code: 'group_too_big',
          ruleId: r.id,
          size: Math.max(...sets.map((m) => m.length)),
          room: biggest,
        });
    } else if (r.kind === 'keep_apart') {
      const a = groups.length;
      groups.push({ ruleIndex, members: membersOf(r.params.a), togetherCost: 0, hardTogether: false });
      groups.push({ ruleIndex, members: membersOf(r.params.b), togetherCost: 0, hardTogether: false });
      apart.push({ ruleIndex, a, b: a + 1, cost: hard ? HARD_COST : r.weight, hard });
    } else if (r.kind === 'vip_near_stage' || r.kind === 'access_near_exit') {
      const targets = r.kind === 'vip_near_stage' ? problem.stages : problem.exits;
      if (!targets.length) {
        issues.push({ code: r.kind === 'vip_near_stage' ? 'no_stage' : 'no_exit', ruleId: r.id });
        return;
      }
      const who = new Set(
        all.filter((i) =>
          r.kind === 'vip_near_stage'
            ? (guests[i] as SolverGuest).vip
            : hasTag(guests[i] as SolverGuest, r.params.tag),
        ),
      );
      if (!who.size) return;
      zones.push({
        ruleIndex,
        guests: who,
        inside: nearestZone(places, limit, targets, who.size),
        hard,
        cost: hard ? HARD_COST : r.weight,
      });
    }
  });

  // Units: movable guests; a hard together group that fits a table moves as one.
  const parent = all.map((i) => i);
  const find = (i: number): number => {
    while ((parent[i] as number) !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (const g of groups) {
    if (!g.hardTogether) continue;
    const movable = g.members.filter((i) => (fixedOf[i] as number) === -1);
    for (const i of movable.slice(1)) parent[find(i)] = find(movable[0] as number);
  }
  const bundles = new Map<number, number[]>();
  for (const i of all) {
    if ((fixedOf[i] as number) !== -1) continue;
    const root = find(i);
    const list = bundles.get(root) ?? [];
    list.push(i);
    bundles.set(root, list);
  }
  const units = [...bundles.values()].map((members) => {
    const allowed = new Uint8Array(P).fill(1);
    for (const z of zones) {
      if (!z.hard || !members.some((i) => z.guests.has(i))) continue;
      for (let p = 0; p < P; p++) if (!(z.inside[p] as number)) allowed[p] = 0;
    }
    // A hard group with someone seated by hand joins them there (when they all sit at one table).
    for (const g of groups) {
      if (!g.hardTogether || !members.some((i) => g.members.includes(i))) continue;
      const at = new Set(
        g.members.filter((i) => (fixedOf[i] as number) !== -1).map((i) => fixedOf[i] as number),
      );
      if (at.size === 1) {
        const only = [...at][0];
        for (let p = 0; p < P; p++) if (p !== only) allowed[p] = 0;
      }
    }
    return { guests: members, allowed };
  });

  const seatsLeft = room.reduce((a, b) => a + b, 0);
  const toSeat = units.reduce((a, u) => a + u.guests.length, 0);
  if (P === 0 && toSeat) issues.push({ code: 'no_room', ruleId: null, size: toSeat, room: 0 });
  else if (toSeat > seatsLeft)
    issues.push({ code: 'too_few_seats', ruleId: null, size: toSeat, room: seatsLeft });

  return {
    problem,
    P,
    placeIndex,
    guestIndex,
    cap,
    room,
    fixedAt,
    fixedOf,
    groups,
    apart,
    zones,
    tableMax: tm,
    units,
    issues,
  };
}

/**
 * A hard together group bigger than every table can't be kept whole: it is kept on as few
 * tables as the search finds, each extra table costing this much (more than any soft rule).
 */
export const MAX_SPLIT_COST = 100;

/* -------------------------------------------------------------- evaluating ---- */

export interface Violation {
  /** The rule broken, or null for a table over its seats. */
  readonly ruleId: string | null;
  readonly kind: SolverRule['kind'] | 'capacity';
  readonly itemIds: readonly string[];
  readonly guestIds: readonly string[];
}

export interface RuleScore {
  readonly ruleId: string;
  /** Breaches of the rule (extra tables, shared tables, guests outside a zone, people over). */
  readonly breaches: number;
  readonly penalty: number;
}

export interface Evaluation {
  readonly hard: readonly Violation[];
  /** Soft rules' total penalty (0 = every soft rule kept). */
  readonly softPenalty: number;
  readonly unseated: number;
  readonly perRule: readonly RuleScore[];
  /** The search's objective for this state. */
  readonly cost: number;
}

/**
 * Score a whole state from scratch: `seats` gives each guest's table (missing or null = in the
 * queue). The search keeps the same cost incrementally; tests check that they agree.
 */
export function evaluate(c: Compiled, seats: Readonly<Record<string, string | null>>): Evaluation {
  const { problem, P } = c;
  const G = problem.guests.length;
  const at = new Int32Array(G).fill(-1);
  for (let i = 0; i < G; i++) {
    const item = seats[(problem.guests[i] as SolverGuest).id];
    const p = item ? c.placeIndex.get(item) : undefined;
    at[i] = p ?? -1;
  }
  const count = new Int32Array(P);
  for (const p of at) if (p >= 0) count[p] = (count[p] as number) + 1;
  const hard: Violation[] = [];
  const breaches = problem.rules.map(() => 0);
  const penalties = problem.rules.map(() => 0);
  const ids = (list: readonly number[]) => list.map((i) => (problem.guests[i] as SolverGuest).id);
  const placesOf = (list: readonly number[]) =>
    [...new Set(list.map((i) => at[i] as number).filter((p) => p >= 0))].sort((a, b) => a - b);
  let hardCount = 0;

  for (let p = 0; p < P; p++) {
    const over = (count[p] as number) - (c.cap[p] as number);
    if (over > 0) {
      hardCount += over;
      hard.push({
        ruleId: null,
        kind: 'capacity',
        itemIds: [(problem.places[p] as SolverPlace).itemId],
        guestIds: ids(at.reduce<number[]>((a, q, i) => (q === p ? [...a, i] : a), [])),
      });
    }
  }
  const tm = c.tableMax;
  if (tm) {
    const rule = problem.rules[tm.ruleIndex] as SolverRule;
    for (let p = 0; p < P; p++) {
      const over = (problem.places[p] as SolverPlace).taken + (count[p] as number) - tm.max;
      if (over <= 0) continue;
      breaches[tm.ruleIndex] = (breaches[tm.ruleIndex] as number) + over;
      if (tm.hard) {
        hardCount += over;
        hard.push({
          ruleId: rule.id,
          kind: 'table_max',
          itemIds: [(problem.places[p] as SolverPlace).itemId],
          guestIds: ids(at.reduce<number[]>((a, q, i) => (q === p ? [...a, i] : a), [])),
        });
      } else penalties[tm.ruleIndex] = (penalties[tm.ruleIndex] as number) + over * tm.cost;
    }
  }
  for (const g of c.groups) {
    if (!g.togetherCost) continue;
    const used = placesOf(g.members);
    const extra = Math.max(0, used.length - 1);
    if (!extra) continue;
    breaches[g.ruleIndex] = (breaches[g.ruleIndex] as number) + extra;
    if (g.hardTogether) {
      hardCount += extra;
      hard.push({
        ruleId: (problem.rules[g.ruleIndex] as SolverRule).id,
        kind: 'keep_together',
        itemIds: used.map((p) => (problem.places[p] as SolverPlace).itemId),
        guestIds: ids(g.members.filter((i) => (at[i] as number) >= 0)),
      });
    } else penalties[g.ruleIndex] = (penalties[g.ruleIndex] as number) + extra * g.togetherCost;
  }
  for (const pair of c.apart) {
    const a = c.groups[pair.a] as Group;
    const b = c.groups[pair.b] as Group;
    const inA = new Set(placesOf(a.members));
    const shared = placesOf(b.members).filter((p) => inA.has(p));
    if (!shared.length) continue;
    breaches[pair.ruleIndex] = (breaches[pair.ruleIndex] as number) + shared.length;
    if (pair.hard) {
      hardCount += shared.length;
      const set = new Set(shared);
      hard.push({
        ruleId: (problem.rules[pair.ruleIndex] as SolverRule).id,
        kind: 'keep_apart',
        itemIds: shared.map((p) => (problem.places[p] as SolverPlace).itemId),
        guestIds: ids([...a.members, ...b.members].filter((i) => set.has(at[i] as number))),
      });
    } else penalties[pair.ruleIndex] = (penalties[pair.ruleIndex] as number) + shared.length * pair.cost;
  }
  for (const z of c.zones) {
    const out = [...z.guests].filter((i) => (at[i] as number) >= 0 && !(z.inside[at[i] as number] as number));
    if (!out.length) continue;
    breaches[z.ruleIndex] = (breaches[z.ruleIndex] as number) + out.length;
    const rule = problem.rules[z.ruleIndex] as SolverRule;
    if (z.hard) {
      hardCount += out.length;
      hard.push({
        ruleId: rule.id,
        kind: rule.kind,
        itemIds: placesOf(out).map((p) => (problem.places[p] as SolverPlace).itemId),
        guestIds: ids(out),
      });
    } else penalties[z.ruleIndex] = (penalties[z.ruleIndex] as number) + out.length * z.cost;
  }
  const unseated = at.reduce((a, p) => a + (p < 0 ? 1 : 0), 0);
  const softPenalty = penalties.reduce((a, b) => a + b, 0);
  return {
    hard,
    softPenalty,
    unseated,
    perRule: problem.rules.map((r, i) => ({
      ruleId: r.id,
      breaches: breaches[i] as number,
      penalty: penalties[i] as number,
    })),
    cost: hardCount * HARD_COST + unseated * UNSEATED_COST + softPenalty,
  };
}

/* -------------------------------------------------------------- searching ---- */

/** A small, fast, seeded generator (mulberry32): the same seed, the same proposal. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export interface SearchOptions {
  readonly seed: number;
  /** Iterations in all (default: enough for a few hundred guests in well under a second). */
  readonly iterations?: number;
  /** Moves tried per iteration. */
  readonly sample?: number;
  /** Iterations a reversed move stays forbidden. */
  readonly tenure?: number;
}

export interface Proposal {
  /** Every movable guest's proposed table, or null (left in the queue). */
  readonly seats: Readonly<Record<string, string | null>>;
  readonly evaluation: Evaluation;
  readonly issues: readonly SolverIssue[];
  readonly iterations: number;
}

export interface Search {
  /** Run up to `n` more iterations; returns true once the search is finished. */
  run(n: number): boolean;
  readonly done: boolean;
  /** 0–1. */
  readonly progress: number;
  readonly bestCost: number;
  /** The best state found so far. */
  result(): Proposal;
}

export const DEFAULT_SEARCH = { sample: 48, tenure: 12 } as const;

export function defaultIterations(units: number): number {
  return Math.min(60_000, 2_000 + units * 40);
}

export function createSearch(c: Compiled, opts: SearchOptions): Search {
  const { P, units, groups, apart, zones, problem } = c;
  const U = units.length;
  const W = P + 1; // place P = the queue
  const rand = seededRandom(opts.seed);
  const maxIter = opts.iterations ?? defaultIterations(U);
  const sample = opts.sample ?? DEFAULT_SEARCH.sample;
  const tenure = opts.tenure ?? DEFAULT_SEARCH.tenure;
  const size = units.map((u) => u.guests.length);

  // Per unit and place: queue and zone costs (fixed for the whole search).
  const unitCost = new Float64Array(U * W);
  for (let u = 0; u < U; u++) {
    const members = (units[u] as Unit).guests;
    unitCost[u * W + P] = members.length * UNSEATED_COST;
    for (const z of zones) {
      const n = members.reduce((a, i) => a + (z.guests.has(i) ? 1 : 0), 0);
      if (!n) continue;
      for (let p = 0; p < P; p++)
        if (!(z.inside[p] as number)) unitCost[u * W + p] = (unitCost[u * W + p] as number) + n * z.cost;
    }
  }
  // Group memberships per unit: [group, count] pairs, and the apart pairs a unit touches.
  const memberships: [number, number][][] = units.map(() => []);
  const groupsOfGuest = new Map<number, number[]>();
  groups.forEach((g, gi) => {
    for (const i of g.members) {
      const l = groupsOfGuest.get(i) ?? [];
      l.push(gi);
      groupsOfGuest.set(i, l);
    }
  });
  const unitOfGuest = new Int32Array(problem.guests.length).fill(-1);
  units.forEach((u, ui) => {
    for (const i of u.guests) unitOfGuest[i] = ui;
  });
  units.forEach((u, ui) => {
    const m = new Map<number, number>();
    for (const i of u.guests) for (const gi of groupsOfGuest.get(i) ?? []) m.set(gi, (m.get(gi) ?? 0) + 1);
    memberships[ui] = [...m];
  });
  const pairsOfGroup = new Map<number, number[]>();
  apart.forEach((pr, k) => {
    for (const g of [pr.a, pr.b]) pairsOfGroup.set(g, [...(pairsOfGroup.get(g) ?? []), k]);
  });
  const pairsOfUnit = memberships.map((ms) => [...new Set(ms.flatMap(([g]) => pairsOfGroup.get(g) ?? []))]);
  const contrib = (u: number, g: number) => {
    for (const [gg, n] of memberships[u] as [number, number][]) if (gg === g) return n;
    return 0;
  };

  // State.
  const place = new Int32Array(U).fill(P);
  const load = new Int32Array(W);
  const cnt = new Int32Array(groups.length * W);
  const distinct = new Int32Array(groups.length);
  for (let gi = 0; gi < groups.length; gi++) {
    for (const i of (groups[gi] as Group).members) {
      const p = (c.fixedOf[i] as number) >= 0 ? (c.fixedOf[i] as number) : P;
      cnt[gi * W + p] = (cnt[gi * W + p] as number) + 1;
    }
    for (let p = 0; p < P; p++)
      if ((cnt[gi * W + p] as number) > 0) distinct[gi] = (distinct[gi] as number) + 1;
  }
  for (let u = 0; u < U; u++) load[P] = (load[P] as number) + (size[u] as number);
  const tm = c.tableMax;
  const softMax = tm && !tm.hard ? tm : null;
  const over = (p: number, n: number) =>
    softMax && p < P
      ? Math.max(0, (problem.places[p] as SolverPlace).taken + (c.fixedAt[p] as number) + n - softMax.max) *
        softMax.cost
      : 0;

  const fits = (u: number, q: number, freed = 0) =>
    q === P ||
    (((units[u] as Unit).allowed[q] as number) === 1 &&
      (load[q] as number) + (size[u] as number) - freed <= (c.room[q] as number));

  function moveDelta(u: number, q: number): number {
    const p = place[u] as number;
    if (p === q) return 0;
    const s = size[u] as number;
    let d = (unitCost[u * W + q] as number) - (unitCost[u * W + p] as number);
    if (softMax)
      d +=
        over(p, (load[p] as number) - s) -
        over(p, load[p] as number) +
        over(q, (load[q] as number) + s) -
        over(q, load[q] as number);
    for (const [g, n] of memberships[u] as [number, number][]) {
      const tc = (groups[g] as Group).togetherCost;
      if (!tc) continue;
      const D = distinct[g] as number;
      let dd = 0;
      if (p < P && (cnt[g * W + p] as number) === n) dd -= 1;
      if (q < P && (cnt[g * W + q] as number) === 0) dd += 1;
      if (dd) d += tc * (Math.max(0, D + dd - 1) - Math.max(0, D - 1));
    }
    for (const k of pairsOfUnit[u] as number[]) {
      const pr = apart[k] as ApartPair;
      const ca = contrib(u, pr.a);
      const cb = contrib(u, pr.b);
      for (const [x, sign] of [
        [p, -1],
        [q, 1],
      ] as const) {
        if (x === P) continue;
        const a0 = cnt[pr.a * W + x] as number;
        const b0 = cnt[pr.b * W + x] as number;
        const before = a0 > 0 && b0 > 0 ? 1 : 0;
        const after = a0 + sign * ca > 0 && b0 + sign * cb > 0 ? 1 : 0;
        d += (after - before) * pr.cost;
      }
    }
    return d;
  }

  function apply(u: number, q: number) {
    const p = place[u] as number;
    if (p === q) return;
    load[p] = (load[p] as number) - (size[u] as number);
    load[q] = (load[q] as number) + (size[u] as number);
    for (const [g, n] of memberships[u] as [number, number][]) {
      if (p < P && (cnt[g * W + p] as number) === n) distinct[g] = (distinct[g] as number) - 1;
      if (q < P && (cnt[g * W + q] as number) === 0) distinct[g] = (distinct[g] as number) + 1;
      cnt[g * W + p] = (cnt[g * W + p] as number) - n;
      cnt[g * W + q] = (cnt[g * W + q] as number) + n;
    }
    place[u] = q;
  }

  // Cost of the starting state (everyone movable in the queue), from scratch.
  const seatsNow = (): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    units.forEach((un, u) => {
      for (const i of un.guests)
        out[(problem.guests[i] as SolverGuest).id] =
          (place[u] as number) < P ? (problem.places[place[u] as number] as SolverPlace).itemId : null;
    });
    return out;
  };
  const withFixed = (seats: Record<string, string | null>) => {
    const all: Record<string, string | null> = { ...seats };
    for (const [gid, item] of Object.entries(problem.fixed)) if (c.guestIndex.has(gid)) all[gid] = item;
    return all;
  };
  let cost = evaluate(c, withFixed(seatsNow())).cost;

  // Greedy start: the most constrained and biggest units first, each where it costs least
  // (ties: the place it fills best, then plan order).
  const order = units
    .map((_, u) => u)
    .sort((a, b) => {
      const fa = (units[a] as Unit).allowed.reduce((x, y) => x + y, 0);
      const fb = (units[b] as Unit).allowed.reduce((x, y) => x + y, 0);
      return fa - fb || (size[b] as number) - (size[a] as number) || a - b;
    });
  for (const u of order) {
    let best = P;
    let bestD = 0;
    let bestLeft = Number.POSITIVE_INFINITY;
    for (let q = 0; q < P; q++) {
      if (!fits(u, q)) continue;
      const d = moveDelta(u, q);
      const left = (c.room[q] as number) - (load[q] as number) - (size[u] as number);
      if (d < bestD || (d === bestD && best !== P && left < bestLeft)) {
        best = q;
        bestD = d;
        bestLeft = left;
      }
    }
    if (best !== P) {
      apply(u, best);
      cost += bestD;
    }
  }

  let best = Int32Array.from(place);
  let bestCost = cost;
  const tabu = new Int32Array(U * W);
  let iter = 0;
  let done = U === 0 || P === 0 || cost === 0;

  function step() {
    iter++;
    let pick: { u: number; q: number; v: number; d: number } | null = null;
    for (let k = 0; k < sample; k++) {
      const u = Math.floor(rand() * U);
      const p = place[u] as number;
      if (rand() < 0.65) {
        // Move: a random place (now and then the queue).
        const q = rand() < 0.03 ? P : Math.floor(rand() * P);
        if (q === p || !fits(u, q)) continue;
        const d = moveDelta(u, q);
        if ((tabu[u * W + q] as number) > iter && cost + d >= bestCost) continue;
        if (!pick || d < pick.d) pick = { u, q, v: -1, d };
      } else {
        // Swap with a unit at another place.
        const v = Math.floor(rand() * U);
        const q = place[v] as number;
        if (v === u || q === p) continue;
        if (!fits(u, q, size[v] as number) || !fits(v, p, size[u] as number)) continue;
        const d1 = moveDelta(u, q);
        apply(u, q);
        const d2 = moveDelta(v, p);
        apply(u, p);
        const d = d1 + d2;
        if (
          ((tabu[u * W + q] as number) > iter || (tabu[v * W + p] as number) > iter) &&
          cost + d >= bestCost
        )
          continue;
        if (!pick || d < pick.d) pick = { u, q, v, d };
      }
    }
    if (!pick) return;
    const p = place[pick.u] as number;
    apply(pick.u, pick.q);
    tabu[pick.u * W + p] = iter + tenure + Math.floor(rand() * tenure);
    if (pick.v >= 0) {
      apply(pick.v, p);
      tabu[pick.v * W + pick.q] = iter + tenure + Math.floor(rand() * tenure);
    }
    cost += pick.d;
    if (cost < bestCost) {
      bestCost = cost;
      best = Int32Array.from(place);
    }
  }

  return {
    run(n: number) {
      for (let k = 0; k < n && !done; k++) {
        step();
        if (iter >= maxIter || bestCost === 0) done = true;
      }
      return done;
    },
    get done() {
      return done;
    },
    get progress() {
      return done ? 1 : iter / maxIter;
    },
    get bestCost() {
      return bestCost;
    },
    result(): Proposal {
      const seats: Record<string, string | null> = {};
      units.forEach((un, u) => {
        const p = best[u] as number;
        for (const i of un.guests)
          seats[(problem.guests[i] as SolverGuest).id] =
            p < P ? (problem.places[p] as SolverPlace).itemId : null;
      });
      return { seats, evaluation: evaluate(c, withFixed(seats)), issues: c.issues, iterations: iter };
    },
  };
}

/** Compile and run to the end (tests and small charts; the editor steps it in a Worker). */
export function solve(problem: SolverProblem, opts: SearchOptions): Proposal {
  const s = createSearch(compile(problem), opts);
  while (!s.run(1_000)) {
    /* keep going */
  }
  return s.result();
}

/** Who a unit is, for the editor: the unit index of each movable guest (-1 = fixed). */
export function unitIndexOf(c: Compiled): ReadonlyMap<string, number> {
  const m = new Map<string, number>();
  c.units.forEach((u, ui) => {
    for (const i of u.guests) m.set((c.problem.guests[i] as SolverGuest).id, ui);
  });
  return m;
}
