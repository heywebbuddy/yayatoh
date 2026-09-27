import { DomainError } from './errors.ts';

/**
 * An explicit lifecycle (roadmap §2 principle 6): defined once, enforced by conditional
 * `UPDATE … WHERE status = ANY(from)` in the handler, with every transition logged by the command.
 */
export interface StateMachine<S extends string, E extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly initial: S;
  readonly events: Readonly<Record<E, { readonly from: readonly S[]; readonly to: S }>>;
  /** States from which `event` is allowed. */
  from(event: E): readonly S[];
  to(event: E): S;
  can(state: S, event: E): boolean;
  /** Throws `invalid_state` if the event is not allowed from `state`; returns the next state. */
  next(state: S, event: E): S;
}

export function defineStateMachine<const S extends string, const E extends string>(def: {
  name: string;
  states: readonly S[];
  initial: S;
  events: Record<E, { from: readonly S[]; to: S }>;
}): StateMachine<S, E> {
  for (const [event, t] of Object.entries(def.events) as [E, { from: readonly S[]; to: S }][]) {
    if (!def.states.includes(t.to)) throw new Error(`${def.name}.${event}: unknown target state ${t.to}`);
    for (const f of t.from)
      if (!def.states.includes(f)) throw new Error(`${def.name}.${event}: unknown source ${f}`);
  }
  const events = def.events;
  return Object.freeze({
    name: def.name,
    states: def.states,
    initial: def.initial,
    events,
    from: (e: E) => events[e].from,
    to: (e: E) => events[e].to,
    can: (s: S, e: E) => events[e].from.includes(s),
    next(s: S, e: E) {
      if (!events[e].from.includes(s)) {
        throw new DomainError('invalid_state', `${def.name}: cannot ${e} from ${s}`, { from: s, event: e });
      }
      return events[e].to;
    },
  });
}

/** States reachable from `start` (for tests: no orphan states, terminal states are terminal). */
export function reachable<S extends string, E extends string>(
  m: StateMachine<S, E>,
  start: S = m.initial,
): Set<S> {
  const seen = new Set<S>([start]);
  const queue: S[] = [start];
  while (queue.length) {
    const s = queue.shift() as S;
    for (const e of Object.keys(m.events) as E[]) {
      if (m.can(s, e) && !seen.has(m.to(e))) {
        seen.add(m.to(e));
        queue.push(m.to(e));
      }
    }
  }
  return seen;
}
