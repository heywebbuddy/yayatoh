import type { SolverProblem } from '@yayatoh/seating/client';
import { describe, expect, it } from 'vitest';
import type { SolverReply, SolverRequest } from '../src/components/seating-solver/solver.worker.ts';

/**
 * M6.12a: the solver's Web Worker steps the search, reports progress, stops when asked (nothing
 * proposed) and gives the same proposal for the same seed.
 */

const replies: SolverReply[] = [];
const scope = {
  postMessage: (m: SolverReply) => replies.push(m),
  onmessage: null as ((e: MessageEvent<SolverRequest>) => void) | null,
};
(globalThis as { self?: unknown }).self = scope;
await import('../src/components/seating-solver/solver.worker.ts');

const send = (data: SolverRequest) => scope.onmessage?.({ data } as MessageEvent<SolverRequest>);
const id = (p: string, n: number) => `${p.repeat(8)}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function ballroom(guests: number, tables: number): SolverProblem {
  return {
    places: Array.from({ length: tables }, (_, i) => ({
      itemId: id('a', i),
      capacity: 10,
      taken: 0,
      x: (i % 8) * 300,
      y: Math.floor(i / 8) * 300,
    })),
    guests: Array.from({ length: guests }, (_, i) => ({
      id: id('b', i),
      partyId: id('c', Math.floor(i / 3)),
      vip: i % 40 === 0,
      side: i % 2 ? 'Bride' : 'Groom',
      tags: [],
    })),
    fixed: {},
    rules: [
      {
        id: id('d', 1),
        kind: 'keep_together',
        params: { group: { by: 'party' } },
        strength: 'hard',
        weight: 5,
      },
      { id: id('d', 2), kind: 'vip_near_stage', params: {}, strength: 'soft', weight: 4 },
    ],
    stages: [{ x: 1000, y: -200 }],
    exits: [],
  };
}

const settled = async (runId: number) => {
  for (let i = 0; i < 2_000; i++) {
    const last = replies.filter((r) => r.runId === runId).at(-1);
    if (last && last.type !== 'progress') return last;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('the worker never finished');
};

describe('solver worker (M6.12a)', () => {
  it('proposes, reporting progress, the same for the same seed', async () => {
    send({ type: 'run', runId: 1, problem: ballroom(400, 45), seed: 9 });
    const a = await settled(1);
    send({ type: 'run', runId: 2, problem: ballroom(400, 45), seed: 9 });
    const b = await settled(2);
    expect(a.type).toBe('done');
    expect(b.type).toBe('done');
    if (a.type !== 'done' || b.type !== 'done') return;
    expect(replies.some((r) => r.runId === 1 && r.type === 'progress')).toBe(true);
    expect(b.proposal.seats).toEqual(a.proposal.seats);
    expect(a.proposal.evaluation.hard).toEqual([]);
    expect(a.proposal.evaluation.unseated).toBe(0);
    expect(a.ms).toBeLessThan(5_000);
  });

  it('stops when asked and proposes nothing', async () => {
    send({ type: 'run', runId: 3, problem: ballroom(400, 45), seed: 1 });
    send({ type: 'cancel', runId: 3 });
    expect(await settled(3)).toEqual({ type: 'cancelled', runId: 3 });
  });
});
