import { compile, createSearch, type Proposal, type SolverProblem } from '@yayatoh/seating/client';

/**
 * The seating solver's Web Worker (M6.12a, P6-10): runs the tabu search off the main thread in
 * steps, reports progress between steps and stops when asked. Deterministic: the same problem
 * and seed give the same proposal as anywhere else.
 */
export type SolverRequest =
  | { readonly type: 'run'; readonly runId: number; readonly problem: SolverProblem; readonly seed: number }
  | { readonly type: 'cancel'; readonly runId: number };

export type SolverReply =
  | { readonly type: 'progress'; readonly runId: number; readonly progress: number }
  | { readonly type: 'done'; readonly runId: number; readonly proposal: Proposal; readonly ms: number }
  | { readonly type: 'cancelled'; readonly runId: number }
  | { readonly type: 'failed'; readonly runId: number };

const STEP = 400;
/** The worker's global scope (typed here: the app compiles against the DOM library). */
const scope = self as unknown as {
  postMessage(message: SolverReply): void;
  onmessage: ((e: MessageEvent<SolverRequest>) => void) | null;
};
let cancelled = new Set<number>();

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function run(runId: number, problem: SolverProblem, seed: number) {
  const started = performance.now();
  try {
    const search = createSearch(compile(problem), { seed });
    while (!search.run(STEP)) {
      scope.postMessage({ type: 'progress', runId, progress: search.progress } satisfies SolverReply);
      await tick();
      if (cancelled.has(runId)) {
        cancelled = new Set();
        scope.postMessage({ type: 'cancelled', runId } satisfies SolverReply);
        return;
      }
    }
    const proposal = search.result();
    scope.postMessage({
      type: 'done',
      runId,
      proposal,
      ms: performance.now() - started,
    } satisfies SolverReply);
  } catch {
    scope.postMessage({ type: 'failed', runId } satisfies SolverReply);
  }
}

scope.onmessage = (e: MessageEvent<SolverRequest>) => {
  const msg = e.data;
  if (msg.type === 'cancel') cancelled.add(msg.runId);
  else void run(msg.runId, msg.problem, msg.seed);
};
