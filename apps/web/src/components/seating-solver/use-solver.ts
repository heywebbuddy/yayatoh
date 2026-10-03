'use client';

import type { Proposal, SolverProblem } from '@yayatoh/seating/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SolverReply, SolverRequest } from './solver.worker.ts';

export type SolverRun =
  | { readonly state: 'idle' }
  | { readonly state: 'running'; readonly progress: number }
  | { readonly state: 'done'; readonly proposal: Proposal; readonly ms: number; readonly seed: number }
  | { readonly state: 'cancelled' }
  | { readonly state: 'failed' };

/**
 * Runs the seating solver in a Web Worker (M6.12a): `start` sends the problem and a seed,
 * progress arrives as the search steps, `cancel` stops it (nothing is proposed). One worker per
 * editor, ended when the editor goes.
 */
export function useSolver() {
  const worker = useRef<Worker | null>(null);
  const runId = useRef(0);
  const seedOf = useRef(new Map<number, number>());
  const [run, setRun] = useState<SolverRun>({ state: 'idle' });

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const start = useCallback((problem: SolverProblem, seed: number) => {
    if (!worker.current) {
      const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<SolverReply>) => {
        const msg = e.data;
        if (msg.runId !== runId.current) return;
        if (msg.type === 'progress') setRun({ state: 'running', progress: msg.progress });
        else if (msg.type === 'done')
          setRun({
            state: 'done',
            proposal: msg.proposal,
            ms: msg.ms,
            seed: seedOf.current.get(msg.runId) ?? seed,
          });
        else if (msg.type === 'cancelled') setRun({ state: 'cancelled' });
        else setRun({ state: 'failed' });
      };
      w.onerror = () => setRun({ state: 'failed' });
      worker.current = w;
    }
    runId.current += 1;
    seedOf.current.set(runId.current, seed);
    setRun({ state: 'running', progress: 0 });
    worker.current.postMessage({ type: 'run', runId: runId.current, problem, seed } satisfies SolverRequest);
  }, []);

  const cancel = useCallback(() => {
    worker.current?.postMessage({ type: 'cancel', runId: runId.current } satisfies SolverRequest);
  }, []);

  const reset = useCallback(() => setRun({ state: 'idle' }), []);

  return { run, start, cancel, reset };
}
